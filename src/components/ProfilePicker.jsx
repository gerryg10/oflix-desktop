import { useState, useEffect, useRef } from 'react';

const AUTH_API = '/auth_api.php';

async function apiFetch(action, body = null) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(`${AUTH_API}?action=${action}`, opts);
  return res.json();
}

function Avatar({ profile, size = 80, onClick, className = '' }) {
  const initial = (profile.username || '?')[0].toUpperCase();
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url} alt={profile.username}
        className={className}
        onClick={onClick}
        style={{
          width: size, height: size, borderRadius: '14%', objectFit: 'cover',
          cursor: onClick ? 'pointer' : 'default', border: '3px solid transparent',
          transition: 'border-color 0.2s, transform 0.2s',
        }}
        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
      />
    );
  }
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: '14%',
        background: profile.avatar_color || '#e50914',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, fontWeight: 900, color: '#fff',
        cursor: onClick ? 'pointer' : 'default',
        border: '3px solid transparent',
        transition: 'border-color 0.2s, transform 0.2s',
        fontFamily: 'var(--font-display)',
      }}
    >
      {initial}
    </div>
  );
}

function PinInput({ onComplete, error }) {
  const [pins, setPins] = useState(['', '', '', '']);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  function handleChange(idx, val) {
    if (!/^\d?$/.test(val)) return;
    const next = [...pins];
    next[idx] = val;
    setPins(next);
    if (val && idx < 3) refs[idx + 1].current?.focus();
    if (next.every(p => p !== '')) onComplete(next.join(''));
  }

  function handleKey(idx, e) {
    if (e.key === 'Backspace' && !pins[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  }

  useEffect(() => { refs[0].current?.focus(); }, []);
  useEffect(() => { if (error) setPins(['','','','']); refs[0].current?.focus(); }, [error]);

  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
      {pins.map((p, i) => (
        <input
          key={i} ref={refs[i]} type="password" inputMode="numeric"
          maxLength={1} value={p}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          style={{
            width: 52, height: 62, textAlign: 'center',
            fontSize: 24, fontWeight: 900, color: '#fff',
            background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.15)',
            borderRadius: 12, outline: 'none',
            fontFamily: 'var(--font-body)',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => e.target.style.borderColor = '#e50914'}
          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
        />
      ))}
    </div>
  );
}

export default function ProfilePicker({ onLogin }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [mode, setMode]         = useState('pick'); // 'pick', 'create', 'pin'
  const [selected, setSelected] = useState(null);
  const [error, setError]       = useState('');
  const [pinError, setPinError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [newPin, setNewPin]     = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [createStep, setCreateStep] = useState(1); // 1=name, 2=pin, 3=confirm
  const [isAdmin, setIsAdmin]   = useState(false); // true if logged in as ID 1

  useEffect(() => {
    apiFetch('getProfiles').then(res => {
      if (res.ok) setProfiles(res.profiles || []);
      setLoading(false);
    }).catch(() => setLoading(false));
    // Check if admin token exists
    const adminToken = localStorage.getItem('oflix_admin_token');
    if (adminToken) setIsAdmin(true);
  }, []);

  // ── Select profile → enter PIN ──
  function selectProfile(p) {
    setSelected(p);
    setMode('pin');
    setError('');
    setPinError('');
  }

  // ── Verify PIN ──
  async function verifyPin(pin) {
    setPinError('');
    const res = await apiFetch('login', { profileId: selected.id, pin });
    if (res.ok) {
      localStorage.setItem('oflix_token', res.token);
      // Simpan admin token kalau login sebagai profile pertama (ID 1)
      if (selected.id === 1) {
        localStorage.setItem('oflix_admin_token', res.token);
        setIsAdmin(true);
      }
      onLogin(res.profile, res.token);
    } else {
      setPinError(res.error || 'PIN salah');
    }
  }

  // ── Create profile flow ──
  async function handleCreate() {
    if (createStep === 1) {
      if (newName.trim().length < 2) { setError('Nama minimal 2 karakter'); return; }
      if (newName.trim().length > 20) { setError('Nama maksimal 20 karakter'); return; }
      setError('');
      setCreateStep(2);
      return;
    }
    if (createStep === 2) {
      // PIN entered via PinInput onComplete
      return;
    }
  }

  function onCreatePinComplete(pin) {
    setNewPin(pin);
    setCreateStep(3);
  }

  async function onConfirmPinComplete(pin) {
    if (pin !== newPin) {
      setError('PIN tidak cocok');
      setConfirmPin('');
      setCreateStep(2);
      setNewPin('');
      return;
    }
    setCreating(true);
    const res = await apiFetch('createProfile', { username: newName.trim(), pin });
    if (res.ok) {
      localStorage.setItem('oflix_token', res.token);
      onLogin(res.profile, res.token);
    } else {
      setError(res.error || 'Gagal membuat profile');
      setCreateStep(1);
    }
    setCreating(false);
  }

  function resetCreate() {
    setMode('pick');
    setCreateStep(1);
    setNewName('');
    setNewPin('');
    setConfirmPin('');
    setError('');
  }

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0f',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px',
      animation: 'fadeIn 0.4s ease',
    }}>

      {/* ── PROFILE PICKER ── */}
      {mode === 'pick' && (
        <>
          <h1 style={{
            fontSize: 36, fontWeight: 900, color: '#fff', marginBottom: 12,
            fontFamily: 'var(--font-display)', letterSpacing: -0.5,
          }}>
            Siapa yang nonton?
          </h1>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 40 }}>
            Pilih profil atau buat baru
          </p>

          <div style={{
            display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center',
            marginBottom: 40, maxWidth: 700, maxHeight: '50vh', overflowY: 'auto',
            padding: '10px 5px',
            scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
          }}>
            {profiles.map(p => (
              <div
                key={p.id}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  cursor: 'pointer', padding: 6, borderRadius: 12,
                  transition: 'transform 0.2s', position: 'relative',
                  width: 110,
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <div onClick={() => selectProfile(p)}>
                  <Avatar profile={p} size={80} />
                </div>
                <span onClick={() => selectProfile(p)} style={{ color: '#aaa', fontSize: 12, fontWeight: 600, textAlign: 'center', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.username}</span>

                {/* Admin (ID 1) delete button — tampil di semua profile kecuali Admin sendiri */}
                {isAdmin && p.id !== 1 && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Hapus profil "${p.username}"? Semua data (tontonan, watchlist) akan hilang.`)) return;
                      const token = localStorage.getItem('oflix_admin_token') || localStorage.getItem('oflix_token');
                      const res = await apiFetch('deleteProfile', { token, targetId: p.id });
                      if (res.ok) {
                        setProfiles(prev => prev.filter(x => x.id !== p.id));
                      } else {
                        setError(res.error || 'Gagal hapus');
                      }
                    }}
                    style={{
                      position: 'absolute', top: -4, right: 6,
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'rgba(200,0,0,0.8)', border: 'none',
                      color: '#fff', fontSize: 12, fontWeight: 900,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                    title={`Hapus ${p.username}`}
                  >×</button>
                )}
              </div>
            ))}

            {/* Add button — GANTI ANGKA 20 untuk ubah batas max profile */}
            {profiles.length < 20 && (
              <div
                onClick={() => { setMode('create'); setCreateStep(1); setError(''); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  cursor: 'pointer', padding: 8, borderRadius: 12,
                  transition: 'transform 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{
                  width: 100, height: 100, borderRadius: '14%',
                  background: 'rgba(255,255,255,0.06)', border: '2px dashed rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 40, color: '#555', transition: 'border-color 0.2s, color 0.2s',
                }}>
                  +
                </div>
                <span style={{ color: '#555', fontSize: 14, fontWeight: 600 }}>Tambah</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ENTER PIN ── */}
      {mode === 'pin' && selected && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <Avatar profile={selected} size={90} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 16, fontFamily: 'var(--font-display)' }}>
            {selected.username}
          </h2>
          <p style={{ color: '#666', fontSize: 14, marginTop: 6 }}>Masukkan PIN</p>

          <PinInput onComplete={verifyPin} error={pinError} />

          {pinError && (
            <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 12, fontWeight: 600 }}>{pinError}</p>
          )}

          <button
            onClick={() => { setMode('pick'); setSelected(null); setPinError(''); }}
            style={{
              marginTop: 30, background: 'none', border: 'none',
              color: '#555', fontSize: 13, cursor: 'pointer',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}
          >
            ← Kembali
          </button>
        </>
      )}

      {/* ── CREATE PROFILE ── */}
      {mode === 'create' && (
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            {createStep === 1 ? 'Buat Profil Baru' : createStep === 2 ? 'Buat PIN' : 'Konfirmasi PIN'}
          </h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
            {createStep === 1 ? 'Masukkan nama profil' : createStep === 2 ? 'Buat PIN 4 angka' : 'Masukkan PIN sekali lagi'}
          </p>

          {createStep === 1 && (
            <>
              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Nama profil"
                maxLength={20}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                style={{
                  width: '100%', padding: '14px 18px', background: 'rgba(255,255,255,0.08)',
                  border: '2px solid rgba(255,255,255,0.15)', borderRadius: 12,
                  color: '#fff', fontSize: 16, outline: 'none', textAlign: 'center',
                  fontFamily: 'var(--font-body)', transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = '#e50914'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
              <button
                onClick={handleCreate}
                disabled={creating}
                style={{
                  marginTop: 16, width: '100%', padding: '14px',
                  background: '#e50914', color: '#fff', border: 'none', borderRadius: 12,
                  fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#ff1a26'}
                onMouseLeave={e => e.currentTarget.style.background = '#e50914'}
              >
                Lanjut
              </button>
            </>
          )}

          {createStep === 2 && (
            <PinInput onComplete={onCreatePinComplete} error={error} />
          )}

          {createStep === 3 && (
            <PinInput onComplete={onConfirmPinComplete} error={error} />
          )}

          {error && (
            <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 12, fontWeight: 600 }}>{error}</p>
          )}

          <button
            onClick={resetCreate}
            style={{
              marginTop: 24, background: 'none', border: 'none',
              color: '#555', fontSize: 13, cursor: 'pointer',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}
          >
            ← Kembali
          </button>
        </div>
      )}
    </div>
  );
}

export { Avatar };
