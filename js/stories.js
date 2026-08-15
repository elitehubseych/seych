        function requestStoriesForUser(userId) {
            const id = String(userId || '').trim();
            if (!id) return;
            sendMessengerEvent({
                type: 'messenger-get-stories',
                targetUserId: id
            });
        }

        function loadStories() {
            if (!authProfile?.appUserId) return;
            
            const friends = Array.isArray(friendsState.friends) ? friendsState.friends : [];
            const friendIds = friends.map(f => f.id);
            
            // Load stories for friends
            friendIds.forEach(friendId => {
                requestStoriesForUser(friendId);
            });
            
            // Load own stories for upload button
            requestStoriesForUser(authProfile.appUserId);
            const viewedProfileId = String(messengerViewedProfile?.targetUserId || messengerViewedProfile?.profile?.id || '').trim();
            if (viewedProfileId && !friendIds.includes(viewedProfileId) && viewedProfileId !== String(authProfile.appUserId || '')) {
                requestStoriesForUser(viewedProfileId);
            }
        }

        function getStoryAuthorInfo(story, fallbackUserId = '') {
            const userId = String(story?.userId || fallbackUserId || '').trim();
            const fallback = userId ? getUserInfo(userId) : { displayName: '', name: '', avatar: '', initials: '' };
            const displayName = String(story?.userDisplayName || fallback.displayName || fallback.name || userId).trim();
            const name = String(story?.userName || fallback.name || displayName || userId).trim();
            const avatar = String(story?.userAvatar || fallback.avatar || '').trim();
            const initials = String(story?.userInitials || fallback.initials || '').trim();
            return {
                userId,
                displayName,
                name,
                avatar,
                initials
            };
        }

        function buildStoryAvatarHtml(author) {
            return avatarMarkup(
                author?.displayName || author?.name || author?.userId || '',
                author?.avatar || '',
                author?.initials || ''
            );
        }

        function getCurrentStory() {
            if (currentStoryIndex < 0 || currentStoryIndex >= currentStories.length) return null;
            return currentStories[currentStoryIndex] || null;
        }

        function getUserStories(userId) {
            return stories.get(String(userId || '').trim()) || [];
        }

        function getFirstUnviewedStoryIndex(userId) {
            const list = getUserStories(userId);
            const index = list.findIndex(story => !storyViewed.has(story.id));
            return index >= 0 ? index : -1;
        }

        function userHasUnviewedStories(userId) {
            return getFirstUnviewedStoryIndex(userId) >= 0;
        }

        function getProfileStoryMeta(userId) {
            const userStories = getUserStories(userId);
            const firstUnviewedIndex = getFirstUnviewedStoryIndex(userId);
            return {
                stories: userStories,
                hasStories: userStories.length > 0,
                hasUnviewed: firstUnviewedIndex >= 0,
                firstUnviewedIndex
            };
        }

        function buildProfileAvatarBlock({ userId, displayName, avatar, initials, clickable = true }) {
            const meta = getProfileStoryMeta(userId);
            const canOpen = clickable && meta.hasStories;
            const avatarInner = `<div class="profile-avatar">${avatarMarkup(displayName || userId || '', avatar || '', initials || '')}</div>`;
            if (!meta.hasStories) return avatarInner;
            return `
                <div class="profile-avatar-story ${canOpen ? 'clickable' : ''}" ${canOpen ? `onclick="openProfileStory('${escapeHtml(userId || '')}')"` : ''} title="${escapeHtml(meta.hasUnviewed ? 'Открыть историю' : 'Открыть публикации')}">
                    <div class="profile-avatar-story-ring ${meta.hasUnviewed ? '' : 'viewed'}">
                        ${avatarInner}
                    </div>
                </div>
            `;
        }

        function profileCoverBackgroundStyle(coverUrl, avatarUrl) {
            const cover = String(coverUrl || '').trim();
            const avatar = String(avatarUrl || '').trim();
            const source = cover || avatar;
            if (!source) return '';
            return `background-image:url('${escapeHtml(source).replace(/'/g, '&#39;')}')`;
        }

        function renderProfileHeroCard({ userId = '', displayName = '', avatar = '', coverUrl = '', initials = '', username = '', subtitle = '', clickableAvatar = true }) {
            const coverStyle = profileCoverBackgroundStyle(coverUrl, avatar);
            const hasCover = !!String(coverUrl || '').trim();
            const avatarBlock = buildProfileAvatarBlock({ userId, displayName, avatar, initials, clickable: clickableAvatar });
            return `
                <div class="profile-cover-shell">
                    <div class="profile-cover-frame">
                        <div class="profile-cover-image ${hasCover ? '' : 'is-fallback'}" style="${coverStyle}"></div>
                        <div class="profile-cover-overlay"></div>
                    </div>
                    <div class="profile-cover-avatar">${avatarBlock}</div>
                </div>
                <div class="profile-hero-meta">
                    <div class="profile-name">${escapeHtml(displayName || userId || '')}</div>
                </div>
            `;
        }

        function buildProfileStoriesSection({ userId, title, own = false }) {
            const userStories = getUserStories(userId);
            if (!userStories.length) {
                if (!own) return '';
                return `
                    <div style="margin-top: 24px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px; text-align: center;">
                        <div style="color: rgba(255,255,255,0.6); margin-bottom: 12px;">
                            <i class="fas fa-video" style="font-size: 32px; margin-bottom: 8px; display: block;"></i>
                            У вас пока нет историй
                        </div>
                        <button type="button" class="contact-btn" onclick="openStoryUploadModal()">
                            <i class="fas fa-plus" style="margin-right: 6px;"></i>Создать историю
                        </button>
                    </div>
                `;
            }
            return `
                <div style="margin-top: 24px; padding: 16px; background: rgba(255,255,255,0.05); border-radius: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                        <h4 style="margin: 0; color: white; font-size: 16px; font-weight: 600;">
                            <i class="fas fa-video" style="margin-right: 8px; color: #667eea;"></i>${escapeHtml(title)} (${userStories.length})
                        </h4>
                        ${own ? `<button type="button" class="contact-btn" onclick="openStoryUploadModal()" title="Добавить историю"><i class="fas fa-plus"></i></button>` : ''}
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 12px;">
                        ${userStories.map((story, index) => {
                            const isViewed = storyViewed.has(story.id);
                            const canOpen = true;
                            return `
                                <div style="position: relative; cursor: ${canOpen ? 'pointer' : 'default'}; border-radius: 8px; overflow: hidden; aspect-ratio: 9/16; background: #000;"
                                     ${canOpen ? `onclick="openStoryViewer('${escapeHtml(userId || '')}', ${index})"` : ''}
                                     title="${escapeHtml(story.caption || 'История ' + (index + 1))}">
                                    ${story.thumbnailUrl
                                        ? `<img src="${escapeHtml(story.thumbnailUrl)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">`
                                        : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #667eea, #764ba2); color: white; font-size: 24px;"><i class="fas fa-video"></i></div>`
                                    }
                                    <div style="position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">
                                        ${Math.max(1, Math.round((story.durationMs || 0) / 1000))}с
                                    </div>
                                    <div style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 999px; font-size: 10px;">
                                        ${own ? (story.privacy === 'all' ? '🌍' : story.privacy === 'friends' ? '👥' : '🚫') : (isViewed ? 'Просмотрено' : 'Новое')}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        function openProfileStory(userId) {
            const id = String(userId || '').trim();
            if (!id) return;
            const meta = getProfileStoryMeta(id);
            if (!meta.hasStories) return;
            const startIndex = meta.hasUnviewed ? meta.firstUnviewedIndex : Math.max(0, meta.stories.length - 1);
            openStoryViewer(id, startIndex);
        }

        function openStoryAuthorProfile(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const story = getCurrentStory();
            const userId = String(story?.userId || '').trim();
            if (!userId) return;
            closeStoryViewsModal();
            closeStoryViewer();
            openUserProfile(userId);
        }

        function openStoryViewerProfile(userId, event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const id = String(userId || '').trim();
            if (!id) return;
            closeStoryViewsModal();
            closeStoryViewer();
            openUserProfile(id);
        }

        function handleRemoteStoryStateChange(ownerUserId) {
            const ownerId = String(ownerUserId || '').trim();
            if (!ownerId || !authProfile?.appUserId) return;
            const isOwn = ownerId === String(authProfile.appUserId || '');
            const isFriend = Array.isArray(friendsState.friends) && friendsState.friends.some((friend) => String(friend?.id || '') === ownerId);
            const isViewedProfile = String(messengerViewedProfile?.targetUserId || messengerViewedProfile?.profile?.id || '') === ownerId;
            if (!isOwn && !isFriend && !isViewedProfile) return;
            requestStoriesForUser(ownerId);
        }

        function renderStoryProgressSegments() {
            const progressBar = document.getElementById('storyProgressBar');
            if (!progressBar) return;
            progressBar.innerHTML = currentStories.map((_, index) => `
                <div class="story-progress-segment">
                    <div id="storyProgressFill-${index}" class="story-progress-fill"></div>
                </div>
            `).join('');
            updateStoryProgressBars(0);
        }

        function updateStoryProgressBars(activeRatio = 0) {
            currentStories.forEach((_, index) => {
                const fill = document.getElementById(`storyProgressFill-${index}`);
                if (!fill) return;
                if (index < currentStoryIndex) {
                    fill.style.width = '100%';
                } else if (index > currentStoryIndex) {
                    fill.style.width = '0%';
                } else {
                    fill.style.width = `${Math.max(0, Math.min(100, activeRatio * 100))}%`;
                }
            });
        }

        function stopStoryProgressLoop() {
            if (storyProgressRaf) {
                cancelAnimationFrame(storyProgressRaf);
                storyProgressRaf = 0;
            }
        }

        function syncStoryProgressLoop() {
            stopStoryProgressLoop();
            const video = document.getElementById('storyVideo');
            const tick = () => {
                const viewer = document.getElementById('storyViewer');
                if (!viewer || !viewer.classList.contains('active')) return;
                const story = getCurrentStory();
                if (!story || !video) return;
                const duration = Number(video.duration) > 0 ? Number(video.duration) : Math.max((Number(story.durationMs) || 0) / 1000, 0.001);
                const ratio = duration > 0 ? Math.max(0, Math.min(1, Number(video.currentTime || 0) / duration)) : 0;
                updateStoryProgressBars(ratio);
                storyProgressRaf = requestAnimationFrame(tick);
            };
            storyProgressRaf = requestAnimationFrame(tick);
        }

        function pauseCurrentStoryPlayback() {
            const video = document.getElementById('storyVideo');
            if (video && !video.paused) video.pause();
        }

        function resumeCurrentStoryPlayback() {
            const video = document.getElementById('storyVideo');
            if (!video) return;
            video.play().catch(() => {});
        }

        function resetStoryPointerState(shouldResume = false) {
            if (!storyPointerState) return;
            if (storyPointerState.holdTimer) {
                clearTimeout(storyPointerState.holdTimer);
            }
            const resume = shouldResume && !!storyPointerState.resumeAfterInteraction;
            storyPointerState = null;
            if (resume) {
                resumeCurrentStoryPlayback();
            }
        }

        function storyGestureTargetAllowed(target) {
            if (!target || !target.closest) return false;
            if (target.closest('.story-header, .story-footer, #storyCaption, .story-menu-dropdown, .story-views-modal, input, button')) return false;
            return !!target.closest('.story-content, #storyVideo');
        }

        function syncStoryActionButtons(story) {
            const isOwnStory = String(story?.userId || '') === String(authProfile?.appUserId || '');
            const likeBtn = document.getElementById('storyLikeBtn');
            const sendBtn = document.getElementById('storyCommentSendBtn');
            const inputWrap = document.getElementById('storyCommentInputWrap');
            const input = document.getElementById('storyReplyInput');
            const viewsBtn = document.getElementById('storyViewsBtn');
            if (likeBtn) likeBtn.style.display = isOwnStory ? 'none' : 'flex';
            if (sendBtn) sendBtn.style.display = isOwnStory ? 'none' : 'flex';
            if (inputWrap) inputWrap.style.display = isOwnStory ? 'none' : 'flex';
            if (viewsBtn) viewsBtn.style.display = isOwnStory ? 'flex' : 'none';
            if (input) {
                input.value = '';
                input.placeholder = 'Добавить комментарий...';
            }
        }

        function renderStories() {
            const desktopContainer = document.getElementById('storiesContainer');
            const mobileContainer = document.getElementById('mobileStoriesContainer');
            
            const friends = Array.isArray(friendsState.friends) ? friendsState.friends : [];
            const ownStories = stories.get(authProfile?.appUserId || '') || [];
            
            let html = '';
            
            // Add own stories or upload button
            if (ownStories.length > 0) {
                const hasUnviewedOwn = ownStories.some(story => !storyViewed.has(story.id));
                const latestOwnStory = ownStories[ownStories.length - 1];
                const ownAuthor = getStoryAuthorInfo(latestOwnStory, authProfile?.appUserId || '');
                const ownAvatarHtml = buildStoryAvatarHtml({
                    ...ownAuthor,
                    displayName: ownAuthor.displayName || authProfile?.displayName || authProfile?.name || 'Вы',
                    name: ownAuthor.name || authProfile?.name || 'Вы',
                    avatar: ownAuthor.avatar || authProfile?.avatar || '',
                    initials: ownAuthor.initials || authProfile?.initials || ''
                });
                
                html += `
                    <div class="story-upload-btn-wrapper mobile-right" onclick="openStoryUploadModal()" title="Добавить историю">
                        <div class="story-upload-btn">
                            <i class="fas fa-plus"></i>
                        </div>
                    </div>
                    <div class="story-avatar-wrapper" onclick="openStoryViewer('${escapeHtml(authProfile?.appUserId || '')}')" title="Мои истории">
                        <div class="story-avatar-ring ${hasUnviewedOwn ? '' : 'viewed'}">
                            ${ownAvatarHtml}
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="story-upload-btn-wrapper mobile-right" onclick="openStoryUploadModal()" title="Добавить историю">
                        <div class="story-upload-btn">
                            <i class="fas fa-plus"></i>
                        </div>
                    </div>
                `;
            }
            
            // Add friends with stories
            friends.forEach(friend => {
                const friendStories = stories.get(friend.id) || [];
                if (friendStories.length === 0) return;
                
                const hasUnviewed = friendStories.some(story => !storyViewed.has(story.id));
                const latestStory = friendStories[friendStories.length - 1];
                const author = getStoryAuthorInfo(latestStory, friend.id);
                const avatarHtml = buildStoryAvatarHtml({
                    ...author,
                    displayName: author.displayName || friend.displayName || friend.name || friend.id,
                    name: author.name || friend.name || friend.id,
                    avatar: author.avatar || friend.avatar || '',
                    initials: author.initials || friend.initials || ''
                });
                
                html += `
                    <div class="story-avatar-wrapper" onclick="openStoryViewer('${escapeHtml(friend.id)}')">
                        <div class="story-avatar-ring ${hasUnviewed ? '' : 'viewed'}">
                            ${avatarHtml}
                        </div>
                    </div>
                `;
            });
            
            // Add fallback content if no stories
            if (html === '') {
                html = `
                    <div class="story-avatar-wrapper" onclick="openStoryUploadModal()">
                        <div class="story-add-btn">
                            <i class="fas fa-plus"></i>
                        </div>
                    </div>
                `;
            }
            
            // Update both containers
            if (desktopContainer) desktopContainer.innerHTML = html;
            if (mobileContainer) mobileContainer.innerHTML = html;
        }

        function openStoryViewer(userId, startIndex = 0) {
            const userStories = stories.get(userId) || [];
            if (userStories.length === 0) return;
            
            currentStories = userStories;
            currentStoryIndex = Math.max(0, Math.min(startIndex, userStories.length - 1));
            
            const viewer = document.getElementById('storyViewer');
            viewer.classList.add('active');
            renderStoryProgressSegments();
            
            showStory(currentStoryIndex);
        }

        function showStory(index) {
            if (index < 0 || index >= currentStories.length) {
                closeStoryViewer();
                return;
            }
            
            const story = currentStories[index];
            const video = document.getElementById('storyVideo');
            const userAvatar = document.getElementById('storyUserAvatar');
            const userName = document.getElementById('storyUserName');
            const userTime = document.getElementById('storyTime');
            const caption = document.getElementById('storyCaption');
            const input = document.getElementById('storyReplyInput');
            const likeBtn = document.getElementById('storyLikeBtn');
            const userInfo = document.querySelector('.story-user-info');
            
            // Load user info
            const author = getStoryAuthorInfo(story, story.userId);
            userAvatar.innerHTML = buildStoryAvatarHtml(author);
            userName.textContent = author.displayName || author.name || author.userId;
            userTime.textContent = formatStoryTime(story.createdAt);
            if (userInfo) {
                userInfo.classList.add('story-user-info--clickable');
                userInfo.onclick = (event) => openStoryAuthorProfile(event);
            }
            if (input) input.value = '';
            if (likeBtn) likeBtn.classList.remove('liked');
            syncStoryActionButtons(story);
            renderStoryProgressSegments();
            updateStoryProgressBars(0);
            closeStoryMenu();
            resetStoryPointerState(false);
            
            // Load video with proper error handling
            video.pause();
            video.src = '';
            video.load(); // Reset video
            stopStoryProgressLoop();
            
            // Remove previous error div if exists
            const existingError = video.parentElement.querySelector('.video-error');
            if (existingError) existingError.remove();
            
            // Set video source
            video.src = story.videoUrl;
            video.currentTime = 0;
            video.style.display = 'block';
            
            // Add video event listeners for debugging
            video.onloadstart = () => {
                console.log('Video loading started:', story.videoUrl);
                video.style.display = 'block';
            };
            video.onloadeddata = () => {
                console.log('Video data loaded');
                video.style.display = 'block';
            };
            video.onloadedmetadata = () => {
                console.log('Video metadata loaded, duration:', video.duration);
                video.style.display = 'block';
                syncStoryProgressLoop();
                video.play().catch(e => console.log('Auto-play failed:', e));
            };
            video.onplay = () => syncStoryProgressLoop();
            video.onpause = () => updateStoryProgressBars(
                (Number(video.duration) > 0 && Number(video.currentTime) >= 0)
                    ? Math.max(0, Math.min(1, Number(video.currentTime) / Number(video.duration)))
                    : 0
            );
            video.onended = () => nextStory();
            video.onerror = (e) => {
                console.error('Video error:', e, story.videoUrl);
                // Show error message to user
                video.style.display = 'none';
                stopStoryProgressLoop();
                const errorDiv = document.createElement('div');
                errorDiv.className = 'video-error';
                errorDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; text-align: center; padding: 20px; background: rgba(0,0,0,0.8); border-radius: 8px;';
                errorDiv.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>Ошибка загрузки видео';
                video.parentNode.appendChild(errorDiv);
            };
            
            // Show caption
            caption.textContent = story.caption || '';
            caption.style.display = story.caption ? 'block' : 'none';
            
            // Mark as viewed
            if (!storyViewed.has(story.id)) {
                storyViewed.add(story.id);
                sendMessengerEvent({
                    type: 'messenger-view-story',
                    storyId: story.id
                });
                renderStories(); // Update rings
            }
            
            // Check like status
            sendMessengerEvent({
                type: 'messenger-check-story-like',
                storyId: story.id
            });

            // Play video with better error handling
            video.play().then(() => {
                console.log('Video playing successfully');
            }).catch(err => {
                console.error('Video play error:', err);
                // Try to autoplay after user interaction
                document.addEventListener('click', function playVideo() {
                    video.play().catch(e => console.error('Retry video play error:', e));
                    document.removeEventListener('click', playVideo);
                }, { once: true });
            });
        }

        function nextStory() {
            currentStoryIndex++;
            showStory(currentStoryIndex);
        }

        function prevStory() {
            currentStoryIndex--;
            showStory(currentStoryIndex);
        }

        function closeStoryViewer() {
            const viewer = document.getElementById('storyViewer');
            viewer.classList.remove('active');
            
            const video = document.getElementById('storyVideo');
            video.pause();
            video.src = '';
            stopStoryProgressLoop();
            closeStoryMenu();
            resetStoryPointerState(false);
            
            currentStories = [];
            currentStoryIndex = 0;
        }

        function toggleStoryLike() {
            if (currentStoryIndex >= currentStories.length) return;
            
            const story = currentStories[currentStoryIndex];
            const likeBtn = document.getElementById('storyLikeBtn');
            
            sendMessengerEvent({
                type: 'messenger-like-story',
                storyId: story.id
            });
        }

        function sendStoryComment() {
            if (currentStoryIndex >= currentStories.length) return;
            
            const story = currentStories[currentStoryIndex];
            const input = document.getElementById('storyReplyInput');
            const text = input.value.trim();
            
            if (!text) return;
            sendMessengerEvent({
                type: 'messenger-comment-story',
                storyId: story.id,
                comment: text
            });
        }

        function handleStoryReplyKeypress(event) {
            if (event.key === 'Enter') {
                sendStoryComment();
            }
        }

        function renderStoryPrivacyDropdown(currentVal = 'friends') {
            const safe = ['all', 'friends', 'nobody'].includes(currentVal) ? currentVal : 'friends';
            const labels = { all: '🌍 Все', friends: '👥 Друзья', nobody: '🚫 Никто' };
            const opts = ['all', 'friends', 'nobody']
                .map(v =>
                    `<button type="button" class="privacy-dd-opt ${v === safe ? 'active' : ''}" onclick="setStoryPrivacy('${v}')">${labels[v]}</button>`
                )
                .join('');
            return `<div class="privacy-dd"><button type="button" class="privacy-dd-trigger" onclick="toggleStoryPrivacyDropdown(event)">${labels[safe]} <i class="fas fa-chevron-down"></i></button><div class="privacy-dd-panel">${opts}</div></div>`;
        }

        function setStoryPrivacy(value) {
            window.currentStoryPrivacy = value;
            const dropdown = document.getElementById('storyPrivacyDropdown');
            if (dropdown) {
                dropdown.innerHTML = renderStoryPrivacyDropdown(value);
            }
            // Close all dropdown panels
            document.querySelectorAll('.privacy-dd-panel').forEach((p) => p.classList.remove('open'));
        }

        function toggleStoryPrivacyDropdown(event) {
            if (event) event.stopPropagation();
            const trigger = event.target.closest('.privacy-dd-trigger');
            if (!trigger) return;
            const panel = trigger.nextElementSibling;
            if (!panel) return;
            const willOpen = !panel.classList.contains('open');
            // Close all other dropdown panels
            document.querySelectorAll('.privacy-dd-panel').forEach((p) => p.classList.remove('open'));
            if (willOpen) panel.classList.add('open');
        }

        function openStoryUploadModal() {
            // Remove existing modal if any
            const existingModal = document.getElementById('storyUploadModalOverlay');
            if (existingModal) existingModal.remove();
            
            // Initialize story privacy
            window.currentStoryPrivacy = window.currentStoryPrivacy || 'friends';
            
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id = 'storyUploadModalOverlay';
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
            overlay.style.visibility = 'visible';
            overlay.onclick = (e) => { if (e.target === overlay) closeStoryUploadModal(); };
            
            overlay.innerHTML = `
                <div class="story-upload-modal">
                    <div class="story-upload-modal-header">
                        <h3><i class="fas fa-video" style="margin-right:8px;color:#667eea;"></i>Новая история</h3>
                        <button type="button" class="story-upload-modal-close" onclick="closeStoryUploadModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="story-upload-modal-body">
                        <div>
                            <label for="storyVideoInput">
                                <i class="fas fa-film" style="margin-right:4px;"></i>Видео (макс. 20 секунд)
                            </label>
                            <input type="file" id="storyVideoInput" accept="video/*" onchange="uploadStory()">
                        </div>
                        <div>
                            <label for="storyCaptionInput">
                                <i class="fas fa-comment" style="margin-right:4px;"></i>Подпись (необязательно)
                            </label>
                            <input type="text" id="storyCaptionInput" placeholder="Добавьте подпись..." maxlength="500">
                        </div>
                        <div>
                            <label>
                                <i class="fas fa-eye" style="margin-right:4px;"></i>Кто может видеть
                            </label>
                            <div id="storyPrivacyDropdown">${renderStoryPrivacyDropdown(window.currentStoryPrivacy)}</div>
                        </div>
                        <div id="storyUploadPreview" style="display:none;">
                            <label>
                                <i class="fas fa-play-circle" style="margin-right:4px;"></i>Предпросмотр
                            </label>
                            <video id="storyPreviewVideo" controls></video>
                        </div>
                    </div>
                    <div class="story-upload-modal-footer">
                        <button type="button" class="story-upload-modal-btn" onclick="closeStoryUploadModal()">
                            <i class="fas fa-times" style="margin-right:6px;"></i>Отмена
                        </button>
                        <button type="button" class="story-upload-modal-btn primary" onclick="completeStoryUpload()">
                            <i class="fas fa-paper-plane" style="margin-right:6px;"></i>Опубликовать
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
        }

        function closeStoryUploadModal() {
            const overlay = document.getElementById('storyUploadModalOverlay');
            if (overlay) overlay.remove();
        }

        function uploadStory() {
            const fileInput = document.getElementById('storyVideoInput');
            const file = fileInput.files[0];
            
            if (!file) {
                showNotification('', 'Выберите видео', 'warning');
                return;
            }
            
            if (file.size > 50 * 1024 * 1024) { // 50MB limit
                showNotification('', 'Размер файла не должен превышать 50MB', 'warning');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const videoData = e.target.result;
                const video = document.getElementById('storyPreviewVideo');
                video.src = videoData;
                
                video.onloadedmetadata = function() {
                    if (video.duration > 20) {
                        showNotification('', 'Длительность видео не должна превышать 20 секунд', 'warning');
                        return;
                    }
                    
                    document.getElementById('storyUploadPreview').style.display = 'block';
                };
            };
            reader.readAsDataURL(file);
        }

        function completeStoryUpload() {
            const video = document.getElementById('storyPreviewVideo');
            const caption = document.getElementById('storyCaptionInput').value.trim();
            const privacy = window.currentStoryPrivacy || 'friends';
            const fileInput = document.getElementById('storyVideoInput');
            
            if (!video.src) {
                showNotification('', 'Сначала выберите видео', 'warning');
                return;
            }
            
            // Check video duration (max 20 seconds)
            if (video.duration > 20) {
                showNotification('', 'Видео должно быть не длиннее 20 секунд', 'error');
                return;
            }
            
            // Generate thumbnail from video
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            video.currentTime = 0.1; // Get frame from 0.1s
            
            video.onseeked = function() {
                try {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
                    
                    // Upload story
                    sendMessengerEvent({
                        type: 'messenger-upload-story',
                        videoUrl: video.src,
                        videoMime: fileInput.files[0] ? fileInput.files[0].type : 'video/mp4',
                        durationMs: Math.round(video.duration * 1000),
                        thumbnailUrl,
                        caption,
                        privacy
                    });
                    
                    closeStoryUploadModal();
                    showNotification('', 'История успешно опубликована', 'success');
                } catch (error) {
                    console.error('Error uploading story:', error);
                    showNotification('', 'Ошибка при загрузке истории', 'error');
                }
            };
            
            video.onerror = function() {
                showNotification('', 'Ошибка при обработке видео', 'error');
            };
        }

        function showStoryViewsModal(views) {
            const modal = document.getElementById('storyViewsModal');
            const list = document.getElementById('storyViewsList');
            
            if (!Array.isArray(views) || views.length === 0) {
                list.innerHTML = `<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.7);">Пока нет просмотров</div>`;
                modal.classList.add('active');
                return;
            }

            const html = views.map(view => `
                <div class="story-view-item story-view-item--clickable" onclick="openStoryViewerProfile('${escapeHtml(view.userId || '')}', event)">
                    <div class="story-view-avatar">
                        ${view.avatar 
                            ? `<img src="${escapeHtml(view.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                            : avatarMarkup(view.displayName, '', view.initials || '')
                        }
                    </div>
                    <div class="story-view-info">
                        <div class="story-view-name">
                            ${escapeHtml(view.displayName)}
                            ${view.liked ? '<i class="fas fa-heart story-view-heart"></i>' : ''}
                        </div>
                        <div class="story-view-time">${formatStoryTime(view.viewedAt)}</div>
                        ${view.comment ? `<div class="story-view-comment">${escapeHtml(view.comment)}</div>` : ''}
                    </div>
                </div>
            `).join('');
            
            list.innerHTML = html;
            modal.classList.add('active');
        }

        function closeStoryViewsModal() {
            document.getElementById('storyViewsModal').classList.remove('active');
        }

        function ensureStoryMenuStyle() {
            if (document.getElementById('storyMenuStyle')) return;
            const style = document.createElement('style');
            style.id = 'storyMenuStyle';
            style.textContent = `
                .story-menu-dropdown {
                    position: fixed;
                    background: rgba(0,0,0,0.92);
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.12);
                    padding: 8px 0;
                    min-width: 180px;
                    z-index: 10001;
                    backdrop-filter: blur(12px);
                    box-shadow: 0 16px 36px rgba(0,0,0,0.35);
                }
                .story-menu-item {
                    padding: 12px 16px;
                    color: rgba(255,255,255,0.9);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    font-size: 14px;
                    transition: all 0.2s ease;
                }
                .story-menu-item:hover {
                    background: rgba(255,255,255,0.1);
                    color: white;
                }
                .story-menu-item.danger {
                    color: #ff4458;
                }
                .story-menu-item.danger:hover {
                    background: rgba(255,68,88,0.2);
                }
            `;
            document.head.appendChild(style);
        }

        function toggleStoryMenu(event) {
            if (currentStoryIndex >= currentStories.length) return;
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const story = currentStories[currentStoryIndex];
            const isOwnStory = story.userId === authProfile?.appUserId;
            
            // Remove existing menu
            const existingMenu = document.getElementById('storyMenuDropdown');
            if (existingMenu) {
                existingMenu.remove();
                document.removeEventListener('click', closeStoryMenu, true);
                return;
            }
            ensureStoryMenuStyle();
            
            // Create menu dropdown
            const menu = document.createElement('div');
            menu.id = 'storyMenuDropdown';
            menu.className = 'story-menu-dropdown';
            
            if (isOwnStory) {
                menu.innerHTML = `
                    <div class="story-menu-item" onclick="changeStoryPrivacy(${currentStoryIndex})">
                        <i class="fas fa-lock" style="width: 16px; margin-right: 12px;"></i>
                        Изменить приватность
                    </div>
                    <div class="story-menu-item danger" onclick="deleteStory(${currentStoryIndex})">
                        <i class="fas fa-trash" style="width: 16px; margin-right: 12px;"></i>
                        Удалить
                    </div>
                `;
            } else {
                menu.innerHTML = `
                    <div class="story-menu-item" onclick="reportStory(${currentStoryIndex})">
                        <i class="fas fa-flag" style="width: 16px; margin-right: 12px;"></i>
                        Пожаловаться
                    </div>
                `;
            }
            const btn = event?.currentTarget || document.getElementById('storyMenuBtn');
            const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth - 200, bottom: 40, width: 36 };
            const desiredLeft = Math.min(window.innerWidth - 192, Math.max(12, rect.right - 180));
            menu.style.top = `${rect.bottom + 8}px`;
            menu.style.left = `${desiredLeft}px`;
            document.body.appendChild(menu);
            
            // Close menu when clicking outside
            setTimeout(() => {
                document.addEventListener('click', closeStoryMenu, true);
            }, 100);
        }
        
        function closeStoryMenu(event) {
            if (event && event.target && event.target.closest && event.target.closest('#storyMenuDropdown, #storyMenuBtn')) return;
            const menu = document.getElementById('storyMenuDropdown');
            if (menu) menu.remove();
            document.removeEventListener('click', closeStoryMenu, true);
        }
        
        function showStoryViews(index) {
            if (index >= currentStories.length) return;
            const story = currentStories[index];
            closeStoryMenu();
            sendMessengerEvent({
                type: 'messenger-get-story-views',
                storyId: story.id
            });
        }
        
        function changeStoryPrivacy(index) {
            if (index >= currentStories.length) return;
            const story = currentStories[index];
            closeStoryMenu();
            
            // Create privacy modal
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(12px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10002;
            `;
            
            modal.innerHTML = `
                <div class="story-upload-modal" style="max-width: 400px;">
                    <div class="story-upload-modal-header">
                        <h3>Приватность истории</h3>
                        <button type="button" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="story-upload-modal-body">
                        <div>
                            <label>Кто может видеть</label>
                            <select id="storyPrivacySelect">
                                <option value="all" ${story.privacy === 'all' ? 'selected' : ''}>🌍 Все</option>
                                <option value="friends" ${story.privacy === 'friends' ? 'selected' : ''}>👥 Друзья</option>
                                <option value="nobody" ${story.privacy === 'nobody' ? 'selected' : ''}>🚫 Никто</option>
                            </select>
                        </div>
                    </div>
                    <div class="story-upload-modal-footer">
                        <button type="button" class="story-upload-modal-btn" onclick="this.closest('.modal-overlay').remove()">Отмена</button>
                        <button type="button" class="story-upload-modal-btn primary" onclick="updateStoryPrivacy('${story.id}', this)">Сохранить</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        }
        
        function updateStoryPrivacy(storyId, button) {
            const privacy = document.getElementById('storyPrivacySelect').value;
            sendMessengerEvent({
                type: 'messenger-update-story-privacy',
                storyId,
                privacy
            });
            button.closest('.modal-overlay').remove();
        }
        
        function deleteStory(index) {
            if (index >= currentStories.length) return;
            const story = currentStories[index];
            closeStoryMenu();
            
            if (confirm('Удалить эту историю?')) {
                sendMessengerEvent({
                    type: 'messenger-delete-story',
                    storyId: story.id
                });
                closeStoryViewer();
            }
        }
        
        function reportStory(index) {
            if (index >= currentStories.length) return;
            closeStoryMenu();
            showNotification('', 'Жалоба отправлена', 'success');
        }

        function handleStoryViewerClick(event) {
            // Close if clicking outside content area
            if (event.target && event.target.id === 'storyViewer') {
                closeStoryViewer();
            } else {
                closeStoryMenu(event);
            }
        }

        function handleStoryPointerDown(event) {
            if (!storyGestureTargetAllowed(event.target)) return;
            const video = document.getElementById('storyVideo');
            if (!video) return;
            if (event.cancelable) event.preventDefault();
            storyPointerState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startTime: Number(video.currentTime || 0),
                moved: false,
                scrubbing: false,
                holdActive: false,
                resumeAfterInteraction: !video.paused,
                holdTimer: setTimeout(() => {
                    if (!storyPointerState) return;
                    storyPointerState.holdActive = true;
                    pauseCurrentStoryPlayback();
                }, 160)
            };
        }

        function handleStoryPointerMove(event) {
            if (!storyPointerState || storyPointerState.pointerId !== event.pointerId) return;
            const video = document.getElementById('storyVideo');
            if (!video) return;
            if (event.cancelable) event.preventDefault();
            const dx = event.clientX - storyPointerState.startX;
            const dy = event.clientY - storyPointerState.startY;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                storyPointerState.moved = true;
            }
            if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {
                if (storyPointerState.holdTimer) {
                    clearTimeout(storyPointerState.holdTimer);
                    storyPointerState.holdTimer = null;
                }
                storyPointerState.scrubbing = true;
                pauseCurrentStoryPlayback();
                const duration = Number(video.duration || 0) || Math.max((Number(getCurrentStory()?.durationMs) || 0) / 1000, 0);
                if (duration > 0) {
                    const nextTime = Math.max(0, Math.min(duration, storyPointerState.startTime + dx * 0.05));
                    video.currentTime = nextTime;
                    updateStoryProgressBars(duration > 0 ? nextTime / duration : 0);
                }
            }
        }

        function handleStoryPointerUp(event) {
            if (!storyPointerState || storyPointerState.pointerId !== event.pointerId) return;
            const video = document.getElementById('storyVideo');
            if (event.cancelable) event.preventDefault();
            const dx = event.clientX - storyPointerState.startX;
            const tapAllowed = !storyPointerState.moved && !storyPointerState.scrubbing && !storyPointerState.holdActive && video;
            const tapX = tapAllowed ? event.clientX - video.getBoundingClientRect().left : 0;
            const tapWidth = tapAllowed ? video.getBoundingClientRect().width : 0;
            const shouldResume = storyPointerState.scrubbing || storyPointerState.holdActive;
            resetStoryPointerState(shouldResume);
            if (tapAllowed && tapWidth > 0) {
                if (tapX < tapWidth * 0.35) {
                    prevStory();
                } else if (tapX > tapWidth * 0.65) {
                    nextStory();
                }
            }
        }

        function handleStoryPointerCancel(event) {
            if (!storyPointerState || storyPointerState.pointerId !== event.pointerId) return;
            resetStoryPointerState(true);
        }

        function handleStoryContextMenu(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            return false;
        }

        // Add keyboard navigation
