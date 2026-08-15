'use strict';

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = path.join(__dirname, 'upload');

let client = null;
let bucket = '';
let prefix = '';

function env(name, def = '') {
    const v = process.env[name];
    if (v == null) return def;
    const t = String(v).trim();
    return t.length ? t : def;
}

function parseEndpoint(raw) {
    let url = String(raw || '').trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let u;
    try {
        u = new URL(url);
    } catch (_) {
        return null;
    }
    const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
    return { endPoint: u.hostname, port, useSSL: u.protocol === 'https:' };
}

function init() {
    const endpoint = env('S3_ENDPOINT');
    const accessKey = env('S3_ACCESS_KEY');
    const secretKey = env('S3_SECRET_KEY');
    bucket = env('S3_BUCKET');
    client = null;
    if (!endpoint || !accessKey || !secretKey || !bucket) {
        return false;
    }
    const ep = parseEndpoint(endpoint);
    if (!ep) {
        console.error('[media_store] invalid S3_ENDPOINT, falling back to local disk');
        return false;
    }
    client = new (require('minio').Client)({
        endPoint: ep.endPoint,
        port: ep.port,
        useSSL: ep.useSSL,
        accessKey,
        secretKey,
        region: env('S3_REGION', 'auto') || 'auto',
        pathStyle: env('S3_PATH_STYLE', '1') !== '0'
    });
    prefix = env('S3_PREFIX', '').replace(/\/+$/, '');
    if (prefix) prefix += '/';
    return true;
}

function isEnabled() {
    return !!client;
}

function keyName(name) {
    return prefix + name;
}

async function putObject(name, buf, mime) {
    await client.putObject(bucket, keyName(name), buf, buf.length, {
        'Content-Type': mime || 'application/octet-stream'
    });
    return name;
}

async function statObject(name) {
    const s = await client.statObject(bucket, keyName(name));
    return { size: Number(s.size || 0) };
}

async function getObjectStream(name, start, end) {
    if (start == null && end == null) {
        return await client.getObject(bucket, keyName(name));
    }
    return await client.getPartialObject(bucket, keyName(name), start, end);
}

function isMissingS3Error(err) {
    const code = String((err && err.code) || '');
    return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchBucket';
}

function ensureLocalDir() {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

module.exports = {
    init,
    isEnabled,
    putObject,
    statObject,
    getObjectStream,
    isMissingS3Error,
    LOCAL_DIR,
    ensureLocalDir
};
