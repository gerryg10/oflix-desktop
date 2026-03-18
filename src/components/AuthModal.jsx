import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthModal({ onClose }) {
  const { user, login, register, logout } = useAuth();
  const [tab, setTab]       = useState('login');
  const [uname, setUname]   = useState('');
  const [pass, setPass]     = useState('');
  const [err, setErr]       = useState('');
  const [busy, setBusy]     = useState(false);

  async function handleSubmit() {
    setErr('');
    if (!uname.trim() || !pass) { setErr('Username dan password wajib diisi'); return; }
    if (uname.length < 3)  { setErr('Username minimal 3 karakter'); return; }
    if (pass.length < 4)   { setErr('Password minimal 4 karakter'); return; }
    setBusy(true);
    try {
      const fn  = tab === 'login' ? login : register;
      const res = await fn(uname.trim(), pass);
      if (!res.ok) { setErr(res.error || 'Gagal'); return; }
      onClose();
    } catch { setErr('Gagal koneksi ke server'); }
    finally { setBusy(false); }
  }

  function handleLogout() {
    logout();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle" />

        {user ? (
          /* ── Logged in view ─── */
          <div>
            <div className="modal-title">OFLIX</div>
            <div className="modal-subtitle" style={{ marginBottom: 24 }}>
              Masuk sebagai <strong style={{ color: '#fff' }}>{user.username}</strong>
            </div>
            <button className="btn-primary" style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc' }} onClick={handleLogout}>
              <i className="fas fa-sign-out-alt" style={{ marginRight: 8, color: 'var(--primary)' }}></i>
              Keluar
            </button>
          </div>
        ) : (
          /* ── Auth form ─── */
          <div>
            <div className="modal-title">OFLIX</div>
            <div className="modal-subtitle">Masuk untuk akses penuh</div>

            <div className="tab-row">
              <button className={`tab-btn ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setErr(''); }}>Masuk</button>
              <button className={`tab-btn ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setErr(''); }}>Daftar</button>
            </div>

            <div className="form-field">
              <label className="form-label">Username</label>
              <input className="form-input" type="text" placeholder="Masukkan username" value={uname} onChange={e => setUname(e.target.value)} autoCapitalize="off" />
            </div>
            <div className="form-field">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="Masukkan password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>

            {err && <div className="form-error">{err}</div>}

            <button className="btn-primary" onClick={handleSubmit} disabled={busy}>
              {busy ? 'Memuat...' : (tab === 'login' ? 'Masuk' : 'Daftar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
