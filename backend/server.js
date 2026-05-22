/**
 * OFLIX HLS Streaming Server — ATOMIC MODE
 * 
 * playlist.m3u8 only appears after FFmpeg is 100% done.
 * Frontend polls /hls endpoint until status=ready, then plays.
 * Convert time ~13-15s for movies (copy codec, no re-encode).
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3077;

const SEGMENTS_DIR = '/opt/oflix-hls/segments';
const TEMP_DIR = '/opt/oflix-hls/temp';
const CLEANUP_HOURS = 4;
const MAX_CONCURRENT = 3;

const converting = new Map();
let activeConversions = 0;

app.use(cors({ origin: '*' }));

// --- NEW FIX: Serve static directory /var/www/html directly from Node! ---
// Jadi apapun foto/video/json di sana bakal otomatis bisa diakses dari link HTTPS Nevacloud
app.use(express.static('/var/www/html'));
// --------------------------------------------------------------------------

// ── Serve segments ──────────────────────────────────────────────────────────
app.use('/segments', (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (ext === '.m3u8') {
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'public, max-age=60');
  } else if (ext === '.ts') {
    res.set('Content-Type', 'video/mp2t');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Accept-Ranges', 'bytes');
  }
  next();
}, express.static(SEGMENTS_DIR, { etag: true, lastModified: true }));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConversions,
    totalCached: (() => { try { return fs.readdirSync(SEGMENTS_DIR).length; } catch { return 0; } })(),
    diskUsage: getDiskUsage(),
    uptime: process.uptime(),
  });
});

// ── Main HLS endpoint ───────────────────────────────────────────────────────
app.get('/hls', async (req, res) => {
  const mp4Url = req.query.url;
  if (!mp4Url) return res.status(400).json({ error: 'Missing ?url= parameter' });

  const baseVideoUrl = mp4Url.split('?')[0];
  const hash = crypto.createHash('md5').update(baseVideoUrl).digest('hex').slice(0, 12);
  const segDir = path.join(SEGMENTS_DIR, hash);
  const playlistPath = path.join(segDir, 'playlist.m3u8');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'] || '202-155-18-146.nevacloud.net';
  const baseUrl = `${proto}://${host}`;

  // ── Ready? (playlist.m3u8 exists = FFmpeg done, because we use .tmp rename)
  if (fs.existsSync(playlistPath)) {
    try {
      const files = fs.readdirSync(segDir);
      const tsCount = files.filter(f => f.endsWith('.ts')).length;
      if (tsCount > 0) {
        touchDir(segDir);
        return res.json({
          success: true,
          m3u8: `${baseUrl}/segments/${hash}/playlist.m3u8`,
          status: 'ready',
          cached: true,
          segments: tsCount,
        });
      }
    } catch {}
    // Corrupt
    console.log(`[${hash}] Invalid cache, removing...`);
    try { fs.rmSync(segDir, { recursive: true, force: true }); } catch {}
    converting.delete(hash);
  }

  // ── Currently converting?
  if (converting.has(hash)) {
    const info = converting.get(hash);
    if (info.status === 'done') {
      if (fs.existsSync(playlistPath)) {
        return res.json({
          success: true,
          m3u8: `${baseUrl}/segments/${hash}/playlist.m3u8`,
          status: 'ready',
        });
      }
      converting.delete(hash);
    } else if (info.status === 'error') {
      const errMsg = info.error;
      converting.delete(hash);
      return res.json({ success: false, status: 'error', error: errMsg || 'Conversion failed' });
    } else {
      return res.json({
        success: true,
        status: 'converting',
        progress: info.progress || 0,
      });
    }
  }

  // ── Too busy?
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(503).json({ error: 'Server busy', activeConversions });
  }

  // ── Start conversion
  converting.set(hash, { status: 'downloading', progress: 0, startedAt: Date.now() });
  activeConversions++;

  convertMP4toHLS(mp4Url, hash).catch(err => {
    console.error(`[${hash}] Conversion error:`, err.message);
    converting.set(hash, { status: 'error', error: err.message });
    activeConversions = Math.max(0, activeConversions - 1);
  });

  res.json({
    success: true,
    status: 'converting',
    progress: 0,
    m3u8: `${baseUrl}/segments/${hash}/playlist.m3u8`,
  });
});

// ── Cached list ─────────────────────────────────────────────────────────────
app.get('/api/cached', (req, res) => {
  try {
    const dirs = fs.readdirSync(SEGMENTS_DIR);
    const items = dirs.map(d => {
      const dir = path.join(SEGMENTS_DIR, d);
      try {
        const stat = fs.statSync(dir);
        const files = fs.readdirSync(dir);
        const tsFiles = files.filter(f => f.endsWith('.ts'));
        const totalSize = files.reduce((sum, f) => {
          try { return sum + fs.statSync(path.join(dir, f)).size; } catch { return sum; }
        }, 0);
        return {
          id: d, ready: files.includes('playlist.m3u8') && tsFiles.length > 0,
          segments: tsFiles.length, size: totalSize, sizeHuman: formatBytes(totalSize),
          created: stat.birthtime, modified: stat.mtime,
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ items, total: items.length });
  } catch { res.json({ items: [], total: 0 }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// CONVERSION — ATOMIC (.tmp → rename)
// ═════════════════════════════════════════════════════════════════════════════

async function convertMP4toHLS(mp4Url, hash) {
  const segDir = path.join(SEGMENTS_DIR, hash);
  const tempFile = path.join(TEMP_DIR, `${hash}.mp4`);
  const playlistPath = path.join(segDir, 'playlist.m3u8');
  const playlistTmp = playlistPath + '.tmp';

  fs.mkdirSync(segDir, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  try { fs.unlinkSync(playlistPath); } catch {}
  try { fs.unlinkSync(playlistTmp); } catch {}

  try {
    // Step 1: Download
    console.log(`[${hash}] Downloading: ${mp4Url.slice(0, 100)}...`);
    converting.set(hash, { status: 'downloading', progress: 0, startedAt: Date.now() });

    await new Promise((resolve, reject) => {
      const curl = spawn('curl', [
        '-L', '-o', tempFile,
        '-H', 'Referer: https://123movienow.cc/',
        '-H', 'Origin: https://123movienow.cc/',
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        '--connect-timeout', '30', '--max-time', '1800',
        '--retry', '3', '--retry-delay', '5', '-f', '--progress-bar',
        mp4Url,
      ]);
      curl.stderr.on('data', (data) => {
        const m = data.toString().match(/([\d.]+)%/);
        if (m) converting.set(hash, { status: 'downloading', progress: parseFloat(m[1]) * 0.98, startedAt: converting.get(hash)?.startedAt });
      });
      curl.on('close', (code) => {
        if (code !== 0) return reject(new Error(`curl code ${code}`));
        if (!fs.existsSync(tempFile)) return reject(new Error('File not created'));
        if (fs.statSync(tempFile).size < 5 * 1024 * 1024) return reject(new Error('File too small'));
        resolve();
      });
      curl.on('error', reject);
    });

    console.log(`[${hash}] Downloaded: ${formatBytes(fs.statSync(tempFile).size)}`);

    // Step 2: Convert — write to .tmp, rename after done
    converting.set(hash, { status: 'converting', progress: 98, startedAt: converting.get(hash)?.startedAt });
    console.log(`[${hash}] Converting...`);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', tempFile,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(segDir, 'seg%04d.ts'),
        '-f', 'hls',
        playlistTmp,    // ← .tmp — NOT the real playlist
      ], { timeout: 600000 });

      let stderr = '';
      let durationSec = 0;
      
      const parseFFmpegTime = (ts) => {
        const p = ts.split(':');
        return p.length === 3 ? parseFloat(p[0])*3600 + parseFloat(p[1])*60 + parseFloat(p[2]) : 0;
      };

      ffmpeg.stderr.on('data', (d) => {
        const str = d.toString();
        // Keep only last 1000 chars to avoid memory bloat
        stderr = (stderr + str).slice(-1000); 
        
        if (!durationSec) {
          const durMatch = str.match(/Duration:\s+(\d{2}:\d{2}:\d{2}\.\d+)/);
          if (durMatch) durationSec = parseFFmpegTime(durMatch[1]);
        }
        if (durationSec) {
          // match last occurrence of time= in this chunk
          const timeMatch = [...str.matchAll(/time=(\d{2}:\d{2}:\d{2}\.\d+)/g)].pop();
          if (timeMatch) {
             const timeSec = parseFFmpegTime(timeMatch[1]);
             const ffmpegPct = Math.min(100, (timeSec / durationSec) * 100);
             converting.set(hash, { status: 'converting', progress: 98 + (ffmpegPct * 0.02), startedAt: converting.get(hash)?.startedAt });
          }
        }
      });
      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(playlistTmp)) {
          try { fs.renameSync(playlistTmp, playlistPath); } catch (e) { return reject(new Error('Rename: ' + e.message)); }
          resolve();
        } else {
          try { fs.unlinkSync(playlistTmp); } catch {}
          reject(new Error(`FFmpeg code ${code}: ${stderr.slice(-300)}`));
        }
      });
      ffmpeg.on('error', reject);
    });

    const tsFiles = fs.readdirSync(segDir).filter(f => f.endsWith('.ts'));
    if (tsFiles.length === 0) throw new Error('No .ts segments');

    console.log(`[${hash}] Done! ${tsFiles.length} segments`);
    converting.set(hash, { status: 'done', progress: 100 });
    activeConversions = Math.max(0, activeConversions - 1);
    try { fs.unlinkSync(tempFile); } catch {}

  } catch (err) {
    try { fs.rmSync(segDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    converting.delete(hash);
    activeConversions = Math.max(0, activeConversions - 1);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

function cleanupOldSegments() {
  try {
    const dirs = fs.readdirSync(SEGMENTS_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const d of dirs) {
      const dir = path.join(SEGMENTS_DIR, d);
      try {
        if ((now - fs.statSync(dir).mtimeMs) / 3600000 > CLEANUP_HOURS) {
          fs.rmSync(dir, { recursive: true, force: true });
          converting.delete(d);
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} dirs`);
  } catch {}
}
setInterval(cleanupOldSegments, 30 * 60 * 1000);
cleanupOldSegments();

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function touchDir(dir) { try { const n = new Date(); fs.utimesSync(dir, n, n); } catch {} }
function getDiskUsage() { try { return execSync('du -sh /opt/oflix-hls/segments 2>/dev/null || echo "0"').toString().trim().split('\t')[0]; } catch { return '?'; } }
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 OFLIX HLS Server on :${PORT} — atomic mode`);
});