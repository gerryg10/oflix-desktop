<?php
/**
 * CACHE_API.PHP — MovieBox (themoviebox.org / h5.aoneroom.com) scraper
 * Drop-in replacement for FoodCash proxy — same output format
 * Deploy: Vercel PHP serverless
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Config ────────────────────────────────────────────────────────────────────
define('MB_HOST', 'https://h5.aoneroom.com');
define('MB_API',  MB_HOST . '/wefeed-h5-bff');

$cacheDir = '/tmp/cache_mb/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

$action = $_GET['action'] ?? '';
$page   = max(1, intval($_GET['page'] ?? 1));
$debug  = isset($_GET['debug']);

if (!$action) die(json_encode(['success' => false, 'error' => 'No action']));

// ── Cache ─────────────────────────────────────────────────────────────────────
$cacheKey  = md5(json_encode($_GET));
$cacheFile = $cacheDir . $cacheKey . '.json';
$cacheTTL  = ($action === 'detail') ? 3600 : 600; // detail 1h, list 10min

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheTTL)) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Cookie jar (MovieBox needs cookies from app-info call) ────────────────────
$cookieFile = '/tmp/mb_cookies.txt';

function mbHeaders($extra = []) {
    $h = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9,id;q=0.8',
        'X-Client-Info: {"timezone":"Asia/Jakarta"}',
        'Referer: ' . MB_HOST . '/',
        'Origin: ' . MB_HOST,
    ];
    return array_merge($h, $extra);
}

function mbGet($url, $params = [], $extraHeaders = []) {
    global $cookieFile, $debug, $_lastRaw;
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
    $_lastRaw = ['url' => $url, 'code' => $code, 'error' => $err, 'body_preview' => substr($res ?: '', 0, 1000)];
    if (!$res || $code !== 200) return null;
    $json = json_decode($res, true);
    // MovieBox wraps data in { code, data, msg }
    if (isset($json['data'])) return $json['data'];
    return $json;
}

function mbPost($url, $body = [], $extraHeaders = []) {
    global $cookieFile, $debug, $_lastRaw;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_HTTPHEADER     => mbHeaders(array_merge(['Content-Type: application/json'], $extraHeaders)),
        CURLOPT_COOKIEJAR      => $cookieFile,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_ENCODING       => '',
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    $_lastRaw = ['url' => $url, 'code' => $code, 'error' => $err, 'body_preview' => substr($res ?: '', 0, 1000)];
    if (!$res || $code !== 200) return null;
    $json = json_decode($res, true);
    if (isset($json['data'])) return $json['data'];
    return $json;
}

// Ensure cookies are initialized
function ensureCookies() {
    global $cookieFile;
    // If cookie file fresh enough (< 30 min), skip
    if (file_exists($cookieFile) && (time() - filemtime($cookieFile) < 1800)) return;
    mbGet(MB_API . '/app/get-latest-app-pkgs', ['app_name' => 'moviebox']);
}

ensureCookies();

// ── Helpers: transform MovieBox data → FoodCash format ────────────────────────

function transformItem($item) {
    // Works for search results and homepage content items
    $subject = $item['subject'] ?? $item;
    $cover   = $subject['cover']['url']
            ?? $subject['cover']['thumbnail']
            ?? $item['image']['url']
            ?? $item['image']['thumbnail']
            ?? '';

    return [
        'title'      => $subject['title'] ?? $item['title'] ?? '',
        'poster'     => $cover,
        'detailPath' => $subject['detailPath'] ?? $item['detailPath'] ?? '',
        'year'       => isset($subject['releaseDate']) ? substr($subject['releaseDate'], 0, 4) : '',
        'rating'     => $subject['imdbRatingValue'] ?? $subject['imdbRate'] ?? '',
        'genre'      => $subject['genre'] ?? '',
        'type'       => ($subject['subjectType'] ?? 0) == 2 ? 'series' : 'film',
        'country'    => $subject['countryName'] ?? '',
        'duration'   => $subject['duration'] ?? '',
        'subjectId'  => $subject['subjectId'] ?? $item['subjectId'] ?? '',
    ];
}

function transformHomepageSection($section) {
    $items = [];
    foreach (($section['contents'] ?? []) as $c) {
        $items[] = transformItem($c);
    }
    return $items;
}

// ── Detail: fetch HTML page, extract JSON from <script type="application/json"> ─

function fetchDetail($detailPath) {
    global $cookieFile;
    $url = MB_HOST . '/detail/' . $detailPath;
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_HTTPHEADER     => mbHeaders(),
        CURLOPT_COOKIEJAR      => $cookieFile,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_ENCODING       => '',
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!$html || $code !== 200) return null;

    // Extract JSON from <script type="application/json">...</script>
    if (!preg_match('/<script[^>]+type=["\']application\/json["\'][^>]*>(.*?)<\/script>/si', $html, $m)) {
        return null;
    }

    $rawJson = json_decode($m[1], true);
    if (!is_array($rawJson)) return null;

    // MovieBox uses a compact format: array with indexed references
    // We need to resolve references like the Python extractor does
    return resolveMovieBoxJson($rawJson);
}

function resolveMovieBoxJson($data) {
    // The JSON array uses integer references to other indices
    $extracts = [];

    function resolveValue(&$data, $value) {
        if (is_array($value)) {
            // Check if it's an associative array (dict) or indexed array (list)
            if (array_keys($value) !== range(0, count($value) - 1) && count($value) > 0) {
                // Associative — resolve each value
                $result = [];
                foreach ($value as $k => $v) {
                    if (is_int($v) && isset($data[$v])) {
                        $result[$k] = resolveValue($data, $data[$v]);
                    } else {
                        $result[$k] = resolveValue($data, $v);
                    }
                }
                return $result;
            } else {
                // Indexed array — resolve each element
                $result = [];
                foreach ($value as $v) {
                    if (is_int($v) && isset($data[$v])) {
                        $result[] = resolveValue($data, $data[$v]);
                    } else {
                        $result[] = resolveValue($data, $v);
                    }
                }
                return $result;
            }
        }
        return $value;
    }

    // Find the dict entries that have keys starting with "$s"
    foreach ($data as $entry) {
        if (is_array($entry) && !empty($entry)) {
            $keys = array_keys($entry);
            $hasDollarS = false;
            foreach ($keys as $k) {
                if (is_string($k) && strpos($k, '$s') === 0) { $hasDollarS = true; break; }
            }
            if ($hasDollarS) {
                $resolved = [];
                foreach ($entry as $k => $v) {
                    $cleanKey = (strpos($k, '$s') === 0) ? substr($k, 2) : $k;
                    $resolved[$cleanKey] = resolveValue($data, is_int($v) && isset($data[$v]) ? $data[$v] : $v);
                }
                $extracts = $resolved;
                break;
            }
        }
    }

    return $extracts;
}

function transformDetail($mbData) {
    if (!$mbData || !isset($mbData['resData'])) return null;

    $rd      = $mbData['resData'];
    $subject = $rd['subject'] ?? [];
    $meta    = $rd['metadata'] ?? [];
    $stars   = $rd['stars'] ?? [];
    $res     = $rd['resource'] ?? [];

    // Genre
    $genre = $subject['genre'] ?? '';
    if (is_string($genre)) $genre = array_map('trim', explode(',', $genre));

    // Cast
    $cast = [];
    foreach ($stars as $s) {
        $cast[] = [
            'name'      => $s['name'] ?? '',
            'character' => $s['character'] ?? '',
            'avatar'    => $s['avatarUrl'] ?? '',
        ];
    }

    // Seasons & episodes
    $seasons = [];
    foreach (($res['seasons'] ?? []) as $se) {
        $eps = [];
        $maxEp = $se['maxEp'] ?? 0;
        for ($e = 1; $e <= $maxEp; $e++) {
            // Build playerUrl in FoodCash format so parseFoodcashUrl() works
            $playerUrl = MB_HOST . '/play?id=' . ($subject['subjectId'] ?? '')
                       . '&season=' . ($se['se'] ?? 1)
                       . '&episode=' . $e
                       . '&detailPath=' . ($subject['detailPath'] ?? '');
            $eps[] = [
                'episode'   => $e,
                'title'     => 'Episode ' . $e,
                'playerUrl' => $playerUrl,
                'url'       => $playerUrl,
                'thumbnail' => '',
                'duration'  => '',
            ];
        }
        $seasons[] = [
            'season'   => $se['se'] ?? 1,
            'episodes' => $eps,
        ];
    }

    // Movie playerUrl
    $playerUrl = '';
    if (empty($seasons)) {
        $playerUrl = MB_HOST . '/play?id=' . ($subject['subjectId'] ?? '')
                   . '&season=&episode=&detailPath=' . ($subject['detailPath'] ?? '');
    }

    $cover = $subject['cover']['url'] ?? $subject['cover']['thumbnail'] ?? $meta['image'] ?? '';

    return [
        'title'       => $subject['title'] ?? $meta['title'] ?? '',
        'poster'      => $cover,
        'year'        => isset($subject['releaseDate']) ? substr($subject['releaseDate'], 0, 4) : '',
        'rating'      => $subject['imdbRatingValue'] ?? $subject['imdbRate'] ?? '',
        'genre'       => $genre,
        'description' => $subject['description'] ?? $meta['description'] ?? '',
        'country'     => $subject['countryName'] ?? '',
        'duration'    => $subject['duration'] ?? '',
        'network'     => '',
        'cast'        => $cast,
        'trailerUrl'  => $subject['trailer'] ?? '',
        'playerUrl'   => $playerUrl,
        'sources'     => $playerUrl ? [['url' => $playerUrl]] : [],
        'seasons'     => $seasons,
        'subjectId'   => $subject['subjectId'] ?? '',
    ];
}

// ── Route by action ───────────────────────────────────────────────────────────

$result = null;

switch ($action) {

    // ── Trending / category listings ─────────────────────────────────────────
    case 'trending':
        $home = mbGet(MB_API . '/web/home');
        if ($debug) {
            global $_lastRaw;
            echo json_encode(['_debug_raw' => $_lastRaw, '_home_keys' => $home ? array_keys($home) : null, '_home_preview' => $home ? array_map(function($v) { return is_array($v) ? 'array('.count($v).')' : $v; }, $home) : null], JSON_PRETTY_PRINT);
            exit;
        }
        if ($home) {
            $items = [];
            // Try different response structures
            $sections = $home['sections'] ?? $home['sectionList'] ?? $home['list'] ?? [];
            if (empty($sections) && isset($home[0])) $sections = $home; // might be array directly

            foreach ($sections as $sec) {
                $contents = $sec['contents'] ?? $sec['items'] ?? $sec['subjects'] ?? $sec['list'] ?? [];
                foreach ($contents as $c) {
                    $it = transformItem($c);
                    if ($it['detailPath']) $items[$it['detailPath']] = $it;
                }
            }
            if (!empty($items)) {
                $result = ['success' => true, 'data' => array_values($items)];
            }
        }
        break;

    // ── Category-based search (indonesian-movies, kdrama, anime, etc) ────────
    case 'indonesian-movies':
    case 'indonesian-drama':
    case 'kdrama':
    case 'anime':
    case 'western-tv':
    case 'short-tv':
        // Map action to search keywords
        $kwMap = [
            'indonesian-movies' => 'Indonesia',
            'indonesian-drama'  => 'Indonesia drama',
            'kdrama'            => 'Korean drama',
            'anime'             => 'anime',
            'western-tv'        => 'American series',
            'short-tv'          => 'Chinese drama short',
        ];
        $typeMap = [
            'indonesian-movies' => 1, // movie
            'indonesian-drama'  => 2, // series
            'kdrama'            => 2,
            'anime'             => 2,
            'western-tv'        => 2,
            'short-tv'          => 2,
        ];
        $kw   = $kwMap[$action] ?? $action;
        $type = $typeMap[$action] ?? 0;
        $data = mbPost(MB_API . '/web/subject/search', [
            'keyword'     => $kw,
            'subjectType' => $type,
            'page'        => $page,
            'per_page'    => 24,
        ]);
        if ($data && isset($data['items'])) {
            $items = [];
            foreach ($data['items'] as $it) {
                $items[] = transformItem($it);
            }
            $result = ['success' => true, 'data' => $items];
        }
        break;

    // ── Search ───────────────────────────────────────────────────────────────
    case 'search':
        $q = $_GET['q'] ?? '';
        if (!$q) { $result = ['success' => false, 'error' => 'No query']; break; }
        $data = mbPost(MB_API . '/web/subject/search', [
            'keyword'     => $q,
            'subjectType' => 0, // all
            'page'        => $page,
            'per_page'    => 24,
        ]);
        if ($data && isset($data['items'])) {
            $items = [];
            foreach ($data['items'] as $it) {
                $items[] = transformItem($it);
            }
            $result = ['success' => true, 'data' => $items];
        }
        break;

    // ── Detail ───────────────────────────────────────────────────────────────
    case 'detail':
        $dp = $_GET['detailPath'] ?? '';
        if (!$dp) { $result = ['success' => false, 'error' => 'No detailPath']; break; }
        $mbData = fetchDetail($dp);
        $detail = transformDetail($mbData);
        if ($detail) {
            $result = ['success' => true, 'data' => $detail];
        } else {
            $result = ['success' => false, 'error' => 'Failed to fetch detail from MovieBox'];
        }
        break;

    default:
        $result = ['success' => false, 'error' => 'Unknown action: ' . $action];
}

if (!$result) {
    global $_lastRaw;
    $result = ['success' => false, 'error' => 'No data from MovieBox'];
    if ($debug) $result['_debug'] = $_lastRaw ?? null;
}

$json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
file_put_contents($cacheFile, $json);
echo $json;
