<?php
/**
 * STREAM.PHP — Proxy to MovieBox Cloudflare Worker for stream/download
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Range");
header("Access-Control-Expose-Headers: Content-Range, Content-Length");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── CHANGE THIS to your deployed worker URL ──────────────────────────────────
define('WORKER_URL', 'https://json.oflix.workers.dev');

$subjectId  = $_GET['id'] ?? '';
$season     = $_GET['season'] ?? '0';
$episode    = $_GET['episode'] ?? '0';
$detailPath = $_GET['detailPath'] ?? '';

if (!$subjectId) {
    die(json_encode(['success' => false, 'error' => 'Parameter id diperlukan']));
}

// ── Cache ─────────────────────────────────────────────────────────────────────
$cacheDir  = '/tmp/cache_mb/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);
$cacheKey  = md5("stream_{$subjectId}_{$season}_{$episode}");
$cacheFile = $cacheDir . "stream_" . $cacheKey . ".json";

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 600)) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Fetch from Worker ─────────────────────────────────────────────────────────
$params = http_build_query([
    'subjectId'  => $subjectId,
    'se'         => $season,
    'ep'         => $episode,
    'detailPath' => $detailPath,
]);

$url = WORKER_URL . '/api/play?' . $params;
$ch  = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_ENCODING       => '',
]);
$res  = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$res || $code !== 200) {
    die(json_encode(['success' => false, 'error' => 'Worker fetch failed', 'http_code' => $code]));
}

file_put_contents($cacheFile, $res);
echo $res;
