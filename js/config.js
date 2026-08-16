        function getBasePath() {
            const parts = window.location.pathname.split('/').filter(Boolean);
            if (parts.length && parts[parts.length - 1].toLowerCase() === 'index.html') {
                parts.pop();
            }
            if (parts.length && /^(id|grp_call_)[a-z0-9_-]+$/i.test(parts[parts.length - 1])) {
                parts.pop();
            }
            return '/' + parts.join('/');
        }

        function getRootBasePath() {
            const parts = window.location.pathname.split('/').filter(Boolean);
            if (parts.length && parts[parts.length - 1].toLowerCase() === 'index.html') {
                parts.pop();
            }
            while (parts.length && /^(id|grp_call_)[a-z0-9_-]+$/i.test(parts[parts.length - 1])) {
                parts.pop();
            }
            return '/' + parts.join('/');
        }

        const WS_URL = 'wss://server-js-qenx.onrender.com';
        const API_BASE = `${window.location.origin}${getBasePath().replace(/\/$/, '')}`;
        const TELEGRAM_AUTH_API = `${API_BASE}/backend/telegram_auth.php`;
        let WS_ORIGIN = '';
        try {
            const parsed = new URL(WS_URL);
            parsed.protocol = 'https:';
            WS_ORIGIN = parsed.origin;
        } catch (_) {}
        let FRIENDS_API = WS_ORIGIN ? `${WS_ORIGIN}/friends` : '';
        try {
            const rel = new URL('backend/friends_api.php', window.location.href).toString();
            if (!FRIENDS_API) FRIENDS_API = rel;
        } catch (_) {
            if (!FRIENDS_API) FRIENDS_API = `${API_BASE}/backend/friends_api.php`;
        }
        const FRIENDS_API_FALLBACKS = (() => {
            const list = [];
            const push = (value) => {
                const s = String(value || '').trim();
                if (!s || list.includes(s)) return;
                list.push(s);
            };
            try {
                const saved = String(localStorage.getItem('seych-friends-api-url') || '').trim();
                if (saved && !saved.includes('friends_api.php')) push(saved);
            } catch (_) {}
            if (WS_ORIGIN) push(`${WS_ORIGIN}/friends`);
            push(FRIENDS_API);
            return list;
        })();
        const LINK_PREVIEW_API = `${API_BASE}/backend/link_preview.php`;
        const VK_PROXY_API = `${API_BASE}/backend/vk_proxy.php`;
        const AVATAR_PROXY_API = `${API_BASE}/backend/vk_proxy.php?avatar=1&url=`;
        const TELEGRAM_BOT_USERNAME = 'seych_call_bot';
        const GOOGLE_CLIENT_ID = '66228603826-85l71fib6d5sa95vm5t5sj57jph4lq7a.apps.googleusercontent.com';
        const VK_CLIENT_ID = '54525607';
        const VK_REDIRECT_URL = 'https://seych-call.gt.tc';
        const VK_API_VERSION = '5.131';
        const RECONNECT_KEY_STORAGE = 'vk_call_reconnect_key';
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
        
