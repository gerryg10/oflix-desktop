import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import Preloader      from './components/Preloader.jsx';
import ProfilePicker  from './components/ProfilePicker.jsx';
import AppHeader      from './components/AppHeader.jsx';
import AuthModal      from './components/AuthModal.jsx';
import Home           from './pages/Home.jsx';
import FilmPage       from './pages/Film.jsx';
import SeriesPage     from './pages/Series.jsx';
import DonghuaPage    from './pages/Donghua.jsx';
import KomikPage      from './pages/Komik.jsx';
import KomikDetail    from './pages/KomikDetail.jsx';
import SearchPage     from './pages/Search.jsx';
import DetailPage     from './pages/Detail.jsx';
import ProfilePage    from './pages/ProfilePage.jsx';

// ── Profile Context (global) ──
const ProfileCtx = createContext(null);
export function useProfile() { return useContext(ProfileCtx); }

const FULL_ROUTES = ['/detail'];

function AppInner() {
  const nav = useNavigate();
  const loc = useLocation();
  const [ready, setReady]         = useState(false);
  const [profile, setProfile]     = useState(null);
  const [token, setToken]         = useState(null);
  const [checking, setChecking]   = useState(true);
  const [showAuth, setShowAuth]   = useState(false);
  const [showedPreloader, setShowedPreloader] = useState(false);

  const isFull = FULL_ROUTES.some(r => loc.pathname.startsWith(r));

  // ── On mount: check saved token ──
  useEffect(() => {
    const saved = localStorage.getItem('oflix_token');
    if (!saved) {
      setChecking(false);
      return;
    }
    // Verify token with backend
    fetch(`/auth_api.php?action=verify&token=${encodeURIComponent(saved)}`)
      .then(r => r.json())
      .then(res => {
        if (res.ok && res.profile) {
          setProfile(res.profile);
          setToken(saved);
        } else {
          localStorage.removeItem('oflix_token');
        }
        setChecking(false);
      })
      .catch(() => {
        setChecking(false);
      });
  }, []);

  // Auth event from header
  useEffect(() => {
    function onShowAuth() { setShowAuth(true); }
    window.addEventListener('oflix-show-auth', onShowAuth);
    return () => window.removeEventListener('oflix-show-auth', onShowAuth);
  }, []);

  // Switch profile event
  useEffect(() => {
    function onSwitch() {
      if (token) {
        fetch('/auth_api.php?action=switchProfile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).catch(() => {});
      }
      localStorage.removeItem('oflix_token');
      setProfile(null);
      setToken(null);
      nav('/');
    }
    window.addEventListener('oflix-switch-profile', onSwitch);
    return () => window.removeEventListener('oflix-switch-profile', onSwitch);
  }, [token]);

  // Logout event
  useEffect(() => {
    function onLogout() {
      if (token) {
        fetch('/auth_api.php?action=logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).catch(() => {});
      }
      localStorage.removeItem('oflix_token');
      setProfile(null);
      setToken(null);
      nav('/');
    }
    window.addEventListener('oflix-logout', onLogout);
    return () => window.removeEventListener('oflix-logout', onLogout);
  }, [token]);

  function handleCardClick(item) {
    if (item?.detailPath) nav(`/detail?p=${encodeURIComponent(item.detailPath)}`);
  }

  function handleLogin(prof, tok) {
    setProfile(prof);
    setToken(tok);
  }

  // ── Preloader (only once) ──
  if (!showedPreloader) {
    return <Preloader onDone={() => setShowedPreloader(true)} />;
  }

  // ── Checking token ──
  if (checking) {
    return (
      <div style={{ minHeight:'100vh', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  // ── No profile → show picker ──
  if (!profile) {
    return <ProfilePicker onLogin={handleLogin} />;
  }

  // ── Logged in ──
  return (
    <ProfileCtx.Provider value={{ profile, token, setProfile }}>
      <AppHeader />
      <div className={isFull ? 'full-page' : 'home-main'}>
        <Routes>
          <Route path="/"             element={<Home        onCardClick={handleCardClick} />} />
          <Route path="/film"         element={<FilmPage    onCardClick={handleCardClick} />} />
          <Route path="/series"       element={<SeriesPage  onCardClick={handleCardClick} />} />
          <Route path="/donghua"      element={<DonghuaPage />} />
          <Route path="/komik"        element={<KomikPage />} />
          <Route path="/komik/detail" element={<KomikDetail />} />
          <Route path="/search"       element={<SearchPage  onCardClick={handleCardClick} />} />
          <Route path="/detail"       element={<DetailPage />} />
          <Route path="/profile"      element={<ProfilePage />} />
        </Routes>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </ProfileCtx.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  );
}
