<?php
/**
 * STREAM.PHP - Fetch video data from rebahan.web.id/sapi/stream.php
 * This fetches the actual stream JSON with downloads array
 */

// Debug mode
$debug = isset($_GET['debug']) ? true : false;
if (!$debug) {
    error_reporting(0);
    ini_set('display_errors', 0);
}
set_time_limit(0);
$videoProxy = "https://proxy.oflix.workers.dev/?url=";

// Header CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Range, Origin, X-Requested-With");
header("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges");
header("Content-Type: application/json");

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$jsonCacheDir = '/tmp/cache_json/';
if (!is_dir($jsonCacheDir)) {
    mkdir($jsonCacheDir, 0777, true);
}

// Ambil parameter dari URL
$id = isset($_GET['id']) ? $_GET['id'] : '';
$season = isset($_GET['season']) ? $_GET['season'] : '';
$episode = isset($_GET['episode']) ? $_GET['episode'] : '';
$detailPath = isset($_GET['detailPath']) ? $_GET['detailPath'] : '';

if (empty($id)) {
    echo json_encode([
        'success' => false,
        'error' => 'Parameter id diperlukan',
        'hint' => 'Format: stream.php?id=xxx&season=1&episode=1&detailPath=xxx'
    ]);
    exit;
}

// Buat cache key
$cacheKey = md5("stream_{$id}_{$season}_{$episode}_{$detailPath}");
$cacheFile = $jsonCacheDir . "stream_" . $cacheKey . ".json";

// Cek cache (valid 1 jam untuk testing, 24 jam untuk production)
$cacheTime = $debug ? 60 : 600; // 1 menit debug, 10 menit production
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheTime)) {
    $cachedContent = file_get_contents($cacheFile);
    
    if ($debug) {
        $cached = json_decode($cachedContent, true);
        $cached['_cached'] = true;
        $cached['_cache_time'] = date('Y-m-d H:i:s', filemtime($cacheFile));
        
        // Update base_url jika ada perubahan domain
        $protocol = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? "https" : "http";
        $host = $_SERVER['HTTP_HOST'];
        $scriptDir = dirname($_SERVER['PHP_SELF']);
        $baseUrl = $protocol . "://" . $host . rtrim($scriptDir, '/');
        $cached['_debug']['current_base_url'] = $baseUrl;
        
        echo json_encode($cached, JSON_PRETTY_PRINT);
    } else {
        echo $cachedContent;
    }
    exit;
}

// Build URL target - ENDPOINT YANG BENAR!
$params = [];
if ($id) $params['id'] = $id;
if ($season) $params['season'] = $season;
if ($episode) $params['episode'] = $episode;
if ($detailPath) $params['detailPath'] = $detailPath;

// INI ENDPOINT YANG BENAR - stream.php, BUKAN player.php!
$targetUrl = "https://foodcash.com.br/sistema/apiv4/stream.php?" . http_build_query($params);

if ($debug) {
    error_log("Fetching: " . $targetUrl);
}

// Inisialisasi CURL dengan cookie jar
$cookieFile = $jsonCacheDir . "cookie_" . md5($id.$detailPath) . ".txt";
$ch = curl_init($targetUrl);

// Header untuk spoofing - SANGAT PENTING!
$headers = [
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'Accept: application/json, text/javascript, */*; q=0.01',
    'Accept-Language: en-US,en;q=0.9,id;q=0.8',
    'Accept-Encoding: gzip, deflate, br',
    'Referer: https://foodcash.com.br/sistema/apiv4/player.php?id=' . urlencode($id) . '&detailPath=' . urlencode($detailPath),
    'Origin: https://foodcash.com.br',
    'Sec-Fetch-Dest: empty',
    'Sec-Fetch-Mode: cors',
    'Sec-Fetch-Site: same-origin',
    'Sec-CH-UA: "Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'Sec-CH-UA-Mobile: ?0',
    'Sec-CH-UA-Platform: "Windows"',
    'X-Requested-With: XMLHttpRequest',
    'Cache-Control: no-cache',
    'Pragma: no-cache'
];

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_ENCODING, ''); // Auto decode gzip
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
$effectiveUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
curl_close($ch);

// Debug info
$debugInfo = null;
if ($debug) {
    $debugInfo = [
        'target_url' => $targetUrl,
        'http_code' => $httpCode,
        'curl_error' => $curlError,
        'effective_url' => $effectiveUrl,
        'response_length' => strlen($response),
        'response_preview' => substr($response, 0, 1000)
    ];
}

if ($response && $httpCode == 200) {
    $data = json_decode($response, true);
    
    if ($data && json_last_error() === JSON_ERROR_NONE) {
        // PENTING: Build absolute URL untuk video-proxy.php
        $protocol = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? "https" : "http";
        $host = $_SERVER['HTTP_HOST'];
        $scriptDir = dirname($_SERVER['PHP_SELF']);
        $baseUrl = $protocol . "://" . $host . $scriptDir;
        
        // Remove trailing slash
        $baseUrl = rtrim($baseUrl, '/');
        
        // Ubah URL video ke proxy lokal kita (ABSOLUTE URL!)
        if (isset($data['downloads']) && is_array($data['downloads'])) {
            foreach ($data['downloads'] as &$download) {
                if (isset($download['url'])) {
                    // Simpan URL asli
                    $originalUrl = $download['url'];
                    // Ubah ke ABSOLUTE proxy URL
                    $download['url'] = $videoProxy . urlencode($originalUrl);
                    if ($debug) {
                        $download['original_url'] = $originalUrl; // Untuk debugging
                    }
                }
            }
        }
        
        if (isset($data['url'])) {
            $originalUrl = $data['url'];
            $data['url'] = $videoProxy . urlencode($originalUrl);
            if ($debug) {
                $data['original_url'] = $originalUrl; // Untuk debugging
            }
        }
        
        // Add success flag
        $data['success'] = true;
        $data['source'] = 'foodcash.com.br/sistema/apiv4/stream.php';
        
        if ($debug) {
            $data['_debug'] = $debugInfo;
            $data['_debug']['base_url'] = $baseUrl;
            $data['_cached'] = false;
        }
        
        $finalJson = json_encode($data, JSON_PRETTY_PRINT);
        
        // Simpan ke cache
        file_put_contents($cacheFile, $finalJson);
        
        echo $finalJson;
    } else {
        echo json_encode([
            'success' => false,
            'error' => 'Invalid JSON response from rebahan.web.id', 
            'json_error' => json_last_error_msg(),
            'raw_response' => $debug ? $response : 'Enable debug mode (?debug=1) to see raw response',
            '_debug' => $debugInfo
        ], JSON_PRETTY_PRINT);
    }
} else {
    echo json_encode([
        'success' => false,
        'error' => 'Failed to fetch data from foodcash.com.br/sistema/apiv4/stream.php?', 
        'http_code' => $httpCode,
        'curl_error' => $curlError,
        'target_url' => $targetUrl,
        '_debug' => $debugInfo,
        'hint' => 'Add ?debug=1 to URL for more details'
    ], JSON_PRETTY_PRINT);
}
?>
