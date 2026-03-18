<?php
/**
 * AUTH_API.PHP - OFLIX Auth
 * SQLite di /tmp/oflix_users.db (Vercel-compatible, ephemeral tapi cukup)
 */
error_reporting(0); ini_set('display_errors', 0);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function ok($d=[])      { echo json_encode(['ok'=>true]+$d); exit; }
function err($m,$c=400) { http_response_code($c); echo json_encode(['ok'=>false,'error'=>$m]); exit; }

function getDB() {
    $db = new PDO('sqlite:/tmp/oflix_users.db');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("PRAGMA journal_mode=WAL");
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS user_tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS user_cw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        cw_type TEXT NOT NULL,
        cw_key TEXT NOT NULL,
        cw_data TEXT NOT NULL,
        saved_at INTEGER DEFAULT (strftime('%s','now')),
        UNIQUE(user_id, cw_type, cw_key)
    )");
    return $db;
}

function makeToken($db, $uid, $uname) {
    $token   = bin2hex(random_bytes(32));
    $expires = time() + (30 * 86400);
    $db->prepare("INSERT OR REPLACE INTO user_tokens (token, user_id, username, expires_at) VALUES (?,?,?,?)")
       ->execute([$token, $uid, $uname, $expires]);
    return $token;
}

function verifyToken($db, $token) {
    if (!$token) return null;
    $s = $db->prepare("SELECT * FROM user_tokens WHERE token=? AND expires_at>?");
    $s->execute([$token, time()]);
    return $s->fetch(PDO::FETCH_ASSOC) ?: null;
}

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? $input['action'] ?? '';

try {
    $db = getDB();

    if ($action === 'login') {
        $u = trim($input['username']??''); $p = $input['password']??'';
        if (!$u||!$p) err('Username dan password wajib diisi');
        $s = $db->prepare("SELECT * FROM users WHERE LOWER(username)=LOWER(?)"); $s->execute([$u]);
        $user = $s->fetch(PDO::FETCH_ASSOC);
        if (!$user) err('Username tidak ditemukan');
        if (!password_verify($p, $user['password'])) err('Password salah');
        ok(['token'=>makeToken($db,$user['id'],$user['username']),'username'=>$user['username']]);
    }

    if ($action === 'register') {
        $u = trim($input['username']??''); $p = $input['password']??''; $e = trim($input['email']??'');
        if (!$u||!$p) err('Username dan password wajib diisi');
        if (strlen($u)<3) err('Username minimal 3 karakter');
        if (strlen($p)<4) err('Password minimal 4 karakter');
        $s = $db->prepare("SELECT id FROM users WHERE LOWER(username)=LOWER(?)"); $s->execute([$u]);
        if ($s->fetch()) err('Username sudah dipakai');
        $hash = password_hash($p, PASSWORD_BCRYPT);
        $db->prepare("INSERT INTO users (username,email,password) VALUES (?,?,?)")->execute([$u,$e,$hash]);
        ok(['token'=>makeToken($db,$db->lastInsertId(),$u),'username'=>$u]);
    }

    if ($action === 'verify') {
        $token = $_GET['token']??$input['token']??'';
        $sess  = verifyToken($db, $token);
        if (!$sess) err('Token tidak valid', 401);
        ok(['username'=>$sess['username']]);
    }

    if ($action === 'saveCW') {
        $token=$input['token']??''; $type=$input['type']??''; $key=$input['key']??''; $data=$input['data']??[];
        $sess = verifyToken($db, $token);
        if (!$sess) err('Tidak terautentikasi', 401);
        if (!$key) err('key wajib');
        $db->prepare("INSERT INTO user_cw (user_id,cw_type,cw_key,cw_data,saved_at) VALUES (?,?,?,?,strftime('%s','now'))
                      ON CONFLICT(user_id,cw_type,cw_key) DO UPDATE SET cw_data=excluded.cw_data,saved_at=excluded.saved_at")
           ->execute([$sess['user_id'],$type,$key,json_encode($data)]);
        ok();
    }

    if ($action === 'getCW') {
        $token = $input['token']??'';
        $sess  = verifyToken($db, $token);
        if (!$sess) err('Tidak terautentikasi', 401);
        $s = $db->prepare("SELECT * FROM user_cw WHERE user_id=? ORDER BY saved_at DESC LIMIT 50");
        $s->execute([$sess['user_id']]);
        $rows = $s->fetchAll(PDO::FETCH_ASSOC);
        $result = array_map(function($r) {
            $d = json_decode($r['cw_data'],true)??[];
            return array_merge($d,['_type'=>$r['cw_type'],'_key'=>$r['cw_key'],'savedAt'=>(int)$r['saved_at']*1000]);
        }, $rows);
        ok(['cw'=>$result]);
    }

    err('Action tidak dikenali');
} catch (Exception $e) {
    err('Server error: '.$e->getMessage(), 500);
}
?>
