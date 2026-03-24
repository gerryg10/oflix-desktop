import { useEffect, useRef, useState } from 'react';
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
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Get profile from context via window (to avoid circular import)
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    // Read profile from App's context — we use a DOM trick
    const check = () => {
      try {
        const el = document.getElementById('root');
        if (el?.__oflix_profile) setProfile(el.__oflix_profile);
      } catch {}
    };
    check();
    const tid = setInterval(check, 1000);
    return () => clearInterval(tid);
  }, []);

  // Simpler: listen for custom event with profile data
  useEffect(() => {
    function onProfile(e) { setProfile(e.detail); }
    window.addEventListener('oflix-profile-update', onProfile);
    return () => window.removeEventListener('oflix-profile-update', onProfile);
  }, []);

  // Broadcast profile on mount from localStorage token verify
  useEffect(() => {
    const token = localStorage.getItem('oflix_token');
    if (!token) return;
    fetch(`/auth_api.php?action=verify&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(res => { if (res.ok && res.profile) setProfile(res.profile); })
      .catch(() => {});
  }, []);

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

  // Close menu on click outside
  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (isHiddenRoute) return null;

  function activeCheck(path) {
    if (path === '/') return loc.pathname === '/';
    return loc.pathname.startsWith(path);
  }

  const initial = (profile?.username || '?')[0].toUpperCase();

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
          <button className="header-action-btn" onClick={() => nav('/search')} title="Cari">
            <i className="fas fa-search" />
          </button>

          {/* Profile avatar + dropdown */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(v => !v)}
              style={{
                width: 36, height: 36, borderRadius: '8px', border: 'none',
                background: profile?.avatar_url ? 'transparent' : (profile?.avatar_color || '#e50914'),
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', transition: 'box-shadow 0.2s',
                boxShadow: showMenu ? '0 0 0 2px #fff' : 'none',
              }}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}
                  onError={e => { e.target.style.display='none'; }} />
              ) : (
                <span style={{ color:'#fff', fontSize:16, fontWeight:900, fontFamily:'var(--font-display)' }}>{initial}</span>
              )}
            </button>

            {showMenu && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                background: 'rgba(18,18,18,0.97)', border: '1px solid #2a2d35',
                borderRadius: 12, minWidth: 200, overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)', zIndex: 9999,
                animation: 'fadeIn 0.15s ease',
              }}>
                {/* Profile info */}
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #1e2028', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '8px',
                    background: profile?.avatar_color || '#e50914',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'var(--font-display)',
                    overflow: 'hidden', flexShrink: 0,
                  }}>
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      : initial}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{profile?.username}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>Profile aktif</div>
                  </div>
                </div>

                {/* Menu items */}
                {[
                  { label: 'Profil Saya', icon: 'fa-user', action: () => { nav(`/profile?u=${encodeURIComponent(profile?.username||'')}`); setShowMenu(false); } },
                  { label: 'Ganti Profile', icon: 'fa-users', action: () => { window.dispatchEvent(new CustomEvent('oflix-switch-profile')); setShowMenu(false); } },
                  { label: 'Keluar', icon: 'fa-sign-out-alt', action: () => { window.dispatchEvent(new CustomEvent('oflix-logout')); setShowMenu(false); }, danger: true },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    style={{
                      width: '100%', padding: '12px 16px', background: 'none', border: 'none',
                      color: item.danger ? '#ff6b6b' : '#bbb', fontSize: 13, fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      transition: 'background 0.15s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <i className={`fas ${item.icon}`} style={{ width: 16, textAlign: 'center', fontSize: 12 }} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
