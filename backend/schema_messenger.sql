-- Seych messenger (MySQL 5.7+ / MariaDB). Импорт: mysql -u root seych_messenger < schema_messenger.sql
CREATE TABLE IF NOT EXISTS chats (
  id VARCHAR(220) NOT NULL PRIMARY KEY,
  user1_id VARCHAR(120) NOT NULL,
  user2_id VARCHAR(120) NOT NULL,
  last_message TEXT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0,
  meta_json JSON NULL,
  UNIQUE KEY uniq_users (user1_id, user2_id),
  KEY idx_u1 (user1_id),
  KEY idx_u2 (user2_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  chat_id VARCHAR(220) NOT NULL,
  from_id VARCHAR(120) NOT NULL,
  to_id VARCHAR(120) NOT NULL,
  text MEDIUMTEXT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  file_url MEDIUMTEXT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  audio_mime VARCHAR(80) NULL DEFAULT '',
  reply_to VARCHAR(100) NOT NULL DEFAULT '',
  forwarded_from VARCHAR(100) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  edited_at BIGINT NOT NULL DEFAULT 0,
  deleted_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_chat_time (chat_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  user_id VARCHAR(120) NOT NULL PRIMARY KEY,
  who_can_write ENUM('all','friends','nobody') NOT NULL DEFAULT 'all',
  who_can_call ENUM('all','friends','nobody') NOT NULL DEFAULT 'all',
  who_can_see_profile ENUM('all','friends','nobody') NOT NULL DEFAULT 'all'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messenger_profiles (
  user_id VARCHAR(120) NOT NULL PRIMARY KEY,
  display_name VARCHAR(200) NOT NULL DEFAULT '',
  avatar_url VARCHAR(2000) NOT NULL DEFAULT '',
  username VARCHAR(64) NOT NULL DEFAULT '',
  status_text VARCHAR(200) NOT NULL DEFAULT '',
  blacklist_json JSON NULL,
  blacklist_meta_json JSON NULL,
  friend_ids_json JSON NULL,
  online TINYINT(1) NOT NULL DEFAULT 0,
  last_seen_ms BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
