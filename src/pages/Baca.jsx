import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const KOMIK_API = '/komik_api.php';

async function fetchChapterPages(slug) {
  const res  = await fetch(`${KOMIK_API}?action=baca&bacaManga=${encodeURIComponent(slug)}`);
  const data = await res.json();
  if (data.status === 'ok' && data.images?.length) return data.images;
  throw new Error(data.message || 'Gagal memuat');
}

export default function BacaPage() {
  const [params] = useSearchParams();
  const nav      = useNavigate();
  const { saveKomikProgress } = useAuth();

  const slug     = params.get('m')     || '';
  const title    = params.get('title') || '';
  const startIdx = parseInt(params.get('idx') || '0', 10);
  const series   = params.get('series') || sessionStorage.getItem('komik_series') || '';
  const poster   = params.get('poster') || '';

  const chapters = (() => {
    try { return JSON.parse(sessionStorage.getItem('komik_chapters')) || []; } catch { return []; }
  })();

  // Each block = { chIdx, title, slug, pages }
  const [blocks,      setBlocks]      = useState([]);
  const [loadedSet,   setLoadedSet]   = useState(new Set());
  const [loadingNext, setLoadingNext] = useState(false);
  const [endReached,  setEndReached]  = useState(false);
  const [curChTitle,  setCurChTitle]  = useState(title);

  const readyRef    = useRef(false);
  const loadingRef  = useRef(false);
  const sentinelRef = useRef(null);
  const containerRef = useRef(null);

  // ── Initial load ────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    readyRef.current   = false;
    loadingRef.current = false;
    setBlocks([]);
    setLoadedSet(new Set());
    setEndReached(false);
    setLoadingNext(true);
    setCurChTitle(title);

    fetchChapterPages(slug)
      .then(pages => {
        setBlocks([{ chIdx: startIdx, title, slug, pages }]);
        setLoadedSet(new Set([startIdx]));
        setLoadingNext(false);
        // Save progress
        saveKomikProgress(slug, startIdx, title, poster, series);
        setTimeout(() => { readyRef.current = true; }, 1500);
      })
      .catch(e => { console.warn(e); setLoadingNext(false); });
  }, [slug]);

  // ── Load next chapter ────────────────────────────────────
  function loadNext(currentBlocks, currentSet) {
    if (loadingRef.current || endReached) return;
    const lastBlock = currentBlocks[currentBlocks.length - 1];
    if (!lastBlock) return;
    const nextIdx = lastBlock.chIdx + 1;
    if (nextIdx >= chapters.length) { setEndReached(true); return; }
    if (currentSet.has(nextIdx)) return;

    loadingRef.current = true;
    readyRef.current   = false;
    setLoadingNext(true);

    const ch = chapters[nextIdx];
    fetchChapterPages(ch.url)
      .then(pages => {
        setBlocks(prev => {
          const next = [...prev, { chIdx: nextIdx, title: ch.title, slug: ch.url, pages }];
          return next;
        });
        setLoadedSet(prev => new Set([...prev, nextIdx]));
        setCurChTitle(ch.title);
        setLoadingNext(false);
        loadingRef.current = false;
        // Save progress for new chapter
        saveKomikProgress(slug, nextIdx, ch.title, poster, series);
        setTimeout(() => { readyRef.current = true; }, 1500);
      })
      .catch(e => {
        console.warn(e);
        setLoadingNext(false);
        loadingRef.current = false;
      });
  }

  // ── IntersectionObserver on sentinel ────────────────────
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && readyRef.current && !loadingRef.current) {
          setBlocks(prev => {
            setLoadedSet(prevSet => {
              loadNext(prev, prevSet);
              return prevSet;
            });
            return prev;
          });
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [blocks.length, endReached]);

  const goBack = () => nav('/komik/detail?d=' + encodeURIComponent(slug));

  return (
    <div
      ref={containerRef}
      style={{ background: '#0a0a0a', minHeight: '100vh', position: 'relative', paddingTop: 64 }}
    >
      {/* ── STICKY HEADER ── */}
      <div style={{
        position:       'fixed',
        top:            0,
        left:           0,
        right:          0,
        zIndex:         5000,
        height:         64,
        background:     'rgba(10,10,10,0.97)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom:   '1px solid #1e2028',
        display:        'flex',
        alignItems:     'center',
        gap:            14,
        padding:        '0 40px',
      }}>
        {/* Back button */}
        <button
          onClick={goBack}
          style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background:   'var(--primary)',
            border:       'none',
            display:      'flex', alignItems: 'center', justifyContent: 'center',
            color:        '#fff', fontSize: 16, cursor: 'pointer',
            transition:   'background 0.18s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#ff1a26'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--primary)'}
        >
          <i className="fas fa-chevron-left" />
        </button>

        {/* Title + Chapter */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: '#8c8c8c', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {series || slug}
          </div>
          <div style={{
            fontSize: 15, color: '#fff', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'var(--font-display)',
          }}>
            {curChTitle}
          </div>
        </div>
      </div>

      {/* ── CHAPTER BLOCKS — centered, max-width 800px ── */}
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {blocks.map((block, bi) => (
          <div key={block.chIdx}>
            {/* Chapter divider for subsequent chapters */}
            {bi > 0 && (
              <div style={{
                padding: '18px 24px 14px',
                borderTop: '3px solid #1e2028',
                background: '#0d0d0d',
              }}>
                <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Chapter selanjutnya
                </div>
                <div style={{ fontSize: 16, color: '#fff', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  {block.title}
                </div>
              </div>
            )}

            {/* Pages */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {block.pages.map((pg, i) => {
                const src = typeof pg === 'string' ? pg : (pg.url || pg.src || pg.image || '');
                return (
                  <img
                    key={i}
                    src={src}
                    alt={`Ch${block.chIdx + 1} p${i + 1}`}
                    loading="lazy"
                    style={{ width: '100%', display: 'block' }}
                    onError={e => { e.target.style.opacity = '0.08'; }}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* ── SENTINEL ── */}
        {!endReached && (
          <div ref={sentinelRef} style={{ height: 1 }} />
        )}

        {/* ── LOADING ── */}
        {loadingNext && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 14 }}>
            <div className="spinner" />
            <span style={{ color: '#555', fontSize: 13 }}>Memuat chapter berikutnya...</span>
          </div>
        )}

        {/* ── END ── */}
        {endReached && !loadingNext && (
          <div style={{ textAlign: 'center', padding: '60px 20px 100px', color: '#333' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>🎉</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#555', fontFamily: 'var(--font-display)' }}>Tamat</div>
            <div style={{ fontSize: 14, color: '#444', marginTop: 8 }}>Semua chapter sudah dibaca</div>
            <button
              onClick={goBack}
              style={{
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
      </div>
    </div>
  );
}
