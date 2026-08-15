<?php
require_once 'config.php';

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? null;

if (!$action) {
    jsonResponse(false, null, 'Action required');
}

$pdo = getDBConnection();

switch ($action) {
    case 'create':
        $room_id = $input['room_id'] ?? null;
        $user_id = $input['user_id'] ?? null;
        
        if (!$room_id) {
            jsonResponse(false, null, 'Room ID required');
        }
        
        try {
            $stmt = $pdo->prepare("INSERT INTO calls (room_id, creator_id, status) VALUES (?, ?, 'active')");
            $stmt->execute([$room_id, $user_id]);
            jsonResponse(true, ['room_id' => $room_id]);
        } catch (PDOException $e) {
            if ($e->errorInfo[1] == 1062) {
                jsonResponse(false, null, 'Room already exists');
            } else {
                jsonResponse(false, null, 'Failed to create room');
            }
        }
        break;
        
    case 'join':
        $room_id = $input['room_id'] ?? null;
        $user_id = $input['user_id'] ?? null;
        
        if (!$room_id) {
            jsonResponse(false, null, 'Room ID required');
        }
        
        try {
            $stmt = $pdo->prepare("SELECT * FROM calls WHERE room_id = ? AND status = 'active'");
            $stmt->execute([$room_id]);
            $room = $stmt->fetch();
            
            if (!$room) {
                jsonResponse(false, null, 'Room not found or closed');
            }
            
            $stmt = $pdo->prepare("INSERT INTO participants (room_id, user_id) VALUES (?, ?)");
            $stmt->execute([$room_id, $user_id]);
            
            jsonResponse(true, ['room_id' => $room_id]);
        } catch (PDOException $e) {
            jsonResponse(false, null, 'Failed to join room');
        }
        break;
        
    case 'close':
        $room_id = $input['room_id'] ?? null;
        
        if (!$room_id) {
            jsonResponse(false, null, 'Room ID required');
        }
        
        try {
            $stmt = $pdo->prepare("UPDATE calls SET status = 'closed' WHERE room_id = ?");
            $stmt->execute([$room_id]);
            jsonResponse(true);
        } catch (PDOException $e) {
            jsonResponse(false, null, 'Failed to close room');
        }
        break;
        
    default:
        jsonResponse(false, null, 'Invalid action');
}
?>