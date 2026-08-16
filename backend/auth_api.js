'use strict';
const crypto = require('crypto');
const pg = require('./messenger_pg');

const QR_TTL_MS = 5 * 60 * 1000;
const qrSessions = new Map();
let cleanupTimer = null;

const MAX_SESSIONS_PER_USER = 20;
const deviceSessions = new Map();

function sessionKey(userId, deviceId) {
    return `${String(userId || '').trim()}::${String(deviceId || '').trim()}`;
}

function normalizeDeviceName(value) {
    return String(value || '')
        .replace(/[\r\n<>]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || 'Новое устройство';
}

function upsertDeviceSession(userId, info) {
    const uid = String(userId || '').trim();
    const did = String((info && info.deviceId) || '').trim();
    if (!uid || !did) return null;
    const key = sessionKey(uid, did);
    const prev = deviceSessions.get(key);
    const session = {
        userId: uid,
        deviceId: did,
        deviceName: normalizeDeviceName(info && info.deviceName),
        platform: String((info && info.platform) || '').trim().slice(0, 60),
        ip: String((info && info.ip) || '').trim().slice(0, 64),
        city: String((info && info.city) || '').trim().slice(0, 120),
        createdAt: prev ? prev.createdAt : now(),
        lastSeenAt: now()
    };
    deviceSessions.set(key, session);
    const userKeys = [];
    for (const [k, s] of deviceSessions) {
        if (s.userId === uid) userKeys.push([k, s.lastSeenAt]);
    }
    if (userKeys.length > MAX_SESSIONS_PER_USER) {
        userKeys.sort((a, b) => b[1] - a[1]);
        for (let i = MAX_SESSIONS_PER_USER; i < userKeys.length; i++) {
            deviceSessions.delete(userKeys[i][0]);
        }
    }
    return session;
}

function now() {
    return Date.now();
}

function jsonOk(data) {
    return { status: 200, json: { success: true, data: data || {} } };
}

function jsonErr(error, status = 400) {
    return { status, json: { success: false, error } };
}

function normalizeIp(raw) {
    const value = String(raw || '').trim();
    const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(value);
    if (match) return match[1];
    const v6 = /^::ffff:([0-9a-f:.]+)$/i.exec(value);
    return v6 ? v6[1] : (value || '');
}

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
            if (err) return reject(err);
            resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
        });
    });
}

function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return Promise.resolve(false);
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, expected.length, { N: 16384, r: 8, p: 1 }, (err, key) => {
            if (err) return reject(err);
            try {
                resolve(crypto.timingSafeEqual(Buffer.from(key), expected));
            } catch (_) {
                resolve(false);
            }
        });
    });
}

function generateUserId() {
    const rnd = crypto.randomBytes(12).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase();
    return `u${rnd.slice(0, 14)}`;
}

function generateToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function validateUsername(value) {
    const username = String(value || '').trim().replace(/^@+/, '').toLowerCase();
    if (!username) return { ok: false, reason: 'Укажите логин' };
    if (username.length < 3 || username.length > 32) return { ok: false, reason: 'Логин должен быть от 3 до 32 символов' };
    if (!/^[a-z0-9_]+$/.test(username)) return { ok: false, reason: 'Логин может содержать только латиницу, цифры и _' };
    return { ok: true, username };
}

async function initAuth() {
    if (!pg.isEnabled()) return;
    try {
        await pg.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL DEFAULT ''`);
    } catch (err) {
        console.error('[auth] ensure schema failed:', err && err.message ? err.message : err);
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = setInterval(() => {
        const cutoff = now() - QR_TTL_MS;
        for (const [token, session] of qrSessions) {
            if (!session || session.expiresAt < cutoff) {
                qrSessions.delete(token);
            }
        }
    }, 60 * 1000);
    cleanupTimer.unref && cleanupTimer.unref();
}

function isEnabled() {
    return pg.isEnabled();
}

async function handle(body, context = {}) {
    if (!pg.isEnabled()) {
        return jsonErr('База данных недоступна', 503);
    }
    const action = String((body && body.action) || '').trim();
    switch (action) {
        case 'register':
            return register(body);
        case 'login':
            return login(body);
        case 'check_username':
            return checkUsername(body);
        case 'qr_create':
            return qrCreate(body, context);
        case 'qr_info':
            return qrInfo(body);
        case 'qr_confirm':
            return qrConfirm(body);
        case 'qr_poll':
            return qrPoll(body);
        case 'sessions_list':
            return sessionsList(body);
        case 'sessions_terminate':
            return sessionsTerminate(body);
        default:
            return jsonErr(`Неизвестное действие: ${action}`, 400);
    }
}

async function register(body) {
    const name = String((body && body.name) || '').trim();
    const email = String((body && body.email) || '').trim().toLowerCase();
    const password = String((body && body.password) || '');
    const passwordRepeat = String((body && body.passwordRepeat) || '');
    const avatar = String((body && body.avatar) || '').trim();

    if (!name) return jsonErr('Укажите имя');
    if (name.length > 100) return jsonErr('Имя слишком длинное');
    if (email && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) {
        return jsonErr('Некорректный email');
    }
    if (password.length < 6) return jsonErr('Пароль должен быть не короче 6 символов');
    if (password !== passwordRepeat) return jsonErr('Пароли не совпадают');

    const usernameCheck = validateUsername((body && body.username) || '');
    if (!usernameCheck.ok) return jsonErr(usernameCheck.reason);

    try {
        const availability = await pg.isUsernameAvailable(usernameCheck.username);
        if (!availability.available) {
            return jsonErr('Этот логин уже занят, попробуйте другой');
        }
        const userId = generateUserId();
        const passwordHash = await hashPassword(password);
        await pg.query(
            `INSERT INTO users
               (id, username, display_name, avatar_url, cover_url, password_hash, email, status, last_seen, blacklist_json, blacklist_meta_json, friend_ids_json, online, updated_at)
             VALUES ($1,$2,$3,$4,'',$5,$6,'',0,'[]'::jsonb,'{}'::jsonb,'[]'::jsonb,false,$7)
             ON CONFLICT (id) DO UPDATE SET
               username = EXCLUDED.username,
               display_name = EXCLUDED.display_name,
               avatar_url = EXCLUDED.avatar_url,
               email = EXCLUDED.email,
               updated_at = EXCLUDED.updated_at`,
            [userId, usernameCheck.username, name, avatar, passwordHash, email, now()]
        );
        upsertDeviceSession(userId, {
            deviceId: body && body.deviceId,
            deviceName: body && body.deviceName,
            platform: body && body.platform,
            ip: body && body.ip
        });
        return jsonOk({
            appUserId: userId,
            name,
            username: usernameCheck.username,
            email,
            avatar
        });
    } catch (err) {
        console.error('[auth] register failed:', err && err.message ? err.message : err);
        return jsonErr('Не удалось создать аккаунт', 500);
    }
}

async function checkUsername(body) {
    const usernameCheck = validateUsername((body && body.username) || '');
    if (!usernameCheck.ok) return jsonOk({ available: false, reason: usernameCheck.reason });
    try {
        const availability = await pg.isUsernameAvailable(usernameCheck.username);
        return jsonOk({ available: availability.available, username: usernameCheck.username });
    } catch (err) {
        return jsonOk({ available: false, reason: 'Не удалось проверить логин' });
    }
}

async function login(body) {
    const usernameCheck = validateUsername((body && body.username) || '');
    if (!usernameCheck.ok) return jsonErr('Укажите логин');
    const password = String((body && body.password) || '');
    if (!password) return jsonErr('Укажите пароль');

    try {
        const { rows } = await pg.query(
            'SELECT id, display_name, avatar_url, username, email, password_hash FROM users WHERE LOWER(username) = $1 LIMIT 1',
            [usernameCheck.username]
        );
        const row = rows[0];
        if (!row || !row.password_hash) return jsonErr('Неверный логин или пароль', 401);
        const ok = await verifyPassword(password, row.password_hash);
        if (!ok) return jsonErr('Неверный логин или пароль', 401);
        upsertDeviceSession(row.id, {
            deviceId: body && body.deviceId,
            deviceName: body && body.deviceName,
            platform: body && body.platform,
            ip: body && body.ip
        });
        return jsonOk({
            appUserId: String(row.id || '').trim(),
            name: String(row.display_name || '').trim() || String(row.username || ''),
            username: String(row.username || '').trim(),
            avatar: String(row.avatar_url || '').trim(),
            email: String(row.email || '').trim()
        });
    } catch (err) {
        console.error('[auth] login failed:', err && err.message ? err.message : err);
        return jsonErr('Не удалось войти', 500);
    }
}

function findQrSession(token) {
    const session = qrSessions.get(String(token || '').trim());
    if (!session) return null;
    if (session.expiresAt < now()) {
        qrSessions.delete(String(token || '').trim());
        return null;
    }
    return session;
}

function qrCreate(body, context) {
    const token = generateToken();
    const deviceName = normalizeDeviceName((body && body.deviceName) || '');
    const city = String((body && body.city) || '').trim().slice(0, 120);
    const ip = String((body && body.ip) || '').trim() || normalizeIp((context && context.ip) || '');
    const pcDevice = {
        deviceId: String((body && body.deviceId) || '').trim().slice(0, 64),
        deviceName,
        platform: String((body && body.platform) || '').trim().slice(0, 60),
        ip,
        city
    };
    qrSessions.set(token, {
        token,
        status: 'waiting',
        createdAt: now(),
        expiresAt: now() + QR_TTL_MS,
        pcDevice,
        requester: {
            name: deviceName || 'Новое устройство',
            ip,
            city
        }
    });
    return jsonOk({
        token,
        qrData: `seych-qr:${token}`,
        expiresIn: Math.floor(QR_TTL_MS / 1000)
    });
}

function qrInfo(body) {
    const session = findQrSession((body && body.token) || '');
    if (!session) return jsonOk({ status: 'expired' });
    return jsonOk({
        status: session.status,
        requester: session.requester || {},
        user: session.status === 'confirmed' ? (session.user || {}) : undefined
    });
}

function qrConfirm(body) {
    const session = findQrSession((body && body.token) || '');
    if (!session) return jsonErr('QR-код недействителен или истёк', 410);
    if (session.status === 'confirmed') return jsonOk({ success: true });
    const user = (body && body.user) || {};
    session.status = 'confirmed';
    session.user = {
        appUserId: String(user.appUserId || '').trim(),
        name: String(user.name || '').trim(),
        avatar: String(user.avatar || '').trim(),
        username: String(user.username || '').trim(),
        externalKey: String(user.externalKey || '').trim(),
        identityKeys: Array.isArray(user.identityKeys) ? user.identityKeys : [],
        provider: String(user.provider || '').trim()
    };
    session.phoneDevice = {
        deviceId: String((body && body.deviceId) || '').trim().slice(0, 64),
        deviceName: normalizeDeviceName(body && body.deviceName),
        platform: String((body && body.platform) || '').trim().slice(0, 60)
    };
    return jsonOk({ success: true });
}

function qrPoll(body) {
    const session = findQrSession((body && body.token) || '');
    if (!session) return jsonOk({ status: 'expired' });
    if (session.status === 'confirmed') {
        const user = session.user || {};
        const uid = String(user.appUserId || '').trim();
        if (uid) {
            upsertDeviceSession(uid, session.pcDevice);
            if (session.phoneDevice && session.phoneDevice.deviceId) {
                upsertDeviceSession(uid, session.phoneDevice);
            }
        }
        qrSessions.delete(session.token);
        return jsonOk({ status: 'confirmed', user });
    }
    return jsonOk({ status: 'waiting' });
}

function sessionsList(body) {
    const uid = String((body && body.appUserId) || '').trim();
    const curDevice = String((body && body.deviceId) || '').trim();
    if (!uid) return jsonErr('Укажите аккаунт');
    const list = [];
    for (const [, s] of deviceSessions) {
        if (s.userId === uid) {
            list.push({
                deviceId: s.deviceId,
                deviceName: s.deviceName,
                platform: s.platform,
                ip: s.ip,
                city: s.city,
                createdAt: s.createdAt,
                lastSeenAt: s.lastSeenAt,
                isCurrent: !!curDevice && s.deviceId === curDevice
            });
        }
    }
    list.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    console.error('[DIAG] sessions_list: uid=' + uid + ' curDevice=' + (curDevice || '(empty)') + ' entries=' + list.map((s) => (s.deviceId || '(empty)') + (s.isCurrent ? '*' : '')).join(','));
    return jsonOk({ sessions: list });
}

function sessionsTerminate(body) {
    const uid = String((body && body.appUserId) || '').trim();
    const curDevice = String((body && body.deviceId) || '').trim();
    const target = String((body && body.targetId) || '').trim();
    if (!uid || !target) return jsonErr('Недостаточно данных');
    if (target === curDevice) return jsonErr('Нельзя завершить текущую сессию', 400);
    const existed = deviceSessions.delete(sessionKey(uid, target));
    return jsonOk({ removed: existed });
}

module.exports = { handle, initAuth, isEnabled };
