import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/ProfilePicker.jsx';

const AUTH_API = '/auth_api.php';

async function apiFetch(action, body = null) {
  const token = localStorage.getItem('oflix_token');
  const data = body ? { ...body, token } : { token };
  const res = await fetch(`${AUTH_API}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

function ItemGrid({ items, onItemClick, emptyMsg }) {
  if (!items.length) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 20px', color: '#333' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
        <p style={{ fontSize: 14 }}>{emptyMsg}</p>
      </div>
    );
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 14, padding: '16px 0',
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          className="movie-card"
          style={{ width: '100%', cursor: 'pointer' }}
          onClick={() => onItemClick(item)}
        >
          {item.type && (
            <div style={{
              position: 'absolute', top: 8, left: 8, zIndex: 2,
              background: item.type === 'komik' ? '#4CAF50' : item.type === 'donghua' ? '#e5a000' : '#e50914',
              color: '#fff', fontSize: 9, fontWeight: 800,
              padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase',
            }}>
              {item.type}
            </div>
          )}
          {item.poster ? (
            <img src={item.poster} alt={item.title || ''} loading="lazy"
              style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
              onError={e => { e.target.style.opacity = '0.1'; }} />
          ) : (
            <div style={{ width: '100%', aspectRatio: '2/3', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-film" style={{ fontSize: 24, color: '#333' }} />
            </div>
          )}
          <div className="card-label">{item.title || 'Untitled'}</div>
        </div>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('cw');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    apiFetch('profilePage').then(res => {
      if (res.ok) setData(res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function handleItemClick(item) {
    if (item.type === 'komik') {
      nav(`/komik/detail?d=${encodeURIComponent(item.detailPath)}`);
    } else {
      nav(`/detail?p=${encodeURIComponent(item.detailPath)}`);
    }
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Convert to base64 data URL (simple approach, stored as URL)
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      // For production you'd upload to a CDN, but for now store data URL
      // Limit to small images
      if (dataUrl.length > 500000) {
        alert('Gambar terlalu besar. Maksimal 500KB.');
        setUploading(false);
        return;
      }
      await apiFetch('updateAvatar', { avatar_url: dataUrl });
      setData(prev => prev ? { ...prev, profile: { ...prev.profile, avatar_url: dataUrl } } : prev);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  if (loading) {
    return (
      <div className="listing-page" style={{ paddingTop: 'calc(var(--header-h) + 20px)' }}>
        <div className="spinner-center" style={{ minHeight: '50vh' }}><div className="spinner" /></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="listing-page" style={{ paddingTop: 'calc(var(--header-h) + 40px)', textAlign: 'center', color: '#555' }}>
        Gagal memuat profil.
        <br /><button onClick={() => nav('/')} style={{ marginTop: 16, background: 'none', border: 'none', color: '#e50914', cursor: 'pointer', fontSize: 14 }}>← Kembali</button>
      </div>
    );
  }

  const { profile, cw, watchlist, likes, history } = data;
  const tabs = [
    { key: 'cw',        label: 'Terakhir Ditonton', icon: 'fa-play',    items: cw },
    { key: 'likes',     label: 'Disukai',           icon: 'fa-heart',   items: likes },
    { key: 'watchlist', label: 'Daftar Saya',       icon: 'fa-bookmark',items: watchlist },
    { key: 'history',   label: 'Riwayat',           icon: 'fa-clock',   items: history },
  ];

  const activeTab = tabs.find(t => t.key === tab) || tabs[0];
  const memberSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long' }) : '';

  return (
    <div style={{ paddingTop: 'calc(var(--header-h) + 20px)', paddingBottom: 60, minHeight: '100vh' }}>
      {/* Profile header */}
      <div style={{ padding: '30px 48px 20px', display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Avatar with upload */}
        <div style={{ position: 'relative' }}>
          <Avatar profile={profile} size={100} />
          <label style={{
            position: 'absolute', bottom: -4, right: -4,
            width: 32, height: 32, borderRadius: '50%',
            background: '#e50914', border: '3px solid var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'background 0.2s',
          }}>
            <i className="fas fa-camera" style={{ fontSize: 12, color: '#fff' }} />
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
          </label>
          {uploading && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
              borderRadius: '14%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          )}
        </div>

        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: 'var(--font-display)', marginBottom: 4 }}>
            {profile.username}
          </h1>
          {memberSince && (
            <p style={{ color: '#555', fontSize: 13 }}>Member sejak {memberSince}</p>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#888' }}><strong style={{ color: '#fff' }}>{watchlist.length}</strong> Daftar</span>
            <span style={{ fontSize: 12, color: '#888' }}><strong style={{ color: '#fff' }}>{likes.length}</strong> Disukai</span>
            <span style={{ fontSize: 12, color: '#888' }}><strong style={{ color: '#fff' }}>{history.length}</strong> Riwayat</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '0 48px', marginBottom: 8,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '12px 20px', background: 'none', border: 'none',
              color: tab === t.key ? '#fff' : '#555',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              borderBottom: tab === t.key ? '2px solid #e50914' : '2px solid transparent',
              transition: 'color 0.2s, border-color 0.2s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.color = '#555'; }}
          >
            <i className={`fas ${t.icon}`} style={{ fontSize: 11 }} />
            {t.label}
            <span style={{ fontSize: 11, color: '#444', marginLeft: 2 }}>({t.items.length})</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '0 48px' }}>
        <ItemGrid
          items={activeTab.items}
          onItemClick={handleItemClick}
          emptyMsg={
            tab === 'cw' ? 'Belum ada tontonan terakhir' :
            tab === 'likes' ? 'Belum ada yang disukai' :
            tab === 'watchlist' ? 'Daftar masih kosong' :
            'Belum ada riwayat'
          }
        />
      </div>
    </div>
  );
}
