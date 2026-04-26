import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { fmtTime } from '../api.js';

export default function VideoPlayer({
  url: initialUrl,
  hlsCheckUrl = '',        // NEW: poll this URL until ready
  mp4Fallback = '',        // NEW: fallback if HLS never becomes ready
  title,
  subtitles = [],
  downloads = [],
  startDlIdx: initialDlIdx = 0,
  seasons = [],
  currentSeasonIdx = 0,
  currentEpIdx = -1,
  onEpisodeChange,
  onPreloadNext,
  onClose,
  onSaveCW,
  savedTime = 0,
}) {
  const videoRef    = useRef(null);
  const hlsRef      = useRef(null);
  const progressRef = useRef(null);
  const ctrlTimer   = useRef(null);
  const blobUrls    = useRef([]);
  const wrapRef     = useRef(null);
  const pollRef     = useRef(null);

  const audioCtxRef = useRef(null);
  const sourceRef   = useRef(null);
  const preloadRef  = useRef(new Set());

  const [url, setUrl]                 = useState(initialUrl);
  const [activeHlsCheckUrl, setActiveHlsCheckUrl] = useState(hlsCheckUrl);
  const [activeMp4Fallback, setActiveMp4Fallback] = useState(mp4Fallback);
  const pendingTimeRef = useRef(0);
  const [preparing, setPreparing]     = useState(!!hlsCheckUrl && !initialUrl);
  const [prepProgress, setPrepProgress] = useState(0);
  const [playing, setPlaying]         = useState(false);
  const [volume, setVolume]           = useState(1);
  const [isMuted, setIsMuted]         = useState(false);
  const [showVolume, setShowVolume]   = useState(false);
  const [duration, setDuration]       = useState(0);
  const [curTime, setCurTime]         = useState(0);
  const [showCtrl, setShowCtrl]       = useState(true);
  const [showEpPanel, setShowEpPanel] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hlsLevels, setHlsLevels]     = useState([]);
  const [curHlsLevel, setCurHlsLevel] = useState(-1);
  const [curDlIdx, setCurDlIdx]       = useState(initialDlIdx);
  const [subIdx, setSubIdx]           = useState(0);
  const [subSize, setSubSize]         = useState('small');
  const [buffering, setBuffering]     = useState(false);
  const [bufferPct, setBufferPct]     = useState(0);
  const [dlSpeed, setDlSpeed]         = useState('');
  const [panelSeason, setPanelSeason] = useState(currentSeasonIdx);

  /* ── Sync props when changing episodes ──────────────── */
  useEffect(() => {
    setUrl(initialUrl);
    setActiveHlsCheckUrl(hlsCheckUrl);
    setActiveMp4Fallback(mp4Fallback);
    pendingTimeRef.current = 0;
    setPreparing(!!hlsCheckUrl && !initialUrl);
    setPrepProgress(0);
    setCurDlIdx(initialDlIdx);
    setBufferPct(0);
    setCurTime(0);
    setShowEpPanel(false);
    preloadRef.current.clear();
  }, [initialUrl, hlsCheckUrl, mp4Fallback, initialDlIdx]);

  /* ── Preload Next Episode at Minute 20 or 80% ───────── */
  useEffect(() => {
    if (curTime > 0 && duration > 0 && onPreloadNext) {
      if (curTime >= 1200 || curTime >= duration * 0.8) {
        const epKey = `${currentSeasonIdx}-${currentEpIdx + 1}`;
        if (!preloadRef.current.has(epKey)) {
          preloadRef.current.add(epKey);
          onPreloadNext();
        }
      }
    }
  }, [curTime, duration, currentSeasonIdx, currentEpIdx, onPreloadNext]);

  /* ── Poll HLS check URL until ready ─────────────────── */
  useEffect(() => {
    if (!activeHlsCheckUrl || url) return; // Already have URL or no check needed

    setPreparing(true);
    setPrepProgress(0);
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120; // 120 × 5s = 10 minutes max

    async function poll() {
      while (!cancelled && attempts < maxAttempts) {
        attempts++;
        try {
          const res = await fetch(activeHlsCheckUrl);
          const data = await res.json();

          if (data.status === 'ready' && data.m3u8) {
            // Convert done! Set URL and start playing
            setUrl(data.m3u8);
            setPreparing(false);
            return;
          }

          // Update progress
          setPrepProgress(data.progress || Math.min(attempts * 2, 90));
        } catch {}

        // Wait 5 seconds between polls
        await new Promise(r => { pollRef.current = setTimeout(r, 5000); });
      }

      // Timeout — fallback to MP4
      if (!cancelled) {
        if (activeMp4Fallback) {
          setUrl(activeMp4Fallback);
        }
        setPreparing(false);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollRef.current);
    };
  }, [activeHlsCheckUrl, activeMp4Fallback, url]);

  /* ── cleanup blobs ──────────────────────────────────── */
  useEffect(() => () => blobUrls.current.forEach(u => URL.revokeObjectURL(u)), []);
  useEffect(() => () => {
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    sourceRef.current   = null;
  }, []);

  /* ── track fullscreen state ─────────────────────────── */
  useEffect(() => {
    function onFsChange() {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        const el = wrapRef.current;
        if (el?.dataset.rotated === '1') { el.style.cssText = ''; el.dataset.rotated = ''; }
        try { (screen.orientation?.unlock || (() => {}))(); } catch {}
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => { document.removeEventListener('fullscreenchange', onFsChange); document.removeEventListener('webkitfullscreenchange', onFsChange); };
  }, []);

  /* ── load source ────────────────────────────────────── */
  useEffect(() => {
    if (!url || preparing) return;
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setHlsLevels([]); setCurHlsLevel(-1); setCurDlIdx(initialDlIdx);
    setDuration(0);

    function initAudio() {
      if (sourceRef.current) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(video);
        sourceRef.current = source;
        const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 90; lowCut.Q.value = 0.7;
        const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 80; lowShelf.gain.value = 2;
        const hiMid = ctx.createBiquadFilter(); hiMid.type = 'peaking'; hiMid.frequency.value = 3000; hiMid.Q.value = 0.9; hiMid.gain.value = 3;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
        const highShelf = ctx.createBiquadFilter(); highShelf.type = 'highshelf'; highShelf.frequency.value = 8000; highShelf.gain.value = 1.5;
        const gain = ctx.createGain(); gain.gain.value = 1.4;
        source.connect(lowCut); lowCut.connect(lowShelf); lowShelf.connect(hiMid); hiMid.connect(comp); comp.connect(highShelf); highShelf.connect(gain); gain.connect(ctx.destination);
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { console.warn('Web Audio init failed:', e.message); }
    }

    function startPlay() {
      const resumeTime = pendingTimeRef.current > 0 ? pendingTimeRef.current : (savedTime > 10 ? savedTime : 0);
      video.currentTime = resumeTime;
      pendingTimeRef.current = 0;
      initAudio();
      video.play().catch(() => {});
      setPlaying(true);
    }

    if (url.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          fragLoadingMaxRetry: 10, fragLoadingRetryDelay: 1000,
          manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 6,
          startLevel: -1, autoLevelCapping: -1,
          abrEwmaDefaultEstimate: 10_000_000,
          maxBufferLength: 30, maxMaxBufferLength: 60,
          maxBufferHole: 0.5, lowLatencyMode: false,
          backBufferLength: 30, progressive: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          const levels = data.levels || [];
          setHlsLevels(levels);
          let startIdx = 0;
          for (let i = 0; i < levels.length; i++) { if (levels[i].height && levels[i].height <= 480) startIdx = i; }
          hls.startLevel = startIdx; hls.currentLevel = startIdx; setCurHlsLevel(startIdx);
          startPlay();
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
          const plDuration = data.details?.totalduration;
          if (plDuration && plDuration > 0) setDuration(prev => Math.max(prev, plDuration));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
              case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
              default:
                hls.destroy(); hlsRef.current = null; setHlsLevels([]);
                const fb = downloads[curDlIdx] || downloads[0];
                if (fb?.url) { video.src = fb.url; video.load(); video.addEventListener('loadedmetadata', () => { video.currentTime = curTime || 0; video.play().catch(()=>{}); }, { once: true }); }
                break;
            }
          }
        });

        hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
          const stats = data.frag?.stats;
          if (stats?.loaded && stats?.loading) {
            const lt = stats.loading.end - stats.loading.start;
            if (lt > 0) { const mbps = (stats.loaded / lt) * 1000 * 8 / 1_000_000; setDlSpeed(mbps > 1 ? mbps.toFixed(1) + ' Mbps' : Math.round(mbps * 1000) + ' Kbps'); }
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', startPlay, { once: true });
      }
    } else {
      video.src = url;
      video.addEventListener('loadedmetadata', startPlay, { once: true });
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [url, preparing]);

  /* ── subtitles ──────────────────────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks).forEach(t => { t.mode = 'disabled'; });
    Array.from(video.querySelectorAll('track')).forEach(t => { try { video.removeChild(t); } catch {} });
    blobUrls.current.forEach(u => URL.revokeObjectURL(u));
    blobUrls.current = [];
    setSubIdx(-1);
    if (!subtitles.length) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < subtitles.length; i++) {
        if (cancelled) return;
        try {
          const res = await fetch(subtitles[i].url);
          let text = await res.text();
          if (!text.trimStart().startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text;
          const blob = new Blob([text], { type: 'text/vtt' });
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.current.push(blobUrl);
          if (cancelled) return;
          const track = document.createElement('track');
          track.kind = 'subtitles'; track.label = subtitles[i].name; track.srclang = subtitles[i].language; track.src = blobUrl;
          if (i === 0) track.default = true;
          video.appendChild(track);
        } catch (e) { console.warn('Sub load fail:', subtitles[i].name, e.message); }
      }
      if (!cancelled) { setSubIdx(0); setTimeout(() => { Array.from(video.textTracks).forEach((t, i) => { t.mode = i === 0 ? 'showing' : 'disabled'; }); applyCueSize(subSize); }, 500); }
    })();
    return () => { cancelled = true; Array.from(video.textTracks).forEach(t => { t.mode = 'disabled'; }); Array.from(video.querySelectorAll('track')).forEach(t => { try { video.removeChild(t); } catch {} }); };
  }, [subtitles, url]);

  /* ── save progress ──────────────────────────────────── */
  useEffect(() => {
    const tid = setInterval(() => { const v = videoRef.current; if (!v || v.paused) return; onSaveCW?.({ time: v.currentTime, duration: v.duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx }); }, 30000);
    return () => clearInterval(tid);
  }, [currentEpIdx, currentSeasonIdx, onSaveCW]);

  /* ── buffer progress ────────────────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setBuffering(!preparing); // Show buffering only when not in preparing state
    setDlSpeed(preparing ? '' : 'Menghubungkan...');
    const tid = setInterval(() => {
      const totalDur = duration || video.duration;
      if (!totalDur || totalDur === Infinity) return;
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferPct((end / totalDur) * 100);
      }
      if (video.readyState >= 4 && !video.paused && !video.seeking) setBuffering(false);
    }, 500);
    return () => clearInterval(tid);
  }, [url, curDlIdx, duration, preparing]);

  /* ── controls ───────────────────────────────────────── */
  function showControls() {
    setShowCtrl(true);
    if (wrapRef.current) wrapRef.current.style.cursor = 'default';
    clearTimeout(ctrlTimer.current);
    ctrlTimer.current = setTimeout(() => { if (videoRef.current && !videoRef.current.paused) { setShowCtrl(false); if (wrapRef.current) wrapRef.current.style.cursor = 'none'; } }, 5000);
  }
  useEffect(() => { const el = wrapRef.current; if (!el) return; const m = () => showControls(); el.addEventListener('mousemove', m); return () => el.removeEventListener('mousemove', m); }, []);

  /* ── keyboard ───────────────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const v = videoRef.current; if (!v) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
      if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); showControls(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  /* ── volume & pip ───────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = volume; v.muted = isMuted; }
  }, [volume, isMuted, url]);

  function togglePip() {
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else videoRef.current?.requestPictureInPicture();
    } catch {}
  }

  /* ── click play/pause ───────────────────────────────── */
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  const [playIconType, setPlayIconType] = useState('fa-play');
  const playIconTimer = useRef(null);
  function handleVideoAreaClick(e) {
    if (preparing) return; // Don't toggle during prepare
    if (e.target.closest('.player-row-top') || e.target.closest('.player-row-bottom') || e.target.closest('.player-ep-panel') || e.target.closest('.pctrl-popup')) return;
    const v = videoRef.current; if (!v) return;
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    const willPlay = v.paused;
    willPlay ? v.play() : v.pause();
    setPlayIconType(willPlay ? 'fa-play' : 'fa-pause');
    setShowPlayIcon(true);
    clearTimeout(playIconTimer.current);
    playIconTimer.current = setTimeout(() => setShowPlayIcon(false), 600);
    showControls();
  }

  function seekBy(sec) { const v = videoRef.current; if (!v) return; v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, v.currentTime + sec)); showControls(); }
  function onProgressClick(e) { e.stopPropagation(); const rect = progressRef.current.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); if (videoRef.current) videoRef.current.currentTime = p * (duration || videoRef.current?.duration || 0); showControls(); }

  /* ── quality ─────────────────────────────────────────── */
  const usingHls = hlsLevels.length > 1;
  const usingDl = !usingHls && downloads.length > 1;
  const hasQuality = usingHls || usingDl;
  function setHlsQuality(idx) { if (hlsRef.current) hlsRef.current.currentLevel = idx; setCurHlsLevel(idx); setShowQuality(false); }
  function setManualQuality(idx) {
    if (!downloads[idx]) return; 
    const video = videoRef.current; 
    const t = video?.currentTime || 0; 
    setCurDlIdx(idx); 
    setShowQuality(false);
    
    if (downloads[idx].hlsUrl) {
      pendingTimeRef.current = t;
      setActiveHlsCheckUrl(downloads[idx].hlsUrl);
      setActiveMp4Fallback(downloads[idx].url);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      setUrl(''); // Trigger new polling process
    } else if (video) { 
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } 
      video.src = downloads[idx].url; 
      video.load(); 
      video.addEventListener('loadedmetadata', () => { 
        video.currentTime = t; 
        video.play().catch(()=>{}); 
      }, { once: true }); 
    }
  }
  function getLabelForHeight(h, fallback) {
    if (!h) return fallback;
    if (h >= 1080) return `High ${h}p`;
    if (h >= 480) return `Medium ${h}p`;
    return `Low ${h}p`;
  }
  function qualityLabel() { if (usingHls) return curHlsLevel === -1 ? 'Auto' : getLabelForHeight(hlsLevels[curHlsLevel]?.height, 'Q'+(curHlsLevel+1)); if (usingDl) return downloads[curDlIdx]?.label || 'Auto'; return 'Auto'; }

  /* ── subtitles ───────────────────────────────────────── */
  const SUB_SIZES = { small: 32, medium: 38, large: 48 };
  function applyCueSize(size) { const px = SUB_SIZES[size] || 38; let s = document.getElementById('oflix-cue-size'); if (!s) { s = document.createElement('style'); s.id = 'oflix-cue-size'; document.head.appendChild(s); } s.textContent = `::cue { font-size: ${px}px !important; }`; }
  function changeSubSize(size) { setSubSize(size); applyCueSize(size); }
  function selectSub(i) { setSubIdx(i); setShowSubMenu(false); const v = videoRef.current; if (!v) return; Array.from(v.textTracks).forEach((t, idx) => { t.mode = idx === i ? 'showing' : 'disabled'; }); applyCueSize(subSize); }
  function turnOffSub() { setSubIdx(-1); setShowSubMenu(false); const v = videoRef.current; if (!v) return; Array.from(v.textTracks).forEach(t => { t.mode = 'disabled'; }); }

  /* ── fullscreen ──────────────────────────────────────── */
  function applyRotation() { if (window.innerWidth >= window.innerHeight) return; const el = wrapRef.current; if (!el) return; el.style.cssText = `position:fixed;top:0;left:0;width:${window.innerHeight}px;height:${window.innerWidth}px;transform:rotate(90deg) translateY(-100%);transform-origin:top left;z-index:99999;background:#000;`; el.dataset.rotated = '1'; setIsFullscreen(true); }
  function removeRotation() { const el = wrapRef.current; if (!el) return; el.style.cssText = ''; el.dataset.rotated = ''; setIsFullscreen(false); }
  function toggleFullscreen(e) {
    e.stopPropagation(); const el = wrapRef.current; if (!el) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement); const isCss = el.dataset.rotated === '1';
    if (isFs || isCss) { if (isFs) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); if (isCss) removeRotation(); try { screen.orientation?.unlock?.(); } catch {} }
    else { const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); if (p instanceof Promise) p.then(() => { try { screen.orientation?.lock?.('landscape').catch(()=>{}); } catch {} }).catch(() => applyRotation()); else if (p === undefined) applyRotation(); }
  }

  /* ── episodes ────────────────────────────────────────── */
  const eps = seasons[currentSeasonIdx]?.episodes || [];
  const panelEps = seasons[panelSeason]?.episodes || [];
  function playEp(sIdx, eIdx) { setShowEpPanel(false); onEpisodeChange?.(sIdx, eIdx); }
  useEffect(() => { setPanelSeason(currentSeasonIdx); }, [currentSeasonIdx]);

  const pct = duration ? (curTime / duration) * 100 : 0;

  return (
    <div ref={wrapRef} className="player-overlay" onTouchStart={showControls} onClick={handleVideoAreaClick}>
      {/* ── VIDEO ── */}
      <div className="player-video-wrap">
        <video ref={videoRef} playsInline crossOrigin="anonymous"
          onTimeUpdate={e => setCurTime(e.target.currentTime)}
          onDurationChange={e => { const d = e.target.duration; if (d && d !== Infinity) setDuration(prev => Math.max(prev, d)); }}
          onPlay={() => { setPlaying(true); setBuffering(false); showControls(); }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)}
          onSeeking={() => setBuffering(true)} onSeeked={() => setBuffering(false)}
          onEnded={() => { onSaveCW?.({ time: 0, duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx }); if (currentEpIdx >= 0 && currentEpIdx < eps.length - 1) playEp(currentSeasonIdx, currentEpIdx + 1); }}
        />
      </div>

      {/* ── PREPARING STATE (polling VPS) ──────────────────── */}
      {preparing && (
        <div style={{
          position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          zIndex:9050, pointerEvents:'none', textAlign:'center',
          background:'rgba(0,0,0,0.75)', borderRadius:16, padding:'32px 48px',
          backdropFilter:'blur(12px)',
        }}>
          <div className="spinner" style={{ width:48, height:48, borderWidth:3, margin:'0 auto 18px' }} />
          <div style={{ color:'#fff', fontSize:16, fontWeight:700, marginBottom:8 }}>Menyiapkan Video...</div>
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:12, marginBottom:12 }}>
            Mengkonversi untuk streaming
          </div>
          <div style={{ width:160, height:4, background:'rgba(255,255,255,0.1)', borderRadius:2, margin:'0 auto' }}>
            <div style={{ height:'100%', background:'var(--primary)', borderRadius:2, width: Math.min(prepProgress, 100)+'%', transition:'width 0.5s ease' }} />
          </div>
          <div style={{ color:'rgba(255,255,255,0.3)', fontSize:11, marginTop:8 }}>
            {prepProgress < 50 ? 'Mengunduh...' : 'Mengkonversi...'}
          </div>
        </div>
      )}

      {/* ── BUFFERING (normal playback) ───────────────────── */}
      {!preparing && buffering && (
        <div style={{
          position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          zIndex:9050, pointerEvents:'none', textAlign:'center',
          background:'rgba(0,0,0,0.6)', borderRadius:16, padding:'24px 36px', backdropFilter:'blur(8px)',
        }}>
          <div className="spinner" style={{ width:40, height:40, borderWidth:3, margin:'0 auto 14px' }} />
          <div style={{ color:'#fff', fontSize:14, fontWeight:700, marginBottom:6 }}>Memuat Video...</div>
          {dlSpeed && <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:600 }}>{dlSpeed}</div>}
          {bufferPct > 0 && bufferPct < 99 && (
            <div style={{ marginTop:8, width:120, height:3, background:'rgba(255,255,255,0.15)', borderRadius:2, margin:'8px auto 0' }}>
              <div style={{ height:'100%', background:'var(--primary)', borderRadius:2, width: Math.min(bufferPct, 100)+'%', transition:'width 0.3s' }} />
            </div>
          )}
        </div>
      )}

      {/* ── PLAY/PAUSE FLASH ──────────────────────────────── */}
      {showPlayIcon && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:9060, pointerEvents:'none', width:80, height:80, borderRadius:'50%', background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeOutScale 0.6s ease forwards' }}>
          <i className={`fas ${playIconType}`} style={{ color:'#fff', fontSize:30 }} />
        </div>
      )}

      {/* ── CONTROLS ──────────────────────────────────────── */}
      <div className={`player-ctrl ${showCtrl ? '' : 'player-ctrl--hidden'}`}>
        
        {/* Top Row: Just Back Button */}
        <div className="player-row-top" onClick={e => e.stopPropagation()} style={{ background: 'transparent' }}>
          <button className="pctrl-btn pctrl-back" style={{ padding: '20px 24px', fontSize: 24 }} onClick={() => { onSaveCW?.({ time: videoRef.current?.currentTime||0, duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx }); onClose(); }}>
            <i className="fas fa-arrow-left" />
          </button>
        </div>

        {/* Bottom Row */}
        <div className="player-row-bottom" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '24px', background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)' }}>
          
          {/* Progress Bar Top */}
          <div ref={progressRef} className="pctrl-seek" onClick={onProgressClick} style={{ margin: '0 24px', cursor: 'pointer', position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
            <div className="pctrl-seek-track" style={{ height: 4, width: '100%', background: 'rgba(255,255,255,0.2)', position: 'relative', borderRadius: 2 }}>
              <div style={{ position:'absolute', top:0, left:0, height:'100%', width: bufferPct+'%', background:'rgba(255,255,255,0.4)', borderRadius:2, transition:'width 0.3s linear' }} />
              <div className="pctrl-seek-fill" style={{ width: pct+'%', background: '#e50914', height: '100%', borderRadius: 2, position: 'relative' }}>
                <div className="pctrl-seek-thumb" style={{ position: 'absolute', right: -6, top: -4, width: 12, height: 12, background: '#fff', borderRadius: '50%', boxShadow: '0 0 5px rgba(0,0,0,0.5)' }} />
              </div>
            </div>
          </div>
          
          <div className="pctrl-bottom-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
            {/* Left Controls */}
            <div className="pctrl-left" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <button className="pctrl-btn" onClick={() => videoRef.current && (videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause())}>
                <i className={`fas ${playing ? 'fa-pause' : 'fa-play'}`} style={{ fontSize: 24 }} />
              </button>
              
              <button className="pctrl-btn" onClick={() => seekBy(-10)} style={{ position: 'relative', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="fas fa-undo" style={{ fontSize: 22 }} />
                <span style={{ fontSize: 9, fontWeight: 900, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -35%)' }}>10</span>
              </button>
              
              <button className="pctrl-btn" onClick={() => seekBy(10)} style={{ position: 'relative', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="fas fa-redo" style={{ fontSize: 22 }} />
                <span style={{ fontSize: 9, fontWeight: 900, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -35%)' }}>10</span>
              </button>
              
              <div className="pctrl-menu-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
                   onMouseEnter={() => setShowVolume(true)} onMouseLeave={() => setShowVolume(false)}>
                <button className="pctrl-btn" onClick={() => setIsMuted(!isMuted)}>
                  <i className={`fas ${isMuted || volume === 0 ? 'fa-volume-mute' : (volume > 0.5 ? 'fa-volume-up' : 'fa-volume-down')}`} style={{ fontSize: 20 }} />
                </button>
                <div style={{ width: showVolume ? 80 : 0, overflow: 'hidden', transition: 'width 0.2s', display: 'flex', alignItems: 'center' }}>
                  <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
                         onChange={e => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
                         style={{ width: '100%', cursor: 'pointer', accentColor: '#e50914' }} />
                </div>
              </div>
              
              <span className="pctrl-time" style={{ fontSize: 14, fontWeight: 500, fontFamily: 'monospace', opacity: 0.8 }}>
                {fmtTime(curTime)} <span style={{opacity:0.5, margin:'0 4px'}}>/</span> {fmtTime(duration)}
              </span>
            </div>
            
            {/* Center: Title */}
            <div className="pctrl-center" style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 20px', letterSpacing: '0.5px' }}>
              {title}
            </div>
            
            {/* Right Controls */}
            <div className="pctrl-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {eps.length > 0 && (<button className="pctrl-btn" title="Previous Episode" disabled={currentEpIdx <= 0} onClick={e=>{e.stopPropagation(); if(currentEpIdx>0) playEp(currentSeasonIdx, currentEpIdx-1);}}><i className="fas fa-step-backward" style={{ fontSize: 18 }} /></button>)}
              {eps.length > 0 && (<button className="pctrl-btn" title="Next Episode" disabled={currentEpIdx >= eps.length - 1} onClick={e=>{e.stopPropagation(); if(currentEpIdx<eps.length-1) playEp(currentSeasonIdx, currentEpIdx+1);}}><i className="fas fa-step-forward" style={{ fontSize: 18 }} /></button>)}
              
              <button className="pctrl-btn" onClick={togglePip} title="Picture in Picture"><i className="fas fa-external-link-alt" style={{ fontSize: 18 }} /></button>
              {seasons.length > 0 && (<button className="pctrl-btn" onClick={e=>{e.stopPropagation();setShowEpPanel(v=>!v);setShowQuality(false);setShowSubMenu(false);setShowSizeMenu(false);}} title="Episodes List"><i className="fas fa-layer-group" style={{ fontSize: 18 }} /></button>)}
              
              {subtitles.length > 0 && (
                <div className="pctrl-menu-wrap">
                  <button className={`pctrl-btn pctrl-cc ${subIdx >= 0 ? 'active' : ''}`} onClick={e => { e.stopPropagation(); setShowSubMenu(v=>!v); setShowQuality(false); setShowSizeMenu(false); }} title="Subtitles">
                    <i className="fas fa-closed-captioning" style={{ fontSize: 20 }} />
                  </button>
                  {showSubMenu && (<div className="pctrl-popup" style={{bottom: '100%', right: 0, marginBottom: 15}}><div className="pctrl-popup-head">Subtitle</div><div className={`pctrl-popup-item ${subIdx===-1?'on':''}`} onClick={e=>{e.stopPropagation();turnOffSub();}}>Off</div>{subtitles.map((s,i) => (<div key={i} className={`pctrl-popup-item ${subIdx===i?'on':''}`} onClick={e=>{e.stopPropagation();selectSub(i);}}>{s.name}</div>))}</div>)}
                </div>
              )}
              
              {hasQuality && (
                <div className="pctrl-menu-wrap">
                  <button className="pctrl-btn pctrl-quality" style={{ fontSize: 14, fontWeight: 'bold' }} onClick={e => { e.stopPropagation(); setShowQuality(v=>!v); setShowSubMenu(false); setShowSizeMenu(false); }}>{qualityLabel()}</button>
                  {showQuality && (<div className="pctrl-popup" style={{bottom: '100%', right: 0, marginBottom: 15}}><div className="pctrl-popup-head">Kualitas</div>{usingHls && <><div className={`pctrl-popup-item ${curHlsLevel===-1?'on':''}`} onClick={e=>{e.stopPropagation();setHlsQuality(-1);}}>Auto</div>{hlsLevels.map((l,i) => (<div key={i} className={`pctrl-popup-item ${curHlsLevel===i?'on':''}`} onClick={e=>{e.stopPropagation();setHlsQuality(i);}}>{getLabelForHeight(l.height, 'Q'+(i+1))}</div>))}</>}{usingDl && downloads.map((d,i) => (<div key={i} className={`pctrl-popup-item ${curDlIdx===i?'on':''}`} onClick={e=>{e.stopPropagation();setManualQuality(i);}}>{d.label}</div>))}</div>)}
                </div>
              )}
              
              {/* Settings / Gear icon can be added here if needed, omitted to stick closely to user screenshot */}
              
              <button className="pctrl-btn pctrl-fs" onClick={toggleFullscreen}><i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`} style={{ fontSize: 20 }} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* ── EPISODE PANEL ─────────────────────────────────── */}
      {seasons.length > 0 && (
        <div className={`player-ep-panel ${showEpPanel ? 'open' : ''}`} onClick={e => e.stopPropagation()}>
          <div className="panel-header"><span className="panel-title">Episode</span><button className="panel-close" onClick={()=>setShowEpPanel(false)}>&times;</button></div>
          {seasons.length > 1 && (<div className="season-tabs" style={{padding:'8px 14px 0'}}>{seasons.map((s,si) => (<button key={si} className={`season-tab ${si===panelSeason?'active':''}`} onClick={()=>setPanelSeason(si)}>S{s.season||si+1}</button>))}</div>)}
          <div className="panel-ep-scroll">
            {panelEps.map((ep,ei) => {
              const isPlaying = panelSeason === currentSeasonIdx && ei === currentEpIdx;
              return (<div key={ei} className="ep-item" onClick={()=>playEp(panelSeason,ei)}><div className={`ep-num ${isPlaying?'active':''}`}>{ep.episode||ei+1}</div><div className="ep-info"><div className="ep-title">{ep.title||`Episode ${ep.episode||ei+1}`}</div>{isPlaying && <div className="ep-sub">▶ SEDANG DIPUTAR</div>}</div><i className="fas fa-play ep-play" /></div>);
            })}
          </div>
        </div>
      )}
    </div>
  );
}
