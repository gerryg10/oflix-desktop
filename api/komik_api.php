<?php
/**
 * KOMIK_API.PHP — Full Komiku Scraper (Vercel PHP)
 * ==================================================
 * Direct scraping komiku.org — no Python, no ngrok.
 * 
 * Endpoints:
 *   ?action=populer&page=1
 *   ?action=search&q=naruto
 *   ?action=detail&detailManga={slug}
 *   ?action=baca&bacaManga={slug}
 */

error_reporting(0);
ini_set('display_errors', 0);
set_time_limit(30);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Content-Type: application/json; charset=utf-8");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Config ────────────────────────────────────────────────────────────────────
define('KOMIKU_BASE', 'https://komiku.org');
define('KOMIKU_API',  'https://api.komiku.org');
define('UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

$TTL = [
    'populer' => 21600,    // 6 jam
    'search'  => 21600,    // 6 jam
    'detail'  => 43200,    // 12 jam
    'baca'    => 2592000,  // 30 hari
];

$action = $_GET['action'] ?? '';
if (!$action) {
    die(json_encode([
        'status' => 'error',
        'message' => 'action wajib diisi',
        'endpoints' => [
            'populer' => '?action=populer&page=1',
            'search'  => '?action=search&q=naruto',
            'detail'  => '?action=detail&detailManga={slug}',
            'baca'    => '?action=baca&bacaManga={slug}',
        ],
    ]));
}

// ── Cache ─────────────────────────────────────────────────────────────────────
$ttl       = $TTL[$action] ?? 21600;
$cacheDir  = '/tmp/cache_komik/';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0777, true);
$cacheKey  = md5(json_encode($_GET));
$cacheFile = $cacheDir . $cacheKey . '.json';

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $ttl)) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Router ────────────────────────────────────────────────────────────────────
$result = null;
switch ($action) {
    case 'populer':
        $result = scrapePopuler((int)($_GET['page'] ?? 1));
        break;
    case 'search':
        $q = $_GET['q'] ?? '';
        $result = $q ? scrapeSearch($q) : ['status'=>'error','message'=>'q required'];
        break;
    case 'detail':
        $slug = $_GET['detailManga'] ?? '';
        $result = $slug ? scrapeDetail($slug) : ['status'=>'error','message'=>'detailManga required'];
        break;
    case 'baca':
        $slug = $_GET['bacaManga'] ?? '';
        $result = $slug ? scrapeBaca($slug) : ['status'=>'error','message'=>'bacaManga required'];
        break;
    default:
        $result = ['status'=>'error','message'=>'action tidak dikenal: '.$action];
}

$json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($result['status'] ?? '' === 'ok') {
    file_put_contents($cacheFile, $json);
}
echo $json;
exit;


// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH + PARSE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function komikuFetch($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_ENCODING       => '',
        CURLOPT_HTTPHEADER     => [
            'User-Agent: ' . UA,
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8',
            'Referer: ' . KOMIKU_BASE . '/',
            'Cache-Control: no-cache',
        ],
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($code === 200 && $html) ? $html : null;
}

function fixUrl($url) {
    if (!$url) return '';
    if (strpos($url, '//') === 0) return 'https:' . $url;
    if (strpos($url, '/') === 0) return KOMIKU_BASE . $url;
    return $url;
}

function clean($text) {
    return trim(preg_replace('/\s+/', ' ', strip_tags($text)));
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PARSE ITEMS (shared by populer & search) — from .bge elements
// ═══════════════════════════════════════════════════════════════════════════════

function parseItems($html) {
    $items = [];
    $seen  = [];

    // Match each div.bge block
    if (!preg_match_all('/<div class="bge">(.*?)<\/div>\s*<\/div>/s', $html, $blocks)) {
        // Fallback: less strict
        preg_match_all('/<div class="bge">(.*?)<div class="bge"|<div class="bge">(.*?)$/s', $html, $blocks);
        $blocks = array_filter(array_merge($blocks[1] ?? [], $blocks[2] ?? []));
        if (empty($blocks)) return $items;
    } else {
        $blocks = $blocks[0];
    }

    foreach ($blocks as $block) {
        // Link + slug
        if (!preg_match('/<a href="([^"]+)"/', $block, $aMatch)) continue;
        $link = fixUrl($aMatch[1]);
        if (isset($seen[$link])) continue;
        $seen[$link] = true;

        $slug = basename(rtrim(parse_url($link, PHP_URL_PATH), '/'));

        // Poster
        $poster = '';
        if (preg_match('/<img[^>]+(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/', $block, $img)) {
            $poster = fixUrl($img[1]);
        }

        // Title — from h3/h4 or img alt
        $title = '';
        if (preg_match('/<h[234][^>]*><a[^>]*>([^<]+)/', $block, $t)) {
            $title = clean($t[1]);
        } elseif (preg_match('/<h[234][^>]*>([^<]+)/', $block, $t)) {
            $title = clean($t[1]);
        } elseif (preg_match('/alt="([^"]+)"/', $block, $t)) {
            $title = clean($t[1]);
        }
        if (!$title) $title = str_replace('-', ' ', ucwords($slug, '-'));

        // Type & genre from .tpe1_inf
        $type = ''; $genre = '';
        if (preg_match('/class="tpe1_inf"[^>]*>(.*?)<\/div>/s', $block, $tpe)) {
            if (preg_match('/<b>([^<]+)/', $tpe[1], $b)) {
                $type = clean($b[1]);
                $genre = clean(str_replace($type, '', strip_tags($tpe[1])));
            } else {
                $genre = clean(strip_tags($tpe[1]));
            }
        }

        // Last chapter from .new1
        $lastChapter = '';
        if (preg_match('/class="new1"[^>]*>([^<]+)/', $block, $ch)) {
            $lastChapter = clean($ch[1]);
        }

        // Extra info from .judul2
        $info = '';
        if (preg_match('/class="judul2"[^>]*>([^<]+)/', $block, $j)) {
            $info = clean($j[1]);
        }

        $items[] = [
            'title'       => $title,
            'slug'        => $slug,
            'link'        => $link,
            'detailManga' => $slug,
            'poster'      => $poster,
            'lastChapter' => $lastChapter,
            'type'        => $type,
            'genre'       => $genre,
            'info'        => $info,
        ];
    }

    return $items;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: POPULER
// ═══════════════════════════════════════════════════════════════════════════════

function scrapePopuler($page) {
    // Gabungkan 5 halaman dari api.komiku.org/other/hot/page/N/
    $startApi = ($page - 1) * 5 + 1;
    $endApi   = $startApi + 4;

    $results = [];
    $seen    = [];
    $errors  = [];

    for ($p = $startApi; $p <= $endApi; $p++) {
        $url = ($p === 1)
            ? KOMIKU_API . '/other/hot/'
            : KOMIKU_API . "/other/hot/page/{$p}/";

        $html = komikuFetch($url);
        if (!$html) { $errors[] = "page {$p}: fetch failed"; continue; }

        $items = parseItems($html);
        foreach ($items as $item) {
            if (!isset($seen[$item['link']])) {
                $seen[$item['link']] = true;
                $results[] = $item;
            }
        }
    }

    return [
        'status'     => 'ok',
        'action'     => 'populer',
        'page'       => $page,
        'totalItems' => count($results),
        'errors'     => $errors ?: null,
        'data'       => $results,
    ];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeSearch($query) {
    $url  = KOMIKU_API . '/?post_type=manga&s=' . urlencode($query);
    $html = komikuFetch($url);
    if (!$html) return ['status'=>'error','message'=>'Gagal fetch search'];

    $items = parseItems($html);

    return [
        'status'     => 'ok',
        'action'     => 'search',
        'query'      => $query,
        'totalItems' => count($items),
        'data'       => $items,
    ];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeDetail($slug) {
    $url  = KOMIKU_BASE . "/manga/{$slug}/";
    $html = komikuFetch($url);
    if (!$html) return ['status'=>'error','message'=>'Gagal fetch detail'];

    $info = [];

    // Title
    if (preg_match('/<section[^>]*id="Informasi"[^>]*>.*?<h1[^>]*>([^<]+)/s', $html, $m))
        $info['title'] = clean($m[1]);
    elseif (preg_match('/<h1[^>]*>([^<]+)/', $html, $m))
        $info['title'] = clean($m[1]);
    else $info['title'] = '';

    // Poster
    $info['poster'] = '';
    if (preg_match('/id="Informasi".*?<img[^>]+(?:data-src|src)="([^"]+)"/s', $html, $m))
        $info['poster'] = fixUrl($m[1]);

    // Description
    $info['description'] = '';
    if (preg_match('/id="sinopsis"[^>]*>(.*?)<\/div>/s', $html, $m))
        $info['description'] = clean($m[1]);
    elseif (preg_match('/class="sinopsis"[^>]*>(.*?)<\/div>/s', $html, $m))
        $info['description'] = clean($m[1]);

    // Meta (key-value from table rows)
    $meta = [];
    if (preg_match('/id="Informasi"(.*?)(?:<\/section>|<section)/s', $html, $sec)) {
        preg_match_all('/<tr>(.*?)<\/tr>/s', $sec[1], $rows);
        foreach ($rows[1] as $row) {
            preg_match_all('/<td[^>]*>(.*?)<\/td>/s', $row, $tds);
            if (count($tds[1]) >= 2) {
                $k = clean($tds[1][0]);
                $v = clean($tds[1][1]);
                if ($k && $v && strlen($k) < 30) $meta[rtrim($k, ':')] = $v;
            }
        }
    }
    $info['meta'] = $meta;

    // Chapters from table#Daftar_Chapter
    $chapters = [];
    if (preg_match('/id="Daftar_Chapter"(.*?)(?:<\/table>|<\/section>)/s', $html, $ct)) {
        preg_match_all('/<tr>(.*?)<\/tr>/s', $ct[1], $rows);
        foreach ($rows[1] as $row) {
            if (!preg_match('/<a href="([^"]+)"[^>]*>([^<]+)/', $row, $a)) continue;
            $chLink  = fixUrl($a[1]);
            $chSlug  = basename(rtrim(parse_url($chLink, PHP_URL_PATH), '/'));
            $chTitle = clean($a[2]);

            $chDate = '';
            preg_match_all('/<td[^>]*>(.*?)<\/td>/s', $row, $tds);
            if (count($tds[1]) >= 2) {
                $chDate = clean($tds[1][count($tds[1]) - 1]);
                if ($chDate === $chTitle) $chDate = '';
            }

            $chapters[] = [
                'title'     => $chTitle,
                'slug'      => $chSlug,
                'link'      => $chLink,
                'bacaManga' => $chSlug,
                'date'      => $chDate,
            ];
        }
    }

    return [
        'status'       => 'ok',
        'action'       => 'detail',
        'detailManga'  => $slug,
        'url'          => $url,
        'info'         => $info,
        'totalChapter' => count($chapters),
        'chapters'     => $chapters,
    ];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: BACA
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeBaca($slug) {
    $url  = KOMIKU_BASE . "/{$slug}/";
    $html = komikuFetch($url);
    if (!$html) return ['status'=>'error','message'=>'Gagal fetch baca'];

    $images = [];
    $first  = '';

    // Find reading section: #Baca_Komik or .chapter-content
    $section = '';
    if (preg_match('/id="Baca_Komik"(.*?)(?:<\/section>|<section|<div class="(?:comment|disqus|footer))/s', $html, $m)) {
        $section = $m[1];
    } elseif (preg_match('/class="chapter-content"(.*?)(?:<\/div>\s*<\/div>|<div class="(?:comment|footer))/s', $html, $m)) {
        $section = $m[1];
    } elseif (preg_match('/class="reader"(.*?)(?:<\/div>\s*<\/div>)/s', $html, $m)) {
        $section = $m[1];
    }

    if ($section) {
        // Match all img tags
        preg_match_all('/<img[^>]+(?:data-src|data-lazy-src|data-original|src)="([^"]+)"[^>]*>/i', $section, $imgs);
        $idx = 0;
        foreach ($imgs[1] as $src) {
            $src = fixUrl(trim($src));
            if (!$src || stripos($src, 'blank') !== false || stripos($src, 'placeholder') !== false) continue;
            $idx++;

            // Try to get id attribute
            $imgId = (string)$idx;
            if (preg_match('/id="([^"]+)"/', $imgs[0][$idx-1] ?? '', $idm)) {
                $imgId = $idm[1];
            }

            // Try to get alt
            $alt = "Page {$idx}";
            if (preg_match('/alt="([^"]+)"/', $imgs[0][$idx-1] ?? '', $altm)) {
                $alt = clean($altm[1]);
            }

            $images[] = [
                'id'  => $imgId,
                'src' => $src,
                'alt' => $alt,
            ];

            if ($idx === 1) $first = $src;
        }
    }

    return [
        'status'     => 'ok',
        'action'     => 'baca',
        'bacaManga'  => $slug,
        'url'        => $url,
        'firstImage' => $first,
        'totalPages' => count($images),
        'images'     => $images,
    ];
}
