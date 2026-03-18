import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function BottomNav({ onAccountClick }) {
  const nav  = useNavigate();
  const loc  = useLocation();
  const { user } = useAuth();

  const items = [
    { icon: 'fas fa-home',    label: 'Beranda', path: '/'       },
    { icon: 'fas fa-search',  label: 'Cari',    path: '/search' },
    { icon: 'fas fa-user',    label: 'Akun',    path: '__account' },
  ];

  function handleClick(item) {
    if (item.path === '__account') {
      onAccountClick?.();
    } else {
      nav(item.path);
    }
  }

  function isActive(item) {
    if (item.path === '__account') return false;
    if (item.path === '/') return loc.pathname === '/';
    return loc.pathname.startsWith(item.path);
  }

  return (
    <nav className="bottom-nav">
      {items.map(item => (
        <button
          key={item.label}
          className={`nav-item ${isActive(item) ? 'active' : ''}`}
          onClick={() => handleClick(item)}
        >
          <i className={item.icon}></i>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
