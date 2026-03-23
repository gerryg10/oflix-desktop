<?php
/**
 * DONGHUA_STREAM.PHP — Extract & proxy m3u8 stream dari Anichin
 * 
 * Flow:
 *   1. Frontend: /donghua_stream.php?ep={episode-slug}
 *   2. PHP fetch episode page dari anichin (via Playwright/ngrok)
 *   3. Extract embed URL (anichin.stream/?id=xxx atau ok.ru)
 *   4. Extract video ID, construct m3u8 URL
 *   5. Proxy m3u8 + rewrite segment URLs
 *   6. Return playable m3u8 atau JSON dengan stream info
 *
 * Modes:
 *   ?ep=slug                     → Return JSON { streamUrl, streamType, ... }
 *   ?ep=slug&play=1              → Return proxied m3u8 langsung (untuk HLS.js)
 *   ?proxy_m3u8=URL              → Proxy m3u8 + rewrite segments
 *   ?proxy_seg=URL               → Proxy .ts segment
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
define('NGROK_BASE', 'https://unstrained-commandingly-arya.ngrok-free.dev/anichin');
define('ANICHIN_STREAM_BASE', 'https://anichin.stream');
define('ANICHIN_REFERER', 'https://anichin.stream/');

$cacheDir = '/tmp/cache_donghua_stream/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);

// ── Router ────────────────────────────────────────────────────────────────────
$ep        = $_GET['ep']        ?? '';
$play      = $_GET['play']      ?? '';
$proxyM3u8 = $_GET['proxy_m3u8'] ?? '';
$proxySeg  = $_GET['proxy_seg']  ?? '';

// ── Mode: Proxy .ts segment ──────────────────────────────────────────────────
if ($proxySeg) {
    proxySegment($proxySeg);
    exit;
}

// ── Mode: Proxy m3u8 + rewrite ───────────────────────────────────────────────
if ($proxyM3u8) {
    proxyM3u8Rewrite($proxyM3u8);
    exit;
}

// ── Mode: Extract stream from episode slug ───────────────────────────────────
if (!$ep) {
    header("Content-Type: application/json");
    die(json_encode([
        'success' => false,
        'error'   => 'Parameter ep wajib diisi',
        'usage'   => [
            'json'    => '/donghua_stream.php?ep={episode-slug}',
            'play'    => '/donghua_stream.php?ep={episode-slug}&play=1',
        ],
    ]));
}

$streamData = extractStream($ep);

if ($play && $streamData['streamUrl'] ?? false) {
    // Return proxied m3u8 langsung
    $m3u8Url = $streamData['streamUrl'];
    if (strpos($m3u8Url, 'anichin.stream') !== false || strpos($m3u8Url, '.m3u8') !== false) {
        proxyM3u8Rewrite($m3u8Url);
    } else {
        // Redirect ke URL langsung (ok.ru mp4 etc)
        header("Location: " . $m3u8Url);
    }
    exit;
}

// Return JSON
header("Content-Type: application/json");
echo json_encode($streamData, JSON_PRETTY_PRINT);
exit;


// ═══════════════════════════════════════════════════════════════════════════════
//  FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract stream URL from episode slug.
 * Calls Python scraper to get embed page, then extracts video URL.
 */
function extractStream($epSlug) {
    global $cacheDir;
    
    $cacheKey  = md5("stream_" . $epSlug);
    $cacheFile = $cacheDir . $cacheKey . '.json';
    
    // Cache 30 hari untuk stream URLs
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 2592000)) {
        return json_decode(file_get_contents($cacheFile), true);
    }
    
    // Step 1: Fetch episode page via Python scraper (ngrok)
    $url = NGROK_BASE . '?action=play&ep=' . urlencode($epSlug);
    $json = curlFetch($url, [
        'Accept: application/json',
        'ngrok-skip-browser-warning: true',
    ]);
    
    if (!$json) {
        return ['success' => false, 'error' => 'Gagal fetch dari scraper'];
    }
    
    $res = json_decode($json, true);
    $data = $res['data'] ?? $res ?? [];
    $playerUrl = $data['playerUrl'] ?? $data['streamUrl'] ?? '';
    
    if (!$playerUrl) {
        return ['success' => false, 'error' => 'playerUrl tidak ditemukan'];
    }
    
    // Step 2: Extract based on player type
    $result = null;
    
    // ── anichin.stream ──
    if (strpos($playerUrl, 'anichin.stream') !== false || strpos($playerUrl, 'anichin.club') !== false) {
        $result = extractAnichinStream($playerUrl);
    }
    // ── ok.ru ──
    elseif (strpos($playerUrl, 'ok.ru') !== false || strpos($playerUrl, 'odnoklassniki') !== false) {
        $result = extractOkRu($playerUrl);
    }
    // ── Unknown — try generic ──
    else {
        $result = extractGeneric($playerUrl);
    }
    
    if (!$result) {
        $result = ['success' => false, 'playerUrl' => $playerUrl, 'error' => 'Tidak bisa extract stream'];
    }
    
    // Build proxied URL via Cloudflare Worker (no mixed-content, no CORS issues)
    $cfProxy = 'https://proxy-anichin.oflix.workers.dev';
    
    if (isset($result['streamUrl']) && $result['streamType'] === 'm3u8') {
        $result['proxiedUrl'] = $cfProxy . '/?url=' . urlencode($result['streamUrl']);
    }
    
    // Also build self-proxy as fallback (force https)
    $host     = $_SERVER['HTTP_HOST'];
    $script   = $_SERVER['SCRIPT_NAME'];
    $selfBase = "https://" . $host . $script;
    
    if (isset($result['streamUrl']) && $result['streamType'] === 'm3u8') {
        $result['selfProxiedUrl'] = $selfBase . '?proxy_m3u8=' . urlencode($result['streamUrl']);
        $result['playUrl']        = $selfBase . '?ep=' . urlencode($epSlug) . '&play=1';
    }
    
    $result['success'] = true;
    $result['episode'] = $epSlug;
    
    // Cache
    file_put_contents($cacheFile, json_encode($result));
    
    return $result;
}


/**
 * Extract m3u8 from anichin.stream/?id=xxx
 * Pattern: /hls/{id}.m3u8
 */
function extractAnichinStream($url) {
    // Extract ID from ?id= parameter
    $parsed = parse_url($url);
    parse_str($parsed['query'] ?? '', $params);
    $videoId = $params['id'] ?? '';
    
    if (!$videoId) {
        // Try regex
        if (preg_match('/[?&]id=([^&]+)/', $url, $m)) {
            $videoId = $m[1];
        }
    }
    
    $base = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? 'anichin.stream');
    
    if ($videoId) {
        $m3u8 = $base . '/hls/' . $videoId . '.m3u8';
        return [
            'playerUrl'  => $url,
            'streamUrl'  => $m3u8,
            'streamType' => 'm3u8',
            'videoId'    => $videoId,
            'source'     => 'anichin.stream',
        ];
    }
    
    // Fallback: fetch page and find m3u8 reference
    $html = curlFetch($url, [
        'Referer: https://anichin.watch/',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
    ]);
    
    if ($html && preg_match('/([a-zA-Z0-9_-]+)\.m3u8/', $html, $m)) {
        $vid  = $m[1];
        $m3u8 = $base . '/hls/' . $vid . '.m3u8';
        return [
            'playerUrl'  => $url,
            'streamUrl'  => $m3u8,
            'streamType' => 'm3u8',
            'videoId'    => $vid,
            'source'     => 'anichin.stream',
        ];
    }
    
    return null;
}


/**
 * Extract direct URLs from ok.ru embed.
 */
function extractOkRu($url) {
    // Normalize to videoembed
    if (strpos($url, 'videoembed') === false && preg_match('/\/video\/(\d+)/', $url, $m)) {
        $url = 'https://ok.ru/videoembed/' . $m[1];
    }
    if (strpos($url, 'http') !== 0) $url = 'https:' . $url;
    
    $html = curlFetch($url, [
        'Referer: https://anichin.watch/',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
    ]);
    
    if (!$html) return null;
    
    // Extract data-options JSON
    if (preg_match('/data-options="([^"]+)"/', $html, $m)) {
        $raw = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
        $options = json_decode($raw, true);
        $metaStr = $options['flashvars']['metadata'] ?? '';
        
        if ($metaStr) {
            $meta = json_decode($metaStr, true);
            if ($meta) {
                $videos    = $meta['videos'] ?? [];
                $qualities = [];
                $bestUrl   = '';
                $bestH     = 0;
                $qMap      = ['mobile'=>144,'lowest'=>240,'low'=>360,'sd'=>480,'hd'=>720,'full'=>1080];
                
                foreach ($videos as $v) {
                    $name = strtolower($v['name'] ?? '');
                    $vUrl = $v['url'] ?? '';
                    if ($vUrl) {
                        $qualities[$name] = $vUrl;
                        if (($qMap[$name] ?? 0) > $bestH) {
                            $bestH   = $qMap[$name];
                            $bestUrl = $vUrl;
                        }
                    }
                }
                
                $hls = $meta['hlsManifestUrl'] ?? $meta['hlsMasterPlaylistUrl'] ?? $meta['ondemandHls'] ?? '';
                if ($hls) {
                    $qualities['m3u8'] = $hls;
                    $bestUrl = $hls;
                }
                
                return [
                    'playerUrl'  => $url,
                    'streamUrl'  => $bestUrl,
                    'streamType' => strpos($bestUrl, '.m3u8') !== false ? 'm3u8' : 'mp4',
                    'qualities'  => $qualities,
                    'source'     => 'ok.ru',
                ];
            }
        }
    }
    
    // Fallback: find HLS URL directly
    foreach (['/hlsManifestUrl"\s*:\s*"([^"]+)"/', '/ondemandHls"\s*:\s*"([^"]+)"/'] as $pat) {
        if (preg_match($pat, $html, $m)) {
            $hlsUrl = str_replace(['\\/', '\\\\'], ['/', '\\'], $m[1]);
            return [
                'playerUrl'  => $url,
                'streamUrl'  => $hlsUrl,
                'streamType' => 'm3u8',
                'source'     => 'ok.ru',
            ];
        }
    }
    
    return null;
}


/**
 * Generic: try to find m3u8/mp4 in page.
 */
function extractGeneric($url) {
    $html = curlFetch($url, [
        'Referer: https://anichin.watch/',
        'User-Agent: Mozilla/5.0 Chrome/131.0.0.0',
    ]);
    if (!$html) return null;
    
    if (preg_match('/(https?:\/\/[^"\'<>\s]+\.m3u8[^"\'<>\s]*)/', $html, $m)) {
        return ['playerUrl' => $url, 'streamUrl' => $m[1], 'streamType' => 'm3u8', 'source' => 'generic'];
    }
    if (preg_match('/(https?:\/\/[^"\'<>\s]+\.mp4[^"\'<>\s]*)/', $html, $m)) {
        return ['playerUrl' => $url, 'streamUrl' => $m[1], 'streamType' => 'mp4', 'source' => 'generic'];
    }
    return null;
}


/**
 * Proxy m3u8 playlist — rewrite segment URLs to go through this proxy.
 */
function proxyM3u8Rewrite($m3u8Url) {
    $body = curlFetch($m3u8Url, [
        'Referer: ' . ANICHIN_REFERER,
        'Origin: ' . ANICHIN_STREAM_BASE,
        'User-Agent: Mozilla/5.0 Chrome/131.0.0.0',
        'Accept: */*',
    ]);
    
    if (!$body) {
        http_response_code(502);
        echo "Failed to fetch m3u8";
        return;
    }
    
    // Build self URL for proxying (force https)
    $selfBase = "https://" . $_SERVER['HTTP_HOST'] . $_SERVER['SCRIPT_NAME'];
    
    // Base URL of the m3u8 (for relative paths)
    $baseUrl = substr($m3u8Url, 0, strrpos($m3u8Url, '/') + 1);
    
    // Rewrite each line
    $lines = explode("\n", $body);
    $output = [];
    
    foreach ($lines as $line) {
        $line = trim($line);
        
        if ($line === '' || $line[0] === '#') {
            // Rewrite URI= in tags like #EXT-X-MAP
            if (strpos($line, 'URI="') !== false) {
                $line = preg_replace_callback('/URI="([^"]+)"/', function($match) use ($baseUrl, $selfBase) {
                    $uri = $match[1];
                    $absUri = (strpos($uri, 'http') === 0) ? $uri : $baseUrl . $uri;
                    // Sub-playlist → proxy_m3u8, segment → proxy_seg
                    $param = (strpos($absUri, '.m3u8') !== false) ? 'proxy_m3u8' : 'proxy_seg';
                    return 'URI="' . $selfBase . '?' . $param . '=' . urlencode($absUri) . '"';
                }, $line);
            }
            $output[] = $line;
            continue;
        }
        
        // URL line — could be sub-playlist (.m3u8) or segment (.ts)
        $absUrl = (strpos($line, 'http') === 0) ? $line : $baseUrl . $line;
        
        if (strpos($absUrl, '.m3u8') !== false) {
            // Sub-playlist → proxy through proxy_m3u8
            $output[] = $selfBase . '?proxy_m3u8=' . urlencode($absUrl);
        } else {
            // Segment → proxy through proxy_seg
            $output[] = $selfBase . '?proxy_seg=' . urlencode($absUrl);
        }
    }
    
    header("Content-Type: application/vnd.apple.mpegurl");
    header("Cache-Control: public, max-age=5");
    echo implode("\n", $output);
}


/**
 * Proxy a .ts segment or sub-resource with proper referer.
 */
function proxySegment($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => [
            'Referer: ' . ANICHIN_REFERER,
            'Origin: ' . ANICHIN_STREAM_BASE,
            'User-Agent: Mozilla/5.0 Chrome/131.0.0.0',
            'Accept: */*',
        ],
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HEADER         => false,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_BUFFERSIZE     => 65536,
    ]);
    
    // Forward response headers
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $header) {
        if (preg_match('/Content-Type|Content-Length|Content-Range|Accept-Ranges/i', $header)) {
            header(trim($header), false);
        }
        return strlen($header);
    });
    
    // Stream body
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
        echo $data;
        flush();
        return strlen($data);
    });
    
    header("Content-Type: video/mp2t");
    header("Cache-Control: public, max-age=3600");
    header("Access-Control-Allow-Origin: *");
    header("X-Accel-Buffering: no");
    
    curl_exec($ch);
    curl_close($ch);
}


/**
 * Simple curl GET with custom headers.
 */
function curlFetch($url, $extraHeaders = []) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_ENCODING       => '',
        CURLOPT_HTTPHEADER     => array_merge([
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
            'Accept: */*',
        ], $extraHeaders),
    ]);
    
    $result = curl_exec($ch);
    $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return ($code >= 200 && $code < 400) ? $result : null;
}
