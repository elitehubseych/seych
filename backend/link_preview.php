<?php
/**
 * Прокси для превью ссылок в чате (Open Graph / Twitter / title).
 * Вызывается с фронта: GET ?url=https://...
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$url = isset($_GET['url']) ? trim((string)$_GET['url']) : '';
if ($url === '') {
    echo json_encode(['ok' => false, 'error' => 'empty_url']);
    exit;
}

if (!preg_match('#^https?://#i', $url)) {
    $url = 'https://' . $url;
}

$parts = parse_url($url);
if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
    echo json_encode(['ok' => false, 'error' => 'bad_url']);
    exit;
}

$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') {
    echo json_encode(['ok' => false, 'error' => 'scheme']);
    exit;
}

$host = strtolower($parts['host']);
if ($host === 'localhost' || $host === '0.0.0.0' || substr($host, -6) === '.local') {
    echo json_encode(['ok' => false, 'error' => 'host_blocked']);
    exit;
}

if (filter_var($host, FILTER_VALIDATE_IP)) {
    if (!filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        echo json_encode(['ok' => false, 'error' => 'ip_blocked']);
        exit;
    }
}

function lp_meta_property(string $html, string $prop): string
{
    if (preg_match('/<meta\s[^>]*property=["\']' . preg_quote($prop, '/') . '["\'][^>]*content=["\']([^"\']*)["\']/i', $html, $m)) {
        return html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    if (preg_match('/<meta\s[^>]*content=["\']([^"\']*)["\'][^>]*property=["\']' . preg_quote($prop, '/') . '["\']/i', $html, $m)) {
        return html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    return '';
}

function lp_meta_name(string $html, string $name): string
{
    if (preg_match('/<meta\s[^>]*name=["\']' . preg_quote($name, '/') . '["\'][^>]*content=["\']([^"\']*)["\']/i', $html, $m)) {
        return html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    if (preg_match('/<meta\s[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']' . preg_quote($name, '/') . '["\']/i', $html, $m)) {
        return html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    return '';
}

function lp_absolutize(string $base, string $rel): string
{
    $rel = trim($rel);
    if ($rel === '') return '';
    if (preg_match('#^https?://#i', $rel)) {
        return $rel;
    }
    $p = parse_url($base);
    if (!is_array($p) || empty($p['scheme']) || empty($p['host'])) {
        return $rel;
    }
    $origin = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . (int)$p['port'] : '');
    if (strpos($rel, '//') === 0) {
        return $p['scheme'] . ':' . $rel;
    }
    if ($rel[0] === '/') {
        return $origin . $rel;
    }
    $path = isset($p['path']) ? $p['path'] : '/';
    $dir = preg_match('#/$#', $path) ? $path : (dirname($path) . '/');
    if ($dir === '\\' || $dir === '.') {
        $dir = '/';
    }
    return $origin . $dir . $rel;
}

if (!function_exists('curl_init')) {
    echo json_encode(['ok' => false, 'error' => 'no_curl']);
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; SeychLinkPreview/1.0; +https://seych-call.gt.tc)',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER => [
        'Accept: text/html,application/xhtml+xml',
        'Accept-Language: ru,en;q=0.9',
    ],
]);

$html = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$final = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
curl_close($ch);

if ($html === false || $code < 200 || $code >= 400) {
    echo json_encode(['ok' => false, 'error' => 'fetch_failed', 'code' => $code]);
    exit;
}

$html = substr((string)$html, 0, 600000);

$base = is_string($final) && $final !== '' ? $final : $url;

$title = lp_meta_property($html, 'og:title')
    ?: lp_meta_name($html, 'twitter:title')
    ?: lp_meta_name($html, 'title');
if ($title === '' && preg_match('/<title[^>]*>([^<]{1,500})<\/title>/is', $html, $tm)) {
    $title = trim(html_entity_decode(strip_tags($tm[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}

$description = lp_meta_property($html, 'og:description')
    ?: lp_meta_name($html, 'twitter:description')
    ?: lp_meta_name($html, 'description');

$image = lp_meta_property($html, 'og:image')
    ?: lp_meta_name($html, 'twitter:image')
    ?: lp_meta_name($html, 'twitter:image:src');
if ($image !== '') {
    $image = lp_absolutize($base, $image);
}

echo json_encode([
    'ok' => true,
    'url' => $base,
    'title' => $title !== '' ? $title : $base,
    'description' => $description,
    'image' => $image,
], JSON_UNESCAPED_UNICODE);
