<?php
/**
 * CACHE_API.PHP - FoodCash proxy
 * Modifikasi untuk Vercel: cache di /tmp/
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$params = $_GET;

if (empty($params)) {
    die(json_encode(['success' => false, 'error' => 'No parameters']));
}

// ── Cache di /tmp/ (satu-satunya folder writable di Vercel) ──────────────────
$cacheDir = '/tmp/cache_json/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$cacheKey  = md5(json_encode($params));
$cacheFile = $cacheDir . $cacheKey . '.json';

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 600)) { // 10 menit
    echo file_get_contents($cacheFile);
    exit;
}

// ── Fetch dari FoodCash ──────────────────────────────────────────────────────
$url = 'https://foodcash.com.br/sistema/apiv4/api.php?' . http_build_query($params);

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer: https://foodcash.com.br/',
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$response || $httpCode !== 200) {
    die(json_encode([
        'success'   => false,
        'error'     => 'Failed to fetch from FoodCash',
        'http_code' => $httpCode,
    ]));
}

file_put_contents($cacheFile, $response);
echo $response;
?>
