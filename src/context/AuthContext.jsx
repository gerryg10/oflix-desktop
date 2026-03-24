import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AuthCtx = createContext(null);
const AUTH_API = '/auth_api.php';

async function apiPost(action, body = {}) {
  const token = localStorage.getItem('oflix_token');
  if (!token) return { ok: false };
  const res = await fetch(`${AUTH_API}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token }),
  });
  return res.json();
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // ── In-memory cache (fetched from DB once, updated on write) ──
  const [cwCache, setCwCache]           = useState([]);
  const [wlCache, setWlCache]           = useState([]);
  const [cwLoaded, setCwLoaded]         = useState(false);
  const [wlLoaded, setWlLoaded]         = useState(false);

  const getToken = () => localStorage.getItem('oflix_token');

  // ── Init: verify token ──
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    fetch(`${AUTH_API}?action=verify&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(res => {
        if (res.ok && res.profile) {
          setUser({ token, username: res.profile.username, profile: res.profile });
        } else {
          localStorage.removeItem('oflix_token');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Fetch CW from DB (once after login) ──
  const fetchCW = useCallback(async () => {
    const res = await apiPost('getCW');
    if (res.ok && res.cw) {
      setCwCache(res.cw);
      setCwLoaded(true);
    }
  }, []);

  // ── Fetch watchlist from DB ──
  const fetchWL = useCallback(async () => {
    const res = await apiPost('getWatchlist');
    if (res.ok && res.watchlist) {
      setWlCache(res.watchlist);
      setWlLoaded(true);
    }
  }, []);

  // Auto-fetch on user set
  useEffect(() => {
    if (user) {
      fetchCW();
      fetchWL();
    }
  }, [user]);

  // ══════════════════════════════════════════════════════
  // CONTINUE WATCHING — save to DB, update cache
  // ══════════════════════════════════════════════════════
  function saveCW(payload) {
    // Fire-and-forget to DB
    apiPost('saveCW', {
      type: 'foodcash',
      key: payload.detailPath,
      data: payload,
    }).catch(() => {});

    // Update local cache immediately
    setCwCache(prev => {
      const filtered = prev.filter(c => c._key !== payload.detailPath && c.detailPath !== payload.detailPath);
      const item = { ...payload, _type: 'foodcash', _key: payload.detailPath, savedAt: Date.now() };
      return [item, ...filtered].slice(0, 50);
    });
  }

  function getAllCW() {
    // Return video CW items (not komik)
    return cwCache.filter(c => c.type !== 'komik' && c.time > 5)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, 15);
  }

  function getSavedProgress(detailPath, episodeIdx) {
    const item = cwCache.find(c => (c._key === detailPath || c.detailPath === detailPath));
    if (!item) return null;
    if (episodeIdx !== undefined && item.episode !== episodeIdx) return null;
    return item;
  }

  // ══════════════════════════════════════════════════════
  // KOMIK PROGRESS — also saved via CW with type='komik'
  // ══════════════════════════════════════════════════════
  function saveKomikProgress(slug, chapterIdx, chapterTitle, poster, seriesTitle, pageIdx = 0) {
    const payload = {
      slug, chapterIdx, chapterTitle, poster, seriesTitle, pageIdx,
      type: 'komik', detailPath: slug,
    };
    apiPost('saveCW', {
      type: 'komik',
      key: slug,
      data: payload,
    }).catch(() => {});

    setCwCache(prev => {
      const filtered = prev.filter(c => c._key !== slug);
      const item = { ...payload, _type: 'komik', _key: slug, savedAt: Date.now() };
      return [item, ...filtered].slice(0, 50);
    });
  }

  function getKomikProgress(slug) {
    const item = cwCache.find(c => c._key === slug && c.type === 'komik');
    return item || null;
  }

  function getAllKomikProgress() {
    return cwCache.filter(c => c.type === 'komik')
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, 10);
  }

  // ══════════════════════════════════════════════════════
  // WATCHLIST — DB only
  // ══════════════════════════════════════════════════════
  function getWatchlist() {
    return wlCache;
  }

  function addToWatchlist(item) {
    if (wlCache.find(w => w.detailPath === item.detailPath)) return;
    apiPost('addWatchlist', {
      title: item.title,
      detailPath: item.detailPath,
      poster: item.poster,
      itemType: item.type || 'video',
    }).catch(() => {});

    setWlCache(prev => [
      { title: item.title, detailPath: item.detailPath, poster: item.poster, type: item.type || 'video', addedAt: Date.now() },
      ...prev,
    ].slice(0, 50));
  }

  function removeFromWatchlist(detailPath) {
    apiPost('removeWatchlist', { detailPath }).catch(() => {});
    setWlCache(prev => prev.filter(w => w.detailPath !== detailPath));
  }

  function isInWatchlist(detailPath) {
    return wlCache.some(w => w.detailPath === detailPath);
  }

  // ══════════════════════════════════════════════════════
  // LIKES — DB only
  // ══════════════════════════════════════════════════════
  function setLike(detailPath, likeAction, title = '', poster = '') {
    apiPost('setLike', { detailPath, likeAction, title, poster }).catch(() => {});
  }

  async function getLike(detailPath) {
    const res = await apiPost('getLike', { detailPath });
    return res.ok ? res.action : 'none';
  }

  // ══════════════════════════════════════════════════════
  // HISTORY — DB only
  // ══════════════════════════════════════════════════════
  function addHistory(detailPath, title = '', poster = '', itemType = 'video') {
    apiPost('addHistory', { detailPath, title, poster, itemType }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════
  // LEGACY compat (login/register/logout kept for AuthModal if still used)
  // ══════════════════════════════════════════════════════
  const login    = async (u, p) => ({ ok: false, error: 'Use profile picker' });
  const register = async (u, p) => ({ ok: false, error: 'Use profile picker' });
  const logout   = () => {
    localStorage.removeItem('oflix_token');
    setUser(null);
    setCwCache([]);
    setWlCache([]);
  };

  return (
    <AuthCtx.Provider value={{
      user, loading,
      login, register, logout,
      saveCW, getAllCW, getSavedProgress,
      saveKomikProgress, getKomikProgress, getAllKomikProgress,
      getWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist,
      setLike, getLike,
      addHistory,
      fetchCW, fetchWL,
      cwLoaded, wlLoaded,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
