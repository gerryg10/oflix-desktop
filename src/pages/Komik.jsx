import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchKomikPopuler, stripQuery } from '../api.js';
import MovieCard from '../components/MovieCard.jsx';

export default function KomikPage() {
  const [items, setItems]   = useState([]);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const nav = useNavigate();

  async function loadPage(p, append = false) {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetchKomikPopuler(p);
      if (res.status === 'ok' && res.data?.length) {
        const mapped = res.data.map(d => ({ ...d, poster: stripQuery(d.poster || '') }));
        setItems(prev => append ? [...prev, ...mapped] : mapped);
        setPage(p);
        setHasMore(res.data.length > 0);
      } else { setHasMore(false); }
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadPage(1, false); }, []);

  return (
    <div className="listing-page">
      <h2 className="listing-title">📚 Komik</h2>
      <div className="komik-grid">
        {items.map((item, i) => (
          <MovieCard
            key={i}
            item={{ title: item.title, poster: item.poster }}
            onClick={() => nav(`/komik/detail?d=${encodeURIComponent(item.detailManga)}`)}
          />
        ))}
      </div>
      {loading && <div className="spinner-center"><div className="spinner" /></div>}
      {hasMore && !loading && (
        <button className="load-more-btn" onClick={() => loadPage(page + 1, true)}>
          Muat Lebih Banyak
        </button>
      )}
    </div>
  );
}
