import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { fmtTime } from '../api.js';

export default function VideoPlayer({
  url,
  title,
  subtitles = [],
  downloads = [],
  startDlIdx: initialDlIdx = 0,
  seasons = [],
  currentSeasonIdx = 0,
  currentEpIdx = -1,
  onEpisodeChange,
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

  // ── Web Audio API ──────────────────────────────────────
  const audioCtxRef = useRef(null);
  const sourceRef   = useRef(null);

  const [playing, setPlaying]         = useState(false);
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
  const [curDlIdx, setCurDlIdx]       = useState(0);
  const [subIdx, setSubIdx]           = useState(0);
  const [subSize, setSubSize]         = useState('small');
  const [buffering, setBuffering]     = useState(false);
  const [bufferPct, setBufferPct]     = useState(0);
  const [panelSeason, setPanelSeason] = useState(currentSeasonIdx);

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
        if (el?.dataset.rotated === '1') {
          el.style.cssText = '';
          el.dataset.rotated = '';
        }
        try { (screen.orientation?.unlock || (() => {}))(); } catch {}
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  /* ── load source ────────────────────────────────────── */
  useEffect(() => {
    if (!url) return;
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setHlsLevels([]); setCurHlsLevel(-1); setCurDlIdx(initialDlIdx);

    function initAudio() {
      if (sourceRef.current) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(video);
        sourceRef.current = source;

        const lowCut = ctx.createBiquadFilter();
        lowCut.type = 'highpass'; lowCut.frequency.value = 90; lowCut.Q.value = 0.7;

        const lowShelf = ctx.createBiquadFilter();
        lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 80; lowShelf.gain.value = 2;

        const hiMid = ctx.createBiquadFilter();
        hiMid.type = 'peaking'; hiMid.frequency.value = 3000; hiMid.Q.value = 0.9; hiMid.gain.value = 3;

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 8; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.25;

        const highShelf = ctx.createBiquadFilter();
        highShelf.type = 'highshelf'; highShelf.frequency.value = 8000; highShelf.gain.value = 1.5;

        const gain = ctx.createGain();
        gain.gain.value = 1.4;

        source.connect(lowCut);
        lowCut.connect(lowShelf);
        lowShelf.connect(hiMid);
        hiMid.connect(comp);
        comp.connect(highShelf);
        highShelf.connect(gain);
        gain.connect(ctx.destination);

        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        console.warn('Web Audio init failed:', e.message);
      }
    }

    function startPlay() {
      video.currentTime = savedTime > 10 ? savedTime : 0;
      initAudio();
      video.play().catch(() => {});
      setPlaying(true);
    }

    if (url.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          fragLoadingMaxRetry: 10,
          startLevel: -1,
          autoLevelCapping: -1,
          abrEwmaDefaultEstimate: 10_000_000,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          const levels = data.levels || [];
          setHlsLevels(levels);
          // Start at ~480p instead of highest
          let startIdx = 0;
          for (let i = 0; i < levels.length; i++) {
            if (levels[i].height && levels[i].height <= 480) startIdx = i;
          }
          hls.startLevel   = startIdx;
          hls.currentLevel = startIdx;
          setCurHlsLevel(startIdx);
          startPlay();
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
  }, [url]);

  /* ── load subtitles as blob VTT ────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setSubIdx(0);
    Array.from(video.querySelectorAll('track')).forEach(t => { try { video.removeChild(t); } catch {} });
    blobUrls.current.forEach(u => URL.revokeObjectURL(u));
    blobUrls.current = [];
    if (!subtitles.length) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < subtitles.length; i++) {
        if (cancelled) return;
        try {
          const res  = await fetch(subtitles[i].url);
          let   text = await res.text();
          if (!text.trimStart().startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text;
          const blob    = new Blob([text], { type: 'text/vtt' });
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.current.push(blobUrl);
          if (cancelled) return;
          const track   = document.createElement('track');
          track.kind    = 'subtitles';
          track.label   = subtitles[i].name;
          track.srclang = subtitles[i].language;
          track.src     = blobUrl;
          if (i === 0) track.default = true;
          video.appendChild(track);
        } catch (e) { console.warn('Sub load fail:', subtitles[i].name, e.message); }
      }
      if (!cancelled) {
        setTimeout(() => {
          Array.from(video.textTracks).forEach((t, i) => { t.mode = i === 0 ? 'showing' : 'disabled'; });
          applyCueSize(subSize);
        }, 500);
      }
    })();
    return () => { cancelled = true; };
  }, [subtitles, url]);

  /* ── save progress every 30s ────────────────────────── */
  useEffect(() => {
    const tid = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      onSaveCW?.({ time: v.currentTime, duration: v.duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx });
    }, 30000);
    return () => clearInterval(tid);
  }, [currentEpIdx, currentSeasonIdx, onSaveCW]);

  /* ── buffer progress tracking ───────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tid = setInterval(() => {
      if (video.buffered.length > 0 && video.duration > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferPct((end / video.duration) * 100);
      }
    }, 500);
    return () => clearInterval(tid);
  }, [url]);

  /* ── controls auto-hide 5s + cursor hide ────────────── */
  function showControls() {
    setShowCtrl(true);
    if (wrapRef.current) wrapRef.current.style.cursor = 'default';
    clearTimeout(ctrlTimer.current);
    ctrlTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowCtrl(false);
        if (wrapRef.current) wrapRef.current.style.cursor = 'none';
      }
    }, 5000);
  }

  /* ── mouse move triggers show ───────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onMove() { showControls(); }
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, []);

  function togglePlay(e) {
    e?.stopPropagation();
    const v = videoRef.current; if (!v) return;
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    v.paused ? v.play() : v.pause();
    showControls();
  }

  function seekBy(sec) {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + sec));
    showControls();
  }

  function onProgressClick(e) {
    e.stopPropagation();
    const rect = progressRef.current.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current) videoRef.current.currentTime = pct * (duration || 0);
    showControls();
  }

  /* ── quality ─────────────────────────────────────────── */
  const usingHls   = hlsLevels.length > 1;
  const usingDl    = !usingHls && downloads.length > 1;
  const hasQuality = usingHls || usingDl;

  function setHlsQuality(idx) {
    if (hlsRef.current) hlsRef.current.currentLevel = idx;
    setCurHlsLevel(idx); setShowQuality(false);
  }

  function setManualQuality(idx) {
    if (!downloads[idx]) return;
    const video = videoRef.current;
    const t     = video?.currentTime || 0;
    setCurDlIdx(idx); setShowQuality(false);
    if (video) {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.src = downloads[idx].url;
      video.load();
      video.addEventListener('loadedmetadata', () => { video.currentTime = t; video.play().catch(()=>{}); }, { once: true });
    }
  }

  function qualityLabel() {
    if (usingHls) return curHlsLevel === -1 ? 'Auto' : (hlsLevels[curHlsLevel]?.height ? hlsLevels[curHlsLevel].height+'p' : 'Q'+(curHlsLevel+1));
    if (usingDl)  return downloads[curDlIdx]?.label || 'Auto';
    return 'Auto';
  }

  /* ── subtitle — desktop sizes: 32/38/48 ─────────────── */
  const SUB_SIZES = { small: 32, medium: 38, large: 48 };

  function applyCueSize(size) {
    const px = SUB_SIZES[size] || 38;
    let styleEl = document.getElementById('oflix-cue-size');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'oflix-cue-size';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `::cue { font-size: ${px}px !important; }`;
  }

  function changeSubSize(size) {
    setSubSize(size);
    applyCueSize(size);
  }

  function selectSub(i) {
    setSubIdx(i); setShowSubMenu(false);
    const video = videoRef.current; if (!video) return;
    Array.from(video.textTracks).forEach((t, idx) => { t.mode = idx === i ? 'showing' : 'disabled'; });
    applyCueSize(subSize);
  }
  function turnOffSub() {
    setSubIdx(-1); setShowSubMenu(false);
    const video = videoRef.current; if (!video) return;
    Array.from(video.textTracks).forEach(t => { t.mode = 'disabled'; });
  }

  /* ── fullscreen + aggressive landscape lock ─────────── */
  function applyRotation() {
    if (window.innerWidth >= window.innerHeight) return;
    const el = wrapRef.current; if (!el) return;
    const vw = window.innerHeight;
    const vh = window.innerWidth;
    el.style.cssText = [
      'position:fixed','top:0','left:0',
      `width:${vw}px`,`height:${vh}px`,
      'transform:rotate(90deg) translateY(-100%)',
      'transform-origin:top left','z-index:99999','background:#000',
    ].join(';') + ';';
    el.dataset.rotated = '1';
    setIsFullscreen(true);
  }

  function removeRotation() {
    const el = wrapRef.current; if (!el) return;
    el.style.cssText = '';
    el.dataset.rotated = '';
    setIsFullscreen(false);
  }

  function lockLandscape() {
    try {
      const ori = screen.orientation;
      if (ori?.lock) { ori.lock('landscape').catch(() => {}); }
    } catch {}
  }

  function toggleFullscreen(e) {
    e.stopPropagation();
    const el    = wrapRef.current; if (!el) return;
    const isFs  = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const isCss = el.dataset.rotated === '1';
    if (isFs || isCss) {
      if (isFs) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      if (isCss) removeRotation();
      try { screen.orientation?.unlock?.(); } catch {}
    } else {
      const fsPromise = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
      if (fsPromise instanceof Promise) {
        fsPromise.then(() => lockLandscape()).catch(() => applyRotation());
      } else if (fsPromise === undefined) {
        applyRotation();
      } else {
        lockLandscape();
      }
    }
  }

  /* ── episodes ────────────────────────────────────────── */
  const eps = seasons[currentSeasonIdx]?.episodes || [];
  const panelEps = seasons[panelSeason]?.episodes || [];
  function playEp(sIdx, eIdx) { setShowEpPanel(false); onEpisodeChange?.(sIdx, eIdx); }

  // Sync panelSeason when currentSeasonIdx changes
  useEffect(() => { setPanelSeason(currentSeasonIdx); }, [currentSeasonIdx]);

  const pct = duration ? (curTime / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className="player-overlay"
      onTouchStart={showControls}
      onClick={showControls}
    >
      {/* ── VIDEO ────────────────────────────────────────── */}
      <div className="player-video-wrap">
        <video
          ref={videoRef}
          playsInline
          crossOrigin="anonymous"
          onTimeUpdate={e => setCurTime(e.target.currentTime)}
          onDurationChange={e => setDuration(e.target.duration)}
          onPlay={() => { setPlaying(true); setBuffering(false); showControls(); }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onSeeking={() => setBuffering(true)}
          onSeeked={() => setBuffering(false)}
          onEnded={() => {
            onSaveCW?.({ time: 0, duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx });
            if (currentEpIdx >= 0 && currentEpIdx < eps.length - 1) playEp(currentSeasonIdx, currentEpIdx + 1);
          }}
        />
      </div>

      {/* ── BUFFERING SPINNER ────────────────────────────── */}
      {buffering && (
        <div style={{
          position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          zIndex:9050, pointerEvents:'none',
        }}>
          <div className="spinner" style={{ width:48, height:48, borderWidth:4 }} />
        </div>
      )}

      {/* ── CONTROLS OVERLAY ─────────────────────────────── */}
      <div
        className={`player-ctrl ${showCtrl ? '' : 'player-ctrl--hidden'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* TOP ROW */}
        <div className="player-row-top">
          <button className="pctrl-btn pctrl-back" onClick={() => {
            onSaveCW?.({ time: videoRef.current?.currentTime||0, duration, episode: currentEpIdx, seasonIdx: currentSeasonIdx });
            onClose();
          }}>
            <i className="fas fa-chevron-left" />
          </button>

          <div className="pctrl-title">{title}</div>

          <div className="pctrl-top-actions">
            {subtitles.length > 0 && (
              <div className="pctrl-menu-wrap">
                <button
                  className={`pctrl-btn pctrl-cc ${subIdx >= 0 ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); setShowSubMenu(v=>!v); setShowQuality(false); setShowSizeMenu(false); }}
                >CC</button>
                {showSubMenu && (
                  <div className="pctrl-popup">
                    <div className="pctrl-popup-head">Subtitle</div>
                    <div className={`pctrl-popup-item ${subIdx===-1?'on':''}`} onClick={e=>{e.stopPropagation();turnOffSub();}}>Off</div>
                    {subtitles.map((s,i) => (
                      <div key={i} className={`pctrl-popup-item ${subIdx===i?'on':''}`} onClick={e=>{e.stopPropagation();selectSub(i);}}>{s.name}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pctrl-menu-wrap">
              <button
                className="pctrl-btn pctrl-quality"
                onClick={e => { e.stopPropagation(); setShowSubMenu(false); setShowQuality(false); setShowSizeMenu(v=>!v); }}
                title="Ukuran Subtitle"
              >
                <i className="fas fa-text-height" />
              </button>
              {showSizeMenu && (
                <div className="pctrl-popup" style={{minWidth:140}}>
                  <div className="pctrl-popup-head">Ukuran Subtitle</div>
                  {[['small','S','32px'],['medium','M','38px'],['large','L','48px']].map(([sz,label,px]) => (
                    <div
                      key={sz}
                      className={`pctrl-popup-item ${subSize===sz?'on':''}`}
                      onClick={e=>{e.stopPropagation();changeSubSize(sz);setShowSizeMenu(false);}}
                    >
                      <span style={{marginRight:8,fontWeight:900}}>{label}</span>
                      <span style={{opacity:0.5,fontSize:11}}>{px}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {hasQuality && (
              <div className="pctrl-menu-wrap">
                <button
                  className="pctrl-btn pctrl-quality"
                  onClick={e => { e.stopPropagation(); setShowQuality(v=>!v); setShowSubMenu(false); setShowSizeMenu(false); }}
                >{qualityLabel()}</button>
                {showQuality && (
                  <div className="pctrl-popup">
                    <div className="pctrl-popup-head">Kualitas</div>
                    {usingHls && <>
                      <div className={`pctrl-popup-item ${curHlsLevel===-1?'on':''}`} onClick={e=>{e.stopPropagation();setHlsQuality(-1);}}>Auto</div>
                      {hlsLevels.map((l,i) => (
                        <div key={i} className={`pctrl-popup-item ${curHlsLevel===i?'on':''}`} onClick={e=>{e.stopPropagation();setHlsQuality(i);}}>
                          {l.height ? l.height+'p' : 'Q'+(i+1)}
                        </div>
                      ))}
                    </>}
                    {usingDl && downloads.map((d,i) => (
                      <div key={i} className={`pctrl-popup-item ${curDlIdx===i?'on':''}`} onClick={e=>{e.stopPropagation();setManualQuality(i);}}>{d.label}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {seasons.length > 0 && (
              <button className="pctrl-btn" onClick={e=>{e.stopPropagation();setShowEpPanel(v=>!v);setShowQuality(false);setShowSubMenu(false);setShowSizeMenu(false);}}>
                <i className="fas fa-list" />
              </button>
            )}
          </div>
        </div>

        {/* CENTER */}
        <div className="player-center" onClick={togglePlay}>
          {eps.length > 0 && (
            <button className="player-center-btn ep-nav" disabled={currentEpIdx <= 0}
              onClick={e=>{e.stopPropagation(); if(currentEpIdx>0) playEp(currentSeasonIdx, currentEpIdx-1);}}>
              <i className="fas fa-step-backward" />
            </button>
          )}
          <button className="player-center-btn skip" onClick={e=>{e.stopPropagation();seekBy(-10);}}>
            <i className="fas fa-undo" style={{fontSize:13}} />
            <span style={{fontSize:8,position:'absolute',marginTop:1}}>10</span>
          </button>
          <button className="player-center-btn play">
            <i className={`fas ${playing ? 'fa-pause' : 'fa-play'}`} />
          </button>
          <button className="player-center-btn skip" onClick={e=>{e.stopPropagation();seekBy(10);}}>
            <i className="fas fa-redo" style={{fontSize:13}} />
          </button>
          {eps.length > 0 && (
            <button className="player-center-btn ep-nav" disabled={currentEpIdx >= eps.length - 1}
              onClick={e=>{e.stopPropagation(); if(currentEpIdx<eps.length-1) playEp(currentSeasonIdx, currentEpIdx+1);}}>
              <i className="fas fa-step-forward" />
            </button>
          )}
        </div>

        {/* BOTTOM */}
        <div className="player-row-bottom">
          <div ref={progressRef} className="pctrl-seek" onClick={onProgressClick}>
            <div className="pctrl-seek-track">
              {/* Buffer bar — behind play progress */}
              <div style={{
                position:'absolute', top:0, left:0, height:'100%',
                width: bufferPct + '%',
                background:'rgba(255,255,255,0.2)',
                borderRadius:2, transition:'width 0.3s linear',
              }} />
              {/* Play progress */}
              <div className="pctrl-seek-fill" style={{width: pct+'%'}}>
                <div className="pctrl-seek-thumb" />
              </div>
            </div>
          </div>

          <div className="pctrl-time-row">
            <span className="pctrl-time">{fmtTime(curTime)}</span>
            <div style={{flex:1}} />
            <span className="pctrl-time">{fmtTime(duration)}</span>
          </div>
          <button className="pctrl-btn pctrl-fs" onClick={toggleFullscreen}>
            <i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`} />
          </button>
        </div>
      </div>

      {/* ── EPISODE PANEL ────────────────────────────────── */}
      {seasons.length > 0 && (
        <div className={`player-ep-panel ${showEpPanel ? 'open' : ''}`}>
          <div className="panel-header">
            <span className="panel-title">Episode</span>
            <button className="panel-close" onClick={()=>setShowEpPanel(false)}>&times;</button>
          </div>
          {seasons.length > 1 && (
            <div className="season-tabs" style={{padding:'8px 14px 0'}}>
              {seasons.map((s,si) => (
                <button key={si} className={`season-tab ${si===panelSeason?'active':''}`}
                  onClick={()=>setPanelSeason(si)}>S{s.season||si+1}</button>
              ))}
            </div>
          )}
          <div className="panel-ep-scroll">
            {panelEps.map((ep,ei) => {
              const isPlaying = panelSeason === currentSeasonIdx && ei === currentEpIdx;
              return (
              <div key={ei} className="ep-item" onClick={()=>playEp(panelSeason,ei)}>
                <div className={`ep-num ${isPlaying?'active':''}`}>{ep.episode||ei+1}</div>
                <div className="ep-info">
                  <div className="ep-title">{ep.title||`Episode ${ep.episode||ei+1}`}</div>
                  {isPlaying && <div className="ep-sub">▶ SEDANG DIPUTAR</div>}
                </div>
                <i className="fas fa-play ep-play" />
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
