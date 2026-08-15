        function endCall(playLeaveSound = true) {
            if (playLeaveSound) {
                playSoundEffect(leaveSoundEffect);
            }
            cancelPendingOutgoingFriendCall('caller_left');
            stopCallAudioHealTimer();
            isConnected = false;
            roomId = null;
            currentGroupCallChatId = '';
            currentGroupCallTitle = '';
            connectionNoticeCooldown.clear();
            participantConnectionQuality.clear();
            durakGameState = null;
            applyDurakFocusMode(false);
            syncDurakCallScreenClasses(null);
            applyWatchFocusMode(false);
            stopCallTimer();
            clearOutgoingFriendCallSession();
            callMinimized = false;
            cancelAnimationFrame(animationId);
            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }
            wsReconnectAttempts = 0;
            wsLastInitialMsg = null;
            peers.forEach(peer => peer.destroy());
            peers.clear();
            stopRemoteAudio();
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            if (videoTrack) videoTrack.stop();
            ws?.send(JSON.stringify({ type: 'leave' }));
            if (ws) {
                ws.__closingByUser = true;
            }
            ws?.close();
            history.replaceState(null, '', getBasePath());
            try {
                const csr = document.getElementById('callScreenRoot');
                if (csr) csr.remove();
            } catch (_) {}
            renderMainScreen();
            const appEl = document.getElementById('app');
            if (appEl) {
                appEl.style.display = '';
                appEl.style.pointerEvents = '';
            }
            showNotification('Звонок', 'Вы покинули комнату', 'info');
        }

        function syncCallScreenLayoutMode() {
            const root = document.getElementById('callScreenRoot');
            const appEl = document.getElementById('app');
            if (!roomId) {
                if (root) root.style.display = 'none';
                if (appEl) {
                    appEl.style.display = '';
                    appEl.style.pointerEvents = '';
                }
                const isl = document.getElementById('callIsland');
                if (isl) isl.remove();
                return;
            }
            if (root) {
                root.classList.remove('call-screen--pip');
                root.style.cursor = '';
                root.onclick = null;
                root.style.display = callMinimized ? 'none' : '';
            }
            if (appEl) {
                if (callMinimized) {
                    appEl.style.display = '';
                    appEl.style.pointerEvents = '';
                } else {
                    appEl.style.display = 'none';
                    appEl.style.pointerEvents = 'none';
                }
            }
            renderCallIslandWidget();
        }

        function renderCallScreen() {
            let root = document.getElementById('callScreenRoot');
            if (!root) {
                root = document.createElement('div');
                root.id = 'callScreenRoot';
                document.body.appendChild(root);
            }
            if (!root.dataset.callBuilt) {
                root.className = 'call-screen';
                root.innerHTML = `
                <button type="button" class="ctrl-btn call-minimize-fab" onclick="minimizeCallToIsland()" title="Свернуть">
                    <i class="fas fa-comment-dots"></i>
                    <span id="callUnreadBadge" class="call-unread-badge" style="display:none;">0</span>
                </button>
                    <div class="call-topbar" id="callTopbar">
                        <i class="fas fa-phone-alt"></i>
                        <span class="call-timer" id="callTimer">00:00</span>
                        <span id="roomPrivacyBadge" class="room-status ${roomIsPrivate ? 'private' : 'public'}" title="${roomIsPrivate ? 'Закрытая' : 'Публичная'}"><i class="fas ${roomIsPrivate ? 'fa-lock' : 'fa-globe'}"></i></span>
                    </div>
                    <div class="videos" id="videosContainer">
                        <div class="waiting" id="waitingMsg">
                            <h3><i class="fas fa-clock"></i> Ожидание подключения...</h3>
                            <p>${isCreator ? 'Отправьте ID другу' : 'Ожидаем создателя комнаты'}</p>
                        </div>
                    </div>
                    <div class="participants-panel">
                        <div class="participants-header">
                            <span style="display:flex;align-items:center;gap:8px;">
                                <button id="participantsCloseBtn" class="close-participants" style="position:static;display:${isMobileLayout() ? 'inline-flex' : 'none'};" onclick="closeParticipantsPanel()"><i class="fas fa-times"></i></button>
                                <i class="fas fa-users"></i> Участники
                            </span>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <button id="roomSettingsBtn" class="close-participants" style="position:static;width:32px;height:32px;display:${canManageRoom() ? 'inline-flex' : 'none'};" onclick="showRoomSettingsMenu(event)"><i class="fas fa-ellipsis-v"></i></button>
                            </div>
                        </div>
                        <div class="participants-list" id="participantsList"></div>
                    </div>
                    <div class="toggle-participants" onclick="toggleParticipantsPanel()">
                        <i class="fas fa-users"></i>
                    </div>
                    <div class="copy-id" onclick="copyRoomId()" title="Скопировать ID"><i id="copyInviteIcon" class="fas fa-id-card"></i></div>
                    <button type="button" class="call-settings-btn" onclick="showCallSettingsModal()" title="Настройки звонка"><i class="fas fa-ellipsis-v"></i></button>
                    <div class="call-bottom-bar">
                        <button type="button" class="ctrl-btn" id="durakBtn" title="Дурак" onclick="onDurakToolbarClick()"><i class="fas fa-gamepad"></i></button>
                        <div class="controls">
                        <button class="ctrl-btn active" id="videoBtn" onclick="toggleVideo()"><i class="fas fa-video"></i></button>
                        <button class="ctrl-btn flip" id="flipCameraBtn" onclick="switchCameraFacingMode()" style="display:none"><i class="fas fa-sync-alt"></i></button>
                        <button class="ctrl-btn active" id="audioBtn" onclick="toggleAudio()"><i class="fas fa-microphone"></i></button>
                        <button class="ctrl-btn screen" id="screenBtn" onclick="startScreenShare()"><i class="fas fa-desktop"></i></button>
                        <button class="ctrl-btn watch" id="watchBtn" onclick="showWatchPartyModal()"><i class="fas fa-users-viewfinder"></i></button>
                        <button class="ctrl-btn watch-stop" id="stopWatchBtn" onclick="stopWatchParty()" style="display:none"><i class="fas fa-stop"></i></button>
                        <button class="ctrl-btn end" onclick="endCall()"><i class="fas fa-phone-slash"></i></button>
                        </div>
                        <button type="button" id="durakCallPanelToggle" class="durak-call-panel-toggle" onclick="toggleDurakCallPanel()" title="Панель звонка"><i class="fas fa-chevron-up"></i></button>
                    </div>`;
                root.dataset.callBuilt = '1';
            }
            updateCallMinimizeUnreadBadge();
            syncCallScreenLayoutMode();
            applyWatchFocusMode(false);
            applyCallScreenPerformanceMode();
            updateParticipantsResponsiveUI();
            updateUI();
            updateEmptyState();
            setTimeout(() => ensureDurakControlButton(), 0);
        }

        function showJoinModal() {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2><i class="fas fa-link"></i> Подключиться</h2>
                    <input type="text" id="roomInput" class="modal-input" placeholder="Вставьте ссылку или ID комнаты">
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" id="modalCancel">Отмена</button>
                        <button class="modal-btn confirm" id="modalConfirm">Подключиться</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            document.getElementById('modalConfirm').onclick = () => {
                const parsedRoomId = parseRoomInput(document.getElementById('roomInput').value);
                if (parsedRoomId) { modal.remove(); joinRoom(parsedRoomId); }
                else showNotification('Ошибка', 'Укажите корректную ссылку или ID вида id123', 'error');
            };
            document.getElementById('modalCancel').onclick = () => {
                modal.remove();
            };
        }

        function setFriendsTab(tab) {
            friendsActiveTab = tab === 'requests' ? 'requests' : 'friends';
            renderMainScreen();
        }

        function toggleFriendsHomePanel() {
            friendsPanelOpenMobile = !friendsPanelOpenMobile;
            renderMainScreen();
        }

        function closeFriendsHomePanel() {
            friendsPanelOpenMobile = false;
            renderMainScreen();
        }

        function onFriendsSearchInput(event) {
            friendsSearchValue = String(event?.target?.value || '');
            clearTimeout(friendsSearchDebounceTimer);
            friendsSearchDebounceTimer = setTimeout(() => {
                friendsSearchDebounceTimer = null;
                searchFriendsUsers();
            }, 400);
        }

        function copyAppUserId() {
            if (!authProfile?.appUserId) return;
            navigator.clipboard.writeText(authProfile.appUserId);
            showNotification('Друзья', 'ID аккаунта скопирован', 'success');
        }

        function showFriendsSettingsMenu(event) {
            event.preventDefault();
            event.stopPropagation();
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.innerHTML = `
                <div class="context-item" onclick="persistFriendsNotifyValue(${!friendsNotificationsEnabled})">
                    <i class="fas ${friendsNotificationsEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    Push уведомления: ${friendsNotificationsEnabled ? 'Вкл' : 'Выкл'}
                </div>
            `;
            document.body.appendChild(menu);
            const rect = event.currentTarget.getBoundingClientRect();
            placeContextMenu(menu, rect.right - menu.offsetWidth, rect.bottom + 8, rect.top - 8);
            setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
        }

        function buildFriendItemRow(user, actionsHtml) {
            const label = user?.displayName || user?.name || user?.id || '';
            const name = escapeHtml(label);
            const id = escapeHtml(user?.id || '');
            const rawId = String(user?.id || '').replace(/'/g, "\\'");
            const avatar = avatarMarkup(label, user?.avatar || '', user?.initials);
            return `
                <div class="contact-item" onclick="openMessengerChat('${rawId}')" style="cursor:pointer;">
                    <div class="participant-info">
                        <div class="participant-avatar" style="width:36px;height:36px;min-width:36px">${avatar}</div>
                        <div>
                            <div class="contact-name">${name}</div>
                            <div class="contact-chat">ID: ${id}</div>
                        </div>
                    </div>
                    <div class="contact-actions" onclick="event.stopPropagation()">${actionsHtml}</div>
                </div>
            `;
        }

        function renderFriendsTabContent() {
            const query = friendsSearchValue.trim();
            const friends = Array.isArray(friendsState.friends) ? friendsState.friends : [];
            const incomingRequests = Array.isArray(friendsState.incomingRequests) ? friendsState.incomingRequests : [];
            let html = '<div class="contacts-list">';
            if (query) {
                const results = Array.isArray(friendsSearchResults) ? friendsSearchResults : [];
                if (!results.length) {
                    html += `<div class="friends-empty">По вашему запросу никто не найден</div>`;
                } else {
                    results.forEach((result) => {
                        let actionsHtml = `<button class="contact-btn" title="Профиль" onclick="openUserProfile('${result.id}')"><i class="fas fa-user"></i></button>`;
                        if (result.isFriend) {
                            actionsHtml += `<button class="contact-btn" title="Добавить в чат" onclick="openAddUserToGroupModal('${result.id}')"><i class="fas fa-comments"></i></button>`;
                        } else if (result.outgoingPending) {
                            actionsHtml += '<button class="contact-btn secondary" title="Запрос отправлен"><i class="fas fa-clock"></i></button>';
                        } else if (result.incomingPending) {
                            const req = incomingRequests.find((item) => item.fromId === result.id);
                            if (req?.requestId) {
                                actionsHtml += `<button class="contact-btn" title="Принять" onclick="handleFriendRequest('${req.requestId}','accept')"><i class="fas fa-check"></i></button>`;
                            } else {
                                actionsHtml += '<button class="contact-btn secondary" title="Входящий запрос"><i class="fas fa-inbox"></i></button>';
                            }
                        } else {
                            actionsHtml += `<button class="contact-btn" title="Написать" onclick="openMessengerChat('${result.id}')"><i class="fas fa-paper-plane"></i></button>`;
                            actionsHtml += `<button class="contact-btn" title="Добавить" onclick="sendFriendRequest('${result.id}')"><i class="fas fa-user-plus"></i></button>`;
                        }
                        html += buildFriendItemRow(result, actionsHtml);
                    });
                }
                html += '</div>';
                return html;
            }
            if (!friends.length) {
                html += `<div class="friends-empty">Пока нет друзей. Используйте поиск по ID аккаунта.</div>`;
            } else {
                friends.forEach((friend) => {
                    const actions = `
                        <button class="contact-btn" title="Профиль" onclick="openUserProfile('${friend.id}')"><i class="fas fa-user"></i></button>
                        <button class="contact-btn" title="Написать" onclick="openMessengerChat('${friend.id}')"><i class="fas fa-paper-plane"></i></button>
                        <button class="contact-btn" title="Добавить в чат" onclick="openAddUserToGroupModal('${friend.id}')"><i class="fas fa-comments"></i></button>
                        <button class="contact-btn" title="Позвонить" onclick="callFriend('${friend.id}')"><i class="fas fa-phone"></i></button>
                        <button class="contact-btn delete" title="Удалить" onclick="deleteFriend('${friend.id}')"><i class="fas fa-user-times"></i></button>
                    `;
                    html += buildFriendItemRow(friend, actions);
                });
            }
            html += '</div>';
            return html;
        }

        function renderRequestsTabContent() {
            const incoming = Array.isArray(friendsState.incomingRequests) ? friendsState.incomingRequests : [];
            const outgoing = Array.isArray(friendsState.outgoingRequests) ? friendsState.outgoingRequests : [];
            const incomingCalls = Array.isArray(friendsState.incomingCalls) ? friendsState.incomingCalls : [];
            let html = '<div class="contacts-list">';
            if (!incoming.length && !outgoing.length && !incomingCalls.length) {
                html += `<div class="friends-empty">Нет активных запросов</div>`;
            }
            incomingCalls.forEach((invite) => {
                const actions = `
                    <button class="contact-btn" onclick="replyIncomingCall('${invite.inviteId}','answer')">Ответить</button>
                    <button class="contact-btn delete" onclick="replyIncomingCall('${invite.inviteId}','decline')">Сбросить</button>
                `;
                html += buildFriendItemRow({ id: invite.fromId, name: invite.fromName, avatar: invite.fromAvatar }, actions);
            });
            incoming.forEach((request) => {
                const actions = `
                    <button class="contact-btn" onclick="handleFriendRequest('${request.requestId}','accept')">Принять</button>
                    <button class="contact-btn delete" onclick="handleFriendRequest('${request.requestId}','decline')">Отклонить</button>
                `;
                html += buildFriendItemRow({ id: request.fromId, name: request.name, avatar: request.avatar }, actions);
            });
            outgoing.forEach((request) => {
                const actions = '<button class="contact-btn secondary">Ожидает ответа</button>';
                html += buildFriendItemRow({ id: request.toId, name: request.name, avatar: request.avatar }, actions);
            });
            html += '</div>';
            return html;
        }

        function getMessengerSocketReady() {
            return !!ws && ws.readyState === WebSocket.OPEN;
        }

        function sendMessengerEvent(payload) {
            if (!payload) return false;
            if (getMessengerSocketReady()) {
                try {
                    ws.send(JSON.stringify(payload));
                    return true;
                } catch (_) {
                    return false;
                }
            }
            pendingMessengerEvents.push(payload);
            if (!roomId && authProfile?.appUserId) {
                connectWS({
                    type: 'messenger-register',
                    appUserId: authProfile.appUserId || appUserId,
                    userName: authProfile.name || userName || '',
                    userAvatar: authProfile.avatar || ''
                });
            }
            return true;
        }

        function flushPendingMessengerEvents() {
            if (!getMessengerSocketReady() || !pendingMessengerEvents.length) return;
            const queue = pendingMessengerEvents.slice();
            pendingMessengerEvents = [];
            queue.forEach((payload) => {
                try { ws.send(JSON.stringify(payload)); } catch (_) {}
            });
        }

        function syncMessengerIdentity() {
            if (!authProfile?.appUserId) return;
            sendMessengerEvent({
                type: 'messenger-register',
                appUserId: authProfile.appUserId,
                userName: authProfile.name || userName || '',
                userAvatar: authProfile.avatar || '',
                username: ensureGeneratedMessengerUsername(messengerProfile.username || authProfile.vkUsername || '', authProfile.appUserId),
                statusText: messengerProfile.statusText || '',
                privacy: messengerProfile.privacy,
                blacklist: messengerProfile.blacklist
            });
            sendMessengerEvent({ type: 'messenger-sync' });
            if (messengerActiveChatId) {
                sendMessengerEvent({ type: 'messenger-open-chat', chatId: messengerActiveChatId });
            }
            // Load stories after registration
            setTimeout(() => loadStories(), 1000);
        }

        function setMessengerView(view) {
            messengerView = view;
            mobileNavDrawerOpen = false;
            if (view === 'chats') {
                isChatOpen = false;
            }
            if (view === 'notifications') {
                markMessengerNotificationsRead();
            }
            if (view === 'profile') {
                messengerViewedProfile = null;
            }
            if (view === 'calls' && roomId) {
                restoreCallFromIsland();
                return;
            }
            renderMainScreen();
        }

        function getStoredMessengerProfile() {
            try {
                const raw = localStorage.getItem('seych-messenger-profile');
                const parsed = raw ? JSON.parse(raw) : {};
                return {
                    username: ensureGeneratedMessengerUsername(String(parsed?.username || authProfile?.vkUsername || '').replace(/^@+/, '').trim(), authProfile?.appUserId || appUserId),
                    statusText: String(parsed?.statusText || '').trim(),
                    privacy: {
                        canWrite: ['all', 'friends', 'nobody'].includes(parsed?.privacy?.canWrite) ? parsed.privacy.canWrite : 'all',
                        canCall: ['all', 'friends', 'nobody'].includes(parsed?.privacy?.canCall) ? parsed.privacy.canCall : 'all',
                        canViewProfile: ['all', 'friends', 'nobody'].includes(parsed?.privacy?.canViewProfile) ? parsed.privacy.canViewProfile : 'all',
                        canSeeStories: ['all', 'friends', 'nobody'].includes(parsed?.privacy?.canSeeStories) ? parsed.privacy.canSeeStories : 'friends',
                        canJoinGroups: ['all', 'friends', 'nobody'].includes(parsed?.privacy?.canJoinGroups) ? parsed.privacy.canJoinGroups : 'friends'
                    },
                    blacklist: Array.isArray(parsed?.blacklist) ? parsed.blacklist.map((v) => String(v || '').trim()).filter(Boolean) : []
                };
            } catch (_) {
                return { username: '', statusText: '', privacy: { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' }, blacklist: [] };
            }
        }

        function persistMessengerProfileLocal() {
            localStorage.setItem('seych-messenger-profile', JSON.stringify(messengerProfile));
        }

        function compressImageToJpegDataUrl(file, maxDim, quality) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        let w = img.naturalWidth || img.width;
                        let h = img.naturalHeight || img.height;
                        const scale = w && h ? Math.min(1, maxDim / Math.max(w, h)) : 1;
                        w = Math.max(1, Math.round(w * scale));
                        h = Math.max(1, Math.round(h * scale));
                        const c = document.createElement('canvas');
                        c.width = w;
                        c.height = h;
                        const ctx = c.getContext('2d');
                        if (!ctx) {
                            reject(new Error('canvas'));
                            return;
                        }
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(c.toDataURL('image/jpeg', quality));
                    };
                    img.onerror = () => reject(new Error('image'));
                    img.src = r.result;
                };
                r.onerror = () => reject(new Error('read'));
                r.readAsDataURL(file);
            });
        }

        let profileUsernameLastChecked = '';
        let profileUsernameLastAvailable = true;

        function scheduleProfileUsernameCheck(value) {
            const username = normalizeMessengerUsernameValue(value);
            const statusEl = document.getElementById('profileUsernameStatus');
            if (profileUsernameCheckTimer) {
                clearTimeout(profileUsernameCheckTimer);
                profileUsernameCheckTimer = 0;
            }
            if (!statusEl) return;
            if (!username) {
                profileUsernameLastChecked = '';
                profileUsernameLastAvailable = true;
                statusEl.dataset.state = 'idle';
                statusEl.textContent = 'Введите username';
                return;
            }
            statusEl.dataset.state = 'idle';
            statusEl.textContent = 'Проверяем username...';
            profileUsernameCheckTimer = setTimeout(() => {
                profileUsernameCheckTimer = 0;
                profileUsernameLastChecked = username.toLowerCase();
                sendMessengerEvent({ type: 'messenger-check-username', username });
            }, 260);
        }

        function openProfileEditModal() {
            let pendingAvatar = null;
            let pendingCover = null;
            const initialAvatar = String(authProfile?.avatar || '').trim();
            const initialCover = String(authProfile?.coverUrl || '').trim();
            const initialName = String(authProfile?.name || '').trim();
            const initialUsername = ensureGeneratedMessengerUsername(messengerProfile.username || authProfile?.vkUsername || '', authProfile?.appUserId || appUserId);
            const initialStatus = String(messengerProfile.statusText || '').trim();
            const initials = (String(authProfile?.initials || '').trim() || String(initialName || authProfile?.appUserId || 'U')
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part.charAt(0))
                .join('')
                .slice(0, 2)
                .toUpperCase()) || 'U';
            profileUsernameLastChecked = initialUsername.toLowerCase();
            profileUsernameLastAvailable = true;

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content modal-sheet modal-sheet--pc-dialog profile-edit-modal">
                    <div class="modal-sheet-header">
                        <div class="modal-sheet-title"><i class="fas fa-user-edit"></i><span>Редактировать профиль</span></div>
                        <button type="button" class="modal-sheet-close" id="profileModalCancel" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-sheet-body">
                        <div class="profile-edit-cover" style="height:220px;margin-bottom:86px;">
                            <div id="profileCoverPreview" class="profile-edit-cover-media"></div>
                            <div class="profile-edit-cover-overlay"></div>
                            <div class="profile-edit-avatar-dock">
                                <div class="profile-edit-avatar-wrap">
                                    <div id="profileAvatarPreview" class="profile-edit-avatar-core"></div>
                                </div>
                                <div class="profile-edit-avatar-actions" style="flex-wrap:wrap;">
                                    <button type="button" class="profile-edit-icon-btn" id="profileAvatarPick" title="Сменить аватар">
                                        <i class="fas fa-camera"></i><span>Сменить аватар</span>
                                    </button>
                                    <button type="button" class="profile-edit-icon-btn delete" id="profileAvatarRemove" title="Удалить аватар">
                                        <i class="fas fa-trash"></i><span>Удалить</span>
                                    </button>
                                </div>
                            </div>
                            <div class="profile-edit-cover-actions">
                                <button type="button" class="profile-edit-icon-btn" id="profileCoverPick" title="Сменить обложку">
                                    <i class="fas fa-image"></i><span>Сменить обложку</span>
                                </button>
                                <button type="button" class="profile-edit-icon-btn delete" id="profileCoverRemove" title="Удалить обложку">
                                    <i class="fas fa-times"></i><span>Удалить</span>
                                </button>
                            </div>
                        </div>
                        <input type="file" id="profileAvatarInput" accept="image/*" style="display:none">
                        <input type="file" id="profileCoverInput" accept="image/*" style="display:none">
                        <div class="profile-edit-fields">
                            <label class="profile-field-label" for="profileNameInput">Имя</label>
                            <input id="profileNameInput" class="modal-input" placeholder="Имя" maxlength="120" value="${escapeHtml(initialName)}" style="text-align:left;">
                            <label class="profile-field-label" for="profileUsernameInput">Username</label>
                            <input id="profileUsernameInput" class="modal-input" placeholder="username" maxlength="64" value="${escapeHtml(initialUsername)}" style="text-align:left;">
                            <div id="profileUsernameStatus" class="profile-username-status" data-state="idle">Введите username</div>
                            <label class="profile-field-label" for="profileStatusInput">Описание</label>
                            <textarea id="profileStatusInput" class="modal-input" placeholder="Описание" maxlength="160" style="min-height:120px;resize:vertical;text-align:left;">${escapeHtml(initialStatus)}</textarea>
                        </div>
                    </div>
                    <div class="modal-buttons" style="flex-shrink:0;">
                        <button class="modal-btn cancel" id="profileModalBack">Отмена</button>
                        <button class="modal-btn confirm" id="profileModalSave">Сохранить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const avatarPreviewEl = document.getElementById('profileAvatarPreview');
            const coverPreviewEl = document.getElementById('profileCoverPreview');
            const avatarInputEl = document.getElementById('profileAvatarInput');
            const coverInputEl = document.getElementById('profileCoverInput');
            const usernameInputEl = document.getElementById('profileUsernameInput');
            const usernameStatusEl = document.getElementById('profileUsernameStatus');

            const avatarPickBtn = document.getElementById('profileAvatarPick');
            const avatarRemoveBtn = document.getElementById('profileAvatarRemove');
            const coverPickBtn = document.getElementById('profileCoverPick');
            const coverRemoveBtn = document.getElementById('profileCoverRemove');

            const syncMediaActionButtons = () => {
                const hasAvatar = !!String(pendingAvatar != null ? pendingAvatar : initialAvatar).trim();
                const hasCover = !!String(pendingCover != null ? pendingCover : initialCover).trim();
                if (avatarPickBtn) avatarPickBtn.querySelector('span').textContent = hasAvatar ? 'Сменить аватар' : 'Загрузить аватар';
                if (coverPickBtn) coverPickBtn.querySelector('span').textContent = hasCover ? 'Сменить обложку' : 'Загрузить обложку';
                if (avatarRemoveBtn) avatarRemoveBtn.style.display = hasAvatar ? '' : 'none';
                if (coverRemoveBtn) coverRemoveBtn.style.display = hasCover ? '' : 'none';
            };

            const renderAvatarPreview = (url) => {
                if (!avatarPreviewEl) return;
                if (url) {
                    avatarPreviewEl.innerHTML = `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">`;
                } else {
                    avatarPreviewEl.textContent = initials;
                }
            };

            const renderCoverPreview = (coverUrl, avatarUrl) => {
                if (!coverPreviewEl) return;
                const style = profileCoverBackgroundStyle(coverUrl, avatarUrl);
                coverPreviewEl.className = `profile-edit-cover-media ${String(coverUrl || '').trim() ? '' : 'is-fallback'}`.trim();
                coverPreviewEl.setAttribute('style', style || '');
            };

            renderAvatarPreview(initialAvatar);
            renderCoverPreview(initialCover, initialAvatar);
            syncMediaActionButtons();
            if (usernameStatusEl) {
                usernameStatusEl.dataset.state = initialUsername ? 'ok' : 'idle';
                usernameStatusEl.textContent = initialUsername ? 'Username свободен' : 'Введите username';
            }

            document.getElementById('profileAvatarPick').onclick = () => avatarInputEl && avatarInputEl.click();
            document.getElementById('profileCoverPick').onclick = () => coverInputEl && coverInputEl.click();
            document.getElementById('profileAvatarRemove').onclick = () => {
                pendingAvatar = '';
                renderAvatarPreview('');
                renderCoverPreview(pendingCover != null ? pendingCover : initialCover, '');
                syncMediaActionButtons();
            };
            document.getElementById('profileCoverRemove').onclick = () => {
                pendingCover = '';
                renderCoverPreview('', pendingAvatar != null ? pendingAvatar : initialAvatar);
                syncMediaActionButtons();
            };

            avatarInputEl.onchange = async () => {
                const file = avatarInputEl.files && avatarInputEl.files[0];
                if (!file || !/^image\//i.test(file.type || '')) return;
                try {
                    pendingAvatar = await compressImageToJpegDataUrl(file, 512, 0.85);
                    renderAvatarPreview(pendingAvatar);
                    renderCoverPreview(pendingCover != null ? pendingCover : initialCover, pendingAvatar);
                    syncMediaActionButtons();
                } catch (_) {
                    showNotification('Аватар', 'Не удалось обработать изображение', 'warning');
                }
                avatarInputEl.value = '';
            };

            coverInputEl.onchange = async () => {
                const file = coverInputEl.files && coverInputEl.files[0];
                if (!file || !/^image\//i.test(file.type || '')) return;
                try {
                    pendingCover = await compressImageToJpegDataUrl(file, 1600, 0.82);
                    renderCoverPreview(pendingCover, pendingAvatar != null ? pendingAvatar : initialAvatar);
                    syncMediaActionButtons();
                } catch (_) {
                    showNotification('Обложка', 'Не удалось обработать изображение', 'warning');
                }
                coverInputEl.value = '';
            };

            usernameInputEl.addEventListener('input', () => {
                const clean = normalizeMessengerUsernameValue(usernameInputEl.value || '');
                if (usernameInputEl.value !== clean) usernameInputEl.value = clean;
                scheduleProfileUsernameCheck(clean);
            });

            document.getElementById('profileModalCancel').onclick = () => {
                if (profileUsernameCheckTimer) clearTimeout(profileUsernameCheckTimer);
                modal.remove();
            };

            document.getElementById('profileModalBack').onclick = () => {
                if (profileUsernameCheckTimer) clearTimeout(profileUsernameCheckTimer);
                modal.remove();
            };

            document.getElementById('profileModalSave').onclick = () => {
                const name = String(document.getElementById('profileNameInput')?.value || '').trim() || authProfile?.name || 'Пользователь';
                const username = normalizeMessengerUsernameValue(usernameInputEl?.value || '');
                const statusText = String(document.getElementById('profileStatusInput')?.value || '').trim();
                const normalizedChecked = String(profileUsernameLastChecked || '').trim();
                if (username && normalizedChecked === username.toLowerCase() && !profileUsernameLastAvailable) {
                    showNotification('Username', 'Этот username уже занят', 'warning');
                    usernameInputEl?.focus();
                    return;
                }
                const avatarOut = pendingAvatar != null ? pendingAvatar : initialAvatar;
                const coverOut = pendingCover != null ? pendingCover : initialCover;
                saveProfile({ ...authProfile, name, vkUsername: username, avatar: avatarOut, coverUrl: coverOut });
                messengerProfile.username = username;
                messengerProfile.statusText = statusText;
                persistMessengerProfileLocal();
                sendMessengerEvent({ type: 'messenger-update-profile', name, username, statusText, avatar: avatarOut, coverUrl: coverOut });
                if (profileUsernameCheckTimer) clearTimeout(profileUsernameCheckTimer);
                modal.remove();
                renderMainScreen();
            };
        }

        function setPrivacyRule(kind, value) {
            const safe = ['all', 'friends', 'nobody'].includes(value) ? value : 'all';
            if (!messengerProfile.privacy) messengerProfile.privacy = { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' };
            messengerProfile.privacy[kind] = safe;
            persistMessengerProfileLocal();
            document.querySelectorAll('.privacy-dd-panel').forEach((p) => p.classList.remove('open'));
            sendMessengerEvent({
                type: 'messenger-update-privacy',
                canWrite: messengerProfile.privacy.canWrite,
                canCall: messengerProfile.privacy.canCall,
                canViewProfile: messengerProfile.privacy.canViewProfile,
                canSeeStories: messengerProfile.privacy.canSeeStories,
                canJoinGroups: messengerProfile.privacy.canJoinGroups
            });
            renderMainScreen();
        }

        function togglePrivacyDropdown(triggerBtn, event) {
            if (event) event.stopPropagation();
            const panel = triggerBtn && triggerBtn.nextElementSibling;
            if (!panel) return;
            const willOpen = !panel.classList.contains('open');
            document.querySelectorAll('.privacy-dd-panel').forEach((p) => p.classList.remove('open'));
            if (willOpen) panel.classList.add('open');
        }

        function renderPrivacyDropdown(kindKey, currentVal) {
            const safe = ['all', 'friends', 'nobody'].includes(currentVal) ? currentVal : 'all';
            const labels = { all: 'Все', friends: 'Друзья', nobody: 'Никто' };
            const opts = ['all', 'friends', 'nobody']
                .map(
                    (v) =>
                        `<button type="button" class="privacy-dd-opt ${v === safe ? 'active' : ''}" onclick="setPrivacyRule('${kindKey}','${v}')">${labels[v]}</button>`
                )
                .join('');
            return `<div class="privacy-dd"><button type="button" class="privacy-dd-trigger" onclick="togglePrivacyDropdown(this, event)">${labels[safe]} <i class="fas fa-chevron-down"></i></button><div class="privacy-dd-panel">${opts}</div></div>`;
        }

        function removeUserFromBlacklist(userId) {
            const id = String(userId || '').trim();
            messengerProfile.blacklist = (messengerProfile.blacklist || []).filter((item) => item !== id);
            persistMessengerProfileLocal();
            sendMessengerEvent({ type: 'messenger-block-user', targetUserId: id, blocked: false });
            renderMainScreen();
        }

        function toggleBlockActivePeer() {
            const peerId = String(messengerActivePeerId || '').trim();
            if (!peerId) return;
            const current = new Set(messengerProfile.blacklist || []);
            const blocked = !current.has(peerId);
            if (blocked) current.add(peerId);
            else current.delete(peerId);
            messengerProfile.blacklist = Array.from(current);
            persistMessengerProfileLocal();
            sendMessengerEvent({ type: 'messenger-block-user', targetUserId: peerId, blocked, comment: '' });
            // На мобиле всегда открываем рабочее окно чата,
            // иначе из-за классов верстки workspace может скрыться.
            if (isMobileLayout()) isChatOpen = true;
            openMessengerChat(peerId);
        }

        function clearComposerReplyEdit() {
            composerReplyMessage = null;
            composerEditMessageId = '';
            renderMainScreen();
        }

        function openForwardModal(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            if (!row) return;
            const modal = document.createElement('div');
            modal.className = 'modal';
            const list = messengerChats
                .filter((chat) => String(chat?.id || '') !== String(messengerActiveChatId || ''))
                .map((chat) => `<button class="contact-btn" style="width:100%;margin-bottom:8px;" onclick="forwardMessageToChat('${escapeHtml(row.id)}','${escapeHtml(chat.id)}')">${escapeHtml(chat.peer?.name || chat.peer?.displayName || chat.id)}</button>`)
                .join('') || '<div class="friends-empty">Нет доступных чатов</div>';
            modal.innerHTML = `<div class="modal-content"><h2><i class="fas fa-share"></i> Переслать</h2>${list}<div class="modal-buttons"><button class="modal-btn cancel" onclick="this.closest('.modal').remove()">Закрыть</button></div></div>`;
            document.body.appendChild(modal);
        }

        function forwardMessageToChat(messageId, targetChatId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            const targetChat = findMessengerChatById(targetChatId);
            if (!row || !targetChat) return;
            const payload = {
                type: 'messenger-send',
                chatId: targetChat.id,
                text: '',
                forwardedFromMessageId: row.id || ''
            };
            if (isDirectMessengerChat(targetChat)) payload.toUserId = targetChat.peer?.id || '';
            sendMessengerEvent(payload);
            document.querySelectorAll('.modal').forEach((m) => m.remove());
            showNotification('Мессенджер', 'Сообщение переслано', 'success');
        }

        function toggleMessageReaction(messageId, emoji) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const mid = String(messageId || '').trim();
            const e = String(emoji || '').trim();
            if (!mid || !e) return;
            sendMessengerEvent({ type: 'messenger-react', chatId: activeChat.id, messageId: mid, emoji: e });
        }

        function quickReactToMessage(event, messageId, emoji) {
            try {
                const tgt = event?.target;
                if (tgt && tgt.closest && tgt.closest('button,a,input,textarea,.chat-msg-reaction')) return;
            } catch (_) {}
            toggleMessageReaction(messageId, emoji);
        }

        function reactFromContextMenu(messageId, emoji) {
            toggleMessageReaction(messageId, emoji);
            try {
                document.querySelectorAll('.context-menu').forEach((m) => m.remove());
            } catch (_) {}
        }

        function getMessageCopyableText(row) {
            if (!row) return '';
            const kind = row.messageKind || '';
            if (kind === 'voice') {
                const t = String(row.text || '').trim();
                if (t && t !== 'Голосовое сообщение') return t;
                return 'Голосовое сообщение';
            }
            if (kind === 'image') {
                const t = String(row.text || '').trim();
                return t || '[Фото]';
            }
            if (kind === 'video') {
                const t = String(row.text || '').trim();
                return t || '[Видео]';
            }
            return String(row.text || '').trim();
        }

        async function copyMessengerMessage(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            const text = getMessageCopyableText(row);
            try {
                document.querySelectorAll('.context-menu').forEach((m) => m.remove());
            } catch (_) {}
            if (!text) {
                showNotification('Мессенджер', 'Нечего копировать', 'info');
                return;
            }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                }
                showNotification('Мессенджер', 'Скопировано в буфер', 'success');
            } catch (_) {
                showNotification('Мессенджер', 'Не удалось скопировать', 'error');
            }
        }

        function openMessageReactionsModal(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            const r = row && row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
            const entries = Object.entries(r)
                .map(([emoji, users]) => [String(emoji || ''), Array.isArray(users) ? users : []])
                .filter(([emoji, users]) => emoji && users.length);
            if (!entries.length) {
                showNotification('Реакции', 'Реакций нет', 'info');
                return;
            }
            const reactionOrder = ['❤️', '👍', '👎', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '😍', '🤔', '🙏', '💯', '😎'];
            entries.sort((a, b) => reactionOrder.indexOf(a[0]) - reactionOrder.indexOf(b[0]));
            const blocks = entries.map(([emoji, users]) => {
                const uniq = Array.from(new Set(users.map((u) => String(u)).filter(Boolean)));
                const items = uniq.map((uid) => {
                    const peer = resolvePeerDisplay(uid);
                    const name = String(peer?.displayName || peer?.name || uid || '').trim() || uid;
                    const avatar = String(peer?.avatar || '');
                    const initials = String(peer?.initials || '');
                    const uname = String(peer?.username || '').trim();
                    const sub = uname ? `@${uname}` : (peer?.statusText ? String(peer.statusText) : '');
                    return `<div class="contact-item" style="justify-content:flex-start;gap:12px;cursor:pointer;" onclick="openUserProfile('${escapeHtml(uid)}')">
                        <div style="width:44px;height:44px;flex-shrink:0;">${avatarMarkup(name, avatar, initials)}</div>
                        <div style="min-width:0;">
                            <div class="contact-name">${escapeHtml(name)}</div>
                            ${sub ? `<div class="contact-chat">${escapeHtml(sub)}</div>` : ''}
                        </div>
                    </div>`;
                }).join('') || '<div class="friends-empty">Пусто</div>';
                return `<div style="margin-bottom:12px;">
                    <div style="font-weight:900;margin:6px 0 8px;">${escapeHtml(emoji)}</div>
                    <div style="display:grid;gap:8px;">${items}</div>
                </div>`;
            }).join('');
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="max-width:560px;text-align:left;">
                <h2><i class="fas fa-face-smile"></i> Реакции</h2>
                <div style="max-height:60vh;overflow:auto;display:block;">${blocks}</div>
                <div class="modal-buttons">
                    <button type="button" class="modal-btn cancel" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }

        function openMessageViewsModal(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            const list = Array.isArray(row?.readBy) ? row.readBy.map((u) => String(u)).filter(Boolean) : [];
            const uniq = Array.from(new Set(list));
            if (!uniq.length) {
                showNotification('Просмотры', 'Пока никто не прочитал', 'info');
                return;
            }
            const items = uniq.map((uid) => {
                const peer = resolvePeerDisplay(uid);
                const name = String(peer?.displayName || peer?.name || uid || '').trim() || uid;
                const avatar = String(peer?.avatar || '');
                const initials = String(peer?.initials || '');
                const uname = String(peer?.username || '').trim();
                const sub = uname ? `@${uname}` : (peer?.statusText ? String(peer.statusText) : '');
                return `<div class="contact-item" style="justify-content:flex-start;gap:12px;cursor:pointer;" onclick="openUserProfile('${escapeHtml(uid)}')">
                    <div style="width:44px;height:44px;flex-shrink:0;">${avatarMarkup(name, avatar, initials)}</div>
                    <div style="min-width:0;">
                        <div class="contact-name">${escapeHtml(name)}</div>
                        ${sub ? `<div class="contact-chat">${escapeHtml(sub)}</div>` : ''}
                    </div>
                </div>`;
            }).join('');
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="max-width:520px;text-align:left;">
                <h2><i class="fas fa-eye"></i> Просмотры</h2>
                <div style="max-height:60vh;overflow:auto;display:grid;gap:8px;">${items}</div>
                <div class="modal-buttons">
                    <button type="button" class="modal-btn cancel" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }

        function openMessageMenu(event, messageId, mine) {
            if (event) event.preventDefault();
            // Если long-press сработал дважды, удаляем предыдущее меню,
            // чтобы не появлялось два одинаковых контекст-меню.
            const now = Date.now();
            try {
                if (
                    window.__lastMsgMenuAt &&
                    window.__lastMsgMenuFor === messageId &&
                    now - window.__lastMsgMenuAt < 650
                ) return;
                window.__lastMsgMenuAt = now;
                window.__lastMsgMenuFor = messageId;
            } catch (_) {}
            try {
                document.querySelectorAll('.context-menu').forEach((m) => m.remove());
            } catch (_) {}
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            if (!row) return;
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            const reactions = ['❤️', '👍', '👎', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '😍', '🤔', '🙏', '💯', '😎'];
            let html = `<div class="context-reactions">${reactions
                .map((e) => `<button type="button" onclick="reactFromContextMenu('${escapeHtml(row.id)}','${escapeHtml(e)}')" aria-label="${escapeHtml(e)}">${escapeHtml(e)}</button>`)
                .join('')}</div>`;
            html += `<div class="context-item" onclick="setReplyToMessage('${escapeHtml(row.id)}')"><i class="fas fa-reply"></i> Ответить</div>`;
            const hasReactions = row?.reactions && typeof row.reactions === 'object'
                ? Object.values(row.reactions).some((v) => Array.isArray(v) && v.length)
                : false;
            if (hasReactions) {
                html += `<div class="context-item" onclick="openMessageReactionsModal('${escapeHtml(row.id)}')"><i class="fas fa-face-smile"></i> Реакции</div>`;
            }
            const hasViews = mine && Array.isArray(row?.readBy) && row.readBy.length > 0;
            if (hasViews) {
                html += `<div class="context-item" onclick="openMessageViewsModal('${escapeHtml(row.id)}')"><i class="fas fa-eye"></i> Просмотры</div>`;
            }
            if (mine && !row.deletedAt) {
                html += `<div class="context-item" onclick="startEditMessage('${escapeHtml(row.id)}')"><i class="fas fa-pen"></i> Редактировать</div>`;
                html += `<div class="context-item" onclick="deleteMessageById('${escapeHtml(row.id)}')"><i class="fas fa-trash"></i> Удалить</div>`;
            }
            html += `<div class="context-item" onclick="openForwardModal('${escapeHtml(row.id)}')"><i class="fas fa-share"></i> Переслать</div>`;
            menu.innerHTML = html;
            document.body.appendChild(menu);
            const x = event?.pageX || (window.innerWidth / 2);
            const y = event?.pageY || (window.innerHeight / 2);
            placeContextMenu(menu, x, y);
            setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
        }

        function startMessageHold(event, messageId, mine) {
            // Не открываем long-press/контекст-меню для кнопок (play/stop и т.п.).
            const tgt = event?.target;
            if (tgt && tgt.closest && tgt.closest('button')) return;
            cancelMessageHold();
            messageTouchHoldTimer = setTimeout(() => {
                openMessageMenu(event, messageId, mine);
            }, 420);
            // Если пользователь двигает палец — это уже скролл/жест, отменяем long-press.
            try {
                const onMove = () => {
                    cancelMessageHold();
                    try { document.removeEventListener('touchmove', onMove); } catch (_) {}
                };
                document.addEventListener('touchmove', onMove, { passive: true, once: true });
            } catch (_) {}
        }

        function cancelMessageHold() {
            if (!messageTouchHoldTimer) return;
            clearTimeout(messageTouchHoldTimer);
            messageTouchHoldTimer = null;
        }

        let messageSwipeStart = null;
        let messengerIsUserScrolling = false;
        let messengerUserScrollTimer = null;
        let messengerWorkspaceIsUserScrolling = false;
        let messengerWorkspaceUserScrollTimer = null;
        function bindMessengerWorkspaceScrollGuard() {
            if (messengerView !== 'notifications') return;
            const sc = document.querySelector('.messenger-workspace .workspace-scroll');
            if (!sc || sc.dataset.workspaceScrollGuardBound === '1') return;
            sc.dataset.workspaceScrollGuardBound = '1';
            sc.addEventListener('scroll', () => {
                messengerWorkspaceIsUserScrolling = true;
                if (messengerWorkspaceUserScrollTimer) clearTimeout(messengerWorkspaceUserScrollTimer);
                messengerWorkspaceUserScrollTimer = setTimeout(() => {
                    messengerWorkspaceIsUserScrolling = false;
                    if (messengerRenderPendingAfterScroll && shouldRenderMessengerUi()) {
                        messengerRenderPendingAfterScroll = false;
                        renderMainScreen();
                    }
                }, 650);
            }, { passive: true });
        }
        function bindMessengerHistoryScrollGuard() {
            const hist = document.querySelector('.chat-history');
            if (!hist || hist.dataset.scrollGuardBound === '1') return;
            hist.dataset.scrollGuardBound = '1';
            hist.addEventListener('scroll', () => {
                messengerIsUserScrolling = true;
                // Пока пользователь скроллит — запретим автопрокрутку.
                messengerShouldAutoScroll = false;
                // Если пользователь дошёл до низа — скрываем кнопку.
                try {
                    const dist = hist.scrollHeight - hist.scrollTop - hist.clientHeight;
                    if (dist < 80) {
                        messengerNewWhileScrolledCount = 0;
                        updateMessengerNewWhileScrolledFabUI();
                    }
                } catch (_) {}
                updateMessengerNewWhileScrolledFabUI();
                if (messengerUserScrollTimer) clearTimeout(messengerUserScrollTimer);
                messengerUserScrollTimer = setTimeout(() => {
                    messengerIsUserScrolling = false;
                    if (messengerRenderPendingAfterScroll && shouldRenderMessengerUi()) {
                        messengerRenderPendingAfterScroll = false;
                        renderMainScreen();
                    }
                }, 650);
            }, { passive: true });
        }
        function startMessageSwipeStart(event) {
            try {
                const tgt = event?.target;
                if (tgt && tgt.closest && tgt.closest('button')) {
                    messageSwipeStart = null;
                    return;
                }
                const t = event?.touches?.[0];
                const x = t ? t.clientX : event?.clientX;
                const y = t ? t.clientY : event?.clientY;
                if (typeof x !== 'number' || typeof y !== 'number') return;
                const msgEl = event?.target?.closest ? event.target.closest('.chat-msg') : null;
                messageSwipeStart = { x, y, ts: Date.now(), el: msgEl, handler: null };
                // Для анимации во время свайпа: двигаем bubble по X и подсвечиваем.
                const onMove = (ev) => {
                    try {
                        if (!messageSwipeStart) return;
                        const tt = ev?.touches?.[0];
                        if (!tt) return;
                        const curX = tt.clientX;
                        const curY = tt.clientY;
                        const dx = curX - messageSwipeStart.x;
                        const dy = curY - messageSwipeStart.y;
                        // Если это горизонтальный жест — отменяем long-press, чтобы меню не вылезало.
                        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 25) {
                            cancelMessageHold();
                        }
                        if (messageSwipeStart.el) {
                            const limited = Math.max(-140, Math.min(0, dx));
                            messageSwipeStart.el.style.transform = `translateX(${limited}px)`;
                            if (dx < -28) messageSwipeStart.el.classList.add('chat-msg--swipe-reply');
                            else messageSwipeStart.el.classList.remove('chat-msg--swipe-reply');
                        }
                    } catch (_) {}
                };
                messageSwipeStart.handler = onMove;
                document.addEventListener('touchmove', onMove, { passive: true });
            } catch (_) {}
        }

        function handleMessageSwipeEnd(event, messageId) {
            // При свайпе отменяем long-press меню.
            cancelMessageHold();
            // Убираем touchmove-анимацию.
            try {
                if (messageSwipeStart?.handler) {
                    document.removeEventListener('touchmove', messageSwipeStart.handler);
                }
            } catch (_) {}
            try {
                const tgt = event?.target;
                if (tgt && tgt.closest && tgt.closest('button')) {
                    messageSwipeStart = null;
                    return;
                }
            } catch (_) {}
            if (!messageSwipeStart) return;
            const start = messageSwipeStart;
            messageSwipeStart = null;
            try {
                const t = event?.changedTouches?.[0];
                const x = t ? t.clientX : event?.clientX;
                const y = t ? t.clientY : event?.clientY;
                if (typeof x !== 'number' || typeof y !== 'number') return;
                const dx = x - start.x;
                const dy = y - start.y;
                const dt = Date.now() - start.ts;
                // Свайп справа налево => ответить
                if (dx < -70 && Math.abs(dy) < 60 && dt < 800) {
                    // Убираем анимацию
                    if (start.el && start.el.style) {
                        start.el.style.transform = '';
                        start.el.classList.remove('chat-msg--swipe-reply');
                    }
                    setReplyToMessage(messageId);
                } else {
                    if (start.el && start.el.style) {
                        start.el.style.transform = '';
                        start.el.classList.remove('chat-msg--swipe-reply');
                    }
                }
            } catch (_) {}
        }

        function messengerSafeId(v) {
            return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '');
        }

        function scrollAndHighlightMessengerMessage(messageId) {
            if (!messageId) return;
            try {
                messengerIsUserScrolling = true;
                const safe = messengerSafeId(messageId);
                const el = document.getElementById(`chatMsg-${safe}`);
                if (!el) return;
                el.classList.add('chat-msg--reply-highlight');
                // Подсветка обычно короткая, чтобы не мешала.
                setTimeout(() => {
                    try { el.classList.remove('chat-msg--reply-highlight'); } catch (_) {}
                }, 1200);
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (_) {}
            setTimeout(() => {
                messengerIsUserScrolling = false;
            }, 700);
        }

        let chatListHoldTimer = null;
        function startChatListHold(event, peerId, chatId) {
            cancelChatListHold();
            chatListHoldTimer = setTimeout(() => {
                openChatListContextMenu(event, peerId, chatId);
            }, 480);
        }
        function cancelChatListHold() {
            if (!chatListHoldTimer) return;
            clearTimeout(chatListHoldTimer);
            chatListHoldTimer = null;
        }
        function openChatListContextMenu(event, peerId, chatId) {
            if (event && event.preventDefault) event.preventDefault();
            if (event && event.stopPropagation) event.stopPropagation();
            cancelChatListHold();
            const pid = String(peerId || '').trim();
            const cid = String(chatId || '').trim();
            if (!cid) return;
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.innerHTML = `
                <div class="context-item" onclick="clearChatHistoryForMe('${escapeHtml(cid)}')"><i class="fas fa-eraser"></i> Очистить историю (у себя)</div>
                <div class="context-item" onclick="openDeleteChatModal('${escapeHtml(cid)}','${escapeHtml(pid)}')"><i class="fas fa-trash"></i> Удалить чат…</div>
            `;
            document.body.appendChild(menu);
            const x = event?.pageX || event?.clientX || (event?.touches && event.touches[0]?.pageX) || 80;
            const y = event?.pageY || event?.clientY || (event?.touches && event.touches[0]?.pageY) || 80;
            placeContextMenu(menu, x, y);
            setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
        }
        function clearChatHistoryForMe(chatId) {
            const id = String(chatId || '').trim();
            if (!id) return;
            sendMessengerEvent({ type: 'messenger-clear-chat', chatId: id });
            messengerMessages.set(id, []);
            if (shouldRenderMessengerUi()) renderMainScreen();
        }
        function openDeleteChatModal(chatId, peerId) {
            const cid = String(chatId || '').trim();
            if (!cid) return;
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2><i class="fas fa-trash"></i> Удалить чат</h2>
                    <p style="opacity:.85;">${escapeHtml(peerId || '')}</p>
                    <div class="modal-buttons" style="flex-direction:column;gap:10px;">
                        <button type="button" class="modal-btn confirm" style="width:100%" onclick="confirmDeleteChat('${escapeHtml(cid)}',false);this.closest('.modal').remove();">Удалить у себя</button>
                        <button type="button" class="modal-btn confirm" style="width:100%;background:linear-gradient(135deg,#c0392b,#922b21)" onclick="confirmDeleteChat('${escapeHtml(cid)}',true);this.closest('.modal').remove();">Удалить для всех</button>
                        <button type="button" class="modal-btn cancel" style="width:100%" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        function confirmDeleteChat(chatId, forEveryone) {
            sendMessengerEvent({ type: 'messenger-delete-chat', chatId, forEveryone: !!forEveryone });
        }

        function setReplyToMessage(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            if (!row) return;
            composerReplyMessage = row;
            composerEditMessageId = '';
            renderMainScreen();
            requestAnimationFrame(() => {
                const input = document.getElementById('chatComposerInput');
                if (input && typeof input.focus === 'function') input.focus();
            });
        }

        function startEditMessage(messageId) {
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const row = (resolveChatMessages(activeChat.id) || []).find((item) => item.id === messageId);
            if (!row) return;
            composerReplyMessage = null;
            composerEditMessageId = row.id;
            renderMainScreen();
            const input = document.getElementById('chatComposerInput');
            if (input) {
                input.value = row.text || '';
                input.focus();
                onComposerInput();
            }
        }

        function deleteMessageById(messageId) {
            sendMessengerEvent({ type: 'messenger-delete', messageId });
        }

        function minimizeCallToIsland() {
            if (!roomId) return;
            callMinimized = true;
            renderMainScreen();
            syncCallScreenLayoutMode();
        }

        function restoreCallFromIsland() {
            if (!roomId) return;
            callMinimized = false;
            messengerView = 'calls';
            const island = document.getElementById('callIsland');
            if (island) island.remove();
            renderMainScreen();
            syncCallScreenLayoutMode();
            updateUI();
            updateEmptyState();
        }

        function updateCallMinimizeUnreadBadge() {
            const el = document.getElementById('callUnreadBadge');
            if (!el) return;
            const total = getMessengerUnreadTotal();
            if (!total) {
                el.style.display = 'none';
                el.textContent = '0';
                return;
            }
            el.style.display = 'flex';
            el.textContent = total > 99 ? '99+' : String(total);
        }

        function renderCallIslandWidget() {
            const prev = document.getElementById('callIsland');
            if (prev) prev.remove();
            if (!roomId || !callMinimized) return;
            if (currentGroupCallChatId) return;
            const island = document.createElement('div');
            island.id = 'callIsland';
            island.className = 'call-island';
            const islandTitle = currentGroupCallChatId ? (currentGroupCallTitle || 'Групповой звонок') : 'Идёт звонок';
            island.innerHTML =
                `<div class="call-island-inner"><div class="call-island-title"><i class="fas fa-phone-volume"></i> ${escapeHtml(islandTitle)}</div><div class="call-island-timer" id="callIslandTimer">00:00</div></div><i class="fas fa-chevron-up call-island-chevron" aria-hidden="true"></i>`;
            island.onclick = (e) => {
                e.preventDefault();
                restoreCallFromIsland();
            };
            document.body.appendChild(island);
            updateCallTimerDisplay();
        }

        function openMessengerChat(peerId) {
            const peer = String(peerId || '').trim();
            if (!peer || !authProfile?.appUserId) return;
            messengerShouldAutoScroll = true;
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            discardVoicePreview();
            if (voiceRecordingActive && voiceMediaRecorder) {
                const mr = voiceMediaRecorder;
                mr.onstop = () => {
                    clearVoiceRecTimerUi();
                    try {
                        if (voiceMediaStream) voiceMediaStream.getTracks().forEach((t) => t.stop());
                    } catch (_) {}
                    voiceMediaStream = null;
                    voiceMediaRecorder = null;
                    voiceRecordChunks = [];
                    voiceRecordingActive = false;
                    voiceRecordStartedAt = 0;
                };
                try {
                    if (typeof mr.requestData === 'function') mr.requestData();
                    mr.stop();
                } catch (_) {
                    stopVoiceStreams();
                }
            } else {
                stopVoiceStreams();
            }
            messengerView = 'chats';
            if (isMobileLayout()) {
                isChatOpen = true;
            }
            messengerActivePeerId = peer;
            messengerActiveChatId = createDirectChatIdClient(authProfile.appUserId, peer);
            // Открываем чат => сбрасываем счётчик непрочитанных.
            setMessengerUnreadForChat(messengerActiveChatId, 0);
            updateCallMinimizeUnreadBadge();
            messengerComposeBlocked = false;
            messengerComposeHint = '';
            composerReplyMessage = null;
            composerEditMessageId = '';
            persistMessengerSessionChat(messengerActiveChatId);
            persistMessengerSessionPeer(peer);
            sendMessengerEvent({ type: 'messenger-open-chat', chatId: messengerActiveChatId, withUserId: peer });
            renderMainScreen();
        }

        function openMessengerChatById(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat) return;
            if (isDirectMessengerChat(chat)) {
                openMessengerChat(chat.peer?.id || '');
                return;
            }
            messengerShouldAutoScroll = true;
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            messengerMentionWhileScrolledCount = 0;
            updateMessengerMentionFabUI();
            messengerPendingMentionIdsByChat.delete(String(chat.id || ''));
            stopVoiceStreams();
            discardVoicePreview();
            messengerView = 'chats';
            if (isMobileLayout()) isChatOpen = true;
            messengerActiveChatId = chat.id || '';
            messengerActivePeerId = '';
            setMessengerUnreadForChat(messengerActiveChatId, 0);
            setMessengerMentionUnreadForChat(messengerActiveChatId, 0);
            updateCallMinimizeUnreadBadge();
            messengerComposeBlocked = false;
            messengerComposeHint = '';
            composerReplyMessage = null;
            composerEditMessageId = '';
            persistMessengerSessionChat(messengerActiveChatId);
            persistMessengerSessionPeer('');
            sendMessengerEvent({ type: 'messenger-open-chat', chatId: messengerActiveChatId });
            renderMainScreen();
        }

        function renderNotificationsWorkspace() {
            const list = Array.isArray(messengerNotifications) ? messengerNotifications : [];
            if (!list.length) {
                return `<div class="workspace-empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">
                    <div style="opacity:.9;font-size:20px;font-weight:700;">Уведомлений нет</div>
                    <div style="opacity:.72;">Здесь появятся реакции, упоминания и системные события чатов</div>
                </div>`;
            }
            const items = list.map((it) => {
                const chatTitle = String(it.chatTitle || it.chatId || 'Чат').trim() || 'Чат';
                const ts = new Date(Number(it.createdAt || Date.now())).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                const unread = messengerNotificationUnreadIds.has(String(it.id || ''));
                const actorName = String(it.actorName || '').trim() || 'Пользователь';
                const actorInitials = String(it.actorInitials || '').trim() || actorName.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase();
                
                let icon = 'fa-bell';
                let typeLabel = 'Уведомление';
                if (it.type === 'mention') {
                    icon = 'fa-at';
                    typeLabel = 'Упоминание';
                } else if (it.type === 'reaction') {
                    icon = 'fa-smile';
                    typeLabel = 'Реакция';
                } else if (it.type === 'system') {
                    icon = 'fa-info-circle';
                    typeLabel = 'Событие';
                }
                
                let metaHtml = '';
                if (it.duration || it.reason) {
                    metaHtml = `<div class="messenger-notification-meta">
                        ${it.duration ? `<div class="messenger-notification-meta-item"><b>Срок:</b> ${escapeHtml(it.duration)}</div>` : ''}
                        ${it.reason ? `<div class="messenger-notification-meta-item"><b>Причина:</b> ${escapeHtml(it.reason)}</div>` : ''}
                    </div>`;
                }
                
                return `<div class="messenger-notification-card" style="cursor:pointer;transition:background .15s ease;" onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background=''" onclick="openMessengerNotification('${escapeHtml(it.id || '')}')">
                    <div class="messenger-notification-chat-row">
                        <div class="messenger-notification-avatar">
                            <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;">
                                ${avatarMarkup(chatTitle, it.chatAvatar || '', it.chatInitials || '')}
                            </div>
                            ${unread ? '<span style="position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:999px;background:#60a5fa;box-shadow:0 0 0 2px rgba(8,10,22,.82);"></span>' : ''}
                        </div>
                        <div class="messenger-notification-body">
                            <div class="messenger-notification-title">
                                <strong>${escapeHtml(chatTitle)}</strong>
                                <span class="messenger-notification-time">${escapeHtml(ts)}</span>
                            </div>
                            <div style="font-size:12px;opacity:.68;display:flex;align-items:center;gap:4px;">
                                <i class="fas ${icon}" style="font-size:11px;"></i>
                                <span>${escapeHtml(typeLabel)}</span>
                            </div>
                        </div>
                    </div>
                    ${it.actorId ? `<div class="messenger-notification-actor-row">
                        <div style="width:36px;height:36px;flex-shrink:0;border-radius:50%;overflow:hidden;border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;">
                            ${avatarMarkup(actorName, it.actorAvatar || '', actorInitials)}
                        </div>
                        <div class="messenger-notification-body">
                            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                                <span style="font-weight:700;color:#60a5fa;cursor:pointer;" onclick="event.stopPropagation(); openUserProfile('${escapeHtml(it.actorId || '')}')">${escapeHtml(actorName)}</span>
                                <span style="opacity:.8;font-size:13px;">${escapeHtml(String(it.text || it.title || '').replace(actorName, '').trim())}</span>
                            </div>
                        </div>
                    </div>` : ''}
                    ${metaHtml}
                </div>`;
            }).join('');
            return `<div class="workspace-scroll" style="padding:8px 6px;">${items}</div>`;
        }

        function openUserProfile(targetUserId) {
            const id = String(targetUserId || '').trim();
            if (!id) return;
            if (String(id) === String(authProfile?.appUserId || '')) {
                messengerViewedProfile = null;
                messengerView = 'profile';
                requestStoriesForUser(id);
                renderMainScreen();
                return;
            }
            sendMessengerEvent({ type: 'messenger-get-profile', targetUserId: id });
            requestStoriesForUser(id);
            messengerView = 'profile';
            renderMainScreen();
        }

        function canCurrentUserAddProfileToChats(profileView, isFriend) {
            const view = profileView && typeof profileView === 'object' ? profileView : {};
            const profile = view.profile && typeof view.profile === 'object' ? view.profile : {};
            const rule = String(view.canJoinGroups || view.privacy?.canJoinGroups || profile.canJoinGroups || profile.privacy?.canJoinGroups || '').trim();
            if (rule === 'nobody') return false;
            if (rule === 'friends') return !!isFriend;
            if (rule === 'all') return true;
            return true;
        }

        function copyGroupInviteLink(inviteUrl) {
            copyTextToClipboard(inviteUrl, 'Ссылка скопирована');
        }

        function formatGroupParticipantMeta(member) {
            const role = getGroupRoleLabel(member?.role);
            const presence = getParticipantPresenceState(member);
            return `${role} • ${formatPresenceLabel(presence.online, presence.lastSeenAt)}`;
        }

        function openPrivacySettingsModal() {
            closeTransientModal('messengerPrivacySettingsModal');
            const privacy = messengerProfile.privacy || { canWrite: 'all', canCall: 'all', canViewProfile: 'all', canSeeStories: 'friends', canJoinGroups: 'friends' };
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerPrivacySettingsModal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:620px;text-align:left;">
                    <h2><i class="fas fa-user-shield"></i> Приватность</h2>
                    <div class="privacy-grid">
                        <div class="privacy-card"><span>Кто может писать</span>${renderPrivacyDropdown('canWrite', privacy.canWrite)}</div>
                        <div class="privacy-card"><span>Кто может звонить</span>${renderPrivacyDropdown('canCall', privacy.canCall)}</div>
                        <div class="privacy-card"><span>Кто видит профиль</span>${renderPrivacyDropdown('canViewProfile', privacy.canViewProfile)}</div>
                        <div class="privacy-card"><span>Кто видит истории</span>${renderPrivacyDropdown('canSeeStories', privacy.canSeeStories)}</div>
                        <div class="privacy-card"><span>Кто может добавлять меня в чаты</span>${renderPrivacyDropdown('canJoinGroups', privacy.canJoinGroups)}</div>
                    </div>
                    <div class="modal-buttons">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerPrivacySettingsModal')">Закрыть</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function getGroupRestrictionHintClient(restriction) {
            const state = restriction && typeof restriction === 'object' ? restriction : null;
            if (!state || !state.type) return '';
            const duration = state.forever
                ? 'навсегда'
                : (state.until ? new Date(Number(state.until)).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
            if (state.type === 'muted') {
                return `У вас мут${duration ? ` до ${duration}` : ''}`;
            }
            if (state.type === 'banned') {
                return `Чат заблокирован для вас${duration ? ` до ${duration}` : ''}`;
            }
            return '';
        }

        function formatGroupRestrictionUntilClient(restriction) {
            const state = restriction && typeof restriction === 'object' ? restriction : null;
            if (!state || !state.type) return '';
            if (state.forever) return 'Навсегда';
            const until = Number(state.until || 0);
            if (!until) return 'Не указан';
            return new Date(until).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        function getGroupRestrictionStatusText(restriction) {
            const state = restriction && typeof restriction === 'object' ? restriction : null;
            if (!state || !state.type) return '';
            const untilLabel = formatGroupRestrictionUntilClient(state);
            if (state.type === 'muted') {
                return state.forever ? 'Мут навсегда' : `Мут до ${untilLabel}`;
            }
            if (state.type === 'banned') {
                return state.forever ? 'Блокировка навсегда' : `Блокировка до ${untilLabel}`;
            }
            return '';
        }

        function renderGroupRestrictionSummaryCard(restriction) {
            const state = restriction && typeof restriction === 'object' ? restriction : null;
            if (!state || !state.type) {
                return `<div class="contact-item" style="justify-content:flex-start;margin-bottom:14px;"><div><div class="contact-chat">Текущие санкции</div><div class="contact-name">Активных ограничений нет</div></div></div>`;
            }
            const actorName = String(state.actorName || 'Администратор').trim() || 'Администратор';
            const title = state.type === 'banned' ? 'Активная блокировка' : 'Активный мут';
            const duration = formatGroupRestrictionUntilClient(state);
            const reason = String(state.reason || '').trim() || 'Не указана';
            return `<div class="contact-item" style="justify-content:flex-start;margin-bottom:14px;">
                <div>
                    <div class="contact-chat">${escapeHtml(title)}</div>
                    <div class="contact-name">${escapeHtml(getGroupRestrictionStatusText(state))}</div>
                    <div class="contact-chat" style="margin-top:6px;">Выдал(а): ${escapeHtml(actorName)}</div>
                    <div class="contact-chat">Срок: ${escapeHtml(duration)}</div>
                    <div class="contact-chat">Причина: ${escapeHtml(reason)}</div>
                </div>
            </div>`;
        }

        function formatGroupCallDurationSec(totalSec) {
            const safe = Math.max(0, Number(totalSec) || 0);
            const hours = Math.floor(safe / 3600);
            const minutes = Math.floor((safe % 3600) / 60);
            const seconds = safe % 60;
            if (hours > 0) {
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
            return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        function parseGroupEventPayload(text) {
            const raw = String(text || '').trim();
            const match = raw.match(/^\[\[group-event:(.+)\]\]$/s);
            if (!match) return null;
            try {
                const parsed = JSON.parse(match[1]);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (_) {
                return null;
            }
        }

        function renderGroupEventBlock(payload) {
            const event = payload && typeof payload === 'object' ? payload : null;
            if (!event) return '';
            const title = escapeHtml(String(event.title || 'Событие').trim() || 'Событие');
            const previews = Array.isArray(event.participants) ? event.participants.slice(0, 4) : [];
            const actorId = String(event.actorUserId || '').trim();
            const actorName = String(event.actorName || '').trim();
            const actorHtml = actorId && actorName
                ? `<div style="margin-top:8px;"><span class="chat-system-actor" onclick="openUserProfile('${escapeHtml(actorId)}')">${escapeHtml(actorName)}</span></div>`
                : '';
            const actorsHtml = previews.length
                ? `<div class="chat-system-actors">${previews.map((item) => {
                    const userId = String(item.userId || '').trim();
                    const label = String(item.displayName || item.userId || 'Пользователь');
                    return userId
                        ? `<span class="chat-system-actor" onclick="openUserProfile('${escapeHtml(userId)}')">${escapeHtml(label)}</span>`
                        : `<span class="chat-system-actor">${escapeHtml(label)}</span>`;
                }).join('')}</div>`
                : '';
            const avatarsHtml = previews.length
                ? `<div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:10px;">${previews.map((item) => `<div style="width:34px;height:34px;">${avatarMarkup(String(item.displayName || item.userId || 'Пользователь'), String(item.avatar || ''), String(item.initials || ''))}</div>`).join('')}</div>`
                : '';
            const durationHtml = Number(event.durationSec || 0) > 0
                ? `<div style="margin-top:8px;font-size:12px;opacity:.78;">${escapeHtml(formatGroupCallDurationSec(event.durationSec))}</div>`
                : '';
            const icon = event.type === 'group-call-ended' ? 'fa-phone-slash' : 'fa-phone-volume';
            return `<div class="chat-system-msg" style="max-width:280px;margin:8px auto;padding:14px 16px;">
                <div style="font-size:20px;margin-bottom:8px;"><i class="fas ${icon}"></i></div>
                <div style="font-weight:800;">${title}</div>
                ${actorHtml}
                ${actorsHtml}
                ${avatarsHtml}
                ${durationHtml}
            </div>`;
        }

        function renderGroupBlockedScreen(chat) {
            const restriction = chat?.group?.restriction || null;
            const actorName = String(restriction?.actorName || 'Администратор').trim() || 'Администратор';
            const actorAvatar = String(restriction?.actorAvatar || '').trim() || '';
            const duration = restriction?.forever
                ? 'Навсегда'
                : (restriction?.until ? new Date(Number(restriction.until)).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Не указан');
            const reason = String(restriction?.reason || '').trim() || 'Не указана';
            return `<div class="group-blocked-card">
                <div class="group-blocked-card__icon">
                    <i class="fas fa-ban"></i>
                </div>
                <div class="group-blocked-card__title">Заблокирован(а)</div>
                <div class="group-blocked-card__subtitle">Вы сможете вернуться в чат позже</div>
                <div class="group-blocked-card__section">
                    <div class="group-blocked-card__label">Администратор</div>
                    <div class="group-blocked-card__admin">
                        <div style="width:42px;height:42px;flex-shrink:0;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.14);">
                            ${avatarMarkup(actorName, actorAvatar, String(actorName || '').slice(0, 2))}
                        </div>
                        <div class="group-blocked-card__admin-name">${escapeHtml(actorName)}</div>
                    </div>
                </div>
                <div class="group-blocked-card__section">
                    <div class="group-blocked-card__label">Срок</div>
                    <div class="group-blocked-card__value">${escapeHtml(duration)}</div>
                </div>
                <div class="group-blocked-card__section">
                    <div class="group-blocked-card__label">Причина</div>
                    <div class="group-blocked-card__value">${escapeHtml(reason)}</div>
                </div>
            </div>`;
        }

        function renderActiveGroupCallBanner(chat) {
            const activeCall = chat?.group?.activeCall;
            if (!activeCall?.roomId) return '';
            const inThisRoom = !!roomId && String(roomId) === String(activeCall.roomId);
            const title = inThisRoom ? 'Идёт звонок' : 'Групповой звонок';
            const subtitle = activeCall.participantCount > 0 ? `${activeCall.participantCount} участников в звонке` : 'Звонок уже создан';
            const actionText = inThisRoom ? 'Вернуться' : 'Войти';
            return `<div class="contact-item" style="justify-content:space-between;gap:12px;margin:0;">
                <div style="min-width:0;">
                    <div class="contact-name"><i class="fas fa-phone-volume" style="color:#5be37a;"></i> ${escapeHtml(title)}</div>
                    <div class="contact-chat">${escapeHtml(subtitle)}</div>
                </div>
                <button type="button" class="contact-btn" onclick="joinActiveGroupCall('${escapeHtml(String(chat.id || ''))}')">${actionText}</button>
            </div>`;
        }

        function getActiveGroupCallChats(limit = 3) {
            const activeChatId = String(messengerActiveChatId || '').trim();
            const currentCallChatId = String(currentGroupCallChatId || '').trim();
            const list = (Array.isArray(messengerChats) ? messengerChats : []).filter((chat) => {
                return isGroupMessengerChat(chat) && !!String(chat?.group?.activeCall?.roomId || '').trim();
            });
            list.sort((a, b) => {
                const aRoomMatch = !!roomId && String(a?.group?.activeCall?.roomId || '') === String(roomId || '');
                const bRoomMatch = !!roomId && String(b?.group?.activeCall?.roomId || '') === String(roomId || '');
                if (aRoomMatch !== bRoomMatch) return bRoomMatch ? 1 : -1;
                const aCallMatch = currentCallChatId && String(a?.id || '') === currentCallChatId;
                const bCallMatch = currentCallChatId && String(b?.id || '') === currentCallChatId;
                if (aCallMatch !== bCallMatch) return bCallMatch ? 1 : -1;
                const aActiveMatch = activeChatId && String(a?.id || '') === activeChatId;
                const bActiveMatch = activeChatId && String(b?.id || '') === activeChatId;
                if (aActiveMatch !== bActiveMatch) return bActiveMatch ? 1 : -1;
                return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
            });
            return list.slice(0, Math.max(1, Number(limit) || 3));
        }

        function renderGlobalActiveGroupCallWidgets() {
            const chats = getActiveGroupCallChats(3);
            if (!chats.length) return '';
            const totalActive = (Array.isArray(messengerChats) ? messengerChats : []).filter((chat) => {
                return isGroupMessengerChat(chat) && !!String(chat?.group?.activeCall?.roomId || '').trim();
            }).length;
            const itemsHtml = chats.map((chat) => {
                const activeCall = chat.group?.activeCall || null;
                const inThisRoom = !!roomId && String(roomId) === String(activeCall?.roomId || '');
                const actionText = inThisRoom ? 'Вернуться' : 'Войти';
                const stateTitle = inThisRoom ? 'Идёт звонок' : 'Групповой звонок';
                const groupTitle = chat.peer?.displayName || chat.peer?.name || 'Групповой чат';
                const participantLine = Number(activeCall?.participantCount || 0) > 0
                    ? `${Number(activeCall.participantCount || 0)} участников`
                    : 'Звонок уже создан';
                return `<div class="contact-item" style="justify-content:space-between;gap:12px;margin-bottom:10px;cursor:pointer;" onclick="openMessengerChatById('${escapeHtml(chat.id || '')}')">
                    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                        <div style="width:42px;height:42px;flex-shrink:0;">${avatarMarkup(groupTitle, chat.peer?.avatar || '', chat.peer?.initials || '')}</div>
                        <div style="min-width:0;">
                            <div class="contact-name" style="display:flex;align-items:center;gap:8px;"><i class="fas fa-phone-volume" style="color:#5be37a;"></i><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(stateTitle)}</span></div>
                            <div class="contact-chat" style="white-space:normal;">${escapeHtml(groupTitle)} • ${escapeHtml(participantLine)}</div>
                        </div>
                    </div>
                    <button type="button" class="contact-btn" onclick="event.stopPropagation();joinActiveGroupCall('${escapeHtml(chat.id || '')}')">${actionText}</button>
                </div>`;
            }).join('');
            const moreHtml = totalActive > chats.length
                ? `<div class="messenger-connection" style="margin-top:0;">Ещё активных звонков: ${totalActive - chats.length}</div>`
                : '';
            return `<div style="margin:8px 0 12px;">
                <div class="messenger-connection" style="margin-top:0;margin-bottom:8px;"><i class="fas fa-phone-volume" style="margin-right:6px;color:#5be37a;"></i>Активные групповые звонки</div>
                ${itemsHtml}
                ${moreHtml}
            </div>`;
        }

        function getAvailableGroupsForUserInvite(targetUserId) {
            const targetId = String(targetUserId || '').trim();
            if (!targetId || !authProfile?.appUserId || targetId === String(authProfile.appUserId || '')) return [];
            return (messengerChats || []).filter((chat) => {
                if (!isGroupMessengerChat(chat)) return false;
                if (!hasGroupPermissionClient(chat, 'addMembers')) return false;
                const members = Array.isArray(chat.group?.members) ? chat.group.members.map((item) => String(item || '')) : [];
                return !members.includes(targetId);
            });
        }

        function openAddUserToGroupModal(targetUserId) {
            const targetId = String(targetUserId || '').trim();
            const userInfo = getUserInfo(targetId);
            const groups = getAvailableGroupsForUserInvite(targetId);
            closeTransientModal('messengerAddUserToGroupModal');
            const list = groups.length
                ? groups.map((chat) => `<button type="button" class="contact-btn" style="width:100%;display:flex;align-items:center;justify-content:flex-start;gap:12px;margin-bottom:8px;" onclick="addUserToGroupChat('${escapeHtml(chat.id || '')}','${escapeHtml(targetId)}')"><span style="width:40px;height:40px;display:inline-flex;">${avatarMarkup(chat.peer?.displayName || chat.peer?.name || chat.id || '', chat.peer?.avatar || '', chat.peer?.initials || '')}</span><span style="text-align:left;">${escapeHtml(chat.peer?.displayName || chat.peer?.name || chat.id || '')}</span></button>`).join('')
                : '<div class="friends-empty">Нет групп, куда вы можете добавить этого друга</div>';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerAddUserToGroupModal';
            modal.innerHTML = `<div class="modal-content" style="max-width:520px;text-align:left;"><h2><i class="fas fa-comments"></i> Выбор чата</h2><div class="contact-item" style="justify-content:flex-start;gap:12px;margin-bottom:14px;"><div style="width:44px;height:44px;">${avatarMarkup(userInfo.displayName || userInfo.name || targetId, userInfo.avatar || '', userInfo.initials || '')}</div><div><div class="contact-name">${escapeHtml(userInfo.displayName || userInfo.name || targetId)}</div><div class="contact-chat">${escapeHtml(userInfo.username ? '@' + userInfo.username : targetId)}</div></div></div><div class="contacts-list" style="max-height:320px;">${list}</div><div class="modal-buttons"><button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerAddUserToGroupModal')">Отмена</button></div></div>`;
            document.body.appendChild(modal);
        }

        function addUserToGroupChat(chatId, targetUserId) {
            sendMessengerEvent({ type: 'messenger-add-group-members', chatId, memberIds: [targetUserId] });
            closeTransientModal('messengerAddUserToGroupModal');
            showNotification('Группа', 'Запрос на добавление отправлен', 'info');
        }

        function startGroupCallForChat(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat || !isGroupMessengerChat(chat)) return;
            const activeCall = chat.group?.activeCall || null;
            const callRoomId = String(activeCall?.roomId || '').trim();
            if (callRoomId) {
                if (roomId && roomId === callRoomId) {
                    if (callMinimized) restoreCallFromIsland();
                    else {
                        messengerView = 'calls';
                        renderMainScreen();
                    }
                    return;
                }
                joinRoom(callRoomId, {
                    groupChatId: chat.id,
                    groupTitle: chat.peer?.displayName || chat.peer?.name || 'Групповой звонок'
                });
                closeTransientModal('messengerGroupProfileModal');
                return;
            }
            sendMessengerEvent({ type: 'messenger-create-group-call', chatId });
            closeTransientModal('messengerGroupProfileModal');
        }

        function joinActiveGroupCall(chatId) {
            startGroupCallForChat(chatId);
        }

        function closeTransientModal(id) {
            const el = id ? document.getElementById(id) : null;
            if (el) el.remove();
        }

        function onGroupAvatarSelected(event) {
            const input = event?.target;
            const file = input?.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = () => {
                const raw = String(reader.result || '');
                const preview = document.getElementById('groupAvatarPreview');
                if (preview) {
                    preview.innerHTML = raw ? `<img src="${escapeHtml(raw)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:18px;">` : '<i class="fas fa-users"></i>';
                }
                if (input) input.dataset.avatar = raw;
            };
            reader.readAsDataURL(file);
        }

        function openCreateGroupModal() {
            closeTransientModal('messengerCreateGroupModal');
            const friends = Array.isArray(friendsState.friends) ? friendsState.friends : [];
            const membersHtml = friends.length
                ? friends.map((friend) => `
                    <label class="contact-item" style="cursor:pointer;justify-content:flex-start;gap:12px;">
                        <input type="checkbox" value="${escapeHtml(friend.id || '')}" style="accent-color:#7c5cff;">
                        <div style="width:42px;height:42px;flex-shrink:0;">${avatarMarkup(friend.displayName || friend.name || friend.id || '', friend.avatar || '', friend.initials || '')}</div>
                        <div style="min-width:0;">
                            <div class="contact-name">${escapeHtml(friend.displayName || friend.name || friend.id || '')}</div>
                            <div class="contact-chat">${escapeHtml(friend.username ? '@' + friend.username : friend.id || '')}</div>
                        </div>
                    </label>`).join('')
                : '<div class="friends-empty">Добавлять можно только друзей. Сначала добавьте друзей.</div>';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerCreateGroupModal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:560px;text-align:left;">
                    <h2 style="text-align:center;"><i class="fas fa-pen"></i> Создание чата</h2>
                    <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px;">
                        <label id="groupAvatarPreview" for="groupAvatarInput" style="width:76px;height:76px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;"><i class="fas fa-users"></i></label>
                        <div style="flex:1;">
                            <input id="groupTitleInput" class="modal-input" maxlength="220" placeholder="Название" style="margin-bottom:10px;text-align:left;">
                            <input id="groupInviteInput" class="modal-input" maxlength="120" placeholder="Своя ссылка (необязательно)" style="margin-bottom:0;text-align:left;">
                        </div>
                    </div>
                    <input id="groupAvatarInput" type="file" accept="image/*" style="display:none" onchange="onGroupAvatarSelected(event)">
                    <textarea id="groupDescriptionInput" class="modal-input" maxlength="4000" placeholder="Описание" style="min-height:96px;resize:vertical;text-align:left;"></textarea>
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Добавить участников</div>
                    <div class="contacts-list" style="max-height:220px;">${membersHtml}</div>
                    <div class="modal-buttons" style="margin-top:16px;">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerCreateGroupModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" onclick="submitCreateGroup()">Создать</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function submitCreateGroup() {
            const modal = document.getElementById('messengerCreateGroupModal');
            if (!modal) return;
            const title = String(modal.querySelector('#groupTitleInput')?.value || '').trim();
            if (!title) {
                showNotification('Мессенджер', 'Укажите название чата', 'warning');
                return;
            }
            const inviteCode = String(modal.querySelector('#groupInviteInput')?.value || '').trim();
            const description = String(modal.querySelector('#groupDescriptionInput')?.value || '').trim();
            const avatar = String(modal.querySelector('#groupAvatarInput')?.dataset?.avatar || '');
            const memberIds = Array.from(modal.querySelectorAll('.contacts-list input[type="checkbox"]:checked')).map((el) => String(el.value || '').trim()).filter(Boolean);
            sendMessengerEvent({
                type: 'messenger-create-group',
                title,
                description,
                inviteCode,
                avatar,
                memberIds
            });
            modal.remove();
        }

        function getGroupRoleLabel(role) {
            if (role === 'owner') return 'Владелец';
            if (role === 'admin') return 'Администратор';
            return 'Участник';
        }

        function getGroupPermissionLabel(value) {
            return { owner: 'Только владелец', owner_admins: 'Владелец и администраторы', all: 'Все' }[String(value || '').trim()] || 'Владелец и администраторы';
        }

        function hasGroupPermissionClient(chat, key) {
            const role = String(chat?.group?.myRole || '').trim();
            if (!role) return false;
            const rule = String(chat?.group?.permissions?.[key] || 'owner_admins').trim();
            if (rule === 'all') return true;
            if (rule === 'owner_admins') return role === 'owner' || role === 'admin';
            return role === 'owner';
        }

        function canManageGroupMemberClient(chat, member) {
            const myRole = String(chat?.group?.myRole || '').trim();
            const targetRole = String(member?.role || '').trim();
            const rank = { owner: 3, admin: 2, member: 1 };
            const myRank = rank[myRole] || 0;
            const targetRank = rank[targetRole] || 0;
            return !!member?.userId && String(member.userId) !== String(authProfile?.appUserId || '') && myRank > targetRank;
        }

        function getGroupInviteUrl(chat) {
            const code = String(chat?.group?.inviteCode || '').trim();
            if (!code) return '';
            return `${location.origin}${location.pathname}?groupInvite=${encodeURIComponent(code)}`;
        }

        function openGroupEditModal(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat || !isGroupMessengerChat(chat)) return;
            closeTransientModal('messengerGroupEditModal');
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupEditModal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:560px;text-align:left;">
                    <h2><i class="fas fa-pen"></i> Изменение информации</h2>
                    <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px;">
                        <label id="groupEditAvatarPreview" for="groupEditAvatarInput" style="width:76px;height:76px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;">${chat.peer?.avatar ? `<img src="${escapeHtml(chat.peer.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:18px;">` : '<i class="fas fa-users"></i>'}</label>
                        <div style="flex:1;">
                            <input id="groupEditTitleInput" class="modal-input" maxlength="220" placeholder="Название" value="${escapeHtml(chat.peer?.displayName || chat.peer?.name || '')}" style="margin-bottom:10px;text-align:left;">
                            <input id="groupEditInviteInput" class="modal-input" maxlength="120" placeholder="Своя ссылка" value="${escapeHtml(chat.group?.inviteCode || '')}" style="margin-bottom:0;text-align:left;">
                        </div>
                    </div>
                    <input id="groupEditAvatarInput" type="file" accept="image/*" style="display:none" onchange="onGroupEditAvatarSelected(event)">
                    <textarea id="groupEditDescriptionInput" class="modal-input" maxlength="4000" placeholder="Описание" style="min-height:96px;resize:vertical;text-align:left;">${escapeHtml(chat.group?.description || '')}</textarea>
                    <div class="modal-buttons">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupEditModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" onclick="submitGroupEdit('${escapeHtml(chatId)}')">Сохранить</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function onGroupEditAvatarSelected(event) {
            const input = event?.target;
            const file = input?.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = () => {
                const raw = String(reader.result || '');
                const preview = document.getElementById('groupEditAvatarPreview');
                if (preview) {
                    preview.innerHTML = raw ? `<img src="${escapeHtml(raw)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:18px;">` : '<i class="fas fa-users"></i>';
                }
                if (input) input.dataset.avatar = raw;
            };
            reader.readAsDataURL(file);
        }

        function submitGroupEdit(chatId) {
            const modal = document.getElementById('messengerGroupEditModal');
            if (!modal) return;
            const payload = {
                type: 'messenger-update-group',
                chatId,
                title: String(modal.querySelector('#groupEditTitleInput')?.value || '').trim(),
                description: String(modal.querySelector('#groupEditDescriptionInput')?.value || '').trim(),
                inviteCode: String(modal.querySelector('#groupEditInviteInput')?.value || '').trim()
            };
            const avatarData = modal.querySelector('#groupEditAvatarInput')?.dataset?.avatar;
            if (avatarData !== undefined) payload.avatar = String(avatarData || '');
            sendMessengerEvent(payload);
            modal.remove();
        }

        function openAppearanceSettingsModal() {
            closeTransientModal('messengerAppearanceSettingsModal');
            const draft = {
                theme: messengerAppearance.theme === 'dark' ? 'dark' : 'classic',
                chatWallpaper: String(messengerAppearance.chatWallpaper || '').trim(),
                chatWallpaperBlur: messengerAppearance.chatWallpaperBlur !== false
            };
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerAppearanceSettingsModal';
            modal.innerHTML = `
                <div class="modal-content modal-sheet modal-sheet--pc-dialog">
                    <div class="modal-sheet-header">
                        <div class="modal-sheet-title"><i class="fas fa-palette"></i><span>Внешний вид</span></div>
                        <button type="button" class="modal-sheet-close" onclick="closeTransientModal('messengerAppearanceSettingsModal')" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-sheet-body">
                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Темы</div>
                                <div class="ui-row-subtitle">Дарк и классик — выбирай что нравится.</div>
                            </div>
                        </div>

                        <div class="ui-cards" style="margin-bottom:14px;">
                            <div class="ui-card ${draft.theme === 'classic' ? 'active' : ''}" id="appearanceThemeClassic" role="button" tabindex="0">
                                <div class="ui-card-title"><span><i class="fas fa-sun" style="margin-right:8px;"></i>Классический</span>${draft.theme === 'classic' ? '<span style="opacity:.9;">Выбран</span>' : ''}</div>
                                <div class="ui-card-subtitle">Светлее и мягче акценты.</div>
                                <div class="ui-preview ui-preview--classic">
                                    <div class="ui-preview-msgs">
                                        <div class="ui-preview-bubble">Классик</div>
                                        <div class="ui-preview-bubble out">Готово</div>
                                    </div>
                                </div>
                            </div>
                            <div class="ui-card ${draft.theme === 'dark' ? 'active' : ''}" id="appearanceThemeDark" role="button" tabindex="0">
                                <div class="ui-card-title"><span><i class="fas fa-moon" style="margin-right:8px;"></i>Дарк</span>${draft.theme === 'dark' ? '<span style="opacity:.9;">Выбран</span>' : ''}</div>
                                <div class="ui-card-subtitle">Глубокий фон и яркие градиенты.</div>
                                <div class="ui-preview ui-preview--dark">
                                    <div class="ui-preview-msgs">
                                        <div class="ui-preview-bubble">Дарк</div>
                                        <div class="ui-preview-bubble out">Готово</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Обои чата</div>
                                <div class="ui-row-subtitle">Загрузи свою картинку. Размытие можно включить/выключить.</div>
                            </div>
                            <div class="ui-row-actions">
                                <button type="button" class="ui-mini-btn" id="appearanceWallpaperPick"><i class="fas fa-image"></i><span>${draft.chatWallpaper ? 'Сменить' : 'Загрузить'}</span></button>
                                <button type="button" class="ui-mini-btn delete" id="appearanceWallpaperRemove" style="display:${draft.chatWallpaper ? 'inline-flex' : 'none'};"><i class="fas fa-trash"></i><span>Удалить</span></button>
                            </div>
                        </div>

                        <label class="ui-row" style="cursor:pointer;">
                            <div>
                                <div class="ui-row-title">Размытие обоев</div>
                                <div class="ui-row-subtitle">Если выключить — обои будут четкими.</div>
                            </div>
                            <div class="ui-row-actions">
                                <input id="appearanceWallpaperBlurToggle" type="checkbox" ${draft.chatWallpaperBlur ? 'checked' : ''} style="accent-color:#7c5cff;width:18px;height:18px;">
                            </div>
                        </label>

                        <input type="file" id="appearanceWallpaperInput" accept="image/*" style="display:none">
                    </div>
                    <div class="modal-buttons" style="flex-shrink:0;">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerAppearanceSettingsModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" id="appearanceApplyBtn">Применить</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            const themeClassicEl = document.getElementById('appearanceThemeClassic');
            const themeDarkEl = document.getElementById('appearanceThemeDark');
            const pickBtn = document.getElementById('appearanceWallpaperPick');
            const removeBtn = document.getElementById('appearanceWallpaperRemove');
            const blurToggle = document.getElementById('appearanceWallpaperBlurToggle');
            const fileInput = document.getElementById('appearanceWallpaperInput');
            const applyBtn = document.getElementById('appearanceApplyBtn');

            const syncPreview = () => {
                if (removeBtn) removeBtn.style.display = draft.chatWallpaper ? 'inline-flex' : 'none';
                if (pickBtn) {
                    const span = pickBtn.querySelector('span');
                    if (span) span.textContent = draft.chatWallpaper ? 'Сменить' : 'Загрузить';
                }
                if (themeClassicEl) themeClassicEl.classList.toggle('active', draft.theme === 'classic');
                if (themeDarkEl) themeDarkEl.classList.toggle('active', draft.theme === 'dark');
                if (blurToggle) blurToggle.checked = !!draft.chatWallpaperBlur;
            };

            const bindCard = (el, theme) => {
                if (!el) return;
                const activate = () => {
                    draft.theme = theme;
                    syncPreview();
                };
                el.onclick = activate;
                el.onkeydown = (e) => {
                    if (e && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        activate();
                    }
                };
            };
            bindCard(themeClassicEl, 'classic');
            bindCard(themeDarkEl, 'dark');

            if (pickBtn && fileInput) pickBtn.onclick = () => fileInput.click();
            if (removeBtn) removeBtn.onclick = () => {
                draft.chatWallpaper = '';
                syncPreview();
            };
            if (blurToggle) blurToggle.onchange = () => {
                draft.chatWallpaperBlur = !!blurToggle.checked;
                syncPreview();
            };
            if (fileInput) {
                fileInput.onchange = async () => {
                    const file = fileInput.files && fileInput.files[0];
                    if (!file || !/^image\//i.test(file.type || '')) return;
                    try {
                        draft.chatWallpaper = await compressImageToJpegDataUrl(file, 1920, 0.82);
                        syncPreview();
                    } catch (_) {
                        showNotification('Обои', 'Не удалось обработать изображение', 'warning');
                    }
                    fileInput.value = '';
                };
            }
            if (applyBtn) {
                applyBtn.onclick = () => {
                    messengerAppearance = {
                        ...messengerAppearance,
                        theme: draft.theme === 'dark' ? 'dark' : 'classic',
                        chatWallpaper: String(draft.chatWallpaper || '').trim(),
                        chatWallpaperBlur: !!draft.chatWallpaperBlur
                    };
                    applyMessengerTheme();
                    sendMessengerEvent({
                        type: 'messenger-update-appearance',
                        theme: messengerAppearance.theme,
                        chatWallpaper: messengerAppearance.chatWallpaper,
                        chatWallpaperBlur: !!messengerAppearance.chatWallpaperBlur
                    });
                    closeTransientModal('messengerAppearanceSettingsModal');
                    if (shouldRenderMessengerUi()) renderMainScreen();
                };
            }
            syncPreview();
        }

        function renderGroupPermissionSelect(id, current) {
            const safe = ['owner', 'owner_admins', 'all'].includes(String(current || '').trim()) ? String(current).trim() : 'owner_admins';
            return `<select id="${id}" class="modal-input" style="margin:0;text-align:left;">
                <option value="owner" ${safe === 'owner' ? 'selected' : ''}>Только владелец</option>
                <option value="owner_admins" ${safe === 'owner_admins' ? 'selected' : ''}>Владелец и администраторы</option>
                <option value="all" ${safe === 'all' ? 'selected' : ''}>Все</option>
            </select>`;
        }

        function openGroupSettingsModal(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat || !isGroupMessengerChat(chat)) return;
            closeTransientModal('messengerGroupSettingsModal');
            const perms = chat.group?.permissions || {};
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupSettingsModal';
            modal.innerHTML = `
                <div class="modal-content modal-sheet">
                    <div class="modal-sheet-header">
                        <div class="modal-sheet-title"><i class="fas fa-cog"></i><span>Управление чатом</span></div>
                        <button type="button" class="modal-sheet-close" onclick="closeTransientModal('messengerGroupSettingsModal')" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-sheet-body">
                        <div class="ui-row" style="margin-bottom:12px;">
                            <div>
                                <div class="ui-row-title">Права доступа</div>
                                <div class="ui-row-subtitle">Кто и что может делать в этом чате.</div>
                            </div>
                        </div>

                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Добавлять участников</div>
                                <div class="ui-row-subtitle">Кому разрешено приглашать людей.</div>
                            </div>
                            <div class="ui-row-actions">${renderGroupPermissionSelect('permAddMembers', perms.addMembers)}</div>
                        </div>

                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Изменять информацию</div>
                                <div class="ui-row-subtitle">Название, описание и аватар чата.</div>
                            </div>
                            <div class="ui-row-actions">${renderGroupPermissionSelect('permEditInfo', perms.editInfo)}</div>
                        </div>

                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Модерация</div>
                                <div class="ui-row-subtitle">Мьют/бан/кик и управление участниками.</div>
                            </div>
                            <div class="ui-row-actions">${renderGroupPermissionSelect('permModerate', perms.moderate)}</div>
                        </div>

                        <div class="ui-row" style="margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Ссылка чата</div>
                                <div class="ui-row-subtitle">Кто видит и может копировать инвайт.</div>
                            </div>
                            <div class="ui-row-actions">${renderGroupPermissionSelect('permLinkAccess', perms.linkAccess)}</div>
                        </div>

                        <div class="ui-row" style="margin-bottom:12px;">
                            <div>
                                <div class="ui-row-title">Звонки</div>
                                <div class="ui-row-subtitle">Кто может создавать групповой звонок.</div>
                            </div>
                            <div class="ui-row-actions">${renderGroupPermissionSelect('permCreateCalls', perms.createCalls)}</div>
                        </div>

                        <label class="ui-row" style="cursor:pointer;">
                            <div>
                                <div class="ui-row-title">Вступление по ссылке</div>
                                <div class="ui-row-subtitle">Если выключить — по ссылке никто не зайдёт.</div>
                            </div>
                            <div class="ui-row-actions">
                                <input id="groupJoinByLinkToggle" type="checkbox" ${chat.group?.joinByLink !== false ? 'checked' : ''} style="accent-color:#7c5cff;width:18px;height:18px;">
                            </div>
                        </label>
                    </div>
                    <div class="modal-buttons" style="flex-shrink:0;">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupSettingsModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" onclick="submitGroupSettings('${escapeHtml(chatId)}')">Сохранить</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function submitGroupSettings(chatId) {
            const modal = document.getElementById('messengerGroupSettingsModal');
            if (!modal) return;
            sendMessengerEvent({
                type: 'messenger-update-group',
                chatId,
                joinByLink: !!modal.querySelector('#groupJoinByLinkToggle')?.checked,
                permissions: {
                    addMembers: String(modal.querySelector('#permAddMembers')?.value || 'owner_admins'),
                    editInfo: String(modal.querySelector('#permEditInfo')?.value || 'owner_admins'),
                    moderate: String(modal.querySelector('#permModerate')?.value || 'owner_admins'),
                    linkAccess: String(modal.querySelector('#permLinkAccess')?.value || 'owner_admins'),
                    createCalls: String(modal.querySelector('#permCreateCalls')?.value || 'owner_admins')
                }
            });
            modal.remove();
        }

        function openAddMembersToGroupModal(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat || !isGroupMessengerChat(chat)) return;
            const currentMembers = new Set((chat.group?.members || []).map((v) => String(v || '')));
            const friends = (friendsState.friends || []).filter((friend) => !currentMembers.has(String(friend.id || '')));
            const list = friends.length
                ? friends.map((friend) => `
                    <label class="contact-item" style="cursor:pointer;justify-content:flex-start;gap:12px;">
                        <input type="checkbox" value="${escapeHtml(friend.id || '')}" style="accent-color:#7c5cff;">
                        <div style="width:42px;height:42px;flex-shrink:0;">${avatarMarkup(friend.displayName || friend.name || friend.id || '', friend.avatar || '', friend.initials || '')}</div>
                        <div style="min-width:0;">
                            <div class="contact-name">${escapeHtml(friend.displayName || friend.name || friend.id || '')}</div>
                            <div class="contact-chat">${escapeHtml(friend.username ? '@' + friend.username : friend.id || '')}</div>
                        </div>
                    </label>`).join('')
                : '<div class="friends-empty">Свободных друзей для добавления нет</div>';
            closeTransientModal('messengerGroupAddMembersModal');
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupAddMembersModal';
            modal.innerHTML = `<div class="modal-content" style="max-width:560px;text-align:left;"><h2><i class="fas fa-user-plus"></i> Добавить участников</h2><div class="contacts-list" style="max-height:320px;">${list}</div><div class="modal-buttons"><button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupAddMembersModal')">Отмена</button><button type="button" class="modal-btn confirm" onclick="submitAddMembersToGroup('${escapeHtml(chatId)}')">Добавить</button></div></div>`;
            document.body.appendChild(modal);
        }

        function submitAddMembersToGroup(chatId) {
            const modal = document.getElementById('messengerGroupAddMembersModal');
            if (!modal) return;
            const memberIds = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((el) => String(el.value || '').trim()).filter(Boolean);
            if (!memberIds.length) {
                showNotification('Группа', 'Выберите хотя бы одного друга', 'warning');
                return;
            }
            sendMessengerEvent({ type: 'messenger-add-group-members', chatId, memberIds });
            modal.remove();
        }

        function openGroupMemberActionModal(chatId, targetUserId) {
            const chat = findMessengerChatById(chatId);
            const member = (chat?.group?.participants || []).find((item) => String(item?.userId || '') === String(targetUserId || ''));
            if (!chat || !member) return;
            closeTransientModal('messengerGroupMemberActionModal');
            const restriction = member?.restriction || null;
            const canToggleAdmin = String(chat?.group?.myRole || '') === 'owner';
            const muteActionLabel = restriction?.type === 'muted' ? 'Снять мут' : 'Мьют';
            const muteActionValue = restriction?.type === 'muted' ? 'unmute' : 'mute';
            const banActionLabel = restriction?.type === 'banned' ? 'Снять блокировку' : 'Блокировка';
            const banActionValue = restriction?.type === 'banned' ? 'unban' : 'ban';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupMemberActionModal';
            modal.innerHTML = `
                <div class="modal-content modal-sheet modal-sheet--pc-dialog">
                    <div class="modal-sheet-header">
                        <div class="modal-sheet-title"><i class="fas fa-user-shield"></i><span>Управление участником</span></div>
                        <button type="button" class="modal-sheet-close" onclick="closeTransientModal('messengerGroupMemberActionModal')" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-sheet-body">
                        <div class="ui-row" style="margin-bottom:12px;">
                            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                                <div style="width:52px;height:52px;flex-shrink:0;">${avatarMarkup(member.displayName || member.name || member.userId || '', member.avatar || '', member.initials || '')}</div>
                                <div style="min-width:0;">
                                    <div class="ui-row-title" style="font-size:14px;">${escapeHtml(member.displayName || member.name || member.userId || '')}</div>
                                    <div class="ui-row-subtitle">${escapeHtml(getGroupRoleLabel(member.role))}</div>
                                </div>
                            </div>
                        </div>

                        ${renderGroupRestrictionSummaryCard(restriction)}

                        <label class="ui-row" style="cursor:${canToggleAdmin ? 'pointer' : 'default'};opacity:${canToggleAdmin ? '1' : '0.75'};">
                            <div>
                                <div class="ui-row-title">${member.role === 'admin' ? 'Администратор' : 'Сделать администратором'}</div>
                                <div class="ui-row-subtitle">${canToggleAdmin ? 'Владелец может назначать/снимать администратора.' : 'Доступно только владельцу чата.'}</div>
                            </div>
                            <div class="ui-row-actions">
                                <input id="groupAdminToggle" type="checkbox" ${member.role === 'admin' ? 'checked' : ''} ${canToggleAdmin ? '' : 'disabled'} style="accent-color:#7c5cff;width:18px;height:18px;">
                            </div>
                        </label>

                        <div class="ui-row" style="margin-top:12px;margin-bottom:10px;">
                            <div>
                                <div class="ui-row-title">Действие</div>
                                <div class="ui-row-subtitle">Выбери режим: без наказания, мьют, блокировка или исключение.</div>
                            </div>
                        </div>

                        <div class="ui-radio-list" style="margin-bottom:12px;">
                            <label class="ui-radio-item" onclick="onGroupMemberActionPick(event,'none')">
                                <div class="ui-radio-left">
                                    <div class="ui-radio-title"><i class="fas fa-shield-alt" style="opacity:.9;"></i> Без наказания</div>
                                    <div class="ui-radio-subtitle">Ничего не применять, только сохранить роль.</div>
                                </div>
                                <div class="ui-radio-right">
                                    <input type="radio" name="groupActionMode" value="none" checked>
                                </div>
                            </label>
                            <label class="ui-radio-item" onclick="onGroupMemberActionPick(event,'${escapeHtml(muteActionValue)}')">
                                <div class="ui-radio-left">
                                    <div class="ui-radio-title"><i class="fas fa-volume-mute" style="opacity:.9;"></i> ${escapeHtml(muteActionLabel)}</div>
                                    <div class="ui-radio-subtitle">${muteActionValue === 'mute' ? 'Ограничить отправку сообщений на время.' : 'Снять ограничение на сообщения.'}</div>
                                </div>
                                <div class="ui-radio-right">
                                    <input type="radio" name="groupActionMode" value="${escapeHtml(muteActionValue)}">
                                </div>
                            </label>
                            <label class="ui-radio-item" onclick="onGroupMemberActionPick(event,'${escapeHtml(banActionValue)}')">
                                <div class="ui-radio-left">
                                    <div class="ui-radio-title"><i class="fas fa-ban" style="opacity:.9;"></i> ${escapeHtml(banActionLabel)}</div>
                                    <div class="ui-radio-subtitle">${banActionValue === 'ban' ? 'Запретить доступ к чату на время.' : 'Снять блокировку доступа к чату.'}</div>
                                </div>
                                <div class="ui-radio-right">
                                    <input type="radio" name="groupActionMode" value="${escapeHtml(banActionValue)}">
                                </div>
                            </label>
                            <label class="ui-radio-item" onclick="onGroupMemberActionPick(event,'kick')">
                                <div class="ui-radio-left">
                                    <div class="ui-radio-title"><i class="fas fa-user-slash" style="opacity:.9;"></i> Исключение</div>
                                    <div class="ui-radio-subtitle">Удалить участника из чата.</div>
                                </div>
                                <div class="ui-radio-right">
                                    <input type="radio" name="groupActionMode" value="kick">
                                </div>
                            </label>
                        </div>

                        <div id="groupActionDurationWrap" style="display:none;">
                            <div class="ui-row" style="margin-bottom:10px;">
                                <div>
                                    <div class="ui-row-title">Срок</div>
                                    <div class="ui-row-subtitle">Для мьюта/блокировки можно выбрать длительность.</div>
                                </div>
                            </div>
                            <div class="ui-input-grid" style="margin-bottom:10px;">
                                <input id="groupActionDurationValue" class="modal-input" type="number" min="1" value="1" placeholder="Срок" style="margin:0;text-align:left;">
                                <select id="groupActionDurationUnit" class="modal-input" style="margin:0;text-align:left;">
                                    <option value="minutes">Минуты</option>
                                    <option value="hours">Часы</option>
                                    <option value="days">Дни</option>
                                    <option value="forever">Навсегда</option>
                                </select>
                            </div>
                        </div>

                        <input id="groupActionReasonInput" class="modal-input" placeholder="Причина" style="margin:0;text-align:left;">
                    </div>
                    <div class="modal-buttons" style="flex-shrink:0;">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupMemberActionModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" onclick="submitGroupMemberAction('${escapeHtml(chatId)}','${escapeHtml(targetUserId)}')">Применить</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            toggleGroupMemberActionFields();
        }

        function onGroupMemberActionPick(event, nextValue) {
            try {
                event?.preventDefault?.();
                event?.stopPropagation?.();
            } catch (_) {}
            const modal = document.getElementById('messengerGroupMemberActionModal');
            if (!modal) return false;
            const current = String(modal.querySelector('input[name="groupActionMode"]:checked')?.value || 'none');
            const picked = String(nextValue || 'none');
            const next = current === picked && picked !== 'none' ? 'none' : picked;
            modal.querySelectorAll('input[name="groupActionMode"]').forEach((el) => {
                el.checked = String(el.value || '') === next;
            });
            toggleGroupMemberActionFields();
            return false;
        }

        function toggleGroupMemberActionFields() {
            const modal = document.getElementById('messengerGroupMemberActionModal');
            if (!modal) return;
            const action = String(modal.querySelector('input[name="groupActionMode"]:checked')?.value || 'none');
            const durationWrap = modal.querySelector('#groupActionDurationWrap');
            const reasonInput = modal.querySelector('#groupActionReasonInput');
            if (durationWrap) durationWrap.style.display = action === 'mute' || action === 'ban' ? '' : 'none';
            const list = modal.querySelector('.ui-radio-list');
            if (list) {
                const items = Array.from(list.querySelectorAll('.ui-radio-item'));
                if (action && action !== 'none') {
                    items.forEach((label) => {
                        const v = String(label.querySelector('input[name="groupActionMode"]')?.value || '');
                        label.style.display = v === action ? '' : 'none';
                    });
                } else {
                    items.forEach((label) => {
                        label.style.display = '';
                    });
                }
            }
            if (reasonInput) {
                reasonInput.placeholder = action === 'kick'
                    ? 'Причина исключения'
                    : action === 'ban'
                        ? 'Причина блокировки'
                        : action === 'mute'
                            ? 'Причина мьюта'
                            : action === 'unban'
                                ? 'Причина снятия блокировки'
                                : action === 'unmute'
                                    ? 'Причина снятия мута'
                                    : 'Причина';
            }
        }

        function submitGroupMemberAction(chatId, targetUserId) {
            const modal = document.getElementById('messengerGroupMemberActionModal');
            if (!modal) return;
            const chat = findMessengerChatById(chatId);
            const member = (chat?.group?.participants || []).find((item) => String(item?.userId || '') === String(targetUserId || ''));
            const adminToggle = !!modal.querySelector('#groupAdminToggle')?.checked;
            const selectedAction = String(modal.querySelector('input[name="groupActionMode"]:checked')?.value || 'none');
            const reason = String(modal.querySelector('#groupActionReasonInput')?.value || '').trim();
            const durationValue = Number(modal.querySelector('#groupActionDurationValue')?.value || 1);
            const durationUnit = String(modal.querySelector('#groupActionDurationUnit')?.value || 'minutes');
            const roleWasAdmin = String(member?.role || '') === 'admin';
            const canToggleAdmin = String(chat?.group?.myRole || '') === 'owner';
            if (canToggleAdmin && roleWasAdmin !== adminToggle) {
                sendMessengerEvent({ type: 'messenger-group-member-action', chatId, targetUserId, action: 'toggle-admin', enabled: adminToggle });
            }
            if (selectedAction !== 'none') {
                sendMessengerEvent({
                    type: 'messenger-group-member-action',
                    chatId,
                    targetUserId,
                    action: selectedAction,
                    durationValue,
                    durationUnit,
                    reason
                });
            }
            if ((roleWasAdmin === adminToggle || !canToggleAdmin) && selectedAction === 'none') {
                showNotification('Группа', 'Выберите действие для участника', 'warning');
                return;
            }
            modal.remove();
        }

        function openGroupInvitePreviewModal(group, inviteCode, canJoin) {
            closeTransientModal('messengerGroupInvitePreviewModal');
            const model = buildGroupChatClientModel(group);
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupInvitePreviewModal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:520px;text-align:left;">
                    <div style="display:flex;justify-content:center;margin-bottom:14px;"><div style="width:88px;height:88px;">${avatarMarkup(model?.peer?.displayName || group.title || 'Групповой чат', group.avatar || '', model?.peer?.initials || '')}</div></div>
                    <div style="text-align:center;font-size:22px;font-weight:800;margin-bottom:8px;">${escapeHtml(group.title || 'Групповой чат')}</div>
                    <div style="text-align:center;opacity:.78;margin-bottom:14px;">${escapeHtml(`${Array.isArray(group.members) ? group.members.length : 0} участников`)}</div>
                    <div class="contact-item" style="justify-content:flex-start;margin-bottom:14px;"><div><div class="contact-chat">Описание</div><div class="contact-name">${escapeHtml(group.description || 'Без описания')}</div></div></div>
                    <div class="modal-buttons">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupInvitePreviewModal')">Отмена</button>
                        <button type="button" class="modal-btn confirm" ${canJoin ? '' : 'disabled'} onclick="joinGroupByInvite('${escapeHtml(inviteCode || '')}')">${canJoin ? 'Присоединиться' : 'Вы уже в чате'}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function joinGroupByInvite(inviteCode) {
            sendMessengerEvent({ type: 'messenger-join-group-by-invite', inviteCode });
            closeTransientModal('messengerGroupInvitePreviewModal');
        }

        function openGroupProfileModal(chatId) {
            const chat = findMessengerChatById(chatId);
            if (!chat || !isGroupMessengerChat(chat)) return;
            closeTransientModal('messengerGroupProfileModal');
            const participants = Array.isArray(chat.group?.participants) ? chat.group.participants : [];
            const canEditInfo = hasGroupPermissionClient(chat, 'editInfo');
            const canAddMembers = hasGroupPermissionClient(chat, 'addMembers');
            const canCreateCalls = hasGroupPermissionClient(chat, 'createCalls');
            const isOwner = String(chat.group?.myRole || '') === 'owner';
            const inviteUrl = getGroupInviteUrl(chat);
            const canSeeLink = hasGroupPermissionClient(chat, 'linkAccess');
            const membersHtml = participants.length
                ? participants.map((member) => {
                    const memberId = String(member.userId || '').trim();
                    const canOpenProfile = !!memberId;
                    const memberClick = canOpenProfile
                        ? `onclick="closeTransientModal('messengerGroupProfileModal'); openUserProfile('${escapeHtml(memberId)}')"`
                        : '';
                    const roleLabel = getGroupRoleLabel(member?.role);
                    const presence = getParticipantPresenceState(member);
                    const onlineLabel = presence.online ? 'В сети' : 'Не в сети';
                    const lastSeenLabel = !presence.online && Number(presence.lastSeenAt || 0) > 0
                        ? `Был(а): ${new Date(Number(presence.lastSeenAt)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : '';
                    return `
                    <div class="contact-item" style="justify-content:flex-start;gap:12px;">
                        <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;cursor:${canOpenProfile ? 'pointer' : 'default'};" ${memberClick}>
                            <div style="width:44px;height:44px;flex-shrink:0;">${avatarMarkup(member.displayName || member.name || member.userId || '', member.avatar || '', member.initials || '')}</div>
                            <div style="min-width:0;flex:1;">
                            <div class="contact-name">${escapeHtml(member.displayName || member.name || member.userId || '')}</div>
                            <div class="contact-chat">${escapeHtml(`Роль: ${roleLabel}`)}</div>
                            <div class="contact-chat">${escapeHtml(`Статус сети: ${onlineLabel}`)}</div>
                            ${lastSeenLabel ? `<div class="contact-chat">${escapeHtml(lastSeenLabel)}</div>` : ''}
                            ${getGroupRestrictionStatusText(member.restriction) ? `<div class="contact-chat">${escapeHtml(getGroupRestrictionStatusText(member.restriction))}</div>` : ''}
                            </div>
                        </div>
                        ${canManageGroupMemberClient(chat, member) ? `<button type="button" class="messenger-nav-btn" onclick="event.stopPropagation(); openGroupMemberActionModal('${escapeHtml(chatId)}','${escapeHtml(member.userId || '')}')"><i class="fas fa-ellipsis-v"></i></button>` : ''}
                    </div>`;
                }).join('')
                : '<div class="friends-empty">Участники не найдены</div>';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'messengerGroupProfileModal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:680px;text-align:left;">
                    <div style="display:flex;justify-content:center;position:relative;margin-bottom:14px;">
                        <div style="width:92px;height:92px;">${avatarMarkup(chat.peer?.displayName || chat.peer?.name || 'Групповой чат', chat.peer?.avatar || '', chat.peer?.initials || '')}</div>
                    </div>
                    <div style="text-align:center;font-size:22px;font-weight:800;margin-bottom:6px;">${escapeHtml(chat.peer?.displayName || chat.peer?.name || 'Групповой чат')}</div>
                    <div style="text-align:center;font-size:13px;opacity:.8;margin-bottom:16px;">${escapeHtml(getGroupChatStatusText(chat))}</div>
                    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;">
                        ${isOwner ? `<button type="button" class="contact-btn" onclick="openGroupSettingsModal('${escapeHtml(chatId)}')"><i class="fas fa-cog"></i> Настройки</button>` : ''}
                        ${canEditInfo ? `<button type="button" class="contact-btn" onclick="openGroupEditModal('${escapeHtml(chatId)}')"><i class="fas fa-pen"></i> Изменить</button>` : ''}
                        ${canAddMembers ? `<button type="button" class="contact-btn" onclick="openAddMembersToGroupModal('${escapeHtml(chatId)}')"><i class="fas fa-user-plus"></i> Добавить</button>` : ''}
                        ${canCreateCalls ? `<button type="button" class="contact-btn" onclick="startGroupCallForChat('${escapeHtml(chatId)}')"><i class="fas fa-phone"></i> Звонок</button>` : ''}
                        <button type="button" class="contact-btn delete" onclick="leaveGroupChat('${escapeHtml(chatId)}')"><i class="fas fa-sign-out-alt"></i> Выйти</button>
                    </div>
                    <div style="display:grid;gap:10px;margin-bottom:16px;">
                        <div class="contact-item" style="justify-content:flex-start;"><div><div class="contact-chat">Описание</div><div class="contact-name">${escapeHtml(chat.group?.description || 'Без описания')}</div></div></div>
                        <div class="contact-item" style="justify-content:flex-start;cursor:${canSeeLink && inviteUrl ? 'pointer' : 'default'};" ${canSeeLink && inviteUrl ? `onclick="copyGroupInviteLink('${escapeHtml(inviteUrl)}')"` : ''}><div><div class="contact-chat">Ссылка</div><div class="contact-name">${escapeHtml(canSeeLink ? (inviteUrl || 'Будет сгенерирована автоматически') : 'Недоступно по настройкам')}</div></div></div>
                    </div>
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Участники</div>
                    <div class="contacts-list" style="max-height:260px;">${membersHtml}</div>
                    <div class="modal-buttons" style="margin-top:16px;">
                        <button type="button" class="modal-btn cancel" onclick="closeTransientModal('messengerGroupProfileModal')">Закрыть</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        function leaveGroupChat(chatId) {
            showCustomConfirm('Выйти из чата', 'Вы действительно хотите выйти из группы?', () => {
                sendMessengerEvent({ type: 'messenger-update-group', chatId, action: 'leave' });
                closeTransientModal('messengerGroupProfileModal');
            });
        }

        function closeMobileChatView() {
            isChatOpen = false;
            messengerActiveChatId = '';
            messengerActivePeerId = '';
            persistMessengerSessionChat('');
            persistMessengerSessionPeer('');
            renderMainScreen();
        }

        function resolveChatMessages(chatId) {
            const list = messengerMessages.get(chatId);
            return Array.isArray(list) ? list : [];
        }

        function makeClientMessageId() {
            try {
                const id = (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
                return `tmp_${String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`;
            } catch (_) {
                return `tmp_${Date.now()}`;
            }
        }

        function upsertMessengerMessage(chatId, msg) {
            if (!chatId || !msg || !msg.id) return;
            const prev = messengerMessages.get(chatId) || [];
            const next = [...prev];
            const idx = next.findIndex((x) => x && x.id === msg.id);
            if (idx >= 0) next[idx] = msg;
            else next.push(msg);
            messengerMessages.set(chatId, next.slice(-300));
        }

        function sendMessageFromComposer() {
            if (messengerComposeBlocked) {
                showNotification('Мессенджер', messengerComposeHint || 'Отправка недоступна', 'warning');
                return;
            }
            // При отправке своего сообщения — всегда прокручиваем вниз.
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            messengerShouldAutoScroll = true;
            const input = document.getElementById('chatComposerInput');
            const text = String(input?.value || '').trim();
            const activeChat = resolveActiveMessengerChat();
            if (!text || !activeChat) return;
            let sent = false;
            if (composerEditMessageId) {
                sent = sendMessengerEvent({ type: 'messenger-edit', messageId: composerEditMessageId, text });
            } else {
                const clientMessageId = makeClientMessageId();
                const chatId = messengerActiveChatId;
                const meId = authProfile?.appUserId || '';
                if (chatId && meId && text) {
                    upsertMessengerMessage(chatId, {
                        id: clientMessageId,
                        chatId,
                        fromId: meId,
                        toId: isGroupMessengerChat(activeChat) ? chatId : messengerActivePeerId,
                        text,
                        messageKind: 'text',
                        createdAt: Date.now(),
                        editedAt: 0,
                        deletedAt: 0,
                        replyTo: composerReplyMessage?.id || '',
                        forwardedFromMessageId: '',
                        uploading: true,
                        uploadProgress: 0
                    });
                    if (shouldRenderMessengerUi()) {
                        requestAnimationFrame(() => renderMainScreen());
                    }
                }
                const payload = {
                    type: 'sendMessage',
                    chatId,
                    text,
                    replyTo: composerReplyMessage?.id || '',
                    clientMessageId
                };
                if (isDirectMessengerChat(activeChat)) payload.to = messengerActivePeerId;
                sent = sendMessengerEvent(payload);
            }
            if (!sent) return;
            if (input) input.value = '';
            composerDraftByPeerId.set(messengerActiveChatId || messengerActivePeerId, '');
            lastComposerTypingEmit = 0;
            sendMessengerEvent(
                isGroupMessengerChat(activeChat)
                    ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: false }
                    : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: false }
            );
            composerReplyMessage = null;
            composerEditMessageId = '';
            requestAnimationFrame(() => {
                const ta = document.getElementById('chatComposerInput');
                if (ta && messengerView === 'chats' && messengerActiveChatId) {
                    ta.focus();
                    onComposerInput();
                }
            });
        }

        function onComposerKeydown(event) {
            if (!event) return;
            if (composerMentionState?.open) {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    const len = Array.isArray(composerMentionState.candidates) ? composerMentionState.candidates.length : 0;
                    if (len) {
                        composerMentionState.activeIndex = (Number(composerMentionState.activeIndex || 0) + 1) % len;
                        syncComposerMentionMenuDom(resolveActiveMessengerChat());
                    }
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    const len = Array.isArray(composerMentionState.candidates) ? composerMentionState.candidates.length : 0;
                    if (len) {
                        composerMentionState.activeIndex = (Number(composerMentionState.activeIndex || 0) - 1 + len) % len;
                        syncComposerMentionMenuDom(resolveActiveMessengerChat());
                    }
                    return;
                }
                if (event.key === 'Escape') {
                    composerMentionState.open = false;
                    syncComposerMentionMenuDom(resolveActiveMessengerChat());
                    return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    const idx = Math.max(0, Number(composerMentionState.activeIndex || 0));
                    const cand = Array.isArray(composerMentionState.candidates) ? composerMentionState.candidates[idx] : null;
                    if (cand?.username) {
                        selectComposerMention(cand.username);
                    } else {
                        composerMentionState.open = false;
                        syncComposerMentionMenuDom(resolveActiveMessengerChat());
                    }
                    return;
                }
            }
            if (event.key !== 'Enter') return;
            // На телефоне отправляем только кнопкой, чтобы `Enter` не конфликтовал с переносом/UX.
            if (isMobileLayout()) return;
            if (event.shiftKey) return; // Shift+Enter => новая строка (по ТЗ).
            event.preventDefault();
            sendMessageFromComposer();
        }

        function renderComposerMentionMenu(chat) {
            if (!composerMentionState?.open) return '';
            if (!chat || !isGroupMessengerChat(chat)) return '';
            const candidates = Array.isArray(composerMentionState.candidates) ? composerMentionState.candidates : [];
            if (!candidates.length) return '';
            const activeIdx = Math.max(0, Number(composerMentionState.activeIndex || 0));
            const items = candidates.map((c, idx) => {
                const name = String(c.displayName || c.name || c.userId || '').trim() || String(c.userId || '');
                const uname = String(c.username || '').trim();
                return `<div class="composer-mention-item ${idx === activeIdx ? 'active' : ''}" onclick="selectComposerMention('${escapeHtml(uname)}')">
                    <div style="width:34px;height:34px;flex-shrink:0;">${avatarMarkup(name, c.avatar || '', c.initials || '')}</div>
                    <div class="composer-mention-meta">
                        <div class="composer-mention-name">${escapeHtml(name)}</div>
                        <div class="composer-mention-username">@${escapeHtml(uname)}</div>
                    </div>
                </div>`;
            }).join('');
            return `<div id="composerMentionMenu" class="composer-mention-menu" style="display:block;">${items}</div>`;
        }

        function closeComposerMentionMenu() {
            if (!composerMentionState) return;
            composerMentionState.open = false;
            composerMentionState.candidates = [];
            composerMentionState.activeIndex = 0;
            composerMentionState.query = '';
            composerMentionState.atIndex = -1;
            composerMentionState.endIndex = -1;
        }

        function updateComposerMentionMenu() {
            const prevOpen = !!composerMentionState?.open;
            const prevQuery = String(composerMentionState?.query || '');
            const prevKey = Array.isArray(composerMentionState?.candidates)
                ? composerMentionState.candidates.map((c) => String(c?.username || '')).join('|')
                : '';
            const prevAt = Number(composerMentionState?.atIndex || -1);
            const prevEnd = Number(composerMentionState?.endIndex || -1);
            const input = document.getElementById('chatComposerInput');
            const activeChat = resolveActiveMessengerChat();
            if (!input || !activeChat || !isGroupMessengerChat(activeChat)) {
                closeComposerMentionMenu();
                return prevOpen;
            }
            const value = String(input.value || '');
            const cursor = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
            const atIndex = value.lastIndexOf('@', Math.max(0, cursor - 1));
            if (atIndex < 0) {
                closeComposerMentionMenu();
                return prevOpen;
            }
            const before = atIndex > 0 ? value.charAt(atIndex - 1) : '';
            if (before && !/\s/.test(before)) {
                closeComposerMentionMenu();
                return prevOpen;
            }
            const query = value.slice(atIndex + 1, cursor);
            if (/\s/.test(query) || /[^a-zA-Z0-9]/.test(query)) {
                closeComposerMentionMenu();
                return prevOpen;
            }
            const q = String(query || '').toLowerCase();
            const members = getGroupChatParticipants(activeChat);
            const candidates = members
                .map((m) => {
                    const uid = String(m?.userId || m?.id || '').trim();
                    const peer = uid ? resolvePeerDisplay(uid) : null;
                    const username = String(m?.username || peer?.username || '').replace(/^@+/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (!username) return null;
                    const displayName = String(m?.displayName || peer?.displayName || peer?.name || uid || '').trim();
                    return {
                        userId: uid,
                        displayName,
                        name: String(peer?.name || displayName || uid || ''),
                        username,
                        avatar: String(m?.avatar || peer?.avatar || ''),
                        initials: String(m?.initials || peer?.initials || '')
                    };
                })
                .filter(Boolean)
                .filter((c) => !q || String(c.username || '').toLowerCase().includes(q) || String(c.displayName || '').toLowerCase().includes(q));
            candidates.sort((a, b) => {
                const au = String(a.username || '').toLowerCase();
                const bu = String(b.username || '').toLowerCase();
                const aStarts = q && au.startsWith(q);
                const bStarts = q && bu.startsWith(q);
                if (aStarts !== bStarts) return aStarts ? -1 : 1;
                return au.localeCompare(bu, 'ru-RU');
            });
            const limited = candidates.slice(0, 12);
            if (!limited.length) {
                closeComposerMentionMenu();
                return prevOpen;
            }
            composerMentionState.open = true;
            composerMentionState.query = q;
            composerMentionState.candidates = limited;
            composerMentionState.activeIndex = Math.min(Math.max(0, Number(composerMentionState.activeIndex || 0)), limited.length - 1);
            composerMentionState.atIndex = atIndex;
            composerMentionState.endIndex = cursor;
            const nextKey = limited.map((c) => String(c?.username || '')).join('|');
            return !prevOpen || prevQuery !== q || prevKey !== nextKey || prevAt !== atIndex || prevEnd !== cursor;
        }

        function selectComposerMention(username) {
            const uname = String(username || '').replace(/^@+/, '').trim();
            if (!uname) return;
            const input = document.getElementById('chatComposerInput');
            if (!input) return;
            const value = String(input.value || '');
            const atIndex = Number(composerMentionState?.atIndex || -1);
            const endIndex = Number(composerMentionState?.endIndex || -1);
            const start = atIndex >= 0 ? atIndex : value.lastIndexOf('@');
            const end = endIndex >= 0 ? endIndex : (typeof input.selectionStart === 'number' ? input.selectionStart : value.length);
            if (start < 0 || end < start) return;
            const insert = `@${uname} `;
            const next = value.slice(0, start) + insert + value.slice(end);
            input.value = next;
            const pos = start + insert.length;
            try {
                input.focus();
                input.setSelectionRange(pos, pos);
            } catch (_) {}
            const draftKey = messengerActiveChatId || messengerActivePeerId;
            if (draftKey) composerDraftByPeerId.set(draftKey, input.value);
            closeComposerMentionMenu();
            onComposerInput();
            syncComposerMentionMenuDom(resolveActiveMessengerChat());
        }

        function onComposerInput() {
            const input = document.getElementById('chatComposerInput');
            const hasText = !!String(input?.value || '').trim();
            const actionBtn = document.getElementById('chatComposerActionBtn');
            if (actionBtn) {
                if (voiceRecordingActive) {
                    actionBtn.innerHTML = '<i class="fas fa-stop"></i>';
                } else if (voiceRecordPreview) {
                    actionBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
                } else {
                    actionBtn.innerHTML = hasText ? '<i class="fas fa-paper-plane"></i>' : '<i class="fas fa-microphone"></i>';
                }
            }
            const activeChat = resolveActiveMessengerChat();
            const draftKey = messengerActiveChatId || messengerActivePeerId;
            if (draftKey && input) {
                composerDraftByPeerId.set(draftKey, input.value);
            }
            if (activeChat) {
                const now = Date.now();
                if (!hasText) {
                    lastComposerTypingEmit = 0;
                    sendMessengerEvent(
                        isGroupMessengerChat(activeChat)
                            ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: false }
                            : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: false }
                    );
                } else if (now - lastComposerTypingEmit > 850) {
                    lastComposerTypingEmit = now;
                    sendMessengerEvent(
                        isGroupMessengerChat(activeChat)
                            ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: true }
                            : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: true }
                    );
                }
            }
            const mentionChanged = updateComposerMentionMenu();
            if (mentionChanged && messengerView === 'chats') syncComposerMentionMenuDom(resolveActiveMessengerChat());
        }

        function clearVoiceRecTimerUi() {
            if (voiceRecTimerInterval) {
                clearInterval(voiceRecTimerInterval);
                voiceRecTimerInterval = null;
            }
        }

        function stopVoiceStreams() {
            clearVoiceRecTimerUi();
            try {
                if (voiceMediaStream) {
                    voiceMediaStream.getTracks().forEach((t) => t.stop());
                }
            } catch (_) {}
            voiceMediaStream = null;
            voiceMediaRecorder = null;
            voiceRecordChunks = [];
            voiceRecordingActive = false;
            voiceRecordStartedAt = 0;
        }

        function discardVoicePreview() {
            if (voicePreviewAudioEl) {
                try {
                    voicePreviewAudioEl.pause();
                } catch (_) {}
            }
            if (voiceRecordPreview?.url) {
                try {
                    URL.revokeObjectURL(voiceRecordPreview.url);
                } catch (_) {}
            }
            voiceRecordPreview = null;
        }

        function toggleVoicePreviewPlay(btn) {
            if (!voiceRecordPreview?.url) return;
            if (!voicePreviewAudioEl) voicePreviewAudioEl = new Audio();
            const icon = btn && btn.querySelector ? btn.querySelector('i') : null;
            voicePreviewAudioEl.src = voiceRecordPreview.url;
            if (voicePreviewAudioEl.paused) {
                voicePreviewAudioEl.play().catch(() => {});
                if (icon) icon.className = 'fas fa-pause';
            } else {
                voicePreviewAudioEl.pause();
                voicePreviewAudioEl.currentTime = 0;
                if (icon) icon.className = 'fas fa-play';
            }
            voicePreviewAudioEl.onended = () => {
                if (icon) icon.className = 'fas fa-play';
            };
        }

        async function startVoiceRecording() {
            const blockedPeer = (messengerProfile.blacklist || []).includes(String(messengerActivePeerId || ''));
            const activeChat = resolveActiveMessengerChat();
            if (messengerComposeBlocked || (isDirectMessengerChat(activeChat) && blockedPeer) || !messengerActiveChatId) {
                showNotification('Мессенджер', messengerComposeHint || 'Запись недоступна', 'warning');
                return;
            }
            if (voiceRecordingActive) return;
            discardVoicePreview();
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                voiceMediaStream = stream;
                voiceRecordChunks = [];
                const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
                voiceMediaRecorder = mr;
                mr.ondataavailable = (e) => {
                    if (e.data && e.data.size) voiceRecordChunks.push(e.data);
                };
                mr.start(120);
                voiceRecordingActive = true;
                voiceRecordStartedAt = Date.now();
                sendMessengerEvent(
                    isGroupMessengerChat(activeChat)
                        ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: true, activity: 'voice' }
                        : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: true, activity: 'voice' }
                );
                renderMainScreen();
                clearVoiceRecTimerUi();
                voiceRecTimerInterval = setInterval(() => {
                    const el = document.getElementById('voiceRecTimerUi');
                    if (el && voiceRecordStartedAt) {
                        el.textContent = formatVoiceDurationMs(Date.now() - voiceRecordStartedAt);
                    }
                }, 400);
            } catch (err) {
                stopVoiceStreams();
                showNotification('Микрофон', 'Нет доступа к микрофону', 'error');
            }
        }

        function stopVoiceRecordingCapture() {
            const mr = voiceMediaRecorder;
            const activeChat = resolveActiveMessengerChat();
            if (!mr || !voiceRecordingActive) {
                if (activeChat) {
                    sendMessengerEvent(
                        isGroupMessengerChat(activeChat)
                            ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: false, activity: 'voice' }
                            : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: false, activity: 'voice' }
                    );
                }
                stopVoiceStreams();
                renderMainScreen();
                return;
            }
            if (activeChat) {
                sendMessengerEvent(
                    isGroupMessengerChat(activeChat)
                        ? { type: 'messenger-typing', chatId: activeChat.id, isTyping: false, activity: 'voice' }
                        : { type: 'messenger-typing', toUserId: messengerActivePeerId, isTyping: false, activity: 'voice' }
                );
            }
            mr.onstop = () => {
                const blob = new Blob(voiceRecordChunks, { type: mr.mimeType || 'audio/webm' });
                const durationMs = Math.max(0, Date.now() - (voiceRecordStartedAt || Date.now()));
                clearVoiceRecTimerUi();
                stopVoiceStreams();
                if (blob.size < 48) {
                    showNotification('Мессенджер', 'Запись слишком короткая', 'warning');
                    renderMainScreen();
                    return;
                }
                const url = URL.createObjectURL(blob);
                voiceRecordPreview = {
                    blob,
                    mime: blob.type || mr.mimeType || 'audio/webm',
                    durationMs,
                    url
                };
                renderMainScreen();
            };
            try {
                if (typeof mr.requestData === 'function') mr.requestData();
                mr.stop();
            } catch (_) {
                stopVoiceStreams();
                renderMainScreen();
            }
        }

        function sendVoiceFromPreview() {
            const activeChat = resolveActiveMessengerChat();
            if (!voiceRecordPreview || !activeChat) return;
            const blockedPeer = (messengerProfile.blacklist || []).includes(String(messengerActivePeerId || ''));
            if (messengerComposeBlocked || (isDirectMessengerChat(activeChat) && blockedPeer)) {
                showNotification('Мессенджер', messengerComposeHint || 'Отправка недоступна', 'warning');
                return;
            }
            // При отправке своего сообщения — прокручиваем вниз.
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            messengerShouldAutoScroll = true;
            const { blob, mime, durationMs } = voiceRecordPreview;
            const r = new FileReader();
            r.onloadend = () => {
                const raw = String(r.result || '');
                const base64 = raw.includes(',') ? raw.split(',')[1] : '';
                if (voicePreviewAudioEl) {
                    try {
                        voicePreviewAudioEl.pause();
                    } catch (_) {}
                }
                if (voiceRecordPreview?.url) {
                    try {
                        URL.revokeObjectURL(voiceRecordPreview.url);
                    } catch (_) {}
                }
                voiceRecordPreview = null;
                if (!base64) {
                    showNotification('Мессенджер', 'Не удалось подготовить аудио', 'warning');
                    renderMainScreen();
                    return;
                }
                const payload = {
                    type: 'messenger-send',
                    chatId: activeChat.id,
                    text: '',
                    messageKind: 'voice',
                    audioBase64: base64,
                    mimeType: mime || 'audio/webm',
                    durationMs
                };
                if (isDirectMessengerChat(activeChat)) payload.to = messengerActivePeerId;
                sendMessengerEvent(payload);
                composerDraftByPeerId.set(messengerActiveChatId || messengerActivePeerId, '');
                renderMainScreen();
            };
            r.readAsDataURL(blob);
        }

        function composerPrimaryAction() {
            const activeChat = resolveActiveMessengerChat();
            const blockedPeer = (messengerProfile.blacklist || []).includes(String(messengerActivePeerId || ''));
            if (messengerComposeBlocked || (isDirectMessengerChat(activeChat) && blockedPeer)) {
                showNotification('Мессенджер', messengerComposeHint || 'Отправка недоступна', 'warning');
                return;
            }
            const input = document.getElementById('chatComposerInput');
            const hasText = !!String(input?.value || '').trim();
            if (hasText) {
                sendMessageFromComposer();
                return;
            }
            if (voiceRecordPreview) {
                sendVoiceFromPreview();
                return;
            }
            if (voiceRecordingActive) {
                stopVoiceRecordingCapture();
                return;
            }
            startVoiceRecording();
        }

        function openImageLightbox(dataUrl) {
            if (!dataUrl) return;
            const lb = document.createElement('div');
            lb.className = 'glass-media-lightbox';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'lb-close';
            close.setAttribute('aria-label', 'Закрыть');
            close.innerHTML = '<i class="fas fa-times"></i>';
            const img = document.createElement('img');
            img.alt = '';
            img.src = dataUrl;
            img.draggable = false;
            img.oncontextmenu = (e) => {
                try { e.preventDefault(); } catch (_) {}
                return false;
            };
            lb.appendChild(close);
            lb.appendChild(img);
            lb.addEventListener('click', (e) => {
                if (e.target === lb || e.target.closest('.lb-close')) lb.remove();
            });
            document.body.appendChild(lb);
        }

        function openImageLightboxFromImg(imgEl) {
            const src = imgEl && imgEl.src ? imgEl.src : '';
            if (!src) return;
            openImageLightbox(src);
        }

        function openVideoLightboxFromMsg(chatId, msgId) {
            const cid = String(chatId || '');
            const mid = String(msgId || '');
            if (!cid || !mid) return;
            const list = messengerMessages.get(cid) || [];
            const msg = list.find((m) => m && String(m.id || '') === mid);
            if (!msg || (!msg.videoBase64 && !msg.fileUrl)) return;
            const mimeRaw = String(msg.videoMime || '');
            const mime = /^video\/(webm|mp4|quicktime|ogg)$/i.test(mimeRaw) ? mimeRaw : 'video/mp4';
            let src = msg.fileUrl || '';
            if (!src) {
                const b64 = String(msg.videoBase64 || '').replace(/[^a-zA-Z0-9+/=]/g, '');
                src = `data:${mime};base64,${b64}`;
            }
            openVideoLightbox(src);
        }

        function openVideoLightbox(src) {
            if (!src) return;
            // Удаляем предыдущий открытый видеобокс.
            try {
                document.querySelectorAll('.glass-media-lightbox.glass-video-lightbox').forEach((x) => x.remove());
            } catch (_) {}
            const lb = document.createElement('div');
            lb.className = 'glass-media-lightbox glass-video-lightbox';

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'lb-close';
            close.setAttribute('aria-label', 'Закрыть');
            close.innerHTML = '<i class="fas fa-times"></i>';

            const video = document.createElement('video');
            video.playsInline = true;
            video.preload = 'metadata';
            video.src = src;
            video.controls = false;
            video.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
            video.disablePictureInPicture = true;
            video.oncontextmenu = (e) => {
                try { e.preventDefault(); } catch (_) {}
                return false;
            };

            const controls = document.createElement('div');
            controls.className = 'video-lightbox-controls';

            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'video-lightbox-playbtn';
            playBtn.innerHTML = '<i class="fas fa-play"></i>';

            const progress = document.createElement('div');
            progress.className = 'video-lightbox-progress';
            const fill = document.createElement('div');
            fill.className = 'video-lightbox-progress-fill';
            progress.appendChild(fill);

            const timeEl = document.createElement('div');
            timeEl.className = 'video-lightbox-time';
            timeEl.textContent = '0:00 / 0:00';

            controls.appendChild(playBtn);
            controls.appendChild(progress);
            controls.appendChild(timeEl);

            lb.appendChild(close);
            lb.appendChild(video);
            lb.appendChild(controls);

            const setPlayIcon = (playing) => {
                const icon = playBtn.querySelector('i');
                if (!icon) return;
                icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
            };

            const renderProgress = () => {
                const dur = video.duration;
                const cur = video.currentTime;
                if (!Number.isFinite(dur) || !dur || Number.isNaN(dur)) return;
                const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
                fill.style.width = `${pct}%`;
                const curStr = formatVoiceDurationMs(Math.max(0, cur * 1000));
                const durStr = formatVoiceDurationMs(Math.max(0, dur * 1000));
                timeEl.textContent = `${curStr} / ${durStr}`;
            };

            close.addEventListener('click', (e) => {
                e.preventDefault();
                try { video.pause(); } catch (_) {}
                lb.remove();
            });

            lb.addEventListener('click', (e) => {
                if (e.target === lb) {
                    try { video.pause(); } catch (_) {}
                    lb.remove();
                }
            });

            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (video.paused) {
                    video.play().catch(() => {});
                } else {
                    video.pause();
                }
            });

            video.addEventListener('play', () => setPlayIcon(true));
            video.addEventListener('pause', () => setPlayIcon(false));
            video.addEventListener('timeupdate', () => renderProgress());
            video.addEventListener('loadedmetadata', () => {
                renderProgress();
            });

            progress.addEventListener('click', (e) => {
                const rect = progress.getBoundingClientRect();
                const pct = rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
                if (video.duration) {
                    video.currentTime = pct * video.duration;
                }
            });

            document.body.appendChild(lb);
            // Стартуем после открытия.
            video.play().then(() => setPlayIcon(true)).catch(() => setPlayIcon(false));
        }

        function seychVideoToggle(btn) {
            const wrap = btn && btn.closest ? btn.closest('.glass-video-wrap') : null;
            const v = wrap && wrap.querySelector ? wrap.querySelector('video') : null;
            if (!v) return;
            const icon = btn.querySelector('i');
            if (v.paused) {
                v.play().catch(() => {});
                if (icon) icon.className = 'fas fa-pause';
            } else {
                v.pause();
                if (icon) icon.className = 'fas fa-play';
            }
        }

        async function onChatMediaSelected(event) {
            const input = event?.target;
            const files = input?.files;
            const activeChat = resolveActiveMessengerChat();
            if (!files?.length || !activeChat || messengerComposeBlocked) return;
            const blockedPeer = (messengerProfile.blacklist || []).includes(String(messengerActivePeerId || ''));
            if (isDirectMessengerChat(activeChat) && blockedPeer) {
                showNotification('Мессенджер', 'Отправка недоступна', 'warning');
                input.value = '';
                return;
            }
            // При отправке своего вложения — прокручиваем вниз.
            messengerNewWhileScrolledCount = 0;
            updateMessengerNewWhileScrolledFabUI();
            messengerShouldAutoScroll = true;

            const file = files[0];
            const maxBytes = 50 * 1024 * 1024; // 50 МБ
            if (file.size > maxBytes) {
                showNotification('Файл', `Файл слишком большой (макс. 50 МБ)`, 'warning');
                input.value = '';
                return;
            }

            const isVid = /^video\//i.test(file.type || '');
            const isImg = /^image\//i.test(file.type || '');
            const isAud = /^audio\//i.test(file.type || '');
            if (!isVid && !isImg && !isAud) {
                showNotification('Файл', 'Выберите фото, видео или музыку', 'warning');
                input.value = '';
                return;
            }

            const clientMessageId = makeClientMessageId();
            const chatId = messengerActiveChatId;
            const meId = authProfile?.appUserId || '';
            const replyTo = composerReplyMessage?.id || '';
            if (!chatId || !meId) {
                input.value = '';
                composerReplyMessage = null;
                return;
            }

            // Пендящая карточка (как в Telegram): пока идёт чтение/отправка — показываем прогресс.
            const messageKind = isVid ? 'video' : isImg ? 'image' : 'voice';
            const pending = {
                id: clientMessageId,
                chatId,
                fromId: meId,
                toId: isGroupMessengerChat(activeChat) ? chatId : messengerActivePeerId,
                text: '',
                messageKind,
                createdAt: Date.now(),
                editedAt: 0,
                deletedAt: 0,
                replyTo,
                forwardedFromMessageId: '',
                uploading: true,
                uploadProgress: 0,
                audioBase64: '',
                audioMime: '',
                imageBase64: '',
                mimeType: '',
                videoBase64: '',
                videoMime: ''
            };
            if (isVid) {
                pending.videoMime = (file.type || 'video/mp4').slice(0, 80);
            } else if (isImg) {
                pending.mimeType = file.type || 'image/jpeg';
            } else if (isAud) {
                pending.audioMime = file.type || 'audio/webm';
            }
            upsertMessengerMessage(chatId, pending);
            if (shouldRenderMessengerUi()) requestAnimationFrame(() => renderMainScreen());

            let lastUiUpdate = 0;
            let b64 = '';
            await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onprogress = (e) => {
                    if (!e || !e.lengthComputable) return;
                    const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
                    pending.uploadProgress = pct;
                    upsertMessengerMessage(chatId, pending);
                    const now = Date.now();
                    if (now - lastUiUpdate > 250) {
                        lastUiUpdate = now;
                        if (shouldRenderMessengerUi()) renderMainScreen();
                    }
                };
                r.onloadend = () => {
                    const raw = String(r.result || '');
                    b64 = raw.includes(',') ? raw.split(',')[1] : '';
                    resolve();
                };
                r.onerror = () => reject(new Error('file_reader_failed'));
                r.readAsDataURL(file);
            }).catch((err) => {
                showNotification('Файл', 'Не удалось прочитать файл', 'error');
                // Пендя останется, но без медиа.
            });

            if (!b64) {
                input.value = '';
                composerReplyMessage = null;
                return;
            }

            // Обновляем пендящую карточку так, чтобы сразу был виден плеер/картинка.
            pending.uploadProgress = 100;
            if (isVid) pending.videoBase64 = b64;
            else if (isImg) pending.imageBase64 = b64;
            else pending.audioBase64 = b64;
            upsertMessengerMessage(chatId, pending);
            if (shouldRenderMessengerUi()) requestAnimationFrame(() => renderMainScreen());

            const payload = {
                type: 'messenger-send',
                clientMessageId,
                chatId: activeChat.id,
                text: isAud ? String(file.name || 'Музыка').slice(0, 120) : '',
                messageKind,
                replyTo
            };
            if (isDirectMessengerChat(activeChat)) payload.to = messengerActivePeerId;
            if (isVid) {
                payload.videoBase64 = b64;
                payload.videoMime = pending.videoMime;
            } else if (isImg) {
                payload.imageBase64 = b64;
                payload.mimeType = pending.mimeType;
            } else if (isAud) {
                payload.audioBase64 = b64;
                payload.mimeType = pending.audioMime || file.type || 'audio/webm';
            }
            sendMessengerEvent(payload);
            input.value = '';
            composerReplyMessage = null;
        }

        // Story state
        let stories = new Map(); // userId -> stories array
        let currentStoryIndex = 0;
        let currentStories = [];
        let storyVideo = null;
        let storyProgressRaf = 0;
        let storyViewed = new Set(); // storyId -> boolean
        let storyPointerState = null;

        // Story functions
