<?php
/**
 * IMAGE-PROXY.PHP - Proxy gambar dari FoodCash/external
 * Biar gambar ga kena CORS / hotlink block
 */
error_reporting(0);
ini_set('display_errors', 0);

header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=86400');

$url = isset($_GET['url']) ? urldecode($_GET['url']) : '';

if (empty($url) || !filter_var($url, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    exit;
}

// Cache di /tmp/
$cacheDir = '/tmp/img_cache/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);
$cacheFile = $cacheDir . md5($url);

// Serve dari cache (12 jam)
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 43200)) {
    $mime = mime_content_type($cacheFile) ?: 'image/jpeg';
    header('Content-Type: ' . $mime);
    readfile($cacheFile);
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer: https://foodcash.com.br/',
        'Accept: image/webp,image/apng,image/*,*/*;q=0.8',
    ],
]);

$img      = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$mime     = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'image/jpeg';
curl_close($ch);

if (!$img || $httpCode !== 200) {
    http_response_code(404);
    exit;
}

// Simpan cache
file_put_contents($cacheFile, $img);

header('Content-Type: ' . $mime);
echo $img;
?>
