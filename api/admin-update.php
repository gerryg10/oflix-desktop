<?php
/**
 * ADMIN-UPDATE.PHP
 * Panel untuk custom isi /film dan /series
 * 
 * GET  → tampilkan panel HTML
 * POST → simpan custom data
 * GET ?action=get&cat=xxx → return custom JSON (dipanggil oleh frontend)
 * 
 * Data disimpan di /tmp/oflix_custom/ (Vercel writable)
 * Format: { items: [ { title, poster, detailPath, rating, year, genre, description } ] }
 */

error_reporting(0);
ini_set('display_errors', 0);

$customDir = '/tmp/oflix_custom/';
if (!is_dir($customDir)) mkdir($customDir, 0777, true);

// ── API: GET custom data for frontend ──────────────────────
if (isset($_GET['action']) && $_GET['action'] === 'get') {
    header("Access-Control-Allow-Origin: *");
    header("Content-Type: application/json");
    $cat = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['cat'] ?? '');
    $file = $customDir . $cat . '.json';
    if (file_exists($file)) {
        echo file_get_contents($file);
    } else {
        echo json_encode(['success' => false, 'items' => [], 'source' => 'none']);
    }
    exit;
}

// ── API: Save custom data ──────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['action']) && $_GET['action'] === 'save') {
    header("Access-Control-Allow-Origin: *");
    header("Content-Type: application/json");
    $body = json_decode(file_get_contents('php://input'), true);
    $cat  = preg_replace('/[^a-zA-Z0-9_-]/', '', $body['cat'] ?? '');
    $items = $body['items'] ?? [];
    
    if (!$cat) {
        echo json_encode(['success' => false, 'error' => 'Missing cat']);
        exit;
    }
    
    $data = [
        'success'   => true,
        'items'     => $items,
        'source'    => 'custom',
        'updatedAt' => date('Y-m-d H:i:s'),
    ];
    file_put_contents($customDir . $cat . '.json', json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'saved' => count($items), 'cat' => $cat]);
    exit;
}

// ── API: Delete custom (revert to default) ─────────────────
if (isset($_GET['action']) && $_GET['action'] === 'delete') {
    header("Access-Control-Allow-Origin: *");
    header("Content-Type: application/json");
    $cat = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['cat'] ?? '');
    $file = $customDir . $cat . '.json';
    if (file_exists($file)) unlink($file);
    echo json_encode(['success' => true, 'deleted' => $cat]);
    exit;
}

// ── API: Fetch default from FoodCash (helper for panel) ────
if (isset($_GET['action']) && $_GET['action'] === 'fetch-default') {
    header("Access-Control-Allow-Origin: *");
    header("Content-Type: application/json");
    $cat = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['cat'] ?? 'trending');
    $url = 'https://foodcash.com.br/sistema/apiv4/api.php?action=' . urlencode($cat) . '&page=1';
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer: https://foodcash.com.br/',
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    echo $response ?: json_encode(['success' => false, 'items' => []]);
    exit;
}

// ── CORS preflight ─────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type");
    http_response_code(200);
    exit;
}

// ── HTML Admin Panel ───────────────────────────────────────
header("Content-Type: text/html; charset=utf-8");
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OFLIX Admin - Film & Series Custom</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0f1014; color:#e8e8e8; font-family:'DM Sans',-apple-system,sans-serif; min-height:100vh; }
  .container { max-width:1100px; margin:0 auto; padding:24px; }
  h1 { font-size:28px; font-weight:900; margin-bottom:8px; }
  h1 span { color:#e50914; }
  .subtitle { color:#888; font-size:14px; margin-bottom:24px; }
  
  /* Tabs */
  .tabs { display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap; }
  .tab {
    padding:10px 20px; border-radius:8px; border:1px solid #2a2d35; background:#181a1f;
    color:#8c8c8c; font-weight:700; font-size:13px; cursor:pointer; transition:0.18s;
  }
  .tab:hover { border-color:#555; color:#fff; }
  .tab.active { background:#e50914; border-color:#e50914; color:#fff; }
  
  /* Actions bar */
  .actions { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
  .btn {
    padding:10px 20px; border-radius:8px; border:none; font-weight:700; font-size:13px;
    cursor:pointer; transition:0.18s; display:inline-flex; align-items:center; gap:6px;
  }
  .btn-primary { background:#e50914; color:#fff; }
  .btn-primary:hover { background:#ff1a26; }
  .btn-secondary { background:#22242b; color:#ccc; border:1px solid #2a2d35; }
  .btn-secondary:hover { border-color:#555; }
  .btn-danger { background:#440000; color:#ff6b6b; border:1px solid #660000; }
  .btn-danger:hover { background:#550000; }
  
  /* Status */
  .status { padding:10px 16px; border-radius:8px; margin-bottom:16px; font-size:13px; font-weight:600; display:none; }
  .status.show { display:block; }
  .status.ok { background:#0a2a0a; border:1px solid #0a4f0a; color:#4caf50; }
  .status.err { background:#2a0a0a; border:1px solid #4f0a0a; color:#ff6b6b; }
  .status.info { background:#0a0a2a; border:1px solid #0a0a4f; color:#6b9fff; }
  
  /* Items grid */
  .items-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; margin-bottom:20px; }
  .item-card {
    background:#181a1f; border:1px solid #2a2d35; border-radius:10px; padding:12px;
    display:flex; gap:12px; position:relative; transition:0.18s;
  }
  .item-card:hover { border-color:#444; }
  .item-card img { width:60px; height:90px; object-fit:cover; border-radius:6px; flex-shrink:0; background:#111; }
  .item-card-info { flex:1; min-width:0; }
  .item-card-title { font-size:14px; font-weight:700; color:#fff; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item-card-meta { font-size:11px; color:#666; margin-bottom:2px; }
  .item-card-path { font-size:10px; color:#444; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item-card-actions { position:absolute; top:8px; right:8px; display:flex; gap:4px; }
  .item-card-btn {
    width:28px; height:28px; border-radius:50%; border:none; background:#22242b;
    color:#888; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:0.15s;
  }
  .item-card-btn:hover { background:#333; color:#fff; }
  .item-card-btn.del:hover { background:#440000; color:#ff6b6b; }
  
  /* Add form */
  .add-form {
    background:#181a1f; border:1px solid #2a2d35; border-radius:12px; padding:20px;
    margin-bottom:20px; display:none;
  }
  .add-form.show { display:block; }
  .add-form h3 { font-size:15px; margin-bottom:14px; color:#fff; }
  .form-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
  .form-row.full { grid-template-columns:1fr; }
  .form-field label { display:block; font-size:11px; color:#666; margin-bottom:4px; font-weight:600; }
  .form-field input, .form-field textarea {
    width:100%; background:#0f1014; border:1px solid #2a2d35; color:#fff; padding:10px 12px;
    border-radius:6px; font-size:13px; outline:none; font-family:inherit; transition:0.15s;
  }
  .form-field input:focus, .form-field textarea:focus { border-color:#e50914; }
  .form-field textarea { resize:vertical; min-height:60px; }
  
  /* JSON editor */
  .json-editor {
    background:#0f1014; border:1px solid #2a2d35; border-radius:8px; padding:12px;
    margin-bottom:16px; display:none;
  }
  .json-editor.show { display:block; }
  .json-editor textarea {
    width:100%; min-height:300px; background:transparent; border:none; color:#aaa;
    font-family:'Courier New',monospace; font-size:12px; outline:none; resize:vertical;
  }
  
  .count-badge { background:#22242b; padding:2px 8px; border-radius:10px; font-size:11px; color:#888; margin-left:8px; }
</style>
</head>
<body>
<div class="container">
  <h1><span>OFLIX</span> Admin Panel</h1>
  <p class="subtitle">Kustomisasi konten Film & Series — data disimpan di server dan otomatis muncul di frontend</p>
  
  <!-- Category Tabs -->
  <div class="tabs" id="tabs">
    <button class="tab active" data-cat="film-custom">🎬 Film Page</button>
    <button class="tab" data-cat="series-custom">📺 Series Page</button>
  </div>
  
  <!-- Status -->
  <div class="status" id="status"></div>
  
  <!-- Actions -->
  <div class="actions">
    <button class="btn btn-primary" onclick="loadDefault()"><i class="fas fa-download"></i> Load Default dari API</button>
    <button class="btn btn-secondary" onclick="toggleAddForm()"><i class="fas fa-plus"></i> Tambah Item Manual</button>
    <button class="btn btn-secondary" onclick="toggleJsonEditor()"><i class="fas fa-code"></i> Edit JSON</button>
    <button class="btn btn-primary" onclick="saveAll()"><i class="fas fa-save"></i> Simpan</button>
    <button class="btn btn-danger" onclick="revertDefault()"><i class="fas fa-trash"></i> Hapus Custom (Revert)</button>
  </div>
  
  <!-- Add Form -->
  <div class="add-form" id="addForm">
    <h3><i class="fas fa-plus-circle"></i> Tambah Item Baru</h3>
    <div class="form-row">
      <div class="form-field"><label>Title *</label><input id="f_title" placeholder="Judul film/series"></div>
      <div class="form-field"><label>Detail Path *</label><input id="f_detailPath" placeholder="contoh: pursuit-of-jade-qxivBFb2dP9"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>Poster URL</label><input id="f_poster" placeholder="https://..."></div>
      <div class="form-field"><label>Rating</label><input id="f_rating" placeholder="6.8"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>Year</label><input id="f_year" placeholder="2026"></div>
      <div class="form-field"><label>Genre</label><input id="f_genre" placeholder="Drama,Action"></div>
    </div>
    <div class="form-row full">
      <div class="form-field"><label>Description</label><textarea id="f_desc" placeholder="Deskripsi singkat..."></textarea></div>
    </div>
    <button class="btn btn-primary" onclick="addItem()" style="margin-top:8px"><i class="fas fa-plus"></i> Tambah</button>
  </div>
  
  <!-- JSON Editor -->
  <div class="json-editor" id="jsonEditor">
    <textarea id="jsonText" placeholder="Paste JSON array items di sini..."></textarea>
    <button class="btn btn-primary" onclick="applyJson()" style="margin-top:8px"><i class="fas fa-check"></i> Apply JSON</button>
  </div>
  
  <!-- Items -->
  <div id="itemsContainer">
    <div style="color:#555;text-align:center;padding:60px 0">
      <i class="fas fa-film" style="font-size:40px;margin-bottom:12px;display:block"></i>
      Belum ada item. Klik "Load Default dari API" atau "Tambah Item Manual"
    </div>
  </div>
</div>

<script>
let currentCat = 'film-custom';
let items = [];
const DEFAULT_SOURCES = {
  'film-custom': 'trending',
  'series-custom': 'western-tv',
};

// ── Tab switching ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCat = tab.dataset.cat;
    loadSaved();
  });
});

// ── Status ──
function showStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status show ' + type;
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ── Load saved custom data ──
async function loadSaved() {
  try {
    const res = await fetch('/admin-update.php?action=get&cat=' + currentCat);
    const data = await res.json();
    if (data.success && data.items?.length) {
      items = data.items;
      showStatus(`Loaded ${items.length} custom items (updated: ${data.updatedAt || '?'})`, 'ok');
    } else {
      items = [];
      showStatus('Belum ada custom data untuk kategori ini. Load default atau tambah manual.', 'info');
    }
  } catch(e) {
    items = [];
    showStatus('Gagal load: ' + e.message, 'err');
  }
  renderItems();
}

// ── Load default from FoodCash API ──
async function loadDefault() {
  const src = DEFAULT_SOURCES[currentCat] || 'trending';
  showStatus('Fetching default dari API (' + src + ')...', 'info');
  try {
    const res = await fetch('/admin-update.php?action=fetch-default&cat=' + src);
    const data = await res.json();
    if (data.success && data.items?.length) {
      items = data.items;
      showStatus(`Loaded ${items.length} items dari API (${src}). Klik "Simpan" untuk menyimpan.`, 'ok');
    } else {
      showStatus('API returned empty. Coba lagi.', 'err');
    }
  } catch(e) {
    showStatus('Fetch error: ' + e.message, 'err');
  }
  renderItems();
}

// ── Save to server ──
async function saveAll() {
  showStatus('Menyimpan...', 'info');
  try {
    const res = await fetch('/admin-update.php?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cat: currentCat, items }),
    });
    const data = await res.json();
    if (data.success) {
      showStatus(`Tersimpan! ${data.saved} items untuk ${currentCat}. Frontend akan otomatis pakai data ini.`, 'ok');
    } else {
      showStatus('Gagal: ' + (data.error || 'Unknown'), 'err');
    }
  } catch(e) {
    showStatus('Save error: ' + e.message, 'err');
  }
}

// ── Revert to default ──
async function revertDefault() {
  if (!confirm('Hapus custom data? Frontend akan kembali fetch dari API default.')) return;
  try {
    await fetch('/admin-update.php?action=delete&cat=' + currentCat);
    items = [];
    showStatus('Custom data dihapus. Frontend kembali ke default.', 'ok');
  } catch(e) {
    showStatus('Error: ' + e.message, 'err');
  }
  renderItems();
}

// ── Add item ──
function addItem() {
  const title = document.getElementById('f_title').value.trim();
  const detailPath = document.getElementById('f_detailPath').value.trim();
  if (!title || !detailPath) { showStatus('Title dan DetailPath wajib diisi!', 'err'); return; }
  items.unshift({
    title,
    detailPath,
    poster: document.getElementById('f_poster').value.trim(),
    rating: document.getElementById('f_rating').value.trim(),
    year: document.getElementById('f_year').value.trim(),
    genre: document.getElementById('f_genre').value.trim(),
    description: document.getElementById('f_desc').value.trim(),
  });
  // Clear form
  ['f_title','f_detailPath','f_poster','f_rating','f_year','f_genre','f_desc'].forEach(id => {
    document.getElementById(id).value = '';
  });
  showStatus('Item ditambahkan. Jangan lupa Simpan!', 'ok');
  renderItems();
}

// ── Remove item ──
function removeItem(idx) {
  items.splice(idx, 1);
  renderItems();
}

// ── Move item ──
function moveItem(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= items.length) return;
  [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
  renderItems();
}

// ── Toggle forms ──
function toggleAddForm() {
  document.getElementById('addForm').classList.toggle('show');
  document.getElementById('jsonEditor').classList.remove('show');
}
function toggleJsonEditor() {
  const el = document.getElementById('jsonEditor');
  el.classList.toggle('show');
  document.getElementById('addForm').classList.remove('show');
  if (el.classList.contains('show')) {
    document.getElementById('jsonText').value = JSON.stringify(items, null, 2);
  }
}
function applyJson() {
  try {
    const parsed = JSON.parse(document.getElementById('jsonText').value);
    if (Array.isArray(parsed)) {
      items = parsed;
      showStatus('JSON applied! ' + items.length + ' items. Jangan lupa Simpan.', 'ok');
    } else {
      showStatus('JSON harus berupa array []', 'err');
    }
  } catch(e) {
    showStatus('JSON parse error: ' + e.message, 'err');
  }
  renderItems();
}

// ── Render ──
function renderItems() {
  const container = document.getElementById('itemsContainer');
  if (!items.length) {
    container.innerHTML = '<div style="color:#555;text-align:center;padding:60px 0"><i class="fas fa-film" style="font-size:40px;margin-bottom:12px;display:block"></i>Belum ada item.</div>';
    return;
  }
  let html = '<div style="font-size:13px;color:#888;margin-bottom:10px">' + items.length + ' items<span class="count-badge">' + currentCat + '</span></div>';
  html += '<div class="items-grid">';
  items.forEach((item, i) => {
    html += `
      <div class="item-card">
        <img src="${item.poster || ''}" onerror="this.style.opacity='0.1'" alt="">
        <div class="item-card-info">
          <div class="item-card-title">${item.title || '(no title)'}</div>
          <div class="item-card-meta">${[item.year, item.rating ? '⭐'+item.rating : '', item.genre].filter(Boolean).join(' · ')}</div>
          <div class="item-card-path">${item.detailPath || '(no path)'}</div>
        </div>
        <div class="item-card-actions">
          <button class="item-card-btn" onclick="moveItem(${i},-1)" title="Move up"><i class="fas fa-arrow-up"></i></button>
          <button class="item-card-btn" onclick="moveItem(${i},1)" title="Move down"><i class="fas fa-arrow-down"></i></button>
          <button class="item-card-btn del" onclick="removeItem(${i})" title="Hapus"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ── Init ──
loadSaved();
</script>
</body>
</html>
