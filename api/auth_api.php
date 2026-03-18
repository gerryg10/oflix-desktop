<?php
/**
 * AUTH_API.PHP - OFLIX Auth (MySQL Global)
 * Database: InfinityFree MySQL
 * Works across oflix-desktop.vercel.app & oflix-mobile-20-beta.vercel.app
 */
error_reporting(0); ini_set('display_errors', 0);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function ok($d=[])      { echo json_encode(['ok'=>true]+$d); exit; }
function err($m,$c=400) { http_response_code($c); echo json_encode(['ok'=>false,'error'=>$m]); exit; }

// ── MySQL Connection ─────────────────────────────────────
function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;

    $host = 'sql201.infinityfree.com';
    $db   = 'if0_41131942_oflix_database';
    $user = 'if0_41131942';
    $pass = '98166512';

    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=utf8mb4",
        $user, $pass,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
        ]
    );

    // ── Auto-create tables if not exist ──
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) DEFAULT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_tokens (
        token VARCHAR(128) PRIMARY KEY,
        user_id INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_cw (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        cw_type VARCHAR(50) NOT NULL,
        cw_key VARCHAR(500) NOT NULL,
        cw_data JSON,
        saved_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_user_cw (user_id, cw_type, cw_key(255)),
        INDEX idx_user_saved (user_id, saved_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_watchlist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        detail_path VARCHAR(500) NOT NULL,
        poster TEXT,
        item_type VARCHAR(50) DEFAULT 'video',
        added_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_user_wl (user_id, detail_path(255)),
        INDEX idx_user_added (user_id, added_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        detail_path VARCHAR(500) NOT NULL,
        action ENUM('like','dislike') NOT NULL,
        updated_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_user_like (user_id, detail_path(255)),
        INDEX idx_user_likes (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    return $pdo;
}

function makeToken($db, $uid, $uname) {
    $token   = bin2hex(random_bytes(32));
    $expires = time() + (30 * 86400); // 30 days
    $s = $db->prepare("INSERT INTO user_tokens (token, user_id, username, expires_at) VALUES (?,?,?,?)
                        ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), username=VALUES(username), expires_at=VALUES(expires_at)");
    $s->execute([$token, $uid, $uname, $expires]);
    return $token;
}

function verifyToken($db, $token) {
    if (!$token) return null;
    $s = $db->prepare("SELECT * FROM user_tokens WHERE token=? AND expires_at>?");
    $s->execute([$token, time()]);
    return $s->fetch() ?: null;
}

function requireAuth($db, $input) {
    $token = $input['token'] ?? $_GET['token'] ?? '';
    $sess  = verifyToken($db, $token);
    if (!$sess) err('Tidak terautentikasi', 401);
    return $sess;
}

// ── Parse input ──────────────────────────────────────────
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? $input['action'] ?? '';

try {
    $db = getDB();

    // ══════════════════════════════════════════════════════
    // REGISTER
    // ══════════════════════════════════════════════════════
    if ($action === 'register') {
        $u = trim($input['username'] ?? '');
        $p = $input['password'] ?? '';
        $e = trim($input['email'] ?? '');
        if (!$u || !$p) err('Username dan password wajib diisi');
        if (strlen($u) < 3) err('Username minimal 3 karakter');
        if (strlen($p) < 4) err('Password minimal 4 karakter');

        $s = $db->prepare("SELECT id FROM users WHERE LOWER(username)=LOWER(?)");
        $s->execute([$u]);
        if ($s->fetch()) err('Username sudah dipakai');

        $hash = password_hash($p, PASSWORD_BCRYPT);
        $db->prepare("INSERT INTO users (username, email, password) VALUES (?,?,?)")
           ->execute([$u, $e, $hash]);
        $uid = $db->lastInsertId();
        ok(['token' => makeToken($db, $uid, $u), 'username' => $u]);
    }

    // ══════════════════════════════════════════════════════
    // LOGIN
    // ══════════════════════════════════════════════════════
    if ($action === 'login') {
        $u = trim($input['username'] ?? '');
        $p = $input['password'] ?? '';
        if (!$u || !$p) err('Username dan password wajib diisi');

        $s = $db->prepare("SELECT * FROM users WHERE LOWER(username)=LOWER(?)");
        $s->execute([$u]);
        $user = $s->fetch();
        if (!$user) err('Username tidak ditemukan');
        if (!password_verify($p, $user['password'])) err('Password salah');
        ok(['token' => makeToken($db, $user['id'], $user['username']), 'username' => $user['username']]);
    }

    // ══════════════════════════════════════════════════════
    // VERIFY TOKEN
    // ══════════════════════════════════════════════════════
    if ($action === 'verify') {
        $token = $_GET['token'] ?? $input['token'] ?? '';
        $sess  = verifyToken($db, $token);
        if (!$sess) err('Token tidak valid', 401);
        ok(['username' => $sess['username']]);
    }

    // ══════════════════════════════════════════════════════
    // SAVE CONTINUE WATCHING
    // ══════════════════════════════════════════════════════
    if ($action === 'saveCW') {
        $sess = requireAuth($db, $input);
        $type = $input['type'] ?? '';
        $key  = $input['key'] ?? '';
        $data = $input['data'] ?? [];
        if (!$key) err('key wajib');

        $db->prepare("INSERT INTO user_cw (user_id, cw_type, cw_key, cw_data, saved_at)
                      VALUES (?,?,?,?,UNIX_TIMESTAMP())
                      ON DUPLICATE KEY UPDATE cw_data=VALUES(cw_data), saved_at=VALUES(saved_at)")
           ->execute([$sess['user_id'], $type, $key, json_encode($data)]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // GET CONTINUE WATCHING
    // ══════════════════════════════════════════════════════
    if ($action === 'getCW') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT * FROM user_cw WHERE user_id=? ORDER BY saved_at DESC LIMIT 50");
        $s->execute([$sess['user_id']]);
        $rows = $s->fetchAll();
        $result = array_map(function($r) {
            $d = json_decode($r['cw_data'], true) ?? [];
            return array_merge($d, [
                '_type'   => $r['cw_type'],
                '_key'    => $r['cw_key'],
                'savedAt' => (int)$r['saved_at'] * 1000,
            ]);
        }, $rows);
        ok(['cw' => $result]);
    }

    // ══════════════════════════════════════════════════════
    // WATCHLIST — Add
    // ══════════════════════════════════════════════════════
    if ($action === 'addWatchlist') {
        $sess = requireAuth($db, $input);
        $title  = $input['title'] ?? '';
        $path   = $input['detailPath'] ?? '';
        $poster = $input['poster'] ?? '';
        $type   = $input['itemType'] ?? 'video';
        if (!$path) err('detailPath wajib');

        $db->prepare("INSERT INTO user_watchlist (user_id, title, detail_path, poster, item_type, added_at)
                      VALUES (?,?,?,?,?,UNIX_TIMESTAMP())
                      ON DUPLICATE KEY UPDATE title=VALUES(title), poster=VALUES(poster), added_at=VALUES(added_at)")
           ->execute([$sess['user_id'], $title, $path, $poster, $type]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // WATCHLIST — Remove
    // ══════════════════════════════════════════════════════
    if ($action === 'removeWatchlist') {
        $sess = requireAuth($db, $input);
        $path = $input['detailPath'] ?? '';
        if (!$path) err('detailPath wajib');
        $db->prepare("DELETE FROM user_watchlist WHERE user_id=? AND detail_path=?")
           ->execute([$sess['user_id'], $path]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // WATCHLIST — Get all
    // ══════════════════════════════════════════════════════
    if ($action === 'getWatchlist') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT * FROM user_watchlist WHERE user_id=? ORDER BY added_at DESC LIMIT 50");
        $s->execute([$sess['user_id']]);
        $rows = $s->fetchAll();
        $result = array_map(function($r) {
            return [
                'title'      => $r['title'],
                'detailPath' => $r['detail_path'],
                'poster'     => $r['poster'],
                'type'       => $r['item_type'],
                'addedAt'    => (int)$r['added_at'] * 1000,
            ];
        }, $rows);
        ok(['watchlist' => $result]);
    }

    // ══════════════════════════════════════════════════════
    // LIKE / DISLIKE — Set
    // ══════════════════════════════════════════════════════
    if ($action === 'setLike') {
        $sess   = requireAuth($db, $input);
        $path   = $input['detailPath'] ?? '';
        $likeAction = $input['likeAction'] ?? ''; // 'like', 'dislike', or 'none'
        if (!$path) err('detailPath wajib');

        if ($likeAction === 'none') {
            $db->prepare("DELETE FROM user_likes WHERE user_id=? AND detail_path=?")
               ->execute([$sess['user_id'], $path]);
        } else {
            $db->prepare("INSERT INTO user_likes (user_id, detail_path, action, updated_at)
                          VALUES (?,?,?,UNIX_TIMESTAMP())
                          ON DUPLICATE KEY UPDATE action=VALUES(action), updated_at=VALUES(updated_at)")
               ->execute([$sess['user_id'], $path, $likeAction]);
        }
        ok();
    }

    // ══════════════════════════════════════════════════════
    // LIKE / DISLIKE — Get for a specific item
    // ══════════════════════════════════════════════════════
    if ($action === 'getLike') {
        $sess = requireAuth($db, $input);
        $path = $_GET['detailPath'] ?? $input['detailPath'] ?? '';
        if (!$path) err('detailPath wajib');
        $s = $db->prepare("SELECT action FROM user_likes WHERE user_id=? AND detail_path=?");
        $s->execute([$sess['user_id'], $path]);
        $row = $s->fetch();
        ok(['action' => $row ? $row['action'] : 'none']);
    }

    // ══════════════════════════════════════════════════════
    // USER PROFILE (optional - get user info)
    // ══════════════════════════════════════════════════════
    if ($action === 'profile') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT id, username, email, created_at FROM users WHERE id=?");
        $s->execute([$sess['user_id']]);
        $user = $s->fetch();
        if (!$user) err('User not found');

        // Count stats
        $cwCount = $db->prepare("SELECT COUNT(*) as c FROM user_cw WHERE user_id=?");
        $cwCount->execute([$sess['user_id']]);
        $wlCount = $db->prepare("SELECT COUNT(*) as c FROM user_watchlist WHERE user_id=?");
        $wlCount->execute([$sess['user_id']]);

        ok([
            'username'      => $user['username'],
            'email'         => $user['email'],
            'createdAt'     => $user['created_at'],
            'cwCount'       => (int)$cwCount->fetch()['c'],
            'watchlistCount'=> (int)$wlCount->fetch()['c'],
        ]);
    }

    // ══════════════════════════════════════════════════════
    // LOGOUT (cleanup token)
    // ══════════════════════════════════════════════════════
    if ($action === 'logout') {
        $token = $input['token'] ?? $_GET['token'] ?? '';
        if ($token) {
            $db->prepare("DELETE FROM user_tokens WHERE token=?")->execute([$token]);
        }
        ok();
    }

    err('Action tidak dikenali');

} catch (PDOException $e) {
    err('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
    err('Server error: ' . $e->getMessage(), 500);
}
?>
