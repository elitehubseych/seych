        document.addEventListener('keydown', function(event) {
            const viewer = document.getElementById('storyViewer');
            if (!viewer.classList.contains('active')) return;
            
            switch(event.key) {
                case 'ArrowLeft':
                    prevStory();
                    break;
                case 'ArrowRight':
                    nextStory();
                    break;
                case 'Escape':
                    closeStoryViewer();
                    break;
            }
        });

        function formatStoryTime(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            
            if (diffMins < 1) return 'Только что';
            if (diffMins < 60) return `${diffMins} мин назад`;
            if (diffHours < 24) return `${diffHours} ч назад`;
            return `${Math.floor(diffHours / 24)} д назад`;
        }

        function getUserInfo(userId) {
            const friends = Array.isArray(friendsState.friends) ? friendsState.friends : [];
            const friend = friends.find(f => f.id === userId);
            
            if (friend) {
                return {
                    displayName: friend.displayName || friend.name || friend.id,
                    name: friend.name || friend.id,
                    avatar: friend.avatar || '',
                    initials: friend.initials || ''
                };
            }
            
            // Fallback to own profile
            if (userId === authProfile?.appUserId) {
                return {
                    displayName: authProfile.name || authProfile.appUserId || '',
                    name: authProfile.appUserId || '',
                    avatar: authProfile.avatar || '',
                    initials: ''
                };
            }
            
            return {
                displayName: userId,
                name: userId,
                avatar: '',
                initials: ''
            };
        }

        function renderMessengerWorkspace() {
            let activeChat = resolveActiveMessengerChat();
            // Дополнительная защита: если нет activeChat, но есть messengerActiveChatId и messengerActivePeerId,
            // то это может быть прямой чат, который еще не загружен в messengerChats
            if (!activeChat && messengerActivePeerId && messengerActiveChatId) {
                const peer = resolvePeerDisplay(messengerActivePeerId);
                activeChat = { id: messengerActiveChatId, peer, lastMessage: null };
            }
            if (!activeChat || (!isGroupMessengerChat(activeChat) && !messengerActivePeerId)) {
                return `
                    <div class="workspace-empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">
                        <div style="opacity:.9;font-size:20px;font-weight:700;">Чат не выбран</div>
                        <div style="opacity:.72;">Напишите или позвоните пользователю</div>
                        <div class="workspace-empty-cards">
                            <div class="workspace-empty-card" onclick="setMessengerView('calls')"><i class="fas fa-phone"></i><div>Позвонить</div></div>
                            <div class="workspace-empty-card" onclick="setMessengerView('friends')"><i class="fas fa-comment-dots"></i><div>Написать</div></div>
                        </div>
                    </div>
                `;
            }
            const activeChatIdResolved = String(messengerActiveChatId || activeChat?.id || '').trim();
            const activeChatTitle = String(activeChat.peer?.displayName || activeChat.peer?.name || activeChat.group?.title || activeChat.id || '—').trim() || '—';
            const messages = resolveChatMessages(activeChatIdResolved).filter((m) => !m.deletedAt);
            const peerTypingState = getMessengerPeerActivityState(messengerActivePeerId);
            const statusText = formatPeerStatusLine(activeChat.peer, peerTypingState);
            const blockedPeer = (messengerProfile.blacklist || []).includes(String(messengerActivePeerId || ''));
            const groupRestriction = isGroupMessengerChat(activeChat) ? activeChat.group?.restriction || null : null;
            const groupBanned = !!groupRestriction && groupRestriction.type === 'banned';
            const composerLocked = messengerComposeBlocked || blockedPeer || groupBanned;
            const composerPlaceholder = composerLocked
                ? (blockedPeer ? 'Вы не можете отправить сообщение этому пользователю' : (messengerComposeHint || getGroupRestrictionHintClient(groupRestriction) || 'Вы не можете отправить сообщение этому пользователю'))
                : 'Сообщение…';
            const myId = String(authProfile?.appUserId || '');
            const peerId = String(messengerActivePeerId || '');
            const dayKeyOf = (ts) => {
                const d = new Date(Number(ts || Date.now()));
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
            };
            const formatDayLabel = (ts) => {
                const d = new Date(Number(ts || Date.now()));
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
                const diffDays = Math.round((startOfToday - startOfThat) / 86400000);
                if (diffDays === 0) return 'Сегодня';
                if (diffDays === 1) return 'Вчера';
                const month = d.toLocaleString('ru-RU', { month: 'long' });
                const day = d.getDate();
                const year = d.getFullYear();
                const curYear = now.getFullYear();
                return year === curYear ? `${day} ${month}` : `${day} ${month} ${year}`;
            };
            const reactionOrder = ['❤️', '👍', '👎', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '😍', '🤔', '🙏', '💯', '😎'];
            const renderReactions = (msg) => {
                const r = msg && msg.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
                const entries = Object.entries(r)
                    .map(([emoji, users]) => [String(emoji || ''), Array.isArray(users) ? users : []])
                    .filter(([emoji, users]) => emoji && users.length > 0);
                if (!entries.length) return '';
                entries.sort((a, b) => reactionOrder.indexOf(a[0]) - reactionOrder.indexOf(b[0]));
                const html = entries
                    .map(([emoji, users]) => {
                        const list = Array.from(new Set(users.map((u) => String(u)).filter(Boolean)));
                        const active = list.includes(myId);
                        const shown = list.slice(0, 3);
                        const avatars = shown
                            .map((uid) => {
                                const peer = resolvePeerDisplay(uid);
                                const title = String(peer?.displayName || peer?.name || uid || '').trim() || uid;
                                const avatar = String(peer?.avatar || '').trim();
                                const initials = String(peer?.initials || '').trim() || title.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase();
                                const inner = avatar
                                    ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" draggable="false" oncontextmenu="return false" style="width:100%;height:100%;object-fit:cover;">`
                                    : `<div class="messenger-avatar-fallback" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;">${escapeHtml(initials || '·')}</div>`;
                                return `<div class="chat-msg-reaction-user" title="${escapeHtml(title)}">${inner}</div>`;
                            })
                            .join('');
                        const more = list.length > 3 ? `<span class="chat-msg-reaction-more">+${list.length - 3}</span>` : '';
                        const usersHtml = `<span class="chat-msg-reaction-users">${avatars}</span>${more}`;
                        return `<div class="chat-msg-reaction ${active ? 'active' : ''}" onclick="toggleMessageReaction('${escapeHtml(msg.id || '')}','${escapeHtml(emoji)}')"><span>${escapeHtml(emoji)}</span>${usersHtml}</div>`;
                    })
                    .join('');
                return html ? `<div class="chat-msg-reactions">${html}</div>` : '';
            };
            const rows = messages.length
                ? (() => {
                    const parts = [];
                    let lastDay = '';
                    for (const msg of messages) {
                        const dk = dayKeyOf(msg.createdAt);
                        if (dk !== lastDay) {
                            lastDay = dk;
                            parts.push(`<div class="chat-day-sep">${escapeHtml(formatDayLabel(msg.createdAt))}</div>`);
                        }
                    const mine = String(msg.fromId || '') === String(authProfile?.appUserId || '');
                    const msgIdSafe = messengerSafeId(msg.id);
                    const isVoice = msg.messageKind === 'voice';
                    const isMusic = isVoice && !!String(msg.text || '') && String(msg.text || '') !== 'Голосовое сообщение';
                    const isImage = msg.messageKind === 'image';
                    const isVideo = msg.messageKind === 'video';
                    const isCurrentMusic = musicPlayer.playing
                        && String(musicPlayer.chatId || '') === String(activeChat.id || '')
                        && String(musicPlayer.msgId || '') === String(msg.id || '');
                    let body;
                    if (isVoice) {
                        if (!msg.audioBase64 && !msg.fileUrl) {
                            body = `<div class="chat-msg-pending">${isMusic ? 'Музыка загружается…' : 'Голосовое загружается…'}</div>`;
                        } else if (isMusic) {
                            const iconClass = isCurrentMusic ? 'fas fa-pause' : 'fas fa-play';
                            const safeMsgId = String(msg.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
                            const pct = (() => {
                                try {
                                    const a = musicPlayer.audioEl;
                                    if (!a || !a.duration) return 0;
                                    return Math.max(0, Math.min(100, (a.currentTime / a.duration) * 100));
                                } catch (_) {
                                    return 0;
                                }
                            })();
                            body = `<div class="glass-music-inline">
                                <button type="button" class="music-inline-play-btn" onclick="toggleMusicFromMessage(this)" data-chat-id="${escapeHtml(activeChat.id)}" data-msg-id="${escapeHtml(msg.id || '')}" aria-label="Музыка">
                                    <i class="${iconClass}"></i>
                                </button>
                                <div style="flex:1;min-width:0;">
                                    <div class="music-inline-title">${escapeHtml(msg.text || 'Музыка')}</div>
                                    <div class="music-inline-progress" aria-hidden="true"><div class="music-inline-progress-fill" id="musicInlineProgressFill-${safeMsgId}" style="width:${isCurrentMusic ? pct : 0}%;"></div></div>
                                </div>
                                <button type="button" class="music-inline-stop-btn" onclick="stopMusicPlayer(true)" style="display:${isCurrentMusic ? 'inline-flex' : 'none'};" aria-label="Стоп">
                                    <i class="fas fa-stop"></i>
                                </button>
                            </div>`;
                        } else {
                            if (!msg.audioBase64 && !msg.fileUrl) {
                                body = `<div class="chat-msg-pending">Голосовое загружается…</div>`;
                            } else {
                                const waveHeights = voiceWaveBarsFromSeed(msg.id || msg.createdAt, 22);
                                const waveHtml = waveHeights.map((ht) => `<span style="height:${ht}px"></span>`).join('');
                                const durLabel = formatVoiceDurationMs(Number(msg.durationMs) || 0);
                                const iconClass = isCurrentMusic ? 'fas fa-pause' : 'fas fa-play';
                                body = `<div class="glass-voice-player">
                                    <button type="button" class="voice-play-btn" onclick="toggleMusicFromMessage(this)" data-chat-id="${escapeHtml(activeChat.id)}" data-msg-id="${escapeHtml(msg.id || '')}" aria-label="Голосовое">
                                        <i class="${iconClass}"></i>
                                    </button>
                                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
                                        <div class="voice-wave">${waveHtml}</div>
                                        <div class="voice-progress"><div class="voice-progress-fill"></div></div>
                                    </div>
                                    <div class="voice-meta"><span class="voice-dur">${durLabel}</span></div>
                                </div>`;
                            }
                        }
                    } else if (isImage) {
                        if (!msg.imageBase64 && !msg.fileUrl) {
                            body = `<div class="chat-msg-pending">Фото загружается…</div>`;
                        } else {
                            const mime = /^image\/(jpeg|png|gif|webp)$/i.test(String(msg.mimeType || '')) ? msg.mimeType : 'image/jpeg';
                            const b64 = String(msg.imageBase64 || '').replace(/[^a-zA-Z0-9+/=]/g, '');
                            const url = msg.fileUrl || `data:${mime};base64,${b64}`;
                            body = `${msg.text ? `<div style="margin-bottom:6px;">${linkifyMessengerText(msg.text || '', { includePreview: true })}</div>` : ''}<img class="chat-msg-thumb" src="${escapeHtml(url)}" alt="" draggable="false" oncontextmenu="return false" onclick="openImageLightboxFromImg(this)">`;
                        }
                    } else if (isVideo) {
                        if (!msg.videoBase64 && !msg.fileUrl) {
                            body = `<div class="chat-msg-pending">Видео загружается…</div>`;
                        } else {
                            const chatIdEsc = escapeHtml(activeChat.id || '');
                            const msgIdEsc = escapeHtml(msg.id || '');
                            body = `${msg.text ? `<div style="margin-bottom:6px;">${linkifyMessengerText(msg.text || '', { includePreview: true })}</div>` : ''}<div class="glass-video-thumb" role="button" tabindex="0" onclick="openVideoLightboxFromMsg('${chatIdEsc}','${msgIdEsc}')">
                                <div class="video-thumb-overlay"><i class="fas fa-play"></i></div>
                            </div>`;
                        }
                    } else {
                        body = linkifyMessengerText(msg.text || '', { includePreview: true });
                    }
                    const ts = new Date(Number(msg.createdAt || Date.now())).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    let reply = '';
                    if (msg.replyTo) {
                        const rq = messages.find((x) => x && x.id === msg.replyTo);
                        if (rq && !rq.deletedAt) {
                            const rName = String(rq.senderDisplayName || rq.fromId || 'Пользователь');
                            const rAvatar = String(rq.senderAvatar || '');
                            const rInitials = String(rq.senderInitials || '');
                            reply = `<div role="button" tabindex="0" onclick="scrollAndHighlightMessengerMessage('${escapeHtml(msg.replyTo || '')}')" style="cursor:pointer;font-size:12px;opacity:.98;margin-bottom:6px;border-left:2px solid rgba(255,255,255,.42);padding-left:8px;">
                                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                                    <div style="width:22px;height:22px;flex-shrink:0;opacity:.98;overflow:hidden;">${avatarMarkup(rName, rAvatar, rInitials)}</div>
                                    <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(rName)}</div>
                                </div>
                                <div style="margin-top:3px;opacity:.82;white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
                                    ${linkifyMessengerText(rq.text || '')}
                                </div>
                            </div>`;
                        } else {
                            reply = `<div style="font-size:12px;opacity:.72;margin-bottom:6px;border-left:2px solid rgba(255,255,255,.35);padding-left:8px;">Ответ на сообщение</div>`;
                        }
                    }
                    let forwardedBlock = '';
                    let finalBody = body;
                    const fp = msg && msg.forwardedPreview && typeof msg.forwardedPreview === 'object' ? msg.forwardedPreview : null;
                    if (fp && (fp.fromUserId || fp.displayName || fp.text)) {
                        const fName = String(fp.displayName || fp.fromUserId || 'Пользователь');
                        const fAvatar = String(fp.avatar || '');
                        const fIni = String(fp.initials || '');
                        const fText = String(fp.text || '');
                        forwardedBlock = `<div style="font-size:12px;opacity:.98;margin-bottom:6px;border-left:2px solid rgba(255,255,255,.42);padding-left:8px;">
                            <div style="font-size:11px;opacity:.78;font-weight:900;margin-bottom:3px;">Переслано</div>
                            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                                <div style="width:22px;height:22px;flex-shrink:0;opacity:.98;overflow:hidden;">${avatarMarkup(fName, fAvatar, fIni)}</div>
                                <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fName)}</div>
                            </div>
                            ${fText ? `<div style="margin-top:3px;opacity:.82;white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${linkifyMessengerText(fText)}</div>` : ''}
                        </div>`;
                    } else if (/^Переслано:/i.test(String(msg.text || ''))) {
                        const raw = String(msg.text || '');
                        const lines = raw.split('\n');
                        const first = lines.shift() || '';
                        const fName = first.replace(/^Переслано:\s*/i, '').trim();
                        const fText = lines.join('\n').trim();
                        forwardedBlock = `<div style="font-size:12px;opacity:.98;margin-bottom:6px;border-left:2px solid rgba(255,255,255,.42);padding-left:8px;">
                            <div style="font-size:11px;opacity:.78;font-weight:900;margin-bottom:3px;">Переслано</div>
                            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                                <div style="width:22px;height:22px;flex-shrink:0;opacity:.98;overflow:hidden;">${avatarMarkup(fName, '', '')}</div>
                                <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fName || 'Пользователь')}</div>
                            </div>
                            <div style="margin-top:3px;opacity:.82;white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
                                ${linkifyMessengerText(fText)}
                            </div>
                        </div>`;
                        finalBody = '';
                    }
                    if (String(msg.messageKind || '') === 'system') {
                        parts.push(`<div class="chat-system-msg">${linkifyMessengerText(String(msg.text || ''))}</div>`);
                        continue;
                    }
                    const groupEvent = parseGroupEventPayload(msg.text || '');
                    if (groupEvent) {
                        parts.push(renderGroupEventBlock(groupEvent));
                        continue;
                    }
                    const uploadPct = msg.uploading ? Math.max(0, Math.min(100, Math.round(Number(msg.uploadProgress || 0)))) : 0;
                    const uploadTag = msg.uploading
                        ? `<div class="chat-upload-tag"><i class="fas fa-circle-notch fa-spin"></i>${uploadPct ? ` ${uploadPct}%` : ''}</div>`
                        : '';
                    const readBy = Array.isArray(msg.readBy) ? msg.readBy.map((x) => String(x)) : [];
                    const isRead = !!msg.read || (mine && peerId && readBy.includes(peerId));
                    const checksHtml = mine
                        ? `<span class="chat-msg-checks ${isRead ? 'read' : ''}"><i class="fas fa-check"></i>${isRead ? '<i class="fas fa-check"></i>' : ''}</span>`
                        : '';
                    const reactionsHtml = renderReactions(msg);
                    const canCtx = !msg.uploading;
                    const dbl = canCtx ? ` ondblclick="quickReactToMessage(event,'${escapeHtml(msg.id || '')}','❤️')"` : '';
                    const evt = canCtx
                        ? `oncontextmenu="openMessageMenu(event,'${escapeHtml(msg.id || '')}',${mine ? 'true' : 'false'})" ontouchstart="startMessageHold(event,'${escapeHtml(msg.id || '')}',${mine ? 'true' : 'false'}); startMessageSwipeStart(event)" ontouchend="handleMessageSwipeEnd(event,'${escapeHtml(msg.id || '')}')" ontouchcancel="cancelMessageHold()"`
                        : '';
                    const senderId = String(msg.fromId || '').trim();
                    const senderName = String(msg.senderDisplayName || msg.fromId || 'Пользователь');
                    const senderAvatar = String(msg.senderAvatar || '');
                    const senderInitials = String(msg.senderInitials || '');
                    const senderLine = !mine && isGroupMessengerChat(activeChat)
                        ? `<div class="chat-sender-line"><span class="chat-sender-name" ${senderId ? `onclick="openUserProfile('${escapeHtml(senderId)}')"` : ''}>${escapeHtml(senderName)}</span></div>`
                        : '';
                    const hoverReplyBtn = !mine
                        ? `<button type="button" class="chat-msg-reply-hover-btn" title="Ответить" aria-label="Ответить" onclick="event.stopPropagation(); setReplyToMessage('${escapeHtml(msg.id || '')}')"><i class="fas fa-reply"></i></button>`
                        : '';
                    const msgHtml = `<div id="chatMsg-${escapeHtml(msgIdSafe)}" class="chat-msg ${mine ? 'out' : ''}" ${evt}${dbl}>${senderLine}${reply}${forwardedBlock}${finalBody}${uploadTag}${reactionsHtml}${hoverReplyBtn}<div class="chat-msg-meta"><span>${ts}${msg.editedAt ? ' • изм.' : ''}</span>${checksHtml}</div></div>`;
                    if (!mine && isGroupMessengerChat(activeChat)) {
                        parts.push(
                            `<div class="chat-msg-row"><div class="chat-msg-row-avatar" ${senderId ? `onclick="openUserProfile('${escapeHtml(senderId)}')"` : ''}>${avatarMarkup(senderName, senderAvatar, senderInitials)}</div><div class="chat-msg-row-body">${msgHtml}</div></div>`
                        );
                    } else {
                        parts.push(msgHtml);
                    }
                    }
                    return parts.join('');
                })()
                : `<div class="chat-empty-card"><i class="fas fa-comment-dots"></i><p id="emptyChatPhrase">${getInitialEmptyChatPhrase()}</p></div>`;
            const composerHint = composerEditMessageId
                ? `<div style="width:100%;margin:0;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);display:flex;justify-content:space-between;gap:8px;align-items:center;box-sizing:border-box;"><span>Редактирование сообщения</span><button type="button" class="contact-btn secondary" onclick="clearComposerReplyEdit()">Отмена</button></div>`
                : composerReplyMessage
                    ? `<div class="composer-reply-preview" style="width:100%;margin:0;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);display:flex;justify-content:space-between;gap:10px;align-items:flex-start;box-sizing:border-box;">
                        <div style="display:flex;gap:10px;align-items:flex-start;min-width:0;flex:1;">
                            <div style="width:34px;height:34px;flex-shrink:0;">${avatarMarkup(
                                String(composerReplyMessage.senderDisplayName || composerReplyMessage.fromId || 'Пользователь'),
                                String(composerReplyMessage.senderAvatar || ''),
                                String(composerReplyMessage.senderInitials || '')
                            )}</div>
                            <div style="min-width:0;display:flex;flex-direction:column;gap:3px;">
                                <div style="font-size:12px;opacity:.78;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                    Ответ: ${escapeHtml(String(composerReplyMessage.senderDisplayName || composerReplyMessage.fromId || 'Пользователь'))}
                                </div>
                                <div class="composer-reply-text" style="font-size:13px;opacity:.92;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                                    ${escapeHtml((composerReplyMessage.text || '').length > 30 ? (composerReplyMessage.text || '').substring(0, 30) + '...' : (composerReplyMessage.text || ''))}
                                </div>
                            </div>
                        </div>
                        <button type="button" class="contact-btn secondary" onclick="clearComposerReplyEdit()" style="flex-shrink:0;">Отмена</button>
                    </div>`
                    : '';
            const recBarsHtml = Array.from({ length: 14 }, (_, i) => `<span style="height:${10 + (i % 5) * 4}px"></span>`).join('');
            let composerRowInner = '';
            if (voiceRecordingActive) {
                composerRowInner = `
                            <div class="voice-rec-bar">
                                <div class="voice-rec-bars">${recBarsHtml}</div>
                                <span class="voice-rec-timer" id="voiceRecTimerUi">0:00</span>
                            </div>
                            <button type="button" id="chatComposerActionBtn" class="messenger-nav-btn" onclick="stopVoiceRecordingCapture()" title="Стоп"><i class="fas fa-stop"></i></button>`;
            } else if (voiceRecordPreview) {
                const prevDur = formatVoiceDurationMs(voiceRecordPreview.durationMs || 0);
                composerRowInner = `
                            <div class="voice-preview-bar">
                                <button type="button" class="messenger-nav-btn" onclick="toggleVoicePreviewPlay(this)" title="Прослушать"><i class="fas fa-play"></i></button>
                                <span style="font-size:13px;font-variant-numeric:tabular-nums;opacity:.88;">${prevDur}</span>
                                <span style="flex:1"></span>
                                <button type="button" class="messenger-nav-btn" onclick="discardVoicePreview()" title="Удалить"><i class="fas fa-trash"></i></button>
                            </div>
                            <input type="file" id="chatMediaInput" accept="image/*,video/*,audio/*" style="display:none" onchange="onChatMediaSelected(event)">
                            <button type="button" class="messenger-nav-btn" disabled title="Фото или видео"><i class="fas fa-paperclip"></i></button>
                            <button type="button" id="chatComposerActionBtn" class="messenger-nav-btn" onclick="sendVoiceFromPreview()" title="Отправить"><i class="fas fa-paper-plane"></i></button>`;
            } else {
                composerRowInner = `
                            <textarea id="chatComposerInput" placeholder="${escapeHtml(composerPlaceholder)}" ${composerLocked ? 'disabled' : ''} oninput="onComposerInput()" onkeydown="onComposerKeydown(event)"></textarea>
                            <input type="file" id="chatMediaInput" accept="image/*,video/*,audio/*" style="display:none" onchange="onChatMediaSelected(event)">
                            <button type="button" class="messenger-nav-btn" title="Фото или видео" ${composerLocked ? 'disabled' : ''} onclick="document.getElementById('chatMediaInput')?.click()"><i class="fas fa-paperclip"></i></button>
                            <button type="button" id="chatComposerActionBtn" class="messenger-nav-btn" ${composerLocked ? 'disabled' : ''} onclick="composerPrimaryAction()"><i class="fas fa-microphone"></i></button>`;
            }
            const callBannerHtml = isGroupMessengerChat(activeChat) ? renderActiveGroupCallBanner(activeChat) : '';
            const callBannerBlock = `<div class="chat-call-banner" style="display:${callBannerHtml ? 'block' : 'none'};">${callBannerHtml}</div>`;
            const wallpaper = String(messengerAppearance?.chatWallpaper || '').trim();
            const wallpaperBlur = messengerAppearance?.chatWallpaperBlur !== false;
            return `
                <div class="chat-workspace">
                    <div class="chat-wallpaper-layer ${wallpaper && wallpaperBlur ? 'blur' : ''}" style="display:${wallpaper ? 'block' : 'none'};${wallpaper ? `background-image:url('${escapeHtml(wallpaper).replace(/'/g, '&#39;')}');` : ''}"></div>
                    <div class="chat-topbar">
                        <div style="display:flex;align-items:center;gap:10px;">
                            ${isMobileLayout() ? `<button type="button" class="messenger-nav-btn" onclick="closeMobileChatView()" aria-label="Назад"><i class="fas fa-arrow-left"></i></button>` : ''}
                            <div class="messenger-avatar" onclick="${isGroupMessengerChat(activeChat) ? `openGroupProfileModal('${escapeHtml(activeChat.id || '')}')` : `openUserProfile('${escapeHtml(activeChat.peer?.id || '')}')`}" style="cursor:pointer;">${avatarMarkup(activeChatTitle, activeChat.peer?.avatar || activeChat.group?.avatar || '', String(activeChat.peer?.initials || ''))}</div>
                            <div>
                                <div style="font-weight:700;">${escapeHtml(activeChatTitle)}</div>
                                <div id="chatTopbarStatus" style="font-size:12px;opacity:.8;">${escapeHtml(isGroupMessengerChat(activeChat) ? getGroupChatStatusText(activeChat) : statusText)}</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button type="button" class="messenger-nav-btn" ${isGroupMessengerChat(activeChat) ? '' : (composerLocked ? 'disabled' : '')} onclick="${isGroupMessengerChat(activeChat) ? `startGroupCallForChat('${escapeHtml(activeChat.id || '')}')` : `callFriend('${escapeHtml(activeChat.peer?.id || '')}')`}" title="${isGroupMessengerChat(activeChat) ? 'Групповой звонок' : 'Позвонить'}"><i class="fas fa-phone" style="${isGroupMessengerChat(activeChat) && activeChat.group?.activeCall?.roomId ? 'color:#5be37a;' : ''}"></i></button>
                            ${isGroupMessengerChat(activeChat) ? `<button type="button" class="messenger-nav-btn" onclick="openGroupProfileModal('${escapeHtml(activeChat.id || '')}')" title="Информация"><i class="fas fa-ellipsis-v"></i></button>` : `<button type="button" class="messenger-nav-btn" onclick="toggleBlockActivePeer()" title="${blockedPeer ? 'Разблокировать' : 'Заблокировать'}"><i class="fas ${blockedPeer ? 'fa-unlock' : 'fa-ban'}"></i></button>`}
                        </div>
                    </div>
                    ${callBannerBlock}
                    <div class="chat-history">${groupBanned ? renderGroupBlockedScreen(activeChat) : (rows || '')}</div>
                    ${groupBanned ? '' : `<div class="chat-fab-stack">
                        <div id="scrollToMentionFabWrap" class="scroll-to-bottom-fab-wrap" style="display:${messengerMentionWhileScrolledCount ? 'flex' : 'none'};">
                            <button type="button" class="scroll-to-bottom-fab" onclick="scrollMessengerHistoryToNextMention()" aria-label="Перейти к упоминанию">
                                <i class="fas fa-at"></i>
                                <span id="scrollToMentionFabBadge" class="scroll-to-bottom-fab-badge">${messengerMentionWhileScrolledCount > 99 ? '99+' : (messengerMentionWhileScrolledCount || 0)}</span>
                            </button>
                        </div>
                        <div id="scrollToBottomFabWrap" class="scroll-to-bottom-fab-wrap" style="display:none;">
                            <button type="button" class="scroll-to-bottom-fab" onclick="scrollMessengerHistoryToBottom()" aria-label="Перейти вниз">
                                <i class="fas fa-arrow-down"></i>
                                <span id="scrollToBottomFabBadge" class="scroll-to-bottom-fab-badge">${messengerNewWhileScrolledCount > 99 ? '99+' : (messengerNewWhileScrolledCount || 0)}</span>
                            </button>
                        </div>
                    </div><div class="chat-input-wrap">
                        ${composerHint}
                        <div id="composerMentionMenuHost" class="composer-mention-host"></div>
                        <div class="chat-composer-row">
                            ${composerRowInner}
                        </div>
                    </div>`}
                </div>
            `;
        }

        function buildProfileViewContent() {
            const own = !messengerViewedProfile;
            if (own) {
                const storiesHtml = buildProfileStoriesSection({
                    userId: authProfile?.appUserId || '',
                    title: 'Мои истории',
                    own: true
                });
                const ownUsername = ensureGeneratedMessengerUsername(messengerProfile.username || authProfile.vkUsername || '', authProfile?.appUserId || appUserId);
                return `<div class="workspace-scroll"><div class="profile-card" style="max-width:580px;width:100%;margin:6px 0;">
                    ${renderProfileHeroCard({
                        userId: authProfile?.appUserId || '',
                        displayName: authProfile.name || authProfile.appUserId || '',
                        avatar: authProfile.avatar || '',
                        coverUrl: authProfile.coverUrl || '',
                        initials: authProfile.initials || '',
                        username: ownUsername,
                        subtitle: messengerProfile.statusText || 'Без статуса',
                        clickableAvatar: true
                    })}
                    <div style="display:grid;gap:10px;margin-top:12px;">
                        <div class="contact-item" style="justify-content:space-between;gap:12px;">
                            <div><div class="contact-chat">Username</div><div class="contact-name">@${escapeHtml(ownUsername)}</div></div>
                            <button type="button" class="contact-btn" onclick="copyTextToClipboard('@${escapeHtml(ownUsername)}','Username скопирован')" title="Скопировать username" style="padding:4px 8px;min-width:auto;"><i class="fas fa-copy"></i></button>
                        </div>
                        <div class="contact-item" style="justify-content:space-between;gap:12px;">
                        <div><div class="contact-chat">О себе</div><div class="contact-name">${escapeHtml(messengerProfile.statusText || 'Не указано')}</div></div>
                        </div>
                        <div class="contact-item" style="justify-content:space-between;gap:12px;">
                            <div><div class="contact-chat">ID</div><div class="contact-name">${escapeHtml(authProfile.appUserId || '')}</div></div>
                            <button type="button" class="contact-btn" onclick="copyAppUserId()" title="Скопировать ID" style="padding:4px 8px;min-width:auto;"><i class="fas fa-copy"></i></button>
                        </div>
                    </div>
                    <div class="profile-actions"><button type="button" class="contact-btn" onclick="openProfileEditModal()" title="Редактировать"><i class="fas fa-pen"></i></button><button type="button" class="contact-btn" onclick="setMessengerView('settings')" title="Настройки"><i class="fas fa-sliders-h"></i></button></div>
                    ${storiesHtml}
                </div></div>`;
            }
            const view = messengerViewedProfile || {};
            const profile = view.profile || {};
            if (!view.ok && view.reason === 'private') {
                return `<div class="workspace-scroll"><div class="profile-card" style="max-width:560px;margin:6px 0;"><div class="profile-avatar"><i class="fas fa-gavel"></i></div><div class="profile-name">Профиль закрыт</div><div class="messenger-connection">Доступ к анкете ограничен настройками приватности.</div></div></div>`;
            }
            if (!view.ok && view.reason === 'blocked') {
                return `<div class="workspace-scroll"><div class="profile-card" style="max-width:560px;margin:6px 0;"><div class="profile-avatar">${profile.avatar ? `<img src="${escapeHtml(profile.avatar)}" alt="" referrerpolicy="no-referrer">` : `<i class="fas fa-ban"></i>`}</div><div class="profile-name">${escapeHtml(profile.name || profile.id || '')}</div><div class="messenger-connection">Этот аккаунт ограничил с вами общение.</div><div class="messenger-connection" style="opacity:.85;">${escapeHtml(profile.statusText || '')}</div></div></div>`;
            }
            const pid = String(profile.id || view.targetUserId || '').trim();
            const isSelf = !!pid && String(authProfile?.appUserId || '') === pid;
            const isFriend = !isSelf && (friendsState.friends || []).some((f) => String(f.id) === pid);
            const dispName = profile.displayName || profile.name || pid || '';
            const avLetter = profile.initials || (dispName.trim().split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase() || pid.slice(0, 2).toUpperCase());
            const effectiveUsername = ensureGeneratedMessengerUsername(profile.username || '', pid);
            const unameLine = `@${escapeHtml(effectiveUsername)}`;
            const addBtn = !isSelf && !isFriend ? `<button class="contact-btn" title="Добавить" onclick="sendFriendRequest('${escapeHtml(pid)}')"><i class="fas fa-user-plus"></i></button>` : '';
            const canAddToChats = !isSelf && canCurrentUserAddProfileToChats(view, isFriend);
            const addToGroupBtn = canAddToChats ? `<button class="contact-btn" title="Добавить в чат" onclick="openAddUserToGroupModal('${escapeHtml(pid)}')"><i class="fas fa-comments"></i></button>` : '';
            const msgBtn = !isSelf ? `<button class="contact-btn" title="Написать" onclick="openMessengerChat('${escapeHtml(pid)}')"><i class="fas fa-paper-plane"></i></button>` : '';
            const callBtn = !isSelf ? `<button class="contact-btn" title="Позвонить" onclick="callFriend('${escapeHtml(pid)}')"><i class="fas fa-phone"></i></button>` : '';
            const storiesHtml = buildProfileStoriesSection({
                userId: pid,
                title: 'Публикации',
                own: false
            });
            return `<div class="workspace-scroll"><div class="profile-card" style="max-width:580px;width:100%;margin:6px 0;">
                ${renderProfileHeroCard({
                    userId: pid,
                    displayName: dispName,
                    avatar: profile.avatar || '',
                    coverUrl: profile.coverUrl || '',
                    initials: avLetter,
                    username: effectiveUsername,
                    subtitle: profile.statusText || '',
                    clickableAvatar: true
                })}
                <div style="display:grid;gap:10px;margin-top:12px;">
                    <div class="contact-item" style="justify-content:flex-start;"><div><div class="contact-chat">О себе</div><div class="contact-name">${escapeHtml(profile.statusText || 'Не указано')}</div></div></div>
                    <div class="contact-item" style="justify-content:space-between;gap:12px;">
                        <div><div class="contact-chat">Username</div><div class="contact-name">${unameLine}</div></div>
                        <button type="button" class="contact-btn" onclick="copyTextToClipboard('@${escapeHtml(effectiveUsername)}','Username скопирован')" title="Скопировать username" style="padding:4px 8px;min-width:auto;"><i class="fas fa-copy"></i></button>
                    </div>
                </div>
                <div class="profile-actions">${addBtn}${addToGroupBtn}${msgBtn}${callBtn}</div>
                ${storiesHtml}
            </div></div>`;
        }

        function buildMessengerViewContent(view) {
            if (view === 'friends') {
                return `<div class="workspace-scroll" style="align-items:stretch;"><div class="friends-search-wrap"><input id="friendsSearchInput" class="modal-input" placeholder="Поиск по ID, имени или username" autocomplete="off" value="${escapeHtml(friendsSearchValue)}" oninput="onFriendsSearchInput(event)"></div>${renderFriendsTabContent()}</div>`;
            }
            if (view === 'notifications') {
                return renderNotificationsWorkspace();
            }
            if (view === 'settings') {
                return `<div class="workspace-scroll" style="align-items:stretch;padding:6px 0;">
                    <div style="font-size:20px;font-weight:700;padding:0 4px 8px;">Настройки</div>
                    <button type="button" class="blacklist-open-btn" onclick="openPrivacySettingsModal()"><i class="fas fa-user-shield"></i> Приватность</button>
                    <button type="button" class="blacklist-open-btn" onclick="openAppearanceSettingsModal()"><i class="fas fa-palette"></i> Внешний вид</button>
                    <button type="button" class="blacklist-open-btn" onclick="openBlacklistModal()"><i class="fas fa-ban"></i> Черный список<span class="bl-count">${(messengerProfile.blacklist || []).length}</span></button>
                    <button type="button" class="blacklist-open-btn" onclick="showSeychQrScanner()"><i class="fas fa-qrcode"></i> Вход по QR-код</button>
                    <button type="button" class="blacklist-open-btn" onclick="showSeychSessions()"><i class="fas fa-laptop-house"></i> Сессии и устройства</button>
                    <div class="settings-signout-row"><button type="button" class="contact-btn delete settings-signout-btn" onclick="signOutProfile()"><i class="fas fa-sign-out-alt"></i> Выйти из аккаунта</button></div>
                </div>`;
            }
            if (view === 'calls') {
                return `<div class="calls-workspace">
                    <div class="calls-header-card">
                        <div class="calls-header-icon" aria-hidden="true"><i class="fas fa-phone-alt"></i></div>
                        <div class="calls-header-title">Звонки</div>
                    </div>
                    <div class="workspace-empty-cards calls-action-cards">
                        <div class="workspace-empty-card" onclick="closeMessengerModal();createRoom()"><i class="fas fa-video"></i><div>Создать комнату</div></div>
                        <div class="workspace-empty-card" onclick="closeMessengerModal();showJoinModal()"><i class="fas fa-link"></i><div>Подключиться</div></div>
                    </div>
                </div>`;
            }
            if (view === 'profile') {
                return buildProfileViewContent();
            }
            return '';
        }

        function buildMessengerSectionTitle(view) {
            if (view === 'friends') return 'Друзья';
            if (view === 'calls') return 'Звонки';
            if (view === 'settings') return 'Настройки';
            if (view === 'notifications') return 'Уведомления';
            if (view === 'profile') return (messengerViewedProfile && messengerViewedProfile.profile && (messengerViewedProfile.profile.displayName || messengerViewedProfile.profile.name)) || 'Профиль';
            return 'Мессенджер';
        }

        function renderMainWorkspace() {
            if (messengerView === 'chats') {
                return renderMessengerWorkspace();
            }
            const content = buildMessengerViewContent(messengerView);
            return `<div class="messenger-section">
                <div class="messenger-section-header">
                    <button type="button" class="messenger-section-back" onclick="closeMessengerSection()" aria-label="Назад" title="Назад"><i class="fas fa-arrow-left"></i></button>
                    <div class="messenger-section-title">${escapeHtml(buildMessengerSectionTitle(messengerView))}</div>
                </div>
                <div class="messenger-section-body">${content}</div>
            </div>`;
        }

        function closeMessengerSection() {
            messengerViewedProfile = null;
            messengerView = 'chats';
            renderMainScreen();
        }

        function closeMessengerModal() {
            messengerViewedProfile = null;
            messengerView = 'chats';
            isChatOpen = false;
            renderMainScreen();
        }

        let messengerSectionSigCache = '';

        function computeMessengerSectionSig() {
            const v = messengerView;
            if (v === 'profile') {
                const pv = messengerViewedProfile || {};
                const p = pv.profile || {};
                const own = !pv.targetUserId && !pv.userId;
                const id = own ? String(authProfile?.appUserId || '') : String(p.id || pv.targetUserId || pv.userId || '');
                return `profile:${id}:${own ? 'own' : (pv.ok ? 'loaded' : 'pending')}:${String(p.displayName || p.name || '')}:${String(p.statusText || '')}`;
            }
            if (v === 'friends') {
                const friends = (friendsState.friends || []).map((f) => f.id || f).join(',');
                const inc = (friendsState.incomingRequests || []).length;
                return `friends:${friendsActiveTab}:${friends}:${inc}:${(friendsSearchResults || []).length}:${(friendsSearchResults || []).map((r) => r.id || '').join(',')}`;
            }
            if (v === 'notifications') {
                return `notif:${(messengerNotifications || []).map((n) => n.id || '').join(',')}:${messengerNotificationUnreadIds.size}`;
            }
            if (v === 'settings') return `settings:${(messengerProfile.blacklist || []).length}`;
            if (v === 'calls') return 'calls';
            return v;
        }

        let lastChatListHtml = '';

        function buildMessengerChatListHtml() {
            if (!messengerChats.length) {
                return '<div class="chats-empty-card"><i class="fas fa-comments"></i><p>Чатов пока нет</p></div>';
            }
            const myId = String(authProfile?.appUserId || '').trim();
            return messengerChats.map((chat) => {
                const lm = chat.lastMessage;
                let preview = '';
                const kind = String(lm?.messageKind || '');
                if (!lm) {
                    preview = 'История очищена';
                } else {
                    const lmText = String(lm?.text || '');
                    const isVoiceRec = lm?.messageKind === 'voice' && lmText === 'Голосовое сообщение';
                    const isMusic = lm?.messageKind === 'voice' && !!lmText && lmText !== 'Голосовое сообщение';
                    if (isVoiceRec) preview = 'Голосовое сообщение';
                    else if (isMusic) preview = lmText;
                    else preview = lmText || 'История очищена';
                }
                let finalPreview = kind === 'system' ? messengerPlainTextPreview(preview) : preview;
                if (lm && kind !== 'system') {
                    const fromId = String(lm?.fromId || '').trim();
                    if (fromId && fromId === myId) {
                        finalPreview = `Вы: ${preview}`;
                    } else if (fromId && isGroupMessengerChat(chat)) {
                        const senderName =
                            getGroupParticipantDisplayName(chat, fromId)
                            || resolvePeerDisplay(fromId)?.displayName
                            || resolvePeerDisplay(fromId)?.name
                            || fromId;
                        finalPreview = `${senderName}: ${preview}`;
                    }
                }
                const pdn = chat.peer?.displayName || chat.peer?.name || chat.peer?.id || '';
                const unread = getMessengerUnreadForChat(chat.id);
                return `
                    <div class="messenger-chat-item ${chat.id === messengerActiveChatId ? 'active' : ''}" onclick="openMessengerChatById('${escapeHtml(chat.id)}')" oncontextmenu="openChatListContextMenu(event,'${escapeHtml(isDirectMessengerChat(chat) ? (chat.peer?.id || '') : '')}','${escapeHtml(chat.id)}')" ontouchstart="startChatListHold(event,'${escapeHtml(isDirectMessengerChat(chat) ? (chat.peer?.id || '') : '')}','${escapeHtml(chat.id)}')" ontouchend="cancelChatListHold()" ontouchcancel="cancelChatListHold()">
                        ${unread ? `<div class="messenger-unread-badge">${unread > 99 ? '99+' : unread}</div>` : ''}
                        <div class="messenger-avatar">${avatarMarkup(pdn, chat.peer?.avatar || '', chat.peer?.initials)}</div>
                        <div class="messenger-chat-meta">
                            <div class="messenger-chat-title">${renderMaybeMarqueeText(pdn, 10, 'messenger-chat-title-text')}</div>
                            <div class="messenger-chat-preview">${escapeHtml(finalPreview)}</div>
                        </div>
                    </div>`;
            }).join('');
        }

        function buildMessengerSidebarHtml(opts) {
            const isMobile = !!(opts && opts.isMobile);
            const sidebarVisible = !(opts && opts.sidebarVisible === false);
            const notificationTotal = Number((opts && opts.notificationTotal) || 0);
            const statusText = String((opts && opts.statusText) || 'Online');
            const sidebarActiveGroupCallsHtml = sidebarVisible ? renderGlobalActiveGroupCallWidgets() : '';
            const chatItems = buildMessengerChatListHtml();
            return `
                <div class="sidebar-header">
                    <span class="sidebar-brand">Seych</span>
                    <button type="button" class="messenger-nav-btn" onclick="openNotificationsModal()" title="Уведомления" aria-label="Уведомления"><i class="fas fa-bell"></i>${notificationTotal ? `<span class="nav-badge">${notificationTotal > 99 ? '99+' : notificationTotal}</span>` : ''}</button>
                    ${isMobile && messengerView === 'chats' ? `<button type="button" class="messenger-nav-btn sidebar-compose-btn" onclick="openCreateGroupModal()" title="Создать чат" aria-label="Создать чат"><i class="fas fa-pen"></i></button>` : ''}
                </div>
                <div class="messenger-sidebar-body">
                    <div class="messenger-connection" style="margin-top:0;"><i class="fas fa-circle" style="font-size:9px;margin-right:5px;color:${getMessengerSocketReady() ? '#5cff9a' : '#f4b166'}"></i>${statusText}</div>
                    <div id="storiesContainer" class="stories-container"></div>
                    <div class="sidebar-group-calls-host">${sidebarActiveGroupCallsHtml}</div>
                    <div class="messenger-chat-list">${chatItems}</div>
                    ${sidebarVisible ? `<button type="button" class="messenger-compose-fab" onclick="openCreateGroupModal()" aria-label="Создать чат"><i class="fas fa-pen"></i></button>` : ''}
                </div>
                <div class="sidebar-footer-nav">
                    <button type="button" class="messenger-nav-btn ${messengerView === 'calls' ? 'active' : ''}" onclick="setMessengerView('calls')" title="Звонки"><i class="fas fa-phone"></i></button>
                    <button type="button" class="messenger-nav-btn ${messengerView === 'friends' ? 'active' : ''}" onclick="setMessengerView('friends')" title="Друзья"><i class="fas fa-user-friends"></i></button>
                    <button type="button" class="messenger-nav-btn ${messengerView === 'settings' ? 'active' : ''}" onclick="setMessengerView('settings')" title="Настройки"><i class="fas fa-sliders-h"></i></button>
                    <button type="button" class="messenger-nav-btn ${messengerView === 'profile' ? 'active' : ''}" onclick="setMessengerView('profile')" title="Профиль"><i class="fas fa-user"></i></button>
                </div>
            `;
        }

        function buildMessengerBottomNavHtml(isMobile) {
            if (!isMobile) return '';
            return `<nav class="messenger-bottom-nav" aria-label="Навигация">
                <button type="button" class="${messengerView === 'chats' && !isChatOpen ? 'active' : ''}" onclick="setMessengerView('chats')"><i class="fas fa-comments"></i>Чаты</button>
                <button type="button" class="${messengerView === 'friends' ? 'active' : ''}" onclick="setMessengerView('friends')"><i class="fas fa-user-friends"></i>Друзья</button>
                <button type="button" class="${messengerView === 'calls' ? 'active' : ''}" onclick="setMessengerView('calls')"><i class="fas fa-phone"></i>Звонки</button>
                <button type="button" class="${messengerView === 'profile' ? 'active' : ''}" onclick="setMessengerView('profile')"><i class="fas fa-user"></i>Профиль</button>
            </nav>`;
        }

        function patchChatTopbarStatus() {
            if (messengerView !== 'chats') return;
            const statusEl = document.getElementById('chatTopbarStatus');
            if (!statusEl) return;
            const activeChat = resolveActiveMessengerChat();
            if (!activeChat) return;
            const peerTypingState = getMessengerPeerActivityState(messengerActivePeerId);
            const statusText = formatPeerStatusLine(activeChat.peer, peerTypingState);
            statusEl.textContent = escapeHtml(isGroupMessengerChat(activeChat) ? getGroupChatStatusText(activeChat) : statusText);
        }

        function preserveFocusedMessengerInputBeforeRender() {
            const ae = document.activeElement;
            if (!ae || !ae.id) return null;
            if (ae.id !== 'chatComposerInput' && ae.id !== 'friendsSearchInput') return null;
            const el = ae;
            const parent = el.parentNode;
            if (!parent) return null;
            parent.removeChild(el);
            return function reattach() {
                if (el.id === 'chatComposerInput') {
                    const row = document.querySelector('.chat-composer-row');
                    if (!row) return;
                    const fresh = row.querySelector('#chatComposerInput');
                    if (fresh && fresh !== el) {
                        el.placeholder = fresh.placeholder;
                        el.disabled = fresh.disabled;
                        if (fresh.maxLength >= 0) el.maxLength = fresh.maxLength;
                        el.style.cssText = fresh.getAttribute('style') || '';
                        fresh.remove();
                    }
                    row.insertBefore(el, row.firstChild);
                } else {
                    const wrap = document.querySelector('.friends-search-wrap');
                    if (!wrap) return;
                    const fresh = wrap.querySelector('#friendsSearchInput');
                    if (fresh && fresh !== el) {
                        el.placeholder = fresh.placeholder;
                        el.disabled = fresh.disabled;
                        fresh.remove();
                    }
                    wrap.insertBefore(el, wrap.firstChild);
                }
                try {
                    el.focus();
                } catch (_) {}
                let sel = null;
                try {
                    sel = { s: el.selectionStart, e: el.selectionEnd };
                } catch (_) {}
                if (sel && typeof el.setSelectionRange === 'function') {
                    try {
                        el.setSelectionRange(sel.s, sel.e);
                    } catch (_) {}
                }
            };
        }

        function patchMessengerShell() {
            const shell = document.querySelector('.messenger-shell');
            const sidebar = document.querySelector('.messenger-sidebar');
            const mainScreen = document.querySelector('.main-screen');
            if (!shell || !sidebar || !mainScreen) {
                messengerWorkspaceDirty = true;
                renderMainScreen();
                return;
            }
            const isMobile = isMobileLayout();
            const statusText = getMessengerSocketReady() ? 'Online' : 'Соединение...';
            const nextShellClass = [
                'messenger-shell',
                isMobile ? 'messenger-shell--mobile' : '',
                messengerMobileWorkspaceOpen() ? 'messenger-shell--workspace' : '',
                isMobile && isChatOpen && messengerView === 'chats' ? 'messenger-shell--mobile-conversation' : ''
            ].filter(Boolean).join(' ');
            if (shell.className !== nextShellClass) {
                shell.className = nextShellClass;
            }
            // Список чатов пересобираем только если он реально изменился — иначе аватары мигают.
            const chatListHtml = buildMessengerChatListHtml();
            const chatListEl = sidebar.querySelector('.messenger-chat-list');
            if (chatListEl && chatListHtml !== lastChatListHtml) {
                chatListEl.innerHTML = chatListHtml;
                lastChatListHtml = chatListHtml;
            }
            const connEl = sidebar.querySelector('.messenger-connection');
            if (connEl) {
                const ready = getMessengerSocketReady();
                connEl.innerHTML = `<i class="fas fa-circle" style="font-size:9px;margin-right:5px;color:${ready ? '#5cff9a' : '#f4b166'}"></i>${statusText}`;
            }
            const total = getMessengerNotificationUnreadTotal();
            const notifBtn = sidebar.querySelector('.sidebar-header .messenger-nav-btn');
            if (notifBtn) {
                const badge = notifBtn.querySelector('.nav-badge');
                if (badge) {
                    if (total) {
                        badge.textContent = total > 99 ? '99+' : total;
                        badge.style.display = '';
                    } else {
                        badge.remove();
                    }
                } else if (total) {
                    notifBtn.insertAdjacentHTML('beforeend', `<span class="nav-badge">${total > 99 ? '99+' : total}</span>`);
                }
            }
            const gcwHost = sidebar.querySelector('.sidebar-group-calls-host');
            if (gcwHost) {
                const next = renderGlobalActiveGroupCallWidgets();
                if (String(gcwHost.innerHTML || '').trim() !== String(next || '').trim()) {
                    gcwHost.innerHTML = next || '';
                }
            }
            const bottomNavHtml = buildMessengerBottomNavHtml(isMobile);
            const bottomNav = mainScreen.querySelector('.messenger-bottom-nav');
            if (bottomNavHtml) {
                if (!bottomNav) {
                    mainScreen.insertAdjacentHTML('beforeend', bottomNavHtml);
                } else if (String(bottomNav.outerHTML) !== String(bottomNavHtml)) {
                    bottomNav.outerHTML = bottomNavHtml;
                }
            } else if (bottomNav) {
                bottomNav.remove();
            }
            renderStories();
            patchChatTopbarStatus();
            updateMessengerNewWhileScrolledFabUI();
            updateMessengerMentionFabUI();
            syncCallScreenLayoutMode();
            syncMusicIslandWidget();
            bindMessengerWorkspaceScrollGuard();
            const ta = document.getElementById('chatComposerInput');
            if (ta && messengerView === 'chats' && messengerActiveChatId) {
                onComposerInput();
            }
        }

        function renderMainScreen() {
            if (!authProfile) {
                renderAuthScreen();
                return;
            }
            if (messengerView !== 'chats' && document.querySelector('.messenger-section')) {
                const sig = computeMessengerSectionSig();
                if (sig === messengerSectionSigCache) {
                    return;
                }
            }
            const focusSnap = captureMessengerFocusSnapshot();
            // Если пользователь прямо сейчас скроллит историю — не перерисовываем чат,
            // иначе скролл "дергается" (особенно на мобиле).
            if ((messengerView === 'chats' && messengerIsUserScrolling) || (messengerView === 'notifications' && messengerWorkspaceIsUserScrolling)) {
                messengerRenderPendingAfterScroll = true;
                return;
            }
            // Контент открытого чата не менялся? Тогда не трогаем историю/поле ввода вообще —
            // обновляем только сайдбар, шапку и статусы. Это убирает дерганье, мигание
            // аватаров и сворачивание клавиатуры при фоновых событиях.
            const activeChatIdNow = String(messengerView === 'chats' ? (messengerActiveChatId || '') : '');
            const wsDirtyForActive =
                messengerWorkspaceDirty === true ||
                (messengerWorkspaceDirty && activeChatIdNow && String(messengerWorkspaceDirty) === activeChatIdNow);
            if (messengerView === 'chats' && activeChatIdNow && !wsDirtyForActive && document.querySelector('#app .chat-workspace')) {
                patchMessengerShell();
                if (focusSnap) restoreMessengerFocusSnapshot(focusSnap);
                messengerSectionSigCache = '';
                return;
            }
            messengerWorkspaceDirty = false;
            // Snapshot прокрутки истории перед перерисовкой (чтобы не прыгало вверх/вниз).
            const hist = document.querySelector('.chat-history');
            const histSnapshot = hist
                ? {
                      scrollTop: hist.scrollTop,
                      distFromBottom: hist.scrollHeight - hist.scrollTop - hist.clientHeight,
                      wasNearBottom: hist.scrollHeight - hist.scrollTop - hist.clientHeight < 80
                  }
                : null;
            // Не даём слушателю скролла “стрелять” в момент пользовательского скролла.
            const autoScrollAllowed = !messengerIsUserScrolling;
            try {
                if (voiceRecordingActive && voiceMediaRecorder && messengerView !== 'chats') {
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
                    if (typeof mr.requestData === 'function') mr.requestData();
                    mr.stop();
                }
            } catch (_) {}
            const isMobile = isMobileLayout();
            const statusText = getMessengerSocketReady() ? 'Online' : 'Соединение...';
            const sidebarVisible = !messengerMobileWorkspaceOpen();
            const mobileWorkspaceActiveCallsHtml = isMobile && messengerView !== 'chats' ? renderGlobalActiveGroupCallWidgets() : '';
            const workspaceHtml = renderMainWorkspace();
            const notificationTotal = getMessengerNotificationUnreadTotal();
            const chatItems = buildMessengerChatListHtml();
            {
                const prevTa = document.getElementById('chatComposerInput');
                if (prevTa && messengerView === 'chats' && messengerActiveChatId) {
                    composerDraftByPeerId.set(messengerActiveChatId || messengerActivePeerId, prevTa.value);
                }
            }
            const bottomNavHtml = buildMessengerBottomNavHtml(isMobile);
            const shellMobile = isMobile ? 'messenger-shell--mobile' : '';
            const shellWs = messengerMobileWorkspaceOpen() ? 'messenger-shell--workspace' : '';
            const shellMobileConversation =
                isMobile && isChatOpen && messengerView === 'chats' ? 'messenger-shell--mobile-conversation' : '';
            // Скролл истории дергаем только когда реально надо (после загрузки истории/открытия чата).
            const profileScrollSnapshot = (() => {
                if (messengerView !== 'profile') return null;
                const el = document.querySelector('.messenger-workspace .workspace-scroll');
                if (!el) return null;
                return { scrollTop: Number(el.scrollTop || 0) || 0 };
            })();
            const notificationsScrollSnapshot = (() => {
                if (messengerView !== 'notifications') return null;
                const el = document.querySelector('.messenger-workspace .workspace-scroll');
                if (!el) return null;
                return { scrollTop: Number(el.scrollTop || 0) || 0 };
            })();
            const reattachInput = preserveFocusedMessengerInputBeforeRender();
            document.getElementById('app').innerHTML = `
                <div class="main-screen main-screen--messenger">
                    <div class="gradient-bg"></div>
                    <div class="messenger-shell ${shellMobile} ${shellWs} ${shellMobileConversation}">
                        <aside class="messenger-sidebar">
                            ${buildMessengerSidebarHtml({ isMobile, sidebarVisible, notificationTotal, statusText })}
                        </aside>
                        <div class="messenger-workspace">
                            ${mobileWorkspaceActiveCallsHtml}
                            ${workspaceHtml}
                        </div>
                    </div>
                    ${bottomNavHtml}
                </div>
            `;
            if (reattachInput) reattachInput();
            lastChatListHtml = chatItems;
            messengerSectionSigCache = messengerView !== 'chats' ? computeMessengerSectionSig() : '';
            syncCallScreenLayoutMode();
            syncMusicIslandWidget();
            // Render stories on all messenger views
            renderStories();
            requestAnimationFrame(() => {
                if (document.getElementById('emptyChatPhrase')) {
                    startEmptyChatPhraseRotation();
                } else {
                    stopEmptyChatPhraseRotation();
                }
                // Гарантируем защиту от “дерганья” скролла.
                bindMessengerHistoryScrollGuard();
                bindMessengerWorkspaceScrollGuard();
                hydrateMessengerLinkPreviews();
                if (focusSnap) {
                    restoreMessengerFocusSnapshot(focusSnap);
                } else {
                    const ta = document.getElementById('chatComposerInput');
                    if (ta && messengerView === 'chats' && messengerActiveChatId) {
                        const draftKey = messengerActiveChatId || messengerActivePeerId;
                        if (composerDraftByPeerId.has(draftKey)) {
                            ta.value = composerDraftByPeerId.get(draftKey);
                        }
                        onComposerInput();
                    }
                    const fsi = document.getElementById('friendsSearchInput');
                    if (fsi && messengerView === 'friends') {
                        fsi.value = friendsSearchValue;
                    }
                }
                if (messengerView === 'chats') {
                    syncComposerMentionMenuDom(resolveActiveMessengerChat());
                }
                if (messengerView === 'profile' && profileScrollSnapshot) {
                    const scrollEl = document.querySelector('.messenger-workspace .workspace-scroll');
                    if (scrollEl) scrollEl.scrollTop = profileScrollSnapshot.scrollTop;
                }
                if (messengerView === 'notifications' && notificationsScrollSnapshot) {
                    const scrollEl = document.querySelector('.messenger-workspace .workspace-scroll');
                    if (scrollEl) scrollEl.scrollTop = notificationsScrollSnapshot.scrollTop;
                }
                const hist2 = document.querySelector('.chat-history');
                if (hist2 && autoScrollAllowed) {
                    if (messengerShouldAutoScroll) {
                        hist2.scrollTop = hist2.scrollHeight;
                        messengerShouldAutoScroll = false;
                    } else if (histSnapshot) {
                        if (histSnapshot.wasNearBottom) {
                            hist2.scrollTop = Math.max(0, hist2.scrollHeight - hist2.clientHeight - histSnapshot.distFromBottom);
                        } else {
                            const maxScrollTop = Math.max(0, hist2.scrollHeight - hist2.clientHeight);
                            hist2.scrollTop = Math.max(0, Math.min(Number(histSnapshot.scrollTop || 0), maxScrollTop));
                        }
                    }
                }
                updateMessengerNewWhileScrolledFabUI();
                updateMessengerMentionFabUI();
            });
        }

        window.toggleVoicePlay = toggleVoicePlay;
        window.toggleMusicFromMessage = toggleMusicFromMessage;
        window.toggleMusicIslandPlayPause = toggleMusicIslandPlayPause;
        window.stopMusicPlayer = stopMusicPlayer;
        window.seekMusicBy = seekMusicBy;
        window.syncMusicIslandWidget = syncMusicIslandWidget;
        window.scrollAndHighlightMessengerMessage = scrollAndHighlightMessengerMessage;
        window.scrollMessengerHistoryToBottom = scrollMessengerHistoryToBottom;
        window.avatarImgOnError = avatarImgOnError;
        window.togglePrivacyDropdown = togglePrivacyDropdown;
        window.setStoryPrivacy = setStoryPrivacy;
        window.toggleStoryPrivacyDropdown = toggleStoryPrivacyDropdown;
        window.toggleVoicePreviewPlay = toggleVoicePreviewPlay;
        window.stopVoiceRecordingCapture = stopVoiceRecordingCapture;
        window.sendVoiceFromPreview = sendVoiceFromPreview;
        window.createRoom = createRoom;
        window.joinRoom = joinRoom;
        window.showJoinModal = showJoinModal;
        window.toggleDurakCallPanel = toggleDurakCallPanel;
        window.toggleVideo = toggleVideo;
        window.switchCameraFacingMode = switchCameraFacingMode;
        window.toggleAudio = toggleAudio;
        window.startScreenShare = startScreenShare;
        window.endCall = endCall;
        window.copyRoomId = copyRoomId;
        window.showWatchPartyModal = showWatchPartyModal;
        window.stopWatchParty = stopWatchParty;
        window.showContextMenu = showContextMenu;
        window.forceToggleRemoteVideo = forceToggleRemoteVideo;
        window.forceToggleRemoteAudio = forceToggleRemoteAudio;
        window.toggleAdmin = toggleAdmin;
        window.kickUser = kickUser;
        window.toggleParticipantsPanel = toggleParticipantsPanel;
        window.closeParticipantsPanel = closeParticipantsPanel;
        window.showRoomSettingsMenu = showRoomSettingsMenu;
        window.toggleRoomPrivacy = toggleRoomPrivacy;
        window.closeRoomForEveryone = closeRoomForEveryone;
        window.approveJoinRequest = approveJoinRequest;
        window.rejectJoinRequest = rejectJoinRequest;
        window.handleTelegramAuth = handleTelegramAuth;
        window.startGoogleAuth = startGoogleAuth;
        window.signOutProfile = signOutProfile;
        window.renderVkContactsModal = renderVkContactsModal;
        window.refreshVkContacts = refreshVkContacts;
        window.callVkContact = callVkContact;
        window.addVkContactFromModal = addVkContactFromModal;
        window.removeVkContact = removeVkContact;
        window.handleParticipantTap = handleParticipantTap;
        window.requestFriendFromCall = requestFriendFromCall;
        window.setFriendsTab = setFriendsTab;
        window.toggleFriendsHomePanel = toggleFriendsHomePanel;
        window.closeFriendsHomePanel = closeFriendsHomePanel;
        window.onFriendsSearchInput = onFriendsSearchInput;
        window.sendFriendRequest = sendFriendRequest;
        window.handleFriendRequest = handleFriendRequest;
        window.deleteFriend = deleteFriend;
        window.callFriend = callFriend;
        window.replyIncomingCall = replyIncomingCall;
        window.copyAppUserId = copyAppUserId;
        window.showFriendsSettingsMenu = showFriendsSettingsMenu;
        window.persistFriendsNotifyValue = persistFriendsNotifyValue;
        window.closeIncomingFriendModal = closeIncomingFriendModal;
        window.acceptIncomingFriendFromModal = acceptIncomingFriendFromModal;
        window.setMessengerView = setMessengerView;
        window.closeMessengerModal = closeMessengerModal;
        window.openMessengerNotification = openMessengerNotification;
        window.openNotificationsModal = openNotificationsModal;
        window.closeNotificationsModal = closeNotificationsModal;
        window.refreshNotificationsModalContent = refreshNotificationsModalContent;
        window.markMessengerNotificationsRead = markMessengerNotificationsRead;
        window.markMessengerWorkspaceDirty = markMessengerWorkspaceDirty;
        window.openMessengerChat = openMessengerChat;
        window.openChatListContextMenu = openChatListContextMenu;
        window.startChatListHold = startChatListHold;
        window.cancelChatListHold = cancelChatListHold;
        window.clearChatHistoryForMe = clearChatHistoryForMe;
        window.openDeleteChatModal = openDeleteChatModal;
        window.confirmDeleteChat = confirmDeleteChat;
        window.openMentionProfile = openMentionProfile;
        window.openUserProfile = openUserProfile;
        window.openStoryAuthorProfile = openStoryAuthorProfile;
        window.openStoryViewerProfile = openStoryViewerProfile;
        window.sendMessageFromComposer = sendMessageFromComposer;
        window.openAppearanceSettingsModal = openAppearanceSettingsModal;
        window.openPrivacySettingsModal = openPrivacySettingsModal;
        window.composerPrimaryAction = composerPrimaryAction;
        window.onComposerKeydown = onComposerKeydown;
        window.onComposerInput = onComposerInput;
        window.openProfileEditModal = openProfileEditModal;
        window.openImageLightbox = openImageLightbox;
        window.openImageLightboxFromImg = openImageLightboxFromImg;
        window.openVideoLightboxFromMsg = openVideoLightboxFromMsg;
        window.openVideoLightbox = openVideoLightbox;
        window.seychVideoToggle = seychVideoToggle;
        window.onChatMediaSelected = onChatMediaSelected;
        window.setPrivacyRule = setPrivacyRule;
        window.removeUserFromBlacklist = removeUserFromBlacklist;
        window.openBlacklistModal = openBlacklistModal;
        window.closeBlacklistModal = closeBlacklistModal;
        window.getInitialEmptyChatPhrase = getInitialEmptyChatPhrase;
        window.startEmptyChatPhraseRotation = startEmptyChatPhraseRotation;
        window.stopEmptyChatPhraseRotation = stopEmptyChatPhraseRotation;
        window.toggleBlockActivePeer = toggleBlockActivePeer;
        window.openMessageMenu = openMessageMenu;
        window.copyMessengerMessage = copyMessengerMessage;
        window.startMessageHold = startMessageHold;
        window.cancelMessageHold = cancelMessageHold;
        window.setReplyToMessage = setReplyToMessage;
        window.startEditMessage = startEditMessage;
        window.deleteMessageById = deleteMessageById;
        window.openForwardModal = openForwardModal;
        window.forwardMessageToChat = forwardMessageToChat;
        window.clearComposerReplyEdit = clearComposerReplyEdit;
        window.closeMobileChatView = closeMobileChatView;
        window.minimizeCallToIsland = minimizeCallToIsland;
        window.restoreCallFromIsland = restoreCallFromIsland;
        window.startGroupCallForChat = startGroupCallForChat;
        window.joinActiveGroupCall = joinActiveGroupCall;
        window.openCreateGroupModal = openCreateGroupModal;
        window.openGroupProfileModal = openGroupProfileModal;
        window.openGroupSettingsModal = openGroupSettingsModal;
        window.openGroupEditModal = openGroupEditModal;
        window.openAddMembersToGroupModal = openAddMembersToGroupModal;
        window.openGroupMemberActionModal = openGroupMemberActionModal;
        window.toggleGroupMemberActionFields = toggleGroupMemberActionFields;
        window.leaveGroupChat = leaveGroupChat;
        window.joinGroupByInvite = joinGroupByInvite;
        window.openAddUserToGroupModal = openAddUserToGroupModal;
        window.addUserToGroupChat = addUserToGroupChat;

        async function bootApp() {
            initSoundEffects();
            initMessengerAntiCopyGuards();
            loadMessengerTheme();
            authProfile = loadStoredProfile();
            messengerProfile = getStoredMessengerProfile();
            appUserId = authProfile?.appUserId || '';
            friendsNotificationsEnabled = getStoredFriendsNotifyValue();
            // Initialize Durak card back style
            updateDurakCardBackStyle();
            vkCustomContacts = loadVkCustomContacts();
            vkHiddenContactIds = loadVkHiddenContacts();
            setInterval(refreshConnectionQuality, 4000);
            window.addEventListener('offline', () => {
                // Уведомление о потере связи намеренно скрыто.
            });
            window.addEventListener('online', () => {
                if (roomId) {
                    reconnectNow();
                }
            });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    recoverAfterTabWakeup();
                }
            });
            window.addEventListener('focus', () => {
                recoverAfterTabWakeup();
            });
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
            }
            if (!window.__seychUiDelegatesInit) {
                window.__seychUiDelegatesInit = true;
                document.body.addEventListener('click', (e) => {
                    const playBtn = e.target.closest && e.target.closest('.voice-play-btn');
                    if (playBtn) {
                        // На кнопке уже есть inline `onclick`, поэтому делегированный обработчик
                        // может вызывать двойное переключение (включить и тут же выключить).
                        // Оставляем поведение inline-обработчика.
                    }
                    const inviteLink = e.target.closest && e.target.closest('a.chat-msg-link, a.msg-link-preview-card');
                    if (inviteLink) {
                        const inviteCode = extractGroupInviteCodeFromHref(inviteLink.getAttribute('href') || inviteLink.href || '');
                        if (inviteCode) {
                            e.preventDefault();
                            e.stopPropagation();
                            pendingGroupInviteCode = inviteCode;
                            consumePendingGroupInviteIfAny(inviteCode);
                            return;
                        }
                    }
                    if (e.target.closest && (e.target.closest('.privacy-dd-trigger') || e.target.closest('.privacy-dd-panel'))) {
                        return;
                    }
                    document.querySelectorAll('.privacy-dd-panel').forEach((p) => p.classList.remove('open'));
                });
            }
            let messengerResizeTimer = null;
            let lastMessengerLayoutWidth = window.innerWidth;
            window.addEventListener('resize', () => {
                updateParticipantsResponsiveUI();
                if (durakGameState) {
                    clearTimeout(window.__durakResizeUiT);
                    window.__durakResizeUiT = setTimeout(() => {
                        renderDurakUi();
                    }, 120);
                }
                if (document.activeElement && document.activeElement.id === 'chatComposerInput') return;
                if (!roomId && authProfile) {
                    const w = window.innerWidth;
                    if (Math.abs(w - lastMessengerLayoutWidth) < 48) return;
                    lastMessengerLayoutWidth = w;
                    if (messengerResizeTimer) clearTimeout(messengerResizeTimer);
                    messengerResizeTimer = setTimeout(() => { renderMainScreen(); }, 200);
                }
            }, { passive: true });
            document.addEventListener('click', unlockAudioPlayback, { once: true });
            document.addEventListener('touchstart', unlockAudioPlayback, { once: true, passive: true });
            if (authProfile) {
                userName = authProfile.name || '';
                userAvatar = authProfile.avatar || '';
                restoreMessengerSessionPeer();
                connectWS({ type: 'messenger-register', appUserId: authProfile.appUserId || appUserId, userName, userAvatar, deviceId: getSeychDeviceId() });
                sendMessengerEvent({ type: 'messenger-sync' });
                pendingGroupInviteCode = parseGroupInviteFromLocation();
                consumePendingGroupInviteIfAny();
                if (messengerActiveChatId) {
                    sendMessengerEvent({ type: 'messenger-open-chat', chatId: messengerActiveChatId });
                } else if (messengerActivePeerId) {
                    sendMessengerEvent({ type: 'messenger-open-chat', withUserId: messengerActivePeerId });
                }
            }
            pendingRoomJoin = parseRoomFromPath();
            if (!pendingGroupInviteCode) {
                pendingGroupInviteCode = parseGroupInviteFromLocation();
            }
            if (authProfile?.provider === 'vk' && authProfile.vkAccessToken) {
                fetchVkFriendsFromApi().finally(() => {
                    ensureFriendsRuntime();
                    renderMainScreen();
                    consumePendingGroupInviteIfAny();
                    if (pendingRoomJoin) {
                        const roomToJoin = pendingRoomJoin;
                        pendingRoomJoin = null;
                        joinRoom(roomToJoin);
                    }
                });
                return;
            }
            if (authProfile) {
                ensureFriendsRuntime();
            }
            renderMainScreen();
            consumePendingGroupInviteIfAny();
            if (authProfile && pendingRoomJoin) {
                const roomToJoin = pendingRoomJoin;
                pendingRoomJoin = null;
                joinRoom(roomToJoin);
            }
        }

        startAppWithConditionalLoader();
        
