import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const NAV_LINKS = [
  { label: 'Beranda', path: '/' },
  { label: 'Film',    path: '/film' },
  { label: 'Series',  path: '/series' },
  { label: 'Anichin', path: '/donghua' },
  { label: 'Komik',   path: '/komik' },
];

const HIDE_ROUTES = ['/detail', '/baca'];

export default function AppHeader() {
  const hiddenRef     = useRef(false);
  const lastScrollRef = useRef(0);
  const headerRef     = useRef(null);
  const loc           = useLocation();
  const nav           = useNavigate();

  const isHiddenRoute = HIDE_ROUTES.some(r => loc.pathname.startsWith(r));

  useEffect(() => {
    function onScroll() {
      const st  = window.scrollY || document.documentElement.scrollTop;
      const hdr = headerRef.current;
      if (!hdr) return;
      if (st > 40) hdr.classList.add('scrolled');
      else         hdr.classList.remove('scrolled');
      const diff = st - lastScrollRef.current;
      if (diff > 4 && st > 100 && !hiddenRef.current) {
        hiddenRef.current = true;
        hdr.classList.add('header-hidden');
      } else if (diff < -4 && hiddenRef.current) {
        hiddenRef.current = false;
        hdr.classList.remove('header-hidden');
      }
      lastScrollRef.current = st;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (isHiddenRoute) return null;

  function activeCheck(path) {
    if (path === '/') return loc.pathname === '/';
    return loc.pathname.startsWith(path);
  }

  return (
    <header ref={headerRef} className="app-header">
      <div className="header-top">
        <img
          src="/logo1.png" alt="OFLIX" className="header-logo"
          onClick={() => nav('/')}
          onError={e => { e.target.style.display = 'none'; }}
        />

        <nav className="header-nav">
          {NAV_LINKS.map(link => (
            <button
              key={link.path}
              className={`header-nav-link ${activeCheck(link.path) ? 'active' : ''}`}
              onClick={() => nav(link.path)}
            >
              {link.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button
            className="header-action-btn"
            onClick={() => nav('/search')}
            title="Cari"
          >
            <i className="fas fa-search" />
          </button>
          <button
            className="header-action-btn"
            title="Akun"
            onClick={() => {
              // dispatch account click — will be handled by parent
              window.dispatchEvent(new CustomEvent('oflix-show-auth'));
            }}
          >
            <i className="fas fa-user" />
          </button>
        </div>
      </div>
    </header>
  );
}
