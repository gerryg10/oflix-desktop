<?php
/**
 * SUBTITLE-PROXY.PHP
 * Fetch .srt langsung dari CDN hakunaymatata (accessible tanpa proxy)
 * Convert SRT → VTT agar bisa dibaca Artplayer sebagai overlay teks
 */

error_reporting(0);
ini_set('display_errors', 0);
set_time_limit(30);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: *");
header("Content-Type: text/vtt; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$srtUrl = isset($_GET['url']) ? urldecode($_GET['url']) : '';

if (empty($srtUrl)) {
    http_response_code(400);
    exit('WEBVTT');
}

// Cache folder
$cacheDir  = '/tmp/cache_json/subtitles/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$cacheKey  = md5($srtUrl);
$cacheFile = $cacheDir . $cacheKey . '.vtt';

// Serve dari cache jika ada (valid 6 jam)
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 600)) { // 10 menit
    readfile($cacheFile);
    exit;
}

// Fetch langsung dari CDN (subtitle CDN accessible, tidak perlu proxy)
$ch = curl_init($srtUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer: https://foodcash.com.br/',
        'Origin: https://foodcash.com.br',
    ],
]);

$srtContent = curl_exec($ch);
$httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200 || empty($srtContent)) {
    // Return empty VTT kalau gagal
    echo "WEBVTT\n\n";
    exit;
}

// =============================================
// Convert SRT → VTT
// =============================================
function srtToVtt(string $srt): string {
    $srt = str_replace(["\r\n", "\r"], "\n", trim($srt));

    // Sudah VTT?
    if (strpos($srt, 'WEBVTT') === 0) return $srt;

    // Ganti timestamp koma → titik: 00:00:01,500 → 00:00:01.500
    $vtt = "WEBVTT\n\n";
    $vtt .= preg_replace('/(\d{2}:\d{2}:\d{2}),(\d{3})/', '$1.$2', $srt);
    return $vtt;
}

$vttContent = srtToVtt($srtContent);

file_put_contents($cacheFile, $vttContent);
echo $vttContent;
exit;
?>
