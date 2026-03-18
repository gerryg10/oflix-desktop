import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSearch, fetchKomikSearch, fetchDonghuaSearch, stripQuery } from '../api.js';

export default function SearchPage({ onCardClick }) {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);
  const nav = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 3) { setResults([]); setSearched(false); return; }
    debounceRef.current = setTimeout(() => doSearch(q.trim()), 450);
  }, [q]);

  async function doSearch(query) {
    setLoading(true);
    const all = [];
    await Promise.allSettled([
      fetchSearch(query, 1).then(res => {
        if (res.success && res.items)
          res.items.forEach(item => all.push({ ...item, _src: 'film', _path: item.detailPath }));
      }).catch(() => {}),
      fetchDonghuaSearch(query).then(res => {
        const items = res.items || res.results || res.data || [];
        items.forEach(item => all.push({
          title: item.title || item.name,
          poster: stripQuery(item.poster || item.thumbnail || ''),
          _src: 'donghua', _slug: item.slug || item.id,
        }));
      }).catch(() => {}),
      fetchKomikSearch(query).then(res => {
        if (res.status === 'ok' && res.data)
          res.data.forEach(item => all.push({
            title: item.title,
            poster: stripQuery(item.poster || ''),
            _src: 'komik', _detailManga: item.detailManga,
          }));
      }).catch(() => {}),
    ]);
    setResults(all);
    setSearched(true);
    setLoading(false);
  }

  function handleClick(item) {
    if (item._src === 'komik') {
      nav(`/komik/detail?d=${encodeURIComponent(item._detailManga)}`);
    } else if (item._src === 'donghua') {
      // donghua
    } else {
      onCardClick(item);
    }
  }

  const srcLabel = { film: 'Film', donghua: 'Donghua', komik: 'Komik' };
  const srcColor = { film: '#e50914', donghua: '#e5a000', komik: '#4CAF50' };

  return (
    <div className="search-page" style={{ paddingTop: 'var(--header-h)' }}>
      {/* Search bar */}
      <div className="search-header">
        <div className="search-bar" style={{ maxWidth: 700 }}>
          <i className="fas fa-search" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Cari film, series, komik, donghua..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && (
            <button style={{ background:'none', border:'none', color:'#555', fontSize:18, cursor:'pointer' }}
              onClick={() => { setQ(''); setResults([]); setSearched(false); }}>
              &times;
            </button>
          )}
        </div>
      </div>

      {loading && <div className="spinner-center" style={{ minHeight: 200 }}><div className="spinner" /></div>}

      {searched && !loading && results.length === 0 && (
        <div style={{ textAlign:'center', color:'#555', padding:'80px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <p style={{ fontSize: 16 }}>Tidak ada hasil untuk <strong style={{ color:'#fff' }}>"{q}"</strong></p>
        </div>
      )}

      {/* Results as grid cards */}
      {results.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 16,
          padding: '20px 48px',
        }}>
          {results.map((item, i) => (
            <div key={i}
              className="movie-card"
              onClick={() => handleClick(item)}
              style={{ width: '100%' }}
            >
              {/* Type badge */}
              <div style={{
                position:'absolute', top: 8, left: 8,
                background: srcColor[item._src] || '#555',
                color: '#fff', fontSize: 9, fontWeight: 800,
                padding: '2px 7px', borderRadius: 4,
                textTransform: 'uppercase', letterSpacing: 0.5,
                zIndex: 2,
              }}>
                {srcLabel[item._src] || item._src}
              </div>
              {item.poster ? (
                <img src={item.poster} alt={item.title || ''}
                  onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='flex'); }} />
              ) : null}
              <div className="card-img-fallback" style={{ display: item.poster ? 'none' : 'flex' }}>
                <i className="fas fa-film" style={{ fontSize: 28, color: '#333' }} />
              </div>
              <div className="card-label">{item.title || item.name}</div>
            </div>
          ))}
        </div>
      )}

      {!searched && !loading && (
        <div style={{ textAlign:'center', color:'#333', padding:'100px 20px' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎬</div>
          <p style={{ fontSize: 16 }}>Ketik minimal 3 huruf untuk mencari</p>
        </div>
      )}
    </div>
  );
}
