const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');
const mediaStore = require('./media_store');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
];

// ВАЖНО: для Render нужно слушать на 0.0.0.0, а не на 127.0.0.1
// maxPayload ограничивает размер одного сообщения WebSocket (в байтах).
// Медиа-сообщения кладутся в JSON (base64), поэтому лимит должен быть существенно выше.
// Голос в звонке идёт по WebRTC (SRTP между браузерами); WebSocket — сигналинг и чат, не «труба» для RTP-аудио.
const MEDIA_UPLOAD_DIR = mediaStore.LOCAL_DIR;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || `http://localhost:${PORT}`;
const S3_ENABLED = mediaStore.init();
if (S3_ENABLED) {
    console.log(`[media] S3 storage enabled (bucket: ${process.env.S3_BUCKET || ''})`);
} else {
    console.log('[media] S3 not configured, media stored on local disk');
}

// Медиа (фото/видео/голос) сохраняются файлами в MEDIA_UPLOAD_DIR, в БД — URL.
// HTTP-сервер раздаёт /upload/* с поддержкой Range (нужно для аудио/видео).
const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ server: httpServer, perMessageDeflate: false, maxPayload: 120 * 1024 * 1024 });
httpServer.listen(PORT, '0.0.0.0');

const MEDIA_MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
    '.bin': 'application/octet-stream'
};
const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/aac': 'aac',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv'
};

function writeLocalMedia(name, buf) {
    mediaStore.ensureLocalDir();
    fs.writeFileSync(path.join(mediaStore.LOCAL_DIR, name), buf);
}

async function saveMediaBuffer(buf, mime) {
    const mimeKey = String(mime || '').toLowerCase().split(';')[0].trim();
    const ext = MIME_EXT[mimeKey] || 'bin';
    const name = `${Date.now()}_${uuidv4().replace(/-/g, '')}.${ext}`;
    if (mediaStore.isEnabled()) {
        try {
            await mediaStore.putObject(name, buf, mimeKey || 'application/octet-stream');
        } catch (err) {
            console.error('[media] S3 put failed, falling back to local disk:', err && err.message);
            writeLocalMedia(name, buf);
        }
        return `${PUBLIC_BASE_URL}/upload/${name}`;
    }
    writeLocalMedia(name, buf);
    return `${PUBLIC_BASE_URL}/upload/${name}`;
}

async function materializeBase64(b64, mime) {
    const raw = String(b64 || '').replace(/[^a-zA-Z0-9+/=]/g, '');
    if (!raw) return '';
    return saveMediaBuffer(Buffer.from(raw, 'base64'), mime);
}

async function materializeDataUrl(dataUrl, fallbackMime = '') {
    const raw = String(dataUrl || '').trim();
    if (/^https?:\/\//i.test(raw)) return { url: raw };
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
    if (!m) return null;
    const mime = (m[1] || fallbackMime || 'application/octet-stream').toLowerCase();
    const body = m[3] || '';
    let buf;
    if (m[2]) {
        buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
    } else {
        buf = Buffer.from(decodeURIComponent(body), 'binary');
    }
    if (!buf.length) return null;
    return { url: await saveMediaBuffer(buf, mime), mime };
}

async function handleHttpRequest(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    let url = '/';
    try {
        url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (_) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    if (url === '/friends' || url === '/auth') {
        if (method !== 'POST') {
            res.writeHead(405);
            res.end('Method Not Allowed');
            return;
        }
        const rawBody = await new Promise((resolve) => {
            let raw = '';
            req.on('data', (chunk) => {
                raw += chunk;
                if (raw.length > 1024 * 1024) {
                    req.destroy();
                    resolve(null);
                }
            });
            req.on('end', () => resolve(raw));
            req.on('error', () => resolve(null));
        });
        let body = {};
        if (rawBody) {
            try {
                body = JSON.parse(rawBody);
            } catch (_) {
                body = {};
            }
        }
        if (url === '/auth') {
            const result = await authApi.handle(body, { ip: req.socket && req.socket.remoteAddress });
            res.writeHead(result.status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result.json || {}));
            return;
        }
        const result = await friendsApi.handle(body);
        res.writeHead(result.status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.json || {}));
        return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return;
    }
    if (url === '/' || url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Seych backend is running');
        return;
    }
    if (!url.startsWith('/upload/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
    }
    const rel = url.slice('/upload/'.length);
    if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }
    const ext = path.extname(rel).toLowerCase();
    const mime = MEDIA_MIME[ext] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/i.exec(String(req.headers.range || ''));

    if (mediaStore.isEnabled()) {
        try {
            const s = await mediaStore.statObject(rel);
            if (s && s.size > 0) {
                const total = s.size;
                if (range) {
                    let start = range[1] === '' ? null : parseInt(range[1], 10);
                    let end = range[2] === '' ? null : parseInt(range[2], 10);
                    if (start === null) {
                        if (end === null) { start = 0; end = total - 1; }
                        else { start = Math.max(0, total - end); end = total - 1; }
                    } else {
                        if (end === null || end >= total) end = total - 1;
                    }
                    if (start > end || start >= total) {
                        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
                        res.end();
                        return;
                    }
                    const stream = await mediaStore.getObjectStream(rel, start, end);
                    stream.on('error', () => res.destroy());
                    res.writeHead(206, {
                        'Content-Type': mime,
                        'Content-Length': end - start + 1,
                        'Content-Range': `bytes ${start}-${end}/${total}`,
                        'Accept-Ranges': 'bytes',
                        'Cache-Control': 'public, max-age=31536000, immutable'
                    });
                    stream.pipe(res);
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': mime,
                    'Content-Length': total,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=31536000, immutable'
                });
                if (method === 'HEAD') { res.end(); return; }
                const stream = await mediaStore.getObjectStream(rel);
                stream.on('error', () => res.destroy());
                stream.pipe(res);
                return;
            }
        } catch (err) {
            if (!mediaStore.isMissingS3Error(err)) {
                console.error('[media] S3 read failed, falling back to local disk:', err && err.message);
            }
        }
    }

    const filePath = path.join(MEDIA_UPLOAD_DIR, rel);
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (_) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    if (!stat.isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    const total = stat.size;
    if (range) {
        let start = range[1] === '' ? null : parseInt(range[1], 10);
        let end = range[2] === '' ? null : parseInt(range[2], 10);
        if (start === null) {
            if (end === null) { start = 0; end = total - 1; }
            else { start = Math.max(0, total - end); end = total - 1; }
        } else {
            if (end === null || end >= total) end = total - 1;
        }
        if (start > end || start >= total) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}` });
            res.end();
            return;
        }
        res.writeHead(206, {
            'Content-Type': mime,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable'
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
    });
    if (method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
}
const rooms = new Map();
const userSessions = new Map();
const groupCallRoomsByChatId = new Map();
const groupCallMetaByChatId = new Map();
// Долгая пауза: кратковременный обрыв WebSocket (прокси, сон вкладки) не должен «выкидывать» из комнаты.
const _reconnectGraceParsed = parseInt(process.env.RECONNECT_GRACE_MS || '', 10);
const RECONNECT_GRACE_MS = Number.isFinite(_reconnectGraceParsed) && _reconnectGraceParsed > 0
    ? _reconnectGraceParsed
    : 24 * 60 * 60 * 1000;
const EMPTY_ROOM_GRACE_MS = process.env.EMPTY_ROOM_GRACE_MS ? parseInt(process.env.EMPTY_ROOM_GRACE_MS, 10) : 10 * 60 * 1000;
const pendingDisconnects = new Map();
const emptyRoomCleanupTimers = new Map();
const messengerMysql = require('./messenger_pg');
const durakEngine = require('./durak_engine');
const friendsApi = require('./friends_api');
const authApi = require('./auth_api');
// Для медиа-сообщений ограничиваем длину base64-строки на сервере.
// Ориентир: 50MB файл => ~67MB base64 символов.
const MAX_MEDIA_B64_LEN = Number(process.env.MAX_MEDIA_B64_LEN || '75000000');
const mysqlBoot = messengerMysql.initMessengerMysql().then((ok) => {
    console.log('[messenger] storage backend:', ok ? 'postgres' : 'unavailable');
    const e = (k) => (process.env[k] != null && String(process.env[k]).trim() !== '' ? String(process.env[k]).trim() : '');
    const needDb = !!e('DATABASE_URL');
    const exitOnFail = e('MESSENGER_MYSQL_EXIT_ON_FAIL') === '1';
    if (!ok && needDb && exitOnFail) {
        process.exit(1);
    }
    return ok;
}).catch((err) => {
    const e = (k) => (process.env[k] != null && String(process.env[k]).trim() !== '' ? String(process.env[k]).trim() : '');
    const needDb = !!e('DATABASE_URL');
    if (needDb && e('MESSENGER_MYSQL_EXIT_ON_FAIL') === '1') process.exit(1);
    return false;
});
/** @type {Map<string, object>} */
const messengerProfileMem = new Map();

// ===== Кэш друзей (данные в PostgreSQL; изменения приходят через friends_api.php) =====
const friendsPairCache = new Set();
const friendsUserCache = new Map();

async function refreshFriendsCache() {
    try {
        await mysqlBoot;
    } catch (_) {}
    if (!messengerMysql.isEnabled()) return;
    try {
        const [pairs, users] = await Promise.all([
            messengerMysql.listFriendshipPairs(),
            messengerMysql.listFriendsUserRows()
        ]);
        friendsPairCache.clear();
        for (const pair of pairs || []) {
            const a = normalizeAccountId(pair && pair[0]);
            const b = normalizeAccountId(pair && pair[1]);
            if (a && b) friendsPairCache.add([a, b].sort().join('::'));
        }
        friendsUserCache.clear();
        for (const u of users || []) {
            if (u && u.id) friendsUserCache.set(u.id, u);
        }
    } catch (err) {
        console.error('[friends] refresh cache failed:', err && err.message ? err.message : err);
    }
}

mysqlBoot.then((ok) => {
    if (ok) {
        void refreshFriendsCache();
        friendsApi.init();
        authApi.initAuth();
        if (friendsApi.isEnabled()) {
            console.log('[friends] Node friends API enabled at POST /friends');
        } else {
            console.warn('[friends] Node friends API disabled (PostgreSQL unavailable)');
        }
        console.log('[auth] account API enabled at POST /auth');
    }
}).catch(() => {});

setInterval(() => { void refreshFriendsCache(); }, 20000);

console.log(`✅ WebSocket server running on ws://0.0.0.0:${PORT}`);

const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS || '30000') || 30000;
setInterval(() => {
    try {
        wss.clients.forEach((ws) => {
            if (!ws) return;
            if (ws.isAlive === false) {
                try { ws.terminate(); } catch (_) {}
                return;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch (_) {}
        });
    } catch (_) {}
}, Math.max(8000, WS_HEARTBEAT_MS));

// Health check сервер - тоже слушаем на 0.0.0.0
const healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('WebSocket server is running');
});

// Используем другой порт для health check
const HEALTH_PORT = parseInt(PORT) + 1;
healthServer.listen(HEALTH_PORT, '0.0.0.0', () => console.log(`✅ Health check on http://0.0.0.0:${HEALTH_PORT}`));

function safeSend(ws, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(payload));
    } catch (_) {}
}

function ensureJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
            return;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'undefined' || parsed === null) {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
        }
    } catch (_) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
        } catch (_) {}
    }
}

console.log('[messenger] friends stored in PostgreSQL');

function normalizeAccountId(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function normalizeUsername(value) {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .replace(/^@+/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 32);
}

function buildGeneratedUsername(accountId) {
    const id = normalizeAccountId(accountId).toLowerCase().replace(/[^a-z0-9]/g, '');
    const suffix = (id.slice(-8) || '00000000').padStart(8, '0');
    return `user${suffix}`.slice(0, 32);
}

function normalizeText(value, max = 4000) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
}

function sanitizeSystemUserLabel(value, max = 120) {
    const raw = normalizeText(typeof value === 'string' ? value : String(value || ''), max);
    return raw.replace(/\[\[|\]\]|\|/g, '').trim().slice(0, max);
}

function makeSystemUserTag(userId, displayName) {
    const id = normalizeAccountId(userId);
    if (!id) return sanitizeSystemUserLabel(displayName || '') || 'Пользователь';
    const label = sanitizeSystemUserLabel(displayName || '') || id;
    return `[[user:${id}|${label}]]`;
}

/** Аватары часто data URL (base64) — короткий лимит ломал src и давал «мигание» в чатах. */
const MAX_AVATAR_URL_LENGTH = 750000;
const MAX_STORY_VIDEO_URL_LENGTH = 75000000;
const MAX_STORY_THUMBNAIL_URL_LENGTH = 5000000;
function normalizeAvatarUrl(value) {
    return normalizeText(typeof value === 'string' ? value : value == null ? '' : String(value), MAX_AVATAR_URL_LENGTH);
}

function createDirectChatId(a, b) {
    const pair = [normalizeAccountId(a), normalizeAccountId(b)].filter(Boolean).sort();
    if (pair.length !== 2) return '';
    return `dm:${pair[0]}::${pair[1]}`;
}

function computeUserInitials(name, accountId) {
    const n = normalizeText(name || '', 120);
    if (n) {
        const parts = n.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            const a = parts[0].charAt(0);
            const b = parts[1].charAt(0);
            return `${a}${b}`.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/gi, '') || n.slice(0, 2).toUpperCase();
        }
        return n.slice(0, 2).toUpperCase();
    }
    const id = normalizeAccountId(accountId);
    const alnum = id.replace(/[^a-zA-Z0-9]/g, '');
    if (alnum.length >= 2) return alnum.slice(0, 2).toUpperCase();
    if (id.length >= 2) return id.slice(0, 2).toUpperCase();
    return id ? id.charAt(0).toUpperCase() : '·';
}

/** Профиль для UI: PostgreSQL (messengerProfileMem) или кэш друзей как fallback имени. */
function getFormattedUser(userId) {
    const id = normalizeAccountId(userId);
    if (!id) {
        return {
            id: '',
            name: '',
            displayName: '',
            username: '',
            avatar: '',
            coverUrl: '',
            initials: '·',
            online: false,
            lastSeenAt: 0,
            statusText: ''
        };
    }
    const memRow = messengerProfileMem.get(id);
    const friends = getUserProfileFromFriendsStore(id);
    const rowChats = memRow
        ? {
              name: memRow.name,
              avatar: memRow.avatar,
              coverUrl: memRow.coverUrl || '',
              username: memRow.username,
              statusText: memRow.statusText || '',
              online: !!memRow.online,
              lastSeenAt: Number(memRow.lastSeenAt || 0)
          }
        : {};
    const name = normalizeText(rowChats.name || (friends && friends.name) || '', 120);
    const username = normalizeUsername(rowChats.username || (friends && friends.username) || '');
    const avatar = normalizeAvatarUrl(rowChats.avatar || (friends && friends.avatar) || '');
    const coverUrl = normalizeAvatarUrl(rowChats.coverUrl || '');
    const statusText = normalizeText(rowChats.statusText || '', 160);
    const online = !!rowChats.online;
    const lastSeenAt = Number(rowChats.lastSeenAt || 0);
    let displayName = name;
    if (!displayName && username) displayName = `@${username}`;
    if (!displayName) displayName = id;
    const initials = computeUserInitials(name || username, id);
    return {
        id,
        name: name || '',
        displayName,
        username,
        avatar,
        coverUrl,
        initials,
        online,
        lastSeenAt,
        statusText
    };
}

function enrichMessageWithSender(msg) {
    if (!msg || typeof msg !== 'object') return msg;
    const sid = normalizeAccountId(msg.fromId);
    if (!sid) return msg;
    const fmt = getFormattedUser(sid);
    return {
        ...msg,
        senderDisplayName: fmt.displayName,
        senderAvatar: fmt.avatar,
        senderCoverUrl: fmt.coverUrl,
        senderInitials: fmt.initials
    };
}

async function refreshChatLastPreview(chatId) {
    const cid = String(chatId || '').trim();
    if (!cid || !messengerMysql.isEnabled()) return null;
    const last = await messengerMysql.getLatestMessageInChatAfter(cid, 0);
    const preview = last
        ? {
              id: last.id,
              text: last.text,
              fromId: last.fromId,
              createdAt: last.createdAt,
              editedAt: last.editedAt || 0,
              messageKind: last.messageKind || 'text',
              audioBase64: ''
          }
        : null;
    await messengerMysql.updateLastMessagePreview(cid, preview, Date.now());
    return preview;
}

const MESSENGER_ALLOWED_REACTIONS = [
    '❤️',
    '👍',
    '👎',
    '😂',
    '😮',
    '😢',
    '😡',
    '🔥',
    '🎉',
    '👏',
    '😍',
    '🤔',
    '🙏',
    '💯',
    '😎'
];

function normalizeReactionEmoji(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return MESSENGER_ALLOWED_REACTIONS.includes(s) ? s : '';
}

function normalizeReactionsObject(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    for (const [emoji, users] of Object.entries(value)) {
        const e = normalizeReactionEmoji(emoji);
        if (!e) continue;
        const arr = Array.isArray(users) ? users.map((x) => normalizeAccountId(x)).filter(Boolean) : [];
        const uniq = Array.from(new Set(arr));
        if (uniq.length) out[e] = uniq;
    }
    return out;
}

async function upsertUserPresenceProfileMysql(appUserId, profile, options = {}) {
    const userId = normalizeAccountId(appUserId);
    if (!userId) return;

    const existingFromDb = await messengerMysql.getProfile(userId);
    const isNewUser = !existingFromDb;
    const canOverwriteIdentity = isNewUser || options.overwriteExistingIdentity !== false;
    const canOverwritePrivacy = isNewUser || options.overwriteExistingPrivacy !== false;

    const prev =
        messengerProfileMem.get(userId) ||
        existingFromDb ||
        {
            id: userId,
            name: '',
            avatar: '',
            coverUrl: '',
            username: '',
            statusText: '',
            online: false,
            lastSeenAt: 0,
            privacy: { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' },
            appearance: { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true },
            blacklist: [],
            blacklistMeta: {},
            friendIds: []
        };

    const prevAppearance =
        prev && typeof prev.appearance === 'object' && prev.appearance
            ? prev.appearance
            : { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true };
    const appearancePatch =
        profile && typeof profile.appearance === 'object' && profile.appearance
            ? profile.appearance
            : null;
    const nextAppearance = appearancePatch
        ? {
              theme: String(appearancePatch.theme || prevAppearance.theme || 'classic').trim() === 'dark' ? 'dark' : 'classic',
              chatWallpaper: typeof appearancePatch.chatWallpaper === 'string' ? String(appearancePatch.chatWallpaper || '').trim() : String(prevAppearance.chatWallpaper || '').trim(),
              chatWallpaperBlur: appearancePatch.chatWallpaperBlur !== undefined ? !!appearancePatch.chatWallpaperBlur : (prevAppearance.chatWallpaperBlur !== false)
          }
        : prevAppearance;

    const next = {
        name: canOverwriteIdentity && profile?.name != null ? normalizeText(String(profile.name), 120) : prev.name,
        avatar: canOverwriteIdentity && profile?.avatar != null ? normalizeAvatarUrl(profile.avatar) : prev.avatar,
        coverUrl: canOverwriteIdentity && profile?.coverUrl != null ? normalizeAvatarUrl(profile.coverUrl) : (prev.coverUrl || ''),
        username: canOverwriteIdentity && profile?.username != null ? normalizeUsername(profile.username) : prev.username,
        statusText: canOverwriteIdentity && profile?.statusText != null ? normalizeText(String(profile.statusText), 160) : prev.statusText,
        online: profile?.online !== undefined ? !!profile.online : !!prev.online,
        lastSeenAt: profile?.lastSeenAt != null ? Number(profile.lastSeenAt) : (Number(prev.lastSeenAt || 0) || Date.now()),
        privacy: {
            canWrite:
                canOverwritePrivacy && profile?.privacy?.canWrite !== undefined && ['all', 'friends', 'nobody'].includes(profile.privacy.canWrite)
                    ? profile.privacy.canWrite
                    : prev.privacy?.canWrite || 'all',
            canCall:
                canOverwritePrivacy && profile?.privacy?.canCall !== undefined && ['all', 'friends', 'nobody'].includes(profile.privacy.canCall)
                    ? profile.privacy.canCall
                    : prev.privacy?.canCall || 'all',
            canViewProfile:
                canOverwritePrivacy && profile?.privacy?.canViewProfile !== undefined && ['all', 'friends', 'nobody'].includes(profile.privacy.canViewProfile)
                    ? profile.privacy.canViewProfile
                    : prev.privacy?.canViewProfile || 'all',
            canSeeStories:
                canOverwritePrivacy && profile?.privacy?.canSeeStories !== undefined && ['all', 'friends', 'nobody'].includes(profile.privacy.canSeeStories)
                    ? profile.privacy.canSeeStories
                    : prev.privacy?.canSeeStories || 'friends',
            canJoinGroups:
                canOverwritePrivacy && profile?.privacy?.canJoinGroups !== undefined && ['all', 'friends', 'nobody'].includes(profile.privacy.canJoinGroups)
                    ? profile.privacy.canJoinGroups
                    : prev.privacy?.canJoinGroups || 'friends'
        },
        appearance: nextAppearance,
        blacklist: Array.isArray(profile?.blacklist)
            ? profile.blacklist.map((v) => normalizeAccountId(v)).filter(Boolean)
            : Array.isArray(prev.blacklist)
              ? prev.blacklist
              : [],
        blacklistMeta:
            typeof profile?.blacklistMeta === 'object' && profile.blacklistMeta
                ? profile.blacklistMeta
                : typeof prev.blacklistMeta === 'object' && prev.blacklistMeta
                  ? prev.blacklistMeta
                  : {},
        friendIds: Array.isArray(profile?.friendIds)
            ? profile.friendIds.map((v) => normalizeAccountId(v)).filter(Boolean)
            : Array.isArray(prev.friendIds)
              ? prev.friendIds
              : []
    };
    if (!next.username) {
        next.username = buildGeneratedUsername(userId);
    }
    const savePayload = {
        name: next.name,
        avatar: next.avatar,
        coverUrl: next.coverUrl,
        username: next.username,
        statusText: next.statusText,
        blacklist: next.blacklist,
        blacklistMeta: next.blacklistMeta,
        friendIds: next.friendIds,
        online: next.online,
        lastSeenAt: next.lastSeenAt,
        privacy: next.privacy
    };
    if (appearancePatch) {
        savePayload.appearance = next.appearance;
    }
    const saved = await messengerMysql.upsertProfile(userId, savePayload);
    messengerProfileMem.set(userId, saved);
}

async function ensureProfilesLoaded(...ids) {
    const todo = [...new Set(ids.map((x) => normalizeAccountId(x)).filter(Boolean))];
    if (!messengerMysql.isEnabled()) return;
    for (const uid of todo) {
        try {
            const p = await messengerMysql.getProfile(uid);
            if (p) messengerProfileMem.set(uid, p);
        } catch (_) {}
    }
}

function setUserOffline(appUserId) {
    const userId = normalizeAccountId(appUserId);
    if (!userId) return;
    void (async () => {
        try {
            await mysqlBoot;
        } catch (_) {}
        if (messengerMysql.isEnabled()) {
            await messengerMysql.setUserOnlineFlags(userId, false);
            const p = await messengerMysql.getProfile(userId);
            if (p) messengerProfileMem.set(userId, p);
            broadcastMessengerPresence(userId, false, p?.lastSeenAt || Date.now());
        }
    })();
}

function getUserProfile(appUserId) {
    const userId = normalizeAccountId(appUserId);
    if (!userId) return null;
    if (messengerProfileMem.has(userId)) return messengerProfileMem.get(userId);
    return null;
}

function getUserProfileFromFriendsStore(targetUserId) {
    const targetId = normalizeAccountId(targetUserId);
    if (!targetId) return null;
    const row = friendsUserCache.get(targetId);
    if (!row) return null;
    return {
        id: targetId,
        name: normalizeText(row.name || '', 120) || targetId,
        avatar: normalizeAvatarUrl(row.avatar || ''),
        username: normalizeUsername(row.username || ''),
        statusText: '',
        online: false,
        lastSeenAt: Number(row.lastSeen || 0) || 0,
        blacklist: [],
        blacklistMeta: {},
        privacy: { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' },
        appearance: { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true }
    };
}

function areFriendsForMessenger(userA, userB) {
    const a = normalizeAccountId(userA);
    const b = normalizeAccountId(userB);
    if (!a || !b) return false;
    if (friendsPairCache.has([a, b].sort().join('::'))) return true;
    const pa = getUserProfile(a);
    const pb = getUserProfile(b);
    const af = Array.isArray(pa?.friendIds) ? pa.friendIds.map((v) => normalizeAccountId(v)).filter(Boolean) : [];
    const bf = Array.isArray(pb?.friendIds) ? pb.friendIds.map((v) => normalizeAccountId(v)).filter(Boolean) : [];
    return af.includes(b) || bf.includes(a);
}

/** Кто может писать кому: ЧС с обеих сторон + политика получателя + друзья (friendships / friendIds) на сервере. */
function directMessageGate(fromUserId, toUserId) {
    const fromId = normalizeAccountId(fromUserId);
    const toId = normalizeAccountId(toUserId);
    if (!fromId || !toId || fromId === toId) return { ok: false, code: 'invalid' };
    const fromP = getUserProfile(fromId);
    const toP = getUserProfile(toId);
    if (fromP && Array.isArray(fromP.blacklist) && fromP.blacklist.includes(toId)) {
        return { ok: false, code: 'blocked' };
    }
    if (toP && Array.isArray(toP.blacklist) && toP.blacklist.includes(fromId)) {
        return { ok: false, code: 'blocked' };
    }
    if (!toP) {
        return { ok: true, code: 'ok' };
    }
    const policy = toP.privacy?.canWrite || 'all';
    if (policy === 'all') return { ok: true, code: 'ok' };
    if (policy === 'nobody') return { ok: false, code: 'policy' };
    if (!areFriendsForMessenger(fromId, toId)) return { ok: false, code: 'friends' };
    return { ok: true, code: 'ok' };
}

function composeHintFromGate(gate) {
    if (!gate || gate.ok) return '';
    if (gate.code === 'blocked') return 'Вы не можете отправить сообщение этому пользователю';
    if (gate.code === 'policy') return 'Пользователь ограничил личные сообщения';
    if (gate.code === 'friends') return 'Пользователь принимает сообщения только от друзей';
    return 'Вы не можете отправить сообщение этому пользователю';
}

/** Звонок другу: сначала те же ограничения, что и на ЛС (ЧС + who_can_write), затем who_can_call. */
function outgoingCallGate(fromUserId, toUserId) {
    const dm = directMessageGate(fromUserId, toUserId);
    if (!dm.ok) return dm;
    const toId = normalizeAccountId(toUserId);
    const toP = getUserProfile(toId);
    if (!toP) return { ok: true, code: 'ok' };
    const policy = toP.privacy?.canCall || 'all';
    if (policy === 'all') return { ok: true, code: 'ok' };
    if (policy === 'nobody') return { ok: false, code: 'call_policy' };
    if (!areFriendsForMessenger(fromUserId, toId)) return { ok: false, code: 'call_friends' };
    return { ok: true, code: 'ok' };
}

function composeCallHintFromGate(gate) {
    if (!gate || gate.ok) return '';
    if (gate.code === 'blocked') return 'Невозможно позвонить этому пользователю';
    if (gate.code === 'policy' || gate.code === 'friends') return composeHintFromGate(gate);
    if (gate.code === 'call_policy') return 'Пользователь отключил входящие звонки';
    if (gate.code === 'call_friends') return 'Пользователь принимает звонки только от друзей';
    return 'Невозможно совершить звонок';
}

function broadcastMessengerPresence(userId, online, lastSeenAt) {
    const id = normalizeAccountId(userId);
    if (!id) return;
    const ts = Number(lastSeenAt) || Date.now();
    const payload = { type: 'messenger-presence', userId: id, online: !!online, lastSeenAt: ts };
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) safeSend(client, payload);
    });
}

function broadcastMessengerProfilePatch(targetUserId) {
    const id = normalizeAccountId(targetUserId);
    if (!id) return;
    const fmt = getFormattedUser(id);
    const payload = {
        type: 'messenger-profile-patch',
        targetUserId: id,
        profile: {
            id: fmt.id,
            name: fmt.name,
            displayName: fmt.displayName,
            avatar: fmt.avatar,
            coverUrl: fmt.coverUrl || '',
            username: fmt.username,
            statusText: fmt.statusText,
            initials: fmt.initials,
            online: !!fmt.online,
            lastSeenAt: Number(fmt.lastSeenAt || 0)
        }
    };
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) safeSend(client, payload);
    });
}

function broadcastStoryStateChanged(ownerUserId, reason = 'updated') {
    const ownerId = normalizeAccountId(ownerUserId);
    if (!ownerId) return;
    const payload = {
        type: 'messenger-story-state-changed',
        ownerUserId: ownerId,
        reason
    };
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) safeSend(client, payload);
    });
}

function emitMessengerComposeStatus(viewerUserId, peerUserId) {
    const viewerId = normalizeAccountId(viewerUserId);
    const peerId = normalizeAccountId(peerUserId);
    if (!viewerId || !peerId || viewerId === peerId) return;
    const gate = directMessageGate(viewerId, peerId);
    const composeBlocked = !gate.ok;
    const composeHint = composeHintFromGate(gate);
    const chatId = createDirectChatId(viewerId, peerId);
    if (!chatId) return;
    sendToUserSessions(viewerId, {
        type: 'messenger-compose-status',
        chatId,
        withUserId: peerId,
        composeBlocked,
        composeHint
    });
}

function canUserWriteTo(fromUserId, toUserId) {
    return directMessageGate(fromUserId, toUserId).ok;
}

function getGroupParticipantRole(chat, userId) {
    if (!chat || chat.kind !== 'group') return '';
    const uid = normalizeAccountId(userId);
    if (!uid) return '';
    const participant = Array.isArray(chat.participants)
        ? chat.participants.find((item) => normalizeAccountId(item?.userId) === uid)
        : null;
    return participant && typeof participant.role === 'string' ? participant.role : '';
}

function getGroupParticipant(chat, userId) {
    if (!chat || chat.kind !== 'group') return null;
    const uid = normalizeAccountId(userId);
    if (!uid) return null;
    return Array.isArray(chat.participants)
        ? chat.participants.find((item) => normalizeAccountId(item?.userId) === uid) || null
        : null;
}

function groupRoleRank(role) {
    if (role === 'owner') return 3;
    if (role === 'admin') return 2;
    return 1;
}

function normalizeGroupPermissionValue(value, fallback = 'owner_admins') {
    return ['owner', 'owner_admins', 'all'].includes(String(value || '').trim()) ? String(value).trim() : fallback;
}

function hasGroupPermission(chat, userId, permissionKey) {
    const uid = normalizeAccountId(userId);
    if (!chat || chat.kind !== 'group' || !uid) return false;
    const role = getGroupParticipantRole(chat, uid);
    if (!role) return false;
    const rule = normalizeGroupPermissionValue(chat.meta?.permissions?.[permissionKey], 'owner_admins');
    if (rule === 'all') return true;
    if (rule === 'owner_admins') return role === 'owner' || role === 'admin';
    return role === 'owner';
}

function canManageGroupTarget(chat, actorUserId, targetUserId) {
    const actorId = normalizeAccountId(actorUserId);
    const targetId = normalizeAccountId(targetUserId);
    if (!chat || chat.kind !== 'group' || !actorId || !targetId) return false;
    if (actorId === targetId) return false;
    const actorRole = getGroupParticipantRole(chat, actorId);
    const targetRole = getGroupParticipantRole(chat, targetId);
    if (!actorRole || !targetRole) return false;
    return groupRoleRank(actorRole) > groupRoleRank(targetRole);
}

function getGroupPenaltyState(metaMap, userId) {
    const uid = normalizeAccountId(userId);
    const raw = metaMap && typeof metaMap === 'object' ? metaMap[uid] : null;
    if (!raw) return null;
    if (typeof raw === 'number') {
        return {
            active: raw < 0 || raw > Date.now(),
            until: Number(raw) || 0,
            forever: Number(raw) < 0,
            reason: '',
            actorId: '',
            actorName: '',
            issuedAt: 0
        };
    }
    if (typeof raw !== 'object') return null;
    const until = Number(raw.until || raw.expiresAt || raw.blockedUntil || raw.mutedUntil || 0);
    const forever = until < 0;
    return {
        active: forever || until > Date.now(),
        until,
        forever,
        reason: normalizeText(raw.reason || '', 220),
        actorId: normalizeAccountId(raw.actorId || raw.by || ''),
        actorName: normalizeText(raw.actorName || raw.byName || '', 120),
        actorAvatar: normalizeAvatarUrl(raw.actorAvatar || ''),
        issuedAt: Number(raw.issuedAt || Date.now()) || Date.now()
    };
}

function formatPenaltyDuration(untilTs) {
    const until = Number(untilTs || 0);
    if (until < 0) return 'навсегда';
    const leftMs = Math.max(0, until - Date.now());
    const minutes = Math.ceil(leftMs / 60000);
    if (minutes < 60) return `${minutes} мин.`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `${hours} ч.`;
    const days = Math.ceil(hours / 24);
    return `${days} дн.`;
}

function canUserBeAddedToGroup(actorUserId, targetUserId) {
    const actorId = normalizeAccountId(actorUserId);
    const targetId = normalizeAccountId(targetUserId);
    if (!actorId || !targetId || actorId === targetId) return false;
    if (!areFriendsForMessenger(actorId, targetId)) return false;
    const target = getUserProfile(targetId);
    const policy = target?.privacy?.canJoinGroups || 'friends';
    if (policy === 'nobody') return false;
    if (policy === 'all') return true;
    return areFriendsForMessenger(targetId, actorId);
}

function buildGroupRestriction(chat, userId) {
    const blocked = getGroupPenaltyState(chat?.meta?.blockedBy, userId);
    if (blocked && blocked.active) {
        return { type: 'banned', ...blocked };
    }
    const muted = getGroupPenaltyState(chat?.meta?.mutedBy, userId);
    if (muted && muted.active) {
        return { type: 'muted', ...muted };
    }
    return null;
}

function canSendToGroupChat(chat, userId) {
    const uid = normalizeAccountId(userId);
    if (!chat || chat.kind !== 'group' || !uid) return { ok: false, code: 'invalid' };
    if (!Array.isArray(chat.members) || !chat.members.includes(uid)) return { ok: false, code: 'not_member' };
    const restriction = buildGroupRestriction(chat, uid);
    if (restriction?.type === 'banned') {
        return { ok: false, code: 'banned', restriction };
    }
    if (restriction?.type === 'muted') {
        return { ok: false, code: 'muted', restriction };
    }
    return { ok: true, code: 'ok' };
}

function composeGroupWriteHint(gate) {
    if (!gate || gate.ok) return '';
    if (gate.code === 'muted') {
        const duration = gate.restriction?.forever ? 'навсегда' : formatPenaltyDuration(gate.restriction?.until);
        return `У вас мут в этом чате${duration ? `: ${duration}` : ''}`;
    }
    if (gate.code === 'banned') return 'Вы временно не можете пользоваться этим чатом';
    if (gate.code === 'not_member') return 'Вы не состоите в этом чате';
    return 'Отправка в этот чат недоступна';
}

function groupStatusLine(chat) {
    if (!chat || chat.kind !== 'group') return '';
    const count = Array.isArray(chat.members) ? chat.members.length : 0;
    if (!count) return 'Групповой чат';
    const modCount = Array.isArray(chat.participants)
        ? chat.participants.filter((item) => item?.role === 'owner' || item?.role === 'admin').length
        : 0;
    if (modCount > 1) return `${count} участников, ${modCount} админа`;
    if (modCount === 1) return `${count} участников, 1 админ`;
    return `${count} участников`;
}

function canUserViewProfile(viewerUserId, targetUserId) {
    const viewerId = normalizeAccountId(viewerUserId);
    const targetId = normalizeAccountId(targetUserId);
    if (!viewerId || !targetId) return false;
    if (viewerId === targetId) return true;
    const target = getUserProfile(targetId);
    if (!target) return true;
    const blocked = Array.isArray(target.blacklist) && target.blacklist.includes(viewerId);
    if (blocked) return false;
    const policy = target.privacy?.canViewProfile || 'all';
    if (policy === 'all') return true;
    if (policy === 'nobody') return false;
    return areFriendsForMessenger(viewerId, targetId);
}

function buildProfileViewFor(viewerUserId, targetUserId) {
    const viewerId = normalizeAccountId(viewerUserId);
    const targetId = normalizeAccountId(targetUserId);
    let target = getUserProfile(targetId);
    if (!target) {
        const fromFriends = getUserProfileFromFriendsStore(targetId);
        if (fromFriends) target = fromFriends;
    }
    if (!target) {
        return {
            ok: true,
            reason: 'minimal',
            profile: {
                id: targetId,
                name: targetId,
                displayName: targetId,
                initials: computeUserInitials('', targetId),
                avatar: '',
                coverUrl: '',
                username: '',
                statusText: '',
                online: false,
                lastSeenAt: 0,
                canJoinGroups: 'friends'
            }
        };
    }
    const isBlocked = Array.isArray(target.blacklist) && target.blacklist.includes(viewerId);
    if (isBlocked) {
        const fmtB = getFormattedUser(targetId);
        return {
            ok: false,
            reason: 'blocked',
            profile: {
                id: targetId,
                name: fmtB.displayName,
                displayName: fmtB.displayName,
                initials: fmtB.initials,
                avatar: fmtB.avatar,
                coverUrl: fmtB.coverUrl || '',
                username: fmtB.username,
                statusText: target.blacklistMeta?.[viewerId] || 'Вас заблокировал этот аккаунт.',
                online: !!target.online,
                canJoinGroups: target.privacy?.canJoinGroups || 'friends'
            }
        };
    }
    if (!canUserViewProfile(viewerId, targetId)) {
        return {
            ok: false,
            reason: 'private',
            profile: {
                id: targetId,
                name: 'Профиль закрыт',
                avatar: '',
                coverUrl: '',
                username: '',
                statusText: 'Пользователь закрыл профиль от публичного доступа.',
                online: false,
                canJoinGroups: target.privacy?.canJoinGroups || 'friends'
            }
        };
    }
    const fmt = getFormattedUser(targetId);
    return {
        ok: true,
        reason: 'ok',
        profile: {
            id: fmt.id,
            name: fmt.displayName,
            displayName: fmt.displayName,
            initials: fmt.initials,
            avatar: fmt.avatar,
            coverUrl: fmt.coverUrl || '',
            username: fmt.username,
            statusText: target.statusText || '',
            online: !!target.online,
            lastSeenAt: Number(target.lastSeenAt || 0),
            canJoinGroups: target.privacy?.canJoinGroups || 'friends'
        }
    };
}

async function buildChatListForUserMysql(appUserId) {
    const userId = normalizeAccountId(appUserId);
    const all = await messengerMysql.listChatsForUser(userId);
    const out = [];
    for (const chat of all) {
        const removed = !!chat.meta?.removedBy?.[userId];
        if (removed) continue;
        const clearedAt = Number(chat.meta?.clearedBy?.[userId] || 0);
        let lastMessage = null;
        const cached = chat.lastMessage;
        if (cached && cached.id && Number(cached.createdAt || cached.at || 0) >= clearedAt) {
            lastMessage = {
                id: cached.id,
                text: cached.text || '',
                fromId: cached.fromId,
                createdAt: cached.createdAt || cached.at,
                editedAt: Number(cached.editedAt || 0),
                messageKind: cached.messageKind || 'text',
                audioBase64: cached.audioBase64 || ''
            };
        } else {
            const last = await messengerMysql.getLatestMessageInChatAfter(chat.id, clearedAt);
            if (last) {
                lastMessage = {
                    id: last.id,
                    text: last.text || '',
                    fromId: last.fromId,
                    createdAt: last.createdAt,
                    editedAt: last.editedAt,
                    messageKind: last.messageKind,
                    audioBase64: last.audioBase64 || ''
                };
            }
        }
        if (chat.kind === 'group') {
            const title = normalizeText(chat.title || 'Групповой чат', 220);
            out.push({
                id: chat.id,
                kind: 'group',
                peer: {
                    id: chat.id,
                    name: title,
                    displayName: title,
                    initials: computeUserInitials(title, title),
                    avatar: normalizeAvatarUrl(chat.avatar || ''),
                    username: '',
                    statusText: groupStatusLine(chat),
                    online: false,
                    lastSeenAt: 0
                },
                group: {
                    title,
                    description: normalizeText(chat.description || '', 4000),
                    avatar: normalizeAvatarUrl(chat.avatar || ''),
                    inviteCode: normalizeText(chat.inviteCode || '', 120),
                    createdBy: normalizeAccountId(chat.createdBy || ''),
                    joinByLink: chat.meta?.joinByLink !== false,
                    permissions: chat.meta?.permissions || {},
                    restriction: buildGroupRestriction(chat, userId),
                    activeCall: serializeGroupCallState(chat.id),
                    members: Array.isArray(chat.members) ? [...chat.members] : [],
                    participants: Array.isArray(chat.participants) ? chat.participants : [],
                    myRole: getGroupParticipantRole(chat, userId)
                },
                updatedAt: Number(chat.updatedAt || chat.createdAt || Date.now()),
                lastMessage
            });
            continue;
        }
        const peerId = chat.members.find((item) => item !== userId) || userId;
        await ensureProfilesLoaded(peerId);
        const fmt = getFormattedUser(peerId);
        out.push({
            id: chat.id,
            kind: chat.kind || 'direct',
            peer: {
                id: fmt.id,
                name: fmt.name,
                displayName: fmt.displayName,
                initials: fmt.initials,
                avatar: fmt.avatar,
                coverUrl: fmt.coverUrl || '',
                username: fmt.username,
                statusText: fmt.statusText || '',
                online: !!fmt.online,
                lastSeenAt: Number(fmt.lastSeenAt || 0)
            },
            updatedAt: Number(chat.updatedAt || chat.createdAt || Date.now()),
            lastMessage
        });
    }
    return out.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function registerUserSession(appUserId, ws) {
    const id = normalizeAccountId(appUserId);
    if (!id || !ws) return;
    if (!userSessions.has(id)) userSessions.set(id, new Set());
    userSessions.get(id).add(ws);
}

function unregisterUserSession(appUserId, ws) {
    const id = normalizeAccountId(appUserId);
    if (!id || !ws || !userSessions.has(id)) return;
    const set = userSessions.get(id);
    set.delete(ws);
    if (set.size === 0) userSessions.delete(id);
}

function sendToUserSessions(appUserId, payload) {
    const id = normalizeAccountId(appUserId);
    const set = userSessions.get(id);
    if (!set) return;
    set.forEach((sessionWs) => safeSend(sessionWs, payload));
}

function sendToManyUserSessions(userIds, payload, excludeUserId = '') {
    const exclude = normalizeAccountId(excludeUserId);
    const uniq = Array.from(new Set((Array.isArray(userIds) ? userIds : []).map((item) => normalizeAccountId(item)).filter(Boolean)));
    uniq.forEach((uid) => {
        if (exclude && uid === exclude) return;
        sendToUserSessions(uid, payload);
    });
}

function serializeGroupCallState(chatId) {
    const cid = normalizeText(chatId || '', 220);
    if (!cid) return null;
    const roomId = groupCallRoomsByChatId.get(cid) || '';
    const room = roomId ? rooms.get(roomId) : null;
    if (!room || !room.groupChatId) return null;
    const meta = groupCallMetaByChatId.get(cid) || {};
    const participantUsers = Array.from(room.participants.values())
        .map((participant) => normalizeAccountId(participant?.appUserId || ''))
        .filter(Boolean);
    const participantPreviews = participantUsers.slice(0, 4).map((uid) => {
        const fmt = getFormattedUser(uid);
        return {
            userId: uid,
            displayName: fmt.displayName,
            avatar: fmt.avatar,
            initials: fmt.initials
        };
    });
    return {
        roomId: room.id,
        chatId: cid,
        active: true,
        createdAt: Number(meta.createdAt || room.createdAt || Date.now()),
        createdBy: normalizeAccountId(meta.createdBy || room.createdByAppUserId || ''),
        participantCount: participantUsers.length,
        participants: participantPreviews
    };
}

function serializeGroupChatForClient(chat, viewerUserId = '') {
    if (!chat || chat.kind !== 'group') return null;
    const myId = normalizeAccountId(viewerUserId);
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    const restriction = buildGroupRestriction(chat, myId);
    return {
        id: chat.id,
        kind: 'group',
        title: normalizeText(chat.title || 'Групповой чат', 220),
        description: normalizeText(chat.description || '', 4000),
        avatar: normalizeAvatarUrl(chat.avatar || ''),
        inviteCode: normalizeText(chat.inviteCode || '', 120),
        createdBy: normalizeAccountId(chat.createdBy || ''),
        joinByLink: chat.meta?.joinByLink !== false,
        permissions: chat.meta?.permissions || {},
        restriction,
        activeCall: serializeGroupCallState(chat.id),
        members: Array.isArray(chat.members) ? [...chat.members] : [],
        myRole: getGroupParticipantRole(chat, myId),
        participants: participants.map((participant) => {
            const userId = normalizeAccountId(participant?.userId);
            const fmt = getFormattedUser(userId);
            const participantRestriction = buildGroupRestriction(chat, userId);
            return {
                userId,
                role: participant?.role || 'member',
                joinedAt: Number(participant?.joinedAt || 0),
                invitedBy: normalizeAccountId(participant?.invitedBy || ''),
                displayName: fmt.displayName,
                name: fmt.name,
                avatar: fmt.avatar,
                initials: fmt.initials,
                username: fmt.username,
                statusText: fmt.statusText || '',
                online: !!fmt.online,
                lastSeenAt: Number(fmt.lastSeenAt || 0),
                restriction: participantRestriction
            };
        })
    };
}

async function insertSystemMessage(chat, actorUserId, text, extras = {}) {
    if (!chat || !chat.id) return null;
    const actorId = normalizeAccountId(actorUserId);
    const createdAt = Date.now();
    const message = {
        id: `sys_${uuidv4()}`,
        chatId: chat.id,
        fromId: actorId || 'system',
        toId: chat.kind === 'group' ? chat.id : (chat.members.find((item) => item !== actorId) || actorId || ''),
        text: normalizeText(text || '', 4000),
        messageKind: 'system',
        createdAt,
        editedAt: 0,
        deletedAt: 0,
        replyTo: '',
        forwardedFromMessageId: '',
        forwardedPreview: {},
        reactions: {},
        deliveredBy: Array.isArray(chat.members) ? chat.members.filter((item) => item !== actorId) : [],
        readBy: actorId ? [actorId] : [],
        ...extras
    };
    await messengerMysql.insertMessage(message);
    const preview = {
        id: message.id,
        text: message.text,
        fromId: message.fromId,
        createdAt: message.createdAt,
        editedAt: 0,
        messageKind: message.messageKind,
        audioBase64: ''
    };
    await messengerMysql.updateLastMessagePreview(chat.id, preview, createdAt);
    return enrichMessageWithSender(message);
}

async function insertGroupEventBlock(chat, actorUserId, payload = {}) {
    if (!chat || !chat.id) return null;
    const actorId = normalizeAccountId(actorUserId);
    const createdAt = Date.now();
    const body = {
        type: payload.type || 'group-event',
        title: normalizeText(payload.title || '', 200),
        roomId: normalizeText(payload.roomId || '', 120),
        durationSec: Math.max(0, Number(payload.durationSec || 0)),
        participants: Array.isArray(payload.participants)
            ? payload.participants.slice(0, 4).map((item) => ({
                  userId: normalizeAccountId(item?.userId || ''),
                  displayName: normalizeText(item?.displayName || '', 120),
                  avatar: normalizeAvatarUrl(item?.avatar || ''),
                  initials: normalizeText(item?.initials || '', 6)
              }))
            : []
    };
    const message = {
        id: `evt_${uuidv4()}`,
        chatId: chat.id,
        fromId: actorId,
        toId: chat.id,
        text: `[[group-event:${JSON.stringify(body)}]]`,
        messageKind: 'text',
        createdAt,
        editedAt: 0,
        deletedAt: 0,
        replyTo: '',
        forwardedFromMessageId: '',
        forwardedPreview: {},
        reactions: {},
        deliveredBy: Array.isArray(chat.members) ? chat.members.filter((item) => item !== actorId) : [],
        readBy: actorId ? [actorId] : []
    };
    await messengerMysql.insertMessage(message);
    await messengerMysql.updateLastMessagePreview(chat.id, {
        id: message.id,
        text: body.title || 'Групповой звонок',
        fromId: message.fromId,
        createdAt,
        editedAt: 0,
        messageKind: 'text',
        audioBase64: ''
    }, createdAt);
    return enrichMessageWithSender(message);
}

async function emitGroupChatUpdated(chat, reason = 'group-updated') {
    if (!chat || chat.kind !== 'group' || !Array.isArray(chat.members)) return;
    await ensureProfilesLoaded(...chat.members);
    chat.members.forEach((uid) => {
        sendToUserSessions(uid, {
            type: 'messenger-group-updated',
            reason,
            chat: serializeGroupChatForClient(chat, uid)
        });
    });
    chat.members.forEach((uid) => emitMessengerSync(uid, reason));
}

async function sendGroupChatPayloadUpdate(chatId, reason = 'group-updated') {
    const chat = await messengerMysql.getChatById(chatId);
    if (!chat || chat.kind !== 'group') return null;
    await emitGroupChatUpdated(chat, reason);
    return chat;
}

function buildPenaltyUntil(durationValue, durationUnit) {
    const amount = Math.max(0, Number(durationValue || 0));
    if (String(durationUnit || '') === 'forever') return -1;
    const multiplierMap = {
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000
    };
    const mult = multiplierMap[String(durationUnit || '').trim()] || multiplierMap.minutes;
    return Date.now() + (amount || 1) * mult;
}

async function applyGroupPenalty(chat, actorUserId, targetUserId, kind, durationValue, durationUnit, reason = '') {
    if (!chat || chat.kind !== 'group') return null;
    const actorId = normalizeAccountId(actorUserId);
    const targetId = normalizeAccountId(targetUserId);
    if (!actorId || !targetId) return null;
    const actorFmt = getFormattedUser(actorId);
    const targetFmt = getFormattedUser(targetId);
    const until = buildPenaltyUntil(durationValue, durationUnit);
    const durationText = until < 0 ? 'навсегда' : formatPenaltyDuration(until);
    const meta = {
        ...chat.meta,
        mutedBy: { ...(chat.meta?.mutedBy || {}) },
        blockedBy: { ...(chat.meta?.blockedBy || {}) }
    };
    const entry = {
        until,
        actorId,
        actorName: actorFmt.displayName,
        actorAvatar: actorFmt.avatar,
        reason: normalizeText(reason || '', 220),
        issuedAt: Date.now()
    };
    if (kind === 'mute') {
        meta.mutedBy[targetId] = entry;
        await messengerMysql.updateChatMeta(chat.id, meta);
        const msg = await insertSystemMessage(
            chat,
            actorId,
            `${makeSystemUserTag(actorId, actorFmt.displayName)} выдал(а) мут на ${durationText} ${makeSystemUserTag(targetId, targetFmt.displayName)} в чате${entry.reason ? `. Причина: ${entry.reason}` : ''}`
        );
        return { chat: await sendGroupChatPayloadUpdate(chat.id, 'group-penalty-updated'), message: msg };
    }
    if (kind === 'ban') {
        meta.blockedBy[targetId] = entry;
        await messengerMysql.updateChatMeta(chat.id, meta);
        const msg = await insertSystemMessage(
            chat,
            actorId,
            `${makeSystemUserTag(actorId, actorFmt.displayName)} выдал(а) блокировку чата на ${durationText} ${makeSystemUserTag(targetId, targetFmt.displayName)} в чате${entry.reason ? `. Причина: ${entry.reason}` : ''}`
        );
        return { chat: await sendGroupChatPayloadUpdate(chat.id, 'group-penalty-updated'), message: msg };
    }
    return null;
}

async function removeGroupPenalty(chat, actorUserId, targetUserId, kind) {
    if (!chat || chat.kind !== 'group') return null;
    const actorId = normalizeAccountId(actorUserId);
    const targetId = normalizeAccountId(targetUserId);
    if (!actorId || !targetId) return null;
    const actorFmt = getFormattedUser(actorId);
    const targetFmt = getFormattedUser(targetId);
    const meta = {
        ...chat.meta,
        mutedBy: { ...(chat.meta?.mutedBy || {}) },
        blockedBy: { ...(chat.meta?.blockedBy || {}) }
    };
    let text = '';
    if (kind === 'mute' && meta.mutedBy[targetId]) {
        delete meta.mutedBy[targetId];
        text = `${makeSystemUserTag(actorId, actorFmt.displayName)} снял(а) мут с ${makeSystemUserTag(targetId, targetFmt.displayName)}`;
    }
    if (kind === 'ban' && meta.blockedBy[targetId]) {
        delete meta.blockedBy[targetId];
        text = `${makeSystemUserTag(actorId, actorFmt.displayName)} снял(а) блокировку чата с ${makeSystemUserTag(targetId, targetFmt.displayName)}`;
    }
    if (!text) return null;
    await messengerMysql.updateChatMeta(chat.id, meta);
    const msg = await insertSystemMessage(chat, actorId, text);
    return { chat: await sendGroupChatPayloadUpdate(chat.id, 'group-penalty-removed'), message: msg };
}

async function finalizeGroupCallRoom(room, closedById = '', closedByName = '') {
    if (!room?.groupChatId) return;
    const chatId = room.groupChatId;
    groupCallRoomsByChatId.delete(chatId);
    const meta = groupCallMetaByChatId.get(chatId) || {};
    groupCallMetaByChatId.delete(chatId);
    try {
        const chat = await messengerMysql.getChatById(chatId);
        if (!chat || chat.kind !== 'group') return;
        const participantUsers = Array.from(room.participants.values())
            .map((participant) => normalizeAccountId(participant?.appUserId || ''))
            .filter(Boolean)
            .slice(0, 4)
            .map((uid) => {
                const fmt = getFormattedUser(uid);
                return {
                    userId: uid,
                    displayName: fmt.displayName,
                    avatar: fmt.avatar,
                    initials: fmt.initials
                };
            });
        const durationSec = Math.max(0, Math.floor((Date.now() - Number(meta.createdAt || Date.now())) / 1000));
        const actorId = normalizeAccountId(closedById || meta.createdBy || '');
        const actorName = normalizeText(closedByName || '', 120) || getFormattedUser(actorId).displayName || 'Система';
        const endBlock = await insertGroupEventBlock(chat, actorId, {
            type: 'group-call-ended',
            title: 'Звонок завершен',
            durationSec,
            participants: participantUsers
        });
        if (endBlock) {
            sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: endBlock });
        }
        await emitGroupChatUpdated(chat, 'group-call-ended');
        sendToManyUserSessions(chat.members || [], {
            type: 'messenger-group-call-ended',
            chatId: chat.id,
            roomId: room.id,
            byId: actorId,
            byName: actorName
        });
    } catch (err) {
        console.error('[group-call] finalize failed', err && err.stack ? err.stack : err);
    }
}

function emitMessengerSync(appUserId, reason = 'update') {
    void emitMessengerSyncAsync(appUserId, reason);
}

async function emitMessengerSyncAsync(appUserId, reason = 'update') {
    try {
        await mysqlBoot;
    } catch (_) {}
    const id = normalizeAccountId(appUserId);
    if (!id) return;
    if (!messengerMysql.isEnabled()) {
        sendToUserSessions(id, {
            type: 'messenger-sync',
            reason,
            userId: id,
            chats: [],
            messengerStorageError: 'storage_unavailable'
        });
        return;
    }
    await ensureProfilesLoaded(id);
    let selfProfile = getUserProfile(id);
    if (!selfProfile) {
        try {
            selfProfile = await messengerMysql.getProfile(id);
            if (selfProfile) messengerProfileMem.set(id, selfProfile);
        } catch (_) {}
    }
    const chats = await buildChatListForUserMysql(id);
    sendToUserSessions(id, {
        type: 'messenger-sync',
        reason,
        userId: id,
        chats,
        selfProfile: selfProfile
            ? {
                  name: selfProfile.name || '',
                  avatar: selfProfile.avatar || '',
                  coverUrl: selfProfile.coverUrl || '',
                  username: selfProfile.username || '',
                  statusText: selfProfile.statusText || '',
                  privacy: selfProfile.privacy || { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' },
                  blacklist: Array.isArray(selfProfile.blacklist) ? selfProfile.blacklist : [],
                  appearance: selfProfile.appearance || { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true }
              }
            : null
    });
}

function sanitizeIceServer(item) {
    if (!item || typeof item !== 'object') return null;
    const urls = item.urls;
    const normalizedUrls = Array.isArray(urls)
        ? urls.filter((u) => typeof u === 'string' && u.trim())
        : typeof urls === 'string' && urls.trim()
            ? urls.trim()
            : null;
    if (!normalizedUrls) return null;
    const out = { urls: normalizedUrls };
    if (typeof item.username === 'string' && item.username) out.username = item.username;
    if (typeof item.credential === 'string' && item.credential) out.credential = item.credential;
    return out;
}

function buildIceServers() {
    const merged = [];
    const add = (item) => {
        const server = sanitizeIceServer(item);
        if (!server) return;
        const key = JSON.stringify(server);
        if (!merged.some((entry) => JSON.stringify(entry) === key)) {
            merged.push(server);
        }
    };
    DEFAULT_ICE_SERVERS.forEach(add);

    if (process.env.WEBRTC_ICE_SERVERS_JSON) {
        try {
            const parsed = JSON.parse(process.env.WEBRTC_ICE_SERVERS_JSON);
            if (Array.isArray(parsed)) parsed.forEach(add);
        } catch (_) {}
    }

    const turnUser = process.env.TURN_USERNAME || '';
    const turnCredential = process.env.TURN_CREDENTIAL || '';
    const turnUrls = String(process.env.TURN_URLS || '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
    if (turnUrls.length && turnUser && turnCredential) {
        add({ urls: turnUrls, username: turnUser, credential: turnCredential });
    }
    return merged;
}

const ACTIVE_ICE_SERVERS = buildIceServers();

function serializeParticipant(id, participant) {
    return {
        id,
        userName: participant.userName,
        userAvatar: participant.userAvatar || '',
        appUserId: participant.appUserId || '',
        video: !!participant.video,
        audio: !!participant.audio,
        screen: !!participant.screen,
        speaking: !!participant.speaking,
        isAdmin: !!participant.isAdmin,
        cameraFacingMode: participant.cameraFacingMode === 'environment' ? 'environment' : 'user'
    };
}

function serializeJoinRequest(request) {
    return {
        id: request.id,
        userName: request.userName,
        userAvatar: request.userAvatar || '',
        requestedAt: request.requestedAt || Date.now()
    };
}

function ensureOwnerAdmin(room) {
    room.participants.forEach((participant, id) => {
        if (id === room.ownerId) {
            participant.isAdmin = true;
        }
    });
}

function isModerator(room, participantId) {
    if (!room || !participantId) return false;
    if (room.ownerId === participantId) return true;
    const participant = room.participants.get(participantId);
    return !!participant?.isAdmin;
}

function broadcastJoinRequestToModerators(room, payload) {
    room.participants.forEach((participant, id) => {
        if (!isModerator(room, id)) return;
        safeSend(participant.ws, payload);
    });
}

function broadcastRoomState(room) {
    const participants = Array.from(room.participants.entries()).map(([id, participant]) => serializeParticipant(id, participant));
    room.participants.forEach((participant, id) => {
        const canModerate = isModerator(room, id);
        const pendingJoinRequests = canModerate
            ? Array.from(room.joinRequests.values()).map(serializeJoinRequest)
            : [];
        safeSend(participant.ws, {
            type: 'room-state',
            roomId: room.id,
            groupChatId: room.groupChatId || '',
            myId: id,
            ownerId: room.ownerId,
            participants,
            watchParty: room.watchParty || null,
            durak: room.durak ? { phase: room.durak.phase, playerCount: room.durak.players?.length || 0 } : null,
            isPrivate: !!room.isPrivate,
            pendingJoinRequests,
            iceServers: ACTIVE_ICE_SERVERS
        });
    });
}

function broadcastDurak(room) {
    if (!room) return;
    if (!room.durak) {
        room.participants.forEach((participant, id) => {
            safeSend(participant.ws, {
                type: 'durak-state',
                game: null
            });
        });
        return;
    }
    room.participants.forEach((participant, id) => {
        safeSend(participant.ws, {
            type: 'durak-state',
            game: durakEngine.exportGamePublic(room.durak, id)
        });
    });
}

function handleDurakDisconnect(room, clientId) {
    if (!room || !room.durak) return;
    const g = room.durak;
    if (g.phase === 'ended') return;
    if (g.phase === 'lobby') {
        const r = durakEngine.lobbyLeave(g, clientId);
        if (r.empty) room.durak = null;
    } else {
        const r = durakEngine.playingLeave(g, clientId);
        if (r.empty) room.durak = null;
    }
    broadcastDurak(room);
}

function tickDurakRooms() {
    rooms.forEach((room, roomId) => {
        if (!room.durak) return;
        const g = room.durak;
        if (g.phase === 'lobby') {
            const started = durakEngine.lobbyTick(g);
            if (started && started.ok) broadcastDurak(room);
        } else if (g.phase === 'playing') {
            const t = durakEngine.tickTurnTimer(g);
            if (t && t.ok) broadcastDurak(room);
        }
    });
}

function findParticipantIdByReconnectKey(room, reconnectKey) {
    if (!room || !reconnectKey) return null;
    for (const [id, participant] of room.participants.entries()) {
        if (participant?.reconnectKey === reconnectKey) {
            return id;
        }
    }
    return null;
}

function isInvitedFriendForRoom(room, appUserId) {
    if (!room || !room.isFriendCall) return false;
    const invited = typeof room.friendTargetAppUserId === 'string' ? room.friendTargetAppUserId.trim() : '';
    const current = typeof appUserId === 'string' ? appUserId.trim() : '';
    if (!invited || !current) return false;
    return invited === current;
}

function assignOwner(room, preferredOwnerId = null) {
    const prevOwnerId = room.ownerId || null;
    if (preferredOwnerId && room.participants.has(preferredOwnerId)) {
        room.ownerId = preferredOwnerId;
    } else {
        const first = room.participants.keys().next();
        room.ownerId = first.done ? null : first.value;
    }
    ensureOwnerAdmin(room);
    if (prevOwnerId !== room.ownerId && room.ownerId) {
        room.participants.forEach((participant) => {
            safeSend(participant.ws, {
                type: 'owner-changed',
                ownerId: room.ownerId,
                previousOwnerId: prevOwnerId
            });
        });
    }
}

function closeRoom(room, closedById = null, closedByName = '') {
    if (!room) return;
    const roomId = room.id;
    if (room.groupChatId) {
        void finalizeGroupCallRoom(room, closedById || '', closedByName || '');
    }
    cancelRoomEmptyCleanup(roomId);
    clearRoomPendingDisconnects(roomId);
    const participants = Array.from(room.participants.values());
    const pending = Array.from(room.joinRequests.values());
    if (room.groupChatId) {
        groupCallRoomsByChatId.delete(room.groupChatId);
    }
    rooms.delete(roomId);
    participants.forEach((participant) => {
        safeSend(participant.ws, {
            type: 'room-closed',
            roomId,
            byId: closedById,
            byName: closedByName || ''
        });
    });
    pending.forEach((request) => {
        safeSend(request.ws, {
            type: 'room-closed',
            roomId,
            byId: closedById,
            byName: closedByName || ''
        });
    });
    participants.forEach((participant) => {
        try { participant.ws.close(); } catch (_) {}
    });
    pending.forEach((request) => {
        try { request.ws.close(); } catch (_) {}
    });
}

function getPendingDisconnectKey(roomId, participantId) {
    return `${roomId}::${participantId}`;
}

function clearPendingDisconnect(roomId, participantId) {
    if (!roomId || !participantId) return;
    const key = getPendingDisconnectKey(roomId, participantId);
    const timerId = pendingDisconnects.get(key);
    if (!timerId) return;
    clearTimeout(timerId);
    pendingDisconnects.delete(key);
}

function clearRoomPendingDisconnects(roomId) {
    if (!roomId) return;
    const prefix = `${roomId}::`;
    Array.from(pendingDisconnects.entries()).forEach(([key, timerId]) => {
        if (!key.startsWith(prefix)) return;
        clearTimeout(timerId);
        pendingDisconnects.delete(key);
    });
}

function cancelRoomEmptyCleanup(roomId) {
    if (!roomId) return;
    const timerId = emptyRoomCleanupTimers.get(roomId);
    if (!timerId) return;
    clearTimeout(timerId);
    emptyRoomCleanupTimers.delete(roomId);
}

function scheduleRoomEmptyCleanup(roomId) {
    if (!roomId) return;
    cancelRoomEmptyCleanup(roomId);
    const timerId = setTimeout(() => {
        emptyRoomCleanupTimers.delete(roomId);
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.participants.size > 0) return;
        if (room.groupChatId) {
            closeRoom(room);
            return;
        }
        room.joinRequests.forEach((request) => {
            safeSend(request.ws, { type: 'room-closed', roomId });
            try { request.ws.close(); } catch (_) {}
        });
        room.joinRequests.clear();
        clearRoomPendingDisconnects(roomId);
        rooms.delete(roomId);
        console.log(`🏠 Room closed by idle timeout: ${roomId}`);
    }, Math.max(10000, EMPTY_ROOM_GRACE_MS));
    emptyRoomCleanupTimers.set(roomId, timerId);
}

function finalizeParticipantDisconnect(clientId, roomId) {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(clientId);
    if (!participant) return;

    clearPendingDisconnect(roomId, clientId);
    console.log(`❌ User left: ${participant.userName} from room ${roomId}`);
    
    room.participants.delete(clientId);
    const shouldStopWatch = room.watchParty && room.watchParty.ownerId === clientId;
    if (shouldStopWatch) {
        room.watchParty = null;
    }
    handleDurakDisconnect(room, clientId);
    if (room.isFriendCall) {
        closeRoom(room, clientId, participant.userName || '');
        return;
    }
    
    if (room.participants.size === 0) {
        if (room.groupChatId) {
            closeRoom(room, clientId, participant.userName || '');
            return;
        }
        // Даем всем участникам время на массовое переподключение.
        scheduleRoomEmptyCleanup(roomId);
        console.log(`⏳ Room became empty, waiting reconnect grace: ${roomId}`);
    } else {
        cancelRoomEmptyCleanup(roomId);
        const ownerLeft = room.ownerId === clientId || !room.participants.has(room.ownerId);
        if (ownerLeft) {
            assignOwner(room);
        } else {
            ensureOwnerAdmin(room);
        }

        room.participants.forEach((p) => {
            safeSend(p.ws, { 
                type: 'guest-left', 
                from: participant.userName,
                fromId: clientId,
                ownerId: room.ownerId
            });
            if (shouldStopWatch) {
                safeSend(p.ws, {
                    type: 'watch-stopped',
                    previousWatch: null,
                    from: participant.userName,
                    fromId: clientId,
                    ownerId: room.ownerId
                });
            }
        });
        broadcastRoomState(room);
        if (room.groupChatId) {
            void sendGroupChatPayloadUpdate(room.groupChatId, 'group-call-state');
        }
    }
}

wss.on('connection', (ws) => {
    const clientId = uuidv4();
    console.log(`📱 Client connected: ${clientId.substring(0, 8)}`);

    let currentRoom = null;
    let userName = '';
    let currentAppUserId = '';

    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const senderId = ws.__participantId || clientId;

            switch (data.type) {
                case 'ping':
                    safeSend(ws, { type: 'pong', ts: Date.now() });
                    break;
                case 'messenger-register':
                    {
                        const accountId = normalizeAccountId(data.appUserId);
                        if (!accountId) {
                            safeSend(ws, { type: 'error', message: 'appUserId required for messenger-register' });
                            return;
                        }
                        currentAppUserId = accountId;
                        ws.__appUserId = accountId;
                        registerUserSession(accountId, ws);
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            const patch = {
                                name: data.userName || data.name || '',
                                avatar: data.userAvatar || data.avatar || '',
                                username: data.username || '',
                                statusText: data.statusText || '',
                                privacy: data.privacy || null,
                                blacklist: data.blacklist || null
                            };
                            if (messengerMysql.isEnabled()) {
                                await upsertUserPresenceProfileMysql(accountId, patch, {
                                    overwriteExistingIdentity: false,
                                    overwriteExistingPrivacy: false
                                });
                            }
                            emitMessengerSync(accountId, 'init');
                            broadcastMessengerPresence(accountId, true, Date.now());
                        })();
                    }
                    break;
                case 'messenger-sync':
                    if (!currentAppUserId) return;
                    emitMessengerSync(currentAppUserId, 'manual-sync');
                    break;
                case 'messenger-open-chat':
                    {
                        if (!currentAppUserId) return;
                        const chatIdRequested = normalizeText(data.chatId || '', 220);
                        const withUserId = normalizeAccountId(data.withUserId);
                        if (!chatIdRequested && (!withUserId || withUserId === currentAppUserId)) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) {
                                safeSend(ws, {
                                    type: 'messenger-error',
                                    code: 'storage_unavailable',
                                    message: 'Messenger недоступен (нет PostgreSQL / DATABASE_URL)'
                                });
                                return;
                            }
                            let chat = null;
                            let chatId = chatIdRequested;
                            let composeBlocked = false;
                            let composeHint = '';
                            if (chatIdRequested) {
                                chat = await messengerMysql.getChatById(chatIdRequested);
                                if (!chat && withUserId && withUserId !== currentAppUserId) {
                                    chat = await messengerMysql.getOrCreateChat(currentAppUserId, withUserId);
                                    chatId = chat?.id || chatIdRequested;
                                }
                                if (!chat || !Array.isArray(chat.members) || !chat.members.includes(currentAppUserId)) return;
                            } else {
                                // Для прямых чатов используем getOrCreateChat, чтобы гарантировать наличие записи
                                chat = await messengerMysql.getOrCreateChat(currentAppUserId, withUserId);
                                chatId = chat?.id || createDirectChatId(currentAppUserId, withUserId);
                                if (!chatId) return;
                            }
                            const clearedAt = chat ? Number(chat.meta?.clearedBy?.[currentAppUserId] || 0) : 0;
                            const rawMsgs = chat ? await messengerMysql.listMessagesForChat(chat.id, clearedAt, 250) : [];
                            await ensureProfilesLoaded(
                                currentAppUserId,
                                ...(chat && Array.isArray(chat.members) ? chat.members : [withUserId]),
                                ...rawMsgs.map((m) => m.fromId).filter(Boolean)
                            );
                            const messages = rawMsgs.map(enrichMessageWithSender);
                            if (chat && chat.kind === 'group') {
                                const gate = canSendToGroupChat(chat, currentAppUserId);
                                composeBlocked = !gate.ok;
                                composeHint = composeGroupWriteHint(gate);
                            } else {
                                const gate = directMessageGate(currentAppUserId, withUserId);
                                composeBlocked = !gate.ok;
                                composeHint = composeHintFromGate(gate);
                            }
                            safeSend(ws, {
                                type: 'messenger-chat-history',
                                chatId,
                                withUserId: chat && chat.kind === 'group' ? '' : withUserId,
                                messages,
                                composeBlocked,
                                composeHint,
                                chat: chat && chat.kind === 'group' ? serializeGroupChatForClient(chat, currentAppUserId) : null
                            });
                        })();
                    }
                    break;
                case 'messenger-create-group':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) {
                                safeSend(ws, {
                                    type: 'messenger-error',
                                    code: 'storage_unavailable',
                                    message: 'Messenger недоступен (нет PostgreSQL / DATABASE_URL)'
                                });
                                return;
                            }
                            const title = normalizeText(data.title || '', 220);
                            if (!title) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_title_required', message: 'Укажите название чата' });
                                return;
                            }
                            const description = normalizeText(data.description || '', 4000);
                            const avatar = normalizeAvatarUrl(data.avatar || '');
                            const inviteCode = normalizeText(data.inviteCode || '', 120).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
                            const rawMemberIds = Array.isArray(data.memberIds) ? data.memberIds.map((v) => normalizeAccountId(v)).filter(Boolean) : [];
                            const memberIds = rawMemberIds.filter((uid) => uid !== currentAppUserId && canUserBeAddedToGroup(currentAppUserId, uid));
                            const group = await messengerMysql.createGroupChat({
                                ownerId: currentAppUserId,
                                title,
                                description,
                                avatar,
                                inviteCode,
                                memberIds
                            });
                            if (!group) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_create_failed', message: 'Не удалось создать групповой чат' });
                                return;
                            }
                            const actorFmt = getFormattedUser(currentAppUserId);
                            const createdMsg = await insertSystemMessage(
                                group,
                                currentAppUserId,
                                `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} создал(а) чат`
                            );
                            if (createdMsg) {
                                sendToManyUserSessions(group.members, { type: 'messenger-message', chatId: group.id, message: createdMsg });
                            }
                            for (const memberId of memberIds) {
                                const targetFmt = getFormattedUser(memberId);
                                const sys = await insertSystemMessage(
                                    group,
                                    currentAppUserId,
                                    `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} добавил(а) ${makeSystemUserTag(memberId, targetFmt.displayName)} в чат`
                                );
                                if (sys) {
                                    sendToManyUserSessions(group.members, { type: 'messenger-message', chatId: group.id, message: sys });
                                }
                            }
                            sendToManyUserSessions(group.members, { type: 'messenger-group-created', chat: serializeGroupChatForClient(group, currentAppUserId) });
                            group.members.forEach((uid) => emitMessengerSync(uid, 'group-created'));
                        })();
                    }
                    break;
                case 'messenger-update-group':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            let chat = await messengerMysql.getChatById(normalizeText(data.chatId || '', 220));
                            if (!chat || chat.kind !== 'group' || !chat.members.includes(currentAppUserId)) return;
                            const action = normalizeText(data.action || 'update', 40);
                            const actorFmt = getFormattedUser(currentAppUserId);
                            if (action === 'leave') {
                                const myRole = getGroupParticipantRole(chat, currentAppUserId);
                                if (myRole === 'owner' && chat.members.length > 1) {
                                    const nextOwnerId = chat.members.find((uid) => uid !== currentAppUserId) || '';
                                    if (nextOwnerId) {
                                        await messengerMysql.setGroupMemberRole(chat.id, nextOwnerId, 'owner');
                                    }
                                }
                                await messengerMysql.removeGroupMember(chat.id, currentAppUserId);
                                chat = await messengerMysql.getChatById(chat.id);
                                const msg = await insertSystemMessage(
                                    { ...chat, id: data.chatId, kind: 'group', members: [currentAppUserId, ...(chat?.members || [])] },
                                    currentAppUserId,
                                    `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} вышел(а) из чата`
                                );
                                if (msg && chat) {
                                    sendToManyUserSessions([currentAppUserId, ...(chat.members || [])], { type: 'messenger-message', chatId: data.chatId, message: msg });
                                }
                                if (chat) await emitGroupChatUpdated(chat, 'group-member-left');
                                emitMessengerSync(currentAppUserId, 'group-left');
                                safeSend(ws, { type: 'messenger-group-left', chatId: data.chatId });
                                return;
                            }
                            const canEditInfo = hasGroupPermission(chat, currentAppUserId, 'editInfo');
                            const canEditLink = hasGroupPermission(chat, currentAppUserId, 'linkAccess');
                            const isOwner = getGroupParticipantRole(chat, currentAppUserId) === 'owner';
                            if (!canEditInfo && !isOwner && !canEditLink) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_edit_forbidden', message: 'Недостаточно прав для изменения чата' });
                                return;
                            }
                            const patch = {};
                            if (canEditInfo || isOwner) {
                                if (data.title !== undefined) patch.title = normalizeText(data.title || '', 220);
                                if (data.description !== undefined) patch.description = normalizeText(data.description || '', 4000);
                                if (data.avatar !== undefined) patch.avatar = normalizeAvatarUrl(data.avatar || '');
                            }
                            if ((canEditLink || isOwner) && data.inviteCode !== undefined) {
                                const nextInviteCode = normalizeText(data.inviteCode || '', 120).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
                                if (nextInviteCode) {
                                    const exists = await messengerMysql.getGroupChatByInviteCode(nextInviteCode);
                                    if (exists && exists.id !== chat.id) {
                                        safeSend(ws, { type: 'messenger-error', code: 'invite_taken', message: 'Эта ссылка уже занята' });
                                        return;
                                    }
                                }
                                patch.inviteCode = nextInviteCode;
                            }
                            if ((data.permissions && typeof data.permissions === 'object') || data.joinByLink !== undefined) {
                                if (!isOwner) {
                                    safeSend(ws, { type: 'messenger-error', code: 'group_settings_forbidden', message: 'Настройки чата может менять только владелец' });
                                    return;
                                }
                                const meta = {
                                    ...chat.meta,
                                    permissions: {
                                        ...(chat.meta?.permissions || {}),
                                        ...(data.permissions && typeof data.permissions === 'object' ? data.permissions : {})
                                    }
                                };
                                if (data.joinByLink !== undefined) meta.joinByLink = !!data.joinByLink;
                                await messengerMysql.updateChatMeta(chat.id, meta);
                            }
                            if (Object.keys(patch).length) {
                                await messengerMysql.updateGroupChatInfo(chat.id, patch);
                            }
                            chat = await messengerMysql.getChatById(chat.id);
                            const msg = await insertSystemMessage(
                                chat,
                                currentAppUserId,
                                `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} обновил(а) информацию чата`
                            );
                            if (msg) {
                                sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: msg });
                            }
                            await emitGroupChatUpdated(chat, 'group-updated');
                        })();
                    }
                    break;
                case 'messenger-add-group-members':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            let chat = await messengerMysql.getChatById(normalizeText(data.chatId || '', 220));
                            if (!chat || chat.kind !== 'group' || !chat.members.includes(currentAppUserId)) return;
                            if (!hasGroupPermission(chat, currentAppUserId, 'addMembers')) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_add_forbidden', message: 'Недостаточно прав для добавления участников' });
                                return;
                            }
                            await ensureProfilesLoaded(currentAppUserId, ...chat.members);
                            const actorFmt = getFormattedUser(currentAppUserId);
                            const requestedIds = Array.isArray(data.memberIds) ? data.memberIds.map((item) => normalizeAccountId(item)).filter(Boolean) : [];
                            const addedIds = [];
                            for (const memberId of requestedIds) {
                                if (!memberId || chat.members.includes(memberId)) continue;
                                if (!canUserBeAddedToGroup(currentAppUserId, memberId)) continue;
                                await messengerMysql.addGroupMember(chat.id, memberId, 'member', currentAppUserId);
                                addedIds.push(memberId);
                            }
                            if (!addedIds.length) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_no_members_added', message: 'Не удалось добавить выбранных участников' });
                                return;
                            }
                            chat = await messengerMysql.getChatById(chat.id);
                            for (const memberId of addedIds) {
                                const targetFmt = getFormattedUser(memberId);
                                const sys = await insertSystemMessage(
                                    chat,
                                    currentAppUserId,
                                    `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} добавил(а) ${makeSystemUserTag(memberId, targetFmt.displayName)} в чат`
                                );
                                if (sys) sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: sys });
                            }
                            await emitGroupChatUpdated(chat, 'group-members-added');
                        })();
                    }
                    break;
                case 'messenger-group-member-action':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            let chat = await messengerMysql.getChatById(normalizeText(data.chatId || '', 220));
                            const targetUserId = normalizeAccountId(data.targetUserId);
                            const action = normalizeText(data.action || '', 40);
                            if (!chat || chat.kind !== 'group' || !targetUserId || !chat.members.includes(currentAppUserId) || !chat.members.includes(targetUserId)) return;
                            const actorFmt = getFormattedUser(currentAppUserId);
                            const targetFmt = getFormattedUser(targetUserId);
                            const isOwner = getGroupParticipantRole(chat, currentAppUserId) === 'owner';
                            const canModerate = hasGroupPermission(chat, currentAppUserId, 'moderate');
                            if (!canManageGroupTarget(chat, currentAppUserId, targetUserId)) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_target_forbidden', message: 'Этим участником нельзя управлять' });
                                return;
                            }
                            if (action === 'toggle-admin') {
                                if (!isOwner) {
                                    safeSend(ws, { type: 'messenger-error', code: 'group_admin_forbidden', message: 'Назначать администраторов может только владелец' });
                                    return;
                                }
                                const nextRole = !!data.enabled ? 'admin' : 'member';
                                await messengerMysql.setGroupMemberRole(chat.id, targetUserId, nextRole);
                                chat = await messengerMysql.getChatById(chat.id);
                                const text = nextRole === 'admin'
                                    ? `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} назначил(а) ${makeSystemUserTag(targetUserId, targetFmt.displayName)} администратором`
                                    : `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} разжаловал(а) администратора ${makeSystemUserTag(targetUserId, targetFmt.displayName)}`;
                                const sys = await insertSystemMessage(chat, currentAppUserId, text);
                                if (sys) sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: sys });
                                await emitGroupChatUpdated(chat, 'group-role-updated');
                                return;
                            }
                            if (!canModerate) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_moderation_forbidden', message: 'Недостаточно прав для модерации' });
                                return;
                            }
                            if (action === 'kick') {
                                await messengerMysql.removeGroupMember(chat.id, targetUserId);
                                chat = await messengerMysql.getChatById(chat.id);
                                const sys = await insertSystemMessage(
                                    { ...chat, id: data.chatId, kind: 'group', members: [targetUserId, ...(chat?.members || [])] },
                                    currentAppUserId,
                                    `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} исключил(а) ${makeSystemUserTag(targetUserId, targetFmt.displayName)} из чата`
                                );
                                if (sys && chat) {
                                    sendToManyUserSessions([targetUserId, ...(chat.members || [])], { type: 'messenger-message', chatId: data.chatId, message: sys });
                                }
                                if (chat) await emitGroupChatUpdated(chat, 'group-member-kicked');
                                emitMessengerSync(targetUserId, 'group-member-kicked');
                                return;
                            }
                            if (action === 'mute' || action === 'ban') {
                                const result = await applyGroupPenalty(chat, currentAppUserId, targetUserId, action, data.durationValue, data.durationUnit, data.reason || '');
                                if (result?.message && result.chat) {
                                    sendToManyUserSessions(result.chat.members || [], { type: 'messenger-message', chatId: result.chat.id, message: result.message });
                                }
                                emitMessengerSync(targetUserId, 'group-penalty-updated');
                                return;
                            }
                            if (action === 'unmute' || action === 'unban') {
                                const result = await removeGroupPenalty(chat, currentAppUserId, targetUserId, action === 'unmute' ? 'mute' : 'ban');
                                if (result?.message && result.chat) {
                                    sendToManyUserSessions(result.chat.members || [], { type: 'messenger-message', chatId: result.chat.id, message: result.message });
                                }
                                emitMessengerSync(targetUserId, 'group-penalty-removed');
                            }
                        })();
                    }
                    break;
                case 'messenger-preview-group-invite':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const inviteCode = normalizeText(data.inviteCode || '', 120).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
                            if (!inviteCode) return;
                            const chat = await messengerMysql.getGroupChatByInviteCode(inviteCode);
                            if (!chat || chat.kind !== 'group') {
                                safeSend(ws, { type: 'messenger-error', code: 'invite_not_found', message: 'Приглашение не найдено' });
                                return;
                            }
                            safeSend(ws, {
                                type: 'messenger-group-invite-preview',
                                inviteCode,
                                chat: serializeGroupChatForClient(chat, currentAppUserId),
                                canJoin: !chat.members.includes(currentAppUserId) && chat.meta?.joinByLink !== false
                            });
                        })();
                    }
                    break;
                case 'messenger-join-group-by-invite':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const inviteCode = normalizeText(data.inviteCode || '', 120).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
                            if (!inviteCode) return;
                            let chat = await messengerMysql.getGroupChatByInviteCode(inviteCode);
                            if (!chat || chat.kind !== 'group') {
                                safeSend(ws, { type: 'messenger-error', code: 'invite_not_found', message: 'Приглашение не найдено' });
                                return;
                            }
                            if (chat.meta?.joinByLink === false) {
                                safeSend(ws, { type: 'messenger-error', code: 'invite_disabled', message: 'Вступление по ссылке отключено' });
                                return;
                            }
                            if (!chat.members.includes(currentAppUserId)) {
                                await messengerMysql.addGroupMember(chat.id, currentAppUserId, 'member', currentAppUserId);
                                chat = await messengerMysql.getChatById(chat.id);
                                const actorFmt = getFormattedUser(currentAppUserId);
                                const sys = await insertSystemMessage(
                                    chat,
                                    currentAppUserId,
                                    `${makeSystemUserTag(currentAppUserId, actorFmt.displayName)} присоединился(ась) по ссылке в чат`
                                );
                                if (sys) sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: sys });
                                await emitGroupChatUpdated(chat, 'group-joined-by-link');
                            }
                            safeSend(ws, { type: 'messenger-group-joined', chat: serializeGroupChatForClient(chat, currentAppUserId) });
                        })();
                    }
                    break;
                case 'messenger-create-group-call':
                    {
                        if (!currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const chatId = normalizeText(data.chatId || '', 220);
                            const chat = await messengerMysql.getChatById(chatId);
                            if (!chat || chat.kind !== 'group' || !chat.members.includes(currentAppUserId)) return;
                            if (!hasGroupPermission(chat, currentAppUserId, 'createCalls')) {
                                safeSend(ws, { type: 'messenger-error', code: 'group_call_forbidden', message: 'Недостаточно прав для создания звонка' });
                                return;
                            }
                            const existingRoomId = groupCallRoomsByChatId.get(chatId);
                            const existingRoom = existingRoomId ? rooms.get(existingRoomId) : null;
                            if (existingRoom) {
                                safeSend(ws, { type: 'messenger-group-call-ready', chatId, roomId: existingRoom.id, members: chat.members || [] });
                                return;
                            }
                            const roomId = `grp_call_${uuidv4().replace(/-/g, '').slice(0, 18)}`;
                            groupCallRoomsByChatId.set(chatId, roomId);
                            groupCallMetaByChatId.set(chatId, {
                                createdAt: Date.now(),
                                createdBy: currentAppUserId
                            });
                            const actorFmt = getFormattedUser(currentAppUserId);
                            const block = await insertGroupEventBlock(chat, currentAppUserId, {
                                type: 'group-call-created',
                                title: 'Групповой звонок',
                                roomId
                            });
                            if (block) {
                                sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: block });
                            }
                            await emitGroupChatUpdated(chat, 'group-call-created');
                            sendToManyUserSessions(chat.members || [], {
                                type: 'messenger-group-call-created',
                                chatId,
                                roomId,
                                byId: currentAppUserId,
                                byName: actorFmt.displayName
                            });
                            safeSend(ws, { type: 'messenger-group-call-ready', chatId, roomId, members: chat.members || [] });
                        })();
                    }
                    break;
                case 'messenger-friends-sync':
                    if (!currentAppUserId) return;
                    {
                        const ids = Array.isArray(data.friendIds) ? data.friendIds.map((v) => normalizeAccountId(v)).filter(Boolean) : [];
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (messengerMysql.isEnabled()) {
                                await upsertUserPresenceProfileMysql(currentAppUserId, { friendIds: ids });
                            }
                        })();
                    }
                    break;
                case 'messenger-send':
                case 'sendMessage':
                    {
                        if (!currentAppUserId) return;
                        const chatIdRequested = normalizeText(data.chatId || '', 220);
                        const toUserId = normalizeAccountId(data.toUserId || data.to);
                        if (!chatIdRequested && (!toUserId || toUserId === currentAppUserId)) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) {
                                safeSend(ws, {
                                    type: 'messenger-error',
                                    code: 'storage_unavailable',
                                    message: 'Messenger недоступен (нет PostgreSQL / DATABASE_URL)'
                                });
                                return;
                            }
                            let chat = null;
                            let recipientUserId = toUserId;
                            if (chatIdRequested) {
                                chat = await messengerMysql.getChatById(chatIdRequested);
                                if (!chat && toUserId && toUserId !== currentAppUserId) {
                                    chat = await messengerMysql.getOrCreateChat(currentAppUserId, toUserId);
                                }
                                if (!chat || !Array.isArray(chat.members) || !chat.members.includes(currentAppUserId)) return;
                                if (chat.kind === 'group') {
                                    const gate = canSendToGroupChat(chat, currentAppUserId);
                                    if (!gate.ok) {
                                        safeSend(ws, {
                                            type: 'messenger-error',
                                            code: 'write_forbidden',
                                            message: composeGroupWriteHint(gate),
                                            clientMessageId: normalizeText(data.clientMessageId || '', 100)
                                        });
                                        return;
                                    }
                                } else {
                                    recipientUserId = chat.members.find((item) => item !== currentAppUserId) || '';
                                    const gate = directMessageGate(currentAppUserId, recipientUserId);
                                    if (!gate.ok) {
                                        safeSend(ws, {
                                            type: 'messenger-error',
                                            code: 'write_forbidden',
                                            message: composeHintFromGate(gate),
                                            clientMessageId: normalizeText(data.clientMessageId || '', 100)
                                        });
                                        return;
                                    }
                                }
                            } else {
                                await ensureProfilesLoaded(currentAppUserId, toUserId);
                                const gate = directMessageGate(currentAppUserId, toUserId);
                                if (!gate.ok) {
                                    safeSend(ws, {
                                        type: 'messenger-error',
                                        code: 'write_forbidden',
                                        message: composeHintFromGate(gate),
                                        clientMessageId: normalizeText(data.clientMessageId || '', 100)
                                    });
                                    return;
                                }
                                chat = await messengerMysql.getOrCreateChat(currentAppUserId, toUserId);
                            }
                            if (!chat) return;
                            await ensureProfilesLoaded(currentAppUserId, ...(Array.isArray(chat.members) ? chat.members : []), recipientUserId);
                            const clientMessageId = normalizeText(data.clientMessageId || '', 100);
                            const messageId = clientMessageId || `msg_${uuidv4()}`;
                            let text = normalizeText(data.text, 4000);
                            const audioRaw = typeof data.audioBase64 === 'string' ? data.audioBase64 : '';
                            const isVoiceEarly =
                                audioRaw.replace(/[^a-zA-Z0-9+/=]/g, '').length > 32 &&
                                (data.messageKind === 'voice' || !!data.audioBase64);
                            const audioBase64 = audioRaw
                                .replace(/[^a-zA-Z0-9+/=]/g, '')
                                .slice(0, isVoiceEarly ? 2800000 : 720000);
                            const imageRaw = typeof data.imageBase64 === 'string' ? data.imageBase64 : '';
                            const imageBase64 = imageRaw.replace(/[^a-zA-Z0-9+/=]/g, '').slice(0, MAX_MEDIA_B64_LEN);
                            const videoRaw = typeof data.videoBase64 === 'string' ? data.videoBase64 : '';
                            const videoBase64 = videoRaw.replace(/[^a-zA-Z0-9+/=]/g, '').slice(0, MAX_MEDIA_B64_LEN);
                            const isVoice = audioBase64.length > 32 && (data.messageKind === 'voice' || !!data.audioBase64);
                            const isImage = imageBase64.length > 80 && data.messageKind === 'image';
                            const isVideo = videoBase64.length > 80 && data.messageKind === 'video';
                            const forwardedFromMessageId = normalizeText(data.forwardedFromMessageId || '', 64);
                            let forwardedPreview = {};
                            let forwardOriginal = null;
                            if (forwardedFromMessageId) {
                                forwardOriginal = await messengerMysql.getMessageById(forwardedFromMessageId);
                                if (forwardOriginal && !forwardOriginal.deletedAt) {
                                    const originChat = await messengerMysql.getChatById(forwardOriginal.chatId);
                                    const members = Array.isArray(originChat?.members) ? originChat.members : [];
                                    if (!members.includes(currentAppUserId)) {
                                        forwardOriginal = null;
                                    }
                                } else {
                                    forwardOriginal = null;
                                }
                                if (forwardOriginal) {
                                    await ensureProfilesLoaded(forwardOriginal.fromId);
                                    const fmt = getFormattedUser(forwardOriginal.fromId);
                                    forwardedPreview = {
                                        fromUserId: forwardOriginal.fromId,
                                        displayName: fmt.displayName,
                                        avatar: fmt.avatar,
                                        initials: fmt.initials,
                                        text: forwardOriginal.text || '',
                                        messageKind: forwardOriginal.messageKind || 'text'
                                    };
                                }
                            }
                            const forwardCloningAllowed = !!forwardOriginal && !isVoice && !isImage && !isVideo;
                            if (!text && !isVoice && !isImage && !isVideo && !forwardCloningAllowed) return;
                            const mimeRaw = typeof data.mimeType === 'string' ? data.mimeType : 'audio/webm';
                            const mimeNorm = String(mimeRaw || '').split(';')[0].trim();
                            const audioMime = /^audio\/(webm|ogg|mp4|mpeg|wav|m4a|x-m4a|aac|x-aac)$/i.test(mimeNorm)
                                ? mimeNorm.slice(0, 80)
                                : 'audio/webm';
                            const videoMimeRaw = typeof data.videoMime === 'string' ? data.videoMime : 'video/mp4';
                            const videoMime = /^video\/(webm|mp4|quicktime|ogg)$/i.test(videoMimeRaw) ? videoMimeRaw.slice(0, 80) : 'video/mp4';
                            let messageKind = 'text';
                            if (isVoice) messageKind = 'voice';
                            else if (isImage) messageKind = 'image';
                            else if (isVideo) messageKind = 'video';
                            let finalFileUrl = '';
                            let finalAudioMime = isVoice ? audioMime : '';
                            let finalImageMime = isImage ? normalizeText(data.mimeType || 'image/jpeg', 80) : '';
                            let finalVideoMime = isVideo ? videoMime : '';
                            let finalDurationMs = isVoice ? Math.min(600000, Math.max(0, Number(data.durationMs || 0))) : 0;
                            if (forwardCloningAllowed && forwardOriginal) {
                                if (!text) text = normalizeText(forwardOriginal.text || '', 4000);
                                const okKind = String(forwardOriginal.messageKind || '').trim();
                                if (okKind === 'voice' && (forwardOriginal.fileUrl || forwardOriginal.audioBase64)) {
                                    messageKind = 'voice';
                                    finalFileUrl = forwardOriginal.fileUrl || await materializeBase64(forwardOriginal.audioBase64, forwardOriginal.audioMime || 'audio/webm');
                                    finalAudioMime = String(forwardOriginal.audioMime || 'audio/webm').slice(0, 80);
                                    finalDurationMs = Math.min(600000, Math.max(0, Number(forwardOriginal.durationMs || 0)));
                                } else if (okKind === 'image' && (forwardOriginal.fileUrl || forwardOriginal.imageBase64)) {
                                    messageKind = 'image';
                                    finalFileUrl = forwardOriginal.fileUrl || await materializeBase64(forwardOriginal.imageBase64, forwardOriginal.mimeType || forwardOriginal.imageMime || 'image/jpeg');
                                    finalImageMime = String(forwardOriginal.mimeType || forwardOriginal.imageMime || 'image/jpeg').slice(0, 80);
                                } else if ((okKind === 'video' || okKind === 'video_note') && (forwardOriginal.fileUrl || forwardOriginal.videoBase64)) {
                                    messageKind = 'video';
                                    finalFileUrl = forwardOriginal.fileUrl || await materializeBase64(forwardOriginal.videoBase64, forwardOriginal.videoMime || 'video/mp4');
                                    finalVideoMime = String(forwardOriginal.videoMime || 'video/mp4').slice(0, 80);
                                }
                            }
                            if (!finalFileUrl) {
                                if (isVoice) {
                                    finalFileUrl = await materializeBase64(audioBase64, audioMime);
                                } else if (isImage) {
                                    finalFileUrl = await materializeBase64(imageBase64, normalizeText(data.mimeType || 'image/jpeg', 80));
                                } else if (isVideo) {
                                    finalFileUrl = await materializeBase64(videoBase64, videoMime);
                                }
                            }
                            const storyReplyId = normalizeText(data.storyReplyId || '', 100);
                            const storyReplyCaption = normalizeText(data.storyReplyCaption || '', 4000);
                            const storyReplyThumbnail = normalizeAvatarUrl(data.storyReplyThumbnail || '');
                            const message = {
                                id: messageId,
                                chatId: chat.id,
                                fromId: currentAppUserId,
                                toId: chat.kind === 'group' ? chat.id : recipientUserId,
                                text:
                                    text ||
                                    (isVoice ? 'Голосовое сообщение' : '') ||
                                    (isImage ? '📷 Фото' : '') ||
                                    (isVideo ? '🎬 Видео' : '') ||
                                    '',
                                messageKind,
                                audioMime: finalAudioMime,
                                audioBase64: '',
                                fileUrl: finalFileUrl,
                                mimeType: finalImageMime,
                                videoBase64: '',
                                videoMime: finalVideoMime,
                                durationMs: finalDurationMs,
                                createdAt: Date.now(),
                                editedAt: 0,
                                deletedAt: 0,
                                replyTo: normalizeText(data.replyTo || '', 64),
                                forwardedFromMessageId,
                                forwardedPreview,
                                reactions: {},
                                storyReplyId,
                                storyReplyCaption,
                                storyReplyThumbnail,
                                // Галочки: 1) доставлено получателю (после рассылки в его сессии)
                                // 2) прочитано — когда получатель открыл диалог.
                                deliveredBy: chat.kind === 'group'
                                    ? (chat.members || []).filter((item) => item !== currentAppUserId)
                                    : [recipientUserId],
                                readBy: []
                            };
                            try {
                                await messengerMysql.insertMessage(message);
                                const meta = {
                                    ...chat.meta,
                                    removedBy: Object.fromEntries(
                                        (chat.members || []).map((uid) => [uid, false])
                                    )
                                };
                                await messengerMysql.updateChatMeta(chat.id, meta);
                                const preview = {
                                    id: message.id,
                                    text: message.text,
                                    fromId: message.fromId,
                                    createdAt: message.createdAt,
                                    editedAt: 0,
                                    messageKind: message.messageKind,
                                    audioBase64: ''
                                };
                                await messengerMysql.updateLastMessagePreview(chat.id, preview, Date.now());
                            } catch (err) {
                                console.error('[messenger] mysql insertMessage', err && err.stack ? err.stack : (err && err.message));
                                safeSend(ws, {
                                    type: 'messenger-error',
                                    code: 'save_failed',
                                    message: `Не удалось сохранить сообщение: ${String(err?.message || err || '').slice(0, 220)}`,
                                    clientMessageId
                                    // Для очистки локального pending-сообщения можно будет использовать clientMessageId
                                });
                                return;
                            }
                            const msgOut = enrichMessageWithSender(message);
                            sendToUserSessions(currentAppUserId, { type: 'messenger-message', chatId: chat.id, message: msgOut });
                            sendToManyUserSessions(chat.members || [], { type: 'messenger-message', chatId: chat.id, message: msgOut }, currentAppUserId);
                            emitMessengerSync(currentAppUserId, 'new-message');
                            (chat.members || []).forEach((uid) => {
                                if (uid !== currentAppUserId) emitMessengerSync(uid, 'new-message');
                            });
                        })();
                    }
                    break;
                case 'messenger-typing':
                    {
                        if (!currentAppUserId) return;
                        const chatId = normalizeText(data.chatId || '', 220);
                        const toUserId = normalizeAccountId(data.toUserId);
                        const activityRaw = typeof data.activity === 'string' ? data.activity : (typeof data.kind === 'string' ? data.kind : '');
                        const activity = ['text', 'voice'].includes(String(activityRaw || '').trim()) ? String(activityRaw || '').trim() : 'text';
                        if (chatId) {
                            void (async () => {
                                try {
                                    await mysqlBoot;
                                } catch (_) {}
                                if (!messengerMysql.isEnabled()) return;
                                const chat = await messengerMysql.getChatById(chatId);
                                if (!chat || !Array.isArray(chat.members) || !chat.members.includes(currentAppUserId)) return;
                                sendToManyUserSessions(chat.members || [], {
                                    type: 'messenger-typing',
                                    fromUserId: currentAppUserId,
                                    chatId,
                                    isTyping: !!data.isTyping,
                                    activity,
                                    ts: Date.now()
                                }, currentAppUserId);
                            })();
                            return;
                        }
                        if (!toUserId || toUserId === currentAppUserId) return;
                        sendToUserSessions(toUserId, {
                            type: 'messenger-typing',
                            fromUserId: currentAppUserId,
                            chatId: createDirectChatId(currentAppUserId, toUserId),
                            isTyping: !!data.isTyping,
                            activity,
                            ts: Date.now()
                        });
                    }
                    break;
                case 'messenger-message-read':
                    {
                        // Сообщение прочитано в открытом диалоге на клиенте.
                        // currentAppUserId — это получатель (который прочитал),
                        // senderId — отправитель (которому надо показать "две галочки").
                        if (!currentAppUserId) return;
                        const chatId = normalizeText(data.chatId || '', 220);
                        const messageId = normalizeText(data.messageId || '', 100);
                        const senderId = normalizeAccountId(data.senderId || '');
                        if (!chatId || !messageId || !senderId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            // Пишем прочтение в БД, чтобы после перезагрузки галочки не исчезали.
                            await messengerMysql.addMessageReadBy(messageId, currentAppUserId);
                            sendToUserSessions(senderId, {
                                type: 'messenger-message-receipt',
                                chatId,
                                messageId,
                                receipt: 'read',
                                readBy: currentAppUserId
                            });
                        })();
                    }
                    break;
                case 'messenger-edit':
                    {
                        if (!currentAppUserId) return;
                        const messageId = normalizeText(data.messageId || '', 80);
                        const nextText = normalizeText(data.text, 4000);
                        if (!messageId || !nextText) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            let row = await messengerMysql.getMessageById(messageId);
                            if (!row || row.fromId !== currentAppUserId || row.deletedAt) return;
                            await messengerMysql.updateMessageFields(messageId, { text: nextText, editedAt: Date.now() });
                            row = enrichMessageWithSender({ ...row, text: nextText, editedAt: Date.now() });
                            const chat = await messengerMysql.getChatById(row.chatId);
                            if (!chat) return;
                            if (String(chat.lastMessage?.id || '') === String(messageId)) {
                                const preview = {
                                    id: row.id,
                                    text: row.text,
                                    fromId: row.fromId,
                                    createdAt: row.createdAt,
                                    editedAt: row.editedAt || 0,
                                    messageKind: row.messageKind || 'text',
                                    audioBase64: ''
                                };
                                await messengerMysql.updateLastMessagePreview(row.chatId, preview, Date.now());
                            }
                            const payload = { type: 'messenger-message-updated', chatId: row.chatId, message: row };
                            sendToUserSessions(currentAppUserId, payload);
                            sendToManyUserSessions(chat.members || [], payload, currentAppUserId);
                        })();
                    }
                    break;
                case 'messenger-delete':
                    {
                        if (!currentAppUserId) return;
                        const messageId = normalizeText(data.messageId || '', 80);
                        if (!messageId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const row = await messengerMysql.getMessageById(messageId);
                            if (!row || row.fromId !== currentAppUserId || row.deletedAt) return;
                            const chatId = row.chatId;
                            await messengerMysql.deleteMessageByIdHard(messageId);
                            const chat = await messengerMysql.getChatById(chatId);
                            if (!chat) return;
                            if (String(chat.lastMessage?.id || '') === String(messageId)) {
                                await refreshChatLastPreview(chatId);
                            }
                            const payload = { type: 'messenger-message-deleted', chatId, messageId };
                            sendToUserSessions(currentAppUserId, payload);
                            sendToManyUserSessions(chat.members || [], payload, currentAppUserId);
                        })();
                    }
                    break;
                case 'messenger-react':
                    {
                        if (!currentAppUserId) return;
                        const chatId = normalizeText(data.chatId || '', 220);
                        const messageId = normalizeText(data.messageId || '', 100);
                        const emoji = normalizeReactionEmoji(data.emoji);
                        if (!chatId || !messageId || !emoji) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const chat = await messengerMysql.getChatById(chatId);
                            if (!chat || !Array.isArray(chat.members) || !chat.members.includes(currentAppUserId)) return;
                            const row = await messengerMysql.getMessageById(messageId);
                            if (!row || String(row.chatId || '') !== String(chatId) || row.deletedAt) return;
                            const reactions = normalizeReactionsObject(row.reactions || {});
                            const me = normalizeAccountId(currentAppUserId);
                            const prevUsers = Array.isArray(reactions[emoji]) ? reactions[emoji].map(String) : [];
                            const had = prevUsers.includes(me);
                            const nextUsers = had ? prevUsers.filter((u) => u !== me) : [...prevUsers, me];
                            if (nextUsers.length) reactions[emoji] = Array.from(new Set(nextUsers));
                            else delete reactions[emoji];
                            await messengerMysql.updateMessageFields(messageId, { reactions });
                            const payload = { type: 'messenger-message-reactions', chatId, messageId, reactions };
                            sendToUserSessions(currentAppUserId, payload);
                            sendToManyUserSessions(chat.members || [], payload, currentAppUserId);
                        })();
                    }
                    break;
                case 'messenger-clear-chat':
                    {
                        if (!currentAppUserId) return;
                        const chatId = normalizeText(data.chatId || '', 220);
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const ch = await messengerMysql.getChatById(chatId);
                            if (!ch || !Array.isArray(ch.members) || !ch.members.includes(currentAppUserId)) return;
                            const meta = {
                                ...ch.meta,
                                clearedBy: { ...(ch.meta?.clearedBy || {}), [currentAppUserId]: Date.now() }
                            };
                            await messengerMysql.updateChatMeta(chatId, meta);
                            emitMessengerSync(currentAppUserId, 'chat-cleared');
                        })();
                    }
                    break;
                case 'messenger-delete-chat':
                    {
                        if (!currentAppUserId) return;
                        const chatId = normalizeText(data.chatId || '', 220);
                        const forEveryone = !!data.forEveryone;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            if (!messengerMysql.isEnabled()) return;
                            const ch = await messengerMysql.getChatById(chatId);
                            if (!ch || !Array.isArray(ch.members) || !ch.members.includes(currentAppUserId)) return;
                            if (forEveryone) {
                                if (ch.kind === 'group' && normalizeAccountId(ch.createdBy || ch.meta?.ownerId || '') !== currentAppUserId) {
                                    safeSend(ws, {
                                        type: 'messenger-error',
                                        code: 'group_delete_forbidden',
                                        message: 'Удалить групповой чат для всех может только владелец'
                                    });
                                    return;
                                }
                                await messengerMysql.deleteChatRow(chatId);
                                sendToManyUserSessions(ch.members || [], { type: 'messenger-chat-deleted', chatId, scope: 'all' });
                                (ch.members || []).forEach((uid) => emitMessengerSync(uid, 'chat-removed'));
                            } else {
                                const meta = {
                                    ...ch.meta,
                                    removedBy: { ...(ch.meta?.removedBy || {}), [currentAppUserId]: true }
                                };
                                await messengerMysql.updateChatMeta(chatId, meta);
                                emitMessengerSync(currentAppUserId, 'chat-removed');
                            }
                        })();
                    }
                    break;
                case 'messenger-block-user':
                    {
                        if (!currentAppUserId) return;
                        const targetId = normalizeAccountId(data.targetUserId);
                        if (!targetId || targetId === currentAppUserId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            await ensureProfilesLoaded(currentAppUserId);
                            const profile = getUserProfile(currentAppUserId) || { blacklist: [] };
                            const set = new Set(Array.isArray(profile.blacklist) ? profile.blacklist : []);
                            const blacklistMeta =
                                typeof profile.blacklistMeta === 'object' && profile.blacklistMeta ? profile.blacklistMeta : {};
                            if (!!data.blocked) {
                                set.add(targetId);
                                const note = normalizeText(data.comment || '', 180);
                                if (note) blacklistMeta[targetId] = note;
                            } else {
                                set.delete(targetId);
                                delete blacklistMeta[targetId];
                            }
                            if (messengerMysql.isEnabled()) {
                                await upsertUserPresenceProfileMysql(currentAppUserId, {
                                    ...profile,
                                    blacklist: Array.from(set),
                                    blacklistMeta
                                });
                            }
                            emitMessengerSync(currentAppUserId, 'blacklist-updated');
                            // Блокировка влияет на возможность писать обеим сторонам.
                            emitMessengerComposeStatus(currentAppUserId, targetId);
                            emitMessengerComposeStatus(targetId, currentAppUserId);
                        })();
                    }
                    break;
                case 'messenger-get-profile':
                    {
                        if (!currentAppUserId) return;
                        const targetId = normalizeAccountId(data.targetUserId);
                        if (!targetId) return;
                        void (async () => {
                            try {
                                await mysqlBoot;
                            } catch (_) {}
                            await ensureProfilesLoaded(targetId, currentAppUserId);
                            safeSend(ws, {
                                type: 'messenger-profile',
                                targetUserId: targetId,
                                view: buildProfileViewFor(currentAppUserId, targetId)
                            });
                        })();
                    }
                    break;
                case 'messenger-update-profile':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        const normalizedUsername = normalizeUsername(data.username || '');
                        if (messengerMysql.isEnabled() && normalizedUsername) {
                            const availability = await messengerMysql.isUsernameAvailable(normalizedUsername, currentAppUserId);
                            if (!availability.available) {
                                safeSend(ws, { type: 'messenger-error', code: 'username_taken', message: 'Этот username уже занят' });
                                return;
                            }
                        }
                        const patch = {
                            name: data.name,
                            avatar: data.avatar,
                            coverUrl: data.coverUrl,
                            username: data.username,
                            statusText: data.statusText
                        };
                        if (messengerMysql.isEnabled()) {
                            await upsertUserPresenceProfileMysql(currentAppUserId, patch);
                        }
                        emitMessengerSync(currentAppUserId, 'profile-updated');
                        // Разошлем патч профиля всем подключенным клиентам,
                        // чтобы аватары/имена обновлялись без перезагрузки.
                        broadcastMessengerProfilePatch(currentAppUserId);
                        if (messengerMysql.isEnabled()) {
                            const chats = await messengerMysql.listChatsForUser(normalizeAccountId(currentAppUserId));
                            for (const ch of (chats || [])) {
                                const members = Array.isArray(ch.members) ? ch.members : [];
                                const peerId = members.find((m) => m !== normalizeAccountId(currentAppUserId)) || '';
                                if (!peerId) continue;
                                emitMessengerSync(peerId, 'peer-profile-updated');
                            }
                        }
                    })();
                    break;
                case 'messenger-update-appearance':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;
                        const appearancePatch = {};
                        if (Object.prototype.hasOwnProperty.call(data, 'theme')) {
                            appearancePatch.theme = String(data.theme || '').trim() === 'dark' ? 'dark' : 'classic';
                        }
                        if (Object.prototype.hasOwnProperty.call(data, 'chatWallpaper')) {
                            const raw = typeof data.chatWallpaper === 'string' ? String(data.chatWallpaper || '').trim() : '';
                            if (!raw) {
                                appearancePatch.chatWallpaper = '';
                            } else if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(raw) && raw.length <= 3500000) {
                                appearancePatch.chatWallpaper = raw;
                            } else {
                                safeSend(ws, { type: 'messenger-error', code: 'wallpaper_invalid', message: 'Неверный формат обоев' });
                                return;
                            }
                        }
                        if (Object.prototype.hasOwnProperty.call(data, 'chatWallpaperBlur')) {
                            appearancePatch.chatWallpaperBlur = !!data.chatWallpaperBlur;
                        }
                        if (!Object.keys(appearancePatch).length) return;
                        await upsertUserPresenceProfileMysql(
                            currentAppUserId,
                            { appearance: appearancePatch },
                            { overwriteExistingIdentity: false, overwriteExistingPrivacy: false }
                        );
                        emitMessengerSync(currentAppUserId, 'appearance-updated');
                    })();
                    break;
                case 'messenger-check-username':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        const normalizedUsername = normalizeUsername(data.username || '');
                        if (!messengerMysql.isEnabled()) {
                            safeSend(ws, { type: 'messenger-username-status', username: normalizedUsername, available: true });
                            return;
                        }
                        const availability = await messengerMysql.isUsernameAvailable(normalizedUsername, currentAppUserId);
                        safeSend(ws, {
                            type: 'messenger-username-status',
                            username: normalizedUsername,
                            available: !!availability.available
                        });
                    })();
                    break;
                case 'messenger-update-privacy':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        const patch = {
                            privacy: {
                                canWrite: data.canWrite,
                                canCall: data.canCall,
                                canViewProfile: data.canViewProfile,
                                canSeeStories: data.canSeeStories,
                                canJoinGroups: data.canJoinGroups
                            }
                        };
                        if (messengerMysql.isEnabled()) {
                            await upsertUserPresenceProfileMysql(currentAppUserId, patch);
                        }
                        emitMessengerSync(currentAppUserId, 'privacy-updated');
                        // Приватность влияет на то, могут ли другие писать текущему пользователю.
                        // Поэтому обновляем compose-status всем участникам прямых чатов текущего пользователя.
                        if (messengerMysql.isEnabled()) {
                            const chats = await messengerMysql.listChatsForUser(normalizeAccountId(currentAppUserId));
                            for (const ch of (chats || [])) {
                                const members = Array.isArray(ch.members) ? ch.members : [];
                                const peerId = members.find((m) => m !== normalizeAccountId(currentAppUserId)) || '';
                                if (!peerId) continue;
                                emitMessengerComposeStatus(peerId, currentAppUserId);
                            }
                        }
                    })();
                    break;
                case 'messenger-upload-story':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) {
                            safeSend(ws, { type: 'error', message: 'База данных недоступна' });
                            return;
                        }
                        
                        const storyVideo = await materializeDataUrl(
                            normalizeText(data.videoUrl || '', MAX_STORY_VIDEO_URL_LENGTH),
                            normalizeText(data.videoMime || 'video/mp4', 80)
                        );
                        if (!storyVideo) {
                            safeSend(ws, { type: 'error', message: 'Видео обязательно' });
                            return;
                        }
                        const videoUrl = storyVideo.url;
                        const videoMime = (storyVideo.mime || normalizeText(data.videoMime || 'video/mp4', 80)).slice(0, 80);
                        const durationMs = Math.max(0, Math.min(20000, Number(data.durationMs) || 0)); // Max 20 seconds
                        const thumb = await materializeDataUrl(
                            normalizeText(data.thumbnailUrl || '', MAX_STORY_THUMBNAIL_URL_LENGTH),
                            'image/jpeg'
                        );
                        const thumbnailUrl = thumb ? thumb.url : '';
                        const caption = normalizeText(data.caption || '', 500);
                        
                        if (!videoUrl) {
                            safeSend(ws, { type: 'error', message: 'Видео обязательно' });
                            return;
                        }
                        
                        // Check story limit (max 5 active stories)
                        const activeCount = await messengerMysql.getActiveStoriesCount(currentAppUserId);
                        if (activeCount >= 5) {
                            safeSend(ws, { type: 'error', message: 'Максимум 5 активных историй' });
                            return;
                        }
                        
                        const storyId = 'story_' + uuidv4();
                        const story = {
                            id: storyId,
                            userId: currentAppUserId,
                            videoUrl,
                            videoMime,
                            durationMs,
                            thumbnailUrl,
                            caption,
                            privacy: ['all', 'friends', 'nobody'].includes(data.privacy) ? data.privacy : 'friends'
                        };
                        
                        await messengerMysql.createStory(story);
                        emitMessengerSync(currentAppUserId, 'story-uploaded');
                        broadcastStoryStateChanged(currentAppUserId, 'uploaded');
                        safeSend(ws, { type: 'messenger-story-uploaded', storyId });
                    })();
                    break;
                case 'messenger-get-stories':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) {
                            safeSend(ws, { type: 'error', message: 'База данных недоступна' });
                            return;
                        }
                        
                        const targetUserId = normalizeAccountId(data.targetUserId);
                        if (!targetUserId) return;
                        
                        const stories = await messengerMysql.getStoriesForUser(targetUserId, currentAppUserId);
                        safeSend(ws, { 
                            type: 'messenger-stories', 
                            targetUserId,
                            stories 
                        });
                    })();
                    break;
                case 'messenger-check-story-like':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) {
                            safeSend(ws, { type: 'error', message: 'База данных недоступна' });
                            return;
                        }
                        
                        const storyId = normalizeText(data.storyId || '', 100);
                        if (!storyId) return;
                        
                        const result = await messengerMysql.checkStoryLike(storyId, currentAppUserId);
                        safeSend(ws, { 
                            type: 'messenger-story-like-status', 
                            storyId,
                            liked: result.liked 
                        });
                    })();
                    break;
                case 'messenger-view-story':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;

                        const storyId = normalizeText(data.storyId || '', 100);
                        if (!storyId) return;

                        const story = await messengerMysql.getStoryById(storyId);
                        if (!story) return;
                        const visibleStories = await messengerMysql.getStoriesForUser(story.userId, currentAppUserId);
                        const canAccess = String(story.userId || '') === String(currentAppUserId || '')
                            || visibleStories.some((item) => String(item.id || '') === storyId);
                        if (!canAccess) {
                            safeSend(ws, { type: 'error', message: 'Доступ к истории запрещен' });
                            return;
                        }
                        if (String(story.userId || '') !== String(currentAppUserId || '')) {
                            await messengerMysql.addStoryView(storyId, currentAppUserId);
                        }
                        safeSend(ws, { type: 'messenger-story-view-result', storyId, ok: true });
                    })();
                    break;
                case 'messenger-like-story':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;

                        const storyId = normalizeText(data.storyId || '', 100);
                        if (!storyId) return;

                        const story = await messengerMysql.getStoryById(storyId);
                        if (!story) return;
                        const visibleStories = await messengerMysql.getStoriesForUser(story.userId, currentAppUserId);
                        const canAccess = String(story.userId || '') === String(currentAppUserId || '')
                            || visibleStories.some((item) => String(item.id || '') === storyId);
                        if (!canAccess) {
                            safeSend(ws, { type: 'error', message: 'Доступ к истории запрещен' });
                            return;
                        }
                        if (String(story.userId || '') === String(currentAppUserId || '')) {
                            safeSend(ws, { type: 'error', message: 'Нельзя лайкать свою историю' });
                            return;
                        }
                        await messengerMysql.addStoryView(storyId, currentAppUserId);
                        const result = await messengerMysql.toggleStoryLike(storyId, currentAppUserId);
                        safeSend(ws, {
                            type: 'messenger-story-like-result',
                            storyId,
                            liked: result.liked
                        });
                    })();
                    break;
                case 'messenger-comment-story':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;

                        const storyId = normalizeText(data.storyId || '', 100);
                        const comment = normalizeText(data.comment || '', 500);
                        if (!storyId || !comment) return;

                        const story = await messengerMysql.getStoryById(storyId);
                        if (!story) return;
                        const visibleStories = await messengerMysql.getStoriesForUser(story.userId, currentAppUserId);
                        const canAccess = String(story.userId || '') === String(currentAppUserId || '')
                            || visibleStories.some((item) => String(item.id || '') === storyId);
                        if (!canAccess) {
                            safeSend(ws, { type: 'error', message: 'Доступ к истории запрещен' });
                            return;
                        }
                        if (String(story.userId || '') === String(currentAppUserId || '')) {
                            safeSend(ws, { type: 'error', message: 'Нельзя комментировать свою историю' });
                            return;
                        }
                        await messengerMysql.addStoryComment(storyId, currentAppUserId, comment);
                        safeSend(ws, {
                            type: 'messenger-story-comment-result',
                            storyId,
                            comment
                        });
                    })();
                    break;
                case 'messenger-get-story-views':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;
                        
                        const storyId = normalizeText(data.storyId || '', 100);
                        if (!storyId) return;
                        
                        const story = await messengerMysql.getStoryById(storyId);
                        if (!story || story.userId !== currentAppUserId) {
                            safeSend(ws, { type: 'error', message: 'Доступ запрещен' });
                            return;
                        }
                        
                        const views = await messengerMysql.getStoryViews(storyId);
                        safeSend(ws, { 
                            type: 'messenger-story-views', 
                            storyId,
                            views 
                        });
                    })();
                    break;
                case 'messenger-update-story-privacy':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;

                        const storyId = normalizeText(data.storyId || '', 100);
                        const privacy = ['all', 'friends', 'nobody'].includes(data.privacy) ? data.privacy : 'friends';
                        if (!storyId) return;

                        const success = await messengerMysql.updateStoryPrivacy(storyId, currentAppUserId, privacy);
                        if (!success) {
                            safeSend(ws, { type: 'error', message: 'Не удалось сохранить приватность истории' });
                            return;
                        }

                        emitMessengerSync(currentAppUserId, 'story-privacy-updated');
                        broadcastStoryStateChanged(currentAppUserId, 'privacy-updated');
                        safeSend(ws, { type: 'messenger-story-privacy-updated', storyId, privacy });
                    })();
                    break;
                case 'messenger-delete-story':
                    if (!currentAppUserId) return;
                    void (async () => {
                        try {
                            await mysqlBoot;
                        } catch (_) {}
                        if (!messengerMysql.isEnabled()) return;
                        
                        const storyId = normalizeText(data.storyId || '', 100);
                        if (!storyId) return;
                        
                        const success = await messengerMysql.deleteStory(storyId, currentAppUserId);
                        if (success) {
                            emitMessengerSync(currentAppUserId, 'story-deleted');
                            broadcastStoryStateChanged(currentAppUserId, 'deleted');
                            safeSend(ws, { type: 'messenger-story-deleted', storyId });
                        } else {
                            safeSend(ws, { type: 'error', message: 'История не найдена' });
                        }
                    })();
                    break;

                case 'create':
                case 'join':
                    currentRoom = data.roomId;
                    userName = data.userName;
                    const userAvatar = data.userAvatar || '';
                    const appUserId = typeof data.appUserId === 'string' ? data.appUserId.trim().slice(0, 80) : '';
                    const isCreating = data.type === 'create';
                    const privateRoomRequested = !!data.privateRoom;
                    const friendCallModeRequested = !!data.friendCallMode;
                    const friendTargetAppUserId = typeof data.friendTargetAppUserId === 'string' ? data.friendTargetAppUserId.trim().slice(0, 80) : '';
                    const reconnectKey = typeof data.reconnectKey === 'string' ? data.reconnectKey.trim().slice(0, 160) : '';
                    const groupChatId = normalizeText(data.groupChatId || '', 220);
                    const groupCallAllowedUserIds = Array.isArray(data.groupCallAllowedUserIds)
                        ? Array.from(new Set(data.groupCallAllowedUserIds.map((item) => normalizeAccountId(item)).filter(Boolean)))
                        : [];

                    if (!currentRoom || typeof currentRoom !== 'string') {
                        safeSend(ws, { type: 'error', message: 'Некорректный идентификатор комнаты' });
                        return;
                    }

                    if (isCreating && friendCallModeRequested && friendTargetAppUserId) {
                        const cg = outgoingCallGate(appUserId, friendTargetAppUserId);
                        if (!cg.ok) {
                            safeSend(ws, { type: 'error', message: composeCallHintFromGate(cg) });
                            return;
                        }
                    }

                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, {
                            id: currentRoom,
                            participants: new Map(),
                            joinRequests: new Map(),
                            ownerId: null,
                            watchParty: null,
                            durak: null,
                            isPrivate: privateRoomRequested,
                            isFriendCall: friendCallModeRequested,
                            friendTargetAppUserId,
                            groupChatId,
                            createdAt: Date.now(),
                            createdByAppUserId: appUserId || '',
                            allowedAppUserIds: groupCallAllowedUserIds
                        });
                    }
                    const room = rooms.get(currentRoom);
                    if (groupChatId && !room.groupChatId) {
                        room.groupChatId = groupChatId;
                    }
                    if (groupCallAllowedUserIds.length && (!Array.isArray(room.allowedAppUserIds) || !room.allowedAppUserIds.length)) {
                        room.allowedAppUserIds = groupCallAllowedUserIds;
                    }
                    cancelRoomEmptyCleanup(currentRoom);
                    const reconnectTargetId = findParticipantIdByReconnectKey(room, reconnectKey);
                    if (room.groupChatId && appUserId && Array.isArray(room.allowedAppUserIds) && room.allowedAppUserIds.length && !room.allowedAppUserIds.includes(appUserId) && !reconnectTargetId) {
                        safeSend(ws, { type: 'error', message: 'Этот групповой звонок доступен только участникам чата' });
                        return;
                    }
                    if (!isCreating && room.isFriendCall && isInvitedFriendForRoom(room, appUserId) && !reconnectTargetId) {
                        const ownerPart = room.ownerId ? room.participants.get(room.ownerId) : null;
                        const callerAid = normalizeAccountId(ownerPart?.appUserId || '');
                        if (callerAid) {
                            const cg = outgoingCallGate(callerAid, appUserId);
                            if (!cg.ok) {
                                safeSend(ws, { type: 'error', message: composeCallHintFromGate(cg) });
                                return;
                            }
                        }
                    }
                    if (isCreating && room.participants.size > 0 && !reconnectTargetId) {
                        safeSend(ws, { type: 'error', message: 'Комната уже используется' });
                        return;
                    }
                    if (!isCreating && room.isPrivate && room.participants.size > 0 && !reconnectTargetId) {
                        const invitedFriend = isInvitedFriendForRoom(room, appUserId);
                        if (room.isFriendCall && !invitedFriend) {
                            safeSend(ws, { type: 'error', message: 'Комната закрыта' });
                            return;
                        }
                        const shouldQueueJoinRequest = !room.isFriendCall || !invitedFriend;
                        if (shouldQueueJoinRequest) {
                            const request = {
                                id: clientId,
                                ws,
                                userName,
                                userAvatar,
                                appUserId,
                                reconnectKey,
                                requestedAt: Date.now()
                            };
                            room.joinRequests.set(clientId, request);
                            safeSend(ws, {
                                type: 'join-pending',
                                roomId: currentRoom
                            });
                            broadcastJoinRequestToModerators(room, {
                                type: 'join-request',
                                roomId: currentRoom,
                                request: serializeJoinRequest(request)
                            });
                            return;
                        }
                    }

                    if (reconnectTargetId && room.participants.has(reconnectTargetId)) {
                        const existing = room.participants.get(reconnectTargetId);
                        const oldWs = existing?.ws;
                        clearPendingDisconnect(currentRoom, reconnectTargetId);
                        const participantInfo = {
                            ...existing,
                            ws,
                            userName,
                            userAvatar,
                            appUserId: appUserId || existing?.appUserId || '',
                            reconnectKey: reconnectKey || existing?.reconnectKey || ''
                        };
                        room.participants.set(reconnectTargetId, participantInfo);
                        ws.__participantId = reconnectTargetId;
                        room.joinRequests.delete(clientId);
                        room.joinRequests.delete(reconnectTargetId);
                        ensureOwnerAdmin(room);
                        safeSend(ws, {
                            type: isCreating ? 'created' : 'joined',
                            roomId: currentRoom,
                            groupChatId: room.groupChatId || '',
                            myId: reconnectTargetId,
                            ownerId: room.ownerId,
                            iceServers: ACTIVE_ICE_SERVERS
                        });
                        broadcastRoomState(room);
                        if (room.groupChatId) {
                            groupCallRoomsByChatId.set(room.groupChatId, room.id);
                            void sendGroupChatPayloadUpdate(room.groupChatId, 'group-call-state');
                        }
                        if (room.durak) {
                            safeSend(ws, {
                                type: 'durak-state',
                                game: durakEngine.exportGamePublic(room.durak, reconnectTargetId)
                            });
                        }
                        if (oldWs && oldWs !== ws) {
                            oldWs.__superseded = true;
                            try { oldWs.close(); } catch (_) {}
                        }
                        console.log(`🔁 User ${userName} reconnected in room: ${currentRoom}`);
                        break;
                    }

                    const participantInfo = {
                        ws,
                        userName,
                        userAvatar,
                        appUserId,
                        video: false,
                        audio: true,
                        screen: false,
                        speaking: false,
                        isAdmin: false,
                        cameraFacingMode: 'user',
                        reconnectKey
                    };

                    room.participants.set(clientId, participantInfo);
                    ws.__participantId = clientId;
                    room.joinRequests.delete(clientId);
                    if (!room.ownerId) {
                        room.ownerId = clientId;
                    }
                    ensureOwnerAdmin(room);

                    room.participants.forEach((participant, id) => {
                        if (id === clientId) return;
                        safeSend(participant.ws, {
                            type: 'guest-joined',
                            guest: serializeParticipant(clientId, participantInfo),
                            ownerId: room.ownerId,
                            iceServers: ACTIVE_ICE_SERVERS
                        });
                    });

                    safeSend(ws, {
                        type: isCreating ? 'created' : 'joined',
                        roomId: currentRoom,
                        groupChatId: room.groupChatId || '',
                        myId: clientId,
                        ownerId: room.ownerId,
                        iceServers: ACTIVE_ICE_SERVERS
                    });

                    broadcastRoomState(room);
                    if (room.groupChatId) {
                        groupCallRoomsByChatId.set(room.groupChatId, room.id);
                        void sendGroupChatPayloadUpdate(room.groupChatId, 'group-call-state');
                    }
                    if (room.durak) {
                        safeSend(ws, {
                            type: 'durak-state',
                            game: durakEngine.exportGamePublic(room.durak, clientId)
                        });
                    }

                    console.log(`🏠 User ${userName} ${isCreating ? 'created' : 'joined'} room: ${currentRoom}`);
                    break;

                case 'signal':
                case 'screen-signal':
                case 'video-signal':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        
                        const targetId = data.targetId || data.target;
                        if (targetId) {
                            const target = room.participants.get(targetId);
                            if (target) {
                                safeSend(target.ws, { 
                                    ...data, 
                                    from: userName, 
                                    fromId: senderId 
                                });
                            }
                        } else {
                            room.participants.forEach((p, id) => {
                                if (id !== senderId) {
                                    safeSend(p.ws, { 
                                        ...data, 
                                        from: userName, 
                                        fromId: senderId 
                                    });
                                }
                            });
                        }
                    }
                    break;

                case 'start-screen':
                case 'stop-screen':
                case 'toggle-video':
                case 'toggle-audio':
                case 'speaking':
                case 'camera-facing':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        const p = room.participants.get(senderId);
                        if (!p) return;

                        if (data.type === 'start-screen') p.screen = true;
                        if (data.type === 'stop-screen') p.screen = false;
                        if (data.type === 'toggle-video') p.video = data.enabled;
                        if (data.type === 'toggle-audio') p.audio = data.enabled;
                        if (data.type === 'speaking') p.speaking = !!data.isSpeaking;
                        if (data.type === 'camera-facing') p.cameraFacingMode = data.mode === 'environment' ? 'environment' : 'user';

                        room.participants.forEach((participant, id) => {
                            if (id !== senderId) {
                                safeSend(participant.ws, {
                                    ...data,
                                    from: userName,
                                    fromId: senderId
                                });
                            }
                        });

                        room.participants.forEach((participant, id) => {
                            if (id === clientId) return;
                            safeSend(participant.ws, {
                                type: 'participant-updated',
                                participantId: senderId,
                                ownerId: room.ownerId,
                                changes: {
                                    video: p.video,
                                    audio: p.audio,
                                    screen: p.screen,
                                    speaking: !!p.speaking,
                                    cameraFacingMode: p.cameraFacingMode === 'environment' ? 'environment' : 'user'
                                }
                            });
                        });
                    }
                    break;

                case 'request-video':
                case 'request-audio':
                case 'friend-request':
                case 'force-video-off':
                case 'force-audio-off':
                case 'make-admin':
                case 'remove-admin':
                case 'kick':
                case 'approve-join-request':
                case 'reject-join-request':
                case 'set-room-private':
                case 'close-room':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        const sender = room.participants.get(senderId);
                        if (!sender) return;
                        const senderIsOwner = room.ownerId === senderId;
                        const senderIsAdmin = !!sender.isAdmin;

                        if (data.type === 'set-room-private') {
                            if (!senderIsOwner && !senderIsAdmin) return;
                            room.isPrivate = !!data.enabled;
                            room.participants.forEach((participant) => {
                                safeSend(participant.ws, {
                                    type: 'room-privacy-updated',
                                    enabled: room.isPrivate,
                                    fromId: senderId,
                                    from: userName
                                });
                            });
                            broadcastRoomState(room);
                            return;
                        }

                        if (data.type === 'close-room') {
                            if (!senderIsOwner && !senderIsAdmin) return;
                            closeRoom(room, senderId, userName);
                            return;
                        }

                        if (data.type === 'approve-join-request' || data.type === 'reject-join-request') {
                            if (!senderIsOwner && !senderIsAdmin) return;
                            const requestId = data.requestId || data.targetId || data.target;
                            if (!requestId) return;
                            const request = room.joinRequests.get(requestId);
                            if (!request) return;
                            room.joinRequests.delete(requestId);
                            broadcastJoinRequestToModerators(room, {
                                type: 'join-request-cancelled',
                                requestId,
                                byModerator: true
                            });
                            if (data.type === 'reject-join-request') {
                                safeSend(request.ws, {
                                    type: 'join-rejected',
                                    roomId: room.id,
                                    byId: senderId,
                                    byName: userName
                                });
                                return;
                            }

                            const participantInfo = {
                                ws: request.ws,
                                userName: request.userName,
                                userAvatar: request.userAvatar || '',
                                appUserId: request.appUserId || '',
                                video: false,
                                audio: true,
                                screen: false,
                                speaking: false,
                                isAdmin: false,
                                cameraFacingMode: 'user',
                                reconnectKey: request.reconnectKey || ''
                            };
                            room.participants.set(requestId, participantInfo);
                            if (!room.ownerId) {
                                room.ownerId = requestId;
                            }
                            ensureOwnerAdmin(room);
                            room.participants.forEach((participant, id) => {
                                if (id === requestId) return;
                                safeSend(participant.ws, {
                                    type: 'guest-joined',
                                    guest: serializeParticipant(requestId, participantInfo),
                                    ownerId: room.ownerId,
                                    iceServers: ACTIVE_ICE_SERVERS
                                });
                            });
                            safeSend(request.ws, {
                                type: 'joined',
                                roomId: room.id,
                                myId: requestId,
                                ownerId: room.ownerId,
                                iceServers: ACTIVE_ICE_SERVERS
                            });
                            broadcastRoomState(room);
                            return;
                        }

                        const targetId = data.targetId || data.target;

                        if (!targetId) return;
                        const target = room.participants.get(targetId);
                        if (!target) return;

                        if ((data.type === 'make-admin' || data.type === 'remove-admin' || data.type === 'kick') && !senderIsOwner) {
                            return;
                        }

                        if (data.type === 'make-admin') {
                            target.isAdmin = true;
                            room.participants.forEach((participant) => {
                                safeSend(participant.ws, {
                                    type: 'participant-updated',
                                    participantId: targetId,
                                    ownerId: room.ownerId,
                                    changes: { isAdmin: true }
                                });
                            });
                            broadcastRoomState(room);
                            return;
                        }

                        if (data.type === 'remove-admin') {
                            if (targetId === room.ownerId) {
                                return;
                            }
                            target.isAdmin = false;
                            room.participants.forEach((participant) => {
                                safeSend(participant.ws, {
                                    type: 'participant-updated',
                                    participantId: targetId,
                                    ownerId: room.ownerId,
                                    changes: { isAdmin: false },
                                    from: userName,
                                    fromId: senderId
                                });
                            });
                            broadcastRoomState(room);
                            return;
                        }

                        if (data.type === 'kick') {
                            safeSend(target.ws, {
                                type: 'kicked',
                                from: userName,
                                fromId: senderId
                            });
                            try { target.ws.close(); } catch (_) {}
                            return;
                        }

                        safeSend(target.ws, {
                            ...data,
                            targetId,
                            from: userName,
                            fromId: senderId
                        });
                    }
                    break;

                case 'cancel-join-request':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        if (!room.joinRequests.has(senderId)) return;
                        room.joinRequests.delete(senderId);
                        broadcastJoinRequestToModerators(room, {
                            type: 'join-request-cancelled',
                            requestId: senderId,
                            byModerator: false
                        });
                    }
                    break;

                case 'start-watch':
                case 'stop-watch':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        const sender = room.participants.get(senderId);
                        if (!sender) return;

                        const senderIsOwner = room.ownerId === senderId;
                        const senderIsAdmin = !!sender.isAdmin;

                        if (data.type === 'start-watch') {
                            const url = String(data.url || '').trim();
                            if (!url) return;

                            const active = room.watchParty;
                            const canStart = !active || active.ownerId === senderId || senderIsOwner || senderIsAdmin;
                            if (!canStart) return;

                            room.watchParty = {
                                url,
                                ownerId: senderId,
                                ownerName: userName,
                                startedAt: Date.now()
                            };

                            room.participants.forEach((participant) => {
                                safeSend(participant.ws, {
                                    type: 'watch-started',
                                    watchParty: room.watchParty,
                                    from: userName,
                                    fromId: senderId,
                                    ownerId: room.ownerId
                                });
                            });
                            return;
                        }

                        if (!room.watchParty) return;
                        const canStop = room.watchParty.ownerId === senderId || senderIsOwner || senderIsAdmin;
                        if (!canStop) return;

                        const previousWatch = room.watchParty;
                        room.watchParty = null;
                        room.participants.forEach((participant) => {
                            safeSend(participant.ws, {
                                type: 'watch-stopped',
                                previousWatch,
                                from: userName,
                                fromId: senderId,
                                ownerId: room.ownerId
                            });
                        });
                    }
                    break;

                case 'durak-propose':
                case 'durak-join':
                case 'durak-leave':
                case 'durak-cancel':
                case 'durak-start':
                case 'durak-action':
                case 'durak-end':
                    {
                        const room = rooms.get(currentRoom);
                        if (!room) return;
                        const sender = room.participants.get(senderId);
                        if (!sender) return;
                        const senderIsOwner = room.ownerId === senderId;
                        const senderIsAdmin = !!sender.isAdmin;
                        const mod = senderIsOwner || senderIsAdmin;

                        if (data.type === 'durak-propose') {
                            if (room.durak) return;
                            const mode = data.mode === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy';
                            const cardPack = data.cardPack || 'classic';
                            room.durak = durakEngine.createLobby(senderId, userName, mode, cardPack);
                            broadcastDurak(room);
                            broadcastRoomState(room);
                            return;
                        }

                        if (!room.durak) return;
                        const g = room.durak;

                        if (data.type === 'durak-join') {
                            durakEngine.lobbyJoin(g, senderId, userName);
                            broadcastDurak(room);
                            return;
                        }

                        if (data.type === 'durak-leave') {
                            if (g.phase === 'ended') {
                                room.durak = null;
                            } else if (g.phase === 'lobby') {
                                const r = durakEngine.lobbyLeave(g, senderId);
                                if (r.empty) room.durak = null;
                            } else {
                                const r = durakEngine.playingLeave(g, senderId);
                                if (r.empty) room.durak = null;
                            }
                            broadcastDurak(room);
                            broadcastRoomState(room);
                            return;
                        }

                        if (data.type === 'durak-cancel') {
                            const r = durakEngine.cancelLobby(g, senderId, senderIsOwner, senderIsAdmin);
                            if (r.ok && r.cancelled) {
                                room.durak = null;
                                broadcastDurak(room);
                                broadcastRoomState(room);
                            }
                            return;
                        }

                        if (data.type === 'durak-start') {
                            const force = !!data.force;
                            const canForceStart = mod || senderId === g.initiatorId;
                            const r = durakEngine.tryStartGame(g, senderId, force, canForceStart);
                            if (r.ok) {
                                broadcastDurak(room);
                                broadcastRoomState(room);
                            } else if (r.error) {
                                safeSend(ws, { type: 'durak-error', message: r.error });
                            }
                            return;
                        }

                        if (data.type === 'durak-action') {
                            const r = durakEngine.processAction(g, senderId, data.action || {});
                            if (r.ok) broadcastDurak(room);
                            else safeSend(ws, { type: 'durak-error', message: r.error || 'Ход невозможен' });
                            return;
                        }

                        if (data.type === 'durak-end') {
                            if (!mod) return;
                            durakEngine.endGameByModerator(g);
                            room.durak = null;
                            broadcastDurak(room);
                            broadcastRoomState(room);
                            return;
                        }
                    }
                    break;

                case 'leave':
                    {
                        const roomToLeave = currentRoom;
                        currentRoom = null;
                        handleDisconnect(senderId, roomToLeave, { allowGrace: false });
                    }
                    break;
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });

    ws.on('close', () => {
        if (currentAppUserId) {
            unregisterUserSession(currentAppUserId, ws);
            if (!userSessions.has(currentAppUserId)) {
                setUserOffline(currentAppUserId);
            }
        }
        if (ws.__superseded) return;
        const roomToLeave = currentRoom;
        currentRoom = null;
        const participantId = ws.__participantId || clientId;
        handleDisconnect(participantId, roomToLeave, { allowGrace: true });
    });
});

function handleDisconnect(clientId, roomId, options = {}) {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.joinRequests.has(clientId)) {
        room.joinRequests.delete(clientId);
        broadcastJoinRequestToModerators(room, {
            type: 'join-request-cancelled',
            requestId: clientId,
            byModerator: false
        });
        if (room.participants.size === 0) {
            scheduleRoomEmptyCleanup(roomId);
            console.log(`⏳ Room join-request only, waiting reconnect grace: ${roomId}`);
        }
        return;
    }

    const participant = room.participants.get(clientId);
    if (!participant) return;
    clearPendingDisconnect(roomId, clientId);
    const allowGrace = !!options.allowGrace;
    if (allowGrace) {
        const key = getPendingDisconnectKey(roomId, clientId);
        const timerId = setTimeout(() => {
            pendingDisconnects.delete(key);
            finalizeParticipantDisconnect(clientId, roomId);
        }, Math.max(1000, RECONNECT_GRACE_MS));
        pendingDisconnects.set(key, timerId);
        return;
    }
    finalizeParticipantDisconnect(clientId, roomId);
}

// ============ АВТО-ПИНГ ДЛЯ ПРЕДОТВРАЩЕНИЯ ЗАСЫПАНИЯ ============
// Каждые 4 минуты пингуем сам себя, чтобы Render не уснул
const keepAlive = () => {
    const http = require('http');
    const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/',
        method: 'GET',
        timeout: 5000
    };
    
    const req = http.request(options, (res) => {
        console.log(`🏓 Self-ping at ${new Date().toLocaleTimeString()} - Status: ${res.statusCode}`);
    });
    
    req.on('error', (err) => {
        // Тишина, просто не пишем ошибки
    });
    
    req.end();
};

// Запускаем авто-пинг каждые 4 минуты
setInterval(keepAlive, 4 * 60 * 1000);
console.log('✅ Keep-alive enabled (ping every 4 minutes)');

// Очистка истекших историй каждые 5 минут
setInterval(async () => {
    try {
        await mysqlBoot;
    } catch (_) {}
    if (messengerMysql.isEnabled()) {
        const deleted = await messengerMysql.cleanupExpiredStories();
        if (deleted > 0) {
            console.log(`🗑️ Cleaned up ${deleted} expired stories`);
        }
    }
}, 5 * 60 * 1000);
console.log('✅ Story cleanup enabled (every 5 minutes)');

setInterval(tickDurakRooms, 2000);
