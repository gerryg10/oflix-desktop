import { createContext, useContext, useState, useEffect } from 'react';
import { authVerify, authGetCW, authLogin, authRegister, authSaveCW } from '../api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  const getToken    = () => localStorage.getItem('oflix_token');
  const getUsername = () => localStorage.getItem('oflix_uname');
  const saveAuth    = (token, username) => {
    localStorage.setItem('oflix_token', token);
    localStorage.setItem('oflix_uname', username);
    setUser({ token, username });
  };
  const clearAuth = () => {
    localStorage.removeItem('oflix_token');
    localStorage.removeItem('oflix_uname');
    setUser(null);
  };

  useEffect(() => {
    const token = getToken();
    const uname = getUsername();
    if (!token || !uname) { setLoading(false); return; }
    setUser({ token, username: uname }); // optimistic
    authVerify(token)
      .then(res => { if (!res.ok) clearAuth(); else saveAuth(token, res.username); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login    = async (u, p) => { const r = await authLogin(u, p);    if (r.ok) saveAuth(r.token, r.username); return r; };
  const register = async (u, p) => { const r = await authRegister(u, p); if (r.ok) saveAuth(r.token, r.username); return r; };
  const logout   = () => clearAuth();

  // ── CW key uses 'guest' for non-logged users ──────────────
  function cwKey(detailPath) {
    const uname = user?.username || getUsername() || 'guest';
    return `oflix_cw_${uname}_${(detailPath||'').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  }

  function saveCW(payload) {
    localStorage.setItem(cwKey(payload.detailPath), JSON.stringify({ ...payload, savedAt: Date.now() }));
    const token = getToken();
    if (token) authSaveCW(token, 'foodcash', payload.detailPath, payload);
  }

  function getAllCW() {
    const uname  = user?.username || getUsername() || 'guest';
    const prefix = `oflix_cw_${uname}_`;
    const map    = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k));
        if (!d?.detailPath) continue;
        if (d.time <= 5) continue;
        const ex = map.get(d.detailPath);
        if (!ex || (d.savedAt||0) > (ex.savedAt||0)) map.set(d.detailPath, d);
      } catch {}
    }
    return Array.from(map.values()).sort((a, b) => (b.savedAt||0) - (a.savedAt||0)).slice(0, 15);
  }

  function getSavedProgress(detailPath, episodeIdx) {
    try {
      const raw = localStorage.getItem(cwKey(detailPath));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (episodeIdx !== undefined && d.episode !== episodeIdx) return null;
      return d;
    } catch { return null; }
  }

  // ── Komik read progress (localStorage only) ─────────────
  function saveKomikProgress(slug, chapterIdx, chapterTitle, poster, seriesTitle, pageIdx = 0) {
    const key = `oflix_komik_${slug}`;
    localStorage.setItem(key, JSON.stringify({
      slug, chapterIdx, chapterTitle, poster, seriesTitle, pageIdx,
      type: 'komik', savedAt: Date.now(),
    }));
  }

  function getKomikProgress(slug) {
    try {
      const raw = localStorage.getItem(`oflix_komik_${slug}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function getAllKomikProgress() {
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('oflix_komik_')) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k));
        if (d?.slug) result.push(d);
      } catch {}
    }
    return result.sort((a, b) => (b.savedAt||0) - (a.savedAt||0)).slice(0, 10);
  }

  // ── Watchlist (Daftar +) — works without login ───────────
  const WL_KEY = 'oflix_watchlist';

  function getWatchlist() {
    try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; }
    catch { return []; }
  }

  function addToWatchlist(item) {
    const wl = getWatchlist();
    if (wl.find(w => w.detailPath === item.detailPath)) return; // already in list
    wl.unshift({ title: item.title, detailPath: item.detailPath, poster: item.poster, type: item.type || 'video', addedAt: Date.now() });
    localStorage.setItem(WL_KEY, JSON.stringify(wl.slice(0, 50)));
  }

  function removeFromWatchlist(detailPath) {
    const wl = getWatchlist().filter(w => w.detailPath !== detailPath);
    localStorage.setItem(WL_KEY, JSON.stringify(wl));
  }

  function isInWatchlist(detailPath) {
    return getWatchlist().some(w => w.detailPath === detailPath);
  }

  return (
    <AuthCtx.Provider value={{
      user, loading,
      login, register, logout,
      saveCW, getAllCW, getSavedProgress,
      saveKomikProgress, getKomikProgress, getAllKomikProgress,
      getWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
