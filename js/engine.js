        async function startAppWithConditionalLoader() {
            const shouldShowLoader = hasRuntimeUpdated();
            if (shouldShowLoader) {
                showStartupLoader();
            }
            try {
                await bootApp();
                persistRuntimeSignature();
                if (shouldShowLoader) {
                    await new Promise((resolve) => setTimeout(resolve, 900));
                }
            } finally {
                hideStartupLoader();
            }
        }

        function buildExternalAccountKey(profile) {
            const provider = String(profile?.provider || '').trim().toLowerCase();
            if (!provider) return '';
            if (provider === 'telegram') {
                const telegramId = String(profile?.telegramId || '').trim();
                if (telegramId) return `telegram:${telegramId}`;
                const telegramUsername = String(profile?.username || '').trim().toLowerCase().replace(/^@+/, '');
                if (telegramUsername) return `telegram_username:${telegramUsername}`;
            }
            if (provider === 'vk') {
                const vkUserId = String(profile?.vkUserId || '').trim();
                if (vkUserId) return `vk:${vkUserId}`;
                const vkUsername = String(profile?.vkUsername || '').trim().toLowerCase();
                if (vkUsername) return `vk_username:${vkUsername}`;
            }
            if (provider === 'google') {
                const googleSub = String(profile?.googleSub || '').trim();
                if (googleSub) return `google:${googleSub}`;
                const googleEmail = String(profile?.googleEmail || '').trim().toLowerCase();
                if (googleEmail) return `google_email:${googleEmail}`;
            }
            return '';
        }

        function buildIdentityKeys(profile) {
            const keys = [];
            const push = (value) => {
                const key = String(value || '').trim().toLowerCase();
                if (!key || keys.includes(key)) return;
                keys.push(key);
            };
            const provider = String(profile?.provider || '').trim().toLowerCase();
            if (provider === 'telegram') {
                const telegramId = String(profile?.telegramId || '').trim();
                const telegramUsername = String(profile?.username || '').trim().toLowerCase().replace(/^@+/, '');
                if (telegramId) push(`telegram:${telegramId}`);
                if (telegramUsername) push(`telegram_username:${telegramUsername}`);
            }
            if (provider === 'vk') {
                const vkUserId = String(profile?.vkUserId || '').trim();
                const vkUsername = String(profile?.vkUsername || '').trim().toLowerCase();
                if (vkUserId) push(`vk:${vkUserId}`);
                if (vkUsername) push(`vk_username:${vkUsername}`);
            }
            if (provider === 'google') {
                const googleSub = String(profile?.googleSub || '').trim();
                const googleEmail = String(profile?.googleEmail || '').trim().toLowerCase();
                if (googleSub) push(`google:${googleSub}`);
                if (googleEmail) push(`google_email:${googleEmail}`);
            }
            const externalKey = buildExternalAccountKey(profile);
            if (externalKey) push(externalKey);
            return keys;
        }

        function buildStableAppUserId(profile, fallbackAppUserId = '') {
            const externalKey = buildExternalAccountKey(profile);
            if (!externalKey) {
                const fallback = String(profile?.appUserId || fallbackAppUserId || '').trim();
                return fallback || generateAppUserId();
            }
            const h1 = hashIdentityPart(externalKey, 5381);
            const h2 = hashIdentityPart(`seych:${externalKey}`, 2166136261);
            return `u${h1}${h2}`;
        }

        function getOutgoingCallStatusStorageKey() {
            const userId = String(authProfile?.appUserId || appUserId || '').trim();
            if (!userId) return '';
            return `seych-outgoing-statuses:${userId}`;
        }

        function loadKnownOutgoingCallStatuses() {
            const storageKey = getOutgoingCallStatusStorageKey();
            if (!storageKey) return;
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return;
                const restored = new Map();
                parsed.forEach((row) => {
                    if (!Array.isArray(row) || row.length < 2) return;
                    const inviteId = String(row[0] || '').trim();
                    const status = String(row[1] || '').trim();
                    if (!inviteId || !status) return;
                    restored.set(inviteId, status);
                });
                knownOutgoingCallStatuses = restored;
            } catch (_) {}
        }

        function persistKnownOutgoingCallStatuses() {
            const storageKey = getOutgoingCallStatusStorageKey();
            if (!storageKey) return;
            try {
                const rows = Array.from(knownOutgoingCallStatuses.entries()).slice(-200);
                localStorage.setItem(storageKey, JSON.stringify(rows));
            } catch (_) {}
        }

        function touchKnownOutgoingCallStatus(inviteId, status) {
            const normalizedInviteId = String(inviteId || '').trim();
            const normalizedStatus = String(status || '').trim();
            if (!normalizedInviteId || !normalizedStatus) return;
            knownOutgoingCallStatuses.delete(normalizedInviteId);
            knownOutgoingCallStatuses.set(normalizedInviteId, normalizedStatus);
        }

        function clearKnownOutgoingCallStatusesStorage() {
            const storageKey = getOutgoingCallStatusStorageKey();
            if (!storageKey) return;
            try {
                localStorage.removeItem(storageKey);
            } catch (_) {}
        }

        function generateAppUserId() {
            return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        }

        function getStoredFriendsNotifyValue() {
            try {
                const raw = localStorage.getItem('seych-friends-notify');
                if (raw === '0') return false;
                if (raw === '1') return true;
            } catch (_) {}
            return true;
        }

        function persistFriendsNotifyValue(enabled) {
            friendsNotificationsEnabled = !!enabled;
            try {
                localStorage.setItem('seych-friends-notify', friendsNotificationsEnabled ? '1' : '0');
            } catch (_) {}
            if (friendsNotificationsEnabled) {
                ensureSystemNotificationPermission(true).catch(() => {});
                ensurePushNotificationsReady().catch(() => {});
            } else {
                disablePushNotificationsSubscription().catch(() => {});
            }
            renderMainScreen();
            showNotification('Друзья', friendsNotificationsEnabled ? 'Уведомления включены' : 'Уведомления выключены', 'info');
        }

        async function ensureSystemNotificationPermission(requestAccess = false) {
            if (!('Notification' in window)) return false;
            if (Notification.permission === 'granted') return true;
            if (!requestAccess) return false;
            if (systemNotifyPermissionAsked && Notification.permission !== 'default') {
                return Notification.permission === 'granted';
            }
            systemNotifyPermissionAsked = true;
            try {
                const result = await Notification.requestPermission();
                return result === 'granted';
            } catch (_) {
                return false;
            }
        }

        function showSystemNotification(title, body, tag = '') {
            if (!friendsNotificationsEnabled) return;
            if (!('Notification' in window)) return;
            if (Notification.permission !== 'granted') return;
            try {
                new Notification(title, {
                    body: String(body || ''),
                    tag: tag || undefined,
                    silent: false
                });
            } catch (_) {}
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = atob(base64);
            return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
        }

        async function initPushNotifications() {
            if (!authProfile?.appUserId || !friendsNotificationsEnabled) return;
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            if (Notification.permission !== 'granted') return;
            try {
                const basePath = getBasePath().replace(/\/$/, '');
                const swUrl = `${basePath || ''}/sw.js`;
                if (!pushRegistration) {
                    pushRegistration = await navigator.serviceWorker.register(swUrl);
                }
                await navigator.serviceWorker.ready;
                const pushConfig = await friendsApiRequest('push_config');
                const publicKey = String(pushConfig?.publicKey || '').trim();
                if (!publicKey) return;
                let subscription = await pushRegistration.pushManager.getSubscription();
                if (!subscription) {
                    subscription = await pushRegistration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(publicKey)
                    });
                }
                await friendsApiRequest('save_push_subscription', {
                    subscription: subscription.toJSON ? subscription.toJSON() : subscription
                });
                await syncPushContextToServiceWorker();
            } catch (_) {}
        }

        async function ensurePushNotificationsReady() {
            if (pushInitPromise) {
                await pushInitPromise;
                return;
            }
            pushInitPromise = initPushNotifications()
                .catch(() => {})
                .finally(() => {
                    pushInitPromise = null;
                });
            await pushInitPromise;
        }

        async function disablePushNotificationsSubscription() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            try {
                const basePath = getBasePath().replace(/\/$/, '');
                const swUrl = `${basePath || ''}/sw.js`;
                let registration = pushRegistration;
                if (!registration) {
                    registration = await navigator.serviceWorker.getRegistration(swUrl);
                }
                if (!registration) {
                    registration = await navigator.serviceWorker.ready.catch(() => null);
                }
                if (!registration) return;
                pushRegistration = registration;
                const subscription = await registration.pushManager.getSubscription();
                if (!subscription) return;
                await subscription.unsubscribe();
            } catch (_) {}
        }

        async function syncPushContextToServiceWorker() {
            if (!('serviceWorker' in navigator)) return;
            const currentAppUserId = String(authProfile?.appUserId || appUserId || '').trim();
            if (!currentAppUserId) return;
            try {
                const basePath = getBasePath().replace(/\/$/, '');
                const swUrl = `${basePath || ''}/sw.js`;
                let registration = pushRegistration;
                if (!registration) {
                    registration = await navigator.serviceWorker.getRegistration(swUrl);
                }
                if (!registration) {
                    registration = await navigator.serviceWorker.ready.catch(() => null);
                }
                if (!registration?.active) return;
                pushRegistration = registration;
                registration.active.postMessage({
                    type: 'push-context',
                    appUserId: currentAppUserId
                });
            } catch (_) {}
        }

        function getReconnectKey() {
            if (reconnectKey) return reconnectKey;
            try {
                const saved = sessionStorage.getItem(RECONNECT_KEY_STORAGE);
                if (saved && saved.length >= 10) {
                    reconnectKey = saved;
                    return reconnectKey;
                }
            } catch (_) {}
            reconnectKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
            try {
                sessionStorage.setItem(RECONNECT_KEY_STORAGE, reconnectKey);
            } catch (_) {}
            return reconnectKey;
        }

        function normalizeIceServers(list) {
            if (!Array.isArray(list)) return [];
            const out = [];
            list.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                const urls = Array.isArray(item.urls)
                    ? item.urls.filter((u) => typeof u === 'string' && u.trim())
                    : typeof item.urls === 'string' && item.urls.trim()
                        ? item.urls.trim()
                        : null;
                if (!urls) return;
                const server = { urls };
                if (typeof item.username === 'string' && item.username) server.username = item.username;
                if (typeof item.credential === 'string' && item.credential) server.credential = item.credential;
                const key = JSON.stringify(server);
                if (!out.some((entry) => JSON.stringify(entry) === key)) {
                    out.push(server);
                }
            });
            return out;
        }

        function applyIceServersFromPayload(payload) {
            const serverList = normalizeIceServers(payload?.iceServers);
            if (!serverList.length) return;
            rtcIceServers = serverList;
        }

        function getAssetUrl(path) {
            const safePath = String(path || '').replace(/^\/+/, '');
            const basePath = `${window.location.origin}${getBasePath().replace(/\/$/, '')}`;
            return `${basePath}/${safePath}`;
        }

        function initSoundEffects() {
            joinSoundEffect = new Audio(getAssetUrl('upload/login.mp3'));
            joinSoundEffect.preload = 'auto';
            leaveSoundEffect = new Audio(getAssetUrl('upload/logut.mp3'));
            leaveSoundEffect.preload = 'auto';
            kickSoundEffect = new Audio(getAssetUrl('upload/kick.mp3'));
            kickSoundEffect.preload = 'auto';
            if (!incomingCallSound) {
                incomingCallSound = new Audio(getAssetUrl('upload/rington.mp3'));
                incomingCallSound.loop = true;
                incomingCallSound.preload = 'auto';
            }
        }

        function playSoundEffect(sound) {
            if (!sound) return;
            try {
                sound.currentTime = 0;
                const playResult = sound.play();
                if (playResult && typeof playResult.catch === 'function') {
                    playResult.catch(() => {});
                }
            } catch (_) {}
        }

        function resolveWsUrls() {
            // Только Render сервер
            return [WS_URL];
        }

        function proxifyAvatarUrl(url) {
            const raw = String(url || '').trim();
            if (!raw) return '';
            if (/^data:image\//i.test(raw)) return raw;
            if (raw.startsWith(AVATAR_PROXY_API)) return raw;
            let parsed;
            try {
                parsed = new URL(raw, window.location.origin);
            } catch (_) {
                return '';
            }
            if (!/^https?:$/i.test(parsed.protocol)) return '';
            const host = parsed.hostname.toLowerCase();
            const allowedHosts = [
                't.me',
                'telegram.org',
                'googleusercontent.com',
                'ggpht.com',
                'ytimg.com',
                'vk.com',
                'vkuser.net',
                'userapi.com'
            ];
            const hostAllowed = allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
            if (!hostAllowed) return parsed.toString();
            return `${AVATAR_PROXY_API}${encodeURIComponent(parsed.toString())}`;
        }

        function showCustomPrompt(title, defaultValue, callback) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2><i class="fas fa-user"></i> ${title}</h2>
                    <input type="text" id="promptInput" class="modal-input" placeholder="Введите имя" value="${defaultValue}">
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" id="promptCancel">Отмена</button>
                        <button class="modal-btn confirm" id="promptConfirm">Продолжить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            document.getElementById('promptConfirm').onclick = () => {
                const val = document.getElementById('promptInput').value.trim();
                modal.remove();
                if (val) callback(val);
                else callback(defaultValue);
            };
            document.getElementById('promptCancel').onclick = () => {
                modal.remove();
                callback(defaultValue);
            };
        }

        function showCustomConfirm(title, message, onConfirm, onCancel) {
            const modal = document.createElement('div');
            modal.className = 'request-modal';
            modal.innerHTML = `
                <div class="request-content">
                    <div style="font-size: 48px;">${title.includes('камеру') ? '📹' : title.includes('микрофон') ? '🎤' : '❓'}</div>
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <div class="request-buttons">
                        <button class="request-btn cancel" id="confirmCancel">Отмена</button>
                        <button class="request-btn confirm" id="confirmOk">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            document.getElementById('confirmOk').onclick = () => {
                modal.remove();
                if (onConfirm) onConfirm();
            };
            document.getElementById('confirmCancel').onclick = () => {
                modal.remove();
                if (onCancel) onCancel();
            };
        }

        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        function clearOutgoingFriendCallTimeout() {
            if (!outgoingFriendCallTimeout) return;
            clearTimeout(outgoingFriendCallTimeout);
            outgoingFriendCallTimeout = null;
        }

        function isOutgoingFriendCallConnecting() {
            return !!(outgoingFriendCallSession && !outgoingFriendCallSession.answered);
        }

        function getOutgoingCallDots() {
            const sequence = [' ···', '.··', '..·', '...'];
            const step = Math.floor(Date.now() / 320) % sequence.length;
            return sequence[step];
        }

        function applyCallConnectionBadges() {
            const connecting = isOutgoingFriendCallConnecting();
            const privacyIslandBadge = document.getElementById('privacyIslandBadge');
            const privacyIslandLabel = document.getElementById('privacyIslandLabel');
            const roomPrivacyBadge = document.getElementById('roomPrivacyBadge');

            if (privacyIslandBadge) {
                if (connecting) {
                    privacyIslandBadge.className = 'room-status connecting';
                    privacyIslandBadge.title = 'Соединение';
                    privacyIslandBadge.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
                } else {
                    privacyIslandBadge.className = `room-status ${roomIsPrivate ? 'private' : 'public'}`;
                    privacyIslandBadge.title = roomIsPrivate ? 'Закрытая' : 'Публичная';
                    privacyIslandBadge.innerHTML = `<i class="fas ${roomIsPrivate ? 'fa-lock' : 'fa-globe'}"></i>`;
                }
            }
            if (privacyIslandLabel) {
                privacyIslandLabel.textContent = connecting ? 'Соединение' : (roomIsPrivate ? 'Приватный' : 'Публичный');
            }
            if (roomPrivacyBadge) {
                if (connecting) {
                    roomPrivacyBadge.className = 'room-status connecting';
                    roomPrivacyBadge.title = 'Соединение';
                    roomPrivacyBadge.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
                } else {
                    roomPrivacyBadge.className = `room-status ${roomIsPrivate ? 'private' : 'public'}`;
                    roomPrivacyBadge.title = roomIsPrivate ? 'Закрытая' : 'Публичная';
                    roomPrivacyBadge.innerHTML = `<i class="fas ${roomIsPrivate ? 'fa-lock' : 'fa-globe'}"></i>`;
                }
            }
        }

        function updateCallTimerDisplay() {
            const timerElement = document.getElementById('callTimer');
            const emptyTimerElement = document.getElementById('emptyCallTimer');
            let text = '00:00';
            if (isOutgoingFriendCallConnecting()) {
                const dots = getOutgoingCallDots();
                text = `Звоним ${outgoingFriendCallSession.targetName || 'другу'}${dots}`;
            } else if (!isConnected || wsReconnectTimer || (ws && ws.readyState !== WebSocket.OPEN)) {
                text = 'Соединение...';
            } else if (callStartTime) {
                const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
                text = formatTime(Math.max(0, elapsed));
            }
            if (timerElement) timerElement.textContent = text;
            if (emptyTimerElement) emptyTimerElement.textContent = text;
            const islandTimer = document.getElementById('callIslandTimer');
            if (islandTimer) islandTimer.textContent = text;
            applyCallConnectionBadges();
        }

        function clearOutgoingFriendCallSession() {
            clearOutgoingFriendCallTimeout();
            outgoingFriendCallSession = null;
            updateCallTimerDisplay();
        }

        function cancelPendingOutgoingFriendCall(reason = '') {
            const activeSession = outgoingFriendCallSession;
            if (!activeSession?.inviteId || activeSession.answered) return;
            friendsApiRequest('cancel_call_invite', { invite_id: activeSession.inviteId, reason })
                .catch(() => {});
        }

        function startOutgoingFriendCallSession(session) {
            const targetName = String(session?.targetName || 'другу').trim();
            outgoingFriendCallSession = {
                inviteId: String(session?.inviteId || '').trim(),
                roomId: String(session?.roomId || '').trim(),
                targetId: String(session?.targetId || '').trim(),
                targetName,
                startedAt: Date.now(),
                answered: false
            };
            clearOutgoingFriendCallTimeout();
            outgoingFriendCallTimeout = setTimeout(() => {
                const current = outgoingFriendCallSession;
                if (!current || current.answered) return;
                if (roomId && current.roomId && roomId === current.roomId) {
                    showNotification('Звонок другу', `${current.targetName} не ответил за 1 минуту`, 'warning');
                    cancelPendingOutgoingFriendCall('timeout');
                    endCall(false);
                }
            }, 60000);
            updateCallTimerDisplay();
        }

        function acceptOutgoingFriendCallSession() {
            if (!outgoingFriendCallSession) return;
            outgoingFriendCallSession.answered = true;
            clearOutgoingFriendCallTimeout();
            callStartTime = Date.now();
            updateCallTimerDisplay();
        }

        function startCallTimer() {
            if (callTimerInterval) clearInterval(callTimerInterval);
            callStartTime = Date.now();
            updateCallTimerDisplay();
            callTimerInterval = setInterval(() => {
                updateCallTimerDisplay();
            }, 1000);
        }

        function stopCallTimer() {
            if (callTimerInterval) {
                clearInterval(callTimerInterval);
                callTimerInterval = null;
            }
        }

        function resetCallState() {
            stopCallAudioHealTimer();
            cancelAnimationFrame(animationId);
            currentGroupCallChatId = '';
            currentGroupCallTitle = '';
            if (audioContextRef && audioContextRef.state !== 'closed') {
                try { audioContextRef.close(); } catch (_) {}
            }
            audioContextRef = null;
            isConnected = false;
            myId = null;
            ownerId = null;
            currentContextTargetId = null;
            remoteName = '';
            remoteAvatar = '';
            remoteVideo = false;
            remoteAudio = true;
            remoteScreen = false;
            isScreenSharing = false;
            isSpeaking = false;
            remoteSpeaking = false;
            peers.forEach(p => { try { p.destroy(); } catch (_) {} });
            peers.clear();
            participants.clear();
            participantAvatars.clear();
            participantStates.clear();
            screenConnMap.clear();
            localScreenShareId = null;
            videoTiles.forEach(tile => { try { tile.remove(); } catch (_) {} });
            videoTiles.clear();
            screenTiles.forEach(tile => { try { tile.remove(); } catch (_) {} });
            screenTiles.clear();
            removeWatchPartyTile();
            watchPartyState = null;
            remoteMediaStreams.clear();
            stopRemoteAudio();
            roomIsPrivate = false;
            pendingJoinRequests = [];
            participantConnectionQuality.clear();
            avPeerRecoverTimers.forEach((timerId) => clearTimeout(timerId));
            avPeerRecoverTimers.clear();
            clearOutgoingFriendCallSession();
            if (joinPendingModal) {
                try { joinPendingModal.remove(); } catch (_) {}
                joinPendingModal = null;
            }
            if (roomSettingsMenu) {
                try { roomSettingsMenu.remove(); } catch (_) {}
                roomSettingsMenu = null;
            }
            if (videoTrack) {
                videoTrack.stop();
                videoTrack = null;
            }
            if (cameraSourceTrack && cameraSourceTrack !== videoTrack) {
                try { cameraSourceTrack.stop(); } catch (_) {}
            }
            cameraSourceTrack = null;
            selfPreviewTrack = null;
            if (outgoingTrackCleanup) {
                try { outgoingTrackCleanup(); } catch (_) {}
            }
            outgoingTrackCleanup = null;
            cameraFacingMode = 'user';
            cameraSwitchInProgress = false;
            try {
                const csr = document.getElementById('callScreenRoot');
                if (csr) csr.remove();
            } catch (_) {}
        }

        function updateCreatorFlag() {
            const oid = String(ownerId ?? '');
            const mid = String(myId ?? '');
            isCreator = !!mid && oid === mid;
        }

        function getParticipantState(participantId) {
            if (!participantId) return null;
            if (!participantStates.has(participantId)) {
                participantStates.set(participantId, {
                    id: participantId,
                    userName: participants.get(participantId) || '',
                    userAvatar: participantAvatars.get(participantId) || '',
                    video: false,
                    audio: true,
                    screen: false,
                    speaking: false,
                    isAdmin: false,
                    cameraFacingMode: '',
                    appUserId: ''
                });
            }
            return participantStates.get(participantId);
        }

        function upsertParticipantState(raw) {
            if (!raw || !raw.id) return;
            participants.set(raw.id, raw.userName || participants.get(raw.id) || '');
            participantAvatars.set(raw.id, raw.userAvatar || participantAvatars.get(raw.id) || '');
            const state = getParticipantState(raw.id);
            state.id = raw.id;
            state.userName = raw.userName || state.userName || '';
            state.userAvatar = raw.userAvatar || state.userAvatar || '';
            if (typeof raw.video === 'boolean') state.video = raw.video;
            if (typeof raw.audio === 'boolean') state.audio = raw.audio;
            if (typeof raw.screen === 'boolean') state.screen = raw.screen;
            if (typeof raw.speaking === 'boolean') state.speaking = raw.speaking;
            if (typeof raw.isAdmin === 'boolean') state.isAdmin = raw.isAdmin;
            if (typeof raw.cameraFacingMode === 'string') state.cameraFacingMode = normalizeFacingMode(raw.cameraFacingMode, '');
            if (typeof raw.appUserId === 'string') state.appUserId = raw.appUserId;
        }

        function removeParticipantState(participantId) {
            participants.delete(participantId);
            participantAvatars.delete(participantId);
            participantStates.delete(participantId);
            participantConnectionQuality.delete(participantId);
            audioRecoverCooldown.delete(participantId);
            connectionNoticeCooldown.delete(participantId);
            remoteMediaStreams.delete(participantId);
            stopRemoteAudio(participantId);
            const timerId = avPeerRecoverTimers.get(participantId);
            if (timerId) {
                clearTimeout(timerId);
                avPeerRecoverTimers.delete(participantId);
            }
        }

        function getRemoteParticipantIds() {
            return Array.from(participantStates.keys()).filter(id => !!id && id !== myId);
        }

        function shouldInitiatePeer(localId, remoteId) {
            if (!localId || !remoteId) return false;
            return String(localId) < String(remoteId);
        }

        function isAvPeerHealthy(peer) {
            if (!peer || peer.destroyed) return false;
            if (peer.connected) return true;
            const pc = peer._pc;
            if (!pc) return true;
            const iceState = String(pc.iceConnectionState || '').toLowerCase();
            const connState = String(pc.connectionState || '').toLowerCase();
            // disconnected — состояние, которое можно вылечить ICE-restart; не считаем его "мертвым" сразу.
            if (['failed', 'closed'].includes(iceState) || ['failed', 'closed'].includes(connState)) {
                return false;
            }
            return true;
        }

        function ensureAvPeerForParticipant(participantId, initiator = null) {
            if (!participantId || participantId === myId || !localStream) return null;
            const avKey = `av-${participantId}`;
            const existing = peers.get(avKey);
            if (isAvPeerHealthy(existing)) {
                return existing;
            }
            if (existing && !existing.destroyed) {
                try { existing.destroy(); } catch (_) {}
            }
            peers.delete(avKey);
            const state = getParticipantState(participantId);
            const shouldInitiate = typeof initiator === 'boolean' ? initiator : shouldInitiatePeer(myId, participantId);
            const avPeer = createPeer(localStream, 'video', shouldInitiate, participantId, state.userName || '');
            peers.set(avKey, avPeer);
            return avPeer;
        }

        function getConnectionQuality(participantId) {
            return participantConnectionQuality.get(participantId) || 'normal';
        }

        async function refreshConnectionQuality() {
            if (!roomId || !isConnected) return;
            if (connectionQualityBusy) return;
            connectionQualityBusy = true;
            let changed = false;
            try {
                const keys = Array.from(peers.keys()).filter((key) => key.startsWith('av-'));
                for (const key of keys) {
                    const participantId = key.slice(3);
                    if (!participantId) continue;
                    const prevLevel = participantConnectionQuality.get(participantId) || 'normal';
                    const peer = peers.get(key);
                    if (!peer || peer.destroyed) {
                        if (participantConnectionQuality.get(participantId) !== 'weak') {
                            participantConnectionQuality.set(participantId, 'weak');
                            changed = true;
                        }
                        continue;
                    }
                    const pc = peer._pc;
                    const iceState = String(pc?.iceConnectionState || '').toLowerCase();
                    if (iceState === 'disconnected') {
                        // Это не "плохой RTT", а реальное переподключение.
                        if (participantConnectionQuality.get(participantId) !== 'reconnecting') {
                            participantConnectionQuality.set(participantId, 'reconnecting');
                            changed = true;
                        }
                        continue;
                    }

                    let level = peer.connected ? 'good' : 'normal';
                    if (pc && typeof pc.getStats === 'function') {
                        try {
                            const stats = await pc.getStats();
                            let rtt = null;
                            stats.forEach((report) => {
                                if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated) && typeof report.currentRoundTripTime === 'number') {
                                    rtt = report.currentRoundTripTime;
                                }
                            });
                            if (typeof rtt === 'number') {
                                if (rtt <= 0.12) level = 'good';
                                else if (rtt <= 0.28) level = 'normal';
                                else level = 'weak';
                            } else if (peer.connected) {
                                level = 'normal';
                            }
                        } catch (_) {
                            if (peer.connected) level = 'normal';
                        }
                    }
                    if (participantConnectionQuality.get(participantId) !== level) {
                        participantConnectionQuality.set(participantId, level);
                        changed = true;
                    }
                    const nextLevel = participantConnectionQuality.get(participantId) || level;
                    if (prevLevel !== nextLevel) {
                        const state = getParticipantState(participantId);
                        const participantName = state?.userName || 'собеседником';
                        const now = Date.now();
                        const lastNotice = connectionNoticeCooldown.get(participantId) || 0;
                        if (nextLevel === 'weak' && now - lastNotice > 15000) {
                            showNotification('Связь', `Плохая связь с ${participantName}`, 'warning', '<i class="fas fa-signal"></i>');
                            connectionNoticeCooldown.set(participantId, now);
                        }
                    }
                }
                getRemoteParticipantIds().forEach((id) => {
                    if (!keys.includes(`av-${id}`) && participantConnectionQuality.get(id) !== 'weak') {
                        participantConnectionQuality.set(id, 'weak');
                        changed = true;
                    }
                });
                healRemoteAudioLinks();
            } finally {
                connectionQualityBusy = false;
            }
            if (changed) updateUI();
        }

        function improveVideoSdpQuality(sdp, bitrateKbps = 1200) {
            if (!sdp || typeof sdp !== 'string') return sdp;
            const lines = sdp.split('\r\n');
            const out = [];
            let inVideo = false;
            const safeBitrate = Number.isFinite(bitrateKbps) ? Math.max(512, Math.min(5000, Math.floor(bitrateKbps))) : 1200;
            for (const line of lines) {
                if (line.startsWith('m=')) {
                    inVideo = line.startsWith('m=video');
                    out.push(line);
                    continue;
                }
                if (inVideo && line.startsWith('b=AS:')) {
                    continue;
                }
                out.push(line);
                if (inVideo && line.startsWith('c=')) {
                    out.push(`b=AS:${safeBitrate}`);
                }
            }
            return out.join('\r\n');
        }

        function updatePrimaryRemoteState() {
            const firstRemoteId = getRemoteParticipantIds()[0] || null;
            if (!firstRemoteId) {
                remoteName = '';
                remoteAvatar = '';
                remoteVideo = false;
                remoteAudio = true;
                remoteScreen = false;
                remoteSpeaking = false;
                window.remoteIsAdmin = false;
                return;
            }
            const state = getParticipantState(firstRemoteId);
            remoteName = state.userName || participants.get(firstRemoteId) || '';
            remoteAvatar = state.userAvatar || participantAvatars.get(firstRemoteId) || '';
            remoteVideo = !!state.video;
            remoteAudio = !!state.audio;
            remoteScreen = !!state.screen;
            remoteSpeaking = !!state.speaking;
            window.remoteIsAdmin = !!state.isAdmin;
        }

        function showNotification(title, message, type = 'info', iconMarkup = '') {
            try {
                if (typeof document === 'undefined') return;
                let stack = document.getElementById('seychToastStack');
                if (!stack) {
                    stack = document.createElement('div');
                    stack.id = 'seychToastStack';
                    stack.className = 'seych-toast-stack';
                    document.body.appendChild(stack);
                }
                const kind = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info';
                const toast = document.createElement('div');
                toast.className = 'seych-toast seych-toast--' + kind;
                let icon = String(iconMarkup || '');
                if (!icon) {
                    const icons = {
                        success: '<i class="fas fa-check-circle"></i>',
                        warning: '<i class="fas fa-exclamation-triangle"></i>',
                        error: '<i class="fas fa-times-circle"></i>',
                        info: '<i class="fas fa-info-circle"></i>'
                    };
                    icon = icons[kind] || icons.info;
                }
                const titleHtml = title ? '<div class="seych-toast-title">' + escapeHtml(title) + '</div>' : '';
                toast.innerHTML =
                    '<span class="seych-toast-icon">' + icon + '</span>' +
                    '<div class="seych-toast-text">' + titleHtml + '<div class="seych-toast-msg">' + escapeHtml(message || '') + '</div></div>';
                toast.addEventListener('click', function () {
                    dismissToast(toast);
                });
                stack.appendChild(toast);
                requestAnimationFrame(function () {
                    toast.classList.add('seych-toast--show');
                });
                toast.__hideTimer = setTimeout(function () {
                    dismissToast(toast);
                }, 3200);
                while (stack.children.length > 4) {
                    const oldest = stack.firstElementChild;
                    if (!oldest) break;
                    if (!oldest.__hiding) dismissToast(oldest);
                    if (oldest.__hiding && oldest.parentNode) oldest.parentNode.removeChild(oldest);
                }
            } catch (_) {}
        }

        function dismissToast(toast) {
            if (!toast || toast.__hiding) return;
            toast.__hiding = true;
            if (toast.__hideTimer) {
                clearTimeout(toast.__hideTimer);
                toast.__hideTimer = null;
            }
            toast.classList.remove('seych-toast--show');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 280);
        }

        function escapeHtml(v) {
            return String(v || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderMaybeMarqueeText(text, threshold = 10, baseClass = '') {
            const raw = String(text || '');
            const value = raw.trim();
            const cls = String(baseClass || '').trim();
            if (value.length > threshold) {
                const full = cls ? `${cls} seych-marquee` : 'seych-marquee';
                return `<span class="${escapeHtml(full)}"><span class="seych-marquee__inner">${escapeHtml(raw)}</span></span>`;
            }
            if (cls) return `<span class="${escapeHtml(cls)}">${escapeHtml(raw)}</span>`;
            return escapeHtml(raw);
        }

        function syncComposerMentionMenuDom(chatOverride = null) {
            const host = document.getElementById('composerMentionMenuHost');
            if (!host) return;
            const chat = chatOverride || resolveActiveMessengerChat();
            const html = renderComposerMentionMenu(chat);
            if (host.innerHTML !== html) host.innerHTML = html;
        }

        const LINKIFY_SKIP_TLDS = new Set([
            'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp3', 'mp4', 'webm', 'zip', 'rar', '7z',
            'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'xml', 'csv', 'log', 'js', 'css', 'map', 'json', 'wasm'
        ]);

        function linkifyOverlaps(intervals, s, e) {
            return intervals.some((it) => !(e <= it.start || s >= it.end));
        }

        /**
         * Делает URL в тексте кликабельными; опционально добавляет блок для превью первой ссылки.
         * @param {string} raw
         * @param {{ includePreview?: boolean }} opts
         */
        function linkifyMessengerText(raw, opts) {
            const includePreview = !!(opts && opts.includePreview);
            const chat = opts && opts.chat ? opts.chat : resolveActiveMessengerChat();
            const text = String(raw || '');
            if (!text) return '';
            const intervals = [];

            const reSysUserTag = /\[\[user:([^\]|]{1,220})\|([^\]]{1,220})\]\]/g;
            let m;
            while ((m = reSysUserTag.exec(text)) !== null) {
                const userId = String(m[1] || '').trim();
                const label = String(m[2] || '').trim();
                if (!userId || !label) continue;
                intervals.push({
                    start: m.index,
                    end: reSysUserTag.lastIndex,
                    raw: m[0],
                    type: 'user_tag',
                    userId,
                    label
                });
            }

            const reProto = /https?:\/\/[^\s<>"']+/gi;
            while ((m = reProto.exec(text)) !== null) {
                intervals.push({
                    start: m.index,
                    end: reProto.lastIndex,
                    raw: m[0],
                    href: m[0]
                });
            }

            const reWww = /www\.[^\s<>"']+/gi;
            while ((m = reWww.exec(text)) !== null) {
                if (linkifyOverlaps(intervals, m.index, reWww.lastIndex)) continue;
                intervals.push({
                    start: m.index,
                    end: reWww.lastIndex,
                    raw: m[0],
                    href: 'https://' + m[0]
                });
            }

            const reBare = /(^|[^\w@/])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)(?:\/[^\s<>"']*)?)/gi;
            while ((m = reBare.exec(text)) !== null) {
                const start = m.index + m[1].length;
                const rawUrl = m[2];
                const end = start + rawUrl.length;
                if (linkifyOverlaps(intervals, start, end)) continue;
                const hostPart = rawUrl.split('/')[0];
                const tld = hostPart.split('.').pop().toLowerCase();
                if (LINKIFY_SKIP_TLDS.has(tld)) continue;
                intervals.push({
                    start,
                    end,
                    raw: rawUrl,
                    href: 'https://' + rawUrl
                });
            }

            const reMention = /(^|[^a-zA-Z0-9])@([a-zA-Z0-9]{3,32})/g;
            while ((m = reMention.exec(text)) !== null) {
                const start = m.index + m[1].length;
                const rawMention = `@${m[2]}`;
                const end = start + rawMention.length;
                if (linkifyOverlaps(intervals, start, end)) continue;
                const peer = getPeerByUsername(m[2], chat);
                if (!peer?.id) continue;
                intervals.push({
                    start,
                    end,
                    raw: rawMention,
                    type: 'mention',
                    username: m[2],
                    userId: peer.id
                });
            }

            intervals.sort((a, b) => a.start - b.start || b.end - a.end - (b.start - a.start));

            let out = '';
            let last = 0;
            let firstHref = null;
            for (const it of intervals) {
                if (it.start < last) continue;
                out += escapeHtml(text.slice(last, it.start));
                const labelEsc = escapeHtml(text.slice(it.start, it.end));
                if (it.type === 'user_tag') {
                    out += `<a href="#" class="mention-link" onclick="openUserProfile('${escapeHtml(it.userId || '')}'); return false;">${escapeHtml(it.label || '')}</a>`;
                } else if (it.type === 'mention') {
                    out += `<a href="#" class="mention-link" onclick="openMentionProfile('${escapeHtml(it.username || '')}'); return false;">${labelEsc}</a>`;
                } else {
                    if (!firstHref) firstHref = it.href;
                    const hrefEsc = escapeHtml(it.href);
                    out += `<a href="${hrefEsc}" target="_blank" rel="noopener noreferrer" class="chat-msg-link">${labelEsc}</a>`;
                }
                last = it.end;
            }
            out += escapeHtml(text.slice(last));
            if (includePreview && firstHref) {
                const enc = encodeURIComponent(firstHref);
                out += `<div class="msg-link-preview" data-preview-url="${enc}"></div>`;
            }
            return out;
        }

        function normalizeMessengerUsernameValue(value) {
            return String(value || '')
                .replace(/^@+/, '')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .slice(0, 32);
        }

        function ensureGeneratedMessengerUsername(value, fallbackId) {
            const normalized = normalizeMessengerUsernameValue(value);
            if (normalized) return normalized;
            const cleanId = String(fallbackId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return `user${(cleanId.slice(-8) || '00000000').padStart(8, '0')}`.slice(0, 32);
        }

        function messengerPlainTextPreview(text) {
            const raw = String(text || '');
            if (!raw) return '';
            const groupEvent = raw.match(/^\[\[group-event:(.+)\]\]$/);
            if (groupEvent) {
                try {
                    const payload = JSON.parse(groupEvent[1]);
                    return String(payload?.title || 'Системное сообщение');
                } catch (_) {
                    return 'Системное сообщение';
                }
            }
            return raw
                .replace(/\[\[user:([^\]|]{1,220})\|([^\]]{1,220})\]\]/g, '$2')
                .replace(/@(\w+)/g, '@$1')
                .replace(/\[\[user:[^\]]*\]\]/g, '@user')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function renderMessengerLinkPreviewCard(el, data) {
            const href = String(data.url || '').trim();
            const title = escapeHtml(String(data.title || href || 'Ссылка').slice(0, 300));
            const desc = escapeHtml(String(data.description || '').slice(0, 400));
            let host = '';
            try {
                host = escapeHtml(new URL(href).hostname || '');
            } catch (_) {}
            const img = String(data.image || '').trim();
            const imgEsc = img ? escapeHtml(img) : '';
            el.className = 'msg-link-preview msg-link-preview--ready';
            el.innerHTML = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="msg-link-preview-card">
                ${imgEsc ? `<div class="msg-link-preview-img-wrap"><img src="${imgEsc}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ''}
                <div class="msg-link-preview-body">
                    <div class="msg-link-preview-title">${title}</div>
                    ${desc ? `<div class="msg-link-preview-desc">${desc}</div>` : ''}
                    ${host ? `<div class="msg-link-preview-host">${host}</div>` : ''}
                </div>
            </a>`;
        }

        function hydrateMessengerLinkPreviews() {
            try {
                document.querySelectorAll('.msg-link-preview[data-preview-url]:not([data-preview-hydrated])').forEach((el) => {
                    el.setAttribute('data-preview-hydrated', '1');
                    let url = '';
                    try {
                        url = decodeURIComponent(String(el.getAttribute('data-preview-url') || '').trim());
                    } catch (_) {
                        el.remove();
                        return;
                    }
                    if (!url || !/^https?:\/\//i.test(url)) {
                        el.remove();
                        return;
                    }

                    const finish = (data) => {
                        if (!data || !data.ok) {
                            el.remove();
                            return;
                        }
                        renderMessengerLinkPreviewCard(el, data);
                    };

                    const cached = messengerLinkPreviewCache.get(url);
                    if (cached) {
                        finish(cached);
                        return;
                    }

                    el.classList.add('msg-link-preview--loading');
                    let p = messengerLinkPreviewPromises.get(url);
                    if (!p) {
                        p = fetch(`${LINK_PREVIEW_API}?url=${encodeURIComponent(url)}`)
                            .then((r) => r.json())
                            .then((data) => {
                                if (data && data.ok) messengerLinkPreviewCache.set(url, data);
                                return data;
                            })
                            .catch(() => null)
                            .finally(() => {
                                messengerLinkPreviewPromises.delete(url);
                            });
                        messengerLinkPreviewPromises.set(url, p);
                    }
                    p.then(finish);
                });
            } catch (_) {}
        }

        function avatarMarkup(name, avatarUrl, initialsHint) {
            const safeName = String(name || '').trim();
            const fromParts = safeName.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2);
            const fallback = String(initialsHint || fromParts || (safeName ? safeName.slice(0, 2) : '') || '·').slice(0, 2).toUpperCase();
            const safeUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
            if (safeUrl) {
                const fbAttr = escapeHtml(fallback).replace(/"/g, '&quot;');
                return `<img class="messenger-avatar-img" src="${escapeHtml(safeUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" data-fallback="${fbAttr}" onerror="avatarImgOnError(this)">`;
            }
            return `<span class="messenger-avatar-fallback">${escapeHtml(fallback)}</span>`;
        }

        function avatarImgOnError(img) {
            if (!img || !img.parentNode) return;
            const fb = String(img.getAttribute('data-fallback') || '·').slice(0, 3) || '·';
            const span = document.createElement('span');
            span.className = 'messenger-avatar-fallback';
            span.textContent = fb;
            img.replaceWith(span);
        }

        function formatVoiceDurationMs(ms) {
            const sec = Math.max(0, Math.round(Number(ms) / 1000));
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        }

