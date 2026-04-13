import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchDetail, fetchStream, parseFoodcashUrl } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import VideoPlayer from '../components/VideoPlayer.jsx';

function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(',').map(s=>s.trim()).filter(Boolean);
  return [];
}

const FALLBACK_CAST_SVG = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect fill='%23222' width='40' height='40' rx='20'/><circle cx='20' cy='14' r='7' fill='%23444'/><path d='M4 38c0-9 7-14 16-14s16 5 16 14' fill='%23444'/></svg>`;

export default function DetailPage() {
  const [params]   = useSearchParams();
  const detailPath = params.get('p') || '';
  const nav        = useNavigate();
  const { user, saveCW, getSavedProgress, addToWatchlist, removeFromWatchlist, isInWatchlist, addHistory, setLike, getLike } = useAuth();

  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [playerData, setPlayerData] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [currentSeason, setCurrentSeason] = useState(0);
  const [currentEp, setCurrentEp]   = useState(-1);
  const [liked, setLiked]           = useState(false);
  const [disliked, setDisliked]     = useState(false);
  const [inList, setInList]         = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerMuted, setTrailerMuted] = useState(true);
  const trailerTimerRef = useRef(null);
  const trailerVideoRef = useRef(null);

  useEffect(() => {
    if (!detailPath) return;
    setLoading(true); setError('');
    setShowTrailer(false); setTrailerMuted(true);
    clearTimeout(trailerTimerRef.current);
    fetchDetail(detailPath)
      .then(res => {
        if (res.success && res.data) {
          setData(res.data);
          if (res.data.trailerUrl) {
            trailerTimerRef.current = setTimeout(() => setShowTrailer(true), 4000);
          }
          addHistory(detailPath, res.data.title || '', res.data.poster || '', res.data.seasons?.length ? 'series' : 'film');
        }
        else setError(JSON.stringify(res).slice(0, 200));
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });

    getLike(detailPath).then(action => {
      setLiked(action === 'like');
      setDisliked(action === 'dislike');
    }).catch(() => {});
    setInList(isInWatchlist(detailPath));
    return () => clearTimeout(trailerTimerRef.current);
  }, [detailPath]);

  useEffect(() => {
    if (trailerVideoRef.current) trailerVideoRef.current.muted = trailerMuted;
  }, [trailerMuted, showTrailer]);

  async function playVideo(epIdx = -1, sIdx = 0) {
    if (!data) return;
    setPlayerLoading(true);
    try {
      const isMovie  = !data.seasons?.length;
      const sourceUrl = isMovie
        ? (data.playerUrl || data.sources?.[0]?.url || '')
        : (data.seasons?.[sIdx]?.episodes?.[epIdx]?.playerUrl || data.seasons?.[sIdx]?.episodes?.[epIdx]?.url || '');
      if (!sourceUrl) { setPlayerLoading(false); return; }
      const parsed = parseFoodcashUrl(sourceUrl);
      if (!parsed.id) { setPlayerLoading(false); return; }
      const seasonVal  = isMovie ? '' : (data.seasons[sIdx]?.season || sIdx + 1);
      const episodeVal = isMovie ? '' : (data.seasons[sIdx]?.episodes?.[epIdx]?.episode || epIdx + 1);
      const res = await fetchStream(parsed.id, seasonVal, episodeVal, detailPath);
      if (!res.success) { setPlayerLoading(false); return; }

      const downloads = [];
      if (res.downloads?.length) {
        const sorted = [...res.downloads].sort((a,b) => (Number(b.resolution)||0)-(Number(a.resolution)||0));
        sorted.forEach(d => { if (d.url) downloads.push({ label: (Number(d.resolution)||0) ? Number(d.resolution)+'p' : 'Auto', url: d.url, hlsUrl: d.hlsUrl || '', resolution: Number(d.resolution)||0 }); });
      }
      let startDlIdx = 0;
      if (downloads.length > 1) {
        for (let i = downloads.length - 1; i >= 0; i--) {
          if (downloads[i].resolution && downloads[i].resolution >= 480) { startDlIdx = i; break; }
        }
      }

      // Get HLS URL or MP4 fallback — but DON'T poll here
      // Just get the hlsUrl and pass it to VideoPlayer
      // VideoPlayer will handle the polling internally
      const chosen = downloads[startDlIdx] || downloads[0];
      let finalUrl = '';
      let hlsCheckUrl = '';

      if (res.url?.includes('.m3u8')) {
        finalUrl = res.url;
      } else if (chosen?.hlsUrl) {
        // Check once — if ready, use it. If not, pass hlsCheckUrl to VideoPlayer
        try {
          const hlsData = await fetch(chosen.hlsUrl).then(r => r.json()).catch(() => null);
          if (hlsData?.status === 'ready' && hlsData?.m3u8) {
            finalUrl = hlsData.m3u8;
          } else {
            // Not ready yet — pass the check URL to VideoPlayer
            // VideoPlayer will poll and show "Menyiapkan video..." 
            hlsCheckUrl = chosen.hlsUrl;
            finalUrl = hlsData?.m3u8 || ''; // m3u8 URL to use once ready
          }
        } catch {
          finalUrl = chosen?.url || '';
        }
      } else {
        finalUrl = chosen?.url || res.url || '';
      }

      const subtitles = [];
      if (res.captions?.length) {
        const seen = new Set();
        [{ code:'in_id', label:'Indonesia' },{ code:'id', label:'Indonesia' },{ code:'en', label:'English' }]
        .forEach(({ code, label }) => {
          const cap = res.captions.find(c => c?.url && (c.languageCode===code || c.lan===code));
          if (!cap || seen.has(label)) return;
          seen.add(label);
          subtitles.push({ url: `/subtitle-proxy.php?url=${encodeURIComponent(cap.url)}`, name: label, language: code });
        });
      }

      const saved = getSavedProgress(detailPath, epIdx);
      setCurrentSeason(sIdx); setCurrentEp(epIdx);
      setPlayerData({
        url: finalUrl,
        hlsCheckUrl,  // NEW: VideoPlayer polls this
        mp4Fallback: chosen?.url || '',  // Fallback if HLS fails
        downloads,
        startDlIdx,
        subtitles,
        savedTime: saved?.time || 0,
      });
    } catch(e) { console.error('[play] ERROR:', e.message); }
    setPlayerLoading(false);
  }

  function handleWatchBtn() {
    if (!data) return;
    const isMovie = !data.seasons?.length;
    if (isMovie) { playVideo(-1, 0); return; }
    const saved = getSavedProgress(detailPath);
    if (saved && saved.episode >= 0) playVideo(saved.episode, saved.seasonIdx || 0);
    else playVideo(0, 0);
  }

  function handleSaveCW(progress) {
    if (!data) return;
    saveCW({ title: data.title, detailPath, poster: data.poster || '', ...progress });
  }

  function toggleLike() {
    const v = !liked; setLiked(v); if (v) setDisliked(false);
    setLike(detailPath, v ? 'like' : 'none', data?.title || '', data?.poster || '');
  }
  function toggleDislike() {
    const v = !disliked; setDisliked(v); if (v) setLiked(false);
    setLike(detailPath, v ? 'dislike' : 'none', data?.title || '', data?.poster || '');
  }
  function toggleList() {
    const v = !inList; setInList(v);
    if (v) addToWatchlist({ title: data?.title, detailPath, poster: data?.poster || '' });
    else removeFromWatchlist(detailPath);
  }

  if (playerData) {
    const seasons = data?.seasons || [];
    const title   = data?.title || '';
    const epTitle = currentEp >= 0 && seasons[currentSeason]?.episodes?.[currentEp]
      ? `S${seasons[currentSeason].season||currentSeason+1} E${seasons[currentSeason].episodes[currentEp].episode||currentEp+1}` : '';
    return (
      <VideoPlayer
        url={playerData.url}
        hlsCheckUrl={playerData.hlsCheckUrl}
        mp4Fallback={playerData.mp4Fallback}
        title={epTitle ? `${title} · ${epTitle}` : title}
        downloads={playerData.downloads||[]}
        subtitles={playerData.subtitles}
        savedTime={playerData.savedTime}
        seasons={seasons} currentSeasonIdx={currentSeason} currentEpIdx={currentEp}
        onEpisodeChange={(si,ei) => playVideo(ei, si)}
        onClose={() => setPlayerData(null)}
        onSaveCW={handleSaveCW}
      />
    );
  }

  if (loading) return (
    <div className="detail-page">
      <div className="spinner-center" style={{ minHeight:'60vh' }}><div className="spinner" /></div>
    </div>
  );

  if (error || !data) return (
    <div className="detail-page" style={{ padding:'100px 48px' }}>
      <button onClick={() => nav(-1)} style={{ background:'none', border:'none', color:'#888', marginBottom:16, cursor:'pointer', fontSize:15 }}>← Kembali</button>
      <div style={{ background:'#1a0a0a', border:'1px solid #440000', borderRadius:10, padding:20 }}>
        <div style={{ color:'#ff6b6b', fontWeight:700, marginBottom:8 }}>Gagal memuat detail</div>
        <div style={{ color:'#555', fontSize:12, fontFamily:'monospace', wordBreak:'break-all' }}>{error || 'Data kosong'}</div>
      </div>
    </div>
  );

  const isMovie    = !data.seasons?.length;
  const genres     = toArr(data.genre || data.genres);
  const hasCW      = !!getSavedProgress(detailPath);
  const watchLabel = isMovie ? '▶ Tonton Film' : (hasCW ? '▶ Lanjutkan Nonton' : '▶ Tonton Ep. 1');
  const episodes   = data.seasons?.[currentSeason]?.episodes || [];
  const seriesPoster = data.poster || '';

  return (
    <div className="detail-page">
      <div className="detail-hero">
        <img src={seriesPoster} alt={data.title} style={{ display: showTrailer ? 'none' : 'block' }} onError={e=>{e.target.style.opacity=0.1;}} />
        {showTrailer && data.trailerUrl && (
          <video ref={trailerVideoRef} src={data.trailerUrl} autoPlay muted={trailerMuted} loop playsInline style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
        )}
        <div className="detail-hero-overlay" />
        <button className="detail-hero-back" onClick={() => nav(-1)}><i className="fas fa-chevron-left" /></button>
        {showTrailer && (
          <button onClick={() => setTrailerMuted(v => !v)} style={{ position:'absolute', bottom:20, right:48, zIndex:12, width:42, height:42, borderRadius:'50%', background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.25)', color:'#fff', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <i className={`fas ${trailerMuted ? 'fa-volume-mute' : 'fa-volume-up'}`} />
          </button>
        )}
      </div>

      <div className="detail-content">
        <h1 className="detail-title">{data.title}</h1>
        <div className="detail-meta">
          {data.year && <span className="meta-badge">{data.year}</span>}
          {data.rating && <span className="meta-badge">⭐ {data.rating}</span>}
          {genres.slice(0,3).map((g,i)=><span key={i} className="meta-badge">{g}</span>)}
          <span className="meta-badge" style={{ background:'rgba(229,9,20,0.15)', color:'var(--primary)' }}>{isMovie ? 'Film' : 'Series'}</span>
        </div>

        <div className="detail-btns">
          <button className="btn-watch" onClick={handleWatchBtn} disabled={playerLoading} style={{ opacity:playerLoading?0.7:1 }}>
            {playerLoading ? <><div className="spinner" style={{ width:18,height:18,borderWidth:2 }} /> Memuat...</> : <><i className="fas fa-play" /> {watchLabel}</>}
          </button>
          {data.trailerUrl && (
            <button className="btn-watch" style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'#ccc', flex:'0 0 auto', minWidth:'auto', padding:'14px 20px' }}
              onClick={() => setPlayerData({ url:data.trailerUrl, subtitles:[], savedTime:0 })}>
              <i className="fas fa-film" />
            </button>
          )}
        </div>

        <div style={{ display:'flex', gap:14, marginBottom:22 }}>
          {[
            { label:'DAFTAR', icon:inList?'fa-check':'fa-plus', active:inList, fn:toggleList },
            { label:'SUKA', icon:'fa-thumbs-up', active:liked, fn:toggleLike },
            { label:'TDK SUKA', icon:'fa-thumbs-down', active:disliked, fn:toggleDislike },
          ].map(({ label, icon, active, fn }) => (
            <div key={label} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <button className={`btn-icon-action ${active?'active':''}`} onClick={fn}><i className={`fas ${icon}`} /></button>
              <span style={{ fontSize:9, color:'#555', fontWeight:700 }}>{label}</span>
            </div>
          ))}
        </div>

        {data.description && <p className="detail-desc">{data.description}</p>}
        <div className="detail-info-row">
          {data.country && <span className="info-chip"><strong>Negara:</strong> {data.country}</span>}
          {data.duration && <span className="info-chip"><strong>Durasi:</strong> {data.duration}</span>}
          {data.network && <span className="info-chip"><strong>Network:</strong> {data.network}</span>}
        </div>

        {toArr(data.cast).length > 0 && (
          <section style={{ marginBottom:30 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:14 }}>Pemeran</div>
            <div className="cast-scroll">
              {Array.from(new Map(toArr(data.cast).map(c=>[c.name?.trim().toLowerCase(),c])).values()).map((c,i)=>(
                <div key={i} className="cast-item">
                  <img className="cast-avatar" src={c.avatar||''} alt={c.name} onError={e => { e.target.onerror=null; e.target.src=FALLBACK_CAST_SVG; }} />
                  <span className="cast-name">{c.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isMovie && data.seasons?.length > 0 && (
          <section style={{ marginBottom:30 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:18 }}>
              <span style={{ fontSize:16, fontWeight:800, color:'#fff' }}>Episode</span>
              {data.seasons.length > 1 && (
                <div className="season-tabs" style={{ marginBottom:0 }}>
                  {data.seasons.map((s,si)=>(<button key={si} className={`season-tab ${si===currentSeason?'active':''}`} onClick={()=>setCurrentSeason(si)}>Season {s.season||si+1}</button>))}
                </div>
              )}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:16 }}>
              {episodes.map((ep,ei)=>{
                const isActive = ei === currentEp;
                const thumb = ep.thumbnail || seriesPoster;
                return (
                  <div key={ei} onClick={()=>playVideo(ei,currentSeason)} style={{ background: isActive ? '#1c0505' : 'var(--bg-card)', borderRadius:'var(--radius-md)', overflow:'hidden', cursor:'pointer', border: isActive ? '1px solid var(--primary)' : '1px solid transparent', transition:'transform 0.28s ease, box-shadow 0.28s ease' }}
                    onMouseEnter={e => { e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow='0 8px 30px rgba(0,0,0,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
                    <div style={{ width:'100%', aspectRatio:'16/9', background:'var(--bg-card2)', position:'relative', overflow:'hidden' }}>
                      <img src={thumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', opacity: ep.thumbnail ? 1 : 0.4 }} onError={e=>{e.target.style.opacity='0.15';}} />
                      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'opacity 0.2s' }}
                        onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='0'}>
                        <i className="fas fa-play" style={{ fontSize:22, color:'#fff', filter:'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }} />
                      </div>
                      <div style={{ position:'absolute', top:8, left:8, background: isActive ? 'var(--primary)' : 'rgba(0,0,0,0.7)', color:'#fff', fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:4 }}>{ep.episode || ei + 1}</div>
                    </div>
                    <div style={{ padding:'12px 14px' }}>
                      <div style={{ fontSize:14, fontWeight:700, color: isActive?'#fff':'#ddd', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{ep.title || `Episode ${ep.episode || ei + 1}`}</div>
                      {isActive && <div style={{ fontSize:11, color:'var(--primary)', fontWeight:700 }}>▶ SEDANG DIPUTAR</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
