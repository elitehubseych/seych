<?php
/**
 * Серверная проверка подписи Telegram-авторизации.
 *
 * Поддерживаются два режима:
 *  - widget:  данные от Telegram Login Widget (user с полем hash/auth_date);
 *  - webapp:  сырой initData из Telegram Mini App (Telegram.WebApp.initData).
 *
 * Токен бота берётся из переменной окружения TELEGRAM_BOT_TOKEN
 * (в продакшне — секрет платформы, НЕ хардкодить в коде).
 */

header('Content-Type: application/json; charset=utf-8');

$corsOrigin = getenv('CORS_ORIGIN');
if ($corsOrigin !== false && trim((string)$corsOrigin) !== '') {
    header('Access-Control-Allow-Origin: ' . trim((string)$corsOrigin));
    header('Vary: Origin');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

function taOut($success, $error = null, $user = null) {
    echo json_encode([
        'success' => (bool)$success,
        'error' => $error,
        'user' => $user
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

$botToken = getenv('TELEGRAM_BOT_TOKEN');
if ($botToken === false || trim((string)$botToken) === '') {
    taOut(false, 'TELEGRAM_BOT_TOKEN not configured');
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    taOut(false, 'Invalid request body');
}

$authType = isset($input['auth_type']) ? trim((string)$input['auth_type']) : '';

/**
 * Собирает data_check_string: отсортированные по ключу пары "k=v", разделённые "\n".
 */
function taBuildDataCheckString(array $fields): string {
    ksort($fields, SORT_STRING);
    $parts = [];
    foreach ($fields as $key => $value) {
        $parts[] = $key . '=' . $value;
    }
    return implode("\n", $parts);
}

/**
 * Проверяет, что подпись совпадает и auth_date свежий.
 */
function taVerifyHash(string $dataCheckString, string $expectedHash, string $secretKey, int $authDate): bool {
    if ($expectedHash === '') return false;
    $computed = hash_hmac('sha256', $dataCheckString, $secretKey);
    if (!hash_equals($computed, $expectedHash)) return false;
    if (abs(time() - $authDate) > 86400) return false; // не старше 24 часов
    return true;
}

/**
 * Возвращает безопасный профиль пользователя.
 */
function taSanitizeUser(array $raw): array {
    $id = isset($raw['id']) ? (string)$raw['id'] : '';
    if ($id === '' || !ctype_digit($id)) return [];
    return [
        'id' => $id,
        'first_name' => isset($raw['first_name']) ? (string)$raw['first_name'] : '',
        'last_name' => isset($raw['last_name']) ? (string)$raw['last_name'] : '',
        'username' => isset($raw['username']) ? (string)$raw['username'] : '',
        'photo_url' => isset($raw['photo_url']) ? (string)$raw['photo_url'] : '',
        'auth_date' => isset($raw['auth_date']) ? (int)$raw['auth_date'] : 0
    ];
}

if ($authType === 'widget') {
    $user = isset($input['user']) && is_array($input['user']) ? $input['user'] : null;
    if (!$user) {
        taOut(false, 'Invalid user payload');
    }
    $fields = [
        'id' => isset($user['id']) ? (string)$user['id'] : '',
        'first_name' => isset($user['first_name']) ? (string)$user['first_name'] : '',
        'last_name' => isset($user['last_name']) ? (string)$user['last_name'] : '',
        'username' => isset($user['username']) ? (string)$user['username'] : '',
        'photo_url' => isset($user['photo_url']) ? (string)$user['photo_url'] : '',
        'auth_date' => isset($user['auth_date']) ? (string)$user['auth_date'] : ''
    ];
    $expectedHash = isset($user['hash']) ? (string)$user['hash'] : '';
    $secretKey = hash('sha256', $botToken, true); // Login Widget: secret = SHA256(token)
    $dataCheckString = taBuildDataCheckString($fields);
    if (!taVerifyHash($dataCheckString, $expectedHash, $secretKey, (int)$fields['auth_date'])) {
        taOut(false, 'Invalid Telegram signature');
    }
    $profile = taSanitizeUser($user);
    if (!$profile) {
        taOut(false, 'Invalid Telegram user');
    }
    taOut(true, null, $profile);
}

if ($authType === 'webapp') {
    $initData = isset($input['init_data']) ? (string)$input['init_data'] : '';
    if ($initData === '') {
        taOut(false, 'init_data required');
    }
    $pairs = [];
    parse_str($initData, $pairs);
    if (!isset($pairs['hash']) || !isset($pairs['auth_date'])) {
        taOut(false, 'init_data missing hash or auth_date');
    }
    $expectedHash = (string)$pairs['hash'];
    unset($pairs['hash']);
    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true); // Mini App: secret = HMAC(token, "WebAppData")
    $dataCheckString = taBuildDataCheckString($pairs);
    if (!taVerifyHash($dataCheckString, $expectedHash, $secretKey, (int)$pairs['auth_date'])) {
        taOut(false, 'Invalid Telegram signature');
    }
    $rawUser = isset($pairs['user']) ? json_decode((string)$pairs['user'], true) : null;
    if (!is_array($rawUser)) {
        taOut(false, 'init_data missing user');
    }
    $profile = taSanitizeUser($rawUser);
    if (!$profile) {
        taOut(false, 'Invalid Telegram user');
    }
    taOut(true, null, $profile);
}

taOut(false, 'Unsupported auth_type');
