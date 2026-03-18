import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import Preloader   from './components/Preloader.jsx';
import AppHeader   from './components/AppHeader.jsx';
import AuthModal   from './components/AuthModal.jsx';
import Home        from './pages/Home.jsx';
import FilmPage    from './pages/Film.jsx';
import SeriesPage  from './pages/Series.jsx';
import DonghuaPage from './pages/Donghua.jsx';
import KomikPage   from './pages/Komik.jsx';
import KomikDetail from './pages/KomikDetail.jsx';
import SearchPage  from './pages/Search.jsx';
import DetailPage  from './pages/Detail.jsx';

const FULL_ROUTES = ['/detail'];

function AppInner() {
  const nav = useNavigate();
  const loc = useLocation();
  const [ready, setReady]       = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const isFull = FULL_ROUTES.some(r => loc.pathname.startsWith(r));

  // Listen for auth event from header
  useEffect(() => {
    function onShowAuth() { setShowAuth(true); }
    window.addEventListener('oflix-show-auth', onShowAuth);
    return () => window.removeEventListener('oflix-show-auth', onShowAuth);
  }, []);

  function handleCardClick(item) {
    if (item?.detailPath) nav(`/detail?p=${encodeURIComponent(item.detailPath)}`);
  }

  return (
    <>
      {!ready && <Preloader onDone={() => setReady(true)} />}
      {ready && (
        <>
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
            </Routes>
          </div>
          {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
        </>
      )}
    </>
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
