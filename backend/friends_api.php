<?php
/**
 * API друзей на PostgreSQL.
 *
 * Раньше все данные (пользователи, друзья, запросы, звонки, push-подписки,
 * VAPID-ключи, привязки identity) хранились в friends_store.json.
 * Теперь — в той же PostgreSQL, что и мессенджер (таблицы:
 * users, friendships, friend_requests, call_invites, push_subscriptions,
 * identity_links, app_config).
 *
 * Подключение: ТОЛЬКО переменная окружения DATABASE_URL.
 * Пароли/секреты в коде не хранятся. Для PHP-хостинга переменные задаются
 * через SetEnv в .htaccess или настройки хостинга (см. README/чеклист деплоя).
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ===================== Базовые утилиты =====================

function friendsResponse($success, $data = null, $error = null) {
    echo json_encode([
        'success' => $success,
        'data' => $data,
        'error' => $error
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

function nowTs() {
    return time();
}

function normalizeId($value) {
    return trim((string)$value);
}

function normalizeText($value) {
    return trim((string)$value);
}

function normalizeUsernameValue($value) {
    $raw = mb_strtolower(ltrim(normalizeText($value), '@'));
    $raw = preg_replace('/[^a-z0-9]/', '', $raw);
    $raw = (string)$raw;
    return strlen($raw) > 32 ? substr($raw, 0, 32) : $raw;
}

function buildGeneratedUsername($userId) {
    $clean = preg_replace('/[^a-z0-9]/', '', mb_strtolower(normalizeId($userId)));
    $clean = (string)$clean;
    $suffix = str_pad(substr($clean, -8), 8, '0', STR_PAD_LEFT);
    return substr('user' . $suffix, 0, 32);
}

function normalizeExternalKey($value) {
    $key = mb_strtolower(normalizeText($value));
    if ($key === '') return '';
    return strlen($key) > 180 ? substr($key, 0, 180) : $key;
}

function normalizeIdentityKeys($rawKeys, $externalKey = '') {
    $keys = [];
    if (is_array($rawKeys)) {
        foreach ($rawKeys as $value) {
            $normalized = normalizeExternalKey($value);
            if ($normalized === '') continue;
            $keys[$normalized] = true;
        }
    }
    $external = normalizeExternalKey($externalKey);
    if ($external !== '') {
        $keys[$external] = true;
    }
    return array_keys($keys);
}

function hashIdentityPart($value, $seed = 5381) {
    $hash = ((int)$seed) & 0xffffffff;
    $input = (string)$value;
    $len = strlen($input);
    for ($i = 0; $i < $len; $i++) {
        $code = ord($input[$i]);
        $hash = (((($hash << 5) & 0xffffffff) + $hash) & 0xffffffff) ^ $code;
        $hash &= 0xffffffff;
    }
    $hex = dechex($hash & 0xffffffff);
    return str_pad($hex, 8, '0', STR_PAD_LEFT);
}

function buildCanonicalUserIdFromIdentityKey($identityKey) {
    $key = normalizeExternalKey($identityKey);
    if ($key === '') return '';
    $h1 = hashIdentityPart($key, 5381);
    $h2 = hashIdentityPart('seych:' . $key, 2166136261);
    return 'u' . $h1 . $h2;
}

function pickPrimaryIdentityKey($identityKeys) {
    if (!is_array($identityKeys) || !count($identityKeys)) return '';
    foreach ($identityKeys as $key) {
        $normalized = normalizeExternalKey($key);
        if ($normalized !== '') return $normalized;
    }
    return '';
}

function normalizeBoolFlag($value, $default = false) {
    if (is_bool($value)) return $value;
    if (is_int($value) || is_float($value)) return ((int)$value) !== 0;
    $text = mb_strtolower(normalizeText($value));
    if ($text === '') return (bool)$default;
    if (in_array($text, ['1', 'true', 'yes', 'on'], true)) return true;
    if (in_array($text, ['0', 'false', 'no', 'off'], true)) return false;
    return (bool)$default;
}

function pairKey($first, $second) {
    $a = normalizeId($first);
    $b = normalizeId($second);
    if ($a === '' || $b === '') return '';
    return strcmp($a, $b) <= 0 ? ($a . '::' . $b) : ($b . '::' . $a);
}

function pgBool($value) {
    return in_array($value, [true, 't', '1', 1], true);
}

// ===================== Подключение к PostgreSQL =====================

function friendsDbUrl() {
    $envUrl = getenv('DATABASE_URL');
    if ($envUrl !== false && trim((string)$envUrl) !== '') {
        return trim((string)$envUrl);
    }
    return '';
}

function pgNeonEndpointId($host) {
    $host = strtolower(trim((string)$host));
    if ($host === '' || strpos($host, 'neon.') === false) {
        return '';
    }
    $first = explode('.', $host)[0];
    $id = preg_replace('/-pooler$/', '', (string)$first);
    return is_string($id) ? $id : '';
}

function friendsPg() {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $url = friendsDbUrl();
    if ($url === '') {
        friendsResponse(false, null, 'PostgreSQL connection not configured (DATABASE_URL env var required)');
    }
    $parts = parse_url($url);
    if (is_array($parts) && isset($parts['scheme'])) {
        $host = (string)($parts['host'] ?? 'localhost');
        $port = (string)($parts['port'] ?? '5432');
        $dbname = isset($parts['path']) ? ltrim($parts['path'], '/') : '';
        $user = isset($parts['user']) ? urldecode($parts['user']) : '';
        $pass = isset($parts['pass']) ? urldecode($parts['pass']) : '';
        $dsn = 'pgsql:host=' . $host . ';port=' . $port . ';dbname=' . $dbname;
        if (getenv('PG_SSL') === '0') {
            // Без SSL
        } elseif (stripos($url, 'sslmode=disable') === false && stripos($url, 'sslmode=none') === false) {
            $dsn .= ';sslmode=require';
        }
        // Neon (serverless Postgres): пока libpq без SNI, нужно явно передать endpoint ID.
        // Внимание: PDO/pdo_pgsql передаёт значение options как есть (без url-декодирования),
        // поэтому "=" должен быть обычным знаком равенства, а не %3D.
        $neonEndpointId = pgNeonEndpointId($host);
        if ($neonEndpointId !== '') {
            $dsn .= ';options=endpoint=' . $neonEndpointId;
        }
    } else {
        $dsn = $url;
        $user = '';
        $pass = '';
    }
    try {
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);
    } catch (PDOException $e) {
        friendsResponse(false, null, 'Database unavailable');
    }
    return $pdo;
}

// ===================== VAPID (Web Push) =====================

function b64urlEncode($binary) {
    return rtrim(strtr(base64_encode((string)$binary), '+/', '-_'), '=');
}

function b64urlDecode($value) {
    $safe = strtr((string)$value, '-_', '+/');
    $padding = strlen($safe) % 4;
    if ($padding > 0) {
        $safe .= str_repeat('=', 4 - $padding);
    }
    $decoded = base64_decode($safe, true);
    return $decoded === false ? '' : $decoded;
}

function isValidVapidPublicKey($encoded) {
    $raw = b64urlDecode($encoded);
    return is_string($raw) && strlen($raw) === 65 && ord($raw[0]) === 0x04;
}

function friendsBuildRawEcPublicKey($details) {
    if (!is_array($details)) return '';
    $ec = is_array($details['ec'] ?? null) ? $details['ec'] : [];
    $x = $ec['x'] ?? '';
    $y = $ec['y'] ?? '';
    if (is_string($x) && is_string($y) && strlen($x) === 32 && strlen($y) === 32) {
        return "\x04" . $x . $y;
    }
    $public = $ec['public_key'] ?? '';
    if (is_string($public) && strlen($public) === 65 && ord($public[0]) === 0x04) {
        return $public;
    }
    return '';
}

function friendsAsn1ReadLength($data, &$offset) {
    if ($offset >= strlen($data)) return -1;
    $length = ord($data[$offset++]);
    if (($length & 0x80) === 0) {
        return $length;
    }
    $bytesCount = $length & 0x7f;
    if ($bytesCount < 1 || $bytesCount > 4 || ($offset + $bytesCount) > strlen($data)) {
        return -1;
    }
    $length = 0;
    for ($i = 0; $i < $bytesCount; $i++) {
        $length = ($length << 8) | ord($data[$offset++]);
    }
    return $length;
}

function friendsDerToJoseSignature($der, $partLength = 32) {
    if (!is_string($der) || $der === '') return '';
    $offset = 0;
    if (ord($der[$offset++]) !== 0x30) return '';
    $seqLen = friendsAsn1ReadLength($der, $offset);
    if ($seqLen < 0 || ($offset + $seqLen) > strlen($der)) return '';
    if (ord($der[$offset++]) !== 0x02) return '';
    $rLen = friendsAsn1ReadLength($der, $offset);
    if ($rLen < 1 || ($offset + $rLen) > strlen($der)) return '';
    $r = substr($der, $offset, $rLen);
    $offset += $rLen;
    if (ord($der[$offset++]) !== 0x02) return '';
    $sLen = friendsAsn1ReadLength($der, $offset);
    if ($sLen < 1 || ($offset + $sLen) > strlen($der)) return '';
    $s = substr($der, $offset, $sLen);
    $r = ltrim($r, "\x00");
    $s = ltrim($s, "\x00");
    $r = str_pad(substr($r, -$partLength), $partLength, "\x00", STR_PAD_LEFT);
    $s = str_pad(substr($s, -$partLength), $partLength, "\x00", STR_PAD_LEFT);
    return $r . $s;
}

function pgGetAppConfig($pdo, $key) {
    $stmt = $pdo->prepare('SELECT value FROM app_config WHERE key = ?');
    $stmt->execute([(string)$key]);
    $row = $stmt->fetch();
    return is_array($row) ? (string)($row['value'] ?? '') : '';
}

function pgSetAppConfig($pdo, $key, $value) {
    $stmt = $pdo->prepare(
        'INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
    );
    $stmt->execute([(string)$key, (string)$value]);
}

function pgGetVapidKeys($pdo) {
    $existingPublic = pgGetAppConfig($pdo, 'vapid_public_key');
    $existingPrivate = pgGetAppConfig($pdo, 'vapid_private_pem');
    if ($existingPublic !== '' && $existingPrivate !== '' && isValidVapidPublicKey($existingPublic)) {
        return ['public_key' => $existingPublic, 'private_pem' => $existingPrivate];
    }
    $resource = openssl_pkey_new([
        'private_key_type' => OPENSSL_KEYTYPE_EC,
        'curve_name' => 'prime256v1'
    ]);
    if (!$resource) {
        return ['public_key' => '', 'private_pem' => ''];
    }
    $privatePem = '';
    if (!openssl_pkey_export($resource, $privatePem)) {
        return ['public_key' => '', 'private_pem' => ''];
    }
    $details = openssl_pkey_get_details($resource);
    $rawPublic = friendsBuildRawEcPublicKey($details);
    if ($rawPublic === '') {
        return ['public_key' => '', 'private_pem' => ''];
    }
    $keys = [
        'public_key' => b64urlEncode($rawPublic),
        'private_pem' => $privatePem
    ];
    pgSetAppConfig($pdo, 'vapid_public_key', $keys['public_key']);
    pgSetAppConfig($pdo, 'vapid_private_pem', $keys['private_pem']);
    return $keys;
}

function friendsSanitizeSubscription($subscription) {
    if (!is_array($subscription)) return null;
    $endpoint = normalizeText($subscription['endpoint'] ?? '');
    if ($endpoint === '' || stripos($endpoint, 'https://') !== 0) return null;
    $keys = is_array($subscription['keys'] ?? null) ? $subscription['keys'] : [];
    $auth = normalizeText($keys['auth'] ?? '');
    $p256dh = normalizeText($keys['p256dh'] ?? '');
    $contentEncoding = normalizeText($subscription['contentEncoding'] ?? '');
    return [
        'endpoint' => $endpoint,
        'auth' => $auth,
        'p256dh' => $p256dh,
        'contentEncoding' => $contentEncoding
    ];
}

function friendsSendWebPush($endpoint, $vapidPublic, $vapidPrivatePem) {
    if (!function_exists('curl_init')) return ['ok' => false, 'status' => 0];
    $parts = parse_url($endpoint);
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    $host = normalizeText($parts['host'] ?? '');
    if (($scheme !== 'https' && $scheme !== 'http') || $host === '') {
        return ['ok' => false, 'status' => 0];
    }
    $aud = $scheme . '://' . $host;
    $header = ['typ' => 'JWT', 'alg' => 'ES256'];
    $payload = [
        'aud' => $aud,
        'exp' => nowTs() + 12 * 60 * 60,
        'sub' => 'mailto:notify@seych-call.local'
    ];
    $tokenPayload = b64urlEncode(json_encode($header, JSON_UNESCAPED_UNICODE)) . '.' . b64urlEncode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $signatureDer = '';
    $signed = openssl_sign($tokenPayload, $signatureDer, $vapidPrivatePem, OPENSSL_ALGO_SHA256);
    if (!$signed) {
        return ['ok' => false, 'status' => 0];
    }
    $signatureJose = friendsDerToJoseSignature($signatureDer, 32);
    if ($signatureJose === '') {
        return ['ok' => false, 'status' => 0];
    }
    $jwt = $tokenPayload . '.' . b64urlEncode($signatureJose);
    $send = function ($headers) use ($endpoint) {
        $ch = curl_init($endpoint);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POSTFIELDS, '');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $status;
    };
    $headers = [
        'TTL: 60',
        'Urgency: high',
        'Authorization: vapid t=' . $jwt . ', k=' . $vapidPublic,
        'Crypto-Key: p256ecdsa=' . $vapidPublic,
        'Content-Length: 0'
    ];
    $status = $send($headers);
    if ($status === 400 || $status === 401 || $status === 403) {
        $status = $send([
            'TTL: 60',
            'Urgency: high',
            'Authorization: WebPush ' . $jwt,
            'Crypto-Key: p256ecdsa=' . $vapidPublic,
            'Content-Length: 0'
        ]);
    }
    $ok = $status >= 200 && $status < 300;
    return ['ok' => $ok, 'status' => $status];
}

// ===================== Пользователи =====================

function pgGetUserRow($pdo, $userId) {
    $id = normalizeId($userId);
    if ($id === '') return null;
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!is_array($row)) return null;
    return [
        'id' => (string)$row['id'],
        'name' => normalizeText($row['display_name'] ?? ''),
        'avatar' => normalizeText($row['avatar_url'] ?? ''),
        'username' => normalizeText($row['username'] ?? ''),
        'external_key' => normalizeText($row['external_key'] ?? ''),
        'active_tab' => pgBool($row['active_tab'] ?? false),
        'presence_updated_at' => (int)($row['presence_updated_at'] ?? 0),
        'last_seen' => (int)($row['last_seen'] ?? 0)
    ];
}

function pgUserExists($pdo, $userId) {
    return pgGetUserRow($pdo, $userId) !== null;
}

function pgFindUserIdByExternalKey($pdo, $externalKey) {
    $key = normalizeExternalKey($externalKey);
    if ($key === '') return '';
    $stmt = $pdo->prepare('SELECT id FROM users WHERE external_key = ? AND external_key <> \'\' LIMIT 1');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    return is_array($row) ? (string)($row['id'] ?? '') : '';
}

function pgUpsertUser($pdo, $userId, $name, $avatar = '', $externalKey = '', $username = '') {
    $id = normalizeId($userId);
    if ($id === '') return null;
    $safeName = normalizeText($name);
    if ($safeName === '') {
        $safeName = 'Пользователь';
    }
    $safeAvatar = normalizeText($avatar);
    $safeExternalKey = normalizeExternalKey($externalKey);
    $safeUsername = normalizeUsernameValue($username);
    if ($safeUsername === '') {
        $safeUsername = buildGeneratedUsername($id);
    }
    $updatedAt = nowTs();
    $stmt = $pdo->prepare(
        'INSERT INTO users (id, username, display_name, avatar_url, external_key, active_tab, presence_updated_at, last_seen, updated_at)
         VALUES (?, ?, ?, ?, ?, false, 0, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           display_name = CASE WHEN EXCLUDED.display_name <> \'\' THEN EXCLUDED.display_name ELSE users.display_name END,
           avatar_url = CASE WHEN EXCLUDED.avatar_url <> \'\' THEN EXCLUDED.avatar_url ELSE users.avatar_url END,
           external_key = CASE WHEN EXCLUDED.external_key <> \'\' THEN EXCLUDED.external_key ELSE users.external_key END,
           username = CASE WHEN EXCLUDED.username <> \'\' THEN EXCLUDED.username ELSE users.username END,
           last_seen = EXCLUDED.last_seen,
           updated_at = EXCLUDED.updated_at'
    );
    $stmt->execute([$id, $safeUsername, $safeName, $safeAvatar, $safeExternalKey, $updatedAt, $updatedAt]);
    return pgGetUserRow($pdo, $id);
}

function pgTouchUserPresence($pdo, $userId, $isActiveTab) {
    $id = normalizeId($userId);
    if ($id === '') return false;
    $activeTab = $isActiveTab ? 'true' : 'false';
    $updatedAt = nowTs();
    $stmt = $pdo->prepare(
        'UPDATE users SET active_tab = ?, presence_updated_at = ?, updated_at = ? WHERE id = ? RETURNING active_tab, presence_updated_at'
    );
    $stmt->execute([$activeTab, $updatedAt, $updatedAt, $id]);
    return $stmt->rowCount() > 0;
}

function pgIsUserActiveOnSite($pdo, $userId) {
    $id = normalizeId($userId);
    if ($id === '') return false;
    $stmt = $pdo->prepare('SELECT active_tab, presence_updated_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!is_array($row)) return false;
    $activeTab = pgBool($row['active_tab'] ?? false);
    if (!$activeTab) return false;
    $presenceTs = (int)($row['presence_updated_at'] ?? 0);
    if ($presenceTs <= 0) return false;
    return (nowTs() - $presenceTs) <= 12;
}

// ===================== Identity / привязка ключей =====================

function pgResolveMappedUserIdByIdentity($pdo, $identityKeys) {
    if (!is_array($identityKeys) || !count($identityKeys)) return '';
    foreach ($identityKeys as $identityKey) {
        $key = normalizeExternalKey($identityKey);
        if ($key === '') continue;
        $stmt = $pdo->prepare('SELECT user_id FROM identity_links WHERE identity_key = ? LIMIT 1');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        $mappedId = is_array($row) ? normalizeId($row['user_id'] ?? '') : '';
        if ($mappedId !== '' && pgUserExists($pdo, $mappedId)) {
            return $mappedId;
        }
    }
    return '';
}

function pgBindIdentityKeysToUser($pdo, $userId, $identityKeys) {
    $id = normalizeId($userId);
    if ($id === '' || !is_array($identityKeys) || !count($identityKeys)) return false;
    $stmt = $pdo->prepare(
        'INSERT INTO identity_links (identity_key, user_id) VALUES (?, ?)
         ON CONFLICT (identity_key) DO UPDATE SET user_id = EXCLUDED.user_id'
    );
    foreach ($identityKeys as $identityKey) {
        $key = normalizeExternalKey($identityKey);
        if ($key === '') continue;
        $stmt->execute([$key, $id]);
    }
    return true;
}

/**
 * Перепривязка всех дружественных данных с $fromUserId на $toUserId.
 * Мессенджерные таблицы (messages/chats/stories) сознательно не трогаем —
 * это соответствует старому поведению JSON-хранилища.
 */
function pgRemapUser($pdo, $fromUserId, $toUserId) {
    $from = normalizeId($fromUserId);
    $to = normalizeId($toUserId);
    if ($from === '' || $to === '' || $from === $to) return;
    if (!pgUserExists($pdo, $from)) return;

    if (pgUserExists($pdo, $to)) {
        // Сливаем недостающие поля from -> to, затем удаляем from.
        $fromUser = pgGetUserRow($pdo, $from);
        $stmt = $pdo->prepare(
            'UPDATE users SET
               display_name = CASE WHEN users.display_name = \'\' THEN ? ELSE users.display_name END,
               avatar_url = CASE WHEN users.avatar_url = \'\' THEN ? ELSE users.avatar_url END,
               external_key = CASE WHEN users.external_key = \'\' THEN ? ELSE users.external_key END,
               last_seen = GREATEST(users.last_seen, ?),
               updated_at = ?
             WHERE id = ?'
        );
        $stmt->execute([(string)($fromUser['name'] ?? ''), (string)($fromUser['avatar'] ?? ''), (string)($fromUser['external_key'] ?? ''), (int)($fromUser['last_seen'] ?? 0), nowTs(), $to]);
        $del = $pdo->prepare('DELETE FROM users WHERE id = ?');
        $del->execute([$from]);
    } else {
        $stmt = $pdo->prepare('UPDATE users SET id = ?, updated_at = ? WHERE id = ?');
        $stmt->execute([$to, nowTs(), $from]);
    }

    // friendships: сдвигаем пользователя и пересчитываем пару.
    $stmt = $pdo->prepare('UPDATE friendships SET user_a = ? WHERE user_a = ?');
    $stmt->execute([$to, $from]);
    $stmt = $pdo->prepare('UPDATE friendships SET user_b = ? WHERE user_b = ?');
    $stmt->execute([$to, $from]);
    $pdo->exec('DELETE FROM friendships WHERE user_a = user_b');
    $pdo->exec(
        'UPDATE friendships SET pair_key = CASE WHEN user_a <= user_b THEN user_a || \'::\' || user_b ELSE user_b || \'::\' || user_a END'
    );
    $pdo->exec(
        'DELETE FROM friendships f USING friendships d
         WHERE f.pair_key = d.pair_key AND f.created_at > d.created_at'
    );

    // friend_requests / call_invites: сдвигаем id, самосвязки удаляем.
    $stmt = $pdo->prepare('UPDATE friend_requests SET from_id = ? WHERE from_id = ?');
    $stmt->execute([$to, $from]);
    $stmt = $pdo->prepare('UPDATE friend_requests SET to_id = ? WHERE to_id = ?');
    $stmt->execute([$to, $from]);
    $pdo->exec('DELETE FROM friend_requests WHERE from_id = to_id');

    $stmt = $pdo->prepare('UPDATE call_invites SET from_id = ? WHERE from_id = ?');
    $stmt->execute([$to, $from]);
    $stmt = $pdo->prepare('UPDATE call_invites SET to_id = ? WHERE to_id = ?');
    $stmt->execute([$to, $from]);
    $pdo->exec('DELETE FROM call_invites WHERE from_id = to_id');

    // push_subscriptions: сливаем по endpoint.
    $merged = [];
    $sel = $pdo->prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
    $sel->execute([$from]);
    foreach ($sel->fetchAll() as $row) {
        $merged[$row['endpoint']] = [
            'auth' => (string)($row['auth_key'] ?? ''),
            'p256dh' => (string)($row['p256dh'] ?? ''),
            'contentEncoding' => (string)($row['content_encoding'] ?? ''),
            'createdAt' => (int)($row['created_at'] ?? 0),
            'updatedAt' => (int)($row['updated_at'] ?? 0)
        ];
    }
    $selTo = $pdo->prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
    $selTo->execute([$to]);
    foreach ($selTo->fetchAll() as $row) {
        $endpoint = $row['endpoint'];
        if (isset($merged[$endpoint])) {
            $existing = $merged[$endpoint];
            if ((int)($row['updated_at'] ?? 0) > $existing['updatedAt']) {
                $merged[$endpoint] = [
                    'auth' => (string)($row['auth_key'] ?? ''),
                    'p256dh' => (string)($row['p256dh'] ?? ''),
                    'contentEncoding' => (string)($row['content_encoding'] ?? ''),
                    'createdAt' => (int)($row['created_at'] ?? 0),
                    'updatedAt' => (int)($row['updated_at'] ?? 0)
                ];
            }
        } else {
            $merged[$endpoint] = [
                'auth' => (string)($row['auth_key'] ?? ''),
                'p256dh' => (string)($row['p256dh'] ?? ''),
                'contentEncoding' => (string)($row['content_encoding'] ?? ''),
                'createdAt' => (int)($row['created_at'] ?? 0),
                'updatedAt' => (int)($row['updated_at'] ?? 0)
            ];
        }
    }
    $delSubs = $pdo->prepare('DELETE FROM push_subscriptions WHERE user_id = ?');
    $delSubs->execute([$from]);
    $upsertSub = $pdo->prepare(
        'INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh, content_encoding, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET
           auth_key = EXCLUDED.auth_key,
           p256dh = EXCLUDED.p256dh,
           content_encoding = EXCLUDED.content_encoding,
           updated_at = EXCLUDED.updated_at'
    );
    foreach ($merged as $endpoint => $sub) {
        $upsertSub->execute([$to, $endpoint, $sub['auth'], $sub['p256dh'], $sub['contentEncoding'], $sub['createdAt'], $sub['updatedAt']]);
    }

    // identity_links
    $stmt = $pdo->prepare('UPDATE identity_links SET user_id = ? WHERE user_id = ?');
    $stmt->execute([$to, $from]);
}

// ===================== Дружба =====================

function pgIsFriends($pdo, $firstId, $secondId) {
    $key = pairKey($firstId, $secondId);
    if ($key === '') return false;
    $stmt = $pdo->prepare('SELECT 1 FROM friendships WHERE pair_key = ? LIMIT 1');
    $stmt->execute([$key]);
    return $stmt->fetch() !== false;
}

function pgCreateFriendship($pdo, $firstId, $secondId) {
    $key = pairKey($firstId, $secondId);
    $a = normalizeId($firstId);
    $b = normalizeId($secondId);
    if ($key === '' || $a === '' || $b === '' || $a === $b) return false;
    $stmt = $pdo->prepare(
        'INSERT INTO friendships (pair_key, user_a, user_b, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (pair_key) DO NOTHING'
    );
    $stmt->execute([$key, $a, $b, nowTs()]);
    return true;
}

function pgRemoveFriendship($pdo, $firstId, $secondId) {
    $key = pairKey($firstId, $secondId);
    if ($key === '') return;
    $stmt = $pdo->prepare('DELETE FROM friendships WHERE pair_key = ?');
    $stmt->execute([$key]);
}

// ===================== Push-подписки =====================

function pgStorePushSubscription($pdo, $appUserId, $subscription) {
    $normalized = friendsSanitizeSubscription($subscription);
    if (!$normalized) return false;
    $userKey = normalizeId($appUserId);
    if ($userKey === '') return false;
    $now = nowTs();
    $stmt = $pdo->prepare(
        'INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh, content_encoding, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET
           auth_key = EXCLUDED.auth_key,
           p256dh = EXCLUDED.p256dh,
           content_encoding = EXCLUDED.content_encoding,
           updated_at = EXCLUDED.updated_at'
    );
    $stmt->execute([
        $userKey,
        $normalized['endpoint'],
        $normalized['auth'],
        $normalized['p256dh'],
        $normalized['contentEncoding'],
        $now,
        $now
    ]);
    return true;
}

function pgNotifyIncomingCall($pdo, $targetId) {
    $targetKey = normalizeId($targetId);
    if ($targetKey === '') return;
    if (pgIsUserActiveOnSite($pdo, $targetKey)) return;
    $keys = pgGetVapidKeys($pdo);
    $publicKey = normalizeText($keys['public_key'] ?? '');
    $privatePem = normalizeText($keys['private_pem'] ?? '');
    if ($publicKey === '' || $privatePem === '') return;
    $stmt = $pdo->prepare('SELECT endpoint, auth_key, p256dh, content_encoding FROM push_subscriptions WHERE user_id = ?');
    $stmt->execute([$targetKey]);
    $subscriptions = $stmt->fetchAll();
    if (!$subscriptions) return;
    $aliveEndpoints = [];
    $removedEndpoints = [];
    foreach ($subscriptions as $subscription) {
        $endpoint = normalizeText($subscription['endpoint'] ?? '');
        if ($endpoint === '') continue;
        $result = friendsSendWebPush($endpoint, $publicKey, $privatePem);
        $status = (int)($result['status'] ?? 0);
        $isGone = $status === 404 || $status === 410;
        if ($isGone) {
            $removedEndpoints[] = $endpoint;
        } else {
            $aliveEndpoints[] = $endpoint;
        }
    }
    if ($removedEndpoints) {
        $del = $pdo->prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?');
        foreach ($removedEndpoints as $endpoint) {
            $del->execute([$targetKey, $endpoint]);
        }
    }
}

// ===================== Сборка состояния =====================

function pgBuildState($pdo, $appUserId) {
    $appUserId = normalizeId($appUserId);

    $friends = [];
    $stmt = $pdo->prepare(
        'SELECT f.user_a, f.user_b, u.id, u.display_name, u.avatar_url
         FROM friendships f
         LEFT JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
         WHERE f.user_a = ? OR f.user_b = ?'
    );
    $stmt->execute([$appUserId, $appUserId, $appUserId]);
    foreach ($stmt->fetchAll() as $row) {
        $friendId = normalizeId($row['id'] ?? '');
        if ($friendId === '') continue;
        $friends[] = [
            'id' => $friendId,
            'name' => normalizeText($row['display_name'] ?? '') !== '' ? normalizeText($row['display_name'] ?? '') : 'Пользователь',
            'avatar' => normalizeText($row['avatar_url'] ?? '')
        ];
    }
    usort($friends, function ($left, $right) {
        return mb_strtolower($left['name']) <=> mb_strtolower($right['name']);
    });

    $incomingRequests = [];
    $outgoingRequests = [];
    $stmt = $pdo->prepare(
        'SELECT fr.id, fr.from_id, fr.to_id, fr.created_at, u.display_name, u.avatar_url
         FROM friend_requests fr
         LEFT JOIN users u ON u.id = CASE WHEN fr.to_id = ? THEN fr.from_id ELSE fr.to_id END
         WHERE fr.status = \'pending\' AND (fr.from_id = ? OR fr.to_id = ?)'
    );
    $stmt->execute([$appUserId, $appUserId, $appUserId]);
    foreach ($stmt->fetchAll() as $row) {
        $from = normalizeId($row['from_id'] ?? '');
        $to = normalizeId($row['to_id'] ?? '');
        if ($to === $appUserId) {
            $incomingRequests[] = [
                'requestId' => normalizeId($row['id'] ?? ''),
                'fromId' => $from,
                'name' => normalizeText($row['display_name'] ?? '') !== '' ? normalizeText($row['display_name'] ?? '') : 'Пользователь',
                'avatar' => normalizeText($row['avatar_url'] ?? ''),
                'createdAt' => (int)($row['created_at'] ?? nowTs())
            ];
        } elseif ($from === $appUserId) {
            $outgoingRequests[] = [
                'requestId' => normalizeId($row['id'] ?? ''),
                'toId' => $to,
                'name' => normalizeText($row['display_name'] ?? '') !== '' ? normalizeText($row['display_name'] ?? '') : 'Пользователь',
                'avatar' => normalizeText($row['avatar_url'] ?? ''),
                'createdAt' => (int)($row['created_at'] ?? nowTs())
            ];
        }
    }
    usort($incomingRequests, function ($left, $right) {
        return ($right['createdAt'] ?? 0) <=> ($left['createdAt'] ?? 0);
    });
    usort($outgoingRequests, function ($left, $right) {
        return ($right['createdAt'] ?? 0) <=> ($left['createdAt'] ?? 0);
    });

    $incomingCalls = [];
    $outgoingCalls = [];
    $stmt = $pdo->prepare(
        'SELECT ci.id, ci.from_id, ci.to_id, ci.room_id, ci.status, ci.created_at, ci.updated_at, u.display_name, u.avatar_url
         FROM call_invites ci
         LEFT JOIN users u ON u.id = CASE WHEN ci.to_id = ? THEN ci.from_id ELSE ci.to_id END
         WHERE ci.from_id = ? OR ci.to_id = ?'
    );
    $stmt->execute([$appUserId, $appUserId, $appUserId]);
    foreach ($stmt->fetchAll() as $row) {
        $from = normalizeId($row['from_id'] ?? '');
        $to = normalizeId($row['to_id'] ?? '');
        $status = normalizeText($row['status'] ?? '');
        if ($to === $appUserId && $status === 'pending') {
            $incomingCalls[] = [
                'inviteId' => normalizeId($row['id'] ?? ''),
                'fromId' => $from,
                'fromName' => normalizeText($row['display_name'] ?? '') !== '' ? normalizeText($row['display_name'] ?? '') : 'Пользователь',
                'fromAvatar' => normalizeText($row['avatar_url'] ?? ''),
                'roomId' => normalizeText($row['room_id'] ?? ''),
                'createdAt' => (int)($row['created_at'] ?? nowTs())
            ];
        }
        if ($from === $appUserId && $status !== 'pending') {
            $outgoingCalls[] = [
                'inviteId' => normalizeId($row['id'] ?? ''),
                'toId' => $to,
                'toName' => normalizeText($row['display_name'] ?? '') !== '' ? normalizeText($row['display_name'] ?? '') : 'Пользователь',
                'status' => $status,
                'roomId' => normalizeText($row['room_id'] ?? ''),
                'updatedAt' => (int)($row['updated_at'] ?? nowTs())
            ];
        }
    }
    usort($incomingCalls, function ($left, $right) {
        return ($right['createdAt'] ?? 0) <=> ($left['createdAt'] ?? 0);
    });
    usort($outgoingCalls, function ($left, $right) {
        return ($right['updatedAt'] ?? 0) <=> ($left['updatedAt'] ?? 0);
    });
    $outgoingCalls = array_slice($outgoingCalls, 0, 30);

    return [
        'self' => pgGetUserRow($pdo, $appUserId),
        'friends' => $friends,
        'incomingRequests' => $incomingRequests,
        'outgoingRequests' => $outgoingRequests,
        'incomingCalls' => $incomingCalls,
        'outgoingCalls' => $outgoingCalls
    ];
}

// ===================== Обработка запросов =====================

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = [];
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = [];
}
$source = $method === 'POST' ? $body : $_GET;
$action = normalizeText($source['action'] ?? '');

if ($action === '') {
    friendsResponse(false, null, 'Action required');
}

$pdo = friendsPg();

if ($action === 'register') {
    $appUserId = normalizeId($source['app_user_id'] ?? '');
    $name = normalizeText($source['name'] ?? '');
    $avatar = normalizeText($source['avatar'] ?? '');
    $username = normalizeText($source['username'] ?? '');
    $externalKey = normalizeExternalKey($source['external_key'] ?? '');
    $identityKeys = normalizeIdentityKeys($source['identity_keys'] ?? [], $externalKey);
    $previousAppUserId = normalizeId($source['previous_app_user_id'] ?? '');
    $activeTab = normalizeBoolFlag($source['active_tab'] ?? false, false);
    if ($appUserId === '') {
        friendsResponse(false, null, 'app_user_id required');
    }
    $mappedIdentityId = pgResolveMappedUserIdByIdentity($pdo, $identityKeys);
    if ($mappedIdentityId !== '' && $mappedIdentityId !== $appUserId) {
        pgRemapUser($pdo, $appUserId, $mappedIdentityId);
        if ($previousAppUserId !== '' && $previousAppUserId !== $mappedIdentityId) {
            pgRemapUser($pdo, $previousAppUserId, $mappedIdentityId);
        }
        $appUserId = $mappedIdentityId;
    } elseif ($mappedIdentityId === '') {
        $primaryIdentityKey = pickPrimaryIdentityKey($identityKeys);
        $generatedCanonicalId = buildCanonicalUserIdFromIdentityKey($primaryIdentityKey);
        if ($generatedCanonicalId !== '' && $generatedCanonicalId !== $appUserId) {
            pgRemapUser($pdo, $appUserId, $generatedCanonicalId);
            if ($previousAppUserId !== '' && $previousAppUserId !== $generatedCanonicalId) {
                pgRemapUser($pdo, $previousAppUserId, $generatedCanonicalId);
            }
            $appUserId = $generatedCanonicalId;
        }
    }
    if ($externalKey !== '') {
        $existingId = pgFindUserIdByExternalKey($pdo, $externalKey);
        if ($existingId !== '' && $existingId !== $appUserId) {
            pgRemapUser($pdo, $appUserId, $existingId);
            if ($previousAppUserId !== '' && $previousAppUserId !== $existingId) {
                pgRemapUser($pdo, $previousAppUserId, $existingId);
            }
            $appUserId = $existingId;
        }
    } elseif ($previousAppUserId !== '' && $previousAppUserId !== $appUserId) {
        pgRemapUser($pdo, $previousAppUserId, $appUserId);
    }
    $user = pgUpsertUser($pdo, $appUserId, $name, $avatar, $externalKey, $username);
    $effectiveAppUserId = normalizeId($user['id'] ?? $appUserId);
    pgBindIdentityKeysToUser($pdo, $effectiveAppUserId, $identityKeys);
    pgTouchUserPresence($pdo, $effectiveAppUserId, $activeTab);
    friendsResponse(true, ['user' => $user, 'appUserId' => $effectiveAppUserId]);
}

$appUserId = normalizeId($source['app_user_id'] ?? '');
$externalKey = normalizeExternalKey($source['external_key'] ?? '');
$identityKeys = normalizeIdentityKeys($source['identity_keys'] ?? [], $externalKey);
if ($appUserId === '') {
    friendsResponse(false, null, 'app_user_id required');
}
$mappedIdentityId = pgResolveMappedUserIdByIdentity($pdo, $identityKeys);
if ($mappedIdentityId !== '' && $mappedIdentityId !== $appUserId) {
    pgRemapUser($pdo, $appUserId, $mappedIdentityId);
    $appUserId = $mappedIdentityId;
} elseif ($mappedIdentityId === '') {
    $primaryIdentityKey = pickPrimaryIdentityKey($identityKeys);
    $generatedCanonicalId = buildCanonicalUserIdFromIdentityKey($primaryIdentityKey);
    if ($generatedCanonicalId !== '' && $generatedCanonicalId !== $appUserId) {
        pgRemapUser($pdo, $appUserId, $generatedCanonicalId);
        $appUserId = $generatedCanonicalId;
    }
}
if ($externalKey !== '') {
    $existingId = pgFindUserIdByExternalKey($pdo, $externalKey);
    if ($existingId !== '' && $existingId !== $appUserId) {
        pgRemapUser($pdo, $appUserId, $existingId);
        $appUserId = $existingId;
    }
}
if (!pgUserExists($pdo, $appUserId)) {
    pgUpsertUser(
        $pdo,
        $appUserId,
        normalizeText($source['name'] ?? 'Пользователь'),
        normalizeText($source['avatar'] ?? ''),
        $externalKey,
        normalizeText($source['username'] ?? '')
    );
}
pgBindIdentityKeysToUser($pdo, $appUserId, $identityKeys);
$activeTab = normalizeBoolFlag($source['active_tab'] ?? false, false);
pgTouchUserPresence($pdo, $appUserId, $activeTab);

if ($action === 'state') {
    friendsResponse(true, pgBuildState($pdo, $appUserId));
}

if ($action === 'push_config') {
    $keys = pgGetVapidKeys($pdo);
    if (normalizeText($keys['public_key'] ?? '') === '') {
        friendsResponse(false, null, 'Push keys unavailable');
    }
    friendsResponse(true, ['publicKey' => $keys['public_key']]);
}

if ($action === 'save_push_subscription') {
    $subscription = $source['subscription'] ?? null;
    $saved = pgStorePushSubscription($pdo, $appUserId, is_array($subscription) ? $subscription : []);
    if (!$saved) {
        friendsResponse(false, null, 'Некорректная push подписка');
    }
    friendsResponse(true, ['saved' => true]);
}

if ($action === 'search') {
    $query = mb_strtolower(normalizeText($source['query'] ?? ''));
    if ($query === '') {
        friendsResponse(true, ['results' => []]);
    }
    $stmt = $pdo->prepare(
        'SELECT id, display_name, avatar_url, username, external_key
         FROM users
         WHERE id <> ?
           AND (LOWER(id) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(username) LIKE ?)
         ORDER BY LOWER(display_name)
         LIMIT 200'
    );
    $like = '%' . $query . '%';
    $stmt->execute([$appUserId, $like, $like, $like]);
    $results = [];
    $seenIdentity = [];
    foreach ($stmt->fetchAll() as $row) {
        $candidateId = normalizeId($row['id'] ?? '');
        if ($candidateId === '') continue;
        $identityKey = normalizeExternalKey($row['external_key'] ?? '');
        $dedupeKey = $identityKey !== '' ? $identityKey : ('id:' . mb_strtolower($candidateId));
        if (isset($seenIdentity[$dedupeKey])) continue;
        $candidateName = normalizeText($row['display_name'] ?? '');
        $candidateUsername = normalizeText($row['username'] ?? '');
        $seenIdentity[$dedupeKey] = true;

        $incomingPending = false;
        $outgoingPending = false;
        $reqStmt = $pdo->prepare(
            'SELECT from_id, to_id FROM friend_requests WHERE status = \'pending\'
             AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) LIMIT 1'
        );
        $reqStmt->execute([$appUserId, $candidateId, $candidateId, $appUserId]);
        $reqRow = $reqStmt->fetch();
        if (is_array($reqRow)) {
            if (normalizeId($reqRow['from_id'] ?? '') === $appUserId) {
                $outgoingPending = true;
            } else {
                $incomingPending = true;
            }
        }

        $results[] = [
            'id' => $candidateId,
            'name' => $candidateName !== '' ? $candidateName : 'Пользователь',
            'username' => $candidateUsername,
            'avatar' => normalizeText($row['avatar_url'] ?? ''),
            'isFriend' => pgIsFriends($pdo, $appUserId, $candidateId),
            'incomingPending' => $incomingPending,
            'outgoingPending' => $outgoingPending
        ];
        if (count($results) >= 40) break;
    }
    friendsResponse(true, ['results' => $results]);
}

if ($action === 'send_request') {
    $targetId = normalizeId($source['target_id'] ?? '');
    if ($targetId === '' || $targetId === $appUserId) {
        friendsResponse(false, null, 'Некорректный target_id');
    }
    if (!pgUserExists($pdo, $targetId)) {
        friendsResponse(false, null, 'Пользователь не найден');
    }
    if (pgIsFriends($pdo, $appUserId, $targetId)) {
        friendsResponse(false, null, 'Уже в друзьях');
    }
    $stmt = $pdo->prepare(
        'SELECT id, from_id FROM friend_requests
         WHERE status = \'pending\'
           AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
         LIMIT 1'
    );
    $stmt->execute([$appUserId, $targetId, $targetId, $appUserId]);
    $existing = $stmt->fetch();
    if (is_array($existing)) {
        if (normalizeId($existing['from_id'] ?? '') === $appUserId) {
            friendsResponse(true, ['status' => 'already_pending']);
        }
        $update = $pdo->prepare('UPDATE friend_requests SET status = \'accepted\', updated_at = ? WHERE id = ?');
        $update->execute([nowTs(), normalizeId($existing['id'] ?? '')]);
        pgCreateFriendship($pdo, $appUserId, $targetId);
        friendsResponse(true, ['status' => 'auto_accepted']);
    }
    $requestId = 'fr_' . substr(md5($appUserId . '|' . $targetId . '|' . microtime(true)), 0, 16);
    $now = nowTs();
    $insert = $pdo->prepare(
        'INSERT INTO friend_requests (id, from_id, to_id, status, created_at, updated_at) VALUES (?,?,?,\'pending\',?,?)'
    );
    $insert->execute([$requestId, $appUserId, $targetId, $now, $now]);
    friendsResponse(true, ['status' => 'sent']);
}

if ($action === 'respond_request') {
    $requestId = normalizeId($source['request_id'] ?? '');
    $decision = normalizeText($source['decision'] ?? '');
    if ($requestId === '' || !in_array($decision, ['accept', 'decline'], true)) {
        friendsResponse(false, null, 'Некорректные параметры');
    }
    $stmt = $pdo->prepare('SELECT id, from_id, to_id, status FROM friend_requests WHERE id = ? LIMIT 1');
    $stmt->execute([$requestId]);
    $request = $stmt->fetch();
    if (!is_array($request)) {
        friendsResponse(false, null, 'Заявка не найдена');
    }
    if (normalizeId($request['to_id'] ?? '') !== $appUserId) {
        friendsResponse(false, null, 'Нет прав на обработку заявки');
    }
    if (normalizeText($request['status'] ?? '') !== 'pending') {
        friendsResponse(true, ['status' => 'already_processed']);
    }
    $nextStatus = $decision === 'accept' ? 'accepted' : 'declined';
    $update = $pdo->prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?');
    $update->execute([$nextStatus, nowTs(), $requestId]);
    if ($decision === 'accept') {
        pgCreateFriendship($pdo, normalizeId($request['from_id'] ?? ''), $appUserId);
    }
    friendsResponse(true, ['status' => $nextStatus]);
}

if ($action === 'remove_friend') {
    $friendId = normalizeId($source['friend_id'] ?? '');
    if ($friendId === '') {
        friendsResponse(false, null, 'friend_id required');
    }
    pgRemoveFriendship($pdo, $appUserId, $friendId);
    $stmt = $pdo->prepare(
        'UPDATE friend_requests SET status = \'declined\', updated_at = ?
         WHERE status = \'pending\'
           AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))'
    );
    $stmt->execute([nowTs(), $appUserId, $friendId, $friendId, $appUserId]);
    friendsResponse(true, ['removed' => true]);
}

if ($action === 'send_call_invite') {
    $targetId = normalizeId($source['target_id'] ?? '');
    $roomId = normalizeText($source['room_id'] ?? '');
    if ($targetId === '' || $roomId === '') {
        friendsResponse(false, null, 'Некорректные параметры звонка');
    }
    if (!pgIsFriends($pdo, $appUserId, $targetId)) {
        friendsResponse(false, null, 'Звонок доступен только друзьям');
    }
    $cancel = $pdo->prepare(
        'UPDATE call_invites SET status = \'cancelled\', updated_at = ?
         WHERE from_id = ? AND to_id = ? AND status = \'pending\''
    );
    $cancel->execute([nowTs(), $appUserId, $targetId]);
    $inviteId = 'call_' . substr(md5($appUserId . '|' . $targetId . '|' . microtime(true)), 0, 16);
    $now = nowTs();
    $insert = $pdo->prepare(
        'INSERT INTO call_invites (id, from_id, to_id, room_id, status, created_at, updated_at) VALUES (?,?,?,?,\'pending\',?,?)'
    );
    $insert->execute([$inviteId, $appUserId, $targetId, $roomId, $now, $now]);
    pgNotifyIncomingCall($pdo, $targetId);
    friendsResponse(true, ['inviteId' => $inviteId]);
}

if ($action === 'respond_call_invite') {
    $inviteId = normalizeId($source['invite_id'] ?? '');
    $decision = normalizeText($source['decision'] ?? '');
    if ($inviteId === '' || !in_array($decision, ['answer', 'decline'], true)) {
        friendsResponse(false, null, 'Некорректные параметры');
    }
    $stmt = $pdo->prepare('SELECT id, to_id, room_id, status FROM call_invites WHERE id = ? LIMIT 1');
    $stmt->execute([$inviteId]);
    $invite = $stmt->fetch();
    if (!is_array($invite)) {
        friendsResponse(false, null, 'Приглашение не найдено');
    }
    if (normalizeId($invite['to_id'] ?? '') !== $appUserId) {
        friendsResponse(false, null, 'Нет прав на обработку звонка');
    }
    if (normalizeText($invite['status'] ?? '') !== 'pending') {
        friendsResponse(true, ['status' => normalizeText($invite['status'] ?? ''), 'roomId' => normalizeText($invite['room_id'] ?? '')]);
    }
    $nextStatus = $decision === 'answer' ? 'accepted' : 'declined';
    $update = $pdo->prepare('UPDATE call_invites SET status = ?, updated_at = ? WHERE id = ?');
    $update->execute([$nextStatus, nowTs(), $inviteId]);
    friendsResponse(true, ['status' => $nextStatus, 'roomId' => normalizeText($invite['room_id'] ?? '')]);
}

if ($action === 'cancel_call_invite') {
    $inviteId = normalizeId($source['invite_id'] ?? '');
    if ($inviteId === '') {
        friendsResponse(false, null, 'invite_id required');
    }
    $stmt = $pdo->prepare('SELECT id, from_id, status FROM call_invites WHERE id = ? LIMIT 1');
    $stmt->execute([$inviteId]);
    $invite = $stmt->fetch();
    if (!is_array($invite)) {
        friendsResponse(false, null, 'Приглашение не найдено');
    }
    if (normalizeId($invite['from_id'] ?? '') !== $appUserId) {
        friendsResponse(false, null, 'Нет прав на отмену звонка');
    }
    if (normalizeText($invite['status'] ?? '') !== 'pending') {
        friendsResponse(true, ['status' => normalizeText($invite['status'] ?? '')]);
    }
    $update = $pdo->prepare('UPDATE call_invites SET status = \'cancelled\', updated_at = ? WHERE id = ?');
    $update->execute([nowTs(), $inviteId]);
    friendsResponse(true, ['status' => 'cancelled']);
}

friendsResponse(false, null, 'Unknown action');
