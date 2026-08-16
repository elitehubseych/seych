        function animatePhraseTransition() {
            const el = document.getElementById('emptyChatPhrase');
            if (!el || emptyChatPhraseFading) return;
            emptyChatPhraseFading = true;
            el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px)';
            setTimeout(() => {
                emptyChatPhraseIndex = (emptyChatPhraseIndex + 1) % EMPTY_CHAT_PHRASES.length;
                emptyChatCurrentPhrase = EMPTY_CHAT_PHRASES[emptyChatPhraseIndex];
                el.textContent = emptyChatCurrentPhrase;
                el.style.transition = 'none';
                el.style.opacity = '0';
                el.style.transform = 'translateY(8px)';
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                        el.style.opacity = '0.88';
                        el.style.transform = 'translateY(0)';
                        setTimeout(() => { emptyChatPhraseFading = false; }, 650);
                    });
                });
            }, 520);
        }

        function startEmptyChatPhraseRotation() {
            if (emptyChatPhraseTimer) return;
            emptyChatPhraseTimer = setInterval(() => {
                const el = document.getElementById('emptyChatPhrase');
                if (!el) { stopEmptyChatPhraseRotation(); return; }
                animatePhraseTransition();
            }, 5000);
        }

        function stopEmptyChatPhraseRotation() {
            if (emptyChatPhraseTimer) { clearInterval(emptyChatPhraseTimer); emptyChatPhraseTimer = null; }
        }

        function getInitialEmptyChatPhrase() {
            return emptyChatCurrentPhrase;
        }

        function openBlacklistModal() {
            const bl = messengerProfile.blacklist || [];
            const listHtml = bl.length
                ? bl.map((bid) => {
                    const b = String(bid || '');
                    const dn = resolvePeerDisplay(b).displayName || b;
                    return `<div class="contact-item"><div class="contact-name">${escapeHtml(dn)}</div><div class="contact-name" style="font-size:11px;opacity:.65;">${escapeHtml(b)}</div><button class="contact-btn delete" onclick="removeUserFromBlacklist('${escapeHtml(b)}'); openBlacklistModal()"><i class="fas fa-times"></i></button></div>`;
                }).join('')
                : '<div class="friends-empty">Черный список пуст</div>';
            const overlay = document.createElement('div');
            overlay.className = 'blacklist-modal-overlay';
            overlay.id = 'blacklistModalOverlay';
            overlay.onclick = (e) => { if (e.target === overlay) closeBlacklistModal(); };
            overlay.innerHTML = `
                <div class="blacklist-modal">
                    <div class="blacklist-modal-header">
                        <h3>Черный список</h3>
                        <button type="button" class="blacklist-modal-close" onclick="closeBlacklistModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="blacklist-modal-list">${listHtml}</div>
                </div>`;
            document.body.appendChild(overlay);
        }

        function closeBlacklistModal() {
            const overlay = document.getElementById('blacklistModalOverlay');
            if (overlay) overlay.remove();
        }

        let wsReconnectInProgress = false;
        let reconnectKey = '';
        let detectLoopTimer = null;
        let wsHeartbeatTimer = null;
        let callAudioHealTimer = null;
        let joinSoundEffect = null;
        let leaveSoundEffect = null;
        let kickSoundEffect = null;
        let audioUnlockPromptShownOnce = false;
        let audioRecoverCooldown = new Map();
        let connectionNoticeCooldown = new Map();
        let pendingLegacyAppUserId = '';
        let startupLoaderTicker = null;
        let messengerView = 'chats';
        let messengerChats = [];
        const messengerLinkPreviewCache = new Map();
        const messengerLinkPreviewPromises = new Map();
        let messengerActiveChatId = '';
        let messengerActivePeerId = '';
        let messengerMessages = new Map();
        let messengerTypingByUser = new Map();
        let messengerTypingTimersByUser = new Map();
        let messengerTypingByChat = new Map();
        let messengerTypingTimersByChat = new Map();
        // Счётчик непрочитанных сообщений в сайдбаре (на каждую беседу).
        const messengerUnreadCounts = new Map();
        // Чтобы не накручивать счётчик повторно при приходе апдейтов/замен по id.
        const messengerUnreadMessageIds = new Set();
        const messengerReadAckedMessageIds = new Set();
        // Скролл истории: ставим в true только когда надо автопрокрутить вниз.
        let messengerShouldAutoScroll = true;
        function getMessengerUnreadForChat(chatId) {
            return messengerUnreadCounts.get(chatId) || 0;
        }
        function setMessengerUnreadForChat(chatId, value) {
            const id = String(chatId || '');
            if (!id) return;
            const v = Math.max(0, Number(value) || 0);
            if (v) messengerUnreadCounts.set(id, v);
            else messengerUnreadCounts.delete(id);
        }
        function getMessengerUnreadTotal() {
            let sum = 0;
            messengerUnreadCounts.forEach((v) => {
                sum += Math.max(0, Number(v) || 0);
            });
            return sum;
        }

        function syncChatLastMessagePreviewFromMessages(chatId) {
            const cid = String(chatId || '').trim();
            if (!cid) return;
            const msgs = messengerMessages.get(cid) || [];
            const last = [...msgs].reverse().find((m) => m && !m.deletedAt) || null;
            const previewTextFromMessage = (m) => {
                if (!m) return '';
                const kind = String(m.messageKind || '');
                if (kind === 'system') return String(m.text || '');
                const groupEvent = parseGroupEventPayload(m.text || '');
                if (groupEvent) {
                    const t = String(groupEvent.type || '').trim();
                    if (t === 'group-call-ended') return 'Звонок завершён';
                    if (t === 'group-call-created') return 'Групповой звонок';
                    const title = String(groupEvent.title || '').trim();
                    return title || 'Событие';
                }
                return String(m.text || '');
            };
            const preview = last
                ? {
                      id: last.id,
                      text: previewTextFromMessage(last),
                      fromId: last.fromId || '',
                      createdAt: Number(last.createdAt || 0) || Date.now(),
                      editedAt: Number(last.editedAt || 0) || 0,
                      messageKind: last.messageKind || 'text',
                      audioBase64: ''
                  }
                : null;
            messengerChats = (messengerChats || []).map((c) => {
                if (String(c.id || '') !== cid) return c;
                const nextUpdatedAt = preview ? Number(preview.createdAt || Date.now()) : Number(c.updatedAt || 0);
                return { ...c, lastMessage: preview, updatedAt: nextUpdatedAt };
            });
            messengerChats = (messengerChats || []).slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        }

        function getChatHistoryDistFromBottom() {
            const hist = document.querySelector('.chat-history');
            if (!hist) return 0;
            return hist.scrollHeight - hist.scrollTop - hist.clientHeight;
        }

        function updateMessengerNewWhileScrolledFabUI() {
            const wrap = document.getElementById('scrollToBottomFabWrap');
            const badge = document.getElementById('scrollToBottomFabBadge');
            if (!wrap || !badge) return;
            const c = Math.max(0, Number(messengerNewWhileScrolledCount) || 0);
            const dist = getChatHistoryDistFromBottom();
            const shouldShow = dist > 120;
            wrap.style.display = shouldShow ? 'flex' : 'none';
            if (c > 0) {
                badge.textContent = c > 99 ? '99+' : String(c);
                badge.style.display = 'flex';
            } else {
                badge.textContent = '0';
                badge.style.display = 'none';
            }
        }

        function scrollMessengerHistoryToBottom() {
            const hist = document.querySelector('.chat-history');
            if (!hist) return;
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            try {
                hist.scrollTop = hist.scrollHeight;
            } catch (_) {}
            updateMessengerNewWhileScrolledFabUI();
        }
        const messengerMentionUnreadCounts = new Map();
        const messengerPendingMentionIdsByChat = new Map();
        let messengerMentionWhileScrolledCount = 0;
        let messengerMentions = [];
        let messengerNotifications = [];
        const messengerNotificationUnreadIds = new Set();
        const MESSENGER_NOTIFICATIONS_STORAGE_PREFIX = 'seych-messenger-notifications:';
        let messengerAppearance = { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true };
        let profileUsernameCheckTimer = null;
        let profileUsernameCheckSeq = 0;

        function getMessengerNotificationsStorageKey() {
            const userId = String(authProfile?.appUserId || appUserId || '').trim();
            return userId ? `${MESSENGER_NOTIFICATIONS_STORAGE_PREFIX}${userId}` : '';
        }

        function persistMessengerNotifications() {
            const key = getMessengerNotificationsStorageKey();
            if (!key) return;
            try {
                localStorage.setItem(key, JSON.stringify({
                    notifications: Array.isArray(messengerNotifications) ? messengerNotifications.slice(0, 300) : [],
                    unreadIds: Array.from(messengerNotificationUnreadIds)
                }));
            } catch (_) {}
        }

        function loadMessengerNotifications() {
            const key = getMessengerNotificationsStorageKey();
            if (!key) return;
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                messengerNotifications = Array.isArray(parsed?.notifications) ? parsed.notifications : [];
                messengerNotificationUnreadIds.clear();
                (Array.isArray(parsed?.unreadIds) ? parsed.unreadIds : []).forEach((id) => {
                    const safeId = String(id || '').trim();
                    if (safeId) messengerNotificationUnreadIds.add(safeId);
                });
            } catch (_) {}
        }

        function loadMessengerTheme() {
            messengerAppearance = messengerAppearance && typeof messengerAppearance === 'object'
                ? messengerAppearance
                : { theme: 'classic', chatWallpaper: '', chatWallpaperBlur: true };
            messengerAppearance.theme = messengerAppearance.theme === 'dark' ? 'dark' : 'classic';
            applyMessengerTheme();
        }

        function applyMessengerTheme() {
            if (messengerAppearance.theme === 'dark') {
                document.body.setAttribute('data-theme', 'dark');
                return;
            }
            document.body.removeAttribute('data-theme');
        }

        function setMessengerTheme(nextTheme) {
            messengerAppearance.theme = nextTheme === 'dark' ? 'dark' : 'classic';
            applyMessengerTheme();
            sendMessengerEvent({
                type: 'messenger-update-appearance',
                theme: messengerAppearance.theme
            });
            if (shouldRenderMessengerUi()) renderMainScreen();
        }

        function setMessengerChatWallpaper(nextWallpaperDataUrl) {
            messengerAppearance.chatWallpaper = String(nextWallpaperDataUrl || '').trim();
            sendMessengerEvent({
                type: 'messenger-update-appearance',
                chatWallpaper: messengerAppearance.chatWallpaper
            });
            if (shouldRenderMessengerUi()) renderMainScreen();
        }

        function setMessengerChatWallpaperBlur(enabled) {
            messengerAppearance.chatWallpaperBlur = enabled !== false;
            sendMessengerEvent({
                type: 'messenger-update-appearance',
                chatWallpaperBlur: !!messengerAppearance.chatWallpaperBlur
            });
            if (shouldRenderMessengerUi()) renderMainScreen();
        }

        function getMessengerNotificationUnreadTotal() {
            return messengerNotificationUnreadIds.size;
        }

        function markMessengerNotificationsRead() {
            messengerNotificationUnreadIds.clear();
            persistMessengerNotifications();
            if (typeof refreshNotificationsModalContent === 'function') refreshNotificationsModalContent();
        }

        function getMessengerNotificationChatMeta(chatId) {
            const chat = findMessengerChatById(chatId);
            const title = String(chat?.peer?.displayName || chat?.peer?.name || chatId || 'Чат').trim() || 'Чат';
            return {
                chatId: String(chatId || '').trim(),
                chatTitle: title,
                chatAvatar: String(chat?.peer?.avatar || '').trim(),
                chatInitials: String(chat?.peer?.initials || '').trim() || title.split(/\s+/).filter(Boolean).map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase()
            };
        }

        function pushMessengerNotification(item, opts = {}) {
            const normalized = item && typeof item === 'object' ? item : {};
            const id = String(normalized.id || '').trim();
            if (!id) return;
            const createdAt = Number(normalized.createdAt || 0) || Date.now();
            const entry = {
                id,
                type: String(normalized.type || 'info').trim() || 'info',
                chatId: String(normalized.chatId || '').trim(),
                chatTitle: String(normalized.chatTitle || '').trim() || 'Чат',
                chatAvatar: String(normalized.chatAvatar || '').trim(),
                chatInitials: String(normalized.chatInitials || '').trim(),
                actorId: String(normalized.actorId || '').trim(),
                actorName: String(normalized.actorName || '').trim() || 'Пользователь',
                actorAvatar: String(normalized.actorAvatar || '').trim(),
                actorInitials: String(normalized.actorInitials || '').trim(),
                messageId: String(normalized.messageId || '').trim(),
                title: String(normalized.title || '').trim() || 'Уведомление',
                text: String(normalized.text || '').trim(),
                duration: String(normalized.duration || '').trim(),
                reason: String(normalized.reason || '').trim(),
                createdAt
            };
            const prevIdx = messengerNotifications.findIndex((it) => String(it?.id || '') === id);
            if (prevIdx >= 0) {
                messengerNotifications[prevIdx] = { ...messengerNotifications[prevIdx], ...entry };
            } else {
                messengerNotifications = [entry, ...(messengerNotifications || [])]
                    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                    .slice(0, 300);
            }
            if (opts.markUnread !== false && messengerView !== 'notifications') {
                messengerNotificationUnreadIds.add(id);
            }
            persistMessengerNotifications();
            if (typeof refreshNotificationsModalContent === 'function') refreshNotificationsModalContent();
        }

        function openMessengerNotification(notificationId) {
            if (typeof closeNotificationsModal === 'function') closeNotificationsModal();
            const id = String(notificationId || '').trim();
            if (!id) return;
            const item = (messengerNotifications || []).find((entry) => String(entry?.id || '') === id);
            if (!item) return;
            messengerNotificationUnreadIds.delete(id);
            persistMessengerNotifications();
            if (item.type === 'mention' && item.chatId) {
                setMessengerMentionUnreadForChat(item.chatId, 0);
            }
            if (item.chatId && findMessengerChatById(item.chatId)) {
                setMessengerView('chats');
                openMessengerChatById(item.chatId);
                if (item.messageId) {
                    setTimeout(() => {
                        scrollAndHighlightMessengerMessage(item.messageId);
                    }, 250);
                }
                return;
            }
            if (item.actorId) openUserProfile(item.actorId);
        }

        function recordMessengerReactionNotifications(chatId, messageId, prevMessage, nextReactions) {
            const myId = String(authProfile?.appUserId || '').trim();
            if (!myId || String(prevMessage?.fromId || '') !== myId) return;
            const prev = prevMessage?.reactions && typeof prevMessage.reactions === 'object' ? prevMessage.reactions : {};
            const next = nextReactions && typeof nextReactions === 'object' ? nextReactions : {};
            const emojis = new Set([...Object.keys(prev), ...Object.keys(next)]);
            emojis.forEach((emoji) => {
                const prevUsers = new Set((Array.isArray(prev[emoji]) ? prev[emoji] : []).map((userId) => String(userId || '').trim()).filter(Boolean));
                const nextUsers = Array.from(new Set((Array.isArray(next[emoji]) ? next[emoji] : []).map((userId) => String(userId || '').trim()).filter(Boolean)));
                nextUsers.forEach((userId) => {
                    if (!userId || userId === myId || prevUsers.has(userId)) return;
                    const actor = resolvePeerDisplay(userId);
                    const actorName = String(actor?.displayName || actor?.name || userId).trim() || userId;
                    const actorAvatar = String(actor?.avatar || '').trim();
                    const actorInitials = String(actor?.initials || (actorName || '').split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase() || '').trim();
                    pushMessengerNotification({
                        id: `reaction:${String(chatId || '').trim()}:${String(messageId || '').trim()}:${emoji}:${userId}`,
                        type: 'reaction',
                        ...getMessengerNotificationChatMeta(chatId),
                        actorId: userId,
                        actorName,
                        actorAvatar,
                        actorInitials,
                        messageId: String(messageId || '').trim(),
                        title: 'Реакция',
                        text: `${actorName} поставил(а) ${emoji} на ваше сообщение`,
                        createdAt: Date.now()
                    });
                });
            });
        }

        function getMessengerMentionUnreadForChat(chatId) {
            return messengerMentionUnreadCounts.get(String(chatId || '')) || 0;
        }

        function setMessengerMentionUnreadForChat(chatId, value) {
            const id = String(chatId || '');
            if (!id) return;
            const v = Math.max(0, Number(value) || 0);
            if (v) messengerMentionUnreadCounts.set(id, v);
            else messengerMentionUnreadCounts.delete(id);
        }

        function getMessengerMentionUnreadTotal() {
            let sum = 0;
            messengerMentionUnreadCounts.forEach((v) => {
                sum += Math.max(0, Number(v) || 0);
            });
            return sum;
        }

        function updateMessengerMentionFabUI() {
            const wrap = document.getElementById('scrollToMentionFabWrap');
            const badge = document.getElementById('scrollToMentionFabBadge');
            if (!wrap || !badge) return;
            const c = Math.max(0, Number(messengerMentionWhileScrolledCount) || 0);
            if (!c) {
                wrap.style.display = 'none';
                return;
            }
            badge.textContent = c > 99 ? '99+' : String(c);
            wrap.style.display = 'flex';
        }

        function scrollMessengerHistoryToNextMention() {
            const chatId = String(messengerActiveChatId || '').trim();
            const ids = messengerPendingMentionIdsByChat.get(chatId) || [];
            const nextId = ids.length ? String(ids[0] || '').trim() : '';
            if (!nextId) {
                messengerMentionWhileScrolledCount = 0;
                updateMessengerMentionFabUI();
                return;
            }
            messengerPendingMentionIdsByChat.set(chatId, ids.slice(1));
            messengerMentionWhileScrolledCount = Math.max(0, ids.length - 1);
            updateMessengerMentionFabUI();
            scrollAndHighlightMessengerMessage(nextId);
        }

        let messengerProfile = { username: '', statusText: '', privacy: { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' }, blacklist: [] };
        let callMinimized = false;
        let currentGroupCallChatId = '';
        let currentGroupCallTitle = '';
        let pendingGroupInviteCode = '';
        let messengerRenderPendingAfterScroll = false;
        // Новые сообщения в текущем чате, пока пользователь прокручен вверх.
        let messengerNewWhileScrolledCount = 0;
        function shouldRenderMessengerUi() {
            const base = !roomId || callMinimized;
            if (!base) return false;
            // Не перерисовываем чат во время ручного скролла — иначе ломается momentum и скролл "останавливается".
            if ((messengerView === 'chats' && messengerIsUserScrolling) || (messengerView === 'notifications' && messengerWorkspaceIsUserScrolling)) {
                messengerRenderPendingAfterScroll = true;
                return false;
            }
            return true;
        }
        let composerReplyMessage = null;
        let composerEditMessageId = '';
        let composerMentionState = { open: false, query: '', candidates: [], activeIndex: 0, atIndex: -1, endIndex: -1 };
        let messageTouchHoldTimer = null;
        let messengerViewedProfile = null;
        let pendingMessengerEvents = [];
        const composerDraftByPeerId = new Map();
        let messengerComposeBlocked = false;
        let messengerComposeHint = '';
        let voiceMediaRecorder = null;
        let voiceMediaStream = null;
        let voiceRecordChunks = [];
        let voiceRecordingActive = false;
        let voiceRecordStartedAt = 0;
        let voiceRecTimerInterval = null;
        let voiceRecordPreview = null;
        let voicePreviewAudioEl = null;
        // Плеер музыки (аудиосообщения) — мобильный островок.
        const musicPlayer = {
            audioEl: null,
            chatId: '',
            msgId: '',
            playing: false,
            title: '',
            tickInterval: null
        };
        let musicIslandEl = null;
        const messengerPeerHints = new Map();
        // Чтобы аватары/имена профиля обновлялись в "Друзьях" даже после следующего poll.
        const messengerProfileOverrides = new Map();
        let friendsCallsModalPrimed = false;
        let isChatOpen = false;
        const MESSENGER_SESSION_PEER_KEY = 'seych-messenger-active-peer';
        const MESSENGER_SESSION_CHAT_KEY = 'seych-messenger-active-chat';
        let mobileNavDrawerOpen = false;
        let messengerUiTypingTimer = null;
        let friendsSearchDebounceTimer = null;
        let lastComposerTypingEmit = 0;
        let messengerCreateGroupModalOpen = false;
        // Контент открытого чата меняется только тогда, когда это явно отметили.
        // Фоновые события (присутствие, бейджи, соединение) НЕ перерисовывают историю/композер.
        let messengerWorkspaceDirty = true;

        function markMessengerWorkspaceDirty(chatId) {
            messengerWorkspaceDirty = chatId || true;
        }

        // ==== Поиск в сайдбаре (Люди / Чаты / Сообщения) ====
        let messengerSearchOpen = false;
        let messengerSearchQuery = '';
        let messengerSearchActiveTab = 'people'; // 'people' | 'chats' | 'messages'
        // Если задан — после загрузки истории чата прыгаем к этому сообщению (результат поиска по сообщениям).
        let messengerPendingJumpToMsgId = '';

        function captureMessengerFocusSnapshot() {
            const el = document.activeElement;
            if (!el || !el.id) return null;
            if (el.id !== 'chatComposerInput' && el.id !== 'friendsSearchInput') return null;
            let sel = null;
            try {
                if (typeof el.selectionStart === 'number') {
                    sel = { s: el.selectionStart, e: el.selectionEnd };
                }
            } catch (_) {}
            return { id: el.id, value: el.value, sel };
        }

        function restoreMessengerFocusSnapshot(snap) {
            if (!snap) return;
            const n = document.getElementById(snap.id);
            if (!n) return;
            n.value = snap.value;
            n.focus();
            if (snap.sel && typeof n.setSelectionRange === 'function') {
                try {
                    n.setSelectionRange(snap.sel.s, snap.sel.e);
                } catch (_) {}
            }
            if (snap.id === 'chatComposerInput') onComposerInput();
        }

        function shouldDeferTransientMessengerRender() {
            const ae = document.activeElement;
            return isMobileLayout() && messengerView === 'chats' && ae && ae.id === 'chatComposerInput';
        }

        function voiceWaveBarsFromSeed(seed, count) {
            let h = 0;
            const s = String(seed || '');
            for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
            const bars = [];
            for (let i = 0; i < count; i++) {
                h = (h * 1664525 + 1013904223) >>> 0;
                bars.push(8 + (h % 20));
            }
            return bars;
        }

        function voiceProgressUpdateHandler(audio, wrap) {
            return () => {
                const fill = wrap && wrap.querySelector ? wrap.querySelector('.voice-progress-fill') : null;
                if (!fill || !audio.duration) return;
                const pct = Math.min(100, (audio.currentTime / audio.duration) * 100);
                fill.style.width = `${pct}%`;
            };
        }

        function ensureMusicPlayerEl() {
            if (musicPlayer.audioEl) return;
            musicPlayer.audioEl = new Audio();
            musicPlayer.audioEl.preload = 'metadata';
            musicPlayer.audioEl.ontimeupdate = () => {
                updateMusicIslandProgress();
            };
            musicPlayer.audioEl.onended = () => {
                musicPlayer.playing = false;
                updateMusicIslandUi();
                syncMusicIslandWidget();
                renderMainScreen();
            };
        }

        function updateMusicIslandProgress() {
            if (!musicIslandEl) return;
            const fill = document.getElementById('musicIslandProgressFill');
            const audio = musicPlayer.audioEl;
            if (!fill || !audio || !audio.duration || Number.isNaN(audio.duration)) return;
            const pct = Math.max(0, Math.min(100, (audio.currentTime / audio.duration) * 100));
            fill.style.width = `${pct}%`;
            // Обновляем прогресс у музыки в сообщении (если оно сейчас играет).
            try {
                const safeMsgId = String(musicPlayer.msgId || '').replace(/[^a-zA-Z0-9_-]/g, '');
                const inlineFill = document.getElementById(`musicInlineProgressFill-${safeMsgId}`);
                if (inlineFill) inlineFill.style.width = `${pct}%`;
            } catch (_) {}
        }

        function updateMusicIslandUi() {
            if (!musicIslandEl) return;
            const title = document.getElementById('musicIslandTitle');
            if (title) title.textContent = musicPlayer.title || 'Музыка';
            const icon = document.getElementById('musicPlayPauseIcon');
            if (icon) {
                const a = musicPlayer.audioEl;
                const playing = !!(a && !a.paused && !a.ended);
                // По ТЗ: когда играет — показываем Stop, когда стоит — Play.
                icon.className = playing ? 'fas fa-stop' : 'fas fa-play';
            }
            updateMusicIslandProgress();
        }

        function ensureMusicIslandWidget() {
            if (musicIslandEl) return;
            musicIslandEl = document.createElement('div');
            musicIslandEl.id = 'musicIsland';
            musicIslandEl.className = 'music-island';
            musicIslandEl.innerHTML = `
                <div class="music-island-row">
                    <button type="button" class="music-island-btn" onclick="seekMusicBy(-10)" aria-label="Назад">
                        <i class="fas fa-backward"></i>
                    </button>
                    <button type="button" class="music-island-btn" id="musicPlayPauseBtn" onclick="toggleMusicIslandPlayPause()" aria-label="Вкл/Пауза">
                        <i id="musicPlayPauseIcon" class="fas fa-play"></i>
                    </button>
                    <button type="button" class="music-island-btn" onclick="seekMusicBy(10)" aria-label="Вперёд">
                        <i class="fas fa-forward"></i>
                    </button>
                    <div class="music-island-title" id="musicIslandTitle">Музыка</div>
                    <button type="button" class="music-island-btn danger" onclick="stopMusicPlayer(true)" aria-label="Закрыть">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="music-island-progress" aria-hidden="true">
                    <div class="music-island-progress-fill" id="musicIslandProgressFill"></div>
                </div>
            `;
            document.body.appendChild(musicIslandEl);
        }

        function syncMusicIslandWidget() {
            if (!isMobileLayout()) {
                if (musicIslandEl) musicIslandEl.classList.remove('open');
                // Снимаем смещение контента, если мы ушли с mobile.
                try {
                    const hist = document.querySelector('.chat-history');
                    if (hist && hist.dataset.musicIslandPadApplied) {
                        hist.style.paddingTop = '';
                        delete hist.dataset.musicIslandPadApplied;
                    }
                } catch (_) {}
                return;
            }
            ensureMusicIslandWidget();
            if (!musicPlayer.audioEl || !musicPlayer.chatId || !musicPlayer.msgId) {
                musicIslandEl.classList.remove('open');
                try {
                    const hist = document.querySelector('.chat-history');
                    if (hist && hist.dataset.musicIslandPadApplied) {
                        hist.style.paddingTop = '';
                        delete hist.dataset.musicIslandPadApplied;
                    }
                } catch (_) {}
                return;
            }
            // Если пользователь вернулся в тот же диалог, где включили музыку — скрываем остров.
            const inSameChat = messengerView === 'chats' && messengerActiveChatId === musicPlayer.chatId;
            if (inSameChat) {
                musicIslandEl.classList.remove('open');
                try {
                    const hist = document.querySelector('.chat-history');
                    if (hist && hist.dataset.musicIslandPadApplied) {
                        hist.style.paddingTop = '';
                        delete hist.dataset.musicIslandPadApplied;
                    }
                } catch (_) {}
                return;
            }
            // В чате другого диалога: поднять выше (top). Иначе: снизу над навигацией.
            const inChatMode = messengerView === 'chats' && isChatOpen;
            // Сбрасываем инлайн-позиционирование, чтобы при переключении режимов остров не "залипал".
            musicIslandEl.style.top = '';
            musicIslandEl.style.bottom = '';
            musicIslandEl.classList.toggle('music-island--top', inChatMode);
            musicIslandEl.classList.toggle('music-island--bottom', !inChatMode);
            musicIslandEl.classList.add('open');
            if (inChatMode) {
                // На мобильном при открытом чате сайдбар может быть скрыт,
                // поэтому опираемся в первую очередь на `.chat-topbar` внутри workspace.
                const tb = document.querySelector('.messenger-workspace .chat-topbar') || document.querySelector('.chat-topbar');
                if (tb && tb.getBoundingClientRect) {
                    const r = tb.getBoundingClientRect();
                    // Ниже области статуса/имени/кнопок.
                    musicIslandEl.style.top = `${Math.round(r.bottom + 8)}px`;
                    musicIslandEl.style.bottom = 'auto';
                } else {
                    // Фоллбек: статус-строка в сайдбаре.
                    const statusEl = document.querySelector('.messenger-sidebar .messenger-connection');
                    if (statusEl && statusEl.getBoundingClientRect) {
                        const r = statusEl.getBoundingClientRect();
                        musicIslandEl.style.top = `${Math.round(r.bottom + 10)}px`;
                        musicIslandEl.style.bottom = 'auto';
                    }
                }
            }

            // Важно: остров сверху фиксированный и может перекрыть первый message.
            // Поэтому добавляем padding-top в `.chat-history` на высоту острова.
            try {
                const hist = document.querySelector('.chat-history');
                if (hist) {
                    if (inChatMode) {
                        const h = musicIslandEl.getBoundingClientRect().height || 0;
                        const pad = Math.round(h + 6);
                        hist.style.paddingTop = `${pad}px`;
                        hist.dataset.musicIslandPadApplied = String(pad);
                    } else if (hist.dataset.musicIslandPadApplied) {
                        hist.style.paddingTop = '';
                        delete hist.dataset.musicIslandPadApplied;
                    }
                }
            } catch (_) {}
            updateMusicIslandUi();
        }

        function stopMusicPlayer(hideIsland = true) {
            if (musicPlayer.audioEl) {
                try {
                    musicPlayer.audioEl.pause();
                    musicPlayer.audioEl.currentTime = 0;
                } catch (_) {}
            }
            musicPlayer.playing = false;
            if (hideIsland) {
                musicPlayer.chatId = '';
                musicPlayer.msgId = '';
                musicPlayer.title = '';
            }
            if (musicIslandEl) {
                const fill = document.getElementById('musicIslandProgressFill');
                if (fill) fill.style.width = '0%';
            }
            syncMusicIslandWidget();
            renderMainScreen();
        }

        function seekMusicBy(deltaSeconds) {
            const a = musicPlayer.audioEl;
            if (!a || !a.duration) return;
            try {
                a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + deltaSeconds));
            } catch (_) {}
        }

        function toggleMusicIslandPlayPause() {
            ensureMusicPlayerEl();
            const a = musicPlayer.audioEl;
            if (!musicPlayer.chatId || !musicPlayer.msgId || !a || !a.src) return;
            const isPlaying = !!a && !a.paused && !a.ended;
            if (isPlaying) {
                // Stop без скрытия острова.
                stopMusicPlayer(false);
                return;
            }
            a.play().catch(() => {});
            musicPlayer.playing = true;
            updateMusicIslandUi();
            syncMusicIslandWidget();
        }

        function toggleMusicFromMessage(btn) {
            const chatId = btn?.dataset?.chatId || '';
            const msgId = btn?.dataset?.msgId || '';
            if (!chatId || !msgId) return;
            const list = messengerMessages.get(chatId) || [];
            const msg = list.find((m) => String(m?.id || '') === String(msgId || ''));
            if (!msg || msg.messageKind !== 'voice') return;
            if (!msg.audioBase64 && !msg.fileUrl) return;
            ensureMusicPlayerEl();
            const audioMimeRaw = String(msg.audioMime || '').split(';')[0].trim();
            const mime = /^audio\/(webm|ogg|mp4|mpeg|wav|m4a|x-m4a|aac|x-aac)$/i.test(audioMimeRaw) ? audioMimeRaw : 'audio/webm';
            let src = msg.fileUrl || '';
            if (!src) {
                const b64 = String(msg.audioBase64 || '').replace(/[^a-zA-Z0-9+/=]/g, '');
                src = `data:${mime};base64,${b64}`;
            }
            const isSame = String(musicPlayer.chatId || '') === String(chatId || '') && String(musicPlayer.msgId || '') === String(msgId || '');
            const icon = btn && btn.querySelector ? btn.querySelector('i') : null;
            if (!isSame) {
                musicPlayer.chatId = chatId;
                musicPlayer.msgId = msgId;
                musicPlayer.title = msg.text || 'Музыка';
                musicPlayer.audioEl.src = src;
                musicPlayer.audioEl.currentTime = 0;
                musicPlayer.playing = false;
            }
            if (musicPlayer.audioEl.paused) {
                musicPlayer.audioEl.play().catch(() => {});
                musicPlayer.playing = true;
                if (icon) icon.className = 'fas fa-pause';
            } else {
                musicPlayer.audioEl.pause();
                musicPlayer.playing = false;
                if (icon) icon.className = 'fas fa-play';
            }
            updateMusicIslandUi();
            syncMusicIslandWidget();
        }

        // Оставляем старое имя для совместимости, но теперь логика через music-player.
        function toggleVoicePlay(btn) {
            return toggleMusicFromMessage(btn);
        }

        function messengerMobileWorkspaceOpen() {
            return isMobileLayout() && (isChatOpen || messengerView !== 'chats');
        }

        function toggleMobileNavDrawer() {
            mobileNavDrawerOpen = !mobileNavDrawerOpen;
            renderMainScreen();
        }

        function closeMobileNavDrawer() {
            mobileNavDrawerOpen = false;
            renderMainScreen();
        }

        function createDirectChatIdClient(a, b) {
            const pair = [String(a || '').trim(), String(b || '').trim()].filter(Boolean).sort();
            if (pair.length !== 2 || pair[0] === pair[1]) return '';
            return `dm:${pair[0]}::${pair[1]}`;
        }

        function parsePeerIdFromDirectChatId(chatId, myId) {
            const cid = String(chatId || '').trim();
            const me = String(myId || '').trim();
            if (!cid.startsWith('dm:') || !me) return '';
            const payload = cid.slice(3);
            const parts = payload.split('::').map((x) => String(x || '').trim()).filter(Boolean);
            if (parts.length !== 2) return '';
            const a = parts[0];
            const b = parts[1];
            if (a === me) return b;
            if (b === me) return a;
            return '';
        }

        function findMessengerChatById(chatId) {
            const id = String(chatId || '').trim();
            if (!id) return null;
            return messengerChats.find((item) => String(item?.id || '') === id) || null;
        }

        function isGroupMessengerChat(chat) {
            return !!chat && String(chat.kind || '') === 'group';
        }

        function isDirectMessengerChat(chat) {
            return !!chat && String(chat.kind || 'direct') !== 'group';
        }

        function buildGroupChatClientModel(group) {
            if (!group || String(group.kind || 'group') !== 'group') return null;
            const title = String(group.title || 'Групповой чат').trim() || 'Групповой чат';
            const tempChat = { id: String(group.id || ''), kind: 'group', group };
            return {
                id: String(group.id || ''),
                kind: 'group',
                peer: {
                    id: String(group.id || ''),
                    name: title,
                    displayName: title,
                    avatar: String(group.avatar || ''),
                    initials: title.split(/\s+/).filter(Boolean).map((x) => x.charAt(0)).join('').slice(0, 2).toUpperCase() || 'GC',
                    username: '',
                    statusText: getGroupChatStatusText(tempChat),
                    online: false,
                    lastSeenAt: 0
                },
                group,
                updatedAt: Date.now()
            };
        }

        function upsertGroupChatModel(group) {
            const model = buildGroupChatClientModel(group);
            if (!model) return null;
            const idx = messengerChats.findIndex((item) => String(item?.id || '') === String(model.id || ''));
            if (idx >= 0) {
                messengerChats[idx] = {
                    ...messengerChats[idx],
                    ...model,
                    lastMessage: messengerChats[idx]?.lastMessage || model.lastMessage || null
                };
            } else {
                messengerChats.unshift(model);
            }
            messengerChats = mergeMessengerChatsWithHints(messengerChats);
            return idx >= 0 ? messengerChats[idx] : messengerChats[0];
        }

        function applyMessengerPeerHint(userId, displayName, avatar, initials, username = '', statusText = '', rawName = '') {
            const id = String(userId || '').trim();
            if (!id) return;
            const dn = String(displayName || '').trim();
            const av = String(avatar || '').trim();
            const ini = String(initials || '').trim();
            const un = normalizeMessengerUsernameValue(username || '');
            const st = String(statusText || '').trim();
            const nm = String(rawName || '').trim();
            if (!dn && !av && !ini && !un && !st && !nm) return;
            const prev = messengerPeerHints.get(id) || {};
            messengerPeerHints.set(id, {
                displayName: dn || prev.displayName || '',
                name: nm || prev.name || '',
                avatar: av || prev.avatar || '',
                initials: ini || prev.initials || '',
                username: un || prev.username || '',
                statusText: st || prev.statusText || ''
            });
        }

        function mergeMessengerChatsWithHints(chats) {
            const list = Array.isArray(chats) ? chats : [];
            const prevById = new Map(
                (messengerChats || []).map((x) => [String(x.peer?.id || '').trim(), x.peer]).filter((e) => e[0])
            );
            return list.map((c) => {
                const pid = String(c.peer?.id || '').trim();
                if (!pid) return c;
                const h = messengerPeerHints.get(pid);
                const peer = c.peer || {};
                const prevPeer = prevById.get(pid);
                const curDn = String(peer.displayName || peer.name || '').trim();
                const looksBare = !curDn || curDn === pid;
                const nextDn =
                    (looksBare && h && h.displayName) || curDn || (h && h.displayName) || pid;
                const serverAv = String(peer.avatar || '').trim();
                const prevAv = String(prevPeer?.avatar || '').trim();
                const hintAv = h ? String(h.avatar || '').trim() : '';
                const hintUsername = h ? String(h.username || '').replace(/^@+/, '').trim() : '';
                const prevUsername = String(prevPeer?.username || '').replace(/^@+/, '').trim();
                const serverUsername = String(peer.username || '').replace(/^@+/, '').trim();
                const hintStatusText = h ? String(h.statusText || '').trim() : '';
                const prevStatusText = String(prevPeer?.statusText || '').trim();
                const serverStatusText = String(peer.statusText || '').trim();
                const avatarMerged = serverAv || hintAv || prevAv;
                if (!h && !prevPeer && !avatarMerged && looksBare && nextDn === curDn) return c;
                return {
                    ...c,
                    peer: {
                        ...peer,
                        id: pid,
                        displayName: nextDn,
                        name: (peer.name && peer.name !== pid ? peer.name : '') || (h && h.name) || nextDn,
                        avatar: avatarMerged,
                        initials: peer.initials || (h && h.initials) || prevPeer?.initials || '',
                        username: serverUsername || hintUsername || prevUsername || '',
                        statusText: serverStatusText || hintStatusText || prevStatusText || ''
                    }
                };
            });
        }

        function hydrateMessengerHintsFromChats(chats) {
            const list = Array.isArray(chats) ? chats : [];
            list.forEach((chat) => {
                if (!isGroupMessengerChat(chat)) return;
                getGroupChatParticipants(chat).forEach((participant) => {
                    const uid = String(participant?.userId || participant?.id || '').trim();
                    if (!uid) return;
                    applyMessengerPeerHint(
                        uid,
                        participant?.displayName || participant?.name || uid,
                        participant?.avatar || '',
                        participant?.initials || '',
                        participant?.username || '',
                        '',
                        participant?.name || participant?.displayName || uid
                    );
                });
            });
        }

        function hydrateMessengerHintsFromMessages(messages) {
            const arr = Array.isArray(messages) ? messages : [];
            arr.forEach((m) => {
                if (!m || !m.fromId) return;
                applyMessengerPeerHint(m.fromId, m.senderDisplayName, m.senderAvatar, m.senderInitials);
            });
        }

        function resolvePeerDisplay(peerId) {
            const id = String(peerId || '').trim();
            if (!id) return { id: '', name: '', displayName: '', avatar: '', username: '', statusText: '', initials: '' };
            const ensureUsername = (value) => ensureGeneratedMessengerUsername(value || '', id);
            const fromChat = messengerChats.find((c) => String(c.peer?.id || '') === id)?.peer;
            if (fromChat) {
                const hint = messengerPeerHints.get(id);
                const rawDn = fromChat.displayName || fromChat.name || id;
                const looksBare = !rawDn || rawDn === id;
                const dn = looksBare && hint?.displayName ? hint.displayName : rawDn || id;
                const avatar = fromChat.avatar || hint?.avatar || '';
                const initials = fromChat.initials || hint?.initials || '';
                return {
                    id,
                    name: fromChat.name || hint?.name || dn,
                    displayName: dn,
                    avatar,
                    username: ensureUsername(fromChat.username || hint?.username || ''),
                    statusText: fromChat.statusText || hint?.statusText || '',
                    initials
                };
            }
            const hint = messengerPeerHints.get(id);
            if (hint && (hint.displayName || hint.avatar)) {
                const dn = hint.displayName || id;
                return {
                    id,
                    name: hint.name || dn,
                    displayName: dn,
                    avatar: hint.avatar || '',
                    username: ensureUsername(hint.username || ''),
                    statusText: hint.statusText || '',
                    initials: hint.initials || ''
                };
            }
            const fromFriend = (friendsState.friends || []).find((f) => String(f.id) === id);
            if (fromFriend) {
                const dn = fromFriend.name || id;
                return {
                    id,
                    name: dn,
                    displayName: fromFriend.displayName || dn,
                    avatar: fromFriend.avatar || '',
                    username: ensureUsername(fromFriend.username || ''),
                    statusText: fromFriend.statusText || '',
                    initials: fromFriend.initials || ''
                };
            }
            const fromSearch = (friendsSearchResults || []).find((r) => String(r.id) === id);
            if (fromSearch) {
                const dn = fromSearch.name || id;
                return {
                    id,
                    name: dn,
                    displayName: fromSearch.displayName || dn,
                    avatar: fromSearch.avatar || '',
                    username: ensureUsername(fromSearch.username || ''),
                    statusText: fromSearch.statusText || '',
                    initials: fromSearch.initials || ''
                };
            }
            const p = messengerViewedProfile?.profile;
            if (p && String(p.id || '') === id) {
                const dn = p.displayName || p.name || id;
                return {
                    id,
                    name: p.name || dn,
                    displayName: dn,
                    avatar: p.avatar || '',
                    username: ensureUsername(p.username || ''),
                    statusText: p.statusText || '',
                    initials: p.initials || ''
                };
            }
            return { id, name: id, displayName: id, avatar: '', username: ensureUsername(''), statusText: '', initials: '' };
        }

        function resolveActiveMessengerChat() {
            let activeChat = messengerChats.find((item) => item.id === messengerActiveChatId) || null;
            if (!activeChat && messengerActiveChatId) {
                // Если это групповой чат, ищем его отдельно
                const groupChat = messengerChats.find((item) => 
                    String(item?.id || '') === String(messengerActiveChatId) && String(item?.kind || '') === 'group'
                );
                if (groupChat) {
                    activeChat = groupChat;
                } else if (messengerActivePeerId) {
                    const peer = resolvePeerDisplay(messengerActivePeerId);
                    activeChat = { id: messengerActiveChatId, peer, lastMessage: null };
                }
            }
            return activeChat;
        }

        function persistMessengerSessionChat(chatId) {
            try {
                const id = String(chatId || '').trim();
                if (id) sessionStorage.setItem(MESSENGER_SESSION_CHAT_KEY, id);
                else sessionStorage.removeItem(MESSENGER_SESSION_CHAT_KEY);
            } catch (_) {}
        }

        function persistMessengerSessionPeer(peerId) {
            try {
                const id = String(peerId || '').trim();
                if (id) sessionStorage.setItem(MESSENGER_SESSION_PEER_KEY, id);
                else sessionStorage.removeItem(MESSENGER_SESSION_PEER_KEY);
            } catch (_) {}
        }

        function restoreMessengerSessionPeer() {
            try {
                if (!authProfile?.appUserId) return;
                const chatId = String(sessionStorage.getItem(MESSENGER_SESSION_CHAT_KEY) || '').trim();
                if (chatId) {
                    messengerActiveChatId = chatId;
                    messengerActivePeerId = chatId.startsWith('dm:')
                        ? parsePeerIdFromDirectChatId(chatId, authProfile.appUserId)
                        : '';
                    messengerView = 'chats';
                    if (isMobileLayout()) isChatOpen = true;
                    return;
                }
                const peer = String(sessionStorage.getItem(MESSENGER_SESSION_PEER_KEY) || '').trim();
                if (!peer) return;
                messengerActivePeerId = peer;
                messengerActiveChatId = createDirectChatIdClient(authProfile.appUserId, peer);
                messengerView = 'chats';
                if (isMobileLayout()) isChatOpen = true;
            } catch (_) {}
        }

        function getMessengerPeerActivityState(peerId) {
            const id = String(peerId || '').trim();
            if (!id) return null;
            const v = messengerTypingByUser.get(id);
            if (!v) return null;
            if (typeof v === 'boolean') {
                return v ? { isTyping: true, activity: 'text', ts: Date.now() } : null;
            }
            if (typeof v !== 'object') return null;
            if (!v.isTyping) return null;
            const activity = v.activity === 'voice' ? 'voice' : 'text';
            return {
                isTyping: true,
                activity,
                ts: Number(v.ts || 0) || Date.now(),
                chatId: String(v.chatId || '').trim(),
                withUserId: String(v.withUserId || '').trim()
            };
        }

        function formatPeerStatusLine(peer, typingState) {
            if (!peer) return '';
            if (typingState && typingState.isTyping) {
                if (typingState.activity === 'voice') return 'записывает аудио';
                return 'печатает';
            }
            if (peer.online) return 'в сети';
            const ts = Number(peer.lastSeenAt || 0);
            if (ts > 0) {
                try {
                    return `Был в сети: ${new Date(ts).toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}`;
                } catch (_) {
                    return 'Был в сети';
                }
            }
            return 'не в сети';
        }

        function formatPresenceLabel(online, lastSeenAt, offlineFallback = 'Не в сети') {
            if (online) return 'В сети';
            const ts = Number(lastSeenAt || 0);
            if (ts > 0) {
                try {
                    return `Был(а) в сети ${new Date(ts).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}`;
                } catch (_) {
                    return 'Был(а) в сети недавно';
                }
            }
            return offlineFallback;
        }

        function getParticipantPresenceState(participant) {
            const id = String(participant?.userId || participant?.id || '').trim();
            const resolved = id ? resolvePeerDisplay(id) : null;
            const online = participant?.online === true
                || participant?.presence?.online === true
                || !!resolved?.online;
            const lastSeenAt = Number(participant?.lastSeenAt || participant?.presence?.lastSeenAt || resolved?.lastSeenAt || 0) || 0;
            return { online, lastSeenAt };
        }

        function getGroupChatParticipants(chat) {
            const out = [];
            const seen = new Set();
            const pushParticipant = (source) => {
                const memberId = String(source?.userId || source?.id || '').trim();
                if (!memberId || seen.has(memberId)) return;
                seen.add(memberId);
                const resolved = resolvePeerDisplay(memberId);
                out.push({
                    userId: memberId,
                    displayName: source?.displayName || resolved.displayName || resolved.name || memberId,
                    name: source?.name || resolved.name || resolved.displayName || memberId,
                    avatar: source?.avatar || resolved.avatar || '',
                    username: source?.username || resolved.username || '',
                    initials: source?.initials || resolved.initials || '',
                    online: source?.online ?? resolved.online ?? false,
                    lastSeenAt: Number(source?.lastSeenAt || resolved.lastSeenAt || 0) || 0
                });
            };
            if (Array.isArray(chat?.group?.participants)) {
                chat.group.participants.forEach(pushParticipant);
            }
            if (Array.isArray(chat?.group?.members)) {
                chat.group.members.forEach((memberId) => pushParticipant({ userId: String(memberId || '') }));
            }
            return out;
        }

        function isGroupParticipantOnline(participant) {
            if (!participant || typeof participant !== 'object') return false;
            return getParticipantPresenceState(participant).online;
        }

        function getGroupParticipantDisplayName(chat, userId) {
            const id = String(userId || '').trim();
            if (!id) return '';
            const participant = getGroupChatParticipants(chat).find((item) => String(item?.userId || item?.id || '') === id);
            if (participant) {
                return String(participant.displayName || participant.name || participant.userId || '').trim() || id;
            }
            const resolved = resolvePeerDisplay(id);
            return String(resolved.displayName || resolved.name || id).trim() || id;
        }

        function getGroupChatTypingState(chat) {
            if (!chat || !isGroupMessengerChat(chat)) return null;
            const chatId = String(chat.id || '').trim();
            if (!chatId) return null;
            const myId = String(authProfile?.appUserId || '').trim();
            const members = new Set(
                getGroupChatParticipants(chat)
                    .map((item) => String(item?.userId || item?.id || '').trim())
                    .filter(Boolean)
            );
            const textEntries = [];
            const voiceEntries = [];
            messengerTypingByUser.forEach((rawState, rawUserId) => {
                const userId = String(rawUserId || '').trim();
                if (!userId || userId === myId) return;
                const state = rawState && typeof rawState === 'object'
                    ? rawState
                    : (rawState ? { isTyping: true, activity: 'text', ts: Date.now() } : null);
                if (!state || !state.isTyping) return;
                const stateChatId = String(state.chatId || '').trim();
                if (stateChatId && stateChatId !== chatId) return;
                if (!stateChatId && members.size && !members.has(userId)) return;
                const entry = {
                    userId,
                    name: getGroupParticipantDisplayName(chat, userId),
                    ts: Number(state.ts || 0) || Date.now()
                };
                if (state.activity === 'voice') voiceEntries.push(entry);
                else textEntries.push(entry);
            });
            const entries = textEntries.length ? textEntries : voiceEntries;
            if (!entries.length) return null;
            entries.sort((a, b) => a.ts - b.ts);
            return {
                activity: textEntries.length ? 'text' : 'voice',
                entries
            };
        }

        function formatGroupedActivityNames(names) {
            const list = Array.isArray(names) ? names.filter(Boolean) : [];
            if (!list.length) return '';
            if (list.length === 1) return list[0];
            if (list.length === 2) return `${list[0]} и ${list[1]}`;
            if (list.length === 3) return `${list[0]}, ${list[1]} и ${list[2]}`;
            return `${list[0]}, ${list[1]} и ${list.length - 2}`;
        }

        function copyTextToClipboard(text, okMessage = 'Скопировано') {
            const value = String(text || '').trim();
            if (!value) return Promise.resolve(false);
            const fallback = () => {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            };
            return Promise.resolve()
                .then(() => {
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        return navigator.clipboard.writeText(value);
                    }
                    fallback();
                })
                .then(() => {
                    showNotification('', okMessage, 'info');
                    return true;
                })
                .catch(() => {
                    try {
                        fallback();
                        showNotification('', okMessage, 'info');
                        return true;
                    } catch (_) {
                        showNotification('', 'Не удалось скопировать', 'warning');
                        return false;
                    }
                });
        }

        function isEditableClipboardTarget(target) {
            try {
                const el = target && target.closest ? target.closest('input,textarea,[contenteditable="true"]') : null;
                return !!el;
            } catch (_) {
                return false;
            }
        }

        function initMessengerAntiCopyGuards() {
            if (window.__seychAntiCopyInit) return;
            window.__seychAntiCopyInit = true;
            const blockIfNotEditable = (e) => {
                if (isEditableClipboardTarget(e?.target)) return;
                try { e.preventDefault(); } catch (_) {}
            };
            document.addEventListener('copy', blockIfNotEditable, true);
            document.addEventListener('cut', blockIfNotEditable, true);
            document.addEventListener('paste', blockIfNotEditable, true);
            document.addEventListener('selectstart', blockIfNotEditable, true);
            document.addEventListener('contextmenu', blockIfNotEditable, true);
            document.addEventListener('dragstart', (e) => {
                const tag = String(e?.target?.tagName || '').toUpperCase();
                if (tag === 'IMG' || tag === 'VIDEO') {
                    try { e.preventDefault(); } catch (_) {}
                }
            }, true);
        }

        function getPeerByUsername(username, chat = null) {
            const key = String(username || '').replace(/^@+/, '').trim().toLowerCase();
            if (!key) return null;
            const candidates = [];
            const pushPeer = (peer) => {
                if (!peer || !peer.id) return;
                const uname = String(peer.username || '').replace(/^@+/, '').trim().toLowerCase();
                if (uname !== key) return;
                if (!candidates.some((item) => String(item.id) === String(peer.id))) candidates.push(peer);
            };
            if (chat && isGroupMessengerChat(chat)) {
                getGroupChatParticipants(chat).forEach((member) => {
                    const memberId = String(member?.userId || member?.id || '').trim();
                    if (!memberId) return;
                    const resolved = resolvePeerDisplay(memberId);
                    pushPeer({
                        ...resolved,
                        id: memberId,
                        username: member?.username || resolved?.username || '',
                        displayName: member?.displayName || member?.name || resolved?.displayName || resolved?.name || memberId,
                        name: member?.name || member?.displayName || resolved?.name || resolved?.displayName || memberId
                    });
                });
            }
            if (messengerActivePeerId) pushPeer(resolvePeerDisplay(messengerActivePeerId));
            (friendsState.friends || []).forEach((friend) => pushPeer(resolvePeerDisplay(friend.id)));
            (messengerChats || []).forEach((item) => {
                if (isDirectMessengerChat(item) && item.peer?.id) pushPeer(resolvePeerDisplay(item.peer.id));
            });
            return candidates[0] || null;
        }

        function openMentionProfile(username) {
            const activeChat = resolveActiveMessengerChat();
            const peer = getPeerByUsername(username, activeChat);
            if (!peer?.id) return;
            openUserProfile(peer.id);
        }

        function normalizeMentionUsername(value) {
            return String(value || '')
                .replace(/^@+/, '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
        }

        function getMyMentionUsername() {
            const u = normalizeMentionUsername(messengerProfile?.username || authProfile?.vkUsername || authProfile?.username || '');
            return u;
        }

        function doesMessageMentionMe(text) {
            const raw = String(text || '');
            if (!raw) return false;
            const myId = String(authProfile?.appUserId || '').trim();
            if (myId && raw.includes(`[[user:${myId}|`)) return true;
            const myUsername = getMyMentionUsername();
            if (!myUsername) return false;
            const esc = myUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(^|[^a-zA-Z0-9_])@${esc}(?=$|[^a-zA-Z0-9_])`, 'i');
            return re.test(raw);
        }

        function parseSystemUserTags(text) {
            const raw = String(text || '');
            const out = [];
            raw.replace(/\[\[user:([^\]|]{1,220})\|([^\]]{1,220})\]\]/g, (_, userId, label) => {
                out.push({
                    userId: String(userId || '').trim(),
                    label: String(label || '').trim()
                });
                return _;
            });
            return out;
        }

        function buildSystemNotificationFromMessage(chatId, msg) {
            const myId = String(authProfile?.appUserId || '').trim();
            const raw = String(msg?.text || '');
            if (!myId || String(msg?.messageKind || '') !== 'system' || !raw.includes(`[[user:${myId}|`)) return null;
            const tags = parseSystemUserTags(raw);
            const actor = tags[0] || null;
            const target = tags.find((tag) => String(tag?.userId || '') === myId) || null;
            if (!actor?.userId || !target) return null;
            
            const actorPeer = resolvePeerDisplay(actor.userId);
            const actorAvatar = String(actorPeer?.avatar || '').trim();
            const actorInitials = String(actorPeer?.initials || (actor.label || '').split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase() || '').trim();
            const durationMatch = raw.match(/на\s+([^.\n]+?)(?=\s+\[\[user:|\s+в чате|\.|$)/i);
            const reasonMatch = raw.match(/причина:\s*([^.\n]+)/i);
            const duration = String(durationMatch?.[1] || '').trim();
            const reason = String(reasonMatch?.[1] || '').trim();
            
            const lower = raw.toLowerCase();
            let text = '';
            if (lower.includes('добавил(а)') && lower.includes('в чат')) {
                text = `${actor.label} добавил(а) вас в чат`;
            } else if (lower.includes('исключил(а)')) {
                text = `${actor.label} исключил(а) вас из чата`;
            } else if (lower.includes('выдал(а) мут')) {
                text = `${actor.label} выдал(а) вам мут`;
            } else if (lower.includes('снял(а) мут')) {
                text = `${actor.label} снял(а) с вас мут`;
            } else if (lower.includes('выдал(а) блокировку чата')) {
                text = `${actor.label} заблокировал(а) вас в чате`;
            } else if (lower.includes('снял(а) блокировку чата')) {
                text = `${actor.label} снял(а) с вас блокировку чата`;
            } else {
                return null;
            }
            return {
                id: `system:${String(chatId || '').trim()}:${String(msg?.id || '').trim()}`,
                type: 'system',
                ...getMessengerNotificationChatMeta(chatId),
                actorId: actor.userId,
                actorName: actor.label || actor.userId,
                actorAvatar,
                actorInitials,
                messageId: String(msg?.id || '').trim(),
                title: 'Событие чата',
                text,
                duration,
                reason,
                createdAt: Number(msg?.createdAt || 0) || Date.now()
            };
        }

        function recordMessengerMention(chatId, msg) {
            const cid = String(chatId || '').trim();
            const mid = String(msg?.id || '').trim();
            if (!cid || !mid) return;
            const fromId = String(msg?.fromId || '').trim();
            const createdAt = Number(msg?.createdAt || 0) || Date.now();
            const preview = getMessageCopyableText(msg).slice(0, 180);
            const fromName = String(msg?.senderDisplayName || fromId || 'Пользователь');
            const fromAvatar = String(msg?.senderAvatar || '').trim();
            const fromInitials = String(msg?.senderInitials || (fromName || '').split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase() || '').trim();
            messengerMentions = [{ chatId: cid, messageId: mid, fromId, fromName, createdAt, preview }, ...(messengerMentions || [])].slice(0, 200);
            pushMessengerNotification({
                id: `mention:${cid}:${mid}`,
                type: 'mention',
                ...getMessengerNotificationChatMeta(cid),
                actorId: fromId,
                actorName: fromName,
                actorAvatar: fromAvatar,
                actorInitials: fromInitials,
                messageId: mid,
                title: 'Упоминание',
                text: `${fromName} упомянул(а) вас`,
                createdAt
            });
            if (String(messengerActiveChatId || '') !== cid || messengerView !== 'chats') {
                const prev = getMessengerMentionUnreadForChat(cid);
                setMessengerMentionUnreadForChat(cid, prev + 1);
            }
        }

        function getGroupChatStatusText(chat) {
            const typingState = getGroupChatTypingState(chat);
            if (typingState && Array.isArray(typingState.entries) && typingState.entries.length) {
                const names = typingState.entries.map((entry) => entry.name);
                const verb = typingState.activity === 'voice'
                    ? (names.length === 1 ? 'записывает аудио' : 'записывают аудио')
                    : (names.length === 1 ? 'печатает' : 'печатают');
                return `${formatGroupedActivityNames(names)} ${verb}`;
            }
            const participants = getGroupChatParticipants(chat);
            const count = participants.length;
            if (!count) return 'Групповой чат';
            const onlineCount = participants.filter(isGroupParticipantOnline).length;
            return `${count} участников, ${onlineCount} онлайн`;
        }

        function playIncomingMessengerSound() {
            try {
                const base = getBasePath().replace(/\/$/, '');
                const a = new Audio(`${window.location.origin}${base}/upload/message.mp3`);
                a.volume = 0.55;
                a.play().catch(() => {});
            } catch (_) {}
        }

        function applyMessengerPresencePatch(userId, online, lastSeenAt) {
            const pid = String(userId || '').trim();
            if (!pid) return;
            const ts = Number(lastSeenAt) || Date.now();
            messengerChats = (messengerChats || []).map((c) => {
                const isDirectPeer = String(c.peer?.id || '') === pid;
                const isGroupChat = isGroupMessengerChat(c);
                if (!isDirectPeer && !isGroupChat) return c;
                let nextChat = c;
                if (isDirectPeer) {
                    nextChat = {
                        ...nextChat,
                        peer: {
                            ...(nextChat.peer || {}),
                            online: !!online,
                            lastSeenAt: ts
                        }
                    };
                }
                if (isGroupChat && Array.isArray(nextChat.group?.participants)) {
                    let changed = false;
                    const nextParticipants = nextChat.group.participants.map((participant) => {
                        if (String(participant?.userId || participant?.id || '') !== pid) return participant;
                        changed = true;
                        return {
                            ...participant,
                            online: !!online,
                            lastSeenAt: ts
                        };
                    });
                    if (changed) {
                        nextChat = {
                            ...nextChat,
                            group: {
                                ...(nextChat.group || {}),
                                participants: nextParticipants
                            }
                        };
                    }
                }
                if (nextChat !== c && isGroupChat) {
                    nextChat = {
                        ...nextChat,
                        peer: {
                            ...(nextChat.peer || {}),
                            statusText: getGroupChatStatusText(nextChat)
                        }
                    };
                }
                return nextChat;
            });
        }

        const STARTUP_VERSION_STORAGE_KEY = 'seych-runtime-signature';

        function hashIdentityPart(value, seed = 5381) {
            let hash = seed >>> 0;
            const input = String(value || '');
            for (let i = 0; i < input.length; i++) {
                hash = (((hash << 5) + hash) ^ input.charCodeAt(i)) >>> 0;
            }
            return hash.toString(16).padStart(8, '0');
        }

        function computeRuntimeSignature() {
            try {
                const scriptTag = document.currentScript || document.querySelector('script:last-of-type');
                const source = String(scriptTag?.textContent || '');
                const signature = hashIdentityPart(source, 2166136261) + hashIdentityPart(source, 5381);
                return signature;
            } catch (_) {
                return '';
            }
        }

        function hasRuntimeUpdated() {
            const signature = computeRuntimeSignature();
            if (!signature) return false;
            try {
                const previous = String(localStorage.getItem(STARTUP_VERSION_STORAGE_KEY) || '').trim();
                return previous !== signature;
            } catch (_) {
                return false;
            }
        }

        function persistRuntimeSignature() {
            const signature = computeRuntimeSignature();
            if (!signature) return;
            try {
                localStorage.setItem(STARTUP_VERSION_STORAGE_KEY, signature);
            } catch (_) {}
        }

        function showStartupLoader() {
            const root = document.getElementById('startupLoader');
            const titleEl = document.getElementById('startupLoaderTitle');
            const marqueeEl = document.getElementById('startupLoaderMarquee');
            if (!root || !titleEl || !marqueeEl) return;
            root.setAttribute('aria-hidden', 'false');
            root.classList.add('visible');
            const titles = ['Загружаем', 'Обновляем', 'Запускаем'];
            let frame = 0;
            if (startupLoaderTicker) {
                clearInterval(startupLoaderTicker);
                startupLoaderTicker = null;
            }
            startupLoaderTicker = setInterval(() => {
                const dots = '.'.repeat((frame % 3) + 1);
                titleEl.textContent = titles[Math.floor(frame / 2) % titles.length];
                marqueeEl.textContent = `Загрузка${dots}`;
                frame += 1;
            }, 360);
        }

        function hideStartupLoader() {
            const root = document.getElementById('startupLoader');
            if (startupLoaderTicker) {
                clearInterval(startupLoaderTicker);
                startupLoaderTicker = null;
            }
            if (!root) return;
            root.classList.remove('visible');
            root.setAttribute('aria-hidden', 'true');
        }

