<?php
/**
 * CACHE_API.PHP — Proxy to MovieBox Cloudflare Worker
 * Worker handles: region routing, cookies, MovieBox API calls
 * This PHP just maps frontend actions → worker endpoints
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── CHANGE THIS to your deployed worker URL ──────────────────────────────────
define('WORKER_URL', 'https://json.oflix.workers.dev');

$action = $_GET['action'] ?? '';
$page   = max(1, intval($_GET['page'] ?? 1));

if (!$action) die(json_encode(['success' => false, 'error' => 'No action']));

// ── Cache ─────────────────────────────────────────────────────────────────────
$cacheDir = '/tmp/cache_mb/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$cacheKey  = md5(json_encode($_GET));
$cacheFile = $cacheDir . $cacheKey . '.json';
$cacheTTL  = ($action === 'detail') ? 3600 : 600;

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheTTL)) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Fetch from Worker ─────────────────────────────────────────────────────────
function workerFetch($path) {
    $url = WORKER_URL . $path;
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
    if (!$res || $code !== 200) return null;
    return json_decode($res, true);
}

// ── Route actions ─────────────────────────────────────────────────────────────
$result = null;

switch ($action) {

    case 'trending':
        $result = workerFetch('/api/home');
        break;

    case 'indonesian-movies':
        $result = workerFetch('/api/search?keyword=Indonesia&subjectType=1&page=' . $page);
        break;
    case 'indonesian-drama':
        $result = workerFetch('/api/search?keyword=Indonesia+drama&subjectType=2&page=' . $page);
        break;
    case 'kdrama':
        $result = workerFetch('/api/search?keyword=Korean+drama&subjectType=2&page=' . $page);
        break;
    case 'anime':
        $result = workerFetch('/api/search?keyword=anime&subjectType=2&page=' . $page);
        break;
    case 'western-tv':
        $result = workerFetch('/api/search?keyword=American+series&subjectType=2&page=' . $page);
        break;
    case 'short-tv':
        $result = workerFetch('/api/search?keyword=Chinese+drama+short&subjectType=2&page=' . $page);
        break;

    case 'search':
        $q = $_GET['q'] ?? '';
        if (!$q) { $result = ['success' => false, 'error' => 'No query']; break; }
        $result = workerFetch('/api/search?keyword=' . urlencode($q) . '&page=' . $page);
        break;

    case 'detail':
        $dp = $_GET['detailPath'] ?? '';
        if (!$dp) { $result = ['success' => false, 'error' => 'No detailPath']; break; }
        $result = workerFetch('/api/detail?path=' . urlencode($dp));
        break;

    default:
        $result = ['success' => false, 'error' => 'Unknown action: ' . $action];
}

if (!$result) {
    $result = ['success' => false, 'error' => 'No data from worker'];
}

$json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
file_put_contents($cacheFile, $json);
echo $json;
