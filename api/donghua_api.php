<?php
/**
 * DONGHUA_API.PHP — Proxy ke ngrok /anichin
 * Endpoint: /anichin?action=populer&page=1
 *           /anichin?action=search&q=Tales&page=1
 *           /anichin?action=detail&path={slug}
 *           /anichin?action=play&ep={episode-slug}
 */

error_reporting(0);
ini_set('display_errors', 0);
set_time_limit(30);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Content-Type: application/json");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

define('BASE_URL', 'https://unstrained-commandingly-arya.ngrok-free.dev/anichin');

$TTL = [
    'populer' => 600,
    'search'  => 600,
    'detail'  => 3600,
    'play'    => 1800,
];

$action = $_GET['action'] ?? '';
$page   = (int)($_GET['page'] ?? 1);
$q      = $_GET['q']      ?? '';
$slug   = $_GET['slug']   ?? '';   // untuk detail
$ep     = $_GET['ep']     ?? '';   // untuk play

if (!$action) {
    die(json_encode(['success' => false, 'error' => 'action wajib diisi']));
}

$ttl       = $TTL[$action] ?? 600;
$cacheDir  = '/tmp/cache_donghua/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);
$cacheKey  = md5(json_encode($_GET));
$cacheFile = $cacheDir . $cacheKey . '.json';

// Serve cache
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $ttl)) {
    echo file_get_contents($cacheFile);
    exit;
}

// Build URL
switch ($action) {
    case 'populer':
        $url = BASE_URL . "?action=populer&page=$page";
        break;
    case 'search':
        $url = BASE_URL . '?action=search&q=' . urlencode($q) . "&page=$page";
        break;
    case 'detail':
        $url = BASE_URL . '?action=detail&path=' . urlencode($slug);
        break;
    case 'play':
        $url = BASE_URL . '?action=play&ep=' . urlencode($ep);
        break;
    default:
        die(json_encode(['success' => false, 'error' => 'action tidak dikenal: ' . $action]));
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
        'User-Agent: Mozilla/5.0',
        'Accept: application/json',
        'ngrok-skip-browser-warning: true',
    ],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if (!$response || $curlErr || $httpCode !== 200 || ltrim($response)[0] === '<') {
    if (file_exists($cacheFile)) { echo file_get_contents($cacheFile); exit; }
    die(json_encode([
        'success' => false,
        'error'   => 'API tidak aktif (HTTP ' . $httpCode . '): ' . $curlErr,
    ]));
}

file_put_contents($cacheFile, $response);
echo $response;
?>
