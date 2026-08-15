<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

function proxyImage() {
    $rawUrl = trim((string)($_GET['url'] ?? ''));
    if ($rawUrl === '') {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'URL required'], JSON_UNESCAPED_UNICODE);
        exit();
    }

    $url = filter_var($rawUrl, FILTER_VALIDATE_URL);
    if (!$url) {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Invalid URL'], JSON_UNESCAPED_UNICODE);
        exit();
    }

    $parts = parse_url($url);
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    $host = strtolower((string)($parts['host'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Unsupported URL'], JSON_UNESCAPED_UNICODE);
        exit();
    }

    $allowedHosts = [
        't.me',
        'telegram.org',
        'googleusercontent.com',
        'ggpht.com',
        'ytimg.com',
        'vk.com',
        'vkuser.net',
        'userapi.com'
    ];
    $hostAllowed = false;
    foreach ($allowedHosts as $allowedHost) {
        if ($host === $allowedHost || substr($host, -strlen('.' . $allowedHost)) === '.' . $allowedHost) {
            $hostAllowed = true;
            break;
        }
    }
    if (!$hostAllowed) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Host not allowed'], JSON_UNESCAPED_UNICODE);
        exit();
    }

    $data = false;
    $contentType = '';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 4);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'SeychCallsAvatarProxy/1.0');
        $data = curl_exec($ch);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
    }
    if ($data === false || $data === null || $data === '') {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 15,
                'header' => "User-Agent: SeychCallsAvatarProxy/1.0\r\n"
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true
            ]
        ]);
        $data = @file_get_contents($url, false, $ctx);
    }
    if ($data === false || $data === null || $data === '') {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Image fetch failed'], JSON_UNESCAPED_UNICODE);
        exit();
    }

    if ($contentType === '' && function_exists('finfo_buffer')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $contentType = (string)finfo_buffer($finfo, $data);
            finfo_close($finfo);
        }
    }
    if (stripos($contentType, 'image/') !== 0) {
        $contentType = 'image/jpeg';
    }

    header('Content-Type: ' . $contentType);
    header('Cache-Control: public, max-age=21600');
    header('X-Content-Type-Options: nosniff');
    echo $data;
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['avatar'])) {
    proxyImage();
}

header('Content-Type: application/json; charset=utf-8');
$input = json_decode(file_get_contents('php://input'), true);
$method = trim((string)($input['method'] ?? ''));
$params = $input['params'] ?? [];
$accessToken = trim((string)($input['access_token'] ?? ''));

$allowed = ['users.get', 'friends.get'];
if ($method === '' || !in_array($method, $allowed, true)) {
    echo json_encode(['success' => false, 'error' => 'Method not allowed'], JSON_UNESCAPED_UNICODE);
    exit();
}
if ($accessToken === '') {
    echo json_encode(['success' => false, 'error' => 'Access token required'], JSON_UNESCAPED_UNICODE);
    exit();
}
if (!is_array($params)) {
    $params = [];
}

$params['access_token'] = $accessToken;
$params['v'] = '5.131';

$query = http_build_query($params);
$url = 'https://api.vk.com/method/' . $method . '?' . $query;

$raw = false;
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    $raw = curl_exec($ch);
    curl_close($ch);
}
if ($raw === false || $raw === null || $raw === '') {
    $raw = @file_get_contents($url);
}
if ($raw === false || $raw === null || $raw === '') {
    echo json_encode(['success' => false, 'error' => 'VK API request failed'], JSON_UNESCAPED_UNICODE);
    exit();
}

$decoded = json_decode($raw, true);
if (!is_array($decoded)) {
    echo json_encode(['success' => false, 'error' => 'VK API invalid response'], JSON_UNESCAPED_UNICODE);
    exit();
}
if (!empty($decoded['error'])) {
    $message = (string)($decoded['error']['error_msg'] ?? 'VK API error');
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit();
}

echo json_encode(['success' => true, 'data' => $decoded['response'] ?? null], JSON_UNESCAPED_UNICODE);
?>
