
        function resolveAssetUrl(relativePath) {
            const basePath = getBasePath().replace(/\/$/, '');
            const rel = String(relativePath || '').replace(/^\/+/, '');
            return `${basePath}/${rel}`;
        }

        function buildRoomLink(targetRoomId) {
            const basePath = getBasePath().replace(/\/$/, '');
            return `${window.location.origin}${basePath}/${targetRoomId}`;
        }

        function getRoomInviteToCopy() {
            if (!roomId) return '';
            return String(roomId);
        }

        function parseRoomFromPath() {
            const params = new URLSearchParams(window.location.search);
            const startPayload = params.get('tgWebAppStartParam') || params.get('startapp') || params.get('start') || '';
            if (/^id[a-z0-9_-]+$/i.test(startPayload)) {
                return startPayload;
            }
            const parts = window.location.pathname.split('/').filter(Boolean);
            if (parts.length && parts[parts.length - 1].toLowerCase() === 'index.html') {
                parts.pop();
            }
            const last = parts[parts.length - 1] || '';
            if (/^id[a-z0-9_-]+$/i.test(last)) {
                return last;
            }
            return null;
        }

        function parseRoomInput(raw) {
            const value = String(raw || '').trim();
            if (!value) return '';
            if (/^id[a-z0-9_-]+$/i.test(value)) return value;
            try {
                const url = new URL(value);
                const segs = url.pathname.split('/').filter(Boolean);
                const maybeRoom = segs[segs.length - 1] || '';
                if (/^id[a-z0-9_-]+$/i.test(maybeRoom)) return maybeRoom;
            } catch (_) {}
            return '';
        }

        function parseGroupInviteFromLocation() {
            try {
                const params = new URLSearchParams(window.location.search);
                return String(params.get('groupInvite') || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
            } catch (_) {
                return '';
            }
        }

        function removeQueryParamFromLocation(paramName) {
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete(paramName);
                const next = `${url.pathname}${url.search ? url.search : ''}${url.hash || ''}`;
                history.replaceState(null, '', next);
            } catch (_) {}
        }

        function extractGroupInviteCodeFromHref(rawHref) {
            const href = String(rawHref || '').trim();
            if (!href) return '';
            try {
                const url = new URL(href, window.location.href);
                if (url.origin !== window.location.origin) return '';
                return String(url.searchParams.get('groupInvite') || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
            } catch (_) {
                return '';
            }
        }

        function consumePendingGroupInviteIfAny(forceCode = '') {
            const inviteCode = String(forceCode || pendingGroupInviteCode || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
            if (!inviteCode) return false;
            pendingGroupInviteCode = inviteCode;
            if (!authProfile?.appUserId) {
                renderAuthScreen();
                return false;
            }
            sendMessengerEvent({ type: 'messenger-preview-group-invite', inviteCode });
            removeQueryParamFromLocation('groupInvite');
            pendingGroupInviteCode = '';
            return true;
        }

        function generateRoomId() {
            return `id${Math.random().toString(36).substring(2, 10)}`;
        }

        function normalizeFacingMode(value, fallback = 'user') {
            const normalized = String(value || '').toLowerCase();
            if (normalized === 'environment') return 'environment';
            if (normalized === 'user') return 'user';
            return fallback;
        }

        function getTrackFacingMode(track, fallback = cameraFacingMode) {
            if (!track || typeof track.getSettings !== 'function') return normalizeFacingMode(fallback, 'user');
            const settings = track.getSettings();
            return normalizeFacingMode(settings?.facingMode, normalizeFacingMode(fallback, 'user'));
        }

        function applyVideoTileMirroring(userId) {
            const tile = videoTiles.get(userId);
            if (!tile) return;
            const video = tile.querySelector('video');
            if (!video) return;
            if (userId === 'self') {
                video.style.transform = cameraFacingMode === 'user' ? 'scaleX(-1)' : 'none';
                video.style.transformOrigin = 'center center';
                return;
            }
            video.style.transform = 'none';
            video.style.transformOrigin = 'center center';
        }

        function syncCameraFacingMode() {
            if (!videoEnabled || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'camera-facing', mode: cameraFacingMode }));
        }

        function applySelfPreviewTrack() {
            const tile = videoTiles.get('self');
            if (!tile) return;
            const video = tile.querySelector('video');
            if (!video || !selfPreviewTrack) return;
            const previewStream = new MediaStream([selfPreviewTrack]);
            if (video.srcObject !== previewStream) {
                video.srcObject = previewStream;
            }
            video.play().catch(() => {});
        }

        async function createOutgoingAntiMirrorTrack(sourceTrack) {
            if (!sourceTrack) return null;
            const settings = sourceTrack.getSettings ? sourceTrack.getSettings() : {};
            const width = Math.max(320, Math.floor(settings.width || 960));
            const height = Math.max(240, Math.floor(settings.height || 540));
            const frameRate = Math.max(60, Math.min(120, Math.floor(settings.frameRate || 60)));
            const sourceVideo = document.createElement('video');
            sourceVideo.muted = true;
            sourceVideo.autoplay = true;
            sourceVideo.playsInline = true;
            sourceVideo.srcObject = new MediaStream([sourceTrack]);
            try {
                await sourceVideo.play();
            } catch (_) {
                return null;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            let rafId = null;
            let frameCbId = null;
            let useVideoCallback = typeof sourceVideo.requestVideoFrameCallback === 'function';
            const draw = () => {
                try {
                    if (sourceVideo.readyState >= 2) {
                        ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
                        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                    }
                } catch (_) {}
                if (useVideoCallback) {
                    frameCbId = sourceVideo.requestVideoFrameCallback(draw);
                } else {
                    rafId = requestAnimationFrame(draw);
                }
            };
            draw();
            const outStream = canvas.captureStream(frameRate);
            const outTrack = outStream.getVideoTracks()[0] || null;
            if (!outTrack) {
                if (rafId) cancelAnimationFrame(rafId);
                if (frameCbId && typeof sourceVideo.cancelVideoFrameCallback === 'function') {
                    try { sourceVideo.cancelVideoFrameCallback(frameCbId); } catch (_) {}
                }
                try { sourceVideo.pause(); } catch (_) {}
                sourceVideo.srcObject = null;
                return null;
            }
            outTrack.contentHint = 'motion';
            const cleanup = () => {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                if (frameCbId && typeof sourceVideo.cancelVideoFrameCallback === 'function') {
                    try { sourceVideo.cancelVideoFrameCallback(frameCbId); } catch (_) {}
                    frameCbId = null;
                }
                try { outStream.getTracks().forEach((track) => track.stop()); } catch (_) {}
                try { sourceVideo.pause(); } catch (_) {}
                sourceVideo.srcObject = null;
            };
            return { track: outTrack, cleanup };
        }

        async function createCameraTracks(preferredFacingMode = cameraFacingMode) {
            const normalizedFacing = normalizeFacingMode(preferredFacingMode, 'user');
            const baseVideo = {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 60, max: 120 }
            };
            const attempts = [
                { ...baseVideo, facingMode: { exact: normalizedFacing } },
                { ...baseVideo, facingMode: { ideal: normalizedFacing } },
                { ...baseVideo }
            ];
            let lastError = null;
            let sourceTrack = null;
            for (const video of attempts) {
                try {
                    const videoStream = await navigator.mediaDevices.getUserMedia({ video });
                    const track = videoStream.getVideoTracks()[0] || null;
                    if (track) {
                        sourceTrack = track;
                        break;
                    }
                } catch (error) {
                    lastError = error;
                }
            }
            if (!sourceTrack) throw lastError || new Error('No video track');
            const resolvedFacingMode = getTrackFacingMode(sourceTrack, normalizedFacing);
            let outgoingTrack = sourceTrack;
            let cleanup = null;
            if (resolvedFacingMode === 'user') {
                const transformed = await createOutgoingAntiMirrorTrack(sourceTrack);
                if (transformed && transformed.track) {
                    outgoingTrack = transformed.track;
                    cleanup = transformed.cleanup;
                }
            }
            return {
                sourceTrack,
                outgoingTrack,
                facingMode: resolvedFacingMode,
                previewTrack: sourceTrack,
                cleanup
            };
        }

        function detachCurrentVideoTrack(stopTrack = true) {
            if (!videoTrack) return;
            peers.forEach((peer, key) => {
                if (!key.startsWith('av-') || !peer || peer.destroyed || typeof peer.removeTrack !== 'function') return;
                try {
                    peer.removeTrack(videoTrack, localStream);
                } catch (_) {}
            });
            try { localStream.removeTrack(videoTrack); } catch (_) {}
            if (stopTrack) {
                try { videoTrack.stop(); } catch (_) {}
            }
            if (outgoingTrackCleanup) {
                try { outgoingTrackCleanup(); } catch (_) {}
                outgoingTrackCleanup = null;
            }
            if (stopTrack && cameraSourceTrack && cameraSourceTrack !== videoTrack) {
                try { cameraSourceTrack.stop(); } catch (_) {}
            }
            videoTrack = null;
            cameraSourceTrack = null;
            selfPreviewTrack = null;
        }

        function replaceVideoTrackForAllPeers(oldTrack, newTrack) {
            if (!newTrack || !localStream) return;
            getRemoteParticipantIds().forEach((participantId) => {
                const peer = ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
                if (!peer || peer.destroyed) return;
                let updated = false;
                if (oldTrack && typeof peer.replaceTrack === 'function') {
                    try {
                        peer.replaceTrack(oldTrack, newTrack, localStream);
                        updated = true;
                    } catch (_) {}
                }
                if (!updated) {
                    if (oldTrack && typeof peer.removeTrack === 'function') {
                        try { peer.removeTrack(oldTrack, localStream); } catch (_) {}
                    }
                    if (typeof peer.addTrack === 'function') {
                        try {
                            peer.addTrack(newTrack, localStream);
                            updated = true;
                        } catch (error) {
                            const text = String(error?.message || '');
                            if (/already|exist|added/i.test(text)) {
                                updated = true;
                            }
                        }
                    }
                }
                if (!updated) {
                    recreateAvPeerForParticipant(participantId);
                }
            });
        }

        function replaceAudioTrackForAllPeers(oldTrack, newTrack) {
            if (!newTrack || !localStream) return;
            getRemoteParticipantIds().forEach((participantId) => {
                const peer = ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
                if (!peer || peer.destroyed) return;
                let updated = false;
                if (oldTrack && typeof peer.replaceTrack === 'function') {
                    try {
                        peer.replaceTrack(oldTrack, newTrack, localStream);
                        updated = true;
                    } catch (_) {}
                }
                if (!updated) {
                    if (oldTrack && typeof peer.removeTrack === 'function') {
                        try { peer.removeTrack(oldTrack, localStream); } catch (_) {}
                    }
                    if (typeof peer.addTrack === 'function') {
                        try {
                            peer.addTrack(newTrack, localStream);
                            updated = true;
                        } catch (error) {
                            const text = String(error?.message || '');
                            if (/already|exist|added/i.test(text)) updated = true;
                        }
                    }
                }
                if (!updated) recreateAvPeerForParticipant(participantId);
            });
        }

        function applyMicTrackEnabledState() {
            try {
                localStream?.getAudioTracks?.().forEach((t) => {
                    try { t.enabled = !!audioEnabled; } catch (_) {}
                });
            } catch (_) {}
        }

        /** В эфир только сырой трек с микрофона (без Web Audio / gain). */
        function applyMicOutgoingChain() {
            if (!localStream) return;
            const cur = localStream.getAudioTracks()[0] || null;
            if (!rawMicTrack) rawMicTrack = cur;
            if (!cur || !rawMicTrack) {
                applyMicTrackEnabledState();
                return;
            }
            if (cur === rawMicTrack) {
                applyMicTrackEnabledState();
                return;
            }
            if (rawMicTrack.readyState === 'live') {
                try { localStream.removeTrack(cur); } catch (_) {}
                try {
                    if (!localStream.getAudioTracks().includes(rawMicTrack)) {
                        localStream.addTrack(rawMicTrack);
                    }
                } catch (_) {}
                try {
                    replaceAudioTrackForAllPeers(cur, rawMicTrack);
                } catch (_) {}
            }
            applyMicTrackEnabledState();
        }

        function attachVideoTrack(track, previousTrack = null) {
            if (!track || !localStream) return;
            track.enabled = true;
            track.contentHint = 'motion';
            if (previousTrack && previousTrack !== track) {
                try { localStream.removeTrack(previousTrack); } catch (_) {}
            }
            if (!localStream.getVideoTracks().includes(track)) {
                localStream.addTrack(track);
            }
            replaceVideoTrackForAllPeers(previousTrack, track);
            if (!previousTrack) {
                ensureVideoTrackForAllPeers(track);
            }
            const facingTrack = cameraSourceTrack && cameraSourceTrack.readyState === 'live' ? cameraSourceTrack : track;
            cameraFacingMode = getTrackFacingMode(facingTrack, cameraFacingMode);
            addVideoTile('self', `${userName} (Вы)`, localStream);
            applyVideoTileMirroring('self');
            applySelfPreviewTrack();
        }

        async function prewarmCameraTrack() {
            if (videoTrack && videoTrack.readyState === 'live') {
                videoTrack.enabled = false;
                return;
            }
            if (videoPrewarmPromise) {
                await videoPrewarmPromise;
                return;
            }
            videoPrewarmPromise = (async () => {
                try {
                    const newVideoTracks = await createCameraTracks(cameraFacingMode);
                    const newVideoTrack = newVideoTracks?.outgoingTrack || null;
                    if (!newVideoTrack) return;
                    newVideoTrack.enabled = false;
                    videoTrack = newVideoTrack;
                    cameraSourceTrack = newVideoTracks?.sourceTrack || null;
                    selfPreviewTrack = newVideoTracks?.previewTrack || null;
                    outgoingTrackCleanup = newVideoTracks?.cleanup || null;
                    if (localStream && !localStream.getVideoTracks().includes(newVideoTrack)) {
                        localStream.addTrack(newVideoTrack);
                    }
                } catch (_) {}
            })();
            try {
                await videoPrewarmPromise;
            } finally {
                videoPrewarmPromise = null;
            }
        }

        function loadStoredProfile() {
            try {
                const raw = localStorage.getItem('seych-auth-profile');
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.name) return null;
                parsed.avatar = proxifyAvatarUrl(parsed.avatar || '');
                parsed.coverUrl = proxifyAvatarUrl(parsed.coverUrl || '');
                const previousAppUserId = String(parsed.appUserId || '').trim();
                parsed.externalKey = buildExternalAccountKey(parsed);
                parsed.appUserId = buildStableAppUserId(parsed, previousAppUserId);
                if (previousAppUserId && previousAppUserId !== parsed.appUserId) {
                    pendingLegacyAppUserId = previousAppUserId;
                }
                if (!parsed.appUserId || previousAppUserId !== parsed.appUserId) {
                    localStorage.setItem('seych-auth-profile', JSON.stringify(parsed));
                }
                return parsed;
            } catch (_) {
                return null;
            }
        }

        function loadVkCustomContacts() {
            try {
                const raw = localStorage.getItem('seych-vk-custom-contacts');
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }

        function loadVkHiddenContacts() {
            try {
                const raw = localStorage.getItem('seych-vk-hidden-contacts');
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }

        function saveVkCustomContacts(list) {
            vkCustomContacts = Array.isArray(list) ? list : [];
            localStorage.setItem('seych-vk-custom-contacts', JSON.stringify(vkCustomContacts));
        }

        function saveVkHiddenContacts(list) {
            vkHiddenContactIds = Array.isArray(list) ? list : [];
            localStorage.setItem('seych-vk-hidden-contacts', JSON.stringify(vkHiddenContactIds));
        }

        function normalizeVkUserInput(value) {
            let v = String(value || '').trim();
            if (!v) return '';
            v = v.replace(/^https?:\/\/(m\.)?vk\.com\//i, '');
            v = v.replace(/^@+/, '');
            v = v.split(/[/?#]/)[0];
            return v;
        }

        function mergeVkContacts() {
            const merged = [];
            const seen = new Set();
            const hidden = new Set((vkHiddenContactIds || []).map(v => String(v).toLowerCase()));
            const pushContact = (contact) => {
                if (!contact) return;
                const id = String(contact.id || '').trim();
                if (!id) return;
                const key = id.toLowerCase();
                if (hidden.has(key)) return;
                if (seen.has(key)) return;
                seen.add(key);
                merged.push({
                    id,
                    name: String(contact.name || 'Контакт'),
                    username: String(contact.username || ''),
                    avatar: proxifyAvatarUrl(contact.avatar || ''),
                    target: id
                });
            };
            vkContacts.forEach(pushContact);
            vkCustomContacts.forEach(pushContact);
            return merged;
        }

        function saveProfile(profile) {
            const previousAppUserId = String(authProfile?.appUserId || appUserId || '').trim();
            const externalKey = buildExternalAccountKey(profile);
            const stableAppUserId = buildStableAppUserId(profile, previousAppUserId);
            if (previousAppUserId && previousAppUserId !== stableAppUserId) {
                pendingLegacyAppUserId = previousAppUserId;
            }
            const normalizedProfile = {
                ...profile,
                avatar: proxifyAvatarUrl(profile?.avatar || ''),
                coverUrl: proxifyAvatarUrl(profile?.coverUrl || ''),
                externalKey,
                appUserId: stableAppUserId
            };
            authProfile = normalizedProfile;
            appUserId = normalizedProfile.appUserId;
            userName = normalizedProfile.name || 'Пользователь';
            userAvatar = normalizedProfile.avatar || '';
            localStorage.setItem('seych-auth-profile', JSON.stringify(normalizedProfile));
        }

        function clearProfile() {
            clearKnownOutgoingCallStatusesStorage();
            authProfile = null;
            appUserId = '';
            userName = '';
            userAvatar = '';
            friendsState = { friends: [], incomingRequests: [], outgoingRequests: [], incomingCalls: [], outgoingCalls: [] };
            friendsSearchResults = [];
            friendsSearchValue = '';
            friendsCallsModalPrimed = false;
            knownIncomingCallIds = new Set();
            knownOutgoingCallStatuses = new Map();
            if (friendsPollTimer) {
                clearInterval(friendsPollTimer);
                friendsPollTimer = null;
            }
            closeIncomingCallModal();
            closeIncomingFriendModal();
            localStorage.removeItem('seych-auth-profile');
        }

        async function friendsApiRequest(action, payload = {}) {
            const identityKeys = authProfile ? buildIdentityKeys(authProfile) : [];
            const requestBody = {
                action,
                app_user_id: appUserId,
                active_tab: !document.hidden,
                name: authProfile?.name || userName || 'Пользователь',
                avatar: authProfile?.avatar || userAvatar || '',
                username: ensureGeneratedMessengerUsername(messengerProfile.username || authProfile?.vkUsername || authProfile?.googleEmail || '', appUserId),
                external_key: authProfile ? String(authProfile.externalKey || buildExternalAccountKey(authProfile) || '') : '',
                identity_keys: identityKeys,
                ...payload
            };
            let lastErr = null;
            for (const apiUrl of FRIENDS_API_FALLBACKS) {
                try {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    const rawText = await response.text();
                    let data = null;
                    try {
                        data = rawText ? JSON.parse(rawText) : null;
                    } catch (_) {
                        const raw = String(rawText || '');
                        if (/^\s*</.test(raw)) {
                            throw new Error(`API returned HTML: ${raw.slice(0, 160)}`);
                        }
                        throw new Error(raw ? `Invalid JSON: ${raw.slice(0, 160)}` : 'Invalid JSON');
                    }
                    if (!data || !data.success) {
                        throw new Error((data && data.error) ? data.error : 'Ошибка друзей');
                    }
                    if (apiUrl && apiUrl !== FRIENDS_API) {
                        FRIENDS_API = apiUrl;
                        try { localStorage.setItem('seych-friends-api-url', apiUrl); } catch (_) {}
                    }
                    return data.data || {};
                } catch (err) {
                    lastErr = err;
                }
            }
            throw lastErr || new Error('Ошибка друзей');
        }

        function stopIncomingCallSound() {
            if (incomingCallSoundRetryTimer) {
                clearInterval(incomingCallSoundRetryTimer);
                incomingCallSoundRetryTimer = null;
            }
            if (!incomingCallSound) return;
            try {
                incomingCallSound.pause();
                incomingCallSound.currentTime = 0;
            } catch (_) {}
        }

        function tryPlayIncomingCallSound() {
            if (!incomingCallSound || !incomingCallModal) return;
            try {
                incomingCallSound.currentTime = 0;
                const playResult = incomingCallSound.play();
                if (playResult && typeof playResult.then === 'function') {
                    playResult
                        .then(() => {
                            if (incomingCallSoundRetryTimer) {
                                clearInterval(incomingCallSoundRetryTimer);
                                incomingCallSoundRetryTimer = null;
                            }
                        })
                        .catch(() => {});
                }
            } catch (_) {}
        }

        function startIncomingCallSound() {
            if (!friendsNotificationsEnabled) return;
            if (!incomingCallSound) {
                incomingCallSound = new Audio(getAssetUrl('upload/rington.mp3'));
                incomingCallSound.loop = true;
                incomingCallSound.preload = 'auto';
            }
            tryPlayIncomingCallSound();
            if (!incomingCallSoundRetryTimer) {
                incomingCallSoundRetryTimer = setInterval(() => {
                    if (!incomingCallModal) {
                        clearInterval(incomingCallSoundRetryTimer);
                        incomingCallSoundRetryTimer = null;
                        return;
                    }
                    tryPlayIncomingCallSound();
                }, 1200);
            }
        }

        function clearIncomingCallAutoDeclineTimeout() {
            if (!incomingCallAutoDeclineTimeout) return;
            clearTimeout(incomingCallAutoDeclineTimeout);
            incomingCallAutoDeclineTimeout = null;
        }

        function scheduleIncomingCallAutoDecline(inviteId) {
            const normalizedInviteId = String(inviteId || '').trim();
            if (!normalizedInviteId) return;
            clearIncomingCallAutoDeclineTimeout();
            incomingCallAutoDeclineTimeout = setTimeout(() => {
                const activeModalInviteId = String(incomingCallModal?.dataset?.inviteId || '').trim();
                if (!activeModalInviteId || activeModalInviteId !== normalizedInviteId) return;
                replyIncomingCall(normalizedInviteId, 'decline').catch(() => {});
                showNotification('Звонок другу', 'Вызов автоматически сброшен через 30 секунд', 'warning');
            }, 30000);
        }

        function closeIncomingCallModal() {
            stopIncomingCallSound();
            clearIncomingCallAutoDeclineTimeout();
            if (!incomingCallModal) return;
            try { incomingCallModal.remove(); } catch (_) {}
            incomingCallModal = null;
        }

        function handleServiceWorkerMessage(event) {
            const payload = event?.data || null;
            if (!payload || payload.type !== 'friend-call-declined-from-push') return;
            const declinedInviteId = String(payload.inviteId || '').trim();
            const modalInviteId = String(incomingCallModal?.dataset?.inviteId || '').trim();
            if (declinedInviteId && modalInviteId && declinedInviteId === modalInviteId) {
                closeIncomingCallModal();
            }
            refreshFriendsState(true).catch(() => {});
        }

        function closeIncomingFriendModal() {
            if (!incomingFriendModal) return;
            try { incomingFriendModal.remove(); } catch (_) {}
            incomingFriendModal = null;
        }

        function setAuthenticatedProfile(profile) {
            saveProfile(profile);
            window.location.reload();
            return;
            const roomToJoin = pendingRoomJoin;
            pendingRoomJoin = null;
            const contactsPromise = profile?.provider === 'vk'
                ? fetchVkFriendsFromApi()
                : Promise.resolve();
            contactsPromise.finally(() => {
                ensureFriendsRuntime();
                refreshFriendsState(true).finally(() => {
                    renderMainScreen();
                });
                if (roomToJoin) {
                    joinRoom(roomToJoin);
                }
            });
        }

        function ensureFriendsRuntime() {
            if (!authProfile?.appUserId) return;
            friendsNotificationsEnabled = getStoredFriendsNotifyValue();
            syncPushContextToServiceWorker().catch(() => {});
            loadKnownOutgoingCallStatuses();
            if (friendsNotificationsEnabled) {
                ensureSystemNotificationPermission(true).catch(() => {});
                ensurePushNotificationsReady().catch(() => {});
            } else {
                disablePushNotificationsSubscription().catch(() => {});
            }
            friendsSearchValue = '';
            friendsSearchResults = [];
            if (friendsPollTimer) {
                clearInterval(friendsPollTimer);
                friendsPollTimer = null;
            }
            registerFriendsAccount().catch(() => {});
            refreshFriendsState(true).catch(() => {});
            friendsPollTimer = setInterval(() => {
                refreshFriendsState(true).catch(() => {});
            }, 3500);
        }

        async function registerFriendsAccount() {
            if (!authProfile?.appUserId) return;
            const payload = await friendsApiRequest('register', {
                app_user_id: authProfile.appUserId,
                name: authProfile.name || userName || 'Пользователь',
                avatar: authProfile.avatar || '',
                external_key: String(authProfile.externalKey || buildExternalAccountKey(authProfile) || ''),
                previous_app_user_id: pendingLegacyAppUserId || ''
            });
            pendingLegacyAppUserId = '';
            const canonicalAppUserId = String(payload?.appUserId || payload?.user?.id || '').trim();
            if (canonicalAppUserId && canonicalAppUserId !== String(authProfile?.appUserId || '').trim()) {
                saveProfile({
                    ...authProfile,
                    appUserId: canonicalAppUserId
                });
                syncPushContextToServiceWorker().catch(() => {});
            }
        }

        function handleFriendsStateSideEffects(previousState, nextState, primeIncomingCallModals = false) {
            const previousIncomingIds = new Set((previousState?.incomingCalls || []).map((item) => item.inviteId));
            const incomingCalls = Array.isArray(nextState?.incomingCalls) ? nextState.incomingCalls : [];
            const incomingIds = new Set(incomingCalls.map((item) => String(item?.inviteId || '')).filter(Boolean));
            const activeModalInviteId = String(incomingCallModal?.dataset?.inviteId || '').trim();
            if (activeModalInviteId && !incomingIds.has(activeModalInviteId)) {
                closeIncomingCallModal();
                showNotification('Звонок другу', 'Вызов отменен', 'info');
            }
            if (primeIncomingCallModals) {
                incomingCalls.forEach((invite) => {
                    if (invite?.inviteId) knownIncomingCallIds.add(invite.inviteId);
                });
            } else {
                incomingCalls.forEach((invite) => {
                    if (!invite?.inviteId) return;
                    knownIncomingCallIds.add(invite.inviteId);
                    if (previousIncomingIds.has(invite.inviteId)) return;
                    showSystemNotification('Входящий звонок', `${invite.fromName || 'Друг'} звонит вам`, `friend-call-${invite.inviteId}`);
                    showIncomingCallInviteModal(invite);
                });
            }

            const outgoingCalls = Array.isArray(nextState?.outgoingCalls) ? nextState.outgoingCalls : [];
            outgoingCalls.forEach((item) => {
                if (!item?.inviteId) return;
                const previousStatus = knownOutgoingCallStatuses.get(item.inviteId) || '';
                touchKnownOutgoingCallStatus(item.inviteId, item.status);
                if (previousStatus && previousStatus === item.status) return;
                const isActiveRoom = !!roomId && !!item.roomId && roomId === item.roomId;
                const isActiveInvite = !!outgoingFriendCallSession?.inviteId && outgoingFriendCallSession.inviteId === item.inviteId;
                const isActiveFriendCall = isActiveRoom || isActiveInvite;
                if (!previousStatus && !isActiveFriendCall) return;
                if (item.status === 'accepted') {
                    if (isActiveFriendCall) {
                        acceptOutgoingFriendCallSession();
                    }
                    showNotification('Звонок другу', `${item.toName || 'Друг'} ответил на звонок`, 'success');
                }
                if (item.status === 'declined' || item.status === 'cancelled') {
                    if (isActiveFriendCall) {
                        const targetName = outgoingFriendCallSession?.targetName || item.toName || 'Друг';
                        clearOutgoingFriendCallSession();
                        showNotification('Звонок другу', `${targetName} отклонил вызов`, 'warning');
                        if (roomId) {
                            endCall(false);
                        }
                        return;
                    }
                    if (previousStatus) {
                        showNotification('Звонок другу', `Друг ${item.toName || ''} сбросил`, 'warning');
                    }
                }
            });
            persistKnownOutgoingCallStatuses();

            const previousIncomingRequests = new Set((previousState?.incomingRequests || []).map((item) => item.requestId));
            const incomingRequests = Array.isArray(nextState?.incomingRequests) ? nextState.incomingRequests : [];
            incomingRequests.forEach((request) => {
                if (!request?.requestId) return;
                if (previousIncomingRequests.has(request.requestId)) return;
                showSystemNotification('Новый запрос в друзья', `${request.name || 'Пользователь'} отправил вам заявку`, `friend-request-${request.requestId}`);
                showIncomingFriendRequestModal(request.fromId, request.name || 'Пользователь');
            });
        }

        function syncSearchResultsWithFriendsState() {
            if (!Array.isArray(friendsSearchResults) || !friendsSearchResults.length) return;
            const friendIds = new Set((friendsState.friends || []).map((item) => String(item.id || '')));
            const incomingIds = new Set((friendsState.incomingRequests || []).map((item) => String(item.fromId || '')));
            const outgoingIds = new Set((friendsState.outgoingRequests || []).map((item) => String(item.toId || '')));
            friendsSearchResults = friendsSearchResults.map((result) => {
                const userId = String(result?.id || '');
                const isFriend = friendIds.has(userId);
                return {
                    ...result,
                    isFriend,
                    incomingPending: !isFriend && incomingIds.has(userId),
                    outgoingPending: !isFriend && outgoingIds.has(userId)
                };
            });
        }

        async function refreshFriendsState(silent = false) {
            if (!authProfile?.appUserId) return;
            try {
                const payload = await friendsApiRequest('state', {
                    app_user_id: authProfile.appUserId,
                    name: authProfile.name || userName || 'Пользователь',
                    avatar: authProfile.avatar || ''
                });
                if (messengerProfileOverrides.size && Array.isArray(payload.friends)) {
                    payload.friends = payload.friends.map((f) => {
                        const id = String(f?.id || '');
                        const ov = messengerProfileOverrides.get(id);
                        if (!ov) return f;
                        return {
                            ...f,
                            name: ov.name || f.name,
                            displayName: ov.displayName || f.displayName || ov.name || f.name,
                            avatar: ov.avatar || f.avatar,
                            username: ov.username || f.username || '',
                            statusText: ov.statusText || f.statusText || '',
                            initials: ov.initials || f.initials || ''
                        };
                    });
                }
                const previous = friendsState;
                friendsState = {
                    friends: Array.isArray(payload.friends) ? payload.friends : [],
                    incomingRequests: Array.isArray(payload.incomingRequests) ? payload.incomingRequests : [],
                    outgoingRequests: Array.isArray(payload.outgoingRequests) ? payload.outgoingRequests : [],
                    incomingCalls: Array.isArray(payload.incomingCalls) ? payload.incomingCalls : [],
                    outgoingCalls: Array.isArray(payload.outgoingCalls) ? payload.outgoingCalls : []
                };
                sendMessengerEvent({
                    type: 'messenger-friends-sync',
                    friendIds: (friendsState.friends || []).map((f) => String(f.id || '').trim()).filter(Boolean)
                });
                syncSearchResultsWithFriendsState();
                const primeCalls = !friendsCallsModalPrimed;
                friendsCallsModalPrimed = true;
                handleFriendsStateSideEffects(previous, friendsState, primeCalls);
                if (!roomId) {
                    const ae = document.activeElement;
                    const composing = messengerView === 'chats' && ae && ae.id === 'chatComposerInput';
                    if (!composing) {
                        renderMainScreen();
                    }
                }
            } catch (error) {
                if (!silent) {
                    showNotification('Друзья', error.message || 'Ошибка обновления друзей', 'error');
                }
            }
        }

        function findIncomingRequestByUser(userId) {
            const list = Array.isArray(friendsState.incomingRequests) ? friendsState.incomingRequests : [];
            return list.find((item) => item.fromId === userId) || null;
        }

        async function searchFriendsUsers() {
            const input = document.getElementById('friendsSearchInput');
            friendsSearchValue = String(input?.value ?? friendsSearchValue ?? '').trim();
            if (!friendsSearchValue) {
                friendsSearchResults = [];
                renderMainScreen();
                return;
            }
            try {
                const payload = await friendsApiRequest('search', { query: friendsSearchValue });
                friendsSearchResults = Array.isArray(payload.results)
                    ? payload.results.map((item) => ({
                        ...item,
                        username: ensureGeneratedMessengerUsername(item?.username || '', item?.id || '')
                    }))
                    : [];
                renderMainScreen();
            } catch (error) {
                const msg = String(error?.message || '');
                if (/Invalid JSON/i.test(msg) || /<html/i.test(msg)) {
                    friendsSearchResults = [];
                    renderMainScreen();
                    showNotification('Друзья', 'Поиск временно недоступен: API вернул некорректный ответ', 'warning');
                    return;
                }
                showNotification('Друзья', error.message || 'Ошибка поиска', 'error');
            }
        }

        async function sendFriendRequest(targetId) {
            if (!targetId) return;
            try {
                await friendsApiRequest('send_request', { target_id: targetId });
                showNotification('Друзья', 'Запрос отправлен', 'success');
                await refreshFriendsState(true);
                await searchFriendsUsers();
            } catch (error) {
                showNotification('Друзья', error.message || 'Ошибка отправки запроса', 'error');
            }
        }

        async function handleFriendRequest(requestId, decision) {
            if (!requestId) return;
            try {
                await friendsApiRequest('respond_request', {
                    request_id: requestId,
                    decision
                });
                showNotification('Друзья', decision === 'accept' ? 'Заявка принята' : 'Заявка отклонена', 'info');
                await refreshFriendsState(true);
            } catch (error) {
                showNotification('Друзья', error.message || 'Ошибка обработки заявки', 'error');
            }
        }

        async function deleteFriend(friendId) {
            if (!friendId) return;
            try {
                await friendsApiRequest('remove_friend', { friend_id: friendId });
                showNotification('Друзья', 'Друг удален', 'info');
                await refreshFriendsState(true);
            } catch (error) {
                showNotification('Друзья', error.message || 'Ошибка удаления', 'error');
            }
        }

        async function callFriend(friendId) {
            if (!friendId) return;
            try {
                if (!roomId) {
                    const createdRoomId = await createRoom({ privateRoom: true, silent: true, friendCallTargetId: friendId });
                    if (!createdRoomId) return;
                }
                if (isCreator && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'set-room-private', enabled: true }));
                }
                const friend = (friendsState.friends || []).find((item) => String(item.id || '') === String(friendId)) || null;
                const inviteResponse = await friendsApiRequest('send_call_invite', {
                    target_id: friendId,
                    room_id: roomId
                });
                startOutgoingFriendCallSession({
                    inviteId: inviteResponse?.inviteId || '',
                    roomId,
                    targetId: friendId,
                    targetName: friend?.name || 'другу'
                });
                showNotification('Звонок другу', 'Вызов отправлен', 'success');
                await refreshFriendsState(true);
            } catch (error) {
                showNotification('Звонок другу', error.message || 'Не удалось позвонить другу', 'error');
            }
        }

        async function replyIncomingCall(inviteId, decision) {
            if (!inviteId) return;
            clearIncomingCallAutoDeclineTimeout();
            try {
                const payload = await friendsApiRequest('respond_call_invite', {
                    invite_id: inviteId,
                    decision
                });
                closeIncomingCallModal();
                await refreshFriendsState(true);
                if (decision === 'answer' && payload.roomId) {
                    joinRoom(payload.roomId);
                }
            } catch (error) {
                showNotification('Звонок другу', error.message || 'Ошибка ответа на звонок', 'error');
            }
        }

        function showIncomingCallInviteModal(invite) {
            if (!invite?.inviteId || incomingCallModal) return;
            closeIncomingCallModal();
            startIncomingCallSound();
            scheduleIncomingCallAutoDecline(invite.inviteId);
            const modal = document.createElement('div');
            modal.className = 'request-modal';
            modal.dataset.inviteId = String(invite.inviteId || '');
            modal.innerHTML = `
                <div class="request-content">
                    <div style="font-size: 42px;"><i class="fas fa-phone-volume"></i></div>
                    <h3>Входящий звонок</h3>
                    <p>${escapeHtml(invite.fromName || 'Друг')} приглашает в комнату</p>
                    <div class="request-buttons">
                        <button class="request-btn cancel" onclick="replyIncomingCall('${invite.inviteId}','decline')">Сбросить</button>
                        <button class="request-btn confirm" onclick="replyIncomingCall('${invite.inviteId}','answer')">Ответить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            incomingCallModal = modal;
        }

        function showIncomingFriendRequestModal(fromAccountId, fromName) {
            if (!fromAccountId || incomingFriendModal || !friendsNotificationsEnabled) return;
            const modal = document.createElement('div');
            modal.className = 'request-modal';
            modal.innerHTML = `
                <div class="request-content">
                    <div style="font-size: 42px;"><i class="fas fa-user-plus"></i></div>
                    <h3>Запрос в друзья</h3>
                    <p>${escapeHtml(fromName || 'Пользователь')} хочет добавить вас в друзья</p>
                    <div class="request-buttons">
                        <button class="request-btn cancel" onclick="closeIncomingFriendModal()">Отмена</button>
                        <button class="request-btn confirm" onclick="acceptIncomingFriendFromModal('${fromAccountId}')">Принять</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            incomingFriendModal = modal;
        }

        async function acceptIncomingFriendFromModal(fromAccountId) {
            closeIncomingFriendModal();
            const request = findIncomingRequestByUser(fromAccountId);
            if (request?.requestId) {
                await handleFriendRequest(request.requestId, 'accept');
                return;
            }
            await sendFriendRequest(fromAccountId);
        }

        function decodeJwtPayload(token) {
            const payload = token.split('.')[1] || '';
            const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
            const decoded = atob(normalized);
            return JSON.parse(decoded);
        }

        async function completeGoogleAccessToken(accessToken) {
            if (!accessToken) {
                showNotification('Google', 'Не удалось получить токен Google', 'error');
                return;
            }
            try {
                const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                const payload = await response.json();
                if (!payload || (!payload.name && !payload.given_name)) {
                    throw new Error('empty_profile');
                }
                setAuthenticatedProfile({
                    provider: 'google',
                    name: payload.name || payload.given_name || 'Google User',
                    avatar: proxifyAvatarUrl(payload.picture || ''),
                    googleSub: payload.sub ? String(payload.sub) : '',
                    googleEmail: payload.email ? String(payload.email) : ''
                });
            } catch (_) {
                showNotification('Google', 'Не удалось получить профиль Google', 'error');
            }
        }

        function getVkRedirectUri() {
            return VK_REDIRECT_URL || `${window.location.origin}${window.location.pathname}`;
        }

        function vkApiCallJsonp(method, params, accessToken) {
            return new Promise((resolve, reject) => {
                const callbackName = `vkcb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const query = new URLSearchParams({
                    ...params,
                    access_token: accessToken,
                    v: VK_API_VERSION,
                    callback: callbackName
                });
                const url = `https://api.vk.com/method/${method}?${query.toString()}`;
                const script = document.createElement('script');
                const cleanup = () => {
                    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
                    script.remove();
                };
                const timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error('VK API timeout'));
                }, 8000);
                window[callbackName] = (data) => {
                    clearTimeout(timeoutId);
                    cleanup();
                    if (data?.error) {
                        reject(new Error(data.error.error_msg || 'VK API error'));
                        return;
                    }
                    resolve(data?.response || null);
                };
                script.src = url;
                script.onerror = () => {
                    clearTimeout(timeoutId);
                    cleanup();
                    reject(new Error('VK API request failed'));
                };
                document.body.appendChild(script);
            });
        }

        async function vkApiCall(method, params, accessToken) {
            return vkApiCallJsonp(method, params, accessToken);
        }

        async function fetchVkProfile(accessToken, userId) {
            const params = { fields: 'photo_200,domain' };
            if (userId) {
                params.user_ids = userId;
            }
            const response = await vkApiCall('users.get', params, accessToken);
            const user = Array.isArray(response) ? response[0] : null;
            if (!user) {
                throw new Error('VK profile not found');
            }
            const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'VK User';
            return {
                id: String(user.id || userId),
                name,
                avatar: proxifyAvatarUrl(user.photo_200 || ''),
                username: user.domain || ''
            };
        }

        async function fetchVkFriendsFromApi() {
            if (!authProfile || authProfile.provider !== 'vk' || !authProfile.vkAccessToken) {
                vkContacts = [];
                return;
            }
            try {
                const response = await vkApiCall('friends.get', { fields: 'photo_200,domain' }, authProfile.vkAccessToken);
                const items = Array.isArray(response?.items) ? response.items : [];
                vkContacts = items.map((friend) => ({
                    id: String(friend.id || ''),
                    name: `${friend.first_name || ''} ${friend.last_name || ''}`.trim() || 'Друг',
                    avatar: proxifyAvatarUrl(friend.photo_200 || ''),
                    username: friend.domain || ''
                })).filter(contact => contact.id);
            } catch (_) {
                vkContacts = [];
            }
        }

        async function resolveVkUserByInput(value) {
            const normalized = normalizeVkUserInput(value);
            if (!normalized) {
                throw new Error('Укажите корректный VK ID или ссылку');
            }
            if (!authProfile || authProfile.provider !== 'vk' || !authProfile.vkAccessToken) {
                throw new Error('Добавление доступно только после входа через VK');
            }
            const response = await vkApiCall('users.get', { user_ids: normalized, fields: 'photo_200,domain' }, authProfile.vkAccessToken);
            const user = Array.isArray(response) ? response[0] : null;
            if (!user) {
                throw new Error('Пользователь VK не найден');
            }
            return {
                id: String(user.id || ''),
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'VK User',
                avatar: proxifyAvatarUrl(user.photo_200 || ''),
                username: user.domain || ''
            };
        }

        function vkidOnSuccess(data) {
            const accessToken = data?.access_token || data?.accessToken || '';
            const userId = data?.user_id || data?.userId || '';
            const expiresIn = Number(data?.expires_in || 0);
            if (!accessToken || !userId) {
                if (!accessToken) {
                    showNotification('VK', 'Не удалось получить токен VK', 'error');
                    return;
                }
            }
            fetchVkProfile(accessToken, userId)
                .then((profile) => {
                    setAuthenticatedProfile({
                        provider: 'vk',
                        name: profile.name,
                        avatar: profile.avatar,
                        vkUserId: String(profile.id),
                        vkAccessToken: accessToken,
                        vkTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
                        vkUsername: profile.username || ''
                    });
                })
                .catch((error) => {
                    showNotification('VK', error?.message || 'Не удалось получить профиль VK', 'error');
                });
        }

        function vkidOnError(error) {
            const message = error?.message || error?.error_description || error?.error || 'Ошибка авторизации VK';
            showNotification('VK', message, 'error');
        }

        function startGooglePopupFlow() {
            if (!window.google?.accounts?.oauth2) {
                showNotification('Google', 'OAuth Google недоступен', 'error');
                return;
            }
            if (!googleTokenClient) {
                googleTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: 'openid profile email',
                    callback: async (tokenResponse) => {
                        if (tokenResponse?.error) {
                            showNotification('Google', 'Вход через Google отменен', 'warning');
                            return;
                        }
                        await completeGoogleAccessToken(tokenResponse?.access_token || '');
                    }
                });
            }
            googleTokenClient.requestAccessToken({ prompt: 'select_account' });
        }

        async function verifyTelegramAuth(payload) {
            try {
                const response = await fetch(TELEGRAM_AUTH_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                return await response.json();
            } catch (_) {
                return { success: false, error: 'Сервер недоступен' };
            }
        }

        async function handleTelegramAuth(user) {
            if (!user) {
                showNotification('Авторизация', 'Не удалось получить профиль Telegram', 'error');
                return;
            }
            const hasWidgetHash = String(user.hash || '').length > 0 && String(user.auth_date || '').length > 0;
            const tgWebApp = window.Telegram?.WebApp;
            let payload = null;
            if (hasWidgetHash) {
                payload = { auth_type: 'widget', user };
            } else if (tgWebApp && tgWebApp.initData) {
                payload = { auth_type: 'webapp', init_data: tgWebApp.initData };
            }
            if (!payload) {
                showNotification('Авторизация', 'Не удалось проверить профиль Telegram', 'error');
                return;
            }
            const result = await verifyTelegramAuth(payload);
            if (!result?.success) {
                showNotification('Авторизация', result?.error || 'Ошибка проверки авторизации', 'error');
                return;
            }
            const verified = result.user || {};
            const fullName = [verified.first_name, verified.last_name].filter(Boolean).join(' ').trim() || verified.username || 'Telegram User';
            setAuthenticatedProfile({
                provider: 'telegram',
                name: fullName,
                avatar: proxifyAvatarUrl(verified.photo_url || ''),
                telegramId: verified.id ? String(verified.id) : '',
                username: verified.username ? String(verified.username) : ''
            });
        }

        function startGoogleAuth() {
            if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('YOUR_')) {
                showNotification('Google', 'Заполните GOOGLE_CLIENT_ID в index.html', 'warning');
                return;
            }
            if (window.google?.accounts?.oauth2) {
                startGooglePopupFlow();
                return;
            }
            if (!window.google || !google.accounts || !google.accounts.id) {
                showNotification('Google', 'Скрипт Google не загрузился', 'error');
                return;
            }
            if (!googleIdInitialized) {
                google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: (response) => {
                        try {
                            const payload = decodeJwtPayload(response.credential);
                            setAuthenticatedProfile({
                                provider: 'google',
                                name: payload.name || payload.given_name || 'Google User',
                                avatar: proxifyAvatarUrl(payload.picture || ''),
                                googleSub: payload.sub ? String(payload.sub) : '',
                                googleEmail: payload.email ? String(payload.email) : ''
                            });
                        } catch (_) {
                            startGooglePopupFlow();
                        }
                    }
                });
                googleIdInitialized = true;
            }
            try {
                google.accounts.id.prompt((notification) => {
                    if (!notification) {
                        startGooglePopupFlow();
                        return;
                    }
                    if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
                        startGooglePopupFlow();
                    }
                });
            } catch (_) {
                startGooglePopupFlow();
            }
        }

        function tryTelegramWebAppAuth() {
            const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
            if (tgUser) {
                handleTelegramAuth(tgUser);
                return true;
            }
            return false;
        }

        function renderTelegramWidget() {
            const container = document.getElementById('telegramAuthWidget');
            if (!container) return;
            if (!TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME.includes('YOUR_')) {
                container.innerHTML = '<span style="opacity:0.8;font-size:13px">Укажите TELEGRAM_BOT_USERNAME в index.html</span>';
                return;
            }
            container.innerHTML = '';
            const fallback = document.createElement('button');
            fallback.className = 'btn';
            fallback.innerHTML = '<i class="fab fa-telegram"></i> Войти через Telegram';
            fallback.onclick = () => {
                window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}`, '_blank');
                showNotification('Telegram', 'Откройте бота и запустите приложение', 'info');
            };
            container.appendChild(fallback);
            const script = document.createElement('script');
            script.async = true;
            script.src = 'https://telegram.org/js/telegram-widget.js?22';
            script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
            script.setAttribute('data-size', 'large');
            script.setAttribute('data-userpic', 'true');
            script.setAttribute('data-radius', '10');
            script.setAttribute('data-request-access', 'write');
            script.setAttribute('data-onauth', 'handleTelegramAuth(user)');
            container.appendChild(script);
            setTimeout(() => {
                if (container.querySelector('iframe')) {
                    fallback.remove();
                }
            }, 1200);
        }

        function renderVkIdWidget() {
            const container = document.getElementById('vkAuthWidget');
            if (!container) return;
            if (!VK_CLIENT_ID || VK_CLIENT_ID.includes('YOUR_')) {
                container.innerHTML = '<span style="opacity:0.8;font-size:13px">Укажите VK_CLIENT_ID в index.html</span>';
                return;
            }
            if (!window.VKIDSDK) {
                container.innerHTML = '<span style="opacity:0.8;font-size:13px">Загружаем VKID SDK...</span>';
                setTimeout(() => {
                    if (!window.VKIDSDK) {
                        container.innerHTML = '<span style="opacity:0.8;font-size:13px">VKID SDK не загрузился</span>';
                        return;
                    }
                    renderVkIdWidget();
                }, 1500);
                return;
            }
            const VKID = window.VKIDSDK;
            VKID.Config.init({
                app: Number(VK_CLIENT_ID),
                redirectUrl: getVkRedirectUri(),
                responseMode: VKID.ConfigResponseMode.Callback,
                source: VKID.ConfigSource.LOWCODE,
                scope: 'friends'
            });
            const oneTap = new VKID.OneTap();
            oneTap.render({
                container,
                scheme: 'dark',
                showAlternativeLogin: true,
                styles: {
                    borderRadius: 41,
                    height: 38
                }
            })
                .on(VKID.WidgetEvents.ERROR, vkidOnError)
                .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
                    const code = payload.code;
                    const deviceId = payload.device_id;
                    VKID.Auth.exchangeCode(code, deviceId)
                        .then(vkidOnSuccess)
                        .catch(vkidOnError);
                });
        }

        function signOutProfile() {
            clearProfile();
            window.location.reload();
        }

        function openVkDM(contact, roomLink) {
            const id = String(contact?.id || '');
            if (!id) return;
            const text = `Я тебе звоню в Seych\nСсылки для ответа\n${roomLink}`;
            const writeUrl = new URL(`https://vk.com/write${id}`);
            writeUrl.searchParams.set('text', text);
            const fallbackUrl = new URL('https://vk.com/im');
            fallbackUrl.searchParams.set('sel', id);
            fallbackUrl.searchParams.set('text', text);
            window.open(writeUrl.toString(), '_blank');
            setTimeout(() => {
                window.open(fallbackUrl.toString(), '_blank');
            }, 350);
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => {});
            }
        }

        async function callVkContact(index) {
            if (!authProfile || authProfile.provider !== 'vk') {
                showNotification('Контакты', 'Контакты VK доступны только для VK профиля', 'warning');
                return;
            }
            const contacts = mergeVkContacts();
            const contact = contacts[index];
            if (!contact) return;
            if (!roomId) {
                const createdRoomId = await createRoom();
                if (!createdRoomId) {
                    ensureInviteRoomId();
                }
            }
            const roomLink = buildRoomLink(roomId);
            openVkDM(contact, roomLink);
            showNotification('VK', `Открыт диалог с ${contact.name}`, 'success');
        }

        function renderVkContactsModal() {
            if (!authProfile || authProfile.provider !== 'vk') {
                showNotification('Контакты', 'Контакты VK доступны только для VK профиля', 'warning');
                return;
            }
            const oldModal = document.getElementById('vkContactsModal');
            if (oldModal) oldModal.remove();
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'vkContactsModal';
            const contacts = mergeVkContacts();
            const contactsHtml = contacts.length
                ? contacts.map((contact, idx) => `
                    <div class="contact-item">
                        <div class="participant-avatar" style="width:38px;height:38px;min-width:38px">${contact.avatar ? `<img src="${escapeHtml(contact.avatar)}" alt="${escapeHtml(contact.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer">` : escapeHtml((contact.name || '?').charAt(0).toUpperCase())}</div>
                        <div>
                            <div class="contact-name">${escapeHtml(contact.name)}</div>
                            <div class="contact-chat">${escapeHtml(contact.username ? `vk.com/${contact.username}` : `id${contact.id}`)}</div>
                        </div>
                        <div class="contact-actions">
                            <button class="contact-btn" onclick="callVkContact(${idx})"><i class="fas fa-phone"></i></button>
                            <button class="contact-btn delete" onclick="removeVkContact('${escapeHtml(contact.id)}')"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `).join('')
                : `<div class="contact-item"><div class="contact-chat">Нет доступных друзей VK</div></div>`;
            modal.innerHTML = `
                <div class="modal-content">
                    <h2><i class="fab fa-vk"></i> Друзья VK</h2>
                    <div class="contacts-header">
                        <div class="contacts-title">Добавить по ссылке</div>
                        <div class="contacts-title">Список: ${contacts.length}</div>
                    </div>
                    <div class="contacts-form">
                        <input type="text" id="vkContactInput" class="modal-input" placeholder="vk.com/username или id123" />
                        <div class="contacts-form-actions">
                            <button class="modal-btn confirm" onclick="addVkContactFromModal()">Добавить</button>
                            <button class="modal-btn cancel" onclick="refreshVkContacts()">Обновить</button>
                        </div>
                    </div>
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" onclick="document.getElementById('vkContactsModal').remove()">Закрыть</button>
                    </div>
                    <div class="contacts-list">${contactsHtml}</div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        function addVkContactFromModal() {
            const inputEl = document.getElementById('vkContactInput');
            const value = inputEl?.value || '';
            resolveVkUserByInput(value)
                .then((user) => {
                    const existing = vkCustomContacts.find(contact => String(contact.id) === String(user.id));
                    if (existing) {
                        existing.name = user.name;
                        existing.avatar = user.avatar;
                        existing.username = user.username;
                        saveVkCustomContacts(vkCustomContacts);
                    } else {
                        saveVkCustomContacts([...vkCustomContacts, user]);
                    }
                    renderVkContactsModal();
                    showNotification('VK', 'Контакт добавлен', 'success');
                })
                .catch((error) => {
                    showNotification('VK', error.message || 'Ошибка добавления', 'error');
                });
        }

        function removeVkContact(contactId) {
            const id = String(contactId || '').trim();
            if (!id) return;
            if (!vkHiddenContactIds.includes(id)) {
                saveVkHiddenContacts([...vkHiddenContactIds, id]);
            }
            renderVkContactsModal();
            showNotification('VK', 'Контакт скрыт из списка', 'info');
        }

        async function refreshVkContacts() {
            await fetchVkFriendsFromApi();
            renderVkContactsModal();
        }

        function unlockAudioPlayback() {
            if (audioPlaybackUnlocked) return;
            audioPlaybackUnlocked = true;
            try {
                if (audioContextRef && audioContextRef.state === 'suspended') {
                    audioContextRef.resume().catch(() => {});
                }
            } catch (_) {}
            remoteAudioEls.forEach((audioEl) => {
                audioEl.play().catch(() => {});
            });
            if (incomingCallModal) {
                tryPlayIncomingCallSound();
            }
        }

        function renderAuthScreen() {
            if (window.SeychAuth && typeof window.SeychAuth.show === 'function') {
                window.SeychAuth.show();
                return;
            }
            document.getElementById('app').innerHTML = `
                <div class="main-screen main-screen--auth">
                    <div class="gradient-bg"></div>
                    <div class="auth-card">
                        <h2><i class="fas fa-shield-alt"></i> Вход в Seych</h2>
                        <p class="auth-subtitle">Авторизуйтесь через Telegram, Google или VK</p>
                        <div class="auth-providers">
                            <div class="auth-provider" id="telegramAuthWidget"></div>
                            <button class="btn" onclick="startGoogleAuth()"><i class="fab fa-google"></i> Войти через Google</button>
                            <div class="auth-provider" id="vkAuthWidget"></div>
                        </div>
                    </div>
                </div>
            `;
            if (!tryTelegramWebAppAuth()) {
                renderTelegramWidget();
            }
            renderVkIdWidget();
        }

        function buildMicCaptureConstraintsRich() {
            const dev = selectedMicDeviceId ? { deviceId: { exact: selectedMicDeviceId } } : {};
            const on = (x) => (x ? { ideal: true } : false);
            const audio = {
                echoCancellation: on(!!echoCancellationEnabled),
                noiseSuppression: true, // Professional noise suppression
                autoGainControl: on(!!autoGainControlEnabled),
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 },
                latency: { ideal: 0 },
                // Professional voice quality
                sampleSize: { ideal: 16 },
                // Additional professional settings
                suppressLocalAudioPlayback: { ideal: true },
                ...dev
            };
            try {
                const ua = navigator.userAgent || '';
                if (/Chrome/i.test(ua) && !/Edg\//i.test(ua)) {
                    audio.googEchoCancellation = on(!!echoCancellationEnabled);
                    audio.googAutoGainControl = on(!!autoGainControlEnabled);
                    audio.googNoiseSuppression = true; // Professional Google noise suppression
                    audio.googHighpassFilter = true; // Remove low-frequency white noise
                    // Professional-grade settings like VK
                    audio.googExperimentalNoiseSuppression = true; // Advanced AI noise suppression
                    audio.googAudioMirroring = false;
                    // Professional voice enhancement
                    audio.googTypingNoiseDetection = false; // Don't mistake voice for typing
                    audio.googResidualEchoDetection = true; // Better echo handling
                    audio.googBeamforming = { ideal: true }; // Better voice focus
                    audio.googStereoSwapping = false; // Keep mono for calls
                }
            } catch (_) {}
            return { audio };
        }

        function buildMicCaptureConstraintsPlain() {
            const dev = selectedMicDeviceId ? { deviceId: { exact: selectedMicDeviceId } } : {};
            return {
                audio: {
                    echoCancellation: !!echoCancellationEnabled,
                    noiseSuppression: true, // Professional noise suppression
                    autoGainControl: !!autoGainControlEnabled,
                    channelCount: 1,
                    ...dev
                }
            };
        }

        async function acquireMicMediaStream() {
            try {
                return await navigator.mediaDevices.getUserMedia(buildMicCaptureConstraintsRich());
            } catch (_) {
                return navigator.mediaDevices.getUserMedia(buildMicCaptureConstraintsPlain());
            }
        }

        async function getMedia() {
            try {
                const stream = await acquireMicMediaStream();
                try {
                    rawMicTrack = stream.getAudioTracks()[0] || null;
                } catch (_) {}
                return stream;
            } catch (error) {
                showNotification('Ошибка', 'Нет доступа к микрофону', 'error');
                return null;
            }
        }

        function setupAudioDetection(stream) {
            try {
                cancelAnimationFrame(animationId);
            } catch (_) {}
            if (detectLoopTimer) {
                clearTimeout(detectLoopTimer);
                detectLoopTimer = null;
            }
            if (audioContextRef && audioContextRef.state !== 'closed') {
                try { audioContextRef.close(); } catch (_) {}
            }
            audioContextRef = null;
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            const buffer = new Uint8Array(analyser.fftSize);
            let open = 0.08;
            let close = 0.04;
            const track = stream.getAudioTracks()[0] || null;
            const scheduleDetectNext = () => {
                if (document.hidden) {
                    detectLoopTimer = setTimeout(detect, 220);
                } else {
                    animationId = requestAnimationFrame(detect);
                }
            };
            function stopDetect() {
                try { cancelAnimationFrame(animationId); } catch (_) {}
                if (detectLoopTimer) {
                    clearTimeout(detectLoopTimer);
                    detectLoopTimer = null;
                }
                if (isSpeaking) {
                    isSpeaking = false;
                    ws?.send(JSON.stringify({ type: 'speaking', isSpeaking }));
                    updateUI();
                }
            }
            if (track) {
                track.onended = () => stopDetect();
            }
            function detect() {
                if (!audioEnabled || !track || track.readyState !== 'live' || audioContext.state === 'closed') {
                    if (isSpeaking) {
                        isSpeaking = false;
                        ws?.send(JSON.stringify({ type: 'speaking', isSpeaking }));
                        updateUI();
                    }
                    scheduleDetectNext();
                    return;
                }
                if (audioContext.state === 'suspended') {
                    audioContext.resume().catch(() => {});
                }
                try {
                    analyser.getByteTimeDomainData(buffer);
                    let sum = 0;
                    for (let i = 0; i < buffer.length; i++) {
                        const v = (buffer[i] - 128) / 128;
                        sum += v * v;
                    }
                    const rms = Math.sqrt(sum / buffer.length);
                    const nextSpeaking = isSpeaking ? rms > close : rms > open;
                    if (nextSpeaking !== isSpeaking) {
                        isSpeaking = nextSpeaking;
                        ws?.send(JSON.stringify({ type: 'speaking', isSpeaking }));
                        updateUI();
                    }
                } catch (_) {
                    stopDetect();
                    return;
                }
                scheduleDetectNext();
            }
            if (audioContext.state === 'suspended') {
                const resumeAudio = () => audioContext.resume().catch(() => {});
                document.addEventListener('click', resumeAudio, { once: true });
                document.addEventListener('touchstart', resumeAudio, { once: true, passive: true });
            }
            detect();
        }

        function toDomSafeIdKey(value) {
            return String(value || '')
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .slice(0, 120);
        }

        function playRemoteAudio(participantId, stream) {
            if (!participantId) return;
            const key = String(participantId);
            let el = remoteAudioEls.get(key);
            if (!el) {
                el = document.createElement('audio');
                el.id = `remoteAudio-${toDomSafeIdKey(key)}`;
                el.autoplay = true;
                el.playsInline = true;
                el.style.display = 'none';
                document.body.appendChild(el);
                remoteAudioEls.set(key, el);
            }
            el.srcObject = stream;
            el.muted = false;
            el.volume = 1;
            el.onloadedmetadata = () => { try { el.play().catch(() => {}); } catch (_) {} };
            el.oncanplay = () => { try { el.play().catch(() => {}); } catch (_) {} };
            try {
                if (selectedSpeakerDeviceId && typeof el.setSinkId === 'function') {
                    el.setSinkId(selectedSpeakerDeviceId).catch(() => {});
                }
            } catch (_) {}
            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    if (!String(participantId).startsWith('screen:')) connectingAudioParticipants.delete(String(participantId));
                }).catch(() => {
                    if (!String(participantId).startsWith('screen:')) connectingAudioParticipants.add(String(participantId));
                });
                p.catch(() => {
                    if (document.hidden) return;
                    if (audioPlaybackUnlocked) return;
                    if (!audioUnlockShown) {
                        audioUnlockShown = true;
                        const btn = document.createElement('div');
                        btn.className = 'notification info';
                        btn.style.cursor = 'pointer';
                        btn.innerHTML = `
                            <div class="notification-icon">🔊</div>
                            <div class="notification-content">
                                <div class="notification-title">Включить звук</div>
                                <div class="notification-message">Нажмите, чтобы разрешить воспроизведение</div>
                            </div>
                            <div class="notification-close">✕</div>
                        `;
                        btn.onclick = () => {
                            unlockAudioPlayback();
                            remoteAudioEls.forEach((audioEl) => audioEl.play().catch(() => {}));
                            btn.remove();
                            audioUnlockShown = false;
                        };
                        document.getElementById('notifications').appendChild(btn);
                    }
                });
            }
        }

        function stopRemoteAudio(participantId = null) {
            if (participantId) {
                const key = String(participantId);
                const el = remoteAudioEls.get(key);
                if (el) {
                    el.srcObject = null;
                    el.remove();
                    remoteAudioEls.delete(key);
                }
                if (!key.startsWith('screen:')) connectingAudioParticipants.delete(key);
                return;
            }
            remoteAudioEls.forEach((el) => {
                el.srcObject = null;
                el.remove();
            });
            remoteAudioEls.clear();
            connectingAudioParticipants = new Set();
        }

        function applySpeakerDeviceToAllAudio() {
            try {
                if (!selectedSpeakerDeviceId) return;
                remoteAudioEls.forEach((el) => {
                    try {
                        if (el && typeof el.setSinkId === 'function') {
                            el.setSinkId(selectedSpeakerDeviceId).catch(() => {});
                        }
                    } catch (_) {}
                });
                if (watchPartyMediaElement && typeof watchPartyMediaElement.setSinkId === 'function') {
                    watchPartyMediaElement.setSinkId(selectedSpeakerDeviceId).catch(() => {});
                }
            } catch (_) {}
        }

        function ensureScreenSharePeersForParticipants() {
            if (!isScreenSharing || !screenStreamLocal || !localScreenShareId) return;
            participants.forEach((name, id) => {
                if (id === myId) return;
                const screenKey = `screen-local-${id}`;
                const existing = peers.get(screenKey);
                if (existing && !existing.destroyed) return;
                const connId = `${localScreenShareId}:${id}`;
                const screenPeer = createPeer(screenStreamLocal, 'screen', true, id, name, connId);
                peers.set(screenKey, screenPeer);
                screenConnMap.set(connId, screenKey);
            });
        }

        function syncLocalMediaStateToServer() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'toggle-audio', enabled: !!audioEnabled }));
            ws.send(JSON.stringify({ type: 'toggle-video', enabled: !!videoEnabled }));
            ws.send(JSON.stringify({ type: 'speaking', isSpeaking: !!isSpeaking }));
            if (videoEnabled) {
                syncCameraFacingMode();
            }
            if (isScreenSharing && screenStreamLocal) {
                ensureScreenSharePeersForParticipants();
                ws.send(JSON.stringify({ type: 'start-screen', from: userName }));
            }
        }

        function cleanupConnectionsForReconnect() {
            peers.forEach((peer) => {
                try { peer.destroy(); } catch (_) {}
            });
            peers.clear();
            screenConnMap.clear();
            avPeerRecoverTimers.forEach((timerId) => clearTimeout(timerId));
            avPeerRecoverTimers.clear();
            audioRecoverCooldown.clear();
            remoteMediaStreams.clear();
            stopRemoteAudio();
            videoTiles.forEach((tile, key) => {
                if (key === 'self') return;
                try { tile.remove(); } catch (_) {}
            });
            Array.from(videoTiles.keys()).forEach((key) => {
                if (key !== 'self') videoTiles.delete(key);
            });
            screenTiles.forEach((tile, key) => {
                if (key === 'self-screen' && isScreenSharing && screenStreamLocal) return;
                try { tile.remove(); } catch (_) {}
            });
            Array.from(screenTiles.keys()).forEach((key) => {
                if (key !== 'self-screen') screenTiles.delete(key);
            });
            if (isScreenSharing && screenStreamLocal) {
                addScreenTile('self-screen', userName, screenStreamLocal);
            }
            updatePrimaryRemoteState();
            updateUI();
            updateEmptyState();
        }

        function scheduleWsReconnect() {
            if (wsReconnectTimer || wsReconnectInProgress) return;
            if (!wsLastInitialMsg || !roomId || !localStream) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            const delay = Math.min(8000, Math.floor(900 * Math.pow(1.8, wsReconnectAttempts)));
            wsReconnectAttempts += 1;
            wsReconnectTimer = setTimeout(() => {
                wsReconnectTimer = null;
                if (!wsLastInitialMsg || !roomId || !localStream) return;
                wsReconnectInProgress = true;
                cleanupConnectionsForReconnect();
                connectWS(wsLastInitialMsg, true);
                wsReconnectInProgress = false;
            }, delay);
        }

        function reconnectNow() {
            if (!wsLastInitialMsg || !roomId || !localStream) return;
            if (ws && ws.readyState === WebSocket.OPEN) return;
            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }
            wsReconnectInProgress = true;
            cleanupConnectionsForReconnect();
            connectWS(wsLastInitialMsg, true);
            wsReconnectInProgress = false;
        }

        function recoverAfterTabWakeup() {
            if (!roomId) return;
            if (audioContextRef && audioContextRef.state === 'suspended') {
                audioContextRef.resume().catch(() => {});
            }
            if (ws?.readyState === WebSocket.OPEN) {
                syncLocalMediaStateToServer();
            } else {
                reconnectNow();
            }
            getRemoteParticipantIds().forEach((participantId) => {
                ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
                syncRemoteAudioPlayback(participantId);
            });
            setTimeout(healRemoteAudioLinks, 700);
            setTimeout(healRemoteAudioLinks, 1800);
            if (isScreenSharing) {
                ensureScreenSharePeersForParticipants();
            }
        }

        function recoverRemoteAudioForParticipant(participantId) {
            if (!participantId || participantId === myId) return;
            const now = Date.now();
            const lastAttempt = audioRecoverCooldown.get(participantId) || 0;
            if (now - lastAttempt < 2500) return;
            audioRecoverCooldown.set(participantId, now);
            recreateAvPeerForParticipant(participantId);
        }

        function syncRemoteAudioPlayback(participantId) {
            if (!participantId) return;
            const state = getParticipantState(participantId);
            if (!state || !state.audio) {
                stopRemoteAudio(participantId);
                connectingAudioParticipants.delete(String(participantId));
                return;
            }
            const mediaStream = remoteMediaStreams.get(participantId);
            if (!mediaStream || !mediaStream.getAudioTracks) {
                connectingAudioParticipants.add(String(participantId));
                stopRemoteAudio(participantId);
                recoverRemoteAudioForParticipant(participantId);
                return;
            }
            const activeAudioTracks = mediaStream.getAudioTracks().filter((track) => track && track.readyState !== 'ended');
            if (!activeAudioTracks.length) {
                connectingAudioParticipants.add(String(participantId));
                stopRemoteAudio(participantId);
                recoverRemoteAudioForParticipant(participantId);
                return;
            }
            playRemoteAudio(participantId, new MediaStream(activeAudioTracks));
            connectingAudioParticipants.delete(String(participantId));
        }

        function healRemoteAudioLinks() {
            getRemoteParticipantIds().forEach((participantId) => {
                const state = getParticipantState(participantId);
                if (!state || !state.audio) return;
                ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
                syncRemoteAudioPlayback(participantId);
            });
        }

        function stopCallAudioHealTimer() {
            if (callAudioHealTimer) {
                clearInterval(callAudioHealTimer);
                callAudioHealTimer = null;
            }
        }

        function startCallAudioHealTimer() {
            stopCallAudioHealTimer();
            callAudioHealTimer = setInterval(() => {
                if (!roomId || !isConnected) return;
                healRemoteAudioLinks();
            }, 40000);
        }

        function addVideoTile(userId, userName, stream) {
            const container = document.getElementById('videosContainer');
            let tile = videoTiles.get(userId);
            
            if (tile) {
                tile.style.display = '';
                const video = tile.querySelector('video');
                if (video && video.srcObject !== stream) {
                    video.srcObject = stream;
                    if (userId === 'self') {
                        video.muted = true;
                    }
                    video.play().catch(() => {});
                }
                applyVideoTileMirroring(userId);
                updateEmptyState();
                return;
            }

            tile = document.createElement('div');
            tile.id = `video-${userId}`;
            tile.className = 'video-tile camera-tile';
            
            if (userId === 'self') {
                tile.classList.add('self-video');
            }

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.srcObject = stream;
            
            if (userId === 'self') {
                video.muted = true;
            }
            
            video.play().catch(() => {});
            applyVideoTileMirroring(userId);

            const label = document.createElement('div');
            label.className = 'video-label';
            label.innerHTML = `<i class="fas fa-video"></i> ${escapeHtml(userName)}`;

            tile.appendChild(video);
            tile.appendChild(label);
            tile.onclick = () => toggleFullscreen(tile);
            container.appendChild(tile);
            videoTiles.set(userId, tile);
            
            updateEmptyState();
        }

        function setVideoTileVisibility(userId, visible) {
            const tile = videoTiles.get(userId);
            if (!tile) return;
            tile.style.display = visible ? '' : 'none';
            updateEmptyState();
        }

        function removeVideoTile(userId) {
            const tile = videoTiles.get(userId);
            if (tile) {
                tile.remove();
                videoTiles.delete(userId);
            }
            updateEmptyState();
        }

        function addScreenTile(userId, userName, stream) {
            const container = document.getElementById('videosContainer');
            let tile = screenTiles.get(userId);
            if (tile) tile.remove();

            tile = document.createElement('div');
            tile.id = `screen-${userId}`;
            tile.className = 'video-tile screen-tile';

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.srcObject = stream;
            
            const tryPlay = () => video.play().catch(() => {});
            video.onloadedmetadata = tryPlay;
            video.oncanplay = tryPlay;
            setTimeout(() => {
                if (video.readyState < 2 || video.videoWidth === 0) {
                    tryPlay();
                }
            }, 500);

            const label = document.createElement('div');
            label.className = 'video-label';
            label.innerHTML = `<i class="fas fa-desktop"></i> ${escapeHtml(userName)} - экран`;

            tile.appendChild(video);
            tile.appendChild(label);
            tile.onclick = () => toggleFullscreen(tile);
            container.appendChild(tile);
            screenTiles.set(userId, tile);

            try {
                const audioTracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
                const liveAudio = (audioTracks || []).filter((t) => t && t.readyState === 'live');
                if (userId !== 'self-screen' && liveAudio.length) {
                    playRemoteAudio(`screen:${userId}`, new MediaStream(liveAudio));
                }
            } catch (_) {}
            
            updateEmptyState();
        }

        function removeScreenTile(userId) {
            const tile = screenTiles.get(userId);
            if (tile) {
                tile.remove();
                screenTiles.delete(userId);
            }
            stopRemoteAudio(`screen:${userId}`);
            updateEmptyState();
        }

        function normalizeWatchUrl(input) {
            let value = String(input || '').trim();
            if (!value) return '';
            if (!/^https?:\/\//i.test(value)) {
                value = `https://${value}`;
            }
            try {
                const parsed = new URL(value);
                if (!/^https?:$/i.test(parsed.protocol)) return '';
                return parsed.toString();
            } catch (_) {
                return '';
            }
        }

        function extractYoutubeId(url) {
            try {
                const parsed = new URL(url);
                const host = parsed.hostname.toLowerCase();
                if (host.includes('youtu.be')) {
                    return parsed.pathname.replace(/\//g, '').trim();
                }
                if (host.includes('youtube.com')) {
                    const fromQuery = parsed.searchParams.get('v');
                    if (fromQuery) return fromQuery.trim();
                    const parts = parsed.pathname.split('/').filter(Boolean);
                    const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
                    if (markerIndex >= 0 && parts[markerIndex + 1]) {
                        return parts[markerIndex + 1].trim();
                    }
                }
            } catch (_) {}
            return '';
        }

        function applyWatchPartyVolume() {
            const level = Math.max(0, Math.min(100, Math.round(watchPartyVolume)));
            const normalized = Math.max(0, Math.min(1, level / 100));
            if (watchPartyMediaElement) {
                watchPartyMediaElement.volume = normalized;
            }
            if (typeof watchPartyVolumeApplier === 'function') {
                try { watchPartyVolumeApplier(level, normalized); } catch (_) {}
            }
        }

        function createWatchMediaNode(url) {
            const youtubeId = extractYoutubeId(url);
            if (youtubeId) {
                const frame = document.createElement('iframe');
                const origin = encodeURIComponent(window.location.origin);
                frame.src = `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${origin}`;
                frame.allow = 'autoplay; fullscreen; picture-in-picture';
                frame.allowFullscreen = true;
                return {
                    node: frame,
                    supportsVolume: true,
                    mediaElement: null,
                    afterMount: () => {
                        watchPartyVolumeApplier = (level) => {
                            const target = frame.contentWindow;
                            if (!target) return;
                            const payload = (func, args = []) => JSON.stringify({ event: 'command', func, args });
                            try {
                                target.postMessage(payload('setVolume', [level]), '*');
                                target.postMessage(payload('unMute'), '*');
                            } catch (_) {}
                        };
                        const tryApply = () => {
                            if (!frame.isConnected) return;
                            applyWatchPartyVolume();
                        };
                        frame.addEventListener('load', tryApply);
                        setTimeout(tryApply, 250);
                        setTimeout(tryApply, 900);
                    }
                };
            }
            if (/\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url)) {
                const video = document.createElement('video');
                video.autoplay = true;
                video.playsInline = true;
                video.controls = true;
                video.src = url;
                video.volume = Math.max(0, Math.min(1, watchPartyVolume / 100));
                video.play().catch(() => {});
                return {
                    node: video,
                    supportsVolume: true,
                    mediaElement: video,
                    afterMount: () => {
                        watchPartyVolumeApplier = null;
                        applyWatchPartyVolume();
                    }
                };
            }
            if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(url)) {
                const audioWrap = document.createElement('div');
                audioWrap.style.width = '100%';
                audioWrap.style.height = '100%';
                audioWrap.style.display = 'flex';
                audioWrap.style.alignItems = 'center';
                audioWrap.style.justifyContent = 'center';
                audioWrap.style.background = 'radial-gradient(circle at 30% 30%, rgba(102,126,234,0.35), rgba(17,12,33,0.95))';
                const audio = document.createElement('audio');
                audio.autoplay = true;
                audio.controls = true;
                audio.src = url;
                audio.volume = Math.max(0, Math.min(1, watchPartyVolume / 100));
                audio.style.width = '86%';
                audio.play().catch(() => {});
                audioWrap.appendChild(audio);
                return {
                    node: audioWrap,
                    supportsVolume: true,
                    mediaElement: audio,
                    afterMount: () => {
                        watchPartyVolumeApplier = null;
                        applyWatchPartyVolume();
                    }
                };
            }
            const frame = document.createElement('iframe');
            frame.src = url;
            frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
            frame.allowFullscreen = true;
            return {
                node: frame,
                supportsVolume: false,
                mediaElement: null,
                afterMount: () => {
                    watchPartyVolumeApplier = null;
                }
            };
        }

        function removeWatchPartyTile() {
            if (watchPartyTile) {
                watchPartyTile.remove();
                watchPartyTile = null;
            }
            watchPartyMediaElement = null;
            watchPartySupportsVolume = false;
            watchPartyVolumeApplier = null;
            updateEmptyState();
        }

        function clearWatchFocusTimer() {
            if (!watchFocusIdleTimer) return;
            clearTimeout(watchFocusIdleTimer);
            watchFocusIdleTimer = null;
        }

        function triggerWatchFocusActivity() {
            if (!watchFocusEnabled) return;
            const callScreen = document.querySelector('.call-screen');
            if (!callScreen) return;
            callScreen.classList.remove('ui-idle');
            clearWatchFocusTimer();
            watchFocusIdleTimer = setTimeout(() => {
                if (!watchFocusEnabled) return;
                const currentCallScreen = document.querySelector('.call-screen');
                if (!currentCallScreen) return;
                currentCallScreen.classList.add('ui-idle');
            }, 2400);
        }

        function applyWatchFocusMode(enabled) {
            const callScreen = document.querySelector('.call-screen');
            if (!callScreen && !enabled) {
                watchFocusEnabled = false;
                clearWatchFocusTimer();
                document.removeEventListener('mousemove', triggerWatchFocusActivity);
                document.removeEventListener('touchstart', triggerWatchFocusActivity);
                document.removeEventListener('keydown', triggerWatchFocusActivity);
                return;
            }
            if (!!enabled === watchFocusEnabled) {
                return;
            }
            watchFocusEnabled = !!enabled;
            if (watchFocusEnabled) {
                if (callScreen) {
                    callScreen.classList.add('watch-focus');
                    callScreen.classList.remove('ui-idle');
                }
                document.addEventListener('mousemove', triggerWatchFocusActivity, { passive: true });
                document.addEventListener('touchstart', triggerWatchFocusActivity, { passive: true });
                document.addEventListener('keydown', triggerWatchFocusActivity);
                triggerWatchFocusActivity();
            } else {
                clearWatchFocusTimer();
                document.removeEventListener('mousemove', triggerWatchFocusActivity);
                document.removeEventListener('touchstart', triggerWatchFocusActivity);
                document.removeEventListener('keydown', triggerWatchFocusActivity);
                if (callScreen) {
                    callScreen.classList.remove('watch-focus');
                    callScreen.classList.remove('ui-idle');
                }
            }
        }

        function renderWatchPartyTile() {
            const container = document.getElementById('videosContainer');
            if (!container) return;
            if (!watchPartyState || !watchPartyState.url) {
                removeWatchPartyTile();
                return;
            }
            removeWatchPartyTile();

            const tile = document.createElement('div');
            tile.id = 'watch-party-tile';
            tile.className = 'video-tile screen-tile watch-tile';

            const media = createWatchMediaNode(watchPartyState.url);
            watchPartyMediaElement = media.mediaElement || null;
            watchPartySupportsVolume = !!media.supportsVolume;

            const label = document.createElement('div');
            label.className = 'video-label';
            label.innerHTML = `<i class="fas fa-users-viewfinder"></i> ${watchPartyState.ownerName || 'Совместный просмотр'}`;

            const controls = document.createElement('div');
            controls.className = 'watch-controls';
            controls.innerHTML = `
                <i class="fas fa-volume-up"></i>
                <input id="watchVolumeRange" type="range" min="0" max="100" step="1" value="${watchPartyVolume}">
                <span id="watchVolumeValue">${watchPartyVolume}%</span>
            `;
            controls.onclick = (event) => event.stopPropagation();
            controls.ontouchstart = (event) => event.stopPropagation();

            tile.appendChild(media.node);
            tile.appendChild(label);
            tile.appendChild(controls);
            tile.onclick = () => toggleFullscreen(tile);
            container.appendChild(tile);
            if (typeof media.afterMount === 'function') {
                media.afterMount();
            }

            watchPartyTile = tile;
            const volumeRange = tile.querySelector('#watchVolumeRange');
            const volumeValue = tile.querySelector('#watchVolumeValue');
            if (volumeRange) {
                volumeRange.oninput = (event) => {
                    const nextValue = Number(event.target.value);
                    watchPartyVolume = Number.isFinite(nextValue) ? nextValue : watchPartyVolume;
                    if (volumeValue) {
                        volumeValue.textContent = `${watchPartyVolume}%`;
                    }
                    applyWatchPartyVolume();
                };
                volumeRange.onchange = volumeRange.oninput;
            }
            updateEmptyState();
        }

        function canStartWatchParty() {
            if (!watchPartyState) return true;
            return watchPartyState.ownerId === myId || isCreator || isGuestAdmin;
        }

        function canStopWatchParty() {
            if (!watchPartyState) return false;
            return watchPartyState.ownerId === myId || isCreator || isGuestAdmin;
        }

        function showWatchPartyModal() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (!canStartWatchParty()) {
                showNotification('Совместный просмотр', 'Только владелец просмотра, админ или создатель могут заменить ссылку', 'warning');
                return;
            }
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2><i class="fas fa-users-viewfinder"></i> Совместный просмотр</h2>
                    <input type="text" id="watchUrlInput" class="modal-input" placeholder="Вставьте ссылку на VK, YouTube, музыку или видео" value="${watchPartyState?.url ? escapeHtml(watchPartyState.url) : ''}">
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" id="watchCancelBtn">Отмена</button>
                        <button class="modal-btn confirm" id="watchStartBtn">Запустить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const closeModal = () => modal.remove();
            document.getElementById('watchCancelBtn').onclick = closeModal;
            document.getElementById('watchStartBtn').onclick = () => {
                const inputEl = document.getElementById('watchUrlInput');
                const normalizedUrl = normalizeWatchUrl(inputEl?.value || '');
                if (!normalizedUrl) {
                    showNotification('Совместный просмотр', 'Укажите корректную ссылку', 'error');
                    return;
                }
                ws.send(JSON.stringify({ type: 'start-watch', url: normalizedUrl }));
                closeModal();
            };
        }

        function stopWatchParty() {
            if (!ws || ws.readyState !== WebSocket.OPEN || !watchPartyState) return;
            if (!canStopWatchParty()) {
                showNotification('Совместный просмотр', 'Остановить просмотр может владелец, админ или создатель', 'warning');
                return;
            }
            ws.send(JSON.stringify({ type: 'stop-watch' }));
        }

        function updateEmptyState() {
            const visibleVideoTiles = Array.from(videoTiles.values()).filter(tile => tile && tile.style.display !== 'none');
            const visibleVideoCount = visibleVideoTiles.length;
            const watchTileCount = watchPartyTile ? 1 : 0;
            const hasAnyTile = visibleVideoCount > 0 || screenTiles.size > 0 || watchTileCount > 0;
            const emptyDiv = document.getElementById('emptyCallDiv');
            const videosContainer = document.getElementById('videosContainer');
            const waitingMsg = document.getElementById('waitingMsg');
            const callTopbar = document.getElementById('callTopbar');
            const tilesCount = visibleVideoCount + screenTiles.size + watchTileCount;
            const singleScreenOnly = tilesCount === 1 && visibleVideoCount === 0;
            const watchOnlySingle = watchTileCount === 1 && visibleVideoCount === 0 && screenTiles.size === 0;
            
            if (videosContainer) {
                if (tilesCount <= 1) {
                    videosContainer.classList.add('single-view');
                } else {
                    videosContainer.classList.remove('single-view');
                }
                if (singleScreenOnly) {
                    videosContainer.classList.add('single-screen-mode');
                } else {
                    videosContainer.classList.remove('single-screen-mode');
                }
                if (waitingMsg && tilesCount > 0) {
                    waitingMsg.style.display = 'none';
                }
            }
            applyWatchFocusMode(watchOnlySingle);
            if (callTopbar) {
                callTopbar.classList.toggle('hidden', !hasAnyTile);
            }
            
            if (!hasAnyTile && videosContainer) {
                if (waitingMsg) waitingMsg.style.display = 'none';
                if (!emptyDiv) {
                    const empty = document.createElement('div');
                    empty.id = 'emptyCallDiv';
                    empty.className = 'empty-call';
                    empty.innerHTML = `
                        <i class="fas fa-phone-alt"></i>
                        <div class="empty-time-pill">
                            <div class="call-time" id="emptyCallTimer">00:00</div>
                        </div>
                        <div class="privacy-island" id="privacyIsland">
                            <span id="privacyIslandBadge" class="room-status ${roomIsPrivate ? 'private' : 'public'}" title="${roomIsPrivate ? 'Закрытая' : 'Публичная'}"><i class="fas ${roomIsPrivate ? 'fa-lock' : 'fa-globe'}"></i></span>
                            <span id="privacyIslandLabel" class="privacy-island-label">${roomIsPrivate ? 'Приватный' : 'Публичный'}</span>
                        </div>
                    `;
                    videosContainer.appendChild(empty);
                }
            } else if (emptyDiv) {
                emptyDiv.remove();
            }
        }

        function applyCallScreenPerformanceMode() {
            const callScreen = document.getElementById('callScreenRoot');
            if (!callScreen) return;
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const isLowPowerDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
                || (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4)
                || (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4);
            callScreen.classList.toggle('low-motion', prefersReducedMotion || isLowPowerDevice);
        }

        function toggleFullscreen(tile) {
            if (tile.classList.contains('fullscreen')) {
                tile.classList.remove('fullscreen');
                if (tile.__originParent) {
                    if (tile.__originNext && tile.__originNext.parentElement === tile.__originParent) {
                        tile.__originParent.insertBefore(tile, tile.__originNext);
                    } else {
                        tile.__originParent.appendChild(tile);
                    }
                }
                tile.__originParent = null;
                tile.__originNext = null;
                const btn = tile.querySelector('.close-fullscreen');
                if (btn) btn.remove();
            } else {
                document.querySelectorAll('.video-tile.fullscreen').forEach(t => {
                    t.classList.remove('fullscreen');
                    const btn = t.querySelector('.close-fullscreen');
                    if (btn) btn.remove();
                });
                tile.classList.add('fullscreen');
                tile.__originParent = tile.parentElement;
                tile.__originNext = tile.nextSibling;
                const callScreen = document.querySelector('.call-screen');
                if (callScreen) {
                    callScreen.appendChild(tile);
                } else {
                    document.body.appendChild(tile);
                }
                const closeBtn = document.createElement('button');
                closeBtn.className = 'close-fullscreen';
                closeBtn.innerHTML = '<i class="fas fa-times"></i>';
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    tile.classList.remove('fullscreen');
                    if (tile.__originParent) {
                        if (tile.__originNext && tile.__originNext.parentElement === tile.__originParent) {
                            tile.__originParent.insertBefore(tile, tile.__originNext);
                        } else {
                            tile.__originParent.appendChild(tile);
                        }
                    }
                    tile.__originParent = null;
                    tile.__originNext = null;
                    closeBtn.remove();
                };
                tile.appendChild(closeBtn);
            }
            updateEmptyState();
        }

        function ensureInviteRoomId() {
            if (roomId) return roomId;
            roomId = generateRoomId();
            history.replaceState(null, '', `${getBasePath().replace(/\/$/, '')}/${roomId}`);
            return roomId;
        }

        async function createRoom(options = {}) {
            const privateRoom = !!options.privateRoom;
            const silent = !!options.silent;
            const friendCallTargetId = String(options.friendCallTargetId || '').trim();
            const friendCallMode = !!friendCallTargetId;
            const fixedRoomId = String(options.fixedRoomId || '').trim();
            const groupChatId = String(options.groupChatId || '').trim();
            const groupCallAllowedUserIds = Array.isArray(options.groupCallAllowedUserIds) ? options.groupCallAllowedUserIds : [];
            if (!authProfile) {
                showNotification('Авторизация', 'Сначала войдите через Telegram, Google или VK', 'warning');
                renderAuthScreen();
                return null;
            }
            resetCallState();
            userName = authProfile.name;
            userAvatar = authProfile.avatar || '';
            isCreator = true;
            videoEnabled = false;
            audioEnabled = true;

            const stream = await getMedia();
            if (!stream) return null;
            localStream = stream;
            setupAudioDetection(stream);
            applyMicOutgoingChain();

            roomId = fixedRoomId || generateRoomId();
            roomIsPrivate = privateRoom;
            currentGroupCallChatId = groupChatId;
            currentGroupCallTitle = String(options.groupTitle || '').trim();

            connectWS({
                type: 'create',
                roomId,
                userName,
                userAvatar,
                appUserId: authProfile?.appUserId || appUserId,
                privateRoom,
                friendCallMode,
                friendTargetAppUserId: friendCallTargetId,
                groupChatId,
                groupCallAllowedUserIds,
                reconnectKey: getReconnectKey()
            });
            history.replaceState(null, '', `${getBasePath().replace(/\/$/, '')}/${roomId}`);

            renderCallScreen();
            startCallTimer();
            if (!silent) {
                showNotification('Комната создана', 'Ссылка готова для отправки', 'success');
            }
            return roomId;
        }

        async function joinRoom(id, options = {}) {
            if (!authProfile) {
                pendingRoomJoin = id;
                renderAuthScreen();
                return;
            }
            resetCallState();
            userName = authProfile.name;
            userAvatar = authProfile.avatar || '';
            isCreator = false;
            videoEnabled = false;
            audioEnabled = true;

            const stream = await getMedia();
            if (!stream) return;
            localStream = stream;
            setupAudioDetection(stream);
            applyMicOutgoingChain();

            roomId = id;
            currentGroupCallChatId = String(options.groupChatId || '').trim();
            currentGroupCallTitle = String(options.groupTitle || '').trim();
            history.replaceState(null, '', `${getBasePath().replace(/\/$/, '')}/${roomId}`);

            connectWS({
                type: 'join',
                roomId,
                userName,
                userAvatar,
                appUserId: authProfile?.appUserId || appUserId,
                groupChatId: currentGroupCallChatId,
                reconnectKey: getReconnectKey()
            });

            renderCallScreen();
            startCallTimer();
            showNotification('Подключение', 'Поиск комнаты...', 'info');
        }

        function connectWS(initialMsg, isReconnect = false) {
            wsLastInitialMsg = initialMsg ? { ...initialMsg } : wsLastInitialMsg;
            if (wsHeartbeatTimer) {
                clearInterval(wsHeartbeatTimer);
                wsHeartbeatTimer = null;
            }
            if (ws) {
                try {
                    ws.__closingByUser = true;
                    ws.close();
                } catch (_) {}
            }
            const payload = {
                ...(initialMsg || wsLastInitialMsg || {}),
                reconnectKey: getReconnectKey()
            };
            const candidates = resolveWsUrls();
            const tryConnectCandidate = (index) => {
                if (index >= candidates.length) {
                    isConnected = false;
                    showNotification('Связь', 'Не удалось подключиться к серверу. Повторяем попытку...', 'warning');
                    scheduleWsReconnect();
                    return;
                }
                const socket = new WebSocket(candidates[index]);
                ws = socket;
                let opened = false;
                const connectTimeout = setTimeout(() => {
                    if (!opened) {
                        console.error('[WS] Connection timeout for:', candidates[index]);
                        try { socket.close(); } catch(_) {}
                        tryConnectCandidate(index + 1);
                    }
                }, 8000);
                socket.onopen = () => {
                    clearTimeout(connectTimeout);
                    console.log('[WS] Connected to:', candidates[index]);
                    opened = true;
                    if (wsReconnectTimer) {
                        clearTimeout(wsReconnectTimer);
                        wsReconnectTimer = null;
                    }
                    wsReconnectAttempts = 0;
                    socket.send(JSON.stringify(payload));
                    socket.onmessage = handleMessage;
                    socket.onerror = (e) => {
                    console.error('[WS] Error connecting to:', candidates[index], e);
                };
                    syncMessengerIdentity();
                    flushPendingMessengerEvents();
                    if (wsHeartbeatTimer) {
                        clearInterval(wsHeartbeatTimer);
                    }
                    wsHeartbeatTimer = setInterval(() => {
                        if (socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
                        }
                    }, 10000);
                    if (isReconnect) {
                        showNotification('Связь', 'Соединение восстановлено', 'success');
                    }
                };
                socket.onclose = (ev) => {
                    clearTimeout(connectTimeout);
                    console.log('[WS] Closed:', candidates[index], 'code:', ev.code, 'reason:', ev.reason);
                    if (socket.__closingByUser) {
                        socket.__closingByUser = false;
                        return;
                    }
                    if (!opened) {
                        tryConnectCandidate(index + 1);
                        return;
                    }
                    isConnected = false;
                    if (wsHeartbeatTimer) {
                        clearInterval(wsHeartbeatTimer);
                        wsHeartbeatTimer = null;
                    }
                    showNotification('Соединение потеряно', 'Пробуем переподключиться...', 'warning');
                    scheduleWsReconnect();
                };
            };
            tryConnectCandidate(0);
        }

        function createPeer(stream, type, isInitiator, targetId = null, label = null, connId = null) {
            const bitrateKbps = type === 'screen' ? 1500 : 1200;
            const opts = {
                initiator: isInitiator,
                trickle: true,
                sdpTransform: (sdp) => improveVideoSdpQuality(sdp, bitrateKbps),
                config: { 
                    iceServers: rtcIceServers.length ? rtcIceServers : DEFAULT_ICE_SERVERS,
                    iceCandidatePoolSize: 8
                }
            };
            if (stream) {
                opts.stream = stream;
            }
            const peer = new SimplePeer(opts);
            
            peer.on('signal', s => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const sigType = type === 'video' ? 'signal' : `${type}-signal`;
                    ws.send(JSON.stringify({ 
                        type: sigType, 
                        signal: s, 
                        target: targetId,
                        peerType: type,
                        connId: connId
                    }));
                }
            });
            
            peer.on('stream', stream => {
                if (type === 'video') {
                    if (targetId && stream) {
                        remoteMediaStreams.set(targetId, stream);
                    }
                    const hasVideo = stream.getVideoTracks().length > 0;
                    if (hasVideo) {
                        addVideoTile(targetId || 'remote', label || remoteName, stream);
                    }
                    syncRemoteAudioPlayback(targetId);
                } else if (type === 'screen') {
                    const hasVideo = stream && stream.getVideoTracks && stream.getVideoTracks().length > 0;
                    if (hasVideo) {
                        addScreenTile(targetId || 'remote-screen', label || remoteName, stream);
                    }
                }
            });
            
            peer.on('track', (track, stream) => {
                if (type === 'video') {
                    if (targetId && stream) {
                        remoteMediaStreams.set(targetId, stream);
                    }
                    const hasVideo = stream.getVideoTracks().length > 0;
                    if (hasVideo) {
                        addVideoTile(targetId || 'remote', label || remoteName, stream);
                    }
                    syncRemoteAudioPlayback(targetId);
                } else if (type === 'screen') {
                    try {
                        const hasVideo = stream && stream.getVideoTracks && stream.getVideoTracks().length > 0;
                        if (hasVideo) {
                            addScreenTile(targetId || 'remote-screen', label || remoteName, stream);
                        } else if (track && track.kind === 'video') {
                            addScreenTile(targetId || 'remote-screen', label || remoteName, new MediaStream([track]));
                        }
                        const audioTracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
                        const liveAudio = (audioTracks || []).filter((t) => t && t.readyState === 'live');
                        if (targetId && liveAudio.length) {
                            playRemoteAudio(`screen:${targetId}`, new MediaStream(liveAudio));
                        }
                    } catch (_) {}
                }
            });
            
            peer.on('error', (err) => {});
            peer.on('connect', () => {
                if (targetId && type === 'video') {
                    const timerId = avPeerRecoverTimers.get(targetId);
                    if (timerId) {
                        clearTimeout(timerId);
                        avPeerRecoverTimers.delete(targetId);
                    }
                }
                if (targetId) {
                    syncRemoteAudioPlayback(targetId);
                }
            });
            if (type === 'video' && targetId && peer._pc) {
                const pc = peer._pc;
                const getIceKey = () => `ice:${String(targetId)}`;
                const scheduleRecover = () => {
                    const ice = String(pc.iceConnectionState || '').toLowerCase();
                    const conn = String(pc.connectionState || '').toLowerCase();
                    const hardFail = ice === 'failed' || conn === 'failed' || ice === 'closed' || conn === 'closed';
                    const softDisc = ice === 'disconnected';
                    if (!hardFail && !softDisc) {
                        const existing = avPeerRecoverTimers.get(targetId);
                        if (existing) {
                            clearTimeout(existing);
                            avPeerRecoverTimers.delete(targetId);
                        }
                        const iceT = iceRestartTimers.get(getIceKey());
                        if (iceT) {
                            clearTimeout(iceT);
                            iceRestartTimers.delete(getIceKey());
                        }
                        return;
                    }

                    // На disconnected: пробуем ICE restart (лёгкое восстановление) вместо уничтожения peer.
                    if (softDisc) {
                        if (!iceRestartTimers.has(getIceKey())) {
                            const t = setTimeout(() => {
                                iceRestartTimers.delete(getIceKey());
                                const ice2 = String(pc.iceConnectionState || '').toLowerCase();
                                if (ice2 !== 'disconnected') return;
                                try {
                                    if (typeof pc.restartIce === 'function') {
                                        pc.restartIce();
                                    }
                                } catch (_) {}
                            }, 5000);
                            iceRestartTimers.set(getIceKey(), t);
                        }
                        // Если после попытки всё ещё плохо — тогда уже пересоздаём peer (но не мгновенно).
                        if (!avPeerRecoverTimers.has(targetId)) {
                            const timerId = setTimeout(() => {
                                avPeerRecoverTimers.delete(targetId);
                                const ice2 = String(pc.iceConnectionState || '').toLowerCase();
                                const conn2 = String(pc.connectionState || '').toLowerCase();
                                if (ice2 === 'connected' || ice2 === 'completed') return;
                                if (conn2 === 'connected') return;
                                if (ice2 === 'disconnected') {
                                    recreateAvPeerForParticipant(targetId);
                                }
                            }, 20000);
                            avPeerRecoverTimers.set(targetId, timerId);
                        }
                        return;
                    }

                    // На failed/closed — пересоздаём peer (как и раньше).
                    if (hardFail && !avPeerRecoverTimers.has(targetId)) {
                        const timerId = setTimeout(() => {
                            avPeerRecoverTimers.delete(targetId);
                            const ice2 = String(pc.iceConnectionState || '').toLowerCase();
                            const conn2 = String(pc.connectionState || '').toLowerCase();
                            if (ice2 === 'connected' || ice2 === 'completed') return;
                            if (conn2 === 'connected') return;
                            recreateAvPeerForParticipant(targetId);
                        }, 2500);
                        avPeerRecoverTimers.set(targetId, timerId);
                    }
                };
                pc.addEventListener('iceconnectionstatechange', scheduleRecover);
                pc.addEventListener('connectionstatechange', scheduleRecover);
            }
            
            return peer;
        }

        function recreateAvPeerForParticipant(participantId) {
            if (!participantId || participantId === myId) return;
            ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
        }

        function ensureVideoTrackForAllPeers(track) {
            if (!track || !localStream) return;
            getRemoteParticipantIds().forEach((participantId) => {
                const avKey = `av-${participantId}`;
                let peer = peers.get(avKey);
                if (!peer || peer.destroyed) {
                    recreateAvPeerForParticipant(participantId);
                    peer = peers.get(avKey);
                }
                if (!peer || peer.destroyed || typeof peer.addTrack !== 'function') return;
                try {
                    peer.addTrack(track, localStream);
                } catch (error) {
                    const text = String(error?.message || '');
                    if (/already|exist|added/i.test(text)) {
                        return;
                    }
                    recreateAvPeerForParticipant(participantId);
                }
            });
        }

        async function startScreenShare() {
            if (isScreenSharing) {
                stopScreenShare();
                return;
            }
            const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(navigator.userAgent || '');
            if (isMobileDevice) {
                showNotification('Демонстрация', 'Демонстрация экрана поддерживается только на ПК', 'warning');
                return;
            }
            let stream = null;
            let lastError = null;
            const displayMediaRequest = navigator.mediaDevices?.getDisplayMedia
                ? (constraints) => navigator.mediaDevices.getDisplayMedia(constraints)
                : typeof navigator.getDisplayMedia === 'function'
                    ? (constraints) => navigator.getDisplayMedia(constraints)
                    : null;
            try {
                if (displayMediaRequest) {
                    const attempts = [
                        {
                            video: {
                                width: { ideal: 1920, max: 2560 },
                                height: { ideal: 1080, max: 1440 },
                                frameRate: { ideal: 60, max: 120 }
                            },
                            audio: true
                        },
                        {
                            video: true,
                            audio: true
                        }
                    ];
                    for (const constraints of attempts) {
                        try {
                            stream = await displayMediaRequest(constraints);
                            if (stream && stream.getVideoTracks && stream.getVideoTracks().length) {
                                break;
                            }
                        } catch (error) {
                            lastError = error;
                            if (error?.name === 'NotAllowedError') {
                                throw error;
                            }
                        }
                    }
                }
                if (!stream || !stream.getVideoTracks || !stream.getVideoTracks().length) {
                    throw lastError || new Error('Screen stream unavailable');
                }
                const screenTrack = stream.getVideoTracks()[0];
                if (screenTrack) {
                    screenTrack.contentHint = 'detail';
                    try {
                        await screenTrack.applyConstraints({
                            frameRate: { ideal: 60, max: 120 },
                            width: { ideal: 1920, max: 2560 },
                            height: { ideal: 1080, max: 1440 }
                        });
                    } catch (_) {}
                }
                isScreenSharing = true;
                screenStreamLocal = stream;
                localScreenShareId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                addScreenTile('self-screen', userName, stream);
                ensureScreenSharePeersForParticipants();
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'start-screen', from: userName }));
                } else {
                    showNotification('Демонстрация', 'Связь нестабильна, поток синхронизируется после переподключения', 'warning');
                }
                
                stream.getVideoTracks()[0].onended = () => stopScreenShare();
                updateUI();
                showNotification('Демонстрация', 'Демонстрация началась', 'success');
            } catch (error) {
                if (error.name === 'NotAllowedError') {
                    showNotification('Демонстрация', 'Вы отменили выбор экрана', 'warning');
                } else if (error.name === 'NotFoundError') {
                    showNotification('Демонстрация', 'Нет доступных экранов для демонстрации', 'warning');
                } else if (!displayMediaRequest) {
                    showNotification('Демонстрация', 'Браузер не поддерживает демонстрацию экрана', 'warning');
                } else {
                    showNotification('Демонстрация', 'Не удалось начать демонстрацию экрана', 'error');
                }
            }
        }

        function stopScreenShare() {
            Array.from(peers.keys()).forEach(key => {
                if (key.startsWith('screen-local-')) {
                    peers.get(key).destroy();
                    peers.delete(key);
                }
            });
            Array.from(screenConnMap.entries())
                .filter(([, v]) => typeof v === 'string' && v.startsWith('screen-local-'))
                .forEach(([k]) => screenConnMap.delete(k));
            
            isScreenSharing = false;
            try {
                if (screenStreamLocal) {
                    screenStreamLocal.getTracks().forEach(t => {
                        try { t.stop(); } catch (_) {}
                    });
                }
            } catch (_) {}
            screenStreamLocal = null;
            localScreenShareId = null;
            removeScreenTile('self-screen');
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stop-screen', from: userName }));
            }
            updateUI();
            showNotification('Демонстрация', 'Демонстрация завершена', 'info');
        }

        async function toggleVideo() {
            if (!localStream || cameraSwitchInProgress) return;
            const next = !videoEnabled;
            
            if (next) {
                try {
                    cameraFacingMode = 'user';
                    if (!videoTrack || videoTrack.readyState !== 'live') {
                        const cameraTracks = await createCameraTracks(cameraFacingMode);
                        const track = cameraTracks?.outgoingTrack || null;
                        if (!track) {
                            throw new Error('No video track');
                        }
                        videoTrack = track;
                        cameraSourceTrack = cameraTracks?.sourceTrack || null;
                        selfPreviewTrack = cameraTracks?.previewTrack || null;
                        outgoingTrackCleanup = cameraTracks?.cleanup || null;
                    }
                    if (videoTrack && videoTrack.readyState === 'live') {
                        attachVideoTrack(videoTrack);
                    } else {
                        throw new Error('No video track');
                    }

                    videoEnabled = true;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'toggle-video', enabled: true }));
                    }
                    syncCameraFacingMode();
                    updateUI();
                    showNotification('Камера', 'Камера включена', 'success', '<i class="fas fa-video"></i>');
                } catch (err) {
                    detachCurrentVideoTrack();
                    videoEnabled = false;
                    removeVideoTile('self');
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'toggle-video', enabled: false }));
                    }
                    updateUI();
                    showNotification('Ошибка', 'Не удалось включить камеру', 'error');
                }
            } else {
                detachCurrentVideoTrack();
                cameraFacingMode = 'user';

                videoEnabled = false;
                removeVideoTile('self');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'toggle-video', enabled: false }));
                }
                updateUI();
                    showNotification('Камера', 'Камера выключена', 'info', '<i class="fas fa-video-slash"></i>');
            }
        }

        async function switchCameraFacingMode() {
            if (!localStream || !videoEnabled || !videoTrack || videoTrack.readyState !== 'live' || cameraSwitchInProgress) return;
            const previousFacingMode = cameraFacingMode;
            const nextFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
            cameraSwitchInProgress = true;
            updateUI();
            videoEnabled = false;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'toggle-video', enabled: false }));
            }
            detachCurrentVideoTrack();
            removeVideoTile('self');
            updateUI();
            try {
                const cameraTracks = await createCameraTracks(nextFacingMode);
                const newTrack = cameraTracks?.outgoingTrack || null;
                if (!newTrack) {
                    throw new Error('No video track');
                }
                videoTrack = newTrack;
                cameraSourceTrack = cameraTracks?.sourceTrack || null;
                selfPreviewTrack = cameraTracks?.previewTrack || null;
                outgoingTrackCleanup = cameraTracks?.cleanup || null;
                attachVideoTrack(newTrack);
                cameraFacingMode = normalizeFacingMode(cameraTracks?.facingMode, nextFacingMode);
                videoEnabled = true;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'toggle-video', enabled: true }));
                }
                syncCameraFacingMode();
                showNotification('Камера', cameraFacingMode === 'environment' ? 'Переключено на заднюю камеру' : 'Переключено на переднюю камеру', 'success', '<i class="fas fa-sync-alt"></i>');
            } catch (error) {
                try {
                    const fallbackCameraTracks = await createCameraTracks(previousFacingMode);
                    const fallbackTrack = fallbackCameraTracks?.outgoingTrack || null;
                    if (!fallbackTrack) throw new Error('No fallback video track');
                    videoTrack = fallbackTrack;
                    cameraSourceTrack = fallbackCameraTracks?.sourceTrack || null;
                    selfPreviewTrack = fallbackCameraTracks?.previewTrack || null;
                    outgoingTrackCleanup = fallbackCameraTracks?.cleanup || null;
                    attachVideoTrack(fallbackTrack);
                    cameraFacingMode = normalizeFacingMode(fallbackCameraTracks?.facingMode, previousFacingMode);
                    videoEnabled = true;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'toggle-video', enabled: true }));
                    }
                    syncCameraFacingMode();
                    showNotification('Ошибка', 'Не удалось переключить камеру, восстановлен прошлый режим', 'error');
                } catch (_) {
                    videoTrack = null;
                    videoEnabled = false;
                    cameraFacingMode = 'user';
                    removeVideoTile('self');
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'toggle-video', enabled: false }));
                    }
                    showNotification('Ошибка', 'Не удалось переключить камеру', 'error');
                }
            } finally {
                cameraSwitchInProgress = false;
                updateUI();
            }
        }

        function toggleAudio() {
            unlockAudioPlayback();
            audioEnabled = !audioEnabled;
            localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'toggle-audio', enabled: audioEnabled }));
            }
            showNotification('Микрофон', audioEnabled ? 'Микрофон включен' : 'Микрофон выключен', 'info', audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>');
            updateUI();
        }

        async function refreshAudioDevices() {
            try {
                if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
                    return { mics: [], speakers: [] };
                }
                const all = await navigator.mediaDevices.enumerateDevices();
                const mics = (all || []).filter((d) => d && d.kind === 'audioinput');
                const speakers = (all || []).filter((d) => d && d.kind === 'audiooutput');
                return { mics, speakers };
            } catch (_) {
                return { mics: [], speakers: [] };
            }
        }

        async function reconfigureAudioInput({ silent = true } = {}) {
            if (!localStream) return false;
            try {
                applyMicOutgoingChain();
                const s = await acquireMicMediaStream();
                const newTrack = s.getAudioTracks()[0] || null;
                if (!newTrack) return false;
                const oldTrack = rawMicTrack || (localStream.getAudioTracks()[0] || null);
                rawMicTrack = newTrack;
                try {
                    localStream.getAudioTracks().forEach((t) => {
                        try { localStream.removeTrack(t); } catch (_) {}
                    });
                    localStream.addTrack(rawMicTrack);
                } catch (_) {}
                if (oldTrack && oldTrack !== rawMicTrack) {
                    replaceAudioTrackForAllPeers(oldTrack, rawMicTrack);
                    try { oldTrack.stop(); } catch (_) {}
                }
                applyMicOutgoingChain();
                if (!silent) showNotification('Устройства', 'Микрофон переключен', 'success');
                return true;
            } catch (_) {
                if (!silent) showNotification('Устройства', 'Не удалось переключить микрофон', 'warning');
                return false;
            }
        }

        async function switchMicDevice(deviceId) {
            selectedMicDeviceId = String(deviceId || '');
            await reconfigureAudioInput({ silent: false });
        }

        function switchSpeakerDevice(deviceId) {
            selectedSpeakerDeviceId = String(deviceId || '');
            applySpeakerDeviceToAllAudio();
        }

        function showCallSettingsModal() {
            const prev = document.getElementById('callSettingsModal');
            if (prev) prev.remove();
            const modal = document.createElement('div');
            modal.className = 'modal call-settings-backdrop';
            modal.id = 'callSettingsModal';
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };
            modal.innerHTML = `
                <div class="modal-content call-settings-modal">
                    <h2><i class="fas fa-sliders-h"></i> Настройки звонка</h2>
                    <div class="cs-grid">
                        <div>
                            <div class="cs-title">Микрофон</div>
                            <div class="cs-help">Источник входящего звука.</div>
                            <div id="csMicDd"></div>
                        </div>
                        <div>
                            <div class="cs-title">Динамики</div>
                            <div class="cs-help">Устройство вывода голоса собеседников.</div>
                            <div id="csSpkDd"></div>
                        </div>
                    </div>

                    <div class="modal-buttons" style="margin-top:16px">
                        <button class="modal-btn cancel" onclick="document.getElementById('callSettingsModal')?.remove()">Закрыть</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            (async () => {
                const { mics, speakers } = await refreshAudioDevices();
                const buildDd = ({ mountId, items, value, onSelect, disabledLabel = '' }) => {
                    const mount = document.getElementById(mountId);
                    if (!mount) return;
                    const safeItems = Array.isArray(items) ? items : [];
                    const cur = String(value || (safeItems[0] && safeItems[0].deviceId) || '');
                    const formatDevLabel = (raw) => {
                        let s = String(raw || '').trim();
                        // Часто label = "Microphone (NAME) (1234:abcd)" или "Speakers (NAME) (1234:abcd)" — это слишком длинно.
                        // Убираем хвост вида "(3142:006c)" и лишние пробелы.
                        s = s.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$/g, '');
                        s = s.replace(/\s+/g, ' ').trim();
                        return s || 'Устройство';
                    };
                    const labelOf = (id) => {
                        const it = safeItems.find((x) => String(x.deviceId) === String(id));
                        return (it && formatDevLabel(it.label || '')) || '(по умолчанию)';
                    };
                    mount.innerHTML = `
                        <div class="cs-dd" id="${mountId}__dd">
                            <button type="button" class="cs-dd-btn" id="${mountId}__btn">
                                <span class="cs-dd-label">${escapeHtml(disabledLabel || labelOf(cur))}</span>
                                <span class="cs-dd-caret"><i class="fas fa-chevron-down"></i></span>
                            </button>
                            <div class="cs-dd-menu" id="${mountId}__menu"></div>
                        </div>
                    `;
                    const dd = document.getElementById(`${mountId}__dd`);
                    const btn = document.getElementById(`${mountId}__btn`);
                    const menu = document.getElementById(`${mountId}__menu`);
                    if (!dd || !btn || !menu) return;
                    if (disabledLabel) {
                        try { btn.disabled = true; btn.style.opacity = '0.7'; btn.style.cursor = 'not-allowed'; } catch (_) {}
                        return;
                    }
                    menu.innerHTML = safeItems.length
                        ? safeItems.map((d) => {
                            const did = String(d.deviceId || '');
                            const lab = formatDevLabel(String(d.label || 'Устройство'));
                            const active = did && did === cur ? ' active' : '';
                            return `<div class="cs-dd-item${active}" data-id="${durakEscapeDataAttr(did)}"><span class="cs-dd-item-label">${escapeHtml(lab)}</span>${active ? '<span>✓</span>' : ''}</div>`;
                        }).join('')
                        : `<div class="cs-dd-item active" data-id=""><span class="cs-dd-item-label">(по умолчанию)</span><span>✓</span></div>`;
                    const close = () => { try { dd.classList.remove('open'); } catch (_) {} };
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dd.classList.toggle('open');
                    };
                    menu.onclick = (e) => {
                        const item = e.target && e.target.closest ? e.target.closest('.cs-dd-item') : null;
                        if (!item) return;
                        const id = String(item.getAttribute('data-id') || '');
                        try { btn.querySelector('.cs-dd-label').textContent = labelOf(id); } catch (_) {}
                        close();
                        try { onSelect(id); } catch (_) {}
                    };
                    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
                };

                // Микрофоны
                buildDd({
                    mountId: 'csMicDd',
                    items: mics,
                    value: selectedMicDeviceId || (mics[0] && mics[0].deviceId) || '',
                    onSelect: (id) => switchMicDevice(id)
                });

                // Динамики (setSinkId)
                const supported = typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && typeof HTMLMediaElement.prototype.setSinkId === 'function';
                if (!supported) {
                    buildDd({
                        mountId: 'csSpkDd',
                        items: [],
                        value: '',
                        onSelect: () => {},
                        disabledLabel: '(не поддерживается браузером)'
                    });
                } else {
                    buildDd({
                        mountId: 'csSpkDd',
                        items: speakers,
                        value: selectedSpeakerDeviceId || (speakers[0] && speakers[0].deviceId) || '',
                        onSelect: (id) => {
                            switchSpeakerDevice(id);
                            showNotification('Устройства', 'Динамики переключены', 'success');
                        }
                    });
                }
            })();
        }

        function forceToggleRemoteVideo() {
            const targetId = currentContextTargetId;
            if (!targetId || !ws || ws.readyState !== WebSocket.OPEN) return;
            const state = getParticipantState(targetId);
            if (state.video) {
                ws.send(JSON.stringify({ type: 'force-video-off', targetId, from: userName, enabled: false }));
            } else {
                ws.send(JSON.stringify({ type: 'request-video', targetId, from: userName }));
                showNotification('Запрос отправлен', 'Пользователю отправлен запрос', 'info');
            }
            remoteVideo = !!state.video;
        }

        function forceToggleRemoteAudio() {
            const targetId = currentContextTargetId;
            if (!targetId || !ws || ws.readyState !== WebSocket.OPEN) return;
            const state = getParticipantState(targetId);
            if (state.audio) {
                ws.send(JSON.stringify({ type: 'force-audio-off', targetId, from: userName, enabled: false }));
                showNotification('Микрофон выключен', 'Вы выключили микрофон участнику', 'info');
            } else {
                ws.send(JSON.stringify({ type: 'request-audio', targetId, from: userName }));
                showNotification('Запрос отправлен', 'Пользователю отправлен запрос', 'info');
            }
            remoteAudio = !!state.audio;
        }

        function toggleAdmin() {
            const targetId = currentContextTargetId;
            if (!targetId || !ws || ws.readyState !== WebSocket.OPEN) return;
            const state = getParticipantState(targetId);
            if (window.remoteIsAdmin) {
                ws.send(JSON.stringify({ type: 'remove-admin', targetId, from: userName }));
                showNotification('Права', 'Снимаем администратора', 'info');
            } else {
                ws.send(JSON.stringify({ type: 'make-admin', targetId, from: userName }));
                showNotification('Права', `Назначаем админа: ${state.userName || 'участник'}`, 'info');
            }
        }

        function toggleParticipantsPanel() {
            const panel = document.querySelector('.participants-panel');
            if (panel) {
                panel.classList.toggle('open');
            }
        }

        function closeParticipantsPanel() {
            const panel = document.querySelector('.participants-panel');
            if (panel) {
                panel.classList.remove('open');
            }
        }

        function isMobileLayout() {
            return window.innerWidth <= 768;
        }

        function updateParticipantsResponsiveUI() {
            const closeBtn = document.getElementById('participantsCloseBtn');
            const panel = document.querySelector('.participants-panel');
            const isCompact = isMobileLayout();
            if (closeBtn) {
                closeBtn.style.display = isCompact ? 'inline-flex' : 'none';
            }
            if (!isCompact && panel) {
                panel.classList.remove('open');
            }
        }

        function canManageRoom() {
            return isCreator || isGuestAdmin;
        }

        function closeJoinPendingModal() {
            if (!joinPendingModal) return;
            try { joinPendingModal.remove(); } catch (_) {}
            joinPendingModal = null;
        }

        function showJoinPendingModal() {
            if (joinPendingModal) return;
            const modal = document.createElement('div');
            modal.className = 'request-modal';
            modal.innerHTML = `
                <div class="request-content">
                    <div style="font-size: 42px;"><i class="fas fa-user-lock"></i></div>
                    <h3>Эта комната приватная</h3>
                    <p>Ждем пока администратор впустит вас</p>
                    <div class="request-buttons">
                        <button class="request-btn cancel" id="privateJoinCancelBtn">Отмена</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            joinPendingModal = modal;
            const cancelBtn = modal.querySelector('#privateJoinCancelBtn');
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'cancel-join-request' }));
                    }
                    closeJoinPendingModal();
                    endCall();
                };
            }
        }

        function setRoomPrivacy(enabled) {
            if (!canManageRoom() || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'set-room-private', enabled: !!enabled }));
        }

        function toggleRoomPrivacy() {
            setRoomPrivacy(!roomIsPrivate);
            if (roomSettingsMenu) {
                try { roomSettingsMenu.remove(); } catch (_) {}
                roomSettingsMenu = null;
            }
        }

        function closeRoomForEveryone() {
            if (!canManageRoom() || !ws || ws.readyState !== WebSocket.OPEN) return;
            showCustomConfirm('Закрыть комнату', 'Завершить комнату для всех участников?', () => {
                ws.send(JSON.stringify({ type: 'close-room' }));
            });
            if (roomSettingsMenu) {
                try { roomSettingsMenu.remove(); } catch (_) {}
                roomSettingsMenu = null;
            }
        }

        function showRoomSettingsMenu(event) {
            event.preventDefault();
            event.stopPropagation();
            if (!canManageRoom()) return;
            if (roomSettingsMenu) {
                try { roomSettingsMenu.remove(); } catch (_) {}
                roomSettingsMenu = null;
            }
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            const rect = event.currentTarget.getBoundingClientRect();
            menu.innerHTML = `
                <div class="context-item" onclick="toggleRoomPrivacy()">
                    <i class="fas ${roomIsPrivate ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> Приватная комната: ${roomIsPrivate ? 'Вкл' : 'Выкл'}
                </div>
                <div class="divider"></div>
                <div class="context-item" onclick="closeRoomForEveryone()">
                    <i class="fas fa-door-closed"></i> Закрыть комнату
                </div>
            `;
            document.body.appendChild(menu);
            placeContextMenu(menu, rect.right - menu.offsetWidth, rect.bottom + 8, rect.top - 8);
            roomSettingsMenu = menu;
            const removeMenu = () => {
                if (!roomSettingsMenu) return;
                try { roomSettingsMenu.remove(); } catch (_) {}
                roomSettingsMenu = null;
            };
            setTimeout(() => document.addEventListener('click', removeMenu, { once: true }), 0);
        }

        function approveJoinRequest(requestId) {
            if (!requestId || !canManageRoom() || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'approve-join-request', requestId }));
            pendingJoinRequests = pendingJoinRequests.filter((item) => item.id !== requestId);
            updateUI();
        }

        function rejectJoinRequest(requestId) {
            if (!requestId || !canManageRoom() || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'reject-join-request', requestId }));
            pendingJoinRequests = pendingJoinRequests.filter((item) => item.id !== requestId);
            updateUI();
        }

        function handleMessage(e) {
            const data = JSON.parse(e.data);
            applyIceServersFromPayload(data);
            const fromId = data.fromId;
            const fromName = data.from;

            switch (data.type) {
                case 'messenger-sync':
                    loadMessengerNotifications();
                    if (data.selfProfile && typeof data.selfProfile === 'object') {
                        const nextName = typeof data.selfProfile.name === 'string'
                            ? String(data.selfProfile.name || '').trim()
                            : '';
                        const nextAvatar = typeof data.selfProfile.avatar === 'string'
                            ? proxifyAvatarUrl(data.selfProfile.avatar || '')
                            : '';
                        const nextCoverUrl = typeof data.selfProfile.coverUrl === 'string'
                            ? proxifyAvatarUrl(data.selfProfile.coverUrl || '')
                            : '';
                        const syncPrivacy = data.selfProfile.privacy && typeof data.selfProfile.privacy === 'object'
                            ? data.selfProfile.privacy
                            : {};
                        const nextAppearance = data.selfProfile.appearance && typeof data.selfProfile.appearance === 'object'
                            ? data.selfProfile.appearance
                            : null;
                        if (nextAppearance) {
                            const nextTheme = String(nextAppearance.theme || '').trim() === 'dark' ? 'dark' : 'classic';
                            const nextWallpaper = typeof nextAppearance.chatWallpaper === 'string' ? String(nextAppearance.chatWallpaper || '').trim() : '';
                            const nextBlur = nextAppearance.chatWallpaperBlur !== undefined ? !!nextAppearance.chatWallpaperBlur : true;
                            messengerAppearance = {
                                ...messengerAppearance,
                                theme: nextTheme,
                                chatWallpaper: nextWallpaper,
                                chatWallpaperBlur: nextBlur
                            };
                            applyMessengerTheme();
                        }
                        messengerProfile = {
                            ...messengerProfile,
                            username: typeof data.selfProfile.username === 'string'
                                ? ensureGeneratedMessengerUsername(data.selfProfile.username || '', authProfile?.appUserId || appUserId)
                                : messengerProfile.username,
                            statusText: typeof data.selfProfile.statusText === 'string'
                                ? String(data.selfProfile.statusText || '').trim()
                                : messengerProfile.statusText,
                            privacy: {
                                canWrite: ['all', 'friends', 'nobody'].includes(syncPrivacy.canWrite) ? syncPrivacy.canWrite : (messengerProfile.privacy?.canWrite || 'all'),
                                canCall: ['all', 'friends', 'nobody'].includes(syncPrivacy.canCall) ? syncPrivacy.canCall : (messengerProfile.privacy?.canCall || 'all'),
                                canViewProfile: ['all', 'friends', 'nobody'].includes(syncPrivacy.canViewProfile) ? syncPrivacy.canViewProfile : (messengerProfile.privacy?.canViewProfile || 'all'),
                                canSeeStories: ['all', 'friends', 'nobody'].includes(syncPrivacy.canSeeStories) ? syncPrivacy.canSeeStories : (messengerProfile.privacy?.canSeeStories || 'friends'),
                                canJoinGroups: ['all', 'friends', 'nobody'].includes(syncPrivacy.canJoinGroups) ? syncPrivacy.canJoinGroups : (messengerProfile.privacy?.canJoinGroups || 'friends')
                            },
                            blacklist: Array.isArray(data.selfProfile.blacklist)
                                ? data.selfProfile.blacklist.map((v) => String(v || '').trim()).filter(Boolean)
                                : (Array.isArray(messengerProfile.blacklist) ? messengerProfile.blacklist : [])
                        };
                        persistMessengerProfileLocal();
                        if (authProfile?.appUserId) {
                            const prevName = String(authProfile.name || '').trim();
                            const prevAvatar = proxifyAvatarUrl(authProfile.avatar || '');
                            const mergedProfile = {
                                ...authProfile,
                                name: nextName || prevName || authProfile.appUserId,
                                avatar: nextAvatar || prevAvatar || '',
                                coverUrl: nextCoverUrl || authProfile.coverUrl || ''
                            };
                            saveProfile(mergedProfile);
                            if ((nextName && nextName !== prevName) || (nextAvatar && nextAvatar !== prevAvatar)) {
                                registerFriendsAccount().catch(() => {});
                            }
                        }
                    }
                    // JSON API работает всегда, нет ошибок хранения
                    (friendsState.friends || []).forEach((f) => {
                        if (!f?.id) return;
                        applyMessengerPeerHint(
                            f.id,
                            f.displayName || f.name || '',
                            f.avatar || '',
                            f.initials || ''
                        );
                    });
                    messengerChats = mergeMessengerChatsWithHints(Array.isArray(data.chats) ? data.chats : []);
                    hydrateMessengerHintsFromChats(messengerChats);
                    {
                        let savedChat = '';
                        let savedPeer = '';
                        try {
                            savedChat = String(sessionStorage.getItem(MESSENGER_SESSION_CHAT_KEY) || '').trim();
                            savedPeer = String(sessionStorage.getItem(MESSENGER_SESSION_PEER_KEY) || '').trim();
                        } catch (_) {}
                        if (!messengerActiveChatId && !messengerActivePeerId && !savedPeer && !savedChat && messengerChats.length) {
                            messengerActiveChatId = messengerChats[0].id || '';
                            messengerActivePeerId = messengerChats[0].kind === 'group' ? '' : (messengerChats[0].peer?.id || '');
                        }
                    }
                    if (messengerActiveChatId && !messengerChats.some((c) => c.id === messengerActiveChatId)) {
                        // Для прямых чатов (dm:...) не сбрасываем выбор, так как они могут быть восстановлены
                        const isDirectChat = String(messengerActiveChatId || '').startsWith('dm:');
                        if (!isDirectChat) {
                            messengerActiveChatId = '';
                            messengerActivePeerId = '';
                            persistMessengerSessionChat('');
                            persistMessengerSessionPeer('');
                        }
                    }
                    if (messengerActiveChatId && getMessengerSocketReady()) {
                        const openPayload = { type: 'messenger-open-chat', chatId: messengerActiveChatId };
                        if (String(messengerActiveChatId || '').startsWith('dm:')) {
                            const peerId = String(messengerActivePeerId || '').trim()
                                || parsePeerIdFromDirectChatId(messengerActiveChatId, authProfile?.appUserId || '');
                            if (peerId) openPayload.withUserId = peerId;
                        }
                        sendMessengerEvent(openPayload);
                    }
                    if (shouldRenderMessengerUi()) renderMainScreen();
                    break;
                case 'messenger-presence':
                    if (data.userId == null) break;
                    applyMessengerPresencePatch(data.userId, data.online, data.lastSeenAt);
                    if (shouldRenderMessengerUi() && !shouldDeferTransientMessengerRender()) renderMainScreen();
                    break;
                case 'messenger-compose-status':
                    {
                        if (!data.chatId) break;
                        // Применяем только к активному открытому чату, чтобы не было «переброса» интерфейса.
                        if (messengerActiveChatId !== data.chatId) break;
                        if (data.withUserId && String(messengerActivePeerId || '') !== String(data.withUserId || '')) break;
                        messengerComposeBlocked = !!data.composeBlocked;
                        messengerComposeHint = String(data.composeHint || '');
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-profile-patch':
                    {
                        const tid = data.targetUserId;
                        const prof = data.profile;
                        if (!tid || !prof) break;
                        applyMessengerPeerHint(tid, prof.displayName, prof.avatar, prof.initials, prof.username, prof.statusText, prof.name);
                        messengerProfileOverrides.set(String(tid), {
                            displayName: prof.displayName,
                            name: prof.name || prof.displayName,
                            avatar: prof.avatar,
                            coverUrl: prof.coverUrl || '',
                            initials: prof.initials,
                            username: prof.username || '',
                            statusText: prof.statusText || ''
                        });
                        messengerChats = mergeMessengerChatsWithHints(messengerChats);
                        if (Array.isArray(friendsState.friends)) {
                            friendsState.friends = friendsState.friends.map((f) => {
                                if (String(f.id) !== String(tid)) return f;
                                return {
                                    ...f,
                                    name: prof.name || prof.displayName || f.name,
                                    displayName: prof.displayName || prof.name || f.displayName,
                                    avatar: prof.avatar || f.avatar,
                                    username: prof.username || f.username || '',
                                    statusText: prof.statusText || f.statusText || '',
                                    initials: prof.initials || f.initials
                                };
                            });
                        }
                        if (Array.isArray(friendsSearchResults)) {
                            friendsSearchResults = friendsSearchResults.map((f) => {
                                if (String(f.id) !== String(tid)) return f;
                                return {
                                    ...f,
                                    name: prof.name || prof.displayName || f.name,
                                    displayName: prof.displayName || prof.name || f.displayName,
                                    avatar: prof.avatar || f.avatar,
                                    username: prof.username || f.username || '',
                                    statusText: prof.statusText || f.statusText || '',
                                    initials: prof.initials || f.initials || ''
                                };
                            });
                        }
                        if (messengerViewedProfile?.profile && String(messengerViewedProfile.profile.id || '') === String(tid)) {
                            messengerViewedProfile = {
                                ...messengerViewedProfile,
                                profile: {
                                    ...messengerViewedProfile.profile,
                                    displayName: prof.displayName,
                                    name: prof.name || prof.displayName,
                                    avatar: prof.avatar,
                                    coverUrl: prof.coverUrl || '',
                                    username: prof.username,
                                    statusText: prof.statusText
                                }
                            };
                        }
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-username-status':
                    {
                        const input = document.getElementById('profileUsernameInput');
                        const statusEl = document.getElementById('profileUsernameStatus');
                        if (!input || !statusEl) break;
                        const current = String(input.value || '').replace(/^@+/, '').trim().toLowerCase();
                        const checked = String(data.username || '').trim().toLowerCase();
                        if (current !== checked) break;
                        const hasValue = !!checked;
                        const available = !!data.available;
                        profileUsernameLastChecked = checked;
                        profileUsernameLastAvailable = available || !hasValue;
                        statusEl.dataset.state = hasValue ? (available ? 'ok' : 'taken') : 'idle';
                        statusEl.textContent = !hasValue ? 'Введите username' : (available ? 'Username свободен' : 'Username уже занят');
                    }
                    break;
                case 'messenger-chat-history':
                    if (!data.chatId) break;
                    messengerActiveChatId = data.chatId;
                    messengerActivePeerId = data.withUserId || '';
                    persistMessengerSessionChat(data.chatId);
                    if (data.withUserId) persistMessengerSessionPeer(data.withUserId);
                    else persistMessengerSessionPeer('');
                    const msgs = Array.isArray(data.messages) ? data.messages : [];
                    {
                        if (data.chat && String(data.chat.kind || '') === 'group') {
                            const groupChat = buildGroupChatClientModel(data.chat);
                            if (groupChat) {
                                const idxChat = messengerChats.findIndex((item) => String(item?.id || '') === String(data.chatId || ''));
                                const existingChat = idxChat >= 0 ? messengerChats[idxChat] : null;
                                if (existingChat) {
                                    groupChat.lastMessage = existingChat.lastMessage;
                                    messengerChats[idxChat] = groupChat;
                                } else {
                                    messengerChats.unshift(groupChat);
                                }
                            }
                        }
                        // Важно: пришедшая история с сервера перетирает локальные флаги.
                        // Нам нужно сохранить delivered/read для исходящих сообщений,
                        // чтобы галочки не исчезали после messenger-sync.
                        const prevMsgs = messengerMessages.get(data.chatId) || [];
                        const prevById = new Map();
                        if (Array.isArray(prevMsgs)) {
                            prevMsgs.forEach((pm) => {
                                if (!pm || !pm.id) return;
                                prevById.set(String(pm.id), pm);
                            });
                        }
                        hydrateMessengerHintsFromMessages(msgs);
                        if (data.chat && String(data.chat.kind || '') === 'group') {
                            hydrateMessengerHintsFromChats([data.chat]);
                        }
                        const merged = msgs.map((m) => {
                            if (!m || !m.id) return m;
                            const pm = prevById.get(String(m.id));
                            if (!pm) return m;
                            const out = { ...m };
                            if (typeof pm.delivered === 'boolean') out.delivered = pm.delivered;
                            if (typeof pm.read === 'boolean') out.read = pm.read;
                            // Серверная история — это уже доставленные сообщения.
                            out.uploading = false;
                            delete out.uploadProgress;
                            return out;
                        });
                        messengerMessages.set(data.chatId, merged);
                        syncChatLastMessagePreviewFromMessages(data.chatId);
                        messengerChats = mergeMessengerChatsWithHints(messengerChats);
                    }
                    messengerComposeBlocked = !!data.composeBlocked;
                    messengerComposeHint = String(data.composeHint || '');
                    // Когда пользователь открыл диалог — помечаем входящие сообщения как "прочитано",
                    // иначе read-гистограмма появляется только для новых сообщений, но не для уже загруженных.
                    try {
                        const myId = String(authProfile?.appUserId || '');
                        const shouldMarkRead = messengerView === 'chats' && String(messengerActiveChatId || '') === String(data.chatId || '');
                        if (shouldMarkRead && myId) {
                            msgs.forEach((m) => {
                                if (!m || !m.id) return;
                                if (String(m.fromId || '') === myId) return; // мои сообщения не помечаем
                                const mid = String(m.id);
                                if (messengerReadAckedMessageIds.has(mid)) return;
                                messengerReadAckedMessageIds.add(mid);
                                sendMessengerEvent({
                                    type: 'messenger-message-read',
                                    chatId: data.chatId,
                                    messageId: mid,
                                    senderId: String(m.fromId || '')
                                });
                            });
                        }
                    } catch (_) {}
                    if (shouldRenderMessengerUi()) renderMainScreen();
                    break;
                case 'messenger-message':
                    if (!data.chatId || !data.message) break;
                    {
                        const m = data.message;
                        const myId = String(authProfile?.appUserId || '');
                        const chatId = data.chatId;
                        const isMine = String(m.fromId || '') === myId;
                        const isActiveChat = String(messengerActiveChatId || '') === String(chatId || '');
                        if (m.fromId) {
                            applyMessengerPeerHint(m.fromId, m.senderDisplayName, m.senderAvatar, m.senderInitials);
                            messengerChats = mergeMessengerChatsWithHints(messengerChats);
                        }
                        const prev = messengerMessages.get(data.chatId) || [];
                        const next = [...prev];
                        const idx = next.findIndex((item) => item && item.id && item.id === m.id);
                        if (idx >= 0) {
                            next[idx] = {
                                ...next[idx],
                                ...m,
                                uploading: false,
                                delivered: isMine ? true : next[idx]?.delivered || false,
                                read: isMine ? (next[idx]?.read || false) : next[idx]?.read
                            };
                        } else {
                            next.push({
                                ...m,
                                uploading: false,
                                delivered: isMine ? true : false
                            });
                        }
                        // Непрочитанные / read-ack для входящих сообщений.
                        if (!isMine && m.id) {
                            if (messengerView === 'chats' && isActiveChat) {
                                const key = String(m.id || '');
                                if (!messengerReadAckedMessageIds.has(key)) {
                                    messengerReadAckedMessageIds.add(key);
                                    sendMessengerEvent({
                                        type: 'messenger-message-read',
                                        chatId,
                                        messageId: String(m.id || ''),
                                        senderId: String(m.fromId || '')
                                    });
                                }
                            } else {
                                const mid = String(m.id || '');
                                if (!messengerUnreadMessageIds.has(mid)) {
                                    messengerUnreadMessageIds.add(mid);
                                    const prevCnt = getMessengerUnreadForChat(chatId);
                                    setMessengerUnreadForChat(chatId, prevCnt + 1);
                                    updateCallMinimizeUnreadBadge();
                                }
                            }
                        }

                        // ПОВЕДЕНИЕ СКРОЛЛА И КНОПКИ "ВНИЗ" В ЭТОМ ДИАЛОГЕ:
                        // 1) если ты отправил сам — всегда едем вниз
                        // 2) если пришло от собеседника — если ты не снизу, показываем кнопку с бейджем
                        //    (и не дёргаем скролл).
                        let nearBottom = true;
                        if (messengerView === 'chats' && isActiveChat) {
                            const dist = getChatHistoryDistFromBottom();
                            nearBottom = dist < 80;
                            if (isMine) {
                                messengerNewWhileScrolledCount = 0;
                                updateMessengerNewWhileScrolledFabUI();
                                messengerShouldAutoScroll = true;
                            } else if (!nearBottom) {
                                messengerNewWhileScrolledCount = Math.max(0, messengerNewWhileScrolledCount) + 1;
                                updateMessengerNewWhileScrolledFabUI();
                                messengerShouldAutoScroll = false;
                            } else {
                                messengerNewWhileScrolledCount = 0;
                                updateMessengerNewWhileScrolledFabUI();
                                messengerShouldAutoScroll = true;
                            }
                        }
                        if (!isMine && isGroupMessengerChat(findMessengerChatById(chatId)) && doesMessageMentionMe(m.text || '')) {
                            recordMessengerMention(chatId, m);
                            if (messengerView === 'chats' && isActiveChat) {
                                if (!nearBottom) {
                                    const key = String(chatId || '').trim();
                                    const prevMentions = messengerPendingMentionIdsByChat.get(key) || [];
                                    messengerPendingMentionIdsByChat.set(key, [...prevMentions, String(m.id || '')].filter(Boolean).slice(-99));
                                    messengerMentionWhileScrolledCount = Math.max(0, Number(messengerMentionWhileScrolledCount) || 0) + 1;
                                    updateMessengerMentionFabUI();
                                } else {
                                    const key = String(chatId || '').trim();
                                    messengerPendingMentionIdsByChat.delete(key);
                                    messengerMentionWhileScrolledCount = 0;
                                    updateMessengerMentionFabUI();
                                }
                            }
                        }
                        if (!isMine) {
                            const systemNotification = buildSystemNotificationFromMessage(chatId, m);
                            if (systemNotification) pushMessengerNotification(systemNotification);
                        }
                        if (isMine && m.id) {
                            for (let i = next.length - 1; i >= 0; i -= 1) {
                                const row = next[i];
                                if (!row || !row.uploading || String(row.fromId || '') !== myId) continue;
                                if (String(row.id || '') === String(m.id || '')) continue;
                                if (String(row.text || '') === String(m.text || '') && Math.abs(Number(row.createdAt || 0) - Number(m.createdAt || 0)) < 60000) {
                                    next.splice(i, 1);
                                }
                            }
                        }
                        messengerMessages.set(data.chatId, next.slice(-300));
                        syncChatLastMessagePreviewFromMessages(chatId);
                        if (
                            shouldRenderMessengerUi() &&
                            String(data.message.fromId || '') !== String(authProfile?.appUserId || '')
                        ) {
                            playIncomingMessengerSound();
                        }
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-group-created':
                    if (data.chat?.id) {
                        upsertGroupChatModel(data.chat);
                        hydrateMessengerHintsFromChats([data.chat]);
                        if (!messengerActiveChatId || String(data.chat.createdBy || '') === String(authProfile?.appUserId || '')) {
                            messengerActiveChatId = data.chat.id;
                            messengerActivePeerId = '';
                            persistMessengerSessionChat(data.chat.id);
                            if (shouldRenderMessengerUi()) renderMainScreen();
                            sendMessengerEvent({ type: 'messenger-open-chat', chatId: data.chat.id });
                        }
                    }
                    break;
                case 'messenger-group-updated':
                    if (data.chat?.id) {
                        upsertGroupChatModel(data.chat);
                        hydrateMessengerHintsFromChats([data.chat]);
                        if (String(messengerActiveChatId || '') === String(data.chat.id || '')) {
                            const openChat = findMessengerChatById(data.chat.id);
                            if (openChat && isGroupMessengerChat(openChat)) {
                                messengerComposeBlocked = !!openChat.group?.restriction;
                                messengerComposeHint = getGroupRestrictionHintClient(openChat.group?.restriction);
                            }
                        }
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-group-call-created':
                case 'messenger-group-call-ended':
                    if (data.chatId) {
                        if (getMessengerSocketReady()) {
                            sendMessengerEvent({ type: 'messenger-open-chat', chatId: data.chatId });
                        }
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-group-call-ready':
                    if (!data.roomId || !data.chatId) break;
                    {
                        const activeChat = findMessengerChatById(data.chatId);
                        createRoom({
                            silent: true,
                            fixedRoomId: String(data.roomId || ''),
                            groupChatId: String(data.chatId || ''),
                            groupCallAllowedUserIds: Array.isArray(data.members) ? data.members : (activeChat?.group?.members || []),
                            groupTitle: activeChat?.peer?.displayName || activeChat?.peer?.name || 'Групповой звонок'
                        }).catch((error) => {
                            showNotification('Звонок', error?.message || 'Не удалось создать групповой звонок', 'error');
                        });
                    }
                    break;
                case 'messenger-group-left':
                    if (data.chatId && String(messengerActiveChatId || '') === String(data.chatId || '')) {
                        messengerActiveChatId = '';
                        messengerActivePeerId = '';
                        persistMessengerSessionChat('');
                        persistMessengerSessionPeer('');
                    }
                    if (shouldRenderMessengerUi()) renderMainScreen();
                    break;
                case 'messenger-group-joined':
                    if (data.chat?.id) {
                        upsertGroupChatModel(data.chat);
                        hydrateMessengerHintsFromChats([data.chat]);
                        messengerActiveChatId = data.chat.id;
                        messengerActivePeerId = '';
                        persistMessengerSessionChat(data.chat.id);
                        persistMessengerSessionPeer('');
                        sendMessengerEvent({ type: 'messenger-open-chat', chatId: data.chat.id });
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-group-invite-preview':
                    if (data.chat?.id) {
                        openGroupInvitePreviewModal(data.chat, data.inviteCode || '', !!data.canJoin);
                    }
                    break;
                case 'messenger-message-receipt':
                    {
                        if (!data.chatId || !data.messageId) break;
                        const chatId = data.chatId;
                        const msgId = String(data.messageId || '');
                        const receipt = String(data.receipt || '');
                        const prev = messengerMessages.get(chatId) || [];
                        const next = prev.map((it) => {
                            if (!it || String(it.id || '') !== msgId) return it;
                            if (receipt === 'read') {
                                const rb = Array.isArray(it.readBy) ? it.readBy.map((x) => String(x)) : [];
                                const add = String(data.readBy || '').trim();
                                const nextRb = add ? Array.from(new Set([...rb, add])) : rb;
                                return { ...it, read: true, delivered: true, readBy: nextRb };
                            }
                            return { ...it };
                        });
                        messengerMessages.set(chatId, next);
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-chat-deleted':
                    if (data.chatId) {
                        messengerMessages.delete(data.chatId);
                        if (String(data.scope || '') === 'all' && messengerActiveChatId === data.chatId) {
                            messengerActiveChatId = '';
                            messengerActivePeerId = '';
                            persistMessengerSessionPeer('');
                        }
                    }
                    if (shouldRenderMessengerUi()) renderMainScreen();
                    break;
                case 'messenger-message-updated':
                    if (!data.chatId || !data.message?.id) break;
                    {
                        const m = data.message;
                        if (m.fromId) {
                            applyMessengerPeerHint(m.fromId, m.senderDisplayName, m.senderAvatar, m.senderInitials);
                            messengerChats = mergeMessengerChatsWithHints(messengerChats);
                        }
                        const prev = messengerMessages.get(data.chatId) || [];
                        messengerMessages.set(data.chatId, prev.map((item) => item.id === m.id ? m : item));
                        syncChatLastMessagePreviewFromMessages(data.chatId);
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-message-deleted':
                    if (!data.chatId || !data.messageId) break;
                    {
                        const prev = messengerMessages.get(data.chatId) || [];
                        messengerMessages.set(
                            data.chatId,
                            prev.filter((item) => item.id !== data.messageId)
                        );
                        syncChatLastMessagePreviewFromMessages(data.chatId);
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-message-reactions':
                    if (!data.chatId || !data.messageId || !data.reactions) break;
                    {
                        const prev = messengerMessages.get(data.chatId) || [];
                        const prevMessage = prev.find((it) => it && String(it.id || '') === String(data.messageId || '')) || null;
                        const next = prev.map((it) => {
                            if (!it || String(it.id || '') !== String(data.messageId || '')) return it;
                            return { ...it, reactions: data.reactions };
                        });
                        if (prevMessage) {
                            recordMessengerReactionNotifications(data.chatId, data.messageId, prevMessage, data.reactions);
                        }
                        messengerMessages.set(data.chatId, next);
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                    break;
                case 'messenger-typing':
                    if (!data.fromUserId) break;
                    {
                        const fromId = String(data.fromUserId || '').trim();
                        if (!fromId) break;
                        const activity = String(data.activity || '').trim() === 'voice' ? 'voice' : 'text';
                        const isTyping = !!data.isTyping;
                        const chatId = String(data.chatId || '').trim();
                        const withUserId = String(data.withUserId || '').trim();
                        if (isTyping) {
                            messengerTypingByUser.set(fromId, {
                                isTyping: true,
                                activity,
                                ts: Date.now(),
                                chatId,
                                withUserId
                            });
                        }
                        else messengerTypingByUser.delete(fromId);
                        const prevTimer = messengerTypingTimersByUser.get(fromId);
                        if (prevTimer) clearTimeout(prevTimer);
                        if (isTyping) {
                            messengerTypingTimersByUser.set(
                                fromId,
                                setTimeout(() => {
                                    messengerTypingByUser.delete(fromId);
                                    messengerTypingTimersByUser.delete(fromId);
                                    if (shouldRenderMessengerUi() && !shouldDeferTransientMessengerRender()) renderMainScreen();
                                }, 2600)
                            );
                        } else {
                            messengerTypingTimersByUser.delete(fromId);
                        }
                    }
                    if (shouldRenderMessengerUi() && !shouldDeferTransientMessengerRender()) {
                        clearTimeout(messengerUiTypingTimer);
                        messengerUiTypingTimer = setTimeout(() => {
                            messengerUiTypingTimer = null;
                            const ae = document.activeElement;
                            if (messengerView === 'chats' && ae && ae.id === 'chatComposerInput') return;
                            renderMainScreen();
                        }, 240);
                    }
                    break;
                case 'messenger-error':
                    if (['save_failed', 'write_forbidden', 'group_edit_forbidden', 'group_settings_forbidden', 'invite_taken'].includes(String(data.code || ''))) {
                        // Убираем pending-сообщение, если оно было.
                        // Поскольку сервер может не отправить финальное сообщение при ошибке,
                        // проще всего зачистить все локальные uploading:true по отправителю.
                        try {
                            const chatId = messengerActiveChatId;
                            const myId = String(authProfile?.appUserId || '');
                            if (chatId && myId) {
                                const prev = messengerMessages.get(chatId) || [];
                                messengerMessages.set(
                                    chatId,
                                    prev.filter((m) => !(m && m.uploading && String(m.fromId || '') === myId))
                                );
                            }
                        } catch (_) {}
                    }
                    showNotification('Мессенджер', data.message || 'Ошибка мессенджера', 'warning');
                    break;
                case 'messenger-profile':
                    messengerViewedProfile = {
                        ...(data.view || {}),
                        targetUserId: data.targetUserId || (data.view && data.view.profile && data.view.profile.id) || ''
                    };
                    if (shouldRenderMessengerUi()) renderMainScreen();
                    break;
                case 'messenger-stories':
                    if (data.targetUserId && data.stories) {
                        const ownerId = String(data.targetUserId || '').trim();
                        stories.set(ownerId, data.stories);
                        const viewedProfileId = String(messengerViewedProfile?.targetUserId || messengerViewedProfile?.profile?.id || '').trim();
                        const shouldRefreshProfileView =
                            messengerView === 'profile' &&
                            (
                                ownerId === String(authProfile?.appUserId || '') ||
                                ownerId === viewedProfileId
                            );
                        if (shouldRenderMessengerUi()) {
                            if (shouldRefreshProfileView) renderMainScreen();
                            else renderStories();
                        }
                    }
                    break;
                case 'messenger-story-uploaded':
                    showNotification('', 'История опубликована', 'success');
                    loadStories(); // Reload stories
                    break;
                case 'messenger-story-deleted':
                    showNotification('', 'История удалена', 'info');
                    loadStories(); // Reload stories
                    break;
                case 'messenger-story-privacy-updated':
                    showNotification('', 'Приватность публикации сохранена', 'success');
                    loadStories();
                    break;
                case 'messenger-story-state-changed':
                    handleRemoteStoryStateChange(data.ownerUserId);
                    break;
                case 'messenger-story-like-result':
                    if (data.storyId && data.liked !== undefined) {
                        const likeBtn = document.getElementById('storyLikeBtn');
                        if (likeBtn) {
                            if (data.liked) {
                                likeBtn.classList.add('liked');
                            } else {
                                likeBtn.classList.remove('liked');
                            }
                        }
                    }
                    break;
                case 'messenger-story-comment-result':
                    if (data.storyId) {
                        const input = document.getElementById('storyReplyInput');
                        if (input) input.value = '';
                        showNotification('', 'Комментарий добавлен', 'success');
                    }
                    break;
                case 'messenger-story-like-status':
                    if (data.storyId && data.liked !== undefined) {
                        const likeBtn = document.getElementById('storyLikeBtn');
                        if (likeBtn) {
                            if (data.liked) {
                                likeBtn.classList.add('liked');
                            } else {
                                likeBtn.classList.remove('liked');
                            }
                        }
                    }
                    break;
                case 'messenger-story-views':
                    if (data.storyId && data.views) {
                        showStoryViewsModal(data.views);
                    }
                    break;
                case 'signal':
                case 'video-signal':
                    {
                        const peerKey = `av-${fromId}`;
                        let vPeer = peers.get(peerKey);
                        if (!vPeer) {
                            vPeer = createPeer(localStream, 'video', false, fromId, fromName);
                            peers.set(peerKey, vPeer);
                        }
                        if (vPeer && !vPeer.destroyed) vPeer.signal(data.signal);
                    }
                    break;

                case 'screen-signal':
                    {
                        const connId = data.connId || null;
                        let peerKey = connId ? screenConnMap.get(connId) : null;
                        let sPeer = peerKey ? peers.get(peerKey) : null;

                        if (!sPeer) {
                            if (data.signal && data.signal.type === 'offer') {
                                peerKey = connId ? `screen-remote-${fromId}-${connId}` : `screen-remote-${fromId}`;
                                sPeer = peers.get(peerKey);
                                if (!sPeer) {
                                    sPeer = createPeer(null, 'screen', false, fromId, fromName, connId);
                                    peers.set(peerKey, sPeer);
                                }
                                if (connId) screenConnMap.set(connId, peerKey);
                            } else {
                                const localPeerKey = `screen-local-${fromId}`;
                                sPeer = peers.get(localPeerKey);
                                if (!sPeer) return;
                                if (connId) screenConnMap.set(connId, localPeerKey);
                            }
                        }
                        if (sPeer && !sPeer.destroyed) sPeer.signal(data.signal);
                    }
                    break;

                case 'created':
                case 'joined':
                    isConnected = true;
                    myId = data.myId;
                    ownerId = data.ownerId || ownerId;
                    closeJoinPendingModal();
                    updateCreatorFlag();
                    const waitingMsg0 = document.getElementById('waitingMsg');
                    if (waitingMsg0) waitingMsg0.style.display = 'none';
                    syncLocalMediaStateToServer();
                    healRemoteAudioLinks();
                    setTimeout(healRemoteAudioLinks, 700);
                    setTimeout(healRemoteAudioLinks, 1800);
                    startCallAudioHealTimer();
                    updateUI();
                    updateEmptyState();
                    break;

                case 'room-state':
                    {
                        isConnected = true;
                        myId = data.myId || myId;
                        ownerId = data.ownerId || ownerId;
                        participants.clear();
                        participantAvatars.clear();
                        participantStates.clear();
                        participantConnectionQuality.clear();
                        connectionNoticeCooldown.clear();
                        audioRecoverCooldown.clear();
                        const list = Array.isArray(data.participants) ? data.participants : [];
                        list.forEach((p) => upsertParticipantState(p));
                        const myState = participantStates.get(myId);
                        if (myState) {
                            isGuestAdmin = !!myState.isAdmin && String(ownerId ?? '') !== String(myId ?? '');
                        } else {
                            isGuestAdmin = false;
                        }
                        updateCreatorFlag();
                        updatePrimaryRemoteState();
                        watchPartyState = data.watchParty || null;
                        roomIsPrivate = !!data.isPrivate;
                        pendingJoinRequests = Array.isArray(data.pendingJoinRequests) ? data.pendingJoinRequests : [];
                        renderWatchPartyTile();
                        getRemoteParticipantIds().forEach((participantId) => {
                            ensureAvPeerForParticipant(participantId, shouldInitiatePeer(myId, participantId));
                            syncRemoteAudioPlayback(participantId);
                        });
                        syncLocalMediaStateToServer();
                        healRemoteAudioLinks();
                        setTimeout(healRemoteAudioLinks, 700);
                        setTimeout(healRemoteAudioLinks, 1800);
                        startCallAudioHealTimer();
                        const waitingMsgState = document.getElementById('waitingMsg');
                        if (waitingMsgState) waitingMsgState.style.display = 'none';
                        updateUI();
                        updateEmptyState();
                    }
                    break;

                case 'watch-started':
                    watchPartyState = data.watchParty || null;
                    renderWatchPartyTile();
                    updateUI();
                    if (watchPartyState?.ownerName) {
                        showNotification('Совместный просмотр', `${watchPartyState.ownerName} запустил просмотр`, 'info');
                    }
                    break;

                case 'join-pending':
                    showJoinPendingModal();
                    showNotification('Приватная комната', 'Ожидаем подтверждения администратора', 'info');
                    break;

                case 'error':
                    {
                        const message = data.message || 'Ошибка подключения';
                        showNotification('Комната', message, 'warning');
                        if (roomId) {
                            endCall(false);
                        }
                    }
                    break;

                case 'join-request':
                    {
                        const request = data.request || null;
                        if (!request || !request.id) break;
                        const existingIdx = pendingJoinRequests.findIndex((item) => item.id === request.id);
                        if (existingIdx >= 0) {
                            pendingJoinRequests[existingIdx] = request;
                        } else {
                            pendingJoinRequests.push(request);
                        }
                        updateUI();
                        showNotification('Заявка', `${request.userName || 'Участник'} хочет войти`, 'info');
                    }
                    break;

                case 'join-request-cancelled':
                    {
                        const requestId = data.requestId || '';
                        if (!requestId) break;
                        pendingJoinRequests = pendingJoinRequests.filter((item) => item.id !== requestId);
                        updateUI();
                    }
                    break;

                case 'join-rejected':
                    closeJoinPendingModal();
                    showNotification('Приватная комната', 'Администратор отклонил запрос на вход', 'warning');
                    endCall(false);
                    break;

                case 'room-privacy-updated':
                    roomIsPrivate = !!data.enabled;
                    updateUI();
                    showNotification('Комната', roomIsPrivate ? 'Приватный режим включен' : 'Приватный режим выключен', 'info');
                    break;

                case 'watch-stopped':
                    watchPartyState = null;
                    removeWatchPartyTile();
                    updateUI();
                    showNotification('Совместный просмотр', 'Просмотр остановлен', 'info');
                    break;

                case 'durak-state': {
                    const prevDurak = durakGameState;
                    const wasDurakPlaying = prevDurak && prevDurak.phase === 'playing';
                    durakGameState = data.game;
                    // Sync card pack from server
                    if (data.game && data.game.cardPack) {
                        durakCardPack = data.game.cardPack;
                        updateDurakCardBackStyle();
                    }
                    if (data.game && data.game.phase === 'ended' && wasDurakPlaying) {
                        durakNotifyGameEnded(data.game);
                    }
                    renderDurakUi();
                    break;
                }

                case 'durak-error':
                    showNotification('Дурак', data.message || 'Ошибка', 'warning');
                    break;

                case 'guest-joined':
                    const guest = data.guest || {
                        id: data.guestId,
                        userName: data.guestName,
                        userAvatar: data.guestAvatar || '',
                        video: data.guestVideo,
                        audio: data.guestAudio,
                        screen: false,
                        isAdmin: false,
                        appUserId: data.guestAppUserId || ''
                    };
                    if (outgoingFriendCallSession && !outgoingFriendCallSession.answered) {
                        const joinedAppUserId = String(guest.appUserId || '').trim();
                        if (!outgoingFriendCallSession.targetId || (joinedAppUserId && joinedAppUserId === outgoingFriendCallSession.targetId)) {
                            acceptOutgoingFriendCallSession();
                        }
                    }
                    if (data.ownerId) ownerId = data.ownerId;
                    upsertParticipantState(guest);
                    updateCreatorFlag();
                    updatePrimaryRemoteState();
                    isConnected = true;

                    const joinedId = guest.id;
                    if (joinedId && joinedId !== myId) {
                        const targetId = joinedId;
                        const state = getParticipantState(targetId);
                        ensureAvPeerForParticipant(targetId, shouldInitiatePeer(myId, targetId));

                        if (isScreenSharing && screenStreamLocal) {
                            const screenKey = `screen-local-${targetId}`;
                            if (!peers.get(screenKey)) {
                                const connId = `${localScreenShareId}:${targetId}`;
                                const screenPeer = createPeer(screenStreamLocal, 'screen', true, targetId, state.userName || '', connId);
                                peers.set(screenKey, screenPeer);
                                screenConnMap.set(connId, screenKey);
                            }
                        }
                    }

                    const waitingMsg = document.getElementById('waitingMsg');
                    if (waitingMsg) waitingMsg.style.display = 'none';
                    updateUI();
                    updateEmptyState();
                    const shouldPlayJoinSound = !!joinedId && !!myId && joinedId !== myId;
                    if (shouldPlayJoinSound) {
                        playSoundEffect(joinSoundEffect);
                    }
                    showNotification('Участник подключился', `${data.guest?.userName || data.guestName || 'Участник'} присоединился`, 'success');
                    break;

                case 'creator-info':
                    {
                        myId = data.myId || myId;
                        const creator = {
                            id: data.creatorId,
                            userName: data.creatorName,
                            userAvatar: data.creatorAvatar || '',
                            video: !!data.creatorVideo,
                            audio: typeof data.creatorAudio === 'boolean' ? data.creatorAudio : true,
                            screen: false,
                            isAdmin: !!data.isAdmin,
                            appUserId: data.creatorAppUserId || ''
                        };
                        upsertParticipantState(creator);
                        if (creator.isAdmin) {
                            ownerId = creator.id;
                        }
                        isConnected = true;
                        updateCreatorFlag();
                        updatePrimaryRemoteState();
                        const avKeyCreator = `av-${creator.id}`;
                        if (!peers.get(avKeyCreator)) {
                            const avPeer = createPeer(localStream, 'video', shouldInitiatePeer(myId, creator.id), creator.id, creator.userName || '');
                            peers.set(avKeyCreator, avPeer);
                        }
                        const waitingMsg2 = document.getElementById('waitingMsg');
                        if (waitingMsg2) waitingMsg2.style.display = 'none';
                        updateUI();
                        updateEmptyState();
                    }
                    break;

                case 'screen-started':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.screen = true;
                    }
                    updatePrimaryRemoteState();
                    showNotification('Демонстрация', `${fromName} начал демонстрацию`, 'info');
                    updateUI();
                    break;

                case 'screen-stopped':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.screen = false;
                    }
                    updatePrimaryRemoteState();
                    removeScreenTile(fromId);
                    Array.from(peers.keys())
                        .filter(k => k.startsWith(`screen-remote-${fromId}`))
                        .forEach(k => {
                            const p = peers.get(k);
                            if (p) p.destroy();
                            peers.delete(k);
                        });
                    Array.from(screenConnMap.entries())
                        .filter(([, v]) => typeof v === 'string' && v.startsWith(`screen-remote-${fromId}`))
                        .forEach(([k]) => screenConnMap.delete(k));
                    showNotification('Демонстрация', `${fromName} завершил демонстрацию`, 'info');
                    updateUI();
                    break;

                case 'video-toggle':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.video = !!data.enabled;
                    }
                    if (!data.enabled) {
                        removeVideoTile(fromId);
                    }
                    if (fromId) {
                        applyVideoTileMirroring(fromId);
                    }
                    syncRemoteAudioPlayback(fromId);
                    updatePrimaryRemoteState();
                    updateUI();
                    break;

                case 'camera-facing':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.cameraFacingMode = normalizeFacingMode(data.mode, '');
                        applyVideoTileMirroring(fromId);
                    }
                    break;

                case 'audio-toggle':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.audio = !!data.enabled;
                    }
                    syncRemoteAudioPlayback(fromId);
                    updatePrimaryRemoteState();
                    updateUI();
                    showNotification('Статус', `${fromName} ${data.enabled ? 'включил' : 'выключил'} микрофон`, 'info', data.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>');
                    break;

                case 'speaking':
                    if (fromId) {
                        const state = getParticipantState(fromId);
                        state.speaking = !!data.isSpeaking;
                    }
                    updatePrimaryRemoteState();
                    updateUI();
                    break;

                case 'participant-updated':
                    {
                        const targetId = data.participantId;
                        if (!targetId) break;
                        const state = getParticipantState(targetId);
                        const changes = data.changes || {};
                        if (typeof changes.video === 'boolean') state.video = changes.video;
                        if (typeof changes.audio === 'boolean') state.audio = changes.audio;
                        if (typeof changes.screen === 'boolean') state.screen = changes.screen;
                        if (typeof changes.speaking === 'boolean') state.speaking = changes.speaking;
                        if (typeof changes.isAdmin === 'boolean') state.isAdmin = changes.isAdmin;
                        if (typeof changes.cameraFacingMode === 'string') state.cameraFacingMode = normalizeFacingMode(changes.cameraFacingMode, '');
                        if (changes.userName) state.userName = changes.userName;
                        if (typeof changes.userAvatar === 'string') state.userAvatar = changes.userAvatar;
                        if (typeof changes.appUserId === 'string') state.appUserId = changes.appUserId;
                        if (data.ownerId) ownerId = data.ownerId;
                        updateCreatorFlag();
                        const myState = participantStates.get(myId);
                    isGuestAdmin = !!myState?.isAdmin && String(ownerId ?? '') !== String(myId ?? '');
                        if (targetId && typeof changes.video === 'boolean' && !changes.video) {
                            removeVideoTile(targetId);
                        }
                        if (targetId && typeof changes.screen === 'boolean' && !changes.screen) {
                            removeScreenTile(targetId);
                            Array.from(peers.keys())
                                .filter(k => k.startsWith(`screen-remote-${targetId}`))
                                .forEach(k => {
                                    const p = peers.get(k);
                                    if (p) p.destroy();
                                    peers.delete(k);
                                });
                            Array.from(screenConnMap.entries())
                                .filter(([, v]) => typeof v === 'string' && v.startsWith(`screen-remote-${targetId}`))
                                .forEach(([k]) => screenConnMap.delete(k));
                        }
                        if (targetId) {
                            applyVideoTileMirroring(targetId);
                            syncRemoteAudioPlayback(targetId);
                        }
                        updatePrimaryRemoteState();
                        updateUI();
                    }
                    break;

                case 'force-video-off':
                    if (data.enabled !== videoEnabled && videoEnabled) {
                        showNotification('Действие', `${fromName} выключил вашу камеру`, 'warning');
                        toggleVideo();
                    }
                    break;

                case 'force-audio-off':
                    if (data.enabled !== audioEnabled && audioEnabled) {
                        showNotification('Действие', `${fromName} выключил ваш микрофон`, 'warning');
                        toggleAudio();
                    }
                    break;

                case 'request-video':
                    showCustomConfirm('📹 Запрос на включение камеры', `${fromName} просит включить камеру`, () => {
                        if (!videoEnabled) toggleVideo();
                    });
                    break;

                case 'request-audio':
                    showCustomConfirm('🎤 Запрос на включение микрофона', `${fromName} просит включить микрофон`, () => {
                        if (!audioEnabled) toggleAudio();
                    });
                    break;

                case 'friend-request':
                    {
                        const fromAccountId = String(data.fromAccountId || '').trim();
                        if (!fromAccountId) break;
                        showIncomingFriendRequestModal(fromAccountId, data.fromName || fromName || 'Пользователь');
                    }
                    break;

                case 'made-admin':
                case 'admin-removed':
                case 'admin-state':
                    break;

                case 'owner-changed':
                    ownerId = data.ownerId || ownerId;
                    const ownerState = participantStates.get(ownerId);
                    if (ownerState) ownerState.isAdmin = true;
                    updateCreatorFlag();
                    const myUpdatedState = participantStates.get(myId);
                    isGuestAdmin = !!myUpdatedState?.isAdmin && String(ownerId ?? '') !== String(myId ?? '');
                    updatePrimaryRemoteState();
                    updateUI();
                    break;

                case 'room-closed':
                    closeJoinPendingModal();
                    showNotification('Комната закрыта', data.byName ? `${data.byName} завершил комнату` : 'Комната была закрыта', 'warning');
                    endCall(false);
                    break;

                case 'guest-left':
                    removeVideoTile(fromId);
                    removeScreenTile(fromId);
                    removeParticipantState(fromId);
                    
                    const avPeerKey = `av-${fromId}`;
                    if (peers.get(avPeerKey)) {
                        peers.get(avPeerKey).destroy();
                        peers.delete(avPeerKey);
                    }
                    Array.from(peers.keys())
                        .filter(k => k.startsWith(`screen-remote-${fromId}`))
                        .forEach(k => {
                            const p = peers.get(k);
                            if (p) p.destroy();
                            peers.delete(k);
                        });
                    const screenLocalKeyLeft = `screen-local-${fromId}`;
                    if (peers.get(screenLocalKeyLeft)) {
                        peers.get(screenLocalKeyLeft).destroy();
                        peers.delete(screenLocalKeyLeft);
                    }
                    Array.from(screenConnMap.entries())
                        .filter(([, v]) => typeof v === 'string' && (v.startsWith(`screen-remote-${fromId}`) || v === screenLocalKeyLeft))
                        .forEach(([k]) => screenConnMap.delete(k));
                    if (data.ownerId) ownerId = data.ownerId;
                    updateCreatorFlag();
                    updatePrimaryRemoteState();
                    updateUI();
                    if (data.friendCallEnded) {
                        showNotification('Звонок другу', `${fromName || 'Участник'} завершил звонок`, 'warning');
                        endCall(false);
                        break;
                    }
                    showNotification('Участник покинул', `${fromName} вышел`, 'warning');
                    break;

                case 'kicked':
                    playSoundEffect(kickSoundEffect);
                    endCall(false);
                    showNotification('Исключение', 'Вас исключили из звонка', 'error');
                    break;
            }
        }

        function updateUI() {
            const videoBtn = document.getElementById('videoBtn');
            const flipCameraBtn = document.getElementById('flipCameraBtn');
            const audioBtn = document.getElementById('audioBtn');
            const screenBtn = document.getElementById('screenBtn');
            const watchBtn = document.getElementById('watchBtn');
            const stopWatchBtn = document.getElementById('stopWatchBtn');
            const roomSettingsBtn = document.getElementById('roomSettingsBtn');
            const copyInviteIcon = document.getElementById('copyInviteIcon');
            if (videoBtn) {
                videoBtn.innerHTML = videoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
                videoBtn.className = `ctrl-btn ${videoEnabled ? 'active' : 'disabled'}`;
            }
            if (audioBtn) {
                audioBtn.innerHTML = audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
                audioBtn.className = `ctrl-btn ${audioEnabled ? 'active' : 'disabled'}`;
            }
            if (flipCameraBtn) {
                flipCameraBtn.style.display = videoEnabled ? 'inline-flex' : 'none';
                flipCameraBtn.disabled = !videoEnabled || cameraSwitchInProgress;
                if (cameraSwitchInProgress) {
                    flipCameraBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                } else {
                    flipCameraBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                }
                flipCameraBtn.className = `ctrl-btn flip ${videoEnabled ? 'active' : ''}`;
                flipCameraBtn.title = cameraFacingMode === 'environment' ? 'Переключить на переднюю камеру' : 'Переключить на заднюю камеру';
            }
            if (screenBtn) {
                screenBtn.innerHTML = isScreenSharing ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-desktop"></i>';
                screenBtn.className = `ctrl-btn screen ${isScreenSharing ? 'active' : ''}`;
            }
            if (watchBtn) {
                watchBtn.innerHTML = '<i class="fas fa-users-viewfinder"></i>';
                watchBtn.className = `ctrl-btn watch ${watchPartyState ? 'active' : ''}`;
            }
            if (stopWatchBtn) {
                const showStop = !!watchPartyState && canStopWatchParty();
                stopWatchBtn.style.display = showStop ? '' : 'none';
            }
            if (roomSettingsBtn) {
                roomSettingsBtn.style.display = canManageRoom() ? 'inline-flex' : 'none';
            }
            applyCallConnectionBadges();
            if (copyInviteIcon) {
                copyInviteIcon.className = 'fas fa-id-card';
            }

            const list = document.getElementById('participantsList');
            if (list) {
                const myWaveHtml = `<span class="wave" style="display: ${isSpeaking ? 'inline-flex' : 'none'}"><span></span><span></span><span></span><span></span></span>`;
                const canControl = isCreator || isGuestAdmin;
                const canOpenContext = true;
                
                let participantsHtml = '';
                if (canControl && pendingJoinRequests.length) {
                    pendingJoinRequests.forEach((request) => {
                        participantsHtml += `
                            <div class="participant">
                                <div class="participant-info">
                                    <div class="participant-avatar">${avatarMarkup(request.userName, request.userAvatar)}</div>
                                    <div class="participant-name">
                                        <div class="participant-title">
                                            ${renderMaybeMarqueeText(request.userName || 'Участник', 10, 'participant-title-text')}
                                        </div>
                                        <div class="participant-badges">
                                            <span class="badge admin-badge"><i class="fas fa-user-clock"></i> Ожидает вход</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="participant-status">
                                    <button class="ctrl-btn active" style="width:30px;height:30px;font-size:14px" onclick="approveJoinRequest('${request.id}')"><i class="fas fa-check"></i></button>
                                    <button class="ctrl-btn end" style="width:30px;height:30px;font-size:14px" onclick="rejectJoinRequest('${request.id}')"><i class="fas fa-times"></i></button>
                                </div>
                            </div>
                        `;
                    });
                }

                participantsHtml += `
                    <div class="participant ${isSpeaking ? 'speaking' : ''}">
                        <div class="participant-info">
                            <div class="participant-avatar">${avatarMarkup(userName, userAvatar)}</div>
                            <div class="participant-name">
                                <div class="participant-title">
                                    ${renderMaybeMarqueeText(userName || 'Вы', 10, 'participant-title-text')}
                                    ${myWaveHtml}
                                </div>
                                <div class="participant-badges">
                                    ${isCreator ? '<span class="badge icon-badge" title="Создатель"><i class="fas fa-crown"></i></span>' : ''}
                                    ${isGuestAdmin ? '<span class="badge icon-badge admin-badge" title="Админ"><i class="fas fa-user-shield"></i></span>' : ''}
                                    ${isScreenSharing ? '<span class="badge icon-badge screen-badge" title="Демонстрация"><i class="fas fa-desktop"></i></span>' : ''}
                                    ${watchPartyState && watchPartyState.ownerId === myId ? '<span class="badge icon-badge" title="Совместный просмотр"><i class="fas fa-users-viewfinder"></i></span>' : ''}
                                </div>
                            </div>
                        </div>
                        <div class="participant-status">
                            <i class="fas ${videoEnabled ? 'fa-video' : 'fa-video-slash'} ${!videoEnabled ? 'off' : ''}"></i>
                            <i class="fas ${audioEnabled ? 'fa-microphone' : 'fa-microphone-slash'} ${!audioEnabled ? 'off' : ''}"></i>
                        </div>
                    </div>
                `;

                getRemoteParticipantIds().forEach((participantId) => {
                    const state = getParticipantState(participantId);
                    const remoteWave = `<span class="wave" style="display: ${state.speaking ? 'inline-flex' : 'none'}"><span></span><span></span><span></span><span></span></span>`;
                    const qualityLevel = getConnectionQuality(participantId);
                    const qualityBadge = `<span class="connection-badge ${qualityLevel}" title="Качество связи"><i class="fas fa-signal"></i></span>`;
                    const isConnectingRemote = connectingAudioParticipants.has(String(participantId));
                    const connDots = isConnectingRemote
                        ? '<div class="p-conn-dots" title="Соединение"><span></span><span></span><span></span></div>'
                        : '';
                    const attrs = canOpenContext ? `data-target-id="${participantId}" oncontextmenu="showContextMenu(event,false,'${participantId}')" ontouchstart="handleParticipantTap(event,'${participantId}')" onclick="handleParticipantTap(event,'${participantId}')"` : '';
                    participantsHtml += `
                    <div class="participant ${state.speaking ? 'speaking' : ''} ${isConnectingRemote ? 'connecting' : ''}" ${attrs}>
                        <div class="participant-info">
                            <div class="participant-avatar">${avatarMarkup(state.userName, state.userAvatar)}${connDots}</div>
                            <div class="participant-name">
                                <div class="participant-title">
                                    ${renderMaybeMarqueeText(state.userName || 'Участник', 10, 'participant-title-text')}
                                    ${remoteWave}
                                </div>
                                <div class="participant-badges">
                                    ${participantId === ownerId ? '<span class="badge icon-badge" title="Создатель"><i class="fas fa-crown"></i></span>' : ''}
                                    ${state.screen ? '<span class="badge icon-badge screen-badge" title="Демонстрация"><i class="fas fa-desktop"></i></span>' : ''}
                                    ${state.isAdmin && participantId !== ownerId ? '<span class="badge icon-badge admin-badge" title="Админ"><i class="fas fa-user-shield"></i></span>' : ''}
                                    ${watchPartyState && watchPartyState.ownerId === participantId ? '<span class="badge icon-badge" title="Совместный просмотр"><i class="fas fa-users-viewfinder"></i></span>' : ''}
                                    ${qualityBadge}
                                </div>
                            </div>
                        </div>
                        <div class="participant-status">
                            <i class="fas ${state.video ? 'fa-video' : 'fa-video-slash'} ${!state.video ? 'off' : ''}"></i>
                            <i class="fas ${state.audio ? 'fa-microphone' : 'fa-microphone-slash'} ${!state.audio ? 'off' : ''}"></i>
                        </div>
                    </div>
                    `;
                });
                
                list.innerHTML = participantsHtml;
            }
        }

        function placeContextMenu(menu, preferredLeft, preferredTop, fallbackTop = null) {
            if (!menu) return;
            const margin = 12;
            const menuRect = menu.getBoundingClientRect();
            const maxLeft = window.innerWidth - menuRect.width - margin;
            const safeLeft = Math.min(Math.max(margin, preferredLeft), Math.max(margin, maxLeft));

            let top = preferredTop;
            if (top + menuRect.height > window.innerHeight - margin && fallbackTop !== null) {
                top = fallbackTop - menuRect.height;
            }
            const maxTop = window.innerHeight - menuRect.height - margin;
            const safeTop = Math.min(Math.max(margin, top), Math.max(margin, maxTop));

            menu.style.left = `${safeLeft}px`;
            menu.style.top = `${safeTop}px`;
        }

        function showContextMenu(e, fromTap = false, targetId = null) {
            if (!fromTap) {
                e.preventDefault();
            }
            const resolvedTargetId = targetId || currentContextTargetId || getRemoteParticipantIds()[0];
            if (!resolvedTargetId) return;
            currentContextTargetId = resolvedTargetId;
            const state = getParticipantState(resolvedTargetId);
            if (!state) return;
            remoteName = state.userName || remoteName;
            remoteAvatar = state.userAvatar || remoteAvatar;
            remoteVideo = !!state.video;
            remoteAudio = !!state.audio;
            remoteScreen = !!state.screen;
            remoteSpeaking = !!state.speaking;
            window.remoteIsAdmin = !!state.isAdmin;
            const pointX = fromTap ? (e.touches?.[0]?.pageX || e.pageX || window.innerWidth / 2) : e.pageX;
            const pointY = fromTap ? (e.touches?.[0]?.pageY || e.pageY || window.innerHeight / 2) : e.pageY;

            const menu = document.createElement('div');
            menu.className = 'context-menu';
            
            let html = '';
            
            if (isCreator || isGuestAdmin) {
                if (remoteAudio) {
                    html += `<div class="context-item" onclick="forceToggleRemoteAudio()">
                        <i class="fas fa-microphone-slash"></i> Выключить микрофон
                    </div>`;
                } else {
                    html += `<div class="context-item" onclick="forceToggleRemoteAudio()">
                        <i class="fas fa-microphone"></i> Попросить включить микрофон
                    </div>`;
                }
                
                if (remoteVideo) {
                    html += `<div class="context-item" onclick="forceToggleRemoteVideo()">
                        <i class="fas fa-video-slash"></i> Выключить камеру
                    </div>`;
                } else {
                    html += `<div class="context-item" onclick="forceToggleRemoteVideo()">
                        <i class="fas fa-video"></i> Попросить включить камеру
                    </div>`;
                }
            }
            
            if (isCreator) {
                if (html) html += `<div class="divider"></div>`;
                html += `<div class="context-item" onclick="toggleAdmin()">
                    <i class="fas fa-user-shield"></i> ${window.remoteIsAdmin ? 'Снять администратора' : 'Назначить администратором'}
                </div>`;
                html += `<div class="divider"></div>`;
                html += `<div class="context-item" onclick="kickUser()">
                    <i class="fas fa-user-slash"></i> Исключить из звонка
                </div>`;
            }

            if (html) html += `<div class="divider"></div>`;
            html += `<div class="context-item" onclick="requestFriendFromCall()">
                <i class="fas fa-user-plus"></i> Добавить в друзья
            </div>`;
            
            menu.innerHTML = html;
            document.body.appendChild(menu);
            placeContextMenu(menu, pointX, pointY);
            setTimeout(() => menu.remove(), 5000);
            document.addEventListener('click', () => menu.remove(), { once: true });
        }

        function handleParticipantTap(e) {
            if (window.innerWidth <= 768) {
                const targetId = e?.currentTarget?.dataset?.targetId || currentContextTargetId;
                showContextMenu(e, true, targetId);
            }
        }

        async function requestFriendFromCall() {
            const targetId = currentContextTargetId;
            if (!targetId) return;
            const state = getParticipantState(targetId);
            const targetName = state?.userName || 'Участник';
            const targetAccountId = String(state?.appUserId || '').trim();
            if (!targetAccountId) {
                showNotification('Друзья', 'У пользователя нет ID аккаунта', 'warning');
                return;
            }
            await sendFriendRequest(targetAccountId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'friend-request',
                    targetId,
                    fromAccountId: appUserId,
                    fromName: userName
                }));
            }
            showNotification('Друзья', `Запрос отправлен: ${targetName}`, 'info');
        }

        function kickUser() { 
            const targetId = currentContextTargetId;
            if (!targetId || !ws || ws.readyState !== WebSocket.OPEN) return;
            const state = getParticipantState(targetId);
            const targetName = state?.userName || remoteName || 'участника';
            showCustomConfirm('Исключить участника', `Исключить ${targetName}?`, () => {
                ws.send(JSON.stringify({ type: 'kick', targetId }));
            });
        }
        
        function copyRoomId() {
            const value = getRoomInviteToCopy();
            if (!value) return;
            navigator.clipboard.writeText(value);
            showNotification('Скопировано', 'ID комнаты скопирован', 'success');
        }

