<?php
set_time_limit(0);
error_reporting(0);

if (!isset($_GET['url'])) { http_response_code(400); exit('No URL'); }
$url = urldecode($_GET['url']);

// ── Tentukan origin/referer berdasarkan domain video ─────────────────────────
$fakeOrigin  = "https://123movienow.cc";
$fakeReferer = "https://123movienow.cc/";

if (stripos($url, 'ok.ru') !== false || stripos($url, 'okcdn') !== false) {
    $fakeOrigin  = "https://ok.ru";
    $fakeReferer = "https://ok.ru/";
} elseif (stripos($url, 'anichin') !== false || stripos($url, 'sankavo') !== false) {
    $fakeOrigin  = "https://anichin.cafe";
    $fakeReferer = "https://anichin.cafe/";
} elseif (stripos($url, 'dailymotion') !== false) {
    $fakeOrigin  = "https://www.dailymotion.com";
    $fakeReferer = "https://www.dailymotion.com/";
}

$headers = [
    "Origin: $fakeOrigin",
    "Referer: $fakeReferer",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept: */*",
    "Connection: keep-alive",
];
if (isset($_SERVER['HTTP_RANGE'])) {
    $headers[] = "Range: " . $_SERVER['HTTP_RANGE'];
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HEADER         => false,
    CURLOPT_BUFFERSIZE     => 65524,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_ENCODING       => 'identity',
]);

curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $header) {
    if (preg_match('/Content-Type|Content-Length|Content-Range|Accept-Ranges/i', $header)) {
        header($header, false);
    }
    if (preg_match('/HTTP\/.* 206/', $header)) header("HTTP/1.1 206 Partial Content");
    if (preg_match('/HTTP\/.* 200/', $header)) header("HTTP/1.1 200 OK");
    return strlen($header);
});

curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
    echo $data; flush(); return strlen($data);
});

header("Content-Type: video/mp4");
header("Accept-Ranges: bytes");
header("X-Accel-Buffering: no");
header("Cache-Control: no-cache");
header("Access-Control-Allow-Origin: *");

curl_exec($ch);
curl_close($ch);
