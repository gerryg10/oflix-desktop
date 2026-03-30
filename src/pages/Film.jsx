import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCategory } from '../api.js';
import MovieCard from '../components/MovieCard.jsx';

const CAT_LABELS = {
  'trending':          'Film',
  'indonesian-movies': 'Film Indonesia',
  'western':           'Series Barat',
};

async function fetchCustom(cat) {
  try {
    const res  = await fetch(`/admin-update.php?action=get&cat=${encodeURIComponent(cat)}`);
    const data = await res.json();
    if (data.success && data.items?.length) return data;
    return null;
  } catch { return null; }
}

export default function FilmPage({ onCardClick }) {
  const [params] = useSearchParams();
  const cat      = params.get('cat') || 'trending';
  const [items, setItems]     = useState([]);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isCustom, setIsCustom] = useState(false);

  async function loadPage(p, append = false) {
    if (loading) return;
    setLoading(true);
    try {
      // First page: check for custom data
      if (p === 1 && !append) {
        const custom = await fetchCustom('film-custom');
        if (custom) {
          setItems(custom.items);
          setIsCustom(true);
          setHasMore(false); // custom = no pagination
          setLoading(false);
          return;
        }
      }
      // Fallback: fetch from cache_api.php (FoodCash)
      const res = await fetchCategory(cat, p);
      if (res.success && res.items?.length) {
        setItems(prev => append ? [...prev, ...res.items] : res.items);
        setPage(p);
        setHasMore(res.items.length >= 1);
        setIsCustom(false);
      } else {
        setHasMore(false);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    setItems([]); setPage(1); setHasMore(true); setIsCustom(false);
    loadPage(1, false);
  }, [cat]);

  return (
    <div className="listing-page">
      <h2 className="listing-title">
        {CAT_LABELS[cat] || '🎬 Film'}
        {isCustom && <span style={{ fontSize: 12, color: '#e50914', marginLeft: 10, fontWeight: 400 }}>✦ Custom</span>}
      </h2>
      <div className="listing-grid">
        {items.map((item, i) => (
          <MovieCard key={i} item={item} onClick={onCardClick} />
        ))}
      </div>
      {loading && <div className="spinner-center"><div className="spinner" /></div>}
      {hasMore && !loading && !isCustom && (
        <button className="load-more-btn" onClick={() => loadPage(page + 1, true)}>
          Muat Lebih Banyak
        </button>
      )}
    </div>
  );
}
