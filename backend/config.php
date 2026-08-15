<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

define('DB_HOST', getenv('DB_HOST') !== false && trim((string)getenv('DB_HOST')) !== '' ? trim((string)getenv('DB_HOST')) : 'localhost');
define('DB_USER', getenv('DB_USER') !== false && trim((string)getenv('DB_USER')) !== '' ? trim((string)getenv('DB_USER')) : 'root');
define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');
define('DB_NAME', getenv('DB_NAME') !== false && trim((string)getenv('DB_NAME')) !== '' ? trim((string)getenv('DB_NAME')) : 'vk_video_calls');

function getDB() {
    try {
        $pdo = new PDO(
            "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
            DB_USER,
            DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'DB error']);
        exit();
    }
}

function send($success, $error = null) {
    echo json_encode(['success' => $success, 'error' => $error]);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? null;

if (!$action) send(false, 'No action');

$pdo = getDB();

switch($action) {
    case 'create':
        $room_id = $input['room_id'] ?? '';
        if (!$room_id) send(false, 'No room id');
        
        try {
            $stmt = $pdo->prepare("INSERT INTO calls (room_id, creator_id, status) VALUES (?, ?, 'active')");
            $stmt->execute([$room_id, $input['user_id'] ?? null]);
            send(true);
        } catch(Exception $e) {
            send(false, 'Room exists');
        }
        break;
        
    case 'join':
        $room_id = $input['room_id'] ?? '';
        if (!$room_id) send(false, 'No room id');
        
        $stmt = $pdo->prepare("SELECT * FROM calls WHERE room_id = ? AND status = 'active'");
        $stmt->execute([$room_id]);
        if (!$stmt->fetch()) send(false, 'Room not found');
        
        $stmt = $pdo->prepare("INSERT INTO participants (room_id, user_id) VALUES (?, ?)");
        $stmt->execute([$room_id, $input['user_id'] ?? null]);
        send(true);
        break;
        
    case 'close':
        $room_id = $input['room_id'] ?? '';
        if ($room_id) {
            $stmt = $pdo->prepare("UPDATE calls SET status = 'closed' WHERE room_id = ?");
            $stmt->execute([$room_id]);
        }
        send(true);
        break;
        
    default:
        send(false, 'Invalid action');
}
?>