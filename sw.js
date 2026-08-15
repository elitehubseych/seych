self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

const NOTIFY_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiB2aWV3Qm94PSIwIDAgMTkyIDE5MiI+PHJlY3Qgd2lkdGg9IjE5MiIgaGVpZ2h0PSIxOTIiIHJ4PSI0MiIgZmlsbD0iIzE4NzdmMiIvPjxwYXRoIGQ9Ik0xMzIuMyAxMjIuN2MtNC4yIDAtOC4yLS42LTExLjktMS42LTMuNy0xLjEtNy42LjMtOS44IDMuNWwtNy43IDkuN2MtMTMuOS03LjQtMjUuMy0xOC44LTMyLjctMzIuN2w5LjctNy43YzMuMi0yLjIgNC42LTYuMSAzLjUtOS44YTEuNDUgMS40NSAwIDAgMC0uMS0uM2MtMS4xLTMuNy0xLjctNy43LTEuNy0xMS45IDAtNS4zLTQuMy05LjYtOS42LTkuNkg0OC45Yy01LjMgMC05LjYgNC4zLTkuNiA5LjYgMCA1MyA0MyA5NiA5NiA5NiA1LjMgMCA5LjYtNC4zIDkuNi05Ljl2LTkuNmMwLTUuMy00LjMtOS42LTkuNi05LjZ6IiBmaWxsPSIjZmZmIi8+PC9zdmc+';
const NOTIFY_BADGE = NOTIFY_ICON;
const PUSH_CONTEXT_CACHE = 'seych-call-push-context-v1';
const PUSH_CONTEXT_URL = '/__push_context__';

function buildApiUrl() {
    return new URL('backend/friends_api.php', self.registration.scope).toString();
}

async function savePushContext(context) {
    if (!context || typeof context !== 'object') return;
    const appUserId = String(context.appUserId || '').trim();
    if (!appUserId) return;
    const cache = await caches.open(PUSH_CONTEXT_CACHE);
    const body = JSON.stringify({ appUserId });
    await cache.put(PUSH_CONTEXT_URL, new Response(body, {
        headers: { 'Content-Type': 'application/json' }
    }));
}

async function loadPushContext() {
    const cache = await caches.open(PUSH_CONTEXT_CACHE);
    const response = await cache.match(PUSH_CONTEXT_URL);
    if (!response) return null;
    try {
        const data = await response.json();
        const appUserId = String(data?.appUserId || '').trim();
        if (!appUserId) return null;
        return { appUserId };
    } catch (_) {
        return null;
    }
}

async function loadIncomingCallFromApi(appUserId) {
    const response = await fetch(buildApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'state',
            app_user_id: appUserId
        })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload?.success) return null;
    const incomingCalls = Array.isArray(payload?.data?.incomingCalls) ? payload.data.incomingCalls : [];
    if (!incomingCalls.length) return null;
    return incomingCalls[0] || null;
}

async function declineInviteFromPush(appUserId, inviteId) {
    if (!appUserId || !inviteId) return;
    await fetch(buildApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'respond_call_invite',
            app_user_id: appUserId,
            invite_id: inviteId,
            decision: 'decline'
        })
    });
}

self.addEventListener('message', (event) => {
    const data = event?.data || null;
    if (!data || data.type !== 'push-context') return;
    event.waitUntil(savePushContext(data));
});

self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
        let title = 'Друг';
        let body = 'Входящий вызов';
        const data = {
            url: './',
            appUserId: '',
            inviteId: '',
            roomId: ''
        };
        try {
            const context = await loadPushContext();
            const appUserId = String(context?.appUserId || '').trim();
            if (appUserId) {
                data.appUserId = appUserId;
                const incomingCall = await loadIncomingCallFromApi(appUserId);
                if (incomingCall) {
                    const fromName = String(incomingCall.fromName || '').trim();
                    const inviteId = String(incomingCall.inviteId || '').trim();
                    const roomId = String(incomingCall.roomId || '').trim();
                    title = fromName || 'Друг';
                    data.inviteId = inviteId;
                    data.roomId = roomId;
                    if (roomId) {
                        data.url = new URL(roomId, self.registration.scope).toString();
                    }
                }
            }
        } catch (_) {}
        await self.registration.showNotification(title, {
            body,
            tag: 'seych-friend-call',
            renotify: true,
            icon: NOTIFY_ICON,
            badge: NOTIFY_BADGE,
            actions: [
                { action: 'answer', title: 'Ответить' },
                { action: 'decline', title: 'Сброс' }
            ],
            data
        });
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil((async () => {
        const data = event.notification?.data || {};
        if (event.action === 'decline') {
            try {
                await declineInviteFromPush(
                    String(data.appUserId || '').trim(),
                    String(data.inviteId || '').trim()
                );
            } catch (_) {}
            const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            allClients.forEach((client) => {
                try {
                    client.postMessage({
                        type: 'friend-call-declined-from-push',
                        inviteId: String(data.inviteId || '').trim()
                    });
                } catch (_) {}
            });
            return;
        }
        const defaultUrl = data.url || './';
        const targetUrl = event.action === 'answer' ? defaultUrl : defaultUrl;
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
            if ('focus' in client) {
                client.focus();
                if ('navigate' in client) {
                    client.navigate(targetUrl);
                }
                return;
            }
        }
        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});
