<?php
// panel_api.php - lightweight ping endpoint for Vercel
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? 'ping';

if ($action === 'ping') {
    echo json_encode(['ok' => true, 'ts' => time()]);
    exit;
}

echo json_encode(['ok' => true]);
?>
