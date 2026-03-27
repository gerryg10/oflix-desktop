<?php
/**
 * AUTH_API.PHP - OFLIX Auth (Aiven MySQL Global)
 * PIN-based profiles like Netflix
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
    static $pdo = null;
    if ($pdo) return $pdo;

    $host = 'sql-oflixdb-oflix-globaldb.c.aivencloud.com';
    $port = 15130;
    $db   = 'defaultdb';
    $user = 'avnadmin';
    $pass = 'AVNS_Ut63bB-94DqaM7VcyUf';

    $dsn = "mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_SSL_CA       => null,
        PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT => false,
    ]);
    // Force SSL
    $pdo->exec("SET SESSION wait_timeout=28800");

    // Auto-create tables
    $pdo->exec("CREATE TABLE IF NOT EXISTS profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        pin_hash VARCHAR(255) NOT NULL,
        avatar_url TEXT DEFAULT NULL,
        avatar_color VARCHAR(20) DEFAULT '#e50914',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS profile_tokens (
        token VARCHAR(128) PRIMARY KEY,
        profile_id INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX idx_pid (profile_id),
        INDEX idx_exp (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_cw (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        cw_type VARCHAR(50) NOT NULL,
        cw_key VARCHAR(500) NOT NULL,
        cw_data JSON,
        saved_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_cw (profile_id, cw_type, cw_key(255)),
        INDEX idx_cw_saved (profile_id, saved_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_watchlist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        detail_path VARCHAR(500) NOT NULL,
        poster TEXT,
        item_type VARCHAR(50) DEFAULT 'video',
        added_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_wl (profile_id, detail_path(255)),
        INDEX idx_wl (profile_id, added_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        detail_path VARCHAR(500) NOT NULL,
        action ENUM('like','dislike') NOT NULL,
        title VARCHAR(500) DEFAULT NULL,
        poster TEXT DEFAULT NULL,
        updated_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_like (profile_id, detail_path(255)),
        INDEX idx_likes (profile_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS user_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        detail_path VARCHAR(500) NOT NULL,
        title VARCHAR(500) DEFAULT NULL,
        poster TEXT DEFAULT NULL,
        item_type VARCHAR(50) DEFAULT 'video',
        viewed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
        UNIQUE KEY uq_hist (profile_id, detail_path(255)),
        INDEX idx_hist (profile_id, viewed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    return $pdo;
}

function makeToken($db, $pid, $uname) {
    $token   = bin2hex(random_bytes(32));
    $expires = time() + (90 * 86400); // 90 days
    $db->prepare("INSERT INTO profile_tokens (token, profile_id, username, expires_at) VALUES (?,?,?,?)
                  ON DUPLICATE KEY UPDATE profile_id=VALUES(profile_id), username=VALUES(username), expires_at=VALUES(expires_at)")
       ->execute([$token, $pid, $uname, $expires]);
    return $token;
}

function verifyToken($db, $token) {
    if (!$token) return null;
    $s = $db->prepare("SELECT * FROM profile_tokens WHERE token=? AND expires_at>?");
    $s->execute([$token, time()]);
    return $s->fetch() ?: null;
}

function requireAuth($db, $input) {
    $token = $input['token'] ?? $_GET['token'] ?? '';
    $sess  = verifyToken($db, $token);
    if (!$sess) err('Tidak terautentikasi', 401);
    return $sess;
}

$AVATAR_COLORS = ['#e50914','#1a73e8','#0a7f3f','#e5a000','#9c27b0','#00bcd4','#ff5722','#607d8b'];

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? $input['action'] ?? '';

try {
    $db = getDB();

    // ══════════════════════════════════════════════════════
    // GET ALL PROFILES (for profile picker)
    // ══════════════════════════════════════════════════════
    if ($action === 'getProfiles') {
        $s = $db->query("SELECT id, username, avatar_url, avatar_color, created_at FROM profiles ORDER BY id ASC LIMIT 20");
        $profiles = $s->fetchAll();
        ok(['profiles' => $profiles]);
    }

    // ══════════════════════════════════════════════════════
    // CREATE PROFILE (register with PIN)
    // ══════════════════════════════════════════════════════
    if ($action === 'createProfile') {
        $name = trim($input['username'] ?? '');
        $pin  = $input['pin'] ?? '';
        if (!$name) err('Nama profile wajib diisi');
        if (!preg_match('/^\d{4}$/', $pin)) err('PIN harus 4 angka');
        if (strlen($name) < 2) err('Nama minimal 2 karakter');
        if (strlen($name) > 20) err('Nama maksimal 20 karakter');

        // Check max 5 profiles
        $cnt = $db->query("SELECT COUNT(*) as c FROM profiles")->fetch()['c'];
        if ($cnt >= 20) err('Maksimal 20 profile');

        // Check unique name
        $s = $db->prepare("SELECT id FROM profiles WHERE LOWER(username)=LOWER(?)");
        $s->execute([$name]);
        if ($s->fetch()) err('Nama sudah dipakai');

        global $AVATAR_COLORS;
        $color = $AVATAR_COLORS[$cnt % count($AVATAR_COLORS)];
        $hash  = password_hash($pin, PASSWORD_BCRYPT);

        $db->prepare("INSERT INTO profiles (username, pin_hash, avatar_color) VALUES (?,?,?)")
           ->execute([$name, $hash, $color]);
        $pid = $db->lastInsertId();

        ok([
            'token'    => makeToken($db, $pid, $name),
            'profile'  => ['id'=>(int)$pid, 'username'=>$name, 'avatar_url'=>null, 'avatar_color'=>$color],
        ]);
    }

    // ══════════════════════════════════════════════════════
    // LOGIN (verify PIN)
    // ══════════════════════════════════════════════════════
    if ($action === 'login') {
        $pid = (int)($input['profileId'] ?? 0);
        $pin = $input['pin'] ?? '';
        if (!$pid || !$pin) err('Profile dan PIN wajib');

        $s = $db->prepare("SELECT * FROM profiles WHERE id=?");
        $s->execute([$pid]);
        $profile = $s->fetch();
        if (!$profile) err('Profile tidak ditemukan');
        if (!password_verify($pin, $profile['pin_hash'])) err('PIN salah');

        ok([
            'token'   => makeToken($db, $profile['id'], $profile['username']),
            'profile' => [
                'id'           => (int)$profile['id'],
                'username'     => $profile['username'],
                'avatar_url'   => $profile['avatar_url'],
                'avatar_color' => $profile['avatar_color'],
            ],
        ]);
    }

    // ══════════════════════════════════════════════════════
    // VERIFY TOKEN
    // ══════════════════════════════════════════════════════
    if ($action === 'verify') {
        $token = $_GET['token'] ?? $input['token'] ?? '';
        $sess  = verifyToken($db, $token);
        if (!$sess) err('Token tidak valid', 401);

        $s = $db->prepare("SELECT id, username, avatar_url, avatar_color, created_at FROM profiles WHERE id=?");
        $s->execute([$sess['profile_id']]);
        $profile = $s->fetch();
        if (!$profile) err('Profile not found');

        ok(['profile' => $profile]);
    }

    // ══════════════════════════════════════════════════════
    // LOGOUT
    // ══════════════════════════════════════════════════════
    if ($action === 'logout') {
        $token = $input['token'] ?? $_GET['token'] ?? '';
        if ($token) $db->prepare("DELETE FROM profile_tokens WHERE token=?")->execute([$token]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // SWITCH PROFILE (logout current, show picker)
    // ══════════════════════════════════════════════════════
    if ($action === 'switchProfile') {
        $token = $input['token'] ?? '';
        if ($token) $db->prepare("DELETE FROM profile_tokens WHERE token=?")->execute([$token]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // UPDATE AVATAR
    // ══════════════════════════════════════════════════════
    if ($action === 'updateAvatar') {
        $sess = requireAuth($db, $input);
        $url  = $input['avatar_url'] ?? '';
        $db->prepare("UPDATE profiles SET avatar_url=? WHERE id=?")->execute([$url, $sess['profile_id']]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // GET PROFILE PAGE DATA
    // ══════════════════════════════════════════════════════
    if ($action === 'profilePage') {
        $sess = requireAuth($db, $input);
        $pid  = $sess['profile_id'];

        $s = $db->prepare("SELECT id, username, avatar_url, avatar_color, created_at FROM profiles WHERE id=?");
        $s->execute([$pid]); $profile = $s->fetch();

        $cw = $db->prepare("SELECT * FROM user_cw WHERE profile_id=? ORDER BY saved_at DESC LIMIT 30");
        $cw->execute([$pid]);
        $cwItems = array_map(function($r) {
            $d = json_decode($r['cw_data'], true) ?? [];
            return array_merge($d, ['_type'=>$r['cw_type'], '_key'=>$r['cw_key'], 'savedAt'=>(int)$r['saved_at']*1000]);
        }, $cw->fetchAll());

        $wl = $db->prepare("SELECT * FROM user_watchlist WHERE profile_id=? ORDER BY added_at DESC LIMIT 50");
        $wl->execute([$pid]);
        $wlItems = array_map(fn($r) => [
            'title'=>$r['title'], 'detailPath'=>$r['detail_path'],
            'poster'=>$r['poster'], 'type'=>$r['item_type'], 'addedAt'=>(int)$r['added_at']*1000,
        ], $wl->fetchAll());

        $lk = $db->prepare("SELECT * FROM user_likes WHERE profile_id=? AND action='like' ORDER BY updated_at DESC LIMIT 50");
        $lk->execute([$pid]);
        $likeItems = array_map(fn($r) => [
            'detailPath'=>$r['detail_path'], 'title'=>$r['title'],
            'poster'=>$r['poster'], 'action'=>$r['action'],
        ], $lk->fetchAll());

        $hs = $db->prepare("SELECT * FROM user_history WHERE profile_id=? ORDER BY viewed_at DESC LIMIT 50");
        $hs->execute([$pid]);
        $histItems = array_map(fn($r) => [
            'detailPath'=>$r['detail_path'], 'title'=>$r['title'],
            'poster'=>$r['poster'], 'type'=>$r['item_type'], 'viewedAt'=>(int)$r['viewed_at']*1000,
        ], $hs->fetchAll());

        ok([
            'profile'   => $profile,
            'cw'        => $cwItems,
            'watchlist'  => $wlItems,
            'likes'      => $likeItems,
            'history'    => $histItems,
        ]);
    }

    // ══════════════════════════════════════════════════════
    // SAVE CONTINUE WATCHING
    // ══════════════════════════════════════════════════════
    if ($action === 'saveCW') {
        $sess = requireAuth($db, $input);
        $type = $input['type'] ?? ''; $key = $input['key'] ?? ''; $data = $input['data'] ?? [];
        if (!$key) err('key wajib');
        $db->prepare("INSERT INTO user_cw (profile_id, cw_type, cw_key, cw_data, saved_at)
                      VALUES (?,?,?,?,UNIX_TIMESTAMP())
                      ON DUPLICATE KEY UPDATE cw_data=VALUES(cw_data), saved_at=VALUES(saved_at)")
           ->execute([$sess['profile_id'], $type, $key, json_encode($data)]);
        ok();
    }

    // ══════════════════════════════════════════════════════
    // GET CONTINUE WATCHING
    // ══════════════════════════════════════════════════════
    if ($action === 'getCW') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT * FROM user_cw WHERE profile_id=? ORDER BY saved_at DESC LIMIT 50");
        $s->execute([$sess['profile_id']]);
        $result = array_map(function($r) {
            $d = json_decode($r['cw_data'], true) ?? [];
            return array_merge($d, ['_type'=>$r['cw_type'], '_key'=>$r['cw_key'], 'savedAt'=>(int)$r['saved_at']*1000]);
        }, $s->fetchAll());
        ok(['cw' => $result]);
    }

    // ══════════════════════════════════════════════════════
    // WATCHLIST
    // ══════════════════════════════════════════════════════
    if ($action === 'addWatchlist') {
        $sess = requireAuth($db, $input);
        $db->prepare("INSERT INTO user_watchlist (profile_id, title, detail_path, poster, item_type, added_at)
                      VALUES (?,?,?,?,?,UNIX_TIMESTAMP())
                      ON DUPLICATE KEY UPDATE title=VALUES(title), poster=VALUES(poster), added_at=VALUES(added_at)")
           ->execute([$sess['profile_id'], $input['title']??'', $input['detailPath']??'', $input['poster']??'', $input['itemType']??'video']);
        ok();
    }
    if ($action === 'removeWatchlist') {
        $sess = requireAuth($db, $input);
        $db->prepare("DELETE FROM user_watchlist WHERE profile_id=? AND detail_path=?")->execute([$sess['profile_id'], $input['detailPath']??'']);
        ok();
    }
    if ($action === 'getWatchlist') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT * FROM user_watchlist WHERE profile_id=? ORDER BY added_at DESC LIMIT 50");
        $s->execute([$sess['profile_id']]);
        ok(['watchlist' => array_map(fn($r) => ['title'=>$r['title'],'detailPath'=>$r['detail_path'],'poster'=>$r['poster'],'type'=>$r['item_type'],'addedAt'=>(int)$r['added_at']*1000], $s->fetchAll())]);
    }

    // ══════════════════════════════════════════════════════
    // LIKES
    // ══════════════════════════════════════════════════════
    if ($action === 'setLike') {
        $sess = requireAuth($db, $input);
        $path = $input['detailPath'] ?? ''; $act = $input['likeAction'] ?? '';
        if (!$path) err('detailPath wajib');
        if ($act === 'none') {
            $db->prepare("DELETE FROM user_likes WHERE profile_id=? AND detail_path=?")->execute([$sess['profile_id'], $path]);
        } else {
            $db->prepare("INSERT INTO user_likes (profile_id, detail_path, action, title, poster, updated_at)
                          VALUES (?,?,?,?,?,UNIX_TIMESTAMP())
                          ON DUPLICATE KEY UPDATE action=VALUES(action), title=VALUES(title), poster=VALUES(poster), updated_at=VALUES(updated_at)")
               ->execute([$sess['profile_id'], $path, $act, $input['title']??'', $input['poster']??'']);
        }
        ok();
    }
    if ($action === 'getLike') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT action FROM user_likes WHERE profile_id=? AND detail_path=?");
        $s->execute([$sess['profile_id'], $_GET['detailPath'] ?? $input['detailPath'] ?? '']);
        $row = $s->fetch();
        ok(['action' => $row ? $row['action'] : 'none']);
    }

    // ══════════════════════════════════════════════════════
    // HISTORY (log detail views)
    // ══════════════════════════════════════════════════════
    if ($action === 'addHistory') {
        $sess = requireAuth($db, $input);
        $db->prepare("INSERT INTO user_history (profile_id, detail_path, title, poster, item_type, viewed_at)
                      VALUES (?,?,?,?,?,UNIX_TIMESTAMP())
                      ON DUPLICATE KEY UPDATE title=VALUES(title), poster=VALUES(poster), viewed_at=VALUES(viewed_at)")
           ->execute([$sess['profile_id'], $input['detailPath']??'', $input['title']??'', $input['poster']??'', $input['itemType']??'video']);
        ok();
    }
    if ($action === 'getHistory') {
        $sess = requireAuth($db, $input);
        $s = $db->prepare("SELECT * FROM user_history WHERE profile_id=? ORDER BY viewed_at DESC LIMIT 50");
        $s->execute([$sess['profile_id']]);
        ok(['history' => array_map(fn($r) => ['detailPath'=>$r['detail_path'],'title'=>$r['title'],'poster'=>$r['poster'],'type'=>$r['item_type'],'viewedAt'=>(int)$r['viewed_at']*1000], $s->fetchAll())]);
    }

    // ══════════════════════════════════════════════════════
    // DELETE PROFILE
    // ══════════════════════════════════════════════════════
    if ($action === 'deleteProfile') {
        $sess = requireAuth($db, $input);
        $pid = $sess['profile_id'];
        $db->prepare("DELETE FROM profile_tokens WHERE profile_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM user_cw WHERE profile_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM user_watchlist WHERE profile_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM user_likes WHERE profile_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM user_history WHERE profile_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM profiles WHERE id=?")->execute([$pid]);
        ok();
    }

    err('Action tidak dikenali');

} catch (PDOException $e) {
    err('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
    err('Server error: ' . $e->getMessage(), 500);
}
?>
