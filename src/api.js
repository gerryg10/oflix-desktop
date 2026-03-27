/* api.js */

export const API         = '/cache_api.php';
export const AUTH_API    = '/auth_api.php';
export const KOMIK_API   = '/komik_api.php';
export const DONGHUA_API = '/donghua_api.php';
export const WORKER_URL  = 'https://json.oflix.workers.dev';

export function imgProxy(url) { return url || ''; }

export function stripQuery(url) {
  return (url || '').split('?')[0];
}

// ── Frontend in-memory cache (10 menit TTL) ──────────────────────────────────
const _cache = new Map(); // key → { data, ts }
const CACHE_TTL = 10 * 60 * 1000; // 10 menit ms

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ── Inflight dedup — kalau request yang sama lagi jalan, tunggu hasilnya ─────
const _inflight = new Map();

async function safeFetch(url, opts = {}) {
  // Hanya cache GET request tanpa body
  const isGet = !opts.method || opts.method === 'GET';
  const cacheKey = isGet ? url : null;

  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    // Kalau sedang inflight, return promise yang sama
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);

  const promise = (async () => {
    try {
      const res  = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(tid);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error('Non-JSON: ' + text.slice(0, 120)); }
      if (cacheKey) cacheSet(cacheKey, data);
      return data;
    } finally {
      clearTimeout(tid);
      if (cacheKey) _inflight.delete(cacheKey);
    }
  })();

  if (cacheKey) _inflight.set(cacheKey, promise);
  return promise;
}

export async function fetchCategory(action, page = 1) {
  return safeFetch(`${API}?action=${encodeURIComponent(action)}&page=${page}`);
}

export async function fetchDetail(detailPath) {
  return safeFetch(`${API}?action=detail&detailPath=${encodeURIComponent(detailPath)}`);
}

export async function fetchSearch(q, page = 1) {
  return safeFetch(`${API}?action=search&q=${encodeURIComponent(q)}&page=${page}`);
}

// ── Stream: direct to CF Worker — auto-retry on empty response ────────────────
export async function fetchStream(id, season, episode, detailPath) {
  const params = new URLSearchParams({ subjectId: id, detailPath: detailPath || '' });
  if (season) params.set('se', season);
  if (episode) params.set('ep', episode);
  const url = `${WORKER_URL}/api/play?${params.toString()}`;
  
  // Retry up to 3 times — MovieBox intermittently returns empty
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(tid);
      const data = await res.json();
      
      // If success with downloads, return immediately
      if (data.success && (data.downloads?.length > 0 || data.url)) {
        return data;
      }
      
      // Last attempt — return whatever we got
      if (attempt === 3) return data;
      
      // Wait 500ms before retry
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      if (attempt === 3) return { success: false, error: e.message };
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { success: false, error: 'All retries failed' };
}

export async function fetchKomikPopuler(page = 1) {
  return safeFetch(`${KOMIK_API}?action=populer&page=${page}`);
}

export async function fetchKomikDetail(slug) {
  return safeFetch(`${KOMIK_API}?action=detail&detailManga=${encodeURIComponent(slug)}`);
}

export async function fetchKomikSearch(q) {
  return safeFetch(`${KOMIK_API}?action=search&q=${encodeURIComponent(q)}`);
}

export async function fetchDonghuaSearch(q) {
  return safeFetch(`${DONGHUA_API}?action=search&q=${encodeURIComponent(q)}`);
}

export async function fetchDonghuaDetail(slug) {
  return safeFetch(`${DONGHUA_API}?action=detail&slug=${encodeURIComponent(slug)}`);
}

export async function fetchDonghuaPlay(ep) {
  return safeFetch(`${DONGHUA_API}?action=play&ep=${encodeURIComponent(ep)}`);
}

export async function authLogin(username, password) {
  return safeFetch(`${AUTH_API}?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function authRegister(username, password) {
  return safeFetch(`${AUTH_API}?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function authVerify(token) {
  return safeFetch(`${AUTH_API}?action=verify&token=${encodeURIComponent(token)}`);
}

export async function authGetCW(token) {
  return safeFetch(`${AUTH_API}?action=getCW`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function authSaveCW(token, type, key, data) {
  fetch(`${AUTH_API}?action=saveCW`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, type, key, data }),
  }).catch(() => {});
}

export function parseFoodcashUrl(url) {
  try {
    const u = new URL(url);
    return {
      id:         u.searchParams.get('id'),
      season:     u.searchParams.get('season'),
      episode:    u.searchParams.get('episode'),
      detailPath: u.searchParams.get('detailPath'),
    };
  } catch { return {}; }
}

export function ping(page, username = '') {
  fetch(`/panel_api.php?action=ping&page=${encodeURIComponent(page)}&user=${encodeURIComponent(username)}`)
    .catch(() => {});
}

export function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
  return `${m}:${sec.toString().padStart(2,'0')}`;
}
