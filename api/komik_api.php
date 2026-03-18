<?php
/**
 * KOMIK_API.PHP — Proxy ke ngrok /komik
 * Endpoint: /komik?action=populer&page=1
 *           /komik?action=search&q=naruto
 *           /komik?action=detail&detailManga={slug}
 *           /komik?action=baca&bacaManga={slug}
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

define('BASE_URL', 'https://unstrained-commandingly-arya.ngrok-free.dev/komik');

$TTL = [
    'populer' => 600,
    'search'  => 600,
    'detail'  => 600,
    'baca'    => 600,
];

$params = $_GET;
if (empty($params['action'])) {
    die(json_encode(['status' => 'error', 'message' => 'action wajib diisi']));
}

$action    = $params['action'];
$ttl       = $TTL[$action] ?? 600;
$cacheDir  = '/tmp/cache_komik/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);
$cacheKey  = md5(json_encode($params));
$cacheFile = $cacheDir . $cacheKey . '.json';

// Serve cache jika masih fresh
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $ttl)) {
    echo file_get_contents($cacheFile);
    exit;
}

// Build URL sesuai action
switch ($action) {
    case 'populer':
        $page = (int)($params['page'] ?? 1);
        $url  = BASE_URL . "?action=populer&page=$page";
        break;
    case 'search':
        $q   = $params['q'] ?? '';
        $url = BASE_URL . '?action=search&q=' . urlencode($q);
        break;
    case 'detail':
        $slug = $params['detailManga'] ?? '';
        $url  = BASE_URL . '?action=detail&detailManga=' . urlencode($slug);
        break;
    case 'baca':
        $slug = $params['bacaManga'] ?? '';
        $url  = BASE_URL . '?action=baca&bacaManga=' . urlencode($slug);
        break;
    default:
        die(json_encode(['status' => 'error', 'message' => 'action tidak dikenal']));
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

// Fallback ke stale cache jika gagal
if (!$response || $curlErr || $httpCode !== 200 || ltrim($response)[0] === '<') {
    if (file_exists($cacheFile)) { echo file_get_contents($cacheFile); exit; }
    die(json_encode([
        'status'  => 'error',
        'message' => 'API tidak aktif (HTTP ' . $httpCode . '): ' . $curlErr,
    ]));
}

file_put_contents($cacheFile, $response);
echo $response;
?>
