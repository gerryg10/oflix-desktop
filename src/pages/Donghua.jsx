import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import VideoPlayer from '../components/VideoPlayer.jsx';

const API = '/donghua_api.php';
const STREAM_API = '/donghua_stream.php';

async function anichinFetch(params) {
  const url = `${API}?${new URLSearchParams(params)}`;
  const res  = await fetch(url);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error('Non-JSON: ' + text.slice(0, 100)); }
}

// ─── Detail + Player Page ─────────────────────────────────────────────────────
function AnichinDetail({ slug, onClose }) {
  const [detail,      setDetail]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [epLoading,   setEpLoading]   = useState(false);
  const [activeEpIdx, setActiveEpIdx] = useState(-1);
  const [playerUrl,   setPlayerUrl]   = useState('');
  const [showPlayer,  setShowPlayer]  = useState(false);
  const { isInWatchlist, addToWatchlist, removeFromWatchlist } = useAuth();
  const [inList, setInList] = useState(false);

  useEffect(() => {
    setLoading(true);
    anichinFetch({ action: 'detail', slug })
      .then(res => {
        if (res?.data) {
          setDetail(res.data);
          setInList(isInWatchlist?.(slug) || false);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  async function playEp(idx) {
    const episodes = detail?.episodes || [];
    const ep = episodes[idx];
    if (!ep || epLoading) return;

    setEpLoading(true);
    setActiveEpIdx(idx);

    try {
      // Call donghua_stream.php — it handles extract + proxy
      const epSlug = ep.playUrl || ep.slug;
      const res = await fetch(`${STREAM_API}?ep=${encodeURIComponent(epSlug)}`);
      const data = await res.json();

      if (data.proxiedUrl) {
        // Best: self-proxied m3u8 (handles referer + CORS)
        setPlayerUrl(data.proxiedUrl);
        setShowPlayer(true);
      } else if (data.streamUrl) {
        // Fallback: direct URL
        setPlayerUrl(data.streamUrl);
        setShowPlayer(true);
      }
    } catch(e) {
      console.warn('play error', e);
    }
    setEpLoading(false);
  }

  function onEpisodeChange(seasonIdx, epIdx) {
    playEp(epIdx);
  }

  function toggleList() {
    const v = !inList; setInList(v);
    if (v) addToWatchlist?.({ title: detail?.title || slug, detailPath: slug, poster: detail?.poster || '', type: 'anichin' });
    else   removeFromWatchlist?.(slug);
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#000', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="spinner" />
    </div>
  );

  if (!detail) return (
    <div style={{ padding:20, textAlign:'center', color:'#f55' }}>
      Gagal load.<br />
      <button style={{ marginTop:14, color:'#aaa', background:'none', border:'none', fontSize:14 }} onClick={onClose}>← Kembali</button>
    </div>
  );

  const episodes = detail.episodes || [];
  const genres   = (detail.genre || []).join(' · ');

  const seasons = [{
    season: 1,
    episodes: episodes.map((ep, i) => ({
      episode: ep.episode || i + 1,
      title: ep.title || `Episode ${ep.episode || i + 1}`,
      playUrl: ep.playUrl || ep.slug,
    })),
  }];

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', paddingBottom:80 }}>

      {showPlayer && playerUrl && (
        <VideoPlayer
          url={playerUrl}
          title={detail.title + (activeEpIdx >= 0 ? ` — Ep ${episodes[activeEpIdx]?.episode || activeEpIdx + 1}` : '')}
          seasons={seasons}
          currentSeasonIdx={0}
          currentEpIdx={activeEpIdx}
          onEpisodeChange={onEpisodeChange}
          onClose={() => { setShowPlayer(false); setPlayerUrl(''); }}
          onSaveCW={() => {}}
          savedTime={0}
        />
      )}

      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'#000', borderBottom:'1px solid #1a1a1a', position:'sticky', top:0, zIndex:100 }}>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'#fff', fontSize:22, cursor:'pointer', lineHeight:1, padding:'0 4px' }}>←</button>
        <span style={{ flex:1, fontSize:14, fontWeight:800, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{detail.title}</span>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
          <button className={`btn-icon-action ${inList?'active':''}`} onClick={toggleList} style={{ width:36, height:36 }}>
            <i className={`fas ${inList?'fa-check':'fa-plus'}`} />
          </button>
          <span style={{ fontSize:9, color:'#555', fontWeight:700 }}>DAFTAR</span>
        </div>
      </div>

      {!showPlayer && (
        <div style={{ position:'relative', width:'100%', background:'#000', aspectRatio:'16/9', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {detail.poster && <img src={detail.poster} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', opacity:0.3 }} />}
          <div style={{ position:'absolute', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            {epLoading ? (
              <div className="spinner" />
            ) : (
              <>
                <span style={{ color:'#555', fontSize:12 }}>Pilih episode untuk mulai</span>
                {episodes.length > 0 && (
                  <button onClick={() => playEp(0)} style={{
                    background:'var(--primary)', color:'#fff', border:'none', borderRadius:8,
                    padding:'10px 24px', fontSize:13, fontWeight:700, cursor:'pointer',
                  }}>
                    <i className="fas fa-play" style={{ marginRight:8 }} />
                    Mulai Episode 1
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ padding:'14px 14px 0' }}>
        <h1 style={{ fontSize:18, fontWeight:900, color:'#fff', margin:'0 0 6px' }}>{detail.title}</h1>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
          {detail.year    && <span className="info-chip">{detail.year}</span>}
          {detail.rating  && <span className="info-chip">⭐ {detail.rating}</span>}
          {detail.duration && <span className="info-chip">{detail.duration}</span>}
          {detail.country && <span className="info-chip">{detail.country}</span>}
          {genres         && <span className="info-chip">{genres}</span>}
        </div>
        {detail.description && (
          <p style={{ fontSize:13, color:'#888', lineHeight:1.65, margin:'0 0 16px' }}>{detail.description}</p>
        )}
      </div>

      <div style={{ padding:'0 14px' }}>
        <div style={{ fontSize:13, fontWeight:800, color:'#fff', marginBottom:10 }}>
          Episode <span style={{ color:'#555', fontWeight:400 }}>({episodes.length})</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {episodes.map((ep, i) => {
            const isActive = activeEpIdx === i;
            return (
              <div key={i} onClick={() => playEp(i)}
                style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 12px', borderRadius:10,
                  background: isActive ? '#1c0505' : '#111',
                  border: `1px solid ${isActive ? 'var(--primary)' : '#1a1a1a'}`,
                  cursor:'pointer', transition:'background 0.15s' }}>
                <div style={{ width:34, height:34, borderRadius:8, flexShrink:0,
                  background: isActive ? 'var(--primary)' : '#1a1a1a',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <i className={`fas ${isActive && showPlayer ? 'fa-pause' : 'fa-play'}`}
                    style={{ fontSize:11, color: isActive ? '#fff' : '#555' }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight: isActive ? 700 : 400,
                    color: isActive ? '#fff' : '#bbb',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {ep.title || `Episode ${ep.episode || i+1}`}
                  </div>
                  {ep.episode && <div style={{ fontSize:11, color:'#555', marginTop:2 }}>Ep {ep.episode}</div>}
                  {isActive && showPlayer && <div style={{ fontSize:10, color:'var(--primary)', marginTop:2 }}>▶ SEDANG DIPUTAR</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── List Page ────────────────────────────────────────────────────────────────
export default function AnichinPage() {
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');
  const [detailSlug,  setDetailSlug]  = useState(null);
  const sentinelRef = useRef(null);

  const loadPage = useCallback(async (p) => {
    try {
      const res = await anichinFetch({ action: 'populer', page: p });
      if (res.items?.length) {
        setItems(prev => p === 1 ? res.items : [...prev, ...res.items]);
        setHasMore(res.items.length >= 10);
      } else {
        if (p === 1) setError('Gagal load konten. Pastikan ngrok aktif.');
        setHasMore(false);
      }
    } catch(e) {
      if (p === 1) setError('Error: ' + e.message);
      setHasMore(false);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { loadPage(1); }, [loadPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        const next = page + 1;
        setPage(next);
        setLoadingMore(true);
        loadPage(next);
      }
    }, { rootMargin: '300px' });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, page, loadPage]);

  if (detailSlug) {
    return <AnichinDetail slug={detailSlug} onClose={() => { setDetailSlug(null); window.scrollTo(0,0); }} />;
  }

  return (
    <div className="listing-page">
      <h2 className="listing-title">🎌 Anichin</h2>
      {loading && <div style={{ display:'flex', justifyContent:'center', padding:40 }}><div className="spinner" /></div>}
      {error && (
        <div style={{ margin:14, padding:14, background:'#1a0a0a', border:'1px solid #440000', borderRadius:10 }}>
          <div style={{ color:'#f66', fontSize:12, fontWeight:700 }}>⚠️ {error}</div>
        </div>
      )}
      <div className="listing-grid">
        {items.map((item, i) => {
          const itemSlug = item.detailPath || item.slug || '';
          const poster   = item.poster || item.thumbnail || '';
          const title    = item.title || '';
          return (
            <div key={i} className="movie-card" onClick={() => setDetailSlug(itemSlug)}>
              <img src={poster} alt={title} loading="lazy" onError={e=>{e.target.style.display='none';}} />
              <div className="card-label">{title}</div>
              {item.status && (
                <div style={{ position:'absolute', top:6, left:6, background:'rgba(0,0,0,0.75)', color:'#aaa', fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:4 }}>
                  {item.status}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {loadingMore && <div style={{ display:'flex', justifyContent:'center', padding:20 }}><div className="spinner" /></div>}
      <div ref={sentinelRef} style={{ height:1 }} />
    </div>
  );
}
