import { useNavigate, useLocation } from 'react-router-dom';

const CATS = [
  { label: '🏠 Beranda', path: '/'        },
  { label: '🎬 Film',    path: '/film'    },
  { label: '📺 Series',  path: '/series'  },
  { label: '🐲 Anichin', path: '/donghua' },
  { label: '📚 Komik',   path: '/komik'   },
];

const HIDE_ROUTES = ['/detail', '/baca', '/search', '/komik/detail'];

export default function CategoryTabs() {
  const nav = useNavigate();
  const loc = useLocation();

  if (HIDE_ROUTES.some(r => loc.pathname.startsWith(r))) return null;

  function activeCat() {
    if (loc.pathname === '/') return '/';
    return CATS.slice(1).find(c => loc.pathname.startsWith(c.path))?.path || '';
  }

  return (
    <div className="category-tabs">
      {CATS.map(cat => (
        <a key={cat.path}
          className={`cat-tab ${activeCat() === cat.path ? 'active' : ''}`}
          onClick={e => { e.preventDefault(); nav(cat.path); }}
          href={cat.path}>
          {cat.label}
        </a>
      ))}
    </div>
  );
}
