import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCategory, fetchDetail, fetchKomikPopuler } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import HorizontalSection from '../components/HorizontalSection.jsx';

const SECTIONS = [
  { action: 'trending',          title: '🔥 Populer',          seeMore: '/film'   },
  { action: 'indonesian-movies', title: 'Film Indonesia',       seeMore: '/film?cat=indonesian-movies' },
  { action: 'indonesian-drama',  title: 'Series Indonesia',     seeMore: '/series?cat=indonesian-drama' },
  { action: 'kdrama',            title: 'K-Drama',              seeMore: '/series?cat=kdrama' },
  { action: 'anime',             title: 'Anime',                seeMore: '/series?cat=anime' },
  { action: 'western-tv',        title: 'Series Barat',         seeMore: '/series?cat=western-tv' },
  { action: 'short-tv',          title: 'Drachin',              seeMore: '/series?cat=short-tv' },
  { action: 'komik-populer',      title: '📚 Komik Populer',     seeMore: '/komik', isKomik: true },
];

function HeroBanner({ items, onCardClick }) {
  const [idx,        setIdx]        = useState(0);
  const [showVideo,  setShowVideo]  = useState(false);
  const [muted,      setMuted]      = useState(true);
  const [detailData, setDetailData] = useState(null);
  const videoRef   = useRef(null);
  const timerRef   = useRef(null);

  const hero = items[idx] || null;

  // Auto-rotate
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => {
      setIdx(i => (i + 1) % items.length);
      setShowVideo(false); setMuted(true);
    }, 10000);
    return () => clearInterval(id);
  }, [items.length]);

  // Prefetch detail for trailer
  useEffect(() => {
    if (!hero?.detailPath) return;
    fetchDetail(hero.detailPath)
      .then(res => { if (res.success && res.data) setDetailData(res.data); })
      .catch(() => {});
  }, [hero?.detailPath]);

  // Auto-play trailer after 3s
  useEffect(() => {
    clearTimeout(timerRef.current);
    setShowVideo(false);
    if (detailData?.trailerUrl) {
      timerRef.current = setTimeout(() => setShowVideo(true), 3000);
    }
    return () => clearTimeout(timerRef.current);
  }, [detailData]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, showVideo]);

  if (!hero) return null;

  return (
    <div className="hero-banner fade-up">
      <div className="hero-media">
        <img src={hero.poster} alt={hero.title}
          style={{ display: showVideo ? 'none' : 'block' }} loading="eager" />
        {showVideo && detailData?.trailerUrl && (
          <video ref={videoRef} src={detailData.trailerUrl}
            autoPlay muted={muted} loop playsInline
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        )}
        <div className="hero-overlay" />
      </div>
      <div className="hero-content">
        <div className="hero-title">{hero.title}</div>
        <div className="hero-meta">
          {hero.year && <span>{hero.year}</span>}
          {hero.rating && <span>⭐ {hero.rating}</span>}
          {(hero.genre || []).slice(0,2).map((g,i)=><span key={i}>{g}</span>)}
        </div>
        <div style={{ display:'flex', gap:10, marginTop:16 }}>
          <button className="hero-btn primary" onClick={() => onCardClick(hero)}>
            <i className="fas fa-play" /> Tonton
          </button>
          {showVideo && (
            <button className="hero-btn" onClick={() => setMuted(v => !v)}>
              <i className={`fas ${muted ? 'fa-volume-mute' : 'fa-volume-up'}`} />
            </button>
          )}
        </div>
      </div>
      {items.length > 1 && (
        <div className="hero-dots">
          {items.slice(0,8).map((_,i) => (
            <div key={i} className={`hero-dot ${i===idx ? 'active' : ''}`}
              onClick={() => { setIdx(i); setShowVideo(false); setMuted(true); }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Lazy Section: only fetch when scrolled into view ────────────────────── */
function LazySection({ sec, onCardClick }) {
  const [items, setItems] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (loaded) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        obs.disconnect();
        setLoaded(true);
        // Fetch this section
        (async () => {
          try {
            if (sec.isKomik) {
              const res = await fetchKomikPopuler(1);
              if (res.items?.length)
                setItems(res.items.map(k => ({
                  title: k.title, poster: k.poster || k.thumbnail,
                  detailPath: k.slug, type: 'komik', slug: k.slug,
                })));
            } else {
              const res = await fetchCategory(sec.action, 1);
              if (res.success && res.items?.length) setItems(res.items);
            }
          } catch {}
        })();
      }
    }, { rootMargin: '300px' }); // Start loading 300px before visible
    obs.observe(el);
    return () => obs.disconnect();
  }, [loaded, sec]);

  const handleClick = sec.isKomik
    ? (item) => nav(`/komik/detail?d=${encodeURIComponent(item.slug || item.detailPath)}`)
    : onCardClick;

  return (
    <div ref={ref}>
      {items?.length > 0 && (
        <HorizontalSection title={sec.title} items={items} seeMorePath={sec.seeMore} onCardClick={handleClick} />
      )}
      {loaded && !items && (
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
        </div>
      )}
      {!loaded && <div style={{ height: 280 }} />} {/* Placeholder height */}
    </div>
  );
}

export default function Home({ onCardClick }) {
  const [trendingItems, setTrendingItems] = useState([]);
  const [heroItems, setHeroItems]         = useState([]);
  const [apiError, setApiError]           = useState('');
  const [loadingFirst, setLoadingFirst]   = useState(true);
  const nav = useNavigate();
  const { getAllCW, getWatchlist, getAllKomikProgress } = useAuth();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // Only fetch trending on mount — other sections lazy load on scroll
    fetchCategory('trending', 1)
      .then(res => {
        setLoadingFirst(false);
        if (res.success && res.items?.length) {
          setTrendingItems(res.items);
          setHeroItems(res.items.slice(0, 8));
        } else {
          setApiError('API response: ' + JSON.stringify(res).slice(0, 150));
        }
      })
      .catch(err => { setLoadingFirst(false); setApiError('Fetch error: ' + err.message); });
  }, []);

  const cwItems    = getAllCW();
  const komikItems = getAllKomikProgress ? getAllKomikProgress() : [];
  const allCwItems = [...cwItems, ...komikItems].sort((a,b) => (b.savedAt||0)-(a.savedAt||0)).slice(0,15);
  const wlItems    = getWatchlist ? getWatchlist() : [];

  return (
    <div>
      {loadingFirst && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh', flexDirection:'column', gap:16 }}>
          <div className="spinner" />
          <span style={{ color:'#555', fontSize:12 }}>Memuat konten...</span>
        </div>
      )}

      {apiError && !loadingFirst && (
        <div style={{ margin:14, padding:14, background:'#1a0a0a', border:'1px solid #440000', borderRadius:10 }}>
          <div style={{ color:'#ff6b6b', fontSize:12, fontWeight:700, marginBottom:6 }}>⚠️ Gagal load API</div>
          <div style={{ color:'#666', fontSize:10, fontFamily:'monospace', wordBreak:'break-all' }}>{apiError}</div>
        </div>
      )}

      <HeroBanner items={!loadingFirst ? heroItems : []} onCardClick={onCardClick} />

      {/* Continue Watching */}
      {allCwItems.length > 0 && (
        <section className="cw-section fade-up">
          <div className="h-section-header" style={{ padding:'0 48px' }}><h2 className="h-section-title">▶ Lanjut Nonton/Baca</h2></div>
          <div className="cw-scroll">
            {allCwItems.map((item, i) => {
              const isKomik = item.type === 'komik';
              const pct     = !isKomik && item.duration > 0 ? Math.min(100, Math.round((item.time/item.duration)*100)) : 0;
              const epLabel = isKomik
                ? (item.chapterTitle || `Ch ${(item.chapterIdx||0)+1}`)
                : (item.episode === -1 ? '' : `S${(item.seasonIdx||0)+1} E${(item.episode||0)+1}`);
              const handleClick = () => {
                if (isKomik) {
                  nav(`/komik/detail?d=${encodeURIComponent(item.slug)}`);
                } else {
                  onCardClick(item);
                }
              };
              return (
                <div key={i} className="cw-card" onClick={handleClick}>
                  <img src={(item.poster||'')} alt={item.seriesTitle||item.title||''} loading="lazy" />
                  {isKomik && (
                    <div style={{ position:'absolute', top:6, left:6, background:'var(--primary)', borderRadius:4, fontSize:8, fontWeight:900, color:'#fff', padding:'2px 5px', letterSpacing:0.5 }}>KOMIK</div>
                  )}
                  <div className="cw-card-info">
                    <div className="cw-card-title">{item.seriesTitle||item.title||''}</div>
                    {epLabel && <div className="cw-card-ep">{epLabel}</div>}
                    {!isKomik && <div className="cw-progress-wrap"><div className="cw-progress-bar" style={{ width:pct+'%' }} /></div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Watchlist */}
      {wlItems.length > 0 && (
        <section className="cw-section fade-up">
          <div className="h-section-header" style={{ padding:'0 48px' }}><h2 className="h-section-title">+ Daftar Saya</h2></div>
          <div className="h-scroll">
            {wlItems.map((item, i) => {
              const isKomikWl = item.type === 'komik';
              return (
                <div key={i} className="movie-card" style={{ width:110, flexShrink:0, position:'relative' }}
                  onClick={() => isKomikWl
                    ? nav(`/komik/detail?d=${encodeURIComponent(item.detailPath)}`)
                    : onCardClick(item)}>
                  <img src={(item.poster||'')} alt={item.title} loading="lazy" />
                  {isKomikWl && (
                    <div style={{ position:'absolute', top:6, left:6, background:'var(--primary)', borderRadius:4, fontSize:8, fontWeight:900, color:'#fff', padding:'2px 5px', letterSpacing:0.5 }}>KOMIK</div>
                  )}
                  <div className="card-label">{item.title}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Trending — already loaded */}
      {trendingItems.length > 0 && (
        <HorizontalSection title={SECTIONS[0].title} items={trendingItems} seeMorePath={SECTIONS[0].seeMore} onCardClick={onCardClick} />
      )}

      {/* Other sections — lazy loaded on scroll */}
      {SECTIONS.slice(1).map(sec => (
        <LazySection key={sec.action} sec={sec} onCardClick={onCardClick} />
      ))}
    </div>
  );
}
