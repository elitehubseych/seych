'use strict';

const { Pool } = require('pg');

let pool = null;
let enabled = false;

function env(name, def = '') {
  const v = process.env[name];
  if (v == null) return def;
  const t = String(v).trim();
  return t.length ? t : def;
}

function sortedPair(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? [x, y] : [y, x];
}

function directChatId(a, b) {
  const [u1, u2] = sortedPair(a, b);
  if (!u1 || !u2) return '';
  return `dm:${u1}::${u2}`;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(120) PRIMARY KEY,
      username VARCHAR(64) NOT NULL DEFAULT '',
      display_name VARCHAR(200) NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      status VARCHAR(500) NOT NULL DEFAULT '',
      last_seen BIGINT NOT NULL DEFAULT 0,
      blacklist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      blacklist_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      friend_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      online BOOLEAN NOT NULL DEFAULT false,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      user_id VARCHAR(120) PRIMARY KEY,
      who_can_write VARCHAR(16) NOT NULL DEFAULT 'all',
      who_can_call VARCHAR(16) NOT NULL DEFAULT 'all',
      who_can_see_profile VARCHAR(16) NOT NULL DEFAULT 'all',
      who_can_see_stories VARCHAR(16) NOT NULL DEFAULT 'friends',
      CONSTRAINT settings_write_chk CHECK (who_can_write IN ('all','friends','nobody')),
      CONSTRAINT settings_call_chk CHECK (who_can_call IN ('all','friends','nobody')),
      CONSTRAINT settings_profile_chk CHECK (who_can_see_profile IN ('all','friends','nobody')),
      CONSTRAINT settings_stories_chk CHECK (who_can_see_stories IN ('all','friends','nobody'))
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id VARCHAR(220) PRIMARY KEY,
      user1_id VARCHAR(120) NOT NULL,
      user2_id VARCHAR(120) NOT NULL,
      last_message_id VARCHAR(100),
      last_message_preview JSONB,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at BIGINT NOT NULL DEFAULT 0,
      CONSTRAINT chats_pair_uniq UNIQUE (user1_id, user2_id)
    )
  `);

  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_kind VARCHAR(16) NOT NULL DEFAULT 'direct'`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS title VARCHAR(220) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS invite_code VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_pair_uniq`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chats_kind_chk'
      ) THEN
        ALTER TABLE chats
          ADD CONSTRAINT chats_kind_chk CHECK (chat_kind IN ('direct','group'));
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id VARCHAR(220) NOT NULL,
      user_id VARCHAR(120) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'member',
      joined_at BIGINT NOT NULL DEFAULT 0,
      invited_by VARCHAR(120) NOT NULL DEFAULT '',
      settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (chat_id, user_id),
      CONSTRAINT chat_members_role_chk CHECK (role IN ('owner','admin','member'))
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(100) PRIMARY KEY,
      chat_id VARCHAR(220) NOT NULL,
      sender_id VARCHAR(120) NOT NULL,
      recipient_id VARCHAR(120) NOT NULL,
      text TEXT,
      type VARCHAR(32) NOT NULL DEFAULT 'text',
      file_url TEXT,
      audio_mime VARCHAR(80) NOT NULL DEFAULT '',
      image_mime VARCHAR(80) NOT NULL DEFAULT '',
      duration_ms INT NOT NULL DEFAULT 0,
      reply_to VARCHAR(100) NOT NULL DEFAULT '',
      forwarded_from VARCHAR(100) NOT NULL DEFAULT '',
      forwarded_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
      reactions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      delivered_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      read_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at BIGINT NOT NULL,
      edited_at BIGINT NOT NULL DEFAULT 0,
      deleted_at BIGINT NOT NULL DEFAULT 0
    )
  `);

  // На случай уже существующей таблицы (если у вас код обновился, а БД нет).
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_mime VARCHAR(80) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_preview JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_by JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS who_can_see_stories VARCHAR(16) NOT NULL DEFAULT 'friends'`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS who_can_join_groups VARCHAR(16) NOT NULL DEFAULT 'friends'`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS ui_theme VARCHAR(16) NOT NULL DEFAULT 'classic'`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS chat_wallpaper TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS chat_wallpaper_blur BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS external_key VARCHAR(180) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_tab BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_updated_at BIGINT NOT NULL DEFAULT 0`);

  // ==== Друзья (раньше хранились в friends_store.json, теперь в PostgreSQL) ====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id VARCHAR(100) PRIMARY KEY,
      from_id VARCHAR(120) NOT NULL,
      to_id VARCHAR(120) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      CONSTRAINT friend_requests_status_chk CHECK (status IN ('pending','accepted','declined'))
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_id, status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      pair_key VARCHAR(240) PRIMARY KEY,
      user_a VARCHAR(120) NOT NULL,
      user_b VARCHAR(120) NOT NULL,
      created_at BIGINT NOT NULL DEFAULT 0
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_invites (
      id VARCHAR(100) PRIMARY KEY,
      from_id VARCHAR(120) NOT NULL,
      to_id VARCHAR(120) NOT NULL,
      room_id VARCHAR(220) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      CONSTRAINT call_invites_status_chk CHECK (status IN ('pending','accepted','declined','cancelled'))
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_call_invites_to ON call_invites(to_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_call_invites_from ON call_invites(from_id, status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      user_id VARCHAR(120) NOT NULL,
      endpoint TEXT NOT NULL,
      auth_key TEXT NOT NULL DEFAULT '',
      p256dh TEXT NOT NULL DEFAULT '',
      content_encoding VARCHAR(32) NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, endpoint)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS identity_links (
      identity_key VARCHAR(180) PRIMARY KEY,
      user_id VARCHAR(120) NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_identity_links_user ON identity_links(user_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'settings_theme_chk'
      ) THEN
        ALTER TABLE settings
          ADD CONSTRAINT settings_theme_chk CHECK (ui_theme IN ('classic','dark'));
      END IF;
    END $$;
  `);

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, created_at) WHERE deleted_at = 0'
  );
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (LOWER(username)) WHERE username <> ''`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chats_u1 ON chats(user1_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chats_u2 ON chats(user2_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chats_kind_updated ON chats(chat_kind, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chats_invite_code ON chats(invite_code)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, joined_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_members_chat ON chat_members(chat_id, joined_at ASC)');

  // Stories tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id VARCHAR(100) PRIMARY KEY,
      user_id VARCHAR(120) NOT NULL,
      video_url TEXT NOT NULL,
      video_mime VARCHAR(80) NOT NULL DEFAULT 'video/mp4',
      duration_ms INT NOT NULL DEFAULT 0,
      thumbnail_url TEXT,
      caption TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      privacy VARCHAR(16) NOT NULL DEFAULT 'friends',
      CONSTRAINT stories_privacy_chk CHECK (privacy IN ('all','friends','nobody'))
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id VARCHAR(100) NOT NULL,
      viewer_id VARCHAR(120) NOT NULL,
      viewed_at BIGINT NOT NULL,
      comment_text TEXT NOT NULL DEFAULT '',
      commented_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (story_id, viewer_id)
    )
  `);

  await pool.query(`ALTER TABLE story_views ADD COLUMN IF NOT EXISTS comment_text TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE story_views ADD COLUMN IF NOT EXISTS commented_at BIGINT NOT NULL DEFAULT 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS story_likes (
      story_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(120) NOT NULL,
      liked_at BIGINT NOT NULL,
      PRIMARY KEY (story_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id VARCHAR(120) NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      device_name VARCHAR(120) NOT NULL DEFAULT '',
      platform VARCHAR(60) NOT NULL DEFAULT '',
      ip VARCHAR(64) NOT NULL DEFAULT '',
      city VARCHAR(120) NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, device_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, last_seen_at DESC)');

  // Позиция прокрутки истории чата (где пользователь остановился в последний раз).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_scrolls (
      user_id VARCHAR(120) NOT NULL,
      chat_id VARCHAR(220) NOT NULL,
      msg_id VARCHAR(100) NOT NULL DEFAULT '',
      offset_px INT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, chat_id)
    )
  `);

  // Indexes for stories
  await pool.query('CREATE INDEX IF NOT EXISTS idx_stories_user_time ON stories(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views(story_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_story_likes_story ON story_likes(story_id)');
}

async function initMessengerPostgres() {
  const conn = env('DATABASE_URL');
  if (!conn) {
    console.warn('[messenger_pg] DATABASE_URL not set');
    return false;
  }
  try {
    const poolOpts = {
      connectionString: conn,
      max: Number(env('PG_POOL_MAX', '10')) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: Number(env('PG_CONNECT_TIMEOUT_MS', '20000')) || 20000
    };
    if (env('DATABASE_SSL') === '0') {
      poolOpts.ssl = false;
    } else if (/sslmode=require|sslmode=verify-full/i.test(conn) || env('PG_SSL') === '1') {
      poolOpts.ssl = { rejectUnauthorized: env('PG_SSL_REJECT_UNAUTHORIZED') === '1' };
    }
    pool = new Pool(poolOpts);
    await pool.query('SELECT 1');
    await ensureTables();
    enabled = true;
    console.log('[messenger_pg] connected (PostgreSQL)');
    return true;
  } catch (err) {
    console.error('[messenger_pg] init failed:', err && err.message);
    try {
      if (pool) await pool.end();
    } catch (_) {}
    pool = null;
    enabled = false;
    return false;
  }
}

function isEnabled() {
  return enabled && pool;
}

async function query(sql, params) {
  return pool.query(sql, params);
}

function parseJsonCol(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') return safeJson(val, fallback);
  return fallback;
}

function rowToServerProfile(userId, userRow, settingsRow) {
  if (!userRow) return null;
  const bl = parseJsonCol(userRow.blacklist_json, []);
  const blm = parseJsonCol(userRow.blacklist_meta_json, {});
  const friends = parseJsonCol(userRow.friend_ids_json, []);
  return {
    id: userId,
    name: userRow.display_name || '',
    avatar: userRow.avatar_url || '',
    coverUrl: userRow.cover_url || '',
    username: userRow.username || '',
    statusText: userRow.status || '',
    blacklist: Array.isArray(bl) ? bl : [],
    blacklistMeta: blm && typeof blm === 'object' ? blm : {},
    friendIds: Array.isArray(friends) ? friends : [],
    online: !!userRow.online,
    lastSeenAt: Number(userRow.last_seen) || 0,
    privacy: {
      canWrite: settingsRow?.who_can_write || 'all',
      canCall: settingsRow?.who_can_call || 'all',
      canViewProfile: settingsRow?.who_can_see_profile || 'all',
      canSeeStories: settingsRow?.who_can_see_stories || 'friends',
      canJoinGroups: settingsRow?.who_can_join_groups || 'friends'
    },
    appearance: {
      theme: String(settingsRow?.ui_theme || '').trim() === 'dark' ? 'dark' : 'classic',
      chatWallpaper: settingsRow?.chat_wallpaper || '',
      chatWallpaperBlur: settingsRow?.chat_wallpaper_blur !== false
    }
  };
}

function safeJson(s, def) {
  try {
    return JSON.parse(s);
  } catch {
    return def;
  }
}

async function getSettingsRow(userId) {
  const { rows } = await pool.query(
    'SELECT who_can_write, who_can_call, who_can_see_profile, who_can_see_stories, who_can_join_groups, ui_theme, chat_wallpaper, chat_wallpaper_blur FROM settings WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function getProfile(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  const userRow = rows[0];
  const s = await getSettingsRow(userId);
  return rowToServerProfile(userId, userRow, s);
}

async function upsertProfile(userId, patch) {
  const now = Date.now();
  const existing = await getProfile(userId);
  const fallbackUsername = `user${String(userId || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8).padStart(8, '0')}`.slice(0, 32);
  const normalizedUsername = String(patch.username != null ? patch.username : existing?.username || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
  const finalUsername = normalizedUsername || fallbackUsername;
  const merged = {
    name: patch.name != null ? patch.name : existing?.name || '',
    avatar: patch.avatar != null ? patch.avatar : existing?.avatar || '',
    coverUrl: patch.coverUrl != null ? patch.coverUrl : existing?.coverUrl || '',
    username: finalUsername,
    statusText: patch.statusText != null ? patch.statusText : existing?.statusText || '',
    blacklist: patch.blacklist != null ? patch.blacklist : existing?.blacklist || [],
    blacklistMeta: patch.blacklistMeta != null ? patch.blacklistMeta : existing?.blacklistMeta || {},
    friendIds: patch.friendIds != null ? patch.friendIds : existing?.friendIds || [],
    online: patch.online != null ? !!patch.online : !!existing?.online,
    lastSeenAt: patch.lastSeenAt != null ? patch.lastSeenAt : existing?.lastSeenAt || 0
  };
  await pool.query(
    `INSERT INTO users (id, username, display_name, avatar_url, cover_url, password_hash, status, last_seen, blacklist_json, blacklist_meta_json, friend_ids_json, online, updated_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       cover_url = EXCLUDED.cover_url,
       status = EXCLUDED.status,
       last_seen = EXCLUDED.last_seen,
       blacklist_json = EXCLUDED.blacklist_json,
       blacklist_meta_json = EXCLUDED.blacklist_meta_json,
       friend_ids_json = EXCLUDED.friend_ids_json,
       online = EXCLUDED.online,
       updated_at = EXCLUDED.updated_at`,
    [
      userId,
      merged.username,
      merged.name,
      merged.avatar,
      merged.coverUrl,
      merged.statusText,
      merged.lastSeenAt,
      JSON.stringify(merged.blacklist),
      JSON.stringify(merged.blacklistMeta),
      JSON.stringify(merged.friendIds),
      merged.online,
      now
    ]
  );
  if (patch.privacy) {
    await upsertSettings(userId, patch.privacy);
  }
  if (patch.appearance) {
    await upsertAppearanceSettings(userId, patch.appearance);
  }
  return getProfile(userId);
}

async function isUsernameAvailable(username, excludeUserId = '') {
  const normalized = String(username || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
  if (!normalized) return { ok: true, available: true, username: '' };
  const exclude = String(excludeUserId || '').trim();
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(username) = $1 LIMIT 1',
    [normalized]
  );
  if (!rows[0]) return { ok: true, available: true, username: normalized };
  const ownerId = String(rows[0].id || '').trim();
  return {
    ok: true,
    available: !!exclude && ownerId === exclude,
    username: normalized,
    ownerId
  };
}

async function upsertSettings(userId, privacy) {
  const w = privacy.canWrite || privacy.whoCanWrite || 'all';
  const c = privacy.canCall || privacy.whoCanCall || 'all';
  const p = privacy.canViewProfile || privacy.whoCanSeeProfile || 'all';
  const s = privacy.canSeeStories || privacy.whoCanSeeStories || 'friends';
  const g = privacy.canJoinGroups || privacy.whoCanJoinGroups || 'friends';
  await pool.query(
    `INSERT INTO settings (user_id, who_can_write, who_can_call, who_can_see_profile, who_can_see_stories, who_can_join_groups)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       who_can_write = EXCLUDED.who_can_write,
       who_can_call = EXCLUDED.who_can_call,
       who_can_see_profile = EXCLUDED.who_can_see_profile,
       who_can_see_stories = EXCLUDED.who_can_see_stories,
       who_can_join_groups = EXCLUDED.who_can_join_groups`,
    [userId, w, c, p, s, g]
  );
}

async function upsertAppearanceSettings(userId, appearance) {
  const theme = String(appearance?.theme || '').trim() === 'dark' ? 'dark' : 'classic';
  const chatWallpaper = typeof appearance?.chatWallpaper === 'string' ? String(appearance.chatWallpaper || '') : '';
  const chatWallpaperBlur = appearance?.chatWallpaperBlur !== undefined ? !!appearance.chatWallpaperBlur : true;
  await pool.query(
    `INSERT INTO settings (user_id, ui_theme, chat_wallpaper, chat_wallpaper_blur)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET
       ui_theme = EXCLUDED.ui_theme,
       chat_wallpaper = EXCLUDED.chat_wallpaper,
       chat_wallpaper_blur = EXCLUDED.chat_wallpaper_blur`,
    [userId, theme, chatWallpaper, chatWallpaperBlur]
  );
}

async function listAllUserIds() {
  const { rows } = await pool.query('SELECT id FROM users');
  return rows.map((r) => r.id);
}

function normalizeStoryPrivacy(privacy) {
  return ['all', 'friends', 'nobody'].includes(privacy) ? privacy : 'friends';
}

function normalizeGroupPermission(value, fallback = 'owner_admins') {
  const v = String(value || '').trim();
  return ['owner', 'owner_admins', 'all'].includes(v) ? v : fallback;
}

function normalizeInviteCode(value, fallback = '') {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return cleaned || fallback;
}

async function generateUniqueInviteCode(preferred = '') {
  const first = normalizeInviteCode(preferred);
  if (first) {
    const exists = await getGroupChatByInviteCode(first);
    if (!exists) return first;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `grp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    const exists = await getGroupChatByInviteCode(candidate);
    if (!exists) return candidate;
  }
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultChatMeta(kind = 'direct', ownerId = '') {
  const owner = String(ownerId || '').trim();
  const base = {
    clearedBy: {},
    removedBy: {},
    blockedBy: {},
    pinnedBy: {},
    archivedBy: {},
    mutedBy: {},
    typingBy: {}
  };
  if (kind !== 'group') return base;
  return {
    ...base,
    permissions: {
      addMembers: 'owner_admins',
      editInfo: 'owner_admins',
      moderate: 'owner_admins',
      linkAccess: 'all',
      createCalls: 'owner_admins'
    },
    ownerId: owner,
    joinByLink: true
  };
}

function normalizeChatMeta(meta, kind = 'direct', ownerId = '') {
  const src = meta && typeof meta === 'object' ? meta : {};
  const base = buildDefaultChatMeta(kind, ownerId);
  const out = {
    ...base,
    ...src,
    clearedBy: src.clearedBy && typeof src.clearedBy === 'object' ? src.clearedBy : {},
    removedBy: src.removedBy && typeof src.removedBy === 'object' ? src.removedBy : {},
    blockedBy: src.blockedBy && typeof src.blockedBy === 'object' ? src.blockedBy : {},
    pinnedBy: src.pinnedBy && typeof src.pinnedBy === 'object' ? src.pinnedBy : {},
    archivedBy: src.archivedBy && typeof src.archivedBy === 'object' ? src.archivedBy : {},
    mutedBy: src.mutedBy && typeof src.mutedBy === 'object' ? src.mutedBy : {},
    typingBy: src.typingBy && typeof src.typingBy === 'object' ? src.typingBy : {}
  };
  if (kind === 'group') {
    const perms = src.permissions && typeof src.permissions === 'object' ? src.permissions : {};
    out.permissions = {
      addMembers: normalizeGroupPermission(perms.addMembers, base.permissions.addMembers),
      editInfo: normalizeGroupPermission(perms.editInfo, base.permissions.editInfo),
      moderate: normalizeGroupPermission(perms.moderate, base.permissions.moderate),
      linkAccess: normalizeGroupPermission(perms.linkAccess, base.permissions.linkAccess),
      createCalls: normalizeGroupPermission(perms.createCalls, base.permissions.createCalls)
    };
    out.ownerId = String(src.ownerId || ownerId || '').trim();
    out.joinByLink = src.joinByLink !== false;
  }
  return out;
}

async function listGroupMembers(chatId) {
  const { rows } = await pool.query(
    `SELECT cm.chat_id, cm.user_id, cm.role, cm.joined_at, cm.invited_by, cm.settings_json,
            u.display_name, u.avatar_url, u.username, u.online, u.last_seen
     FROM chat_members cm
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE chat_id = $1
     ORDER BY cm.joined_at ASC, cm.user_id ASC`,
    [chatId]
  );
  const makeInitials = (value, fallback = '') => {
    const raw = String(value || fallback || '').trim();
    if (!raw) return '';
    const letters = raw
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return letters || raw.slice(0, 2).toUpperCase();
  };
  return rows.map((row) => ({
    chatId: row.chat_id,
    userId: row.user_id,
    role: ['owner', 'admin', 'member'].includes(String(row.role || '')) ? row.role : 'member',
    joinedAt: Number(row.joined_at) || 0,
    invitedBy: row.invited_by || '',
    settings: parseJsonCol(row.settings_json, {}),
    displayName: row.display_name || row.user_id || '',
    name: row.display_name || row.user_id || '',
    avatar: row.avatar_url || '',
    username: row.username || '',
    initials: makeInitials(row.display_name, row.user_id),
    online: !!row.online,
    lastSeenAt: Number(row.last_seen) || 0
  }));
}

async function findDirectChat(a, b) {
  const [u1, u2] = sortedPair(String(a), String(b));
  const { rows } = await pool.query(
    `SELECT id, user1_id, user2_id, last_message_id, last_message_preview, updated_at, meta_json,
            chat_kind, title, description, avatar_url, invite_code, created_by
     FROM chats
     WHERE chat_kind = 'direct' AND user1_id = $1 AND user2_id = $2
     LIMIT 1`,
    [u1, u2]
  );
  if (!rows[0]) return null;
  return rowToChat(rows[0], u1, u2);
}

async function getOrCreateChat(a, b) {
  const got = await findDirectChat(a, b);
  if (got) return got;
  const [u1, u2] = sortedPair(String(a), String(b));
  const id = directChatId(u1, u2);
  const now = Date.now();
  const meta = buildDefaultChatMeta('direct');
  await pool.query(
    `INSERT INTO chats (
       id, user1_id, user2_id, last_message_id, last_message_preview, updated_at, meta_json,
       chat_kind, title, description, avatar_url, invite_code, created_by
     ) VALUES ($1,$2,$3,NULL,NULL,$4,$5::jsonb,'direct','','','','','')`,
    [id, u1, u2, now, JSON.stringify(meta)]
  );
  return {
    id,
    kind: 'direct',
    members: [u1, u2],
    meta,
    lastMessage: null,
    updatedAt: now,
    createdAt: now,
    title: '',
    description: '',
    avatar: '',
    inviteCode: '',
    createdBy: ''
  };
}

function rowToChat(row, u1, u2) {
  const kind = String(row.chat_kind || '').trim() === 'group' ? 'group' : 'direct';
  const m = normalizeChatMeta(parseJsonCol(row.meta_json, {}), kind, row.created_by || '');
  let lastMessage = null;
  const preview = row.last_message_preview;
  if (preview && typeof preview === 'object') {
    lastMessage = preview;
  } else if (typeof preview === 'string') {
    try {
      lastMessage = JSON.parse(preview);
    } catch {
      lastMessage = null;
    }
  }
  return {
    id: row.id,
    kind,
    members: kind === 'group' ? [] : [row.user1_id || u1, row.user2_id || u2],
    createdAt: Number(row.updated_at) || Date.now(),
    meta: m,
    lastMessage,
    updatedAt: Number(row.updated_at) || 0,
    title: row.title || '',
    description: row.description || '',
    avatar: row.avatar_url || '',
    inviteCode: row.invite_code || '',
    createdBy: row.created_by || '',
    participants: []
  };
}

async function hydrateChat(chat) {
  if (!chat || chat.kind !== 'group') return chat;
  const participants = await listGroupMembers(chat.id);
  return {
    ...chat,
    members: participants.map((item) => item.userId),
    participants
  };
}

async function createGroupChat(input) {
  const ownerId = String(input?.ownerId || '').trim();
  if (!ownerId) return null;
  const title = String(input?.title || '').trim().slice(0, 220);
  if (!title) return null;
  const description = String(input?.description || '').trim().slice(0, 4000);
  const avatar = String(input?.avatar || '').trim();
  const inviteCode = await generateUniqueInviteCode(input?.inviteCode || '');
  const memberIds = Array.from(
    new Set(
      [ownerId, ...(Array.isArray(input?.memberIds) ? input.memberIds : [])]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )
  );
  const id = `grp:${inviteCode}`;
  const now = Date.now();
  const meta = normalizeChatMeta(input?.meta || {}, 'group', ownerId);
  await pool.query(
    `INSERT INTO chats (
       id, user1_id, user2_id, last_message_id, last_message_preview, updated_at, meta_json,
       chat_kind, title, description, avatar_url, invite_code, created_by
     )
     VALUES ($1,$2,$3,NULL,NULL,$4,$5::jsonb,'group',$6,$7,$8,$9,$10)`,
    [id, ownerId, ownerId, now, JSON.stringify(meta), title, description, avatar, inviteCode, ownerId]
  );
  for (const uid of memberIds) {
    await pool.query(
      `INSERT INTO chat_members (chat_id, user_id, role, joined_at, invited_by, settings_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, uid, uid === ownerId ? 'owner' : 'member', now, ownerId, JSON.stringify({})]
    );
  }
  const raw = await getChatById(id);
  return raw;
}

async function updateChatMeta(chatId, meta) {
  await pool.query('UPDATE chats SET meta_json = $1::jsonb, updated_at = $2 WHERE id = $3', [
    JSON.stringify(meta),
    Date.now(),
    chatId
  ]);
}

async function updateLastMessagePreview(chatId, lastMessageObj, updatedAt) {
  const lm = lastMessageObj == null ? null : JSON.stringify(lastMessageObj);
  const mid = lastMessageObj && lastMessageObj.id ? lastMessageObj.id : null;
  await pool.query(
    'UPDATE chats SET last_message_preview = $1::jsonb, last_message_id = $2, updated_at = $3 WHERE id = $4',
    [lm, mid, updatedAt, chatId]
  );
}

function rowToMessage(row) {
  const dbType = row.type;
  const isVoice = dbType === 'audio';
  const isImage = dbType === 'image';
  const isVideoNote = dbType === 'video_note';
  const isVideo = dbType === 'video';
  const createdAt = Number(row.created_at) || 0;
  const forwardedPreview =
    row.forwarded_preview && typeof row.forwarded_preview === 'object' ? row.forwarded_preview : {};
  const reactions =
    row.reactions_json && typeof row.reactions_json === 'object' ? row.reactions_json : {};
  const base = {
    id: row.id,
    chatId: row.chat_id,
    fromId: row.sender_id,
    toId: row.recipient_id,
    createdAt,
    text: row.text || '',
    messageKind: dbType === 'system' ? 'system' : isVoice ? 'voice' : isImage ? 'image' : isVideoNote ? 'video_note' : isVideo ? 'video' : 'text',
    replyTo: row.reply_to || '',
    forwardedFromMessageId: row.forwarded_from || '',
    forwardedPreview,
    reactions,
    editedAt: Number(row.edited_at) || 0,
    deletedAt: Number(row.deleted_at) || 0,
    mimeType: '',
    deliveredBy: Array.isArray(row.delivered_by) ? row.delivered_by : [],
    readBy: Array.isArray(row.read_by) ? row.read_by : []
  };
  // Медиа хранится как файл на диске (URL) — отдаём fileUrl.
  // Старые сообщения с base64 в file_url — отдаём в легаси-полях audio/image/videoBase64.
  const rawFileUrl = row.file_url || '';
  const isFileUrl = /^https?:\/\//i.test(rawFileUrl) || rawFileUrl.startsWith('/upload/');
  if (isFileUrl) {
    base.fileUrl = rawFileUrl;
  }
  if (isVoice) {
    base.audioBase64 = isFileUrl ? '' : rawFileUrl;
    base.audioMime = row.audio_mime || 'audio/webm';
    base.durationMs = Number(row.duration_ms) || 0;
  } else {
    base.audioMime = '';
    base.audioBase64 = '';
    base.durationMs = isVideoNote ? Number(row.duration_ms) || 0 : 0;
  }
  if (isImage) {
    base.imageBase64 = isFileUrl ? '' : rawFileUrl;
    base.mimeType = row.image_mime || 'image/jpeg';
  }
  if (isVideo || isVideoNote) {
    base.videoBase64 = isFileUrl ? '' : rawFileUrl;
    base.videoMime = row.audio_mime || 'video/mp4';
  }
  return base;
}

async function insertMessage(msg) {
  const mk = msg.messageKind || msg.kind;
  const isVoice = mk === 'voice' || mk === 'audio';
  const isImage = mk === 'image';
  const isVideoNote = mk === 'video_note';
  const isVideo = mk === 'video';
  const isSystem = mk === 'system';
  const type = isSystem ? 'system' : isVoice ? 'audio' : isImage ? 'image' : isVideoNote ? 'video_note' : isVideo ? 'video' : 'text';
  // Приоритет: готовый URL файла (медиа хранится на диске). Если пришёл base64 (легаси), сохраняем как есть.
  const fileUrl = typeof msg.fileUrl === 'string' && msg.fileUrl
    ? msg.fileUrl
    : isVoice
      ? msg.audioBase64 || ''
      : isImage
        ? msg.imageBase64 || ''
        : isVideo || isVideoNote
          ? msg.videoBase64 || ''
          : '';
  const mimeCol = isVoice ? msg.audioMime || '' : isVideo || isVideoNote ? msg.videoMime || 'video/mp4' : '';
  const imageMimeCol = isImage ? msg.mimeType || msg.imageMime || 'image/jpeg' : '';
  const createdAt = Number(msg.createdAt || msg.at || Date.now());
  const deliveredBy = Array.isArray(msg.deliveredBy) ? msg.deliveredBy.map(String) : [];
  const readBy = Array.isArray(msg.readBy) ? msg.readBy.map(String) : [];
  const forwardedPreview = msg.forwardedPreview && typeof msg.forwardedPreview === 'object' ? msg.forwardedPreview : {};
  const reactions = msg.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
  await pool.query(
    `INSERT INTO messages (id, chat_id, sender_id, recipient_id, text, type, file_url, duration_ms, audio_mime, image_mime, reply_to, forwarded_from, forwarded_preview, reactions_json, delivered_by, read_by, created_at, edited_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19)`,
    [
      msg.id,
      msg.chatId,
      msg.fromId,
      msg.toId,
      msg.text || '',
      type,
      fileUrl,
      msg.durationMs || 0,
      mimeCol,
      imageMimeCol,
      msg.replyTo || '',
      msg.forwardedFromMessageId || msg.forwardedFrom || '',
      JSON.stringify(forwardedPreview),
      JSON.stringify(reactions),
      JSON.stringify(deliveredBy),
      JSON.stringify(readBy),
      createdAt,
      msg.editedAt || 0,
      msg.deletedAt || 0
    ]
  );
}

async function getLatestMessageInChatAfter(chatId, clearedAfterTs = 0) {
  const t = Math.max(0, Number(clearedAfterTs) || 0);
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE chat_id = $1 AND deleted_at = 0 AND created_at >= $2 ORDER BY created_at DESC LIMIT 1',
    [chatId, t]
  );
  return rows[0] ? rowToMessage(rows[0]) : null;
}

async function listMessagesForChat(chatId, clearedAfterTs = 0, limit = 500) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const cleared = Math.max(0, Number(clearedAfterTs) || 0);
  const { rows } = await pool.query(
    `SELECT * FROM messages WHERE chat_id = $1 AND deleted_at = 0 AND created_at >= $2 ORDER BY created_at ASC LIMIT $3`,
    [chatId, cleared, lim]
  );
  return rows.map(rowToMessage);
}

async function getMessageById(id) {
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ? rowToMessage(rows[0]) : null;
}

async function deleteMessageByIdHard(id) {
  await pool.query('DELETE FROM messages WHERE id = $1', [id]);
}

async function addMessageReadBy(messageId, readerUserId) {
  const mid = String(messageId || '').trim();
  const rid = String(readerUserId || '').trim();
  if (!mid || !rid) return false;
  const { rows } = await pool.query('SELECT read_by FROM messages WHERE id = $1 LIMIT 1', [mid]);
  const prev = rows[0] && Array.isArray(rows[0].read_by) ? rows[0].read_by : [];
  const already = prev.some((x) => String(x) === rid);
  if (already) return false;
  const next = [...prev.map(String), rid];
  await pool.query('UPDATE messages SET read_by = $1::jsonb WHERE id = $2', [JSON.stringify(next), mid]);
  return true;
}

async function updateMessageFields(id, patch) {
  const sets = [];
  const vals = [];
  let n = 1;
  if (patch.text !== undefined) {
    sets.push(`text = $${n++}`);
    vals.push(patch.text);
  }
  if (patch.forwardedPreview !== undefined) {
    sets.push(`forwarded_preview = $${n++}::jsonb`);
    vals.push(JSON.stringify(patch.forwardedPreview || {}));
  }
  if (patch.reactions !== undefined) {
    sets.push(`reactions_json = $${n++}::jsonb`);
    vals.push(JSON.stringify(patch.reactions || {}));
  }
  if (patch.editedAt !== undefined) {
    sets.push(`edited_at = $${n++}`);
    vals.push(patch.editedAt);
  }
  if (patch.deletedAt !== undefined) {
    sets.push(`deleted_at = $${n++}`);
    vals.push(patch.deletedAt);
  }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${n}`, vals);
}

async function getChatById(chatId) {
  const { rows } = await pool.query(
    `SELECT id, user1_id, user2_id, last_message_id, last_message_preview, updated_at, meta_json,
            chat_kind, title, description, avatar_url, invite_code, created_by
     FROM chats
     WHERE id = $1
     LIMIT 1`,
    [chatId]
  );
  if (!rows[0]) return null;
  return hydrateChat(rowToChat(rows[0]));
}

async function getGroupChatByInviteCode(inviteCode) {
  const code = normalizeInviteCode(inviteCode);
  if (!code) return null;
  const { rows } = await pool.query(
    `SELECT id, user1_id, user2_id, last_message_id, last_message_preview, updated_at, meta_json,
            chat_kind, title, description, avatar_url, invite_code, created_by
     FROM chats
     WHERE chat_kind = 'group' AND invite_code = $1
     LIMIT 1`,
    [code]
  );
  if (!rows[0]) return null;
  return hydrateChat(rowToChat(rows[0]));
}

async function loadChatMeta(chatId) {
  const ch = await getChatById(chatId);
  return ch?.meta || null;
}

async function listChatsForUser(userId) {
  const uid = String(userId);
  const { rows } = await pool.query(
    `SELECT DISTINCT c.id, c.user1_id, c.user2_id, c.last_message_id, c.last_message_preview, c.updated_at, c.meta_json,
            c.chat_kind, c.title, c.description, c.avatar_url, c.invite_code, c.created_by
     FROM chats c
     LEFT JOIN chat_members cm ON cm.chat_id = c.id
     WHERE (c.chat_kind = 'direct' AND (c.user1_id = $1 OR c.user2_id = $1))
        OR (c.chat_kind = 'group' AND cm.user_id = $1)
     ORDER BY c.updated_at DESC`,
    [uid]
  );
  const out = [];
  for (const row of rows) {
    out.push(await hydrateChat(rowToChat(row)));
  }
  return out;
}

async function deleteChatRow(chatId) {
  await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
  await pool.query('DELETE FROM chat_members WHERE chat_id = $1', [chatId]);
  await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
}

async function touchChatUpdatedAt(chatId, updatedAt = Date.now()) {
  await pool.query('UPDATE chats SET updated_at = $1 WHERE id = $2', [Number(updatedAt) || Date.now(), chatId]);
}

async function updateGroupChatInfo(chatId, patch = {}) {
  const sets = [];
  const vals = [];
  let n = 1;
  if (patch.title !== undefined) {
    sets.push(`title = $${n++}`);
    vals.push(String(patch.title || '').trim().slice(0, 220));
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${n++}`);
    vals.push(String(patch.description || '').trim().slice(0, 4000));
  }
  if (patch.avatar !== undefined) {
    sets.push(`avatar_url = $${n++}`);
    vals.push(String(patch.avatar || '').trim());
  }
  if (patch.inviteCode !== undefined) {
    sets.push(`invite_code = $${n++}`);
    vals.push(normalizeInviteCode(patch.inviteCode));
  }
  if (!sets.length) return getChatById(chatId);
  sets.push(`updated_at = $${n++}`);
  vals.push(Date.now());
  vals.push(chatId);
  await pool.query(`UPDATE chats SET ${sets.join(', ')} WHERE id = $${n}`, vals);
  return getChatById(chatId);
}

async function addGroupMember(chatId, userId, role = 'member', invitedBy = '') {
  const safeRole = ['owner', 'admin', 'member'].includes(String(role || '')) ? String(role) : 'member';
  const now = Date.now();
  await pool.query(
    `INSERT INTO chat_members (chat_id, user_id, role, joined_at, invited_by, settings_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       role = EXCLUDED.role,
       invited_by = EXCLUDED.invited_by`,
    [chatId, String(userId || '').trim(), safeRole, now, String(invitedBy || '').trim(), JSON.stringify({})]
  );
  await touchChatUpdatedAt(chatId, now);
  return getChatById(chatId);
}

async function setGroupMemberRole(chatId, userId, role) {
  const safeRole = ['owner', 'admin', 'member'].includes(String(role || '')) ? String(role) : 'member';
  await pool.query(
    'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
    [safeRole, chatId, String(userId || '').trim()]
  );
  await touchChatUpdatedAt(chatId);
  return getChatById(chatId);
}

async function removeGroupMember(chatId, userId) {
  await pool.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, String(userId || '').trim()]);
  await touchChatUpdatedAt(chatId);
  return getChatById(chatId);
}

async function setUserOnlineFlags(userId, online) {
  const now = Date.now();
  await pool.query(
    'UPDATE users SET online = $1, last_seen = $2, updated_at = $3 WHERE id = $4',
    [online, now, now, userId]
  );
}

// Story-related functions
async function createStory(story) {
  const now = Date.now();
  const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours
  const privacy = normalizeStoryPrivacy(story.privacy);
  
  await pool.query(
    `INSERT INTO stories (id, user_id, video_url, video_mime, duration_ms, thumbnail_url, caption, created_at, expires_at, privacy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      story.id,
      story.userId,
      story.videoUrl,
      story.videoMime || 'video/mp4',
      story.durationMs || 0,
      story.thumbnailUrl || '',
      story.caption || '',
      now,
      expiresAt,
      privacy
    ]
  );
  return getStoryById(story.id);
}

async function getStoryById(storyId) {
  const { rows } = await pool.query('SELECT * FROM stories WHERE id = $1 LIMIT 1', [storyId]);
  return rows[0] ? rowToStory(rows[0]) : null;
}

async function getStoriesForUser(userId, viewerId = null) {
  const now = Date.now();
  const { rows } = await pool.query(
    `SELECT * FROM stories WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at ASC`,
    [userId, now]
  );
  
  const owner = await getProfile(userId);
  const stories = rows.map(row => ({
    ...rowToStory(row),
    userDisplayName: owner?.displayName || owner?.name || userId,
    userAvatar: owner?.avatar || '',
    userInitials: owner?.initials || ''
  }));
  
  // Filter by privacy if viewer is specified
  if (viewerId && viewerId !== userId) {
    const userFriends = await getUserFriends(userId);
    const isFriend = userFriends.includes(viewerId);
    const storiesPolicy = owner?.privacy?.canSeeStories || 'friends';

    if (storiesPolicy === 'nobody') return [];
    if (storiesPolicy === 'friends' && !isFriend) return [];
    
    return stories.filter(story => {
      const storyPrivacy = normalizeStoryPrivacy(story.privacy);
      if (storyPrivacy === 'nobody') return false;
      if (storyPrivacy === 'all') return true;
      if (storyPrivacy === 'friends') return isFriend;
      return false; // Default to friends if privacy is not set
    });
  }
  
  return stories;
}

async function getUserFriends(userId) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const { rows } = await pool.query(
    'SELECT user_a, user_b FROM friendships WHERE user_a = $1 OR user_b = $1',
    [id]
  );
  const dbFriends = rows.map((r) => (r.user_a === id ? r.user_b : r.user_a));
  const profile = await getProfile(id);
  const legacy = profile?.friendIds || [];
  return [...new Set([...dbFriends, ...legacy.map(String)])];
}

// ===== Друзья: доступ для Node (server.js) =====

async function isFriendshipPair(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y || x === y) return false;
  const key = sortedPair(x, y).join('::');
  const { rows } = await pool.query('SELECT 1 FROM friendships WHERE pair_key = $1 LIMIT 1', [key]);
  return rows.length > 0;
}

async function listFriendshipPairs() {
  const { rows } = await pool.query('SELECT user_a, user_b FROM friendships');
  return rows.map((r) => [r.user_a, r.user_b]);
}

async function listFriendsUserRows() {
  const { rows } = await pool.query(
    `SELECT id, display_name, avatar_url, username, external_key, active_tab, presence_updated_at, last_seen
     FROM users`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.display_name || '',
    avatar: r.avatar_url || '',
    username: r.username || '',
    externalKey: r.external_key || '',
    activeTab: !!r.active_tab,
    presenceUpdatedAt: Number(r.presence_updated_at) || 0,
    lastSeen: Number(r.last_seen) || 0
  }));
}

async function addStoryView(storyId, viewerId) {
  const now = Date.now();
  await pool.query(
    `INSERT INTO story_views (story_id, viewer_id, viewed_at) 
     VALUES ($1,$2,$3) 
     ON CONFLICT (story_id, viewer_id) DO NOTHING`,
    [storyId, viewerId, now]
  );
}

async function addStoryComment(storyId, viewerId, commentText) {
  const now = Date.now();
  await pool.query(
    `INSERT INTO story_views (story_id, viewer_id, viewed_at, comment_text, commented_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (story_id, viewer_id) DO UPDATE
     SET comment_text = EXCLUDED.comment_text,
         commented_at = EXCLUDED.commented_at`,
    [storyId, viewerId, now, commentText || '', now]
  );
}

async function toggleStoryLike(storyId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM story_likes WHERE story_id = $1 AND user_id = $2',
    [storyId, userId]
  );
  
  if (rows[0]) {
    // Unlike
    await pool.query(
      'DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2',
      [storyId, userId]
    );
    return { liked: false };
  } else {
    // Like
    const now = Date.now();
    await pool.query(
      'INSERT INTO story_likes (story_id, user_id, liked_at) VALUES ($1,$2,$3)',
      [storyId, userId, now]
    );
    return { liked: true };
  }
}

async function checkStoryLike(storyId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM story_likes WHERE story_id = $1 AND user_id = $2',
    [storyId, userId]
  );
  
  return { liked: !!rows[0] };
}

async function updateStoryPrivacy(storyId, userId, privacy) {
  const nextPrivacy = normalizeStoryPrivacy(privacy);
  const { rows } = await pool.query(
    'UPDATE stories SET privacy = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
    [nextPrivacy, storyId, userId]
  );
  
  return rows.length > 0;
}

async function getStoryViews(storyId) {
  const { rows } = await pool.query(
    `SELECT sv.viewer_id, sv.viewed_at, sv.comment_text, sv.commented_at, u.display_name, u.avatar_url, u.username
     FROM story_views sv
     LEFT JOIN users u ON sv.viewer_id = u.id
     WHERE sv.story_id = $1
     ORDER BY sv.viewed_at DESC`,
    [storyId]
  );
  
  const { rows: likeRows } = await pool.query(
    `SELECT sl.user_id FROM story_likes sl WHERE sl.story_id = $1`,
    [storyId]
  );
  
  const likedUserIds = new Set(likeRows.map(r => r.user_id));
  
  return rows.map(row => ({
    userId: row.viewer_id,
    viewedAt: Number(row.viewed_at),
    displayName: row.display_name || row.viewer_id,
    avatar: row.avatar_url || '',
    username: row.username || '',
    liked: likedUserIds.has(row.viewer_id),
    comment: row.comment_text || '',
    commentedAt: Number(row.commented_at) || 0
  }));
}

async function deleteStory(storyId, userId) {
  const story = await getStoryById(storyId);
  if (!story || story.userId !== userId) return false;
  
  await pool.query('DELETE FROM stories WHERE id = $1 AND user_id = $2', [storyId, userId]);
  await pool.query('DELETE FROM story_views WHERE story_id = $1', [storyId]);
  await pool.query('DELETE FROM story_likes WHERE story_id = $1', [storyId]);
  return true;
}

async function cleanupExpiredStories() {
  const now = Date.now();
  const { rows } = await pool.query(
    'SELECT id FROM stories WHERE expires_at <= $1',
    [now]
  );
  
  for (const row of rows) {
    await pool.query('DELETE FROM story_views WHERE story_id = $1', [row.id]);
    await pool.query('DELETE FROM story_likes WHERE story_id = $1', [row.id]);
  }
  
  await pool.query('DELETE FROM stories WHERE expires_at <= $1', [now]);
  return rows.length;
}

async function getActiveStoriesCount(userId) {
  const now = Date.now();
  const { rows } = await pool.query(
    'SELECT COUNT(*) as count FROM stories WHERE user_id = $1 AND expires_at > $2',
    [userId, now]
  );
  return Number(rows[0].count) || 0;
}

function rowToStory(row) {
  return {
    id: row.id,
    userId: row.user_id,
    videoUrl: row.video_url,
    videoMime: row.video_mime || 'video/mp4',
    durationMs: Number(row.duration_ms) || 0,
    thumbnailUrl: row.thumbnail_url || '',
    caption: row.caption || '',
    createdAt: Number(row.created_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
    privacy: normalizeStoryPrivacy(row.privacy)
  };
}

async function getChatScroll(userId, chatId) {
  if (!userId || !chatId) return null;
  try {
    const { rows } = await pool.query('SELECT msg_id, offset_px FROM chat_scrolls WHERE user_id = $1 AND chat_id = $2 LIMIT 1', [userId, chatId]);
    const r = rows && rows[0];
    if (!r || !r.msg_id) return null;
    return { msgId: r.msg_id, offset: Number(r.offset_px) || 0 };
  } catch (_) {
    return null;
  }
}

async function saveChatScroll(userId, chatId, msgId, offset) {
  if (!userId || !chatId) return;
  try {
    await pool.query(
      `INSERT INTO chat_scrolls (user_id, chat_id, msg_id, offset_px, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, chat_id)
       DO UPDATE SET msg_id = EXCLUDED.msg_id, offset_px = EXCLUDED.offset_px, updated_at = EXCLUDED.updated_at`,
      [userId, chatId, String(msgId || '').slice(0, 100), Number(offset) || 0, Date.now()]
    );
  } catch (_) {}
}

const initMessengerMysql = initMessengerPostgres;

module.exports = {
  initMessengerPostgres,
  initMessengerMysql,
  isEnabled,
  query,
  getProfile,
  upsertProfile,
  isUsernameAvailable,
  upsertSettings,
  listAllUserIds,
  findDirectChat,
  getOrCreateChat,
  createGroupChat,
  listGroupMembers,
  getChatById,
  getGroupChatByInviteCode,
  loadChatMeta,
  updateChatMeta,
  updateGroupChatInfo,
  addGroupMember,
  setGroupMemberRole,
  removeGroupMember,
  updateLastMessagePreview,
  touchChatUpdatedAt,
  insertMessage,
  listMessagesForChat,
  getLatestMessageInChatAfter,
  getMessageById,
  deleteMessageByIdHard,
  updateMessageFields,
  listChatsForUser,
  deleteChatRow,
  setUserOnlineFlags,
  directChatId,
  addMessageReadBy,
  // Story functions
  createStory,
  getStoryById,
  getStoriesForUser,
  addStoryView,
  addStoryComment,
  toggleStoryLike,
  checkStoryLike,
  updateStoryPrivacy,
  getStoryViews,
  deleteStory,
  cleanupExpiredStories,
  getActiveStoriesCount,
  getUserFriends,
  isFriendshipPair,
  listFriendshipPairs,
  listFriendsUserRows,
  getChatScroll,
  saveChatScroll
};
