import { useEffect, useState, useRef } from 'react';
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
  const [trailerUrl, setTrailerUrl] = useState('');
  const [fade,      setFade]       = useState(true);
  const videoRef  = useRef(null);
  const timerRef  = useRef(null);
  const autoRef   = useRef(null);

  const hero = items?.[idx] || null;

  // Auto-advance
  useEffect(() => {
    if (!items?.length) return;
    autoRef.current = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(v => (v + 1) % items.length); setFade(true); }, 180);
    }, 96000);
    return () => clearInterval(autoRef.current);
  }, [items?.length]);

  // Reset auto-timer on manual nav
  function goTo(i) {
    clearInterval(autoRef.current);
    setFade(false);
    setTimeout(() => { setIdx(i); setFade(true); }, 180);
    autoRef.current = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(v => { const n=(v+1)%items.length; return n; }); setFade(true); }, 180);
    }, 96000);
  }
  function prev(e) { e.stopPropagation(); goTo((idx - 1 + (items?.length||1)) % (items?.length||1)); }
  function next(e) { e.stopPropagation(); goTo((idx + 1) % (items?.length||1)); }

  // Trailer fetch
  useEffect(() => {
    if (!hero) return;
    setShowVideo(false);
    setTrailerUrl('');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!hero.detailPath) return;
      fetchDetail(hero.detailPath)
        .then(res => {
          if (res?.data?.trailerUrl) { setTrailerUrl(res.data.trailerUrl); setShowVideo(true); }
        }).catch(() => {});
    }, 5000);
    return () => clearTimeout(timerRef.current);
  }, [hero?.detailPath]);

  if (!hero) return null;

  return (
    <div className={`hero-banner${fade ? " hero-fade-in" : " hero-fade-out"}`} onClick={() => onCardClick(hero)}>
      <img src={hero.poster} alt={hero.title}
        style={{ display: showVideo ? 'none' : 'block' }}
        onError={e => { e.target.style.display='none'; }} />
      {showVideo && trailerUrl && (
        <video ref={videoRef} src={trailerUrl} autoPlay muted={muted} loop playsInline
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
      )}
      <div className="hero-overlay" />

      {/* Prev / Next arrows */}
      <button className="hero-nav-btn hero-prev" onClick={prev}>
        <i className="fas fa-chevron-left" />
      </button>
      <button className="hero-nav-btn hero-next" onClick={next}>
        <i className="fas fa-chevron-right" />
      </button>

      {/* Mute button — top right corner, independent */}
      {showVideo && (
        <button className="hero-mute-btn" onClick={e => { e.stopPropagation(); setMuted(v=>!v); }}>
          <i className={`fas ${muted ? 'fa-volume-mute' : 'fa-volume-up'}`}></i>
        </button>
      )}

      <div className="hero-content">
        <div className="hero-title">{hero.title}</div>
        <div className="hero-bottom-row">
          <button className="hero-play-btn" onClick={e => { e.stopPropagation(); onCardClick(hero); }}>
            <i className="fas fa-play"></i> Tonton
          </button>
          <div className="hero-dots">
            {[0, 1, 2].map(offset => {
              const total = items.length;
              const dotIdx = (idx + offset - 1 + total) % total;
              const isActive = offset === 1;
              return (
                <button key={offset} className={`hero-dot ${isActive ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); goTo(dotIdx); }} />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home({ onCardClick }) {
  const [sections, setSections]       = useState({});
  const [hero, setHero]               = useState(null);
  const [heroItems, setHeroItems]       = useState([]);
  const [apiError, setApiError]       = useState('');
  const [loadingFirst, setLoadingFirst] = useState(true);
  const nav = useNavigate();
  const { getAllCW, getWatchlist, getAllKomikProgress } = useAuth();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    fetchCategory('trending', 1)
      .then(res => {
        setLoadingFirst(false);
        if (res.success && res.items?.length) {
          setSections(prev => ({ ...prev, trending: res.items }));
          setHero(res.items[0]);
          setHeroItems(res.items.slice(0, 8));
        } else {
          setApiError('API response: ' + JSON.stringify(res).slice(0, 150));
        }
      })
      .catch(err => { setLoadingFirst(false); setApiError('Fetch error: ' + err.message); });

    SECTIONS.slice(1).forEach(async sec => {
      try {
        if (sec.isKomik) {
          const res = await fetchKomikPopuler(1);
          if (res.items?.length)
            setSections(prev => ({ ...prev, [sec.action]: res.items.map(k => ({
              title: k.title, poster: k.poster || k.thumbnail,
              detailPath: k.slug, type: 'komik', slug: k.slug,
            })) }));
        } else {
          const res = await fetchCategory(sec.action, 1);
          if (res.success && res.items?.length)
            setSections(prev => ({ ...prev, [sec.action]: res.items }));
        }
      } catch {}
    });
  }, []);

  const cwItems    = getAllCW();
  const komikItems = getAllKomikProgress ? getAllKomikProgress() : [];
  // Merge and sort by savedAt
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
                  <img src={(item.poster||'')} alt={item.seriesTitle||item.title||''} />
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
                  <img src={(item.poster||'')} alt={item.title} />
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

      {SECTIONS.map(sec => {
        const items = sections[sec.action];
        if (!items?.length) return null;
        const handleClick = sec.isKomik
          ? (item) => nav(`/komik/detail?d=${encodeURIComponent(item.slug || item.detailPath)}`)
          : onCardClick;
        return <HorizontalSection key={sec.action} title={sec.title} items={items} seeMorePath={sec.seeMore} onCardClick={handleClick} />;
      })}
    </div>
  );
}
