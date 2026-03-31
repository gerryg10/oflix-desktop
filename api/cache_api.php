<?php
/**
 * CACHE_API.PHP — Proxy ke Cloudflare Worker (json.oflix.workers.dev)
 * Encrypted response: worker encrypt, PHP decrypt, cache decrypted
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

// ── Cache di /tmp/ ──────────────────────────────────────────────────────────
$cacheDir = '/tmp/cache_json/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$cacheKey  = md5(json_encode($params));
$cacheFile = $cacheDir . $cacheKey . '.json';

$action = $params['action'] ?? '';
$cacheTTL = in_array($action, ['detail']) ? 43200 : 3600;

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheTTL)) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Map action ke worker endpoint ───────────────────────────────────────────
$WORKER = 'https://json.oflix.workers.dev';
// ── ENCRYPTION KEY — GANTI BARENG worker & frontend kalau mau rotate ──
$OE_KEY = 'oFl1x_2026_sEcReT_kEy!@#';

// ── Category → search keyword mapping ────────────────────────────────────────
$categorySearch = [
    'indonesian-movies' => ['keyword' => 'indonesia', 'subjectType' => 1],  // 1=movie
    'indonesian-drama'  => ['keyword' => 'indonesia', 'subjectType' => 2],  // 2=series
    'kdrama'            => ['keyword' => 'korean drama', 'subjectType' => 2],
    'anime'             => ['keyword' => 'anime', 'subjectType' => 2],
    'western-tv'        => ['keyword' => 'american tv series', 'subjectType' => 2],
    'short-tv'          => ['keyword' => 'chinese drama', 'subjectType' => 2],
];

switch ($action) {
    case 'search':
        $q = $params['q'] ?? '';
        $page = $params['page'] ?? 1;
        $workerUrl = $WORKER . '/api/search?keyword=' . urlencode($q) . '&page=' . $page;
        break;
    case 'detail':
        $dp = $params['detailPath'] ?? '';
        $workerUrl = $WORKER . '/api/detail?path=' . urlencode($dp);
        break;
    case 'trending':
    case 'populer':
    case 'latest':
    case 'terbaru':
        $workerUrl = $WORKER . '/api/home';
        break;
    default:
        // Category-specific: use search
        if (isset($categorySearch[$action])) {
            $cat = $categorySearch[$action];
            $page = $params['page'] ?? 1;
            $workerUrl = $WORKER . '/api/search?keyword=' . urlencode($cat['keyword']) 
                       . '&page=' . $page 
                       . '&subjectType=' . $cat['subjectType'];
        } else {
            $workerUrl = $WORKER . '/api/home';
        }
}

// ── Fetch dari Worker (encrypted) ───────────────────────────────────────────
$ch = curl_init($workerUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-OE: 1',
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$response || $httpCode !== 200) {
    die(json_encode(['success' => false, 'error' => 'Worker fetch failed', 'http_code' => $httpCode]));
}

// ── Decrypt jika encrypted ──────────────────────────────────────────────────
$json = $response;
if ($response && $response[0] !== '{' && $response[0] !== '[') {
    $decoded = base64_decode($response);
    if ($decoded !== false) {
        $keyLen = strlen($OE_KEY);
        $decrypted = '';
        for ($i = 0; $i < strlen($decoded); $i++) {
            $decrypted .= chr(ord($decoded[$i]) ^ ord($OE_KEY[$i % $keyLen]));
        }
        $json = $decrypted;
    }
}

// ── Parse & output ──────────────────────────────────────────────────────────
$data = json_decode($json, true);
if (!$data) {
    die(json_encode(['success' => false, 'error' => 'Invalid response']));
}

if ($action === 'detail') {
    $output = json_encode(['success' => true, 'data' => $data['data'] ?? $data]);
} else {
    $items = $data['data'] ?? [];
    $output = json_encode(['success' => true, 'items' => $items]);
}

file_put_contents($cacheFile, $output);
echo $output;
?>
