<?php
/**
 * STREAM.PHP — MovieBox stream/download fetcher
 * Drop-in replacement for FoodCash stream.php — same output format
 * Uses MovieBox /wefeed-h5-bff/web/subject/download endpoint
 */

$debug = isset($_GET['debug']);
if (!$debug) { error_reporting(0); ini_set('display_errors', 0); }
set_time_limit(0);

$videoProxy = "https://proxy.oflix.workers.dev/?url=";

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Range, Origin, X-Requested-With");
header("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Config ────────────────────────────────────────────────────────────────────
define('MB_HOST', 'https://h5.aoneroom.com');
define('MB_API',  MB_HOST . '/wefeed-h5-bff');

$cacheDir = '/tmp/cache_mb/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$cookieFile = '/tmp/mb_cookies.txt';

// ── Params ────────────────────────────────────────────────────────────────────
// Frontend calls: stream.php?id=SUBJECT_ID&season=1&episode=1&detailPath=xxx
$subjectId  = $_GET['id'] ?? '';
$season     = $_GET['season'] ?? '';
$episode    = $_GET['episode'] ?? '';
$detailPath = $_GET['detailPath'] ?? '';

if (!$subjectId) {
    die(json_encode([
        'success' => false,
        'error'   => 'Parameter id (subjectId) diperlukan',
        'hint'    => 'Format: stream.php?id=xxx&season=1&episode=1&detailPath=xxx',
    ]));
}

// ── Cache ─────────────────────────────────────────────────────────────────────
$cacheKey  = md5("mbstream_{$subjectId}_{$season}_{$episode}");
$cacheFile2 = $cacheDir . "stream_" . $cacheKey . ".json";
$cacheTTL  = $debug ? 60 : 600;

if (file_exists($cacheFile2) && (time() - filemtime($cacheFile2) < $cacheTTL)) {
    $cached = file_get_contents($cacheFile2);
    if ($debug) {
        $c = json_decode($cached, true);
        $c['_cached'] = true;
        echo json_encode($c, JSON_PRETTY_PRINT);
    } else {
        echo $cached;
    }
    exit;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mbHeaders($extra = []) {
    return array_merge([
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9,id;q=0.8',
        'X-Client-Info: {"timezone":"Asia/Jakarta"}',
        'Referer: ' . MB_HOST . '/',
        'Origin: ' . MB_HOST,
    ], $extra);
}

function mbGetRaw($url, $params = [], $extraHeaders = []) {
    global $cookieFile;
    if ($params) $url .= '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_HTTPHEADER     => mbHeaders($extraHeaders),
        CURLOPT_COOKIEJAR      => $cookieFile,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_ENCODING       => '',
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return ['body' => $res, 'code' => $code, 'error' => $err];
}

// Ensure cookies
function ensureCookies() {
    global $cookieFile;
    if (file_exists($cookieFile) && (time() - filemtime($cookieFile) < 1800)) return;
    mbGetRaw(MB_API . '/app/get-latest-app-pkgs', ['app_name' => 'moviebox']);
}

ensureCookies();

// ── Fetch download info ───────────────────────────────────────────────────────
$refererHeader = 'Referer: ' . MB_HOST . '/movies/' . $detailPath;

$params = [
    'subjectId' => $subjectId,
    'se'        => $season ?: 0,
    'ep'        => $episode ?: 0,
];

$dlRes = mbGetRaw(MB_API . '/web/subject/download', $params, [$refererHeader]);

// Also try stream endpoint as fallback
$stRes = null;
if (!$dlRes['body'] || $dlRes['code'] !== 200) {
    $stRes = mbGetRaw(MB_API . '/web/subject/play', $params, [$refererHeader]);
}

// Parse response
$dlData = null;
$stData = null;

if ($dlRes['body']) {
    $json = json_decode($dlRes['body'], true);
    if (isset($json['data'])) $dlData = $json['data'];
}

if ($stRes && $stRes['body']) {
    $json = json_decode($stRes['body'], true);
    if (isset($json['data'])) $stData = $json['data'];
}

$source = $dlData ?: $stData;

if (!$source) {
    echo json_encode([
        'success' => false,
        'error'   => 'Failed to fetch stream from MovieBox',
        'dl_code' => $dlRes['code'] ?? 0,
        'dl_err'  => $dlRes['error'] ?? '',
        '_debug'  => $debug ? [
            'dl_body' => substr($dlRes['body'] ?? '', 0, 500),
            'st_body' => $stRes ? substr($stRes['body'] ?? '', 0, 500) : null,
        ] : null,
    ], JSON_PRETTY_PRINT);
    exit;
}

// ── Transform to FoodCash format ──────────────────────────────────────────────
$output = ['success' => true, 'source' => 'moviebox'];

// Downloads array (from /download endpoint)
$downloads = [];
if (isset($source['downloads']) && is_array($source['downloads'])) {
    foreach ($source['downloads'] as $dl) {
        $origUrl = $dl['url'] ?? '';
        if (!$origUrl) continue;
        $downloads[] = [
            'url'        => $videoProxy . urlencode($origUrl),
            'resolution' => $dl['resolution'] ?? $dl['resolutions'] ?? 0,
        ];
    }
}

// Streams array (from /play endpoint)
if (empty($downloads) && isset($source['streams']) && is_array($source['streams'])) {
    foreach ($source['streams'] as $st) {
        $origUrl = $st['url'] ?? '';
        if (!$origUrl) continue;
        $downloads[] = [
            'url'        => $videoProxy . urlencode($origUrl),
            'resolution' => $st['resolutions'] ?? $st['resolution'] ?? 0,
        ];
    }
}

// Sort by resolution desc
usort($downloads, function($a, $b) { return ($b['resolution'] ?? 0) - ($a['resolution'] ?? 0); });

$output['downloads'] = $downloads;

// Main URL (highest quality or first stream)
$mainUrl = '';
if (!empty($downloads)) {
    $mainUrl = $downloads[0]['url'];
}
// Check HLS
if (isset($source['hls']) && is_array($source['hls']) && !empty($source['hls'])) {
    $hlsUrl = $source['hls'][0]['url'] ?? ($source['hls'][0] ?? '');
    if (is_string($hlsUrl) && $hlsUrl) {
        $mainUrl = $videoProxy . urlencode($hlsUrl);
    }
}
$output['url'] = $mainUrl;

// Captions
$captions = [];
if (isset($source['captions']) && is_array($source['captions'])) {
    foreach ($source['captions'] as $cap) {
        $capUrl = $cap['url'] ?? '';
        if (!$capUrl) continue;
        $captions[] = [
            'url'          => $capUrl,
            'languageCode' => $cap['lan'] ?? '',
            'lan'          => $cap['lan'] ?? '',
            'language'     => $cap['lanName'] ?? $cap['lan'] ?? '',
        ];
    }
}
$output['captions'] = $captions;

if ($debug) {
    $output['_debug'] = [
        'subjectId'  => $subjectId,
        'season'     => $season,
        'episode'    => $episode,
        'detailPath' => $detailPath,
        'dl_code'    => $dlRes['code'],
        'raw_keys'   => array_keys($source),
    ];
}

$json = json_encode($output, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | ($debug ? JSON_PRETTY_PRINT : 0));
file_put_contents($cacheFile2, $json);
echo $json;
