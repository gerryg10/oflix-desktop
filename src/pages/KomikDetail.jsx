import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchKomikDetail } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const KOMIK_API = '/komik_api.php';

async function fetchPages(bacaSlug) {
  const res  = await fetch(`${KOMIK_API}?action=baca&bacaManga=${encodeURIComponent(bacaSlug)}`);
  const data = await res.json();
  if (data.status === 'ok' && data.images?.length) return data.images;
  throw new Error(data.message || 'Gagal memuat halaman');
}

/* ─── READER (inline, no route change) ──────────────────── */
function Reader({ chapters, startIdx, series, poster, onClose, saveProgress, resumePageIdx = 0 }) {
  const [blocks,      setBlocks]      = useState([]);
  const [loadedSet,   setLoadedSet]   = useState(new Set());
  const [loadingNext, setLoadingNext] = useState(false);
  const [endReached,  setEndReached]  = useState(false);
  const [curChTitle,  setCurChTitle]  = useState(chapters[startIdx]?.title || '');

  const readyRef      = useRef(false);
  const loadingRef    = useRef(false);
  const sentinelRef   = useRef(null);
  const pageRefs      = useRef({});        // `${chIdx}-${pageIdx}` → img DOM node
  const didResume     = useRef(false);
  const saveTimerRef  = useRef(null);      // throttle save
  // Keep latest values accessible in callbacks without stale closure
  const blocksRef     = useRef([]);
  const loadedSetRef  = useRef(new Set());

  // ── hide BottomNav & AppHeader while reader open ──
  useEffect(() => {
    const nav = document.querySelector('.bottom-nav');
    const hdr = document.querySelector('.app-header');
    if (nav) nav.style.display = 'none';
    if (hdr) hdr.style.display = 'none';
    return () => {
      if (nav) nav.style.display = '';
      if (hdr) hdr.style.display = '';
    };
  }, []);

  // ── Sync refs with state ──
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { loadedSetRef.current = loadedSet; }, [loadedSet]);

  // ── Throttled save — only fires 500ms after last call ──
  function throttledSave(chIdx, chTitle, pageIdx) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProgress(chIdx, chTitle, poster, series, pageIdx);
    }, 500);
  }

  // ── Initial chapter load ──
  useEffect(() => {
    const ch = chapters[startIdx];
    if (!ch) return;
    readyRef.current   = false;
    loadingRef.current = false;
    didResume.current  = false;
    pageRefs.current   = {};
    setBlocks([]);
    setLoadedSet(new Set());
    setEndReached(false);
    setLoadingNext(true);

    const slug = ch.bacaManga || ch.url || ch.slug || '';
    fetchPages(slug)
      .then(pages => {
        const newBlock = { chIdx: startIdx, title: ch.title, pages };
        setBlocks([newBlock]);
        setLoadedSet(new Set([startIdx]));
        setCurChTitle(ch.title);
        setLoadingNext(false);
        // Don't overwrite pageIdx on initial load — only save chapter/title
        // pageIdx will be saved by the visibility observer as user scrolls
        setTimeout(() => { readyRef.current = true; }, 1500);
      })
      .catch(e => { console.warn(e); setLoadingNext(false); });
  }, [startIdx]);

  // ── Load next chapter ──
  function loadNext() {
    const currentBlocks = blocksRef.current;
    const currentSet    = loadedSetRef.current;
    if (loadingRef.current || endReached) return;
    const last = currentBlocks[currentBlocks.length - 1];
    if (!last) return;
    const nextIdx = last.chIdx + 1;
    if (nextIdx >= chapters.length) { setEndReached(true); return; }
    if (currentSet.has(nextIdx)) return;

    const ch = chapters[nextIdx];
    if (!ch) { setEndReached(true); return; }
    const slug = ch.bacaManga || ch.url || ch.slug || '';

    loadingRef.current = true;
    readyRef.current   = false;
    setLoadingNext(true);

    fetchPages(slug)
      .then(pages => {
        setBlocks(prev => [...prev, { chIdx: nextIdx, title: ch.title, pages }]);
        setLoadedSet(prev => new Set([...prev, nextIdx]));
        setCurChTitle(ch.title);
        setLoadingNext(false);
        loadingRef.current = false;
        // Save with pageIdx=0 for the new chapter that just started loading
        throttledSave(nextIdx, ch.title, 0);
        setTimeout(() => { readyRef.current = true; }, 1500);
      })
      .catch(e => { console.warn(e); setLoadingNext(false); loadingRef.current = false; });
  }

  // ── IntersectionObserver — sentinel for next chapter ──
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && readyRef.current && !loadingRef.current) {
          loadNext();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [blocks.length, endReached]);

  // ── IntersectionObserver — track visible page across ALL blocks ──
  useEffect(() => {
    if (blocks.length === 0) return;
    // Observe all pages in all loaded blocks
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const chIdx  = parseInt(el.dataset.chIdx  || '0', 10);
        const pgIdx  = parseInt(el.dataset.pageIdx || '0', 10);
        const chTitle = el.dataset.chTitle || '';
        // Update header title
        setCurChTitle(chTitle);
        // Throttled save with correct chIdx + pageIdx
        throttledSave(chIdx, chTitle, pgIdx);
      });
    }, { threshold: 0.4 });

    // Observe every loaded img
    Object.values(pageRefs.current).forEach(el => { if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [blocks.length]); // re-run when new block appended

  // ── Resume scroll — wait for target image to actually render ──
  useEffect(() => {
    if (didResume.current || resumePageIdx <= 0 || blocks.length === 0) return;
    const firstBlock = blocks[0];
    const key = `${firstBlock.chIdx}-${resumePageIdx}`;

    // Poll until the ref exists (lazy-loaded imgs may not be in DOM yet)
    let attempts = 0;
    const poll = setInterval(() => {
      const target = pageRefs.current[key];
      if (target) {
        clearInterval(poll);
        didResume.current = true;
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
      if (++attempts > 30) clearInterval(poll); // give up after 3s
    }, 100);
    return () => clearInterval(poll);
  }, [blocks]);

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', paddingTop: 64 }}>

      {/* ── STICKY HEADER — desktop sized ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5000,
        height: 64,
        background: 'rgba(10,10,10,0.97)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid #1e2028',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 40px',
      }}>
        <button
          onClick={onClose}
          style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'var(--primary)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 16, cursor: 'pointer',
            transition: 'background 0.18s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#ff1a26'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--primary)'}
        >
          <i className="fas fa-chevron-left" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: '#8c8c8c', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{series}</div>
          <div style={{
            fontSize: 15, color: '#fff', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'var(--font-display)',
          }}>{curChTitle}</div>
        </div>
      </div>

      {/* ── CHAPTER BLOCKS — centered, max-width 800px ── */}
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {blocks.map((block, bi) => (
        <div key={block.chIdx}>
          {bi > 0 && (
            <div style={{
              padding: '18px 24px 14px', borderTop: '3px solid #1e2028',
              background: '#0d0d0d',
            }}>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>
                Chapter selanjutnya
              </div>
              <div style={{ fontSize: 16, color: '#fff', fontWeight: 700, fontFamily: 'var(--font-display)' }}>{block.title}</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {block.pages.map((pg, i) => {
              const src = typeof pg === 'string' ? pg : (pg.url || pg.src || pg.image || '');
              const isNearResume = bi === 0 && Math.abs(i - resumePageIdx) <= 5;
              return (
                <img
                  key={i}
                  src={src}
                  alt={`Ch${block.chIdx + 1} p${i + 1}`}
                  loading={isNearResume ? 'eager' : 'lazy'}
                  data-ch-idx={block.chIdx}
                  data-page-idx={i}
                  data-ch-title={block.title}
                  ref={el => { if (el) pageRefs.current[`${block.chIdx}-${i}`] = el; }}
                  style={{ width: '100%', maxWidth: '100%', display: 'block', objectFit: 'contain' }}
                  onError={e => { e.target.style.opacity = '0.08'; }}
                />
              );
            })}
          </div>
        </div>
      ))}

      {!endReached && <div ref={sentinelRef} style={{ height: 1 }} />}

      {loadingNext && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 14 }}>
          <div className="spinner" />
          <span style={{ color: '#555', fontSize: 13 }}>Memuat chapter berikutnya...</span>
        </div>
      )}

      {endReached && !loadingNext && (
        <div style={{ textAlign: 'center', padding: '60px 20px 80px', color: '#333' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🎉</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#555', fontFamily: 'var(--font-display)' }}>Tamat</div>
          <div style={{ fontSize: 14, color: '#444', marginTop: 8 }}>Semua chapter sudah dibaca</div>
          <button onClick={onClose} style={{
            marginTop: 24, padding: '12px 32px', borderRadius: 10,
            background: 'var(--primary)', border: 'none',
            color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            transition: 'background 0.18s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#ff1a26'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--primary)'}
          >← Kembali ke Detail</button>
        </div>
      )}
      <div style={{ height: 30 }} />
      </div>{/* close centering wrapper */}
    </div>
  );
}


/* ─── KOMIK DETAIL page ──────────────────────────────────── */
export default function KomikDetail() {
  const [params] = useSearchParams();
  const slug     = params.get('d') || '';
  const nav      = useNavigate();
  const { getKomikProgress, saveKomikProgress, addToWatchlist, removeFromWatchlist, isInWatchlist } = useAuth();

  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [chapters,  setChapters]  = useState([]);
  const [series,    setSeries]    = useState('');
  const [poster,    setPoster]    = useState('');
  const [descOpen,  setDescOpen]  = useState(false);
  const [readerIdx, setReaderIdx] = useState(null);
  const [inList,    setInList]    = useState(false); // init after slug loads
  const [liked,     setLiked]     = useState(() => localStorage.getItem(`oflix_komik_like_${slug||'x'}`) === '1');
  const [disliked,  setDisliked]  = useState(() => localStorage.getItem(`oflix_komik_dislike_${slug||'x'}`) === '1'); // null = detail view
  const [progVersion, setProgVersion] = useState(0); // bump to re-read progress

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setReaderIdx(null);
    fetchKomikDetail(slug).then(res => {
      if (res.status === 'ok') {
        const info = res.info || {};
        const meta = info.meta || {};
        const chs  = (res.chapters || []).slice().reverse();
        setData({ info, meta });
        setChapters(chs);
        setSeries(meta['Judul Komik'] || meta['Judul'] || info.title || slug);
        setPoster(info.poster || '');
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [slug]);

  // sync inList with watchlist on data load
  useEffect(() => {
    if (slug) setInList(isInWatchlist ? isInWatchlist(slug) : false);
  }, [slug, data]);

  function toggleList() {
    const v = !inList;
    setInList(v);
    if (v) {
      addToWatchlist && addToWatchlist({
        title: series || slug,
        detailPath: slug,
        poster: poster,
        type: 'komik',
      });
    } else {
      removeFromWatchlist && removeFromWatchlist(slug);
    }
  }
  function toggleLike()    { const v=!liked;    setLiked(v);    if(v) setDisliked(false); localStorage.setItem(`oflix_komik_like_${slug}`,v?'1':'0'); localStorage.setItem(`oflix_komik_dislike_${slug}`,'0'); }
  function toggleDislike() { const v=!disliked; setDisliked(v); if(v) setLiked(false);    localStorage.setItem(`oflix_komik_dislike_${slug}`,v?'1':'0'); localStorage.setItem(`oflix_komik_like_${slug}`,'0'); }

  function openChapter(idx) {
    setReaderIdx(idx);
    window.scrollTo(0, 0);
  }

  function closeReader() {
    setReaderIdx(null);
    setProgVersion(v => v + 1); // force re-read localStorage progress
    window.scrollTo(0, 0);
  }

  function saveProgress(chIdx, chTitle, posterUrl, seriesTitle, pageIdx = 0) {
    saveKomikProgress(slug, chIdx, chTitle, posterUrl, seriesTitle, pageIdx);
  }

  // ── READER VIEW ──
  if (readerIdx !== null && chapters.length > 0) {
    const prog = getKomikProgress(slug);
    const resumePage = (prog && prog.chapterIdx === readerIdx) ? (prog.pageIdx || 0) : 0;
    return (
      <Reader
        chapters={chapters}
        startIdx={readerIdx}
        series={series}
        poster={poster}
        onClose={closeReader}
        saveProgress={saveProgress}
        resumePageIdx={resumePage}
      />
    );
  }

  // ── LOADING ──
  if (loading) return (
    <div className="listing-page">
      <div className="spinner-center"><div className="spinner" /></div>
    </div>
  );

  if (!data) return (
    <div className="listing-page" style={{ padding: 40, color: '#666' }}>Gagal memuat komik.</div>
  );

  const { info, meta } = data;
  const title     = meta['Judul Komik'] || meta['Judul'] || info.title || slug;
  const pengarang = meta['Pengarang'] || meta['Author'] || '';
  const status    = meta['Status'] || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prog      = getKomikProgress(slug); // re-reads after progVersion bumps

  return (
    <div className="detail-page">
      <div className="detail-hero" style={{ aspectRatio: '16/9', maxHeight: 220 }}>
        <img src={poster} alt={title} />
        <div className="detail-hero-overlay" />
        <button className="detail-hero-back" onClick={() => nav(-1)}>
          <i className="fas fa-chevron-left" />
        </button>
      </div>

      <div className="detail-content">
        <h1 className="detail-title">{title}</h1>
        <div className="detail-meta">
          {pengarang && <span className="meta-badge">✏️ {pengarang}</span>}
          {status    && <span className="meta-badge" style={{ background: 'rgba(229,9,20,0.15)', color: 'var(--primary)' }}>{status}</span>}
          <span className="meta-badge">{chapters.length} Chapter</span>
        </div>

        {/* ── Daftar / Suka / TdkSuka ── */}
        <div style={{ display:'flex', gap:14, marginBottom:20, marginTop:4 }}>
          {[
            { label:'DAFTAR',   icon: inList    ? 'fa-check' : 'fa-plus',   active: inList,    fn: toggleList    },
            { label:'SUKA',     icon:'fa-thumbs-up',                         active: liked,     fn: toggleLike    },
            { label:'TDK SUKA', icon:'fa-thumbs-down',                       active: disliked,  fn: toggleDislike },
          ].map(({ label, icon, active, fn }) => (
            <div key={label} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <button className={`btn-icon-action ${active?'active':''}`} onClick={fn}>
                <i className={`fas ${icon}`}></i>
              </button>
              <span style={{ fontSize:9, color:'#555', fontWeight:700 }}>{label}</span>
            </div>
          ))}
        </div>

        {info.description && (
          <div style={{ marginBottom: 18 }}>
            <p className="detail-desc" style={{ maxHeight: descOpen ? 'none' : 72, overflow: 'hidden' }}>
              {info.description}
            </p>
            <button style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, cursor: 'pointer', padding: 0 }}
              onClick={() => setDescOpen(v => !v)}>
              {descOpen ? 'Sembunyikan ▲' : 'Baca selengkapnya ▼'}
            </button>
          </div>
        )}

        {/* Lanjutkan Baca */}
        {prog && (
          <button
            onClick={() => openChapter(prog.chapterIdx)}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'var(--primary)', color: '#fff',
              fontWeight: 800, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 16,
            }}
          >
            <i className="fas fa-book-open" />
            Lanjutkan Baca · {prog.chapterTitle || `Ch ${prog.chapterIdx + 1}`}
          </button>
        )}

        {/* Chapter List */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Daftar Chapter
          </div>
          <div style={{ background: '#111', borderRadius: 12, border: '1px solid #1e1e1e', overflow: 'hidden' }}>
            {chapters.length === 0
              ? <p style={{ color: '#666', padding: 20, textAlign: 'center' }}>Tidak ada chapter</p>
              : chapters.map((ch, i) => (
                <div key={i} className="ep-item" onClick={() => openChapter(i)} style={{ padding: '12px 14px' }}>
                  <div className="ep-info">
                    <div className="ep-title">{ch.title}</div>
                    {ch.date && <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{ch.date}</div>}
                  </div>
                  <i className="fas fa-book-open" style={{ color: '#333', fontSize: 12, flexShrink: 0 }} />
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  );
}
