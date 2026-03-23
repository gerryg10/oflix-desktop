<?php
/**
 * DONGHUA_STREAM.PHP — Extract & proxy m3u8 from Anichin (Vercel PHP)
 * =====================================================================
 * Direct scraping, no Python/ngrok. Uses cf_clearance from env var.
 * 
 * Modes:
 *   ?ep={slug}           → JSON { streamUrl, proxiedUrl, ... }
 *   ?ep={slug}&play=1    → Return proxied m3u8 langsung
 *   ?proxy_m3u8=URL      → Proxy m3u8 + rewrite segments
 *   ?proxy_seg=URL       → Proxy .ts segment
 */

error_reporting(0);
ini_set('display_errors', 0);
set_time_limit(60);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Range");
header("Access-Control-Expose-Headers: Content-Range, Content-Length");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Config ────────────────────────────────────────────────────────────────────
define('ANICHIN_BASE', 'https://anichin.watch');
define('CF_COOKIE', getenv('ANICHIN_CF_CLEARANCE') ?: '');
define('UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
define('ANICHIN_STREAM_BASE', 'https://anichin.stream');
define('ANICHIN_REFERER', 'https://anichin.stream/');
define('CF_PROXY', 'https://proxy-anichin.oflix.workers.dev');

$cacheDir = '/tmp/cache_donghua_stream/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

// ── Router ────────────────────────────────────────────────────────────────────
$ep        = $_GET['ep']         ?? '';
$play      = $_GET['play']       ?? '';
$proxyM3u8 = $_GET['proxy_m3u8'] ?? '';
$proxySeg  = $_GET['proxy_seg']  ?? '';

if ($proxySeg)  { proxySegment($proxySeg); exit; }
if ($proxyM3u8) { proxyM3u8Rewrite($proxyM3u8); exit; }

if (!$ep) {
    header("Content-Type: application/json");
    die(json_encode(['error' => 'Parameter ep wajib diisi', 'usage' => '?ep={episode-slug}']));
}

$streamData = extractStream($ep);

if ($play && ($streamData['streamUrl'] ?? false)) {
    $m3u8 = $streamData['streamUrl'];
    if (strpos($m3u8, '.m3u8') !== false) {
        proxyM3u8Rewrite($m3u8);
    } else {
        header("Location: " . $m3u8);
    }
    exit;
}

header("Content-Type: application/json");
echo json_encode($streamData, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
exit;


// ═══════════════════════════════════════════════════════════════════════════════
//  EXTRACT STREAM
// ═══════════════════════════════════════════════════════════════════════════════

function extractStream($epSlug) {
    global $cacheDir;

    $cacheKey  = md5("stream_" . $epSlug);
    $cacheFile = $cacheDir . $cacheKey . '.json';

    // Cache 30 hari
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 2592000)) {
        return json_decode(file_get_contents($cacheFile), true);
    }

    // Step 1: Fetch episode page from anichin directly (with cf_clearance)
    $url  = ANICHIN_BASE . "/{$epSlug}/";
    $html = anichinFetch($url);

    if (!$html) {
        return ['success' => false, 'error' => 'Gagal fetch episode page (CF block?)', 'episode' => $epSlug];
    }

    // Step 2: Extract player/embed URL
    $playerUrl = '';

    if (preg_match('/class="video-content".*?<iframe[^>]+(?:data-src|src)="([^"]+)"/s', $html, $m)) {
        $playerUrl = $m[1];
    }
    if (!$playerUrl && preg_match('/<iframe[^>]+(?:data-src|src)="([^"]+)"/i', $html, $m)) {
        if (strpos($m[1], 'about:blank') === false) $playerUrl = $m[1];
    }
    if (!$playerUrl && preg_match('/(?:src|url|file)\s*[:=]\s*["\']([^"\']+(?:embed|player|video)[^"\']*)["\']/', $html, $m)) {
        $playerUrl = $m[1];
    }

    if (!$playerUrl) {
        return ['success' => false, 'error' => 'playerUrl not found', 'episode' => $epSlug];
    }

    // Step 3: Extract based on player type
    $result = null;

    if (strpos($playerUrl, 'anichin.stream') !== false || strpos($playerUrl, 'anichin.club') !== false) {
        $result = extractAnichinStream($playerUrl);
    } elseif (strpos($playerUrl, 'ok.ru') !== false || strpos($playerUrl, 'odnoklassniki') !== false) {
        $result = extractOkRu($playerUrl);
    } else {
        $result = extractGeneric($playerUrl);
    }

    if (!$result) {
        $result = ['playerUrl' => $playerUrl, 'error' => 'Could not extract stream'];
    }

    // Build proxied URL via CF Worker
    if (isset($result['streamUrl']) && ($result['streamType'] ?? '') === 'm3u8') {
        $result['proxiedUrl'] = CF_PROXY . '/?url=' . urlencode($result['streamUrl']);
        // Also self-proxy fallback
        $selfBase = "https://" . $_SERVER['HTTP_HOST'] . $_SERVER['SCRIPT_NAME'];
        $result['selfProxiedUrl'] = $selfBase . '?proxy_m3u8=' . urlencode($result['streamUrl']);
    }

    $result['success'] = true;
    $result['episode'] = $epSlug;

    file_put_contents($cacheFile, json_encode($result));
    return $result;
}


function extractAnichinStream($url) {
    $parsed = parse_url($url);
    parse_str($parsed['query'] ?? '', $params);
    $videoId = $params['id'] ?? '';
    if (!$videoId && preg_match('/[?&]id=([^&]+)/', $url, $m)) $videoId = $m[1];

    $base = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? 'anichin.stream');

    if ($videoId) {
        return [
            'playerUrl'  => $url,
            'streamUrl'  => $base . '/hls/' . $videoId . '.m3u8',
            'streamType' => 'm3u8',
            'videoId'    => $videoId,
            'source'     => 'anichin.stream',
        ];
    }

    // Fallback: fetch page
    $html = simpleFetch($url, ['Referer: ' . ANICHIN_BASE . '/']);
    if ($html && preg_match('/([a-zA-Z0-9_-]+)\.m3u8/', $html, $m)) {
        return [
            'playerUrl' => $url, 'streamUrl' => $base . '/hls/' . $m[1] . '.m3u8',
            'streamType' => 'm3u8', 'videoId' => $m[1], 'source' => 'anichin.stream',
        ];
    }
    return null;
}


function extractOkRu($url) {
    if (strpos($url, 'videoembed') === false && preg_match('/\/video\/(\d+)/', $url, $m))
        $url = 'https://ok.ru/videoembed/' . $m[1];
    if (strpos($url, 'http') !== 0) $url = 'https:' . $url;

    $html = simpleFetch($url, ['Referer: ' . ANICHIN_BASE . '/']);
    if (!$html) return null;

    if (preg_match('/data-options="([^"]+)"/', $html, $m)) {
        $raw  = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
        $opts = json_decode($raw, true);
        $ms   = $opts['flashvars']['metadata'] ?? '';
        if ($ms) {
            $meta = json_decode($ms, true);
            if ($meta) {
                $videos = $meta['videos'] ?? [];
                $qualities = []; $bestUrl = ''; $bestH = 0;
                $qMap = ['mobile'=>144,'lowest'=>240,'low'=>360,'sd'=>480,'hd'=>720,'full'=>1080];
                foreach ($videos as $v) {
                    $n = strtolower($v['name'] ?? ''); $u = $v['url'] ?? '';
                    if ($u) { $qualities[$n] = $u; if (($qMap[$n]??0) > $bestH) { $bestH=$qMap[$n]; $bestUrl=$u; }}
                }
                $hls = $meta['hlsManifestUrl'] ?? $meta['hlsMasterPlaylistUrl'] ?? $meta['ondemandHls'] ?? '';
                if ($hls) { $qualities['m3u8'] = $hls; $bestUrl = $hls; }
                return ['playerUrl'=>$url, 'streamUrl'=>$bestUrl,
                    'streamType'=> strpos($bestUrl,'.m3u8')!==false?'m3u8':'mp4',
                    'qualities'=>$qualities, 'source'=>'ok.ru'];
            }
        }
    }

    foreach (['/hlsManifestUrl"\s*:\s*"([^"]+)"/', '/ondemandHls"\s*:\s*"([^"]+)"/'] as $p) {
        if (preg_match($p, $html, $m)) {
            return ['playerUrl'=>$url, 'streamUrl'=>str_replace(['\\/','\\\\/'], '/', $m[1]), 'streamType'=>'m3u8', 'source'=>'ok.ru'];
        }
    }
    return null;
}


function extractGeneric($url) {
    $html = simpleFetch($url, ['Referer: ' . ANICHIN_BASE . '/']);
    if (!$html) return null;
    if (preg_match('/(https?:\/\/[^"\'<>\s]+\.m3u8[^"\'<>\s]*)/', $html, $m))
        return ['playerUrl'=>$url, 'streamUrl'=>$m[1], 'streamType'=>'m3u8', 'source'=>'generic'];
    if (preg_match('/(https?:\/\/[^"\'<>\s]+\.mp4[^"\'<>\s]*)/', $html, $m))
        return ['playerUrl'=>$url, 'streamUrl'=>$m[1], 'streamType'=>'mp4', 'source'=>'generic'];
    return null;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  M3U8 PROXY
// ═══════════════════════════════════════════════════════════════════════════════

function proxyM3u8Rewrite($m3u8Url) {
    $body = simpleFetch($m3u8Url, [
        'Referer: ' . ANICHIN_REFERER,
        'Origin: ' . ANICHIN_STREAM_BASE,
    ]);
    if (!$body) { http_response_code(502); echo "Failed to fetch m3u8"; return; }

    $selfBase = "https://" . $_SERVER['HTTP_HOST'] . $_SERVER['SCRIPT_NAME'];
    $baseUrl  = substr($m3u8Url, 0, strrpos($m3u8Url, '/') + 1);

    $lines  = explode("\n", $body);
    $output = [];

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            if (strpos($line, 'URI="') !== false) {
                $line = preg_replace_callback('/URI="([^"]+)"/', function($match) use ($baseUrl, $selfBase) {
                    $uri = $match[1];
                    $abs = (strpos($uri,'http')===0) ? $uri : $baseUrl.$uri;
                    $p   = strpos($abs,'.m3u8')!==false ? 'proxy_m3u8' : 'proxy_seg';
                    return 'URI="'.$selfBase.'?'.$p.'='.urlencode($abs).'"';
                }, $line);
            }
            $output[] = $line;
            continue;
        }
        $abs = (strpos($line,'http')===0) ? $line : $baseUrl.$line;
        $p   = strpos($abs,'.m3u8')!==false ? 'proxy_m3u8' : 'proxy_seg';
        $output[] = $selfBase.'?'.$p.'='.urlencode($abs);
    }

    header("Content-Type: application/vnd.apple.mpegurl");
    header("Cache-Control: public, max-age=5");
    echo implode("\n", $output);
}


function proxySegment($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Referer: '.ANICHIN_REFERER, 'Origin: '.ANICHIN_STREAM_BASE, 'User-Agent: '.UA],
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HEADER         => false,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_BUFFERSIZE     => 65536,
    ]);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $h) {
        if (preg_match('/Content-Type|Content-Length|Content-Range|Accept-Ranges/i', $h)) header(trim($h), false);
        return strlen($h);
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $d) { echo $d; flush(); return strlen($d); });

    header("Content-Type: video/mp2t");
    header("Cache-Control: public, max-age=3600");
    header("Access-Control-Allow-Origin: *");
    curl_exec($ch); curl_close($ch);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function anichinFetch($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_ENCODING       => '',
        CURLOPT_HTTPHEADER     => [
            'User-Agent: ' . UA,
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: id-ID,id;q=0.9,en;q=0.8',
            'Cookie: cf_clearance=' . CF_COOKIE,
            'Referer: ' . ANICHIN_BASE . '/',
            'DNT: 1',
        ],
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$html || $code !== 200) return null;
    if (stripos($html, 'Just a moment') !== false) return null;
    return $html;
}


function simpleFetch($url, $extraHeaders = []) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_ENCODING       => '',
        CURLOPT_HTTPHEADER     => array_merge(['User-Agent: '.UA, 'Accept: */*'], $extraHeaders),
    ]);
    $r = curl_exec($ch);
    $c = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($c >= 200 && $c < 400) ? $r : null;
}
