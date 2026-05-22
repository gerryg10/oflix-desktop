/**
 * OFLIX MovieBox API Proxy — Cloudflare Worker
 * Deploy: wrangler deploy
 * Usage: https://YOUR-WORKER.workers.dev/api/home
 *        https://YOUR-WORKER.workers.dev/api/search?keyword=avatar&page=1
 *        https://YOUR-WORKER.workers.dev/api/detail?path=bet-WfZpaLvJaS2
 *        https://YOUR-WORKER.workers.dev/api/play?subjectId=xxx&se=1&ep=3
 *        https://YOUR-WORKER.workers.dev/api/download?subjectId=xxx&se=1&ep=3
 */

const MB_HOST = 'https://themoviebox.org';
const MB_API = MB_HOST + '/wefeed-h5api-bff';
// Old API for homepage/search (still works on h5.aoneroom.com)
const MB_HOST_ALT = 'https://h5.aoneroom.com';
const MB_API_ALT = MB_HOST_ALT + '/wefeed-h5-bff';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'X-Client-Info': '{"timezone":"Asia/Jakarta"}',
  'Referer': MB_HOST + '/',
  'Origin': MB_HOST,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-OE',
  'Content-Type': 'application/json',
};


// ── Cookie management via KV (optional) or in-memory ────────────────────────
// For simplicity, we re-fetch cookies per request batch. 
// MovieBox sets cookies on the app-info call.

// ── Cookie management — AUTO-FETCH tokens from MovieBox ─────────────────────
// No more hardcoded tokens! Worker generates fresh tokens by visiting MovieBox.

let _tokenCache = '';     // cached: "token=xxx; mb_token=yyy; ..."
let _tokenTime = 0;
const TOKEN_TTL = 30 * 60 * 1000; // refresh every 30 min

async function ensureCookies(forceRefresh = false) {
  // Return cached tokens if fresh
  if (!forceRefresh && _tokenCache && (Date.now() - _tokenTime < TOKEN_TTL)) {
    return _tokenCache;
  }

  try {
    // Step 1: Visit MovieBox homepage — server sets token + mb_token cookies
    const resp = await fetch(MB_HOST + '/', {
      headers: {
        ...HEADERS,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    let cookies = collectAllCookies(resp);

    // Step 2: If no token from homepage, try the API app-info endpoint
    if (!cookies.includes('token=')) {
      const resp2 = await fetch(MB_HOST_ALT + '/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox', {
        headers: { ...HEADERS, Cookie: cookies },
        redirect: 'follow',
      });
      cookies = mergeCookieStr(cookies, collectAllCookies(resp2));
    }

    // Step 3: If still no token, try themoviebox.org main page
    if (!cookies.includes('token=')) {
      const resp3 = await fetch('https://themoviebox.org/', {
        headers: {
          ...HEADERS,
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      cookies = mergeCookieStr(cookies, collectAllCookies(resp3));
    }

    // Add i18n_lang if missing
    if (!cookies.includes('i18n_lang=')) {
      cookies = cookies + '; i18n_lang=id';
    }

    if (cookies.includes('token=')) {
      _tokenCache = cookies;
      _tokenTime = Date.now();
    }

    return cookies || _tokenCache;
  } catch (e) {
    // Fallback to cached if fetch fails
    return _tokenCache || 'i18n_lang=id';
  }
}

function collectAllCookies(resp) {
  const parts = [];
  for (const [key, value] of resp.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      // Extract "name=value" from "name=value; Path=/; ..."
      const cv = value.split(';')[0].trim();
      if (cv) parts.push(cv);
    }
  }
  return parts.join('; ');
}

function mergeCookieStr(existing, fresh) {
  if (!fresh) return existing;
  if (!existing) return fresh;
  const map = new Map();
  for (const pair of existing.split('; ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair);
  }
  for (const pair of fresh.split('; ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair);
  }
  return [...map.values()].join('; ');
}

async function mbFetch(url, options = {}, cookies = '') {
  const headers = { ...HEADERS, ...options.headers };
  if (cookies) headers['Cookie'] = cookies;

  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    redirect: 'follow',
  });

  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  return { json, status: resp.status, raw: text.slice(0, 2000) };
}

// ── Custom VPS Metadata Loading ───────────────────────────────────────────────
const CUSTOM_DB_URL = 'https://202-155-18-146.nevacloud.net/custom_oflix.json';

async function fetchCustomMovies() {
  try {
    const res = await fetch(CUSTOM_DB_URL, { cf: { cacheTtl: 60 } }); // Cache di CF selama 60 detik
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error('Failed fetching custom movies', e);
  }
  return [];
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleHome(cookies) {
  const { json, status, raw } = await mbFetch(MB_API_ALT + '/web/home', {}, cookies);
  if (!json || json.code !== 0) {
    return { success: false, error: 'Homepage fetch failed', status, raw };
  }

  const data = json.data || {};
  // Combine topPickList + homeList + operatingList
  const allItems = [
    ...(data.topPickList || []),
    ...(data.homeList || []),
    ...(data.operatingList || []).flatMap(op => op.items || op.subjects || [op]),
  ];

  const custom = await fetchCustomMovies();
  const customHomeItems = custom.map(c => ({
    title: c.title,
    poster: c.poster,
    detailPath: 'custom/' + c.id,
    year: String(c.year || ''),
    rating: String(c.rating || '0'),
    genre: c.genre || [],
    type: c.type || 'film',
    country: c.country || 'Indonesia',
    duration: c.duration || '',
    subjectId: 'custom_' + c.id,
  }));

  const items = [];
  const seenDp = new Set();
  const seenTitle = new Set();
  for (const item of allItems) {
    const sub = item.subject || item;
    const dp = sub.detailPath || item.detailPath || '';
    if (!dp || seenDp.has(dp)) continue;
    seenDp.add(dp);
    const transformed = transformItem(item);
    const base = dedupeTitle(transformed.title);
    if (seenTitle.has(base)) continue;
    seenTitle.add(base);
    transformed.title = transformed.title.replace(/\s+S\d+(-S\d+)?$/i, '').trim();
    items.push(transformed);
  }

  return { success: true, data: [...customHomeItems, ...items] };
}

async function handleSearch(params, cookies) {
  const keyword = params.get('keyword') || params.get('q') || '';
  const page = parseInt(params.get('page') || '1');
  const subjectType = parseInt(params.get('subjectType') || '0');

  if (!keyword) return { success: false, error: 'No keyword' };

  const { json, status } = await mbFetch(MB_API_ALT + '/web/subject/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, subjectType, page, per_page: 24 }),
  }, cookies);

  if (!json || json.code !== 0) {
    return { success: false, error: 'Search failed', status };
  }

  // Dedup: strip season suffixes, keep first per base title
  const rawItems = (json.data?.items || []).map(transformItem);
  const seen = new Set();
  const items = [];
  for (const item of rawItems) {
    const base = dedupeTitle(item.title);
    if (seen.has(base)) continue;
    seen.add(base);
    // Clean title: remove "S1-S8" or "S1" suffix
    item.title = item.title.replace(/\s+S\d+(-S\d+)?$/i, '').trim();
    items.push(item);
  }
  return { success: true, data: items };
}

// Strip season patterns for dedup: "Empire S6" -> "empire", "Naruto S1-S3" -> "naruto"
function dedupeTitle(title) {
  return (title || '')
    .replace(/\s+S\d+(-S\d+)?$/i, '')    // "Empire S6" -> "Empire"
    .replace(/\s+Season\s+\d+$/i, '')     // "Empire Season 6" -> "Empire"  
    .replace(/\s+\(\d{4}\)$/i, '')        // "Empire (2015)" -> "Empire"
    .trim().toLowerCase();
}

async function handleDetail(params, cookies) {
  const detailPath = params.get('path') || params.get('detailPath') || '';
  if (!detailPath) return { success: false, error: 'No detailPath' };

  // --- Check if it's a Custom VPS Movie ---
  if (detailPath.startsWith('custom/')) {
    const customId = detailPath.split('/')[1];
    const custom = await fetchCustomMovies();
    const movie = custom.find(c => c.id === customId);
    if (movie) {
      return {
        success: true,
        data: {
          title: movie.title,
          poster: movie.poster,
          year: String(movie.year || ''),
          rating: String(movie.rating || ''),
          genre: movie.genre || [],
          description: movie.description || '',
          country: movie.country || '',
          duration: movie.duration || '',
          network: 'VPS Oflix',
          cast: movie.cast || [],
          trailerUrl: movie.trailerUrl || '',
          playerUrl: movie.type === 'series' ? '' : `${MB_HOST}/play?id=custom_${movie.id}&season=0&episode=0`,
          sources: movie.type === 'series' ? [] : [{ url: 'dummy' }],
          seasons: (movie.seasons || []).map(s => ({
            season: s.season,
            episodes: (s.episodes || []).map(e => ({
              ...e,
              playerUrl: `${MB_HOST}/play?id=custom_${movie.id}&season=${s.season}&episode=${e.episode}`
            }))
          })),
          subjectId: 'custom_' + movie.id
        }
      };
    }
  }
  // ----------------------------------------

  // h5.aoneroom.com serves SSR detail pages with JSON data
  const resp = await fetch(MB_HOST_ALT + '/detail/' + detailPath, {
    headers: { ...HEADERS, 'Accept': 'text/html', Cookie: cookies },
    redirect: 'follow',
  });
  const html = await resp.text();

  // Extract JSON from <script type="application/json">
  const match = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return { success: false, error: 'No JSON data in page' };

  let rawJson;
  try { rawJson = JSON.parse(match[1]); } catch { return { success: false, error: 'Invalid JSON in page' }; }

  const resolved = resolveMovieBoxJson(rawJson);
  if (!resolved || !resolved.resData) {
    return { success: false, error: 'Failed to resolve detail data' };
  }

  return { success: true, data: transformDetail(resolved) };
}

async function handlePlay(params, cookies) {
  const subjectId = params.get('subjectId') || params.get('id') || '';
  const se = params.get('se') || params.get('season') || '0';
  const ep = params.get('ep') || params.get('episode') || '0';
  const detailPath = params.get('detailPath') || '';

  if (!subjectId) return { success: false, error: 'No subjectId' };

  // --- Check if it's a Custom VPS Movie stream ---
  if (subjectId.startsWith('custom_')) {
    const customId = subjectId.replace('custom_', '');
    const custom = await fetchCustomMovies();
    const movie = custom.find(c => c.id === customId);
    if (movie) {
      let videoUrl = movie.video_url;
      // Handle if episode video_url is defined (for series)
      if (movie.type === 'series') {
        const snum = parseInt(se || '1');
        const epnum = parseInt(ep || '1');
        const sData = movie.seasons?.find(s => s.season === snum);
        const eData = sData?.episodes?.find(e => e.episode === epnum);
        if (eData && eData.video_url) videoUrl = eData.video_url;
      }
      return {
        success: true,
        url: videoUrl,
        downloads: [
          { url: videoUrl, hlsUrl: videoUrl, resolution: 1080 }
        ],
        captions: movie.captions || [],
        source: 'vps-custom'
      };
    }
  }
  // -----------------------------------------------

  const qs = new URLSearchParams({ subjectId, se, ep }).toString();

  // Exact referer pattern from real MovieBox website
  const referer = detailPath
    ? `${MB_HOST}/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`
    : MB_HOST + '/';

  const playHeaders = {
    'Referer': referer,
    'x-client-info': '{"timezone":"Asia/Bangkok"}',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  // Use themoviebox.org/wefeed-h5api-bff (NOT h5.aoneroom.com/wefeed-h5-bff)
  // This is the endpoint the real website uses
  const playRes = await mbFetch(MB_HOST + '/wefeed-h5api-bff/subject/play?' + qs, {
    headers: playHeaders,
  }, cookies);

  const dlRes = await mbFetch(MB_HOST + '/wefeed-h5api-bff/subject/download?' + qs, {
    headers: playHeaders,
  }, cookies);

  const playData = playRes.json?.code === 0 ? playRes.json.data : null;
  const dlData = dlRes.json?.code === 0 ? dlRes.json.data : null;

  return transformStream(playData, dlData, { subjectId, se, ep, playRaw: playRes.raw, dlRaw: dlRes.raw });
}

// ── Transform helpers ───────────────────────────────────────────────────────

// Worker base URL
const SELF_URL = 'https://json.oflix.workers.dev';

// Netlify image proxy for poster resize
const IMG_PROXY = 'https://funny-kitten-ad51d6.netlify.app/img';

function optimizePoster(url, thumbnail) {
  if (!url && !thumbnail) return '';
  const src = url || thumbnail;
  return `${IMG_PROXY}?url=${encodeURIComponent(src)}&w=400&q=70`;
}

function transformItem(item) {
  const sub = item.subject || item;
  const cover = sub.cover?.url || item.image?.url || '';
  const thumb = sub.cover?.thumbnail || item.image?.thumbnail || '';
  return {
    title: sub.title || item.title || '',
    poster: optimizePoster(cover, thumb),
    detailPath: sub.detailPath || item.detailPath || '',
    year: (sub.releaseDate || '').slice(0, 4),
    rating: String(sub.imdbRatingValue || sub.imdbRate || ''),
    genre: typeof sub.genre === 'string' ? sub.genre.split(',').map(s => s.trim()) : (sub.genre || ''),
    type: (sub.subjectType || item.subjectType) === 2 ? 'series' : 'film',
    country: sub.countryName || '',
    duration: sub.duration || '',
    subjectId: sub.subjectId || item.subjectId || '',
  };
}

function resolveMovieBoxJson(data) {
  if (!Array.isArray(data)) return null;

  function resolveValue(val) {
    if (Array.isArray(val)) {
      // Check if associative-like (object keys)
      return val.map(v => {
        if (typeof v === 'number' && data[v] !== undefined) return resolveValue(data[v]);
        return resolveValue(v);
      });
    }
    if (val && typeof val === 'object') {
      const result = {};
      for (const [k, v] of Object.entries(val)) {
        if (typeof v === 'number' && data[v] !== undefined) {
          result[k] = resolveValue(data[v]);
        } else {
          result[k] = resolveValue(v);
        }
      }
      return result;
    }
    return val;
  }

  for (const entry of data) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const keys = Object.keys(entry);
      if (keys.some(k => k.startsWith('$s'))) {
        const resolved = {};
        for (const [k, v] of Object.entries(entry)) {
          const cleanKey = k.startsWith('$s') ? k.slice(2) : k;
          const val = typeof v === 'number' && data[v] !== undefined ? data[v] : v;
          resolved[cleanKey] = resolveValue(val);
        }
        return resolved;
      }
    }
  }
  return null;
}

function transformDetail(mbData) {
  const rd = mbData.resData || {};
  const subject = rd.subject || {};
  const meta = rd.metadata || {};
  const stars = rd.stars || [];
  const res = rd.resource || {};

  let genre = subject.genre || '';
  if (typeof genre === 'string') genre = genre.split(',').map(s => s.trim());

  const cast = stars.map(s => ({
    name: s.name || '',
    character: s.character || '',
    avatar: s.avatarUrl ? `${IMG_PROXY}?url=${encodeURIComponent(s.avatarUrl)}&w=120&q=60` : '',
  }));

  const rawSeasons = (res.seasons || []).map(se => {
    const eps = [];
    for (let e = 1; e <= (se.maxEp || 0); e++) {
      const pUrl = `${MB_HOST}/play?id=${subject.subjectId || ''}&season=${se.se || 1}&episode=${e}&detailPath=${subject.detailPath || ''}`;
      eps.push({ episode: e, title: 'Episode ' + e, playerUrl: pUrl, url: pUrl, thumbnail: '', duration: '' });
    }
    return { season: se.se || 1, episodes: eps };
  });

  // Filter empty seasons - if no real episodes, treat as movie
  const seasons = rawSeasons.filter(s => s.episodes.length > 0);
  const totalEps = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const isMovie = totalEps === 0 || subject.subjectType === 1;

  const playerUrl = isMovie
    ? `${MB_HOST}/play?id=${subject.subjectId || ''}&season=0&episode=0&detailPath=${subject.detailPath || ''}`
    : '';

  const cover = subject.cover?.url || subject.cover?.thumbnail || meta.image || '';

  // Trailer: can be string, object with videoAddress, or null
  let trailerUrl = '';
  const trailer = subject.trailer;
  if (typeof trailer === 'string' && trailer) {
    trailerUrl = trailer;
  } else if (trailer && typeof trailer === 'object') {
    trailerUrl = trailer.videoAddress?.url || trailer.url || '';
  }

  return {
    title: subject.title || meta.title || '',
    poster: `${IMG_PROXY}?url=${encodeURIComponent(cover)}&w=800&q=75`,
    year: (subject.releaseDate || '').slice(0, 4),
    rating: String(subject.imdbRatingValue || subject.imdbRate || ''),
    genre, description: subject.description || meta.description || '',
    country: subject.countryName || '', duration: subject.duration || '',
    network: '', cast, trailerUrl,
    playerUrl, sources: playerUrl ? [{ url: playerUrl }] : [],
    seasons: isMovie ? [] : seasons, subjectId: subject.subjectId || '',
  };
}

function transformStream(playData, dlData, debug) {
  const videoProxy = 'https://uid5558280582469143984atp3ext1774623069exp1782.eyjhbgcioijiuzi1niisinr5cci6ikpxvcj9eyj1awqiojy1nta3mda1mta1mz.workers.dev/?url=';

  const downloads = [];

  // From download endpoint
  if (dlData?.downloads) {
    for (const dl of dlData.downloads) {
      if (dl.url) {
        const dlRes = parseInt(dl.resolution) || 0;
        downloads.push({
          url: videoProxy + encodeURIComponent(dl.url),
          resolution: dlRes,
          label: dlRes ? `${dlRes}p` : 'Auto',
        });
      }
    }
  }

  // From play endpoint streams
  if (playData?.streams) {
    for (const st of playData.streams) {
      if (st.url) {
        const stRes = parseInt(st.resolutions || st.resolution) || 0;
        downloads.push({
          url: videoProxy + encodeURIComponent(st.url),
          resolution: stRes,
          label: stRes ? `${stRes}p` : 'Auto',
        });
      }
    }
  }

  // Dedup by resolution (keep first of each)
  const seen = new Set();
  const uniqueDownloads = [];
  for (const d of downloads) {
    const key = d.resolution;
    if (!seen.has(key)) { seen.add(key); uniqueDownloads.push(d); }
  }
  uniqueDownloads.sort((a, b) => (b.resolution || 0) - (a.resolution || 0));

  let mainUrl = uniqueDownloads[0]?.url || '';

  // Check HLS from MovieBox — still proxy through VPS or CF worker
  if (playData?.hls?.length) {
    const hlsUrl = playData.hls[0]?.url || playData.hls[0];
    if (typeof hlsUrl === 'string' && hlsUrl) mainUrl = videoProxy + encodeURIComponent(hlsUrl);
  }

  // Bunny HLS URL for main quality
  const hlsMainUrl = uniqueDownloads[0]?.hlsUrl || '';

  // Captions from download endpoint
  const captions = [];
  if (dlData?.captions) {
    for (const cap of dlData.captions) {
      if (cap.url) captions.push({ url: cap.url, languageCode: cap.lan || '', lan: cap.lan || '', language: cap.lanName || '' });
    }
  }

  const hasContent = !!(mainUrl || uniqueDownloads.length > 0);

  return {
    success: hasContent === true,
    url: mainUrl,
    downloads: uniqueDownloads,
    captions,
    source: 'moviebox-worker',
    ...(hasContent ? {} : { error: 'No streams available', _debug: debug }),
  };
}

// ── Main handler ────────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const path = url.pathname.replace(/^\/+/, '');
    const params = url.searchParams;

    // ── Image proxy with resize ──────────────────────────────────────────
    if (path === 'img') {
      const imgUrl = params.get('url');
      const w = parseInt(params.get('w') || '400');
      if (!imgUrl) return new Response('No url', { status: 400 });
      try {
        const resp = await fetch(imgUrl, {
          headers: { 'Referer': MB_HOST + '/', 'User-Agent': HEADERS['User-Agent'] },
          cf: { image: { width: w, quality: 75, fit: 'cover', format: 'webp' } },
        });
        const headers = new Headers(resp.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=604800'); // 7 days
        return new Response(resp.body, { headers });
      } catch {
        // Fallback: just proxy without resize (cf.image not available on free plan)
        const resp = await fetch(imgUrl, {
          headers: { 'Referer': MB_HOST + '/', 'User-Agent': HEADERS['User-Agent'] },
        });
        const headers = new Headers(resp.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=604800');
        return new Response(resp.body, { headers });
      }
    }

    // ── API cache layer (use CF Cache API) ───────────────────────────────
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;

    // Skip cache for play/stream/download (dynamic)
    const cacheable = !path.startsWith('api/play') && !path.startsWith('api/stream') && !path.startsWith('api/download');

    if (cacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    try {
      const cookies = await ensureCookies();
      let result;

      switch (path) {
        case 'api/home':
          result = await handleHome(cookies);
          break;
        case 'api/search':
          result = await handleSearch(params, cookies);
          break;
        case 'api/detail':
          result = await handleDetail(params, cookies);
          break;
        case 'api/play':
        case 'api/stream':
        case 'api/download':
          result = await handlePlay(params, cookies);
          break;

        default:
          result = {
            success: false,
            error: 'Unknown endpoint',
          };
      }

      // ── Encrypt response if client sends X-OE header ──────────────────
      const wantEncrypt = request.headers.get('X-OE') === '1';
      let body, contentType;

      if (wantEncrypt) {
        // Encrypt JSON with rotating XOR key
        const jsonStr = JSON.stringify(result);
        const encrypted = oflixEncrypt(jsonStr);
        body = encrypted;
        contentType = 'text/plain';
      } else {
        body = JSON.stringify(result, null, 2);
        contentType = 'application/json';
      }

      const response = new Response(body, {
        headers: {
          ...CORS,
          'Content-Type': contentType,
          'Cache-Control': cacheable ? 'public, max-age=600' : 'no-store, no-cache, must-revalidate',
        }
      });

      // Store in CF edge cache (only unencrypted for cache)
      if (cacheable && result?.success && !wantEncrypt) {
        response.headers.set('Cache-Control', 'public, max-age=600');
        await cache.put(cacheKey, response.clone());
      }

      return response;
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500, headers: CORS
      });
    }
  },
};

// ── Encryption: XOR with rotating key + base64 ─────────────────────────────
// Shared secret between worker and frontend. Change periodically.
const OE_KEY = 'oFl1x_2026_sEcReT_kEy!@#';

function oflixEncrypt(plaintext) {
  const keyBytes = new TextEncoder().encode(OE_KEY);
  const textBytes = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    encrypted[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  // Base64 encode
  return btoa(String.fromCharCode(...encrypted));
}