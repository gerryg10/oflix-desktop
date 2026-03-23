<?php
/**
 * DONGHUA_API.PHP — Full Anichin Scraper (Vercel PHP)
 * ====================================================
 * No Python, no ngrok. Direct scraping with cf_clearance cookie.
 * 
 * Set Vercel env var: ANICHIN_CF_CLEARANCE = your cf_clearance cookie value
 * 
 * Endpoints:
 *   ?action=populer&page=1
 *   ?action=search&q=Tales&page=1
 *   ?action=detail&slug=battle-through-the-heavens-season-5
 *   ?action=play&ep=episode-slug
 */

error_reporting(0);
ini_set('display_errors', 0);
set_time_limit(30);

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Content-Type: application/json; charset=utf-8");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Config ────────────────────────────────────────────────────────────────────
define('ANICHIN_BASE', 'https://anichin.watch');
define('CF_COOKIE', getenv('ANICHIN_CF_CLEARANCE') ?: '');
define('UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

$TTL = [
    'populer' => 21600,    // 6 jam
    'search'  => 21600,    // 6 jam
    'detail'  => 43200,    // 12 jam
    'play'    => 2592000,  // 30 hari
];

$action = $_GET['action'] ?? '';
if (!$action) {
    die(json_encode([
        'success' => false,
        'error'   => 'action wajib diisi',
        'endpoints' => [
            'populer' => '?action=populer&page=1',
            'search'  => '?action=search&q=Tales&page=1',
            'detail'  => '?action=detail&slug={slug}',
            'play'    => '?action=play&ep={episode-slug}',
        ],
    ]));
}

// ── Cache ─────────────────────────────────────────────────────────────────────
$ttl       = $TTL[$action] ?? 21600;
$cacheDir  = '/tmp/cache_donghua/';
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
        $p = (int)($_GET['page'] ?? 1);
        $result = $q ? scrapeSearch($q, $p) : ['error' => 'q required'];
        break;
    case 'detail':
        $slug = $_GET['slug'] ?? '';
        $result = $slug ? scrapeDetail($slug) : ['error' => 'slug required'];
        break;
    case 'play':
        $ep = $_GET['ep'] ?? '';
        $result = $ep ? scrapePlay($ep) : ['error' => 'ep required'];
        break;
    default:
        $result = ['error' => 'action tidak dikenal: ' . $action];
}

$json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// Cache valid responses only
if (!isset($result['error'])) {
    file_put_contents($cacheFile, $json);
}

echo $json;
exit;


// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH HELPER
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
    // Check if we got Cloudflare challenge page
    if (stripos($html, 'Just a moment') !== false || stripos($html, 'cf-challenge') !== false) {
        return null;
    }
    return $html;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: POPULER
// ═══════════════════════════════════════════════════════════════════════════════

function scrapePopuler($page) {
    $url  = ANICHIN_BASE . "/donghua/?page={$page}&status=&type=&order=popular";
    $html = anichinFetch($url);
    if (!$html) return cfError();

    return parseListPage($html, 'populer', $page);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeSearch($query, $page) {
    $url  = ANICHIN_BASE . "/page/{$page}/?s=" . urlencode($query);
    $html = anichinFetch($url);
    if (!$html) return cfError();

    $result = parseListPage($html, 'search', $page);
    $result['query'] = $query;
    return $result;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PARSE LIST (shared by populer & search)
// ═══════════════════════════════════════════════════════════════════════════════

function parseListPage($html, $category, $page) {
    // Find listupd block
    if (!preg_match('/<div class="listupd">(.*?)<\/div>\s*<div class="(?:clear|hpage|pagination)/s', $html, $m)) {
        // Fallback: grab everything in listupd
        if (!preg_match('/<div class="listupd">(.*)/s', $html, $m)) {
            return ['error' => 'listupd not found', 'cf_ok' => strpos($html, 'cf-challenge') === false];
        }
    }
    $block = $m[1];

    $items = [];
    // Match each article.bs
    preg_match_all('/<article class="bs"[^>]*>(.*?)<\/article>/s', $block, $articles);

    foreach ($articles[1] as $art) {
        $item = [];

        // href + title from <a>
        if (preg_match('/<a href="([^"]+)"[^>]*title="([^"]*)"/', $art, $a)) {
            $href  = $a[1];
            $item['title'] = html_entity_decode($a[2], ENT_QUOTES, 'UTF-8');
            $slug  = trim(parse_url($href, PHP_URL_PATH), '/');
            $slug  = basename($slug); // last segment
            $item['detailPath'] = $slug;
        } else {
            continue;
        }

        // Poster from <img>
        if (preg_match('/<img[^>]+src="([^"]+)"/', $art, $img)) {
            $item['poster'] = $img[1];
        } else {
            $item['poster'] = '';
        }

        // Status from span.epx
        if (preg_match('/<span class="epx">([^<]+)/', $art, $st)) {
            $item['status'] = trim($st[1]);
        } else {
            $item['status'] = '';
        }

        // Type from div.typez
        if (preg_match('/<div class="typez[^"]*">([^<]+)/', $art, $ty)) {
            $item['type'] = strtolower(trim($ty[1]));
        } else {
            $item['type'] = 'donghua';
        }

        $items[] = $item;
    }

    return [
        'category' => $category,
        'page'     => $page,
        'items'    => $items,
    ];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeDetail($slug) {
    $url  = ANICHIN_BASE . "/donghua/{$slug}/";
    $html = anichinFetch($url);
    if (!$html) return cfError();

    $data = [];
    $data['detailPath'] = $slug;

    // Title
    if (preg_match('/<h1 class="entry-title"[^>]*>([^<]+)/', $html, $m))
        $data['title'] = html_entity_decode(trim($m[1]), ENT_QUOTES, 'UTF-8');
    else $data['title'] = '';

    // Poster from .thumbook img
    if (preg_match('/class="thumbook".*?<img[^>]+src="([^"]+)"/s', $html, $m))
        $data['poster'] = $m[1];
    else $data['poster'] = '';

    // Rating
    if (preg_match('/class="rating".*?<strong>([^<]+)/s', $html, $m))
        $data['rating'] = trim($m[1]);
    elseif (preg_match('/class="num"[^>]*>([^<]+)/', $html, $m))
        $data['rating'] = trim($m[1]);
    else $data['rating'] = '';

    // SPE block (year, duration, country)
    $data['year'] = '';
    $data['duration'] = '';
    $data['releaseDate'] = '';
    $data['country'] = 'China';

    if (preg_match('/<div class="spe">(.*?)<\/div>/s', $html, $speBlock)) {
        $spe = $speBlock[1];
        // Each <span> is a field
        preg_match_all('/<span>(.*?)<\/span>/s', $spe, $spans);
        foreach ($spans[1] as $sp) {
            $sp = strip_tags($sp);
            $spLow = strtolower($sp);
            if (preg_match('/durasi|duration/i', $spLow)) {
                $data['duration'] = trim(preg_replace('/^(Durasi|Duration)\s*:?\s*/i', '', $sp));
            } elseif (preg_match('/dirilis|released|rilis/i', $spLow)) {
                $data['releaseDate'] = trim(preg_replace('/^(Dirilis|Released|Rilis|Tanggal Rilis)\s*:?\s*/i', '', $sp));
                if (preg_match('/(\d{4})/', $data['releaseDate'], $ym))
                    $data['year'] = $ym[1];
            } elseif (preg_match('/negara|country/i', $spLow)) {
                $data['country'] = trim(preg_replace('/^(Negara|Country)\s*:?\s*/i', '', $sp)) ?: 'China';
            }
        }
    }

    // Genre from .genxed
    $data['genre'] = [];
    if (preg_match('/class="genxed">(.*?)<\/div>/s', $html, $gm)) {
        preg_match_all('/<a[^>]*>([^<]+)<\/a>/', $gm[1], $genres);
        $data['genre'] = array_map('trim', $genres[1]);
    }

    // Description from .entry-content inside .synp
    $data['description'] = '';
    if (preg_match('/class="bixbox synp".*?class="entry-content"[^>]*>(.*?)<\/div>/s', $html, $dm)) {
        $data['description'] = trim(strip_tags(preg_replace('/<br\s*\/?>/', "\n", $dm[1])));
    } elseif (preg_match('/class="entry-content"[^>]*>(.*?)<\/div>/s', $html, $dm)) {
        $data['description'] = trim(strip_tags($dm[1]));
    }

    // Episodes from .eplister
    $data['episodes'] = [];
    if (preg_match('/class="eplister">(.*?)<\/div>/s', $html, $epl)) {
        preg_match_all('/<li>(.*?)<\/li>/s', $epl[1], $lis);
        foreach ($lis[1] as $li) {
            $ep = [];
            // href
            if (preg_match('/<a href="([^"]+)"/', $li, $a)) {
                $epHref = $a[1];
                $ep['playUrl'] = basename(trim(parse_url($epHref, PHP_URL_PATH), '/'));
            } else continue;

            // Episode number
            if (preg_match('/class="epl-num"[^>]*>([^<]+)/', $li, $n))
                $ep['episode'] = trim($n[1]);
            elseif (preg_match('/episode\s*(\d+)/i', $li, $n))
                $ep['episode'] = $n[1];
            else $ep['episode'] = '';

            // Episode title
            if (preg_match('/class="epl-title"[^>]*>([^<]+)/', $li, $t))
                $ep['title'] = html_entity_decode(trim($t[1]), ENT_QUOTES, 'UTF-8');
            else
                $ep['title'] = strip_tags(preg_replace('/<[^>]+>/', '', $li));

            $data['episodes'][] = $ep;
        }
    }

    $data['type'] = 'donghua';
    $data['subtitles'] = 'Indonesia';

    return ['data' => $data];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION: PLAY — scrape episode page, extract embed URL
// ═══════════════════════════════════════════════════════════════════════════════

function scrapePlay($epSlug) {
    $url  = ANICHIN_BASE . "/{$epSlug}/";
    $html = anichinFetch($url);
    if (!$html) return cfError();

    $playerUrl = '';

    // Method 1: iframe in .video-content
    if (preg_match('/class="video-content".*?<iframe[^>]+(?:data-src|src)="([^"]+)"/s', $html, $m)) {
        $playerUrl = $m[1];
    }
    // Method 2: any iframe
    if (!$playerUrl && preg_match('/<iframe[^>]+(?:data-src|src)="([^"]+)"/i', $html, $m)) {
        if (strpos($m[1], 'about:blank') === false) $playerUrl = $m[1];
    }
    // Method 3: JS-injected
    if (!$playerUrl && preg_match('/(?:src|url|file)\s*[:=]\s*["\']([^"\']+(?:embed|player|video)[^"\']*)["\']/', $html, $m)) {
        $playerUrl = $m[1];
    }

    return ['data' => ['playerUrl' => $playerUrl]];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function cfError() {
    return [
        'error'   => 'Cloudflare block — cf_clearance cookie mungkin expired',
        'hint'    => 'Update env var ANICHIN_CF_CLEARANCE di Vercel',
        'cf_cookie_set' => CF_COOKIE !== '',
    ];
}
