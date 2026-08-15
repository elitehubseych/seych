'use strict';

const crypto = require('crypto');
const pg = require('./messenger_pg');

let enabled = false;

function init() {
  enabled = pg.isEnabled();
  return enabled;
}

function isEnabled() {
  return enabled;
}

// ===================== Базовые утилиты (порт friends_api.php) =====================

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function normalizeId(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeUsernameValue(value) {
  let raw = String(value == null ? '' : value).trim().toLowerCase();
  if (raw.startsWith('@')) raw = raw.slice(1);
  raw = raw.replace(/[^a-z0-9]/g, '');
  return raw.length > 32 ? raw.slice(0, 32) : raw;
}

function buildGeneratedUsername(userId) {
  const clean = String(normalizeId(userId) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffix = clean.slice(-8).padStart(8, '0');
  return ('user' + suffix).slice(0, 32);
}

function normalizeExternalKey(value) {
  let key = String(value == null ? '' : value).trim().toLowerCase();
  if (!key) return '';
  return key.length > 180 ? key.slice(0, 180) : key;
}

function normalizeIdentityKeys(rawKeys, externalKey = '') {
  const keys = new Set();
  if (Array.isArray(rawKeys)) {
    for (const value of rawKeys) {
      const norm = normalizeExternalKey(value);
      if (norm) keys.add(norm);
    }
  }
  const ext = normalizeExternalKey(externalKey);
  if (ext) keys.add(ext);
  return [...keys];
}

function hashIdentityPart(value, seed) {
  let hash = seed >>> 0;
  const input = String(value);
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    hash = ((((hash << 5) >>> 0) + hash) >>> 0) ^ code;
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildCanonicalUserIdFromIdentityKey(identityKey) {
  const key = normalizeExternalKey(identityKey);
  if (!key) return '';
  const h1 = hashIdentityPart(key, 5381);
  const h2 = hashIdentityPart('seych:' + key, 2166136261);
  return 'u' + h1 + h2;
}

function pickPrimaryIdentityKey(identityKeys) {
  if (!Array.isArray(identityKeys) || !identityKeys.length) return '';
  for (const key of identityKeys) {
    const norm = normalizeExternalKey(key);
    if (norm) return norm;
  }
  return '';
}

function normalizeBoolFlag(value, def = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === '') return !!def;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return !!def;
}

function pairKey(first, second) {
  const a = normalizeId(first);
  const b = normalizeId(second);
  if (!a || !b) return '';
  return a <= b ? `${a}::${b}` : `${b}::${a}`;
}

function pgBool(value) {
  return value === true || value === 't' || value === '1' || value === 1;
}

// ===================== VAPID (Web Push) =====================

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(value) {
  const safe = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = safe.length % 4;
  const padded = padding ? safe + '='.repeat(4 - padding) : safe;
  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

function isValidVapidPublicKey(encoded) {
  const raw = b64urlDecode(encoded);
  return raw.length === 65 && raw[0] === 0x04;
}

function generateVapidKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url')
  ]);
  const privatePem = privateKey.export({ type: 'sec1', format: 'pem' });
  return { public_key: b64urlEncode(raw), private_pem: privatePem };
}

async function pgGetAppConfig(key) {
  const { rows } = await pg.query('SELECT value FROM app_config WHERE key = $1', [String(key)]);
  return rows[0] ? String(rows[0].value || '') : '';
}

async function pgSetAppConfig(key, value) {
  await pg.query(
    `INSERT INTO app_config (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(key), String(value)]
  );
}

async function pgGetVapidKeys() {
  const existingPublic = await pgGetAppConfig('vapid_public_key');
  const existingPrivate = await pgGetAppConfig('vapid_private_pem');
  if (existingPublic !== '' && existingPrivate !== '' && isValidVapidPublicKey(existingPublic)) {
    return { public_key: existingPublic, private_pem: existingPrivate };
  }
  try {
    const keys = generateVapidKeyPair();
    await pgSetAppConfig('vapid_public_key', keys.public_key);
    await pgSetAppConfig('vapid_private_pem', keys.private_pem);
    return keys;
  } catch (err) {
    console.error('[friends] VAPID key generation failed:', err && err.message);
    return { public_key: '', private_pem: '' };
  }
}

function friendsSanitizeSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;
  const endpoint = normalizeText(subscription.endpoint);
  if (!endpoint || endpoint.indexOf('https://') !== 0) return null;
  const keys = subscription.keys && typeof subscription.keys === 'object' ? subscription.keys : {};
  return {
    endpoint,
    auth: normalizeText(keys.auth),
    p256dh: normalizeText(keys.p256dh),
    contentEncoding: normalizeText(subscription.contentEncoding)
  };
}

async function friendsSendWebPush(endpoint, vapidPublic, vapidPrivatePem) {
  let parts;
  try {
    parts = new URL(endpoint);
  } catch {
    return { ok: false, status: 0 };
  }
  if (parts.protocol !== 'https:' && parts.protocol !== 'http:') {
    return { ok: false, status: 0 };
  }
  const aud = `${parts.protocol}//${parts.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: nowTs() + 12 * 60 * 60, sub: 'mailto:notify@seych-call.local' };
  const tokenPayload = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  let signatureJose = '';
  try {
    const privateKey = crypto.createPrivateKey(vapidPrivatePem);
    const sig = crypto.sign('sha256', Buffer.from(tokenPayload, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363'
    });
    signatureJose = b64urlEncode(sig);
  } catch {
    return { ok: false, status: 0 };
  }
  const jwt = `${tokenPayload}.${signatureJose}`;
  const doSend = async (authHeader) => {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'TTL': '60',
          'Urgency': 'high',
          'Authorization': authHeader,
          'Crypto-Key': `p256ecdsa=${vapidPublic}`,
          'Content-Length': '0'
        },
        body: '',
        signal: AbortSignal.timeout(8000)
      });
      return resp.status;
    } catch {
      return 0;
    }
  };
  let status = await doSend(`vapid t=${jwt}, k=${vapidPublic}`);
  if (status === 400 || status === 401 || status === 403) {
    status = await doSend(`WebPush ${jwt}`);
  }
  return { ok: status >= 200 && status < 300, status };
}

// ===================== Пользователи =====================

async function pgGetUserRow(userId) {
  const id = normalizeId(userId);
  if (!id) return null;
  const { rows } = await pg.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: String(row.id),
    name: normalizeText(row.display_name),
    avatar: normalizeText(row.avatar_url),
    username: normalizeText(row.username),
    external_key: normalizeText(row.external_key),
    active_tab: pgBool(row.active_tab),
    presence_updated_at: Number(row.presence_updated_at) || 0,
    last_seen: Number(row.last_seen) || 0
  };
}

async function pgUserExists(userId) {
  return (await pgGetUserRow(userId)) !== null;
}

async function pgFindUserIdByExternalKey(externalKey) {
  const key = normalizeExternalKey(externalKey);
  if (!key) return '';
  const { rows } = await pg.query(
    "SELECT id FROM users WHERE external_key = $1 AND external_key <> '' LIMIT 1",
    [key]
  );
  return rows[0] ? normalizeId(rows[0].id) : '';
}

async function pgUpsertUser(userId, name, avatar = '', externalKey = '', username = '') {
  const id = normalizeId(userId);
  if (!id) return null;
  const safeName = normalizeText(name);
  const safeAvatar = normalizeText(avatar);
  const safeExternalKey = normalizeExternalKey(externalKey);
  const safeUsername = normalizeUsernameValue(username) || buildGeneratedUsername(id);
  const updatedAt = nowTs();
  await pg.query(
    `INSERT INTO users (id, username, display_name, avatar_url, external_key, active_tab, presence_updated_at, last_seen, updated_at)
     VALUES ($1,$2,$3,$4,$5,false,0,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE users.display_name END,
       avatar_url = CASE WHEN EXCLUDED.avatar_url <> '' THEN EXCLUDED.avatar_url ELSE users.avatar_url END,
       external_key = CASE WHEN EXCLUDED.external_key <> '' THEN EXCLUDED.external_key ELSE users.external_key END,
       username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END,
       last_seen = EXCLUDED.last_seen,
       updated_at = EXCLUDED.updated_at`,
    [id, safeUsername, safeName, safeAvatar, safeExternalKey, updatedAt, updatedAt]
  );
  return pgGetUserRow(id);
}

async function pgTouchUserPresence(userId, isActiveTab) {
  const id = normalizeId(userId);
  if (!id) return false;
  const updatedAt = nowTs();
  const activeTab = isActiveTab ? true : false;
  const { rowCount } = await pg.query(
    'UPDATE users SET active_tab = $1, presence_updated_at = $2, updated_at = $2 WHERE id = $3',
    [activeTab, updatedAt, id]
  );
  return rowCount > 0;
}

async function pgIsUserActiveOnSite(userId) {
  const id = normalizeId(userId);
  if (!id) return false;
  const { rows } = await pg.query('SELECT active_tab, presence_updated_at FROM users WHERE id = $1 LIMIT 1', [id]);
  if (!rows[0]) return false;
  const activeTab = pgBool(rows[0].active_tab);
  if (!activeTab) return false;
  const presenceTs = Number(rows[0].presence_updated_at) || 0;
  if (presenceTs <= 0) return false;
  return nowTs() - presenceTs <= 12;
}

// ===================== Identity / привязка ключей =====================

async function pgResolveMappedUserIdByIdentity(identityKeys) {
  if (!Array.isArray(identityKeys) || !identityKeys.length) return '';
  for (const identityKey of identityKeys) {
    const key = normalizeExternalKey(identityKey);
    if (!key) continue;
    const { rows } = await pg.query('SELECT user_id FROM identity_links WHERE identity_key = $1 LIMIT 1', [key]);
    const mappedId = rows[0] ? normalizeId(rows[0].user_id) : '';
    if (mappedId !== '' && (await pgUserExists(mappedId))) {
      return mappedId;
    }
  }
  return '';
}

async function pgBindIdentityKeysToUser(userId, identityKeys) {
  const id = normalizeId(userId);
  if (!id || !Array.isArray(identityKeys) || !identityKeys.length) return false;
  for (const identityKey of identityKeys) {
    const key = normalizeExternalKey(identityKey);
    if (!key) continue;
    await pg.query(
      `INSERT INTO identity_links (identity_key, user_id) VALUES ($1,$2)
       ON CONFLICT (identity_key) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [key, id]
    );
  }
  return true;
}

async function pgRemapUser(fromUserId, toUserId) {
  const from = normalizeId(fromUserId);
  const to = normalizeId(toUserId);
  if (!from || !to || from === to) return;
  if (!(await pgUserExists(from))) return;

  if (await pgUserExists(to)) {
    const fromUser = await pgGetUserRow(from);
    await pg.query(
      `UPDATE users SET
         display_name = CASE WHEN users.display_name = '' THEN $1 ELSE users.display_name END,
         avatar_url = CASE WHEN users.avatar_url = '' THEN $2 ELSE users.avatar_url END,
         external_key = CASE WHEN users.external_key = '' THEN $3 ELSE users.external_key END,
         last_seen = GREATEST(users.last_seen, $4),
         updated_at = $5
       WHERE id = $6`,
      [fromUser.name, fromUser.avatar, fromUser.external_key, Number(fromUser.last_seen) || 0, nowTs(), to]
    );
    await pg.query('DELETE FROM users WHERE id = $1', [from]);
  } else {
    await pg.query('UPDATE users SET id = $1, updated_at = $2 WHERE id = $3', [to, nowTs(), from]);
  }

  await pg.query('UPDATE friendships SET user_a = $1 WHERE user_a = $2', [to, from]);
  await pg.query('UPDATE friendships SET user_b = $1 WHERE user_b = $2', [to, from]);
  await pg.query('DELETE FROM friendships WHERE user_a = user_b');
  await pg.query(
    "UPDATE friendships SET pair_key = CASE WHEN user_a <= user_b THEN user_a || '::' || user_b ELSE user_b || '::' || user_a END"
  );
  await pg.query(
    'DELETE FROM friendships f USING friendships d WHERE f.pair_key = d.pair_key AND f.created_at > d.created_at'
  );

  await pg.query('UPDATE friend_requests SET from_id = $1 WHERE from_id = $2', [to, from]);
  await pg.query('UPDATE friend_requests SET to_id = $1 WHERE to_id = $2', [to, from]);
  await pg.query('DELETE FROM friend_requests WHERE from_id = to_id');

  await pg.query('UPDATE call_invites SET from_id = $1 WHERE from_id = $2', [to, from]);
  await pg.query('UPDATE call_invites SET to_id = $1 WHERE to_id = $2', [to, from]);
  await pg.query('DELETE FROM call_invites WHERE from_id = to_id');

  const merged = new Map();
  const { rows: fromSubs } = await pg.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [from]);
  for (const row of fromSubs) {
    merged.set(row.endpoint, {
      auth: String(row.auth_key || ''),
      p256dh: String(row.p256dh || ''),
      contentEncoding: String(row.content_encoding || ''),
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0
    });
  }
  const { rows: toSubs } = await pg.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [to]);
  for (const row of toSubs) {
    const existing = merged.get(row.endpoint);
    if (existing) {
      if (Number(row.updated_at || 0) > existing.updatedAt) {
        merged.set(row.endpoint, {
          auth: String(row.auth_key || ''),
          p256dh: String(row.p256dh || ''),
          contentEncoding: String(row.content_encoding || ''),
          createdAt: Number(row.created_at) || 0,
          updatedAt: Number(row.updated_at) || 0
        });
      }
    } else {
      merged.set(row.endpoint, {
        auth: String(row.auth_key || ''),
        p256dh: String(row.p256dh || ''),
        contentEncoding: String(row.content_encoding || ''),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0
      });
    }
  }
  await pg.query('DELETE FROM push_subscriptions WHERE user_id = $1', [from]);
  for (const [endpoint, sub] of merged) {
    await pg.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh, content_encoding, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET
         auth_key = EXCLUDED.auth_key,
         p256dh = EXCLUDED.p256dh,
         content_encoding = EXCLUDED.content_encoding,
         updated_at = EXCLUDED.updated_at`,
      [to, endpoint, sub.auth, sub.p256dh, sub.contentEncoding, sub.createdAt, sub.updatedAt]
    );
  }

  await pg.query('UPDATE identity_links SET user_id = $1 WHERE user_id = $2', [to, from]);
}

// ===================== Дружба =====================

async function pgIsFriends(firstId, secondId) {
  const key = pairKey(firstId, secondId);
  if (!key) return false;
  const { rows } = await pg.query('SELECT 1 FROM friendships WHERE pair_key = $1 LIMIT 1', [key]);
  return rows.length > 0;
}

async function pgCreateFriendship(firstId, secondId) {
  const key = pairKey(firstId, secondId);
  const a = normalizeId(firstId);
  const b = normalizeId(secondId);
  if (!key || !a || !b || a === b) return false;
  await pg.query(
    'INSERT INTO friendships (pair_key, user_a, user_b, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (pair_key) DO NOTHING',
    [key, a, b, nowTs()]
  );
  return true;
}

async function pgRemoveFriendship(firstId, secondId) {
  const key = pairKey(firstId, secondId);
  if (!key) return;
  await pg.query('DELETE FROM friendships WHERE pair_key = $1', [key]);
}

// ===================== Push-подписки =====================

async function pgStorePushSubscription(appUserId, subscription) {
  const normalized = friendsSanitizeSubscription(subscription);
  if (!normalized) return false;
  const userKey = normalizeId(appUserId);
  if (!userKey) return false;
  const now = nowTs();
  await pg.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh, content_encoding, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, endpoint) DO UPDATE SET
       auth_key = EXCLUDED.auth_key,
       p256dh = EXCLUDED.p256dh,
       content_encoding = EXCLUDED.content_encoding,
       updated_at = EXCLUDED.updated_at`,
    [userKey, normalized.endpoint, normalized.auth, normalized.p256dh, normalized.contentEncoding, now, now]
  );
  return true;
}

async function pgNotifyIncomingCall(targetId) {
  const targetKey = normalizeId(targetId);
  if (!targetKey) return;
  if (await pgIsUserActiveOnSite(targetKey)) return;
  const keys = await pgGetVapidKeys();
  const publicKey = normalizeText(keys.public_key);
  const privatePem = normalizeText(keys.private_pem);
  if (!publicKey || !privatePem) return;
  const { rows } = await pg.query(
    'SELECT endpoint, auth_key, p256dh, content_encoding FROM push_subscriptions WHERE user_id = $1',
    [targetKey]
  );
  if (!rows.length) return;
  const removed = [];
  for (const subscription of rows) {
    const endpoint = normalizeText(subscription.endpoint);
    if (!endpoint) continue;
    const result = await friendsSendWebPush(endpoint, publicKey, privatePem);
    const status = Number(result.status) || 0;
    if (status === 404 || status === 410) {
      removed.push(endpoint);
    }
  }
  for (const endpoint of removed) {
    await pg.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [targetKey, endpoint]);
  }
}

// ===================== Сборка состояния =====================

function compareStringsDesc(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  return a < b ? 1 : a > b ? -1 : 0;
}

function compareNumbersDesc(left, right) {
  return (Number(right) || 0) - (Number(left) || 0);
}

async function pgBuildState(appUserId) {
  const uid = normalizeId(appUserId);

  const friends = [];
  const { rows: fRows } = await pg.query(
    `SELECT f.user_a, f.user_b, u.id, u.display_name, u.avatar_url
     FROM friendships f
     LEFT JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = $1 OR f.user_b = $1`,
    [uid]
  );
  for (const row of fRows) {
    const friendId = normalizeId(row.id);
    if (!friendId) continue;
    friends.push({
      id: friendId,
      name: normalizeText(row.display_name) || 'Пользователь',
      avatar: normalizeText(row.avatar_url)
    });
  }
  friends.sort((l, r) => {
    const a = String(l.name || '').toLowerCase();
    const b = String(r.name || '').toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const incomingRequests = [];
  const outgoingRequests = [];
  const { rows: rRows } = await pg.query(
    `SELECT fr.id, fr.from_id, fr.to_id, fr.created_at, u.display_name, u.avatar_url
     FROM friend_requests fr
     LEFT JOIN users u ON u.id = CASE WHEN fr.to_id = $1 THEN fr.from_id ELSE fr.to_id END
     WHERE fr.status = 'pending' AND (fr.from_id = $1 OR fr.to_id = $1)`,
    [uid]
  );
  for (const row of rRows) {
    const from = normalizeId(row.from_id);
    const to = normalizeId(row.to_id);
    if (to === uid) {
      incomingRequests.push({
        requestId: normalizeId(row.id),
        fromId: from,
        name: normalizeText(row.display_name) || 'Пользователь',
        avatar: normalizeText(row.avatar_url),
        createdAt: Number(row.created_at) || nowTs()
      });
    } else if (from === uid) {
      outgoingRequests.push({
        requestId: normalizeId(row.id),
        toId: to,
        name: normalizeText(row.display_name) || 'Пользователь',
        avatar: normalizeText(row.avatar_url),
        createdAt: Number(row.created_at) || nowTs()
      });
    }
  }
  incomingRequests.sort((l, r) => compareNumbersDesc(l.createdAt, r.createdAt));
  outgoingRequests.sort((l, r) => compareNumbersDesc(l.createdAt, r.createdAt));

  const incomingCalls = [];
  const outgoingCalls = [];
  const { rows: cRows } = await pg.query(
    `SELECT ci.id, ci.from_id, ci.to_id, ci.room_id, ci.status, ci.created_at, ci.updated_at, u.display_name, u.avatar_url
     FROM call_invites ci
     LEFT JOIN users u ON u.id = CASE WHEN ci.to_id = $1 THEN ci.from_id ELSE ci.to_id END
     WHERE ci.from_id = $1 OR ci.to_id = $1`,
    [uid]
  );
  for (const row of cRows) {
    const from = normalizeId(row.from_id);
    const to = normalizeId(row.to_id);
    const status = normalizeText(row.status);
    if (to === uid && status === 'pending') {
      incomingCalls.push({
        inviteId: normalizeId(row.id),
        fromId: from,
        fromName: normalizeText(row.display_name) || 'Пользователь',
        fromAvatar: normalizeText(row.avatar_url),
        roomId: normalizeText(row.room_id),
        createdAt: Number(row.created_at) || nowTs()
      });
    }
    if (from === uid && status !== 'pending') {
      outgoingCalls.push({
        inviteId: normalizeId(row.id),
        toId: to,
        toName: normalizeText(row.display_name) || 'Пользователь',
        status,
        roomId: normalizeText(row.room_id),
        updatedAt: Number(row.updated_at) || nowTs()
      });
    }
  }
  incomingCalls.sort((l, r) => compareNumbersDesc(l.createdAt, r.createdAt));
  outgoingCalls.sort((l, r) => compareNumbersDesc(l.updatedAt, r.updatedAt));
  const trimmedOutgoingCalls = outgoingCalls.slice(0, 30);

  return {
    self: await pgGetUserRow(uid),
    friends,
    incomingRequests,
    outgoingRequests,
    incomingCalls,
    outgoingCalls: trimmedOutgoingCalls
  };
}

// ===================== Обработка действий =====================

function ok(data) {
  return { status: 200, json: { success: true, data, error: null } };
}

function fail(error) {
  return { status: 200, json: { success: false, data: null, error } };
}

async function resolveUserId(appUserId, identityKeys, externalKey) {
  let uid = appUserId;
  const mapped = await pgResolveMappedUserIdByIdentity(identityKeys);
  if (mapped !== '' && mapped !== uid) {
    await pgRemapUser(uid, mapped);
    uid = mapped;
  } else if (mapped === '') {
    const primary = pickPrimaryIdentityKey(identityKeys);
    const generated = buildCanonicalUserIdFromIdentityKey(primary);
    if (generated !== '' && generated !== uid) {
      await pgRemapUser(uid, generated);
      uid = generated;
    }
  }
  if (externalKey !== '') {
    const existingId = await pgFindUserIdByExternalKey(externalKey);
    if (existingId !== '' && existingId !== uid) {
      await pgRemapUser(uid, existingId);
      uid = existingId;
    }
  }
  return uid;
}

async function handleRegister(source) {
  const appUserId = normalizeId(source.app_user_id);
  const name = normalizeText(source.name);
  const avatar = normalizeText(source.avatar);
  const username = normalizeText(source.username);
  const externalKey = normalizeExternalKey(source.external_key);
  const identityKeys = normalizeIdentityKeys(source.identity_keys, externalKey);
  const previousAppUserId = normalizeId(source.previous_app_user_id);
  const activeTab = normalizeBoolFlag(source.active_tab, false);

  let uid = appUserId;
  const mappedIdentityId = await pgResolveMappedUserIdByIdentity(identityKeys);
  if (mappedIdentityId !== '' && mappedIdentityId !== uid) {
    await pgRemapUser(uid, mappedIdentityId);
    if (previousAppUserId !== '' && previousAppUserId !== mappedIdentityId) {
      await pgRemapUser(previousAppUserId, mappedIdentityId);
    }
    uid = mappedIdentityId;
  } else if (mappedIdentityId === '') {
    const primaryIdentityKey = pickPrimaryIdentityKey(identityKeys);
    const generatedCanonicalId = buildCanonicalUserIdFromIdentityKey(primaryIdentityKey);
    if (generatedCanonicalId !== '' && generatedCanonicalId !== uid) {
      await pgRemapUser(uid, generatedCanonicalId);
      if (previousAppUserId !== '' && previousAppUserId !== generatedCanonicalId) {
        await pgRemapUser(previousAppUserId, generatedCanonicalId);
      }
      uid = generatedCanonicalId;
    }
  }
  if (externalKey !== '') {
    const existingId = await pgFindUserIdByExternalKey(externalKey);
    if (existingId !== '' && existingId !== uid) {
      await pgRemapUser(uid, existingId);
      if (previousAppUserId !== '' && previousAppUserId !== existingId) {
        await pgRemapUser(previousAppUserId, existingId);
      }
      uid = existingId;
    }
  } else if (previousAppUserId !== '' && previousAppUserId !== uid) {
    await pgRemapUser(previousAppUserId, uid);
  }

  const user = await pgUpsertUser(uid, name, avatar, externalKey, username);
  const effectiveAppUserId = normalizeId((user && user.id) || uid);
  await pgBindIdentityKeysToUser(effectiveAppUserId, identityKeys);
  await pgTouchUserPresence(effectiveAppUserId, activeTab);
  return { user, appUserId: effectiveAppUserId };
}

async function handleSearch(uid, queryValue) {
  const query = String(queryValue || '').trim().toLowerCase();
  if (query === '') return { results: [] };
  const like = `%${query}%`;
  const { rows } = await pg.query(
    `SELECT id, display_name, avatar_url, username, external_key
     FROM users
     WHERE id <> $1
       AND (LOWER(id) LIKE $2 OR LOWER(display_name) LIKE $3 OR LOWER(username) LIKE $4)
     ORDER BY LOWER(display_name)
     LIMIT 200`,
    [uid, like, like, like]
  );
  const results = [];
  const seenIdentity = new Set();
  for (const row of rows) {
    const candidateId = normalizeId(row.id);
    if (!candidateId) continue;
    const identityKey = normalizeExternalKey(row.external_key);
    const dedupeKey = identityKey !== '' ? identityKey : `id:${String(candidateId).toLowerCase()}`;
    if (seenIdentity.has(dedupeKey)) continue;
    seenIdentity.add(dedupeKey);
    const candidateName = normalizeText(row.display_name);
    const candidateUsername = normalizeText(row.username);

    let incomingPending = false;
    let outgoingPending = false;
    const req = await pg.query(
      `SELECT from_id, to_id FROM friend_requests WHERE status = 'pending'
       AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)) LIMIT 1`,
      [uid, candidateId]
    );
    if (req.rows[0]) {
      if (normalizeId(req.rows[0].from_id) === uid) {
        outgoingPending = true;
      } else {
        incomingPending = true;
      }
    }

    results.push({
      id: candidateId,
      name: candidateName !== '' ? candidateName : 'Пользователь',
      username: candidateUsername,
      avatar: normalizeText(row.avatar_url),
      isFriend: await pgIsFriends(uid, candidateId),
      incomingPending,
      outgoingPending
    });
    if (results.length >= 40) break;
  }
  return { results };
}

async function handleSendRequest(uid, targetId) {
  const target = normalizeId(targetId);
  if (!target || target === uid) return fail('Некорректный target_id');
  if (!(await pgUserExists(target))) return fail('Пользователь не найден');
  if (await pgIsFriends(uid, target)) return fail('Уже в друзьях');
  const existing = await pg.query(
    `SELECT id, from_id FROM friend_requests WHERE status = 'pending'
     AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)) LIMIT 1`,
    [uid, target]
  );
  if (existing.rows[0]) {
    if (normalizeId(existing.rows[0].from_id) === uid) {
      return ok({ status: 'already_pending' });
    }
    await pg.query(
      "UPDATE friend_requests SET status = 'accepted', updated_at = $1 WHERE id = $2",
      [nowTs(), normalizeId(existing.rows[0].id)]
    );
    await pgCreateFriendship(uid, target);
    return ok({ status: 'auto_accepted' });
  }
  const requestId = `fr_${crypto
    .createHash('md5')
    .update(`${uid}|${target}|${Date.now()}.${Math.random()}`)
    .digest('hex')
    .slice(0, 16)}`;
  const now = nowTs();
  await pg.query(
    "INSERT INTO friend_requests (id, from_id, to_id, status, created_at, updated_at) VALUES ($1,$2,$3,'pending',$4,$5)",
    [requestId, uid, target, now, now]
  );
  return ok({ status: 'sent' });
}

async function handleRespondRequest(uid, requestId, decision) {
  if (!requestId || !['accept', 'decline'].includes(decision)) return fail('Некорректные параметры');
  const req = await pg.query('SELECT id, from_id, to_id, status FROM friend_requests WHERE id = $1 LIMIT 1', [requestId]);
  if (!req.rows[0]) return fail('Заявка не найдена');
  const row = req.rows[0];
  if (normalizeId(row.to_id) !== uid) return fail('Нет прав на обработку заявки');
  if (normalizeText(row.status) !== 'pending') return ok({ status: 'already_processed' });
  const nextStatus = decision === 'accept' ? 'accepted' : 'declined';
  await pg.query('UPDATE friend_requests SET status = $1, updated_at = $2 WHERE id = $3', [nextStatus, nowTs(), requestId]);
  if (decision === 'accept') {
    await pgCreateFriendship(normalizeId(row.from_id), uid);
  }
  return ok({ status: nextStatus });
}

async function handleRemoveFriend(uid, friendId) {
  if (!friendId) return fail('friend_id required');
  await pgRemoveFriendship(uid, friendId);
  await pg.query(
    `UPDATE friend_requests SET status = 'declined', updated_at = $1
     WHERE status = 'pending' AND ((from_id = $2 AND to_id = $3) OR (from_id = $3 AND to_id = $2))`,
    [nowTs(), uid, friendId]
  );
  return ok({ removed: true });
}

async function handleSendCallInvite(uid, targetId, roomId) {
  const target = normalizeId(targetId);
  const room = normalizeText(roomId);
  if (!target || !room) return fail('Некорректные параметры звонка');
  if (!(await pgIsFriends(uid, target))) return fail('Звонок доступен только друзьям');
  await pg.query(
    "UPDATE call_invites SET status = 'cancelled', updated_at = $1 WHERE from_id = $2 AND to_id = $3 AND status = 'pending'",
    [nowTs(), uid, target]
  );
  const inviteId = `call_${crypto
    .createHash('md5')
    .update(`${uid}|${target}|${Date.now()}.${Math.random()}`)
    .digest('hex')
    .slice(0, 16)}`;
  const now = nowTs();
  await pg.query(
    "INSERT INTO call_invites (id, from_id, to_id, room_id, status, created_at, updated_at) VALUES ($1,$2,$3,$4,'pending',$5,$5)",
    [inviteId, uid, target, room, now]
  );
  await pgNotifyIncomingCall(target);
  return ok({ inviteId });
}

async function handleRespondCallInvite(uid, inviteId, decision) {
  if (!inviteId || !['answer', 'decline'].includes(decision)) return fail('Некорректные параметры');
  const inv = await pg.query('SELECT id, to_id, room_id, status FROM call_invites WHERE id = $1 LIMIT 1', [inviteId]);
  if (!inv.rows[0]) return fail('Приглашение не найдено');
  const row = inv.rows[0];
  if (normalizeId(row.to_id) !== uid) return fail('Нет прав на обработку звонка');
  const currentStatus = normalizeText(row.status);
  if (currentStatus !== 'pending') return ok({ status: currentStatus, roomId: normalizeText(row.room_id) });
  const nextStatus = decision === 'answer' ? 'accepted' : 'declined';
  await pg.query('UPDATE call_invites SET status = $1, updated_at = $2 WHERE id = $3', [nextStatus, nowTs(), inviteId]);
  return ok({ status: nextStatus, roomId: normalizeText(row.room_id) });
}

async function handleCancelCallInvite(uid, inviteId) {
  if (!inviteId) return fail('invite_id required');
  const inv = await pg.query('SELECT id, from_id, status FROM call_invites WHERE id = $1 LIMIT 1', [inviteId]);
  if (!inv.rows[0]) return fail('Приглашение не найдено');
  const row = inv.rows[0];
  if (normalizeId(row.from_id) !== uid) return fail('Нет прав на отмену звонка');
  const currentStatus = normalizeText(row.status);
  if (currentStatus !== 'pending') return ok({ status: currentStatus });
  await pg.query("UPDATE call_invites SET status = 'cancelled', updated_at = $1 WHERE id = $2", [nowTs(), inviteId]);
  return ok({ status: 'cancelled' });
}

async function handle(body) {
  if (!enabled) {
    return { status: 200, json: { success: false, data: null, error: 'Friends API disabled' } };
  }
  const action = normalizeText(body && body.action);
  if (!action) {
    return fail('Action required');
  }
  try {
    if (action === 'register') {
      if (normalizeId(body.app_user_id) === '') return fail('app_user_id required');
      return ok(await handleRegister(body));
    }

    const appUserId = normalizeId(body.app_user_id);
    const externalKey = normalizeExternalKey(body.external_key);
    const identityKeys = normalizeIdentityKeys(body.identity_keys, externalKey);
    if (appUserId === '') {
      return fail('app_user_id required');
    }
    const uid = await resolveUserId(appUserId, identityKeys, externalKey);
    if (!(await pgUserExists(uid))) {
      await pgUpsertUser(
        uid,
        normalizeText(body.name || 'Пользователь'),
        normalizeText(body.avatar),
        externalKey,
        normalizeText(body.username)
      );
    }
    await pgBindIdentityKeysToUser(uid, identityKeys);
    await pgTouchUserPresence(uid, normalizeBoolFlag(body.active_tab, false));

    switch (action) {
      case 'state':
        return ok(await pgBuildState(uid));
      case 'push_config': {
        const keys = await pgGetVapidKeys();
        if (normalizeText(keys.public_key) === '') return fail('Push keys unavailable');
        return ok({ publicKey: keys.public_key });
      }
      case 'save_push_subscription': {
        const saved = await pgStorePushSubscription(
          uid,
          body.subscription && typeof body.subscription === 'object' ? body.subscription : null
        );
        if (!saved) return fail('Некорректная push подписка');
        return ok({ saved: true });
      }
      case 'search':
        return ok(await handleSearch(uid, body.query));
      case 'send_request':
        return handleSendRequest(uid, body.target_id);
      case 'respond_request':
        return handleRespondRequest(uid, normalizeId(body.request_id), normalizeText(body.decision));
      case 'remove_friend':
        return handleRemoveFriend(uid, normalizeId(body.friend_id));
      case 'send_call_invite':
        return handleSendCallInvite(uid, normalizeId(body.target_id), normalizeText(body.room_id));
      case 'respond_call_invite':
        return handleRespondCallInvite(uid, normalizeId(body.invite_id), normalizeText(body.decision));
      case 'cancel_call_invite':
        return handleCancelCallInvite(uid, normalizeId(body.invite_id));
      default:
        return fail('Unknown action');
    }
  } catch (err) {
    console.error('[friends] action error:', err && err.stack ? err.stack : err);
    return fail('Internal error');
  }
}

module.exports = {
  init,
  isEnabled,
  handle,
  handleSearch,
  handleRegister
};
