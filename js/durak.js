        /** Спрайт 1408×768 → 11×4 (128×192). Ряды: пики, крести, черви, буби; рубашка — 11-й столбец, 4-й ряд. */
        function durakCardBgStyle(cardId) {
            let s = String(cardId || '').trim().toLowerCase();
            if (!s) return '';
            s = s.replace(/~\d+$/, '');
            if (s.length < 2) return '';
            const suit = s.slice(-1);
            const head = s.slice(0, -1);
            let rank;
            if (head === '10' || head === 't') rank = 'T';
            else if (head.length === 1) {
                const c = head;
                if (c === 't') rank = 'T';
                else if (/^[6-9]$/.test(c)) rank = c;
                else rank = c.toUpperCase();
            } else return '';
            const order = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
            const col = order.indexOf(rank);
            const suitToRow = { s: 0, c: 1, h: 2, d: 3 };
            const row = suitToRow[suit];
            if (col < 0 || row == null) return '';
            /* 11 колонок в спрайте: индексы карт 0…8 → x = 0%…80%, не 100% (иначе в кадр попадает соседняя клетка) */
            const x = (col * 100) / 10;
            const y = (row * 100) / 3;
            return `background-position:${x}% ${y}%`;
        }

        function durakSuitRu(trumpLetter) {
            const m = { s: 'пики', h: 'червы', d: 'бубны', c: 'крести' };
            return m[trumpLetter] || trumpLetter || '—';
        }

        function sendDurak(obj) {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify(obj));
        }

        function applyDurakFocusMode(on) {
            const callScreen = document.querySelector('.call-screen');
            if (!callScreen) return;
            if (on) {
                callScreen.classList.add('durak-focus');
                callScreen.classList.remove('ui-idle');
                triggerWatchFocusActivity();
            } else {
                callScreen.classList.remove('durak-focus');
            }
        }

        function ensureDurakTopbarLine() {
            const tb = document.getElementById('callTopbar');
            if (!tb || document.getElementById('durakTopbarLine')) return;
            const s = document.createElement('span');
            s.id = 'durakTopbarLine';
            s.className = 'call-timer';
            const badge = tb.querySelector('#roomPrivacyBadge');
            if (badge) tb.insertBefore(s, badge);
            else tb.appendChild(s);
        }

        function onDurakToolbarClick() {
            if (durakGameState) {
                renderDurakUi();
                return;
            }
            showDurakCardPackModal();
        }

        function showDurakCardPackModal() {
            // Remove existing modal if any
            const existingModal = document.getElementById('durakCardPackModal');
            if (existingModal) existingModal.remove();

            const modal = document.createElement('div');
            modal.id = 'durakCardPackModal';
            modal.className = 'modal-overlay';
            modal.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(4, 6, 18, 0.85);
                backdrop-filter: blur(12px);
                animation: fadeIn 0.3s ease;
            `;

            const modalContent = document.createElement('div');
            modalContent.className = 'modal-content';
            modalContent.style.cssText = `
                background: linear-gradient(145deg, rgba(22, 18, 45, 0.95), rgba(12, 14, 28, 0.95));
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 20px;
                padding: 32px 24px;
                max-width: 400px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                animation: slideUp 0.3s ease;
            `;

            modalContent.innerHTML = `
                <h3 style="color: white; font-size: 20px; font-weight: 700; margin-bottom: 12px;">Какими картами будем играть?</h3>
                <p style="color: rgba(255, 255, 255, 0.7); font-size: 14px; margin-bottom: 20px; line-height: 1.4;">Выберите дизайн карт для игры</p>
                
                <div style="display: flex; gap: 20px; justify-content: center; margin-bottom: 24px; position: relative;">
                    <!-- Divider Line -->
                    <div style="position: absolute; left: 50%; top: 5%; bottom: 5%; width: 1px; background: linear-gradient(180deg, transparent, rgba(147, 51, 234, 0.8), transparent); z-index: 4;"></div>
                    
                    <!-- Fantasy Preview -->
                    <div class="fantasy-preview" style="text-align: center; cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.querySelector('.preview-container').style.boxShadow='0 8px 25px rgba(147, 51, 234, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.querySelector('.preview-container').style.boxShadow='0 4px 12px rgba(0,0,0,0.4)';">
                        <div class="preview-container" style="position: relative; width: 100px; height: 140px; margin: 0 auto 8px; transition: box-shadow 0.2s ease;">
                            <div style="position: absolute; inset: -2px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); z-index: 0; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2);"></div>
                            <img src="${resolveAssetUrl('assets/fantasy/spades_A.png')}" style="position: absolute; width: 60px; height: 90px; top: 0; left: 20px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 3; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                            <img src="${resolveAssetUrl('assets/fantasy/hearts_K.png')}" style="position: absolute; width: 60px; height: 90px; top: 25px; left: 10px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 2; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                            <img src="${resolveAssetUrl('assets/fantasy/clubs_10.png')}" style="position: absolute; width: 60px; height: 90px; top: 50px; left: 0; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 1; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                        </div>
                        <div style="color: rgba(255, 255, 255, 0.8); font-size: 14px; font-weight: 600;">
                            <i class="fas fa-dragon" style="margin-right: 6px;"></i>Fantasy
                        </div>
                    </div>
                    
                    <!-- Classic Preview -->
                    <div class="classic-preview" style="text-align: center; cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.querySelector('.preview-container').style.boxShadow='0 8px 25px rgba(34, 197, 94, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.querySelector('.preview-container').style.boxShadow='0 4px 12px rgba(0,0,0,0.4)';">
                        <div class="preview-container" style="position: relative; width: 100px; height: 140px; margin: 0 auto 8px; transition: box-shadow 0.2s ease;">
                            <div style="position: absolute; inset: -2px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); z-index: 0; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2);"></div>
                            <img src="${resolveAssetUrl('assets/classic/spades_A.png')}" style="position: absolute; width: 60px; height: 90px; top: 0; left: 20px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 3; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                            <img src="${resolveAssetUrl('assets/classic/hearts_K.png')}" style="position: absolute; width: 60px; height: 90px; top: 25px; left: 10px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 2; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                            <img src="${resolveAssetUrl('assets/classic/clubs_10.png')}" style="position: absolute; width: 60px; height: 90px; top: 50px; left: 0; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 1; border: 1px solid rgba(255,255,255,0.1);" draggable="false" oncontextmenu="return false;" ondragstart="return false;">
                        </div>
                        <div style="color: rgba(255, 255, 255, 0.8); font-size: 14px; font-weight: 600;">
                            <i class="fas fa-chess" style="margin-right: 6px;"></i>Classic
                        </div>
                    </div>
                </div>
                
            `;

            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            // Add click handlers for previews
            const fantasyPreview = modalContent.querySelector('.fantasy-preview');
            const classicPreview = modalContent.querySelector('.classic-preview');

            fantasyPreview.addEventListener('click', () => {
                durakCardPack = 'fantasy';
                updateDurakCardBackStyle();
                modal.remove();
                sendDurak({ type: 'durak-propose', mode: 'perevodnoy', cardPack: 'fantasy' });
            });

            classicPreview.addEventListener('click', () => {
                durakCardPack = 'classic';
                updateDurakCardBackStyle();
                modal.remove();
                sendDurak({ type: 'durak-propose', mode: 'perevodnoy', cardPack: 'classic' });
            });

            // Close modal on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });

            // Add CSS animations
            const style = document.createElement('style');
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        function ensureDurakControlButton() {
            const screen = document.querySelector('.call-screen');
            if (!screen) return;
            let bar = screen.querySelector('.call-bottom-bar');
            const ctr = screen.querySelector('.controls');
            if (!ctr) return;
            const existingBtn = document.getElementById('durakBtn');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'call-bottom-bar';
                ctr.parentNode.insertBefore(bar, ctr);
                if (existingBtn && ctr.contains(existingBtn)) {
                    ctr.removeChild(existingBtn);
                    bar.appendChild(existingBtn);
                }
                bar.appendChild(ctr);
            } else if (existingBtn && ctr.contains(existingBtn)) {
                bar.insertBefore(existingBtn, ctr);
            }
            if (document.getElementById('durakBtn')) {
                const b = document.getElementById('durakBtn');
                if (!b.onclick) b.onclick = onDurakToolbarClick;
                const ic = b.querySelector('i');
                if (ic && !ic.classList.contains('fa-gamepad')) {
                    ic.className = 'fas fa-gamepad';
                }
                return;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.id = 'durakBtn';
            b.className = 'ctrl-btn';
            b.title = 'Дурак';
            b.innerHTML = '<i class="fas fa-gamepad"></i>';
            b.onclick = onDurakToolbarClick;
            bar.insertBefore(b, bar.firstChild);
        }

        function ensureDurakCallPanelToggle() {
            const bar = document.querySelector('.call-bottom-bar');
            if (!bar || document.getElementById('durakCallPanelToggle')) return;
            const t = document.createElement('button');
            t.type = 'button';
            t.id = 'durakCallPanelToggle';
            t.className = 'durak-call-panel-toggle';
            t.title = 'Панель звонка';
            t.innerHTML = '<i class="fas fa-chevron-up"></i>';
            t.onclick = toggleDurakCallPanel;
            bar.appendChild(t);
        }

        function syncDurakPanelToggleIcon() {
            const csr = document.getElementById('callScreenRoot');
            const btn = document.getElementById('durakCallPanelToggle');
            if (!csr || !btn) return;
            const i = btn.querySelector('i');
            if (!i) return;
            i.className = csr.classList.contains('durak-call-drawer-open') ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        }

        function toggleDurakCallPanel() {
            const csr = document.getElementById('callScreenRoot');
            if (!csr) return;
            csr.classList.toggle('durak-call-drawer-open');
            syncDurakPanelToggleIcon();
            if (typeof triggerWatchFocusActivity === 'function') triggerWatchFocusActivity();
            requestAnimationFrame(() => {
                requestAnimationFrame(updateDurakCallTogglePosition);
            });
        }

        function ensureDurakCallToggleHost() {
            const csr = document.getElementById('callScreenRoot');
            if (!csr) return null;
            let h = document.getElementById('durakCallToggleHost');
            if (!h) {
                h = document.createElement('div');
                h.id = 'durakCallToggleHost';
                h.className = 'durak-call-toggle-host';
                csr.appendChild(h);
            }
            return h;
        }

        function durakNotifyGameEnded(g) {
            if (!g) return;
            const names = g.names || {};
            const w = g.winnerId;
            let body;
            if (w && names[w]) {
                body = `Игра завершена. Победитель: ${String(names[w])}`;
            } else if (w) {
                body = 'Игра завершена. Победитель определён.';
            } else {
                body = 'Игра завершена. Ничья или игра прервана.';
            }
            showNotification('Дурак', body, 'info');
            durakShowEndSplash(g);
        }

        function durakShowEndSplash(g) {
            if (!g || g.phase !== 'ended') return;
            if (window.__durakEndSplashEl) return;
            const csr = document.getElementById('callScreenRoot');
            if (!csr) return;
            const won = !!g.winnerId && String(g.winnerId) === String(myId);
            const names = g.names || {};
            const winnerName = g.winnerId ? names[g.winnerId] : '';
            const el = document.createElement('div');
            el.className = 'durak-end-splash' + (won ? ' is-win' : ' is-loss');
            const icons = won
                ? ['fa-crown', 'fa-trophy', 'fa-star', 'fa-fire', 'fa-bolt']
                : ['fa-frown', 'fa-cloud-rain', 'fa-heart-broken', 'fa-snowflake', 'fa-wind'];
            const iconHtml = icons
                .map((ic, i) => {
                    const ang = (i / icons.length) * Math.PI * 2 - Math.PI / 2;
                    const rad = 130;
                    const ix = Math.round(Math.cos(ang) * rad * (i % 2 ? 0.7 : 1));
                    const iy = Math.round(Math.sin(ang) * rad * 0.7);
                    return `<i class="fas ${ic}" style="--i:${i};--ix:${ix}px;--iy:${iy}px"></i>`;
                })
                .join('');
            el.innerHTML = `
                <div class="durak-end-splash-bg"></div>
                <div class="durak-end-splash-inner">
                    <div class="durak-end-splash-icons">${iconHtml}</div>
                    <div class="durak-end-splash-title">${won ? 'Победа' : 'Поражение'}</div>
                    <div class="durak-end-splash-sub">${winnerName ? 'Победитель: ' + escapeHtml(winnerName) : (won ? 'Вы выиграли!' : 'Игра завершена')}</div>
                </div>`;
            csr.appendChild(el);
            window.__durakEndSplashEl = el;
            setTimeout(() => {
                const cur = window.__durakEndSplashEl;
                if (cur) {
                    cur.classList.add('is-leaving');
                    setTimeout(() => cur.remove(), 500);
                }
                window.__durakEndSplashEl = null;
                if (durakGameState && durakGameState.phase === 'ended') {
                    durakShowResultsWindow(durakGameState);
                }
            }, 4000);
        }

        function durakCloseResultsWindow() {
            if (window.__durakResultsTimer) {
                clearTimeout(window.__durakResultsTimer);
                window.__durakResultsTimer = null;
            }
            const el = window.__durakResultsEl;
            if (el) {
                el.classList.add('is-leaving');
                setTimeout(() => el.remove(), 350);
            }
            window.__durakResultsEl = null;
        }

        function durakShowResultsWindow(g) {
            if (!g || g.phase !== 'ended') return;
            const csr = document.getElementById('callScreenRoot');
            if (!csr) return;
            if (window.__durakResultsEl) return;
            const names = g.names || {};
            const players = g.players || [];
            const winnerId = g.winnerId;
            const endedHands = g.endedHands || {};
            const rows = players
                .map((p) => {
                    const pid = String(p.id);
                    const won = !!winnerId && String(winnerId) === pid;
                    const name = names[p.id] || p.name || 'Игрок';
                    const cards = Array.isArray(endedHands[p.id]) ? endedHands[p.id] : [];
                    let cardsHtml = '';
                    if (cards.length) {
                        cardsHtml = `<div class="durak-results-cards">${cards
                            .map((c) => `<div class="durak-card-face durak-results-card" style="${durakCardFaceStyle(c)}"></div>`)
                            .join('')}</div>`;
                    } else {
                        cardsHtml = '<div class="durak-results-none">Карт не осталось</div>';
                    }
                    const icWin = won ? ' is-win' : '';
                    const icon = won ? 'fa-crown' : cards.length ? 'fa-hand-paper' : 'fa-check';
                    const status = won ? 'Победитель' : cards.length ? `Осталось карт: ${cards.length}` : 'Вышел';
                    return `<div class="durak-results-row${icWin}">
                        <div class="durak-results-ic"><i class="fas ${icon}"></i></div>
                        <div class="durak-results-body">
                            <div class="durak-results-name">${escapeHtml(name)}</div>
                            <div class="durak-results-status">${escapeHtml(status)}</div>
                            ${cardsHtml}
                        </div>
                    </div>`;
                })
                .join('');
            const modal = document.createElement('div');
            modal.className = 'durak-results-modal';
            modal.innerHTML = `<div class="durak-results-modal-card">
                <div class="durak-results-modal-title">Игра завершена</div>
                <div class="durak-results-list">${rows}</div>
                <div class="durak-results-actions">
                    <button type="button" class="durak-btn-primary" id="durakRematchBtn"><i class="fas fa-redo" aria-hidden="true"></i> Сыграть ещё</button>
                    <button type="button" class="durak-btn-secondary" id="durakCloseResultsBtn">Закрыть</button>
                </div>
            </div>`;
            csr.appendChild(modal);
            window.__durakResultsEl = modal;
            const rematchBtn = document.getElementById('durakRematchBtn');
            const closeBtn = document.getElementById('durakCloseResultsBtn');
            if (rematchBtn) {
                rematchBtn.onclick = () => {
                    sendDurak({ type: 'durak-rematch' });
                    durakCloseResultsWindow();
                };
            }
            if (closeBtn) {
                closeBtn.onclick = () => {
                    sendDurak({ type: 'durak-leave' });
                    durakCloseResultsWindow();
                };
            }
            window.__durakResultsTimer = setTimeout(() => {
                if (durakGameState && durakGameState.phase === 'ended') {
                    sendDurak({ type: 'durak-leave' });
                }
                durakCloseResultsWindow();
            }, 20000);
        }

        function updateDurakCallTogglePosition() {
            const host = document.getElementById('durakCallToggleHost');
            const btn = document.getElementById('durakCallPanelToggle');
            if (!host || !btn || !host.contains(btn)) return;
            const pad = 8;
            const bw = 44;
            const bh = 44;
            const gapRightOfTile = 10;
            const gapAboveHand = 8;
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const meTile = document.querySelector('#durakOverlay .durak-player-tile.is-me');
            const handWrap = document.querySelector('#durakOverlay .durak-hand-wrap');
            if (meTile && handWrap) {
                const mt = meTile.getBoundingClientRect();
                const hw = handWrap.getBoundingClientRect();
                let left = mt.right + gapRightOfTile;
                let top = hw.top - gapAboveHand - bh;
                if (vw) {
                    left = Math.max(pad, Math.min(left, vw - bw - pad));
                }
                top = Math.max(pad, top);
                host.style.left = `${Math.round(left)}px`;
                host.style.top = `${Math.round(top)}px`;
                host.style.right = 'auto';
                host.style.bottom = 'auto';
                host.style.transform = 'none';
                return;
            }
            if (!handWrap) {
                host.style.left = 'auto';
                host.style.right = `${pad}px`;
                host.style.top = 'auto';
                host.style.bottom = '108px';
                host.style.transform = 'none';
                return;
            }
            const r = handWrap.getBoundingClientRect();
            let left = r.right - bw - 8;
            if (vw) {
                left = Math.max(pad, Math.min(left, vw - bw - pad));
            }
            const top = r.top - 10 - bh;
            host.style.left = `${Math.round(left)}px`;
            host.style.top = `${Math.round(Math.max(pad, top))}px`;
            host.style.right = 'auto';
            host.style.bottom = 'auto';
            host.style.transform = 'none';
        }

        function placeDurakCallPanelToggle() {
            const btn = document.getElementById('durakCallPanelToggle');
            if (!btn) return;
            const csr = document.getElementById('callScreenRoot');
            const bar = document.querySelector('.call-bottom-bar');
            const host = ensureDurakCallToggleHost();
            if (!bar) return;

            const clearHost = () => {
                if (!host) return;
                host.style.display = 'none';
                host.style.left = '';
                host.style.top = '';
                host.style.right = '';
                host.style.bottom = '';
                host.style.transform = '';
            };
            const resetBtnInline = () => {
                btn.style.position = '';
                btn.style.left = '';
                btn.style.top = '';
            };

            if (!csr || !csr.classList.contains('durak-playing')) {
                clearHost();
                resetBtnInline();
                bar.appendChild(btn);
                return;
            }
            const desktop = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 769px)').matches;
            if (desktop && host) {
                host.style.display = 'block';
                host.appendChild(btn);
                resetBtnInline();
                requestAnimationFrame(() => {
                    requestAnimationFrame(updateDurakCallTogglePosition);
                });
            } else {
                clearHost();
                resetBtnInline();
                bar.appendChild(btn);
            }
        }

        function ensureDurakOverlayDragUi(ov) {
            if (!ov || ov.dataset.durakDragUiBound) return;
            ov.dataset.durakDragUiBound = '1';
            ov.addEventListener(
                'dragstart',
                (e) => {
                    if (!durakGameState || durakGameState.phase !== 'playing') return;
                    const t = e.target;
                    if (!t || !t.classList || !t.classList.contains('durak-card-face') || !t.closest('#durakMyHand')) return;
                    ov.classList.add('durak-dragging-from-hand');
                },
                true
            );
            ov.addEventListener('dragend', () => {
                ov.classList.remove('durak-dragging-from-hand');
                ov.querySelector('.durak-hand-wrap')?.classList.remove('durak-drag-over-return');
                ov.querySelector('#durakTable')?.classList.remove('durak-drag-over-play');
            }, true);
        }

        function syncDurakCallScreenClasses(g) {
            const csr = document.getElementById('callScreenRoot');
            const tgl = document.getElementById('durakCallPanelToggle');
            if (!csr) return;
            if (!g || g.phase !== 'playing') {
                csr.classList.remove('durak-playing', 'durak-call-drawer-open');
                window.__durakDealAnimBattle = undefined;
                if (tgl) tgl.style.display = 'none';
                return;
            }
            csr.classList.add('durak-playing');
            if (tgl) tgl.style.display = '';
            syncDurakPanelToggleIcon();
        }

        const DURAK_RANK_ORDER = { '6': 0, '7': 1, '8': 2, '9': 3, T: 4, J: 5, Q: 6, K: 7, A: 8 };

        function durakParseCardClient(rawId) {
            let s = String(rawId || '').trim().toLowerCase();
            if (!s) return null;
            s = s.replace(/~\d+$/, '');
            if (s.length < 2) return null;
            const suit = s.slice(-1);
            if (!'shdc'.includes(suit)) return null;
            const head = s.slice(0, -1);
            let rank;
            if (head === '10' || head === 't') rank = 'T';
            else if (head.length === 1) {
                const c = head;
                if (c === 't') rank = 'T';
                else if (/^[6-9]$/.test(c)) rank = c;
                else if (/^[jqka]$/i.test(c)) rank = c.toUpperCase();
                else return null;
            } else return null;
            if (DURAK_RANK_ORDER[rank] === undefined) return null;
            return { rank, suit };
        }

        let durakCardPack = 'classic'; // 'classic' or 'fantasy'

        function updateDurakCardBackStyle() {
            // Remove existing card back style if any
            const existingStyle = document.getElementById('durakCardBackStyle');
            if (existingStyle) existingStyle.remove();

            // Add new style with selected pack
            const backUrl = resolveAssetUrl(`assets/${durakCardPack}/back.png`);
            const style = document.createElement('style');
            style.id = 'durakCardBackStyle';
            style.textContent = `
                .durak-card-face {
                    background-image: url('${backUrl}');
                }
                .durak-card-face.back,
                .durak-card-back-layer {
                    background-image: url('${backUrl}');
                }
                .durak-deck-stack .durak-card-back-layer {
                    background-image: url('${backUrl}') !important;
                    background-size: cover;
                    background-position: center center;
                    background-repeat: no-repeat;
                }
            `;
            document.head.appendChild(style);
        }

        function durakCardImageUrl(cardId) {
            const p = durakParseCardClient(cardId);
            if (!p) return '';
            const sm = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
            const sn = sm[p.suit];
            if (!sn) return '';
            const rf = p.rank === 'T' ? '10' : p.rank;
            return resolveAssetUrl(`assets/${durakCardPack}/${sn}_${rf}.png`);
        }

        /** Отдельные PNG в assets (spades_A.png …); иначе спрайт. */
        function durakCardFaceStyle(cardId) {
            const u = durakCardImageUrl(cardId);
            if (u) {
                const esc = u.replace(/'/g, "\\'");
                return `background-image:url('${esc}');background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#1a1528`;
            }
            return durakCardBgStyle(cardId);
        }

        function durakEscapeDataAttr(s) {
            return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        }

        function durakCardKeyForMatch(s) {
            return String(s || '')
                .trim()
                .replace(/~\d+$/, '')
                .toLowerCase();
        }

        function durakFindTableCardFace(ov, cardId) {
            const want = durakCardKeyForMatch(cardId);
            if (!ov || !want) return null;
            const faces = ov.querySelectorAll('#durakTable .durak-card-face[data-durak-card]');
            for (let i = 0; i < faces.length; i++) {
                if (durakCardKeyForMatch(faces[i].getAttribute('data-durak-card')) === want) return faces[i];
            }
            return null;
        }

        /** Сразу после innerHTML: спрятать карты lastPlay на столе до полёта (иначе один кадр «мигания» до rAF). */
        function durakPrepFlyTargetsHidden(ov, g) {
            if (!ov || !g || g.phase !== 'playing' || !g.lastPlay || !g.lastPlay.cards || !g.lastPlay.seq) return;
            if (g.lastPlay.kind === 'take') return;
            if (String(g.lastPlay.by) === String(myId)) return;
            const seen = window.__durakLastPlayAnimSeq || 0;
            if (g.lastPlay.seq <= seen) return;
            g.lastPlay.cards.forEach((cid) => {
                const el = durakFindTableCardFace(ov, cid);
                if (el) el.classList.add('durak-card-fly-target-pending');
            });
        }

        function durakClearFlyTargetsPending(ov, cardIds) {
            if (!ov || !cardIds) return;
            cardIds.forEach((cid) => {
                const el = durakFindTableCardFace(ov, cid);
                if (el) el.classList.remove('durak-card-fly-target-pending');
            });
        }

        function durakFlyNormalizeRect(fr) {
            if (!fr) return null;
            if (typeof fr.left === 'number' && typeof fr.top === 'number' && typeof fr.width === 'number' && typeof fr.height === 'number') {
                return { left: fr.left, top: fr.top, width: fr.width, height: fr.height };
            }
            if (typeof fr.getBoundingClientRect === 'function') return fr.getBoundingClientRect();
            return null;
        }

        function durakAnimateCardFly(fromRect, toEl, bgStyle) {
            const fr = durakFlyNormalizeRect(fromRect);
            if (!fr || fr.width < 4 || fr.height < 4 || !toEl || !bgStyle) return;
            const toRect = toEl.getBoundingClientRect();
            if (toRect.width < 2 || toRect.height < 2) return;
            const fly = document.createElement('div');
            fly.className = 'durak-card-face durak-card-fly-ghost';
            fly.setAttribute('aria-hidden', 'true');
            const w = toRect.width;
            const h = toRect.height;
            fly.style.cssText =
                bgStyle +
                `;position:fixed;left:0;top:0;width:${w}px;height:${h}px;margin:0;border-radius:8px;border:1px solid rgba(255,255,255,0.3);box-shadow:0 16px 44px rgba(0,0,0,0.58);transform-origin:center center;pointer-events:none;z-index:10060;will-change:transform,opacity`;
            document.body.appendChild(fly);
            const startCx = fr.left + fr.width / 2;
            /* Старт от верхней части плитки соперника (.durak-opponents-ring), не от низа —
               иначе линия к столу визуально совпадает с колонкой колоды слева. */
            const startCy = fr.top + Math.max(8, fr.height * 0.28);
            const fx = startCx - w / 2;
            const fy = startCy - h / 2;
            const tx = toRect.left + (toRect.width - w) / 2;
            const ty = toRect.top + (toRect.height - h) / 2;
            toEl.classList.add('durak-card-fly-target-pending');
            let finished = false;
            const cleanup = () => {
                if (finished) return;
                finished = true;
                fly.remove();
                toEl.classList.remove('durak-card-fly-target-pending');
            };
            const durMs = 1100;
            const easing = 'cubic-bezier(0.16, 0.8, 0.14, 1)';
            const run = () => {
                if (typeof fly.animate === 'function') {
                    try {
                        const anim = fly.animate(
                            [
                                { transform: `translate(${fx}px, ${fy}px) scale(0.65) rotate(-12deg)`, opacity: 0.82 },
                                { transform: `translate(${tx}px, ${ty}px) scale(1) rotate(0deg)`, opacity: 1 }
                            ],
                            { duration: durMs, easing, fill: 'forwards' }
                        );
                        anim.onfinish = () => cleanup();
                        setTimeout(cleanup, durMs + 200);
                        return;
                    } catch (e) {
                        /* fall through */
                    }
                }
                fly.style.transition = 'none';
                fly.style.opacity = '0.82';
                fly.style.transform = `translate(${fx}px, ${fy}px) scale(0.65) rotate(-12deg)`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        fly.style.transition = `transform ${durMs}ms ${easing}, opacity ${durMs}ms ease-out`;
                        fly.style.opacity = '1';
                        fly.style.transform = `translate(${tx}px, ${ty}px) scale(1) rotate(0deg)`;
                        fly.addEventListener('transitionend', cleanup, { once: true });
                        setTimeout(cleanup, durMs + 200);
                    });
                });
            };
            requestAnimationFrame(() => requestAnimationFrame(run));
        }

        function durakCardBackCss() {
            const backUrl = resolveAssetUrl(`assets/${durakCardPack}/back.png`);
            return `background-image:url('${backUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#1a1528`;
        }

        function durakFlyCardBackTo(fromRect, toEl) {
            const fr = durakFlyNormalizeRect(fromRect);
            if (!fr || fr.width < 4 || fr.height < 4 || !toEl) return;
            const toRect = toEl.getBoundingClientRect();
            if (toRect.width < 2 || toRect.height < 2) return;
            const fly = document.createElement('div');
            fly.className = 'durak-card-face durak-card-fly-ghost';
            fly.setAttribute('aria-hidden', 'true');
            const w = 42;
            const h = 58;
            fly.style.cssText =
                durakCardBackCss() +
                `;position:fixed;left:0;top:0;width:${w}px;height:${h}px;margin:0;border-radius:8px;border:1px solid rgba(255,255,255,0.28);box-shadow:0 14px 34px rgba(0,0,0,0.5);transform-origin:center center;pointer-events:none;z-index:10050;will-change:transform,opacity`;
            document.body.appendChild(fly);
            const startCx = fr.left + fr.width / 2;
            const startCy = fr.top + fr.height / 2;
            const fx = startCx - w / 2;
            const fy = startCy - h / 2;
            const tx = toRect.left + (toRect.width - w) / 2;
            const ty = toRect.top + (toRect.height - h) / 2;
            const durMs = 420;
            const easing = 'cubic-bezier(0.2, 0.9, 0.2, 1)';
            const run = () => {
                if (typeof fly.animate === 'function') {
                    try {
                        const anim = fly.animate(
                            [
                                { transform: `translate(${fx}px, ${fy}px) scale(0.5) rotate(0deg)`, opacity: 0.92 },
                                { transform: `translate(${tx}px, ${ty}px) scale(0.92) rotate(8deg)`, opacity: 0.86 }
                            ],
                            { duration: durMs, easing, fill: 'forwards' }
                        );
                        anim.onfinish = () => fly.remove();
                        setTimeout(() => fly.remove(), durMs + 180);
                        return;
                    } catch (e) {
                        /* fall through */
                    }
                }
                fly.style.transition = `transform ${durMs}ms ${easing}, opacity ${durMs}ms ease`;
                fly.style.transform = `translate(${tx}px, ${ty}px) scale(0.92) rotate(8deg)`;
                fly.style.opacity = '0.86';
                setTimeout(() => fly.remove(), durMs + 180);
            };
            requestAnimationFrame(() => {
                fly.style.transform = `translate(${fx}px, ${fy}px) scale(0.5) rotate(0deg)`;
                fly.style.opacity = '0.92';
                requestAnimationFrame(run);
            });
        }

        /** Раздача в начале новой партии: колода выезжает в центр, карты летят игрокам. */
        function durakRunDealAnimation(ov, g) {
            if (!ov || !g || g.phase !== 'playing') return;
            const deckStack = ov.querySelector('.durak-deck-stack');
            const board = ov.querySelector('.durak-table-board');
            const deckRect = deckStack ? deckStack.getBoundingClientRect() : null;
            if (!deckRect || deckRect.width < 4) return;
            const nPlayers = (g.players || []).length;
            if (nPlayers < 2) return;
            const handTarget = g.handTarget || 6;
            const stepMs = 85;

            if (board) {
                const br = board.getBoundingClientRect();
                const dx = br.left + br.width / 2 - (deckRect.left + deckRect.width / 2);
                const dy = br.top + br.height / 2 - (deckRect.top + deckRect.height / 2);
                deckStack.style.transition = 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)';
                deckStack.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
                setTimeout(() => {
                    deckStack.style.transition = 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)';
                    deckStack.style.transform = '';
                    setTimeout(() => {
                        deckStack.style.transition = '';
                    }, 820);
                }, 860);
            }

            const tiles = ov.querySelectorAll('.durak-player-tile[data-durak-pid]');
            const tileByPid = {};
            tiles.forEach((t) => {
                tileByPid[String(t.getAttribute('data-durak-pid'))] = t;
            });
            const myPidStr = String(myId || '');

            const hand = document.getElementById('durakMyHand');
            if (hand) {
                const cards = hand.querySelectorAll('.durak-card-face');
                cards.forEach((el, i) => {
                    const delay = i * nPlayers * stepMs + 120;
                    el.style.animation = 'none';
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(34px) scale(0.82)';
                    setTimeout(() => {
                        el.style.transition = 'opacity 0.34s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
                        el.style.opacity = '1';
                        el.style.transform = 'translateY(0) scale(1)';
                    }, delay);
                });
            }

            let step = 0;
            for (let r = 0; r < handTarget; r++) {
                for (const p of g.players || []) {
                    if (String(p.id) === myPidStr) {
                        step++;
                        continue;
                    }
                    const tile = tileByPid[String(p.id)];
                    const delay = step * stepMs + 160;
                    if (tile) {
                        setTimeout(() => durakFlyCardBackTo(deckRect, tile), delay);
                    }
                    step++;
                }
            }
        }

        function durakRunPlayFlyAnimations(ov, g, preCapturedFromRect) {
            if (!ov || !g || g.phase !== 'playing') return;
            const lp = g.lastPlay;
            if (!lp || !lp.by || !Array.isArray(lp.cards) || !lp.cards.length || !lp.seq) return;
            const seen = window.__durakLastPlayAnimSeq || 0;
            if (lp.seq <= seen) return;

            if (lp.kind === 'take') {
                window.__durakLastPlayAnimSeq = lp.seq;
                return;
            }

            if (String(lp.by) === String(myId)) {
                window.__durakLastPlayAnimSeq = lp.seq;
                return;
            }

            const tryLaunch = (fromRect) => {
                const fr = durakFlyNormalizeRect(fromRect);
                if (!fr || fr.width < 4 || fr.height < 4) return false;
                let any = false;
                for (let i = 0; i < lp.cards.length; i++) {
                    if (durakFindTableCardFace(ov, lp.cards[i])) {
                        any = true;
                        break;
                    }
                }
                if (!any) return false;
                window.__durakLastPlayAnimSeq = lp.seq;
                lp.cards.forEach((cid, idx) => {
                    const toEl = durakFindTableCardFace(ov, cid);
                    if (!toEl) return;
                    const st = durakCardFaceStyle(cid);
                    setTimeout(() => durakAnimateCardFly(fr, toEl, st), idx * 120);
                });
                return true;
            };

            const findTileRect = () => {
                const by = String(lp.by);
                const ring = ov.querySelector('.durak-opponents-ring');
                if (!ring) return null;
                const tiles = ring.querySelectorAll('.durak-player-tile[data-durak-pid]');
                for (let i = 0; i < tiles.length; i++) {
                    if (String(tiles[i].getAttribute('data-durak-pid')) === by) {
                        return tiles[i].getBoundingClientRect();
                    }
                }
                return null;
            };

            const run = () => {
                if ((window.__durakLastPlayAnimSeq || 0) >= lp.seq) return;
                const rFresh = findTileRect();
                if (tryLaunch(rFresh)) return;
                if (tryLaunch(preCapturedFromRect)) return;
                window.__durakLastPlayAnimSeq = lp.seq;
                durakClearFlyTargetsPending(ov, lp.cards);
            };

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        run();
                        setTimeout(run, 64);
                    });
                });
            });
        }

        function durakCanBeatClient(attackId, defendId, trumpSuit) {
            const a = durakParseCardClient(attackId);
            const d = durakParseCardClient(defendId);
            if (!a || !d) return false;
            const aTrump = a.suit === trumpSuit;
            const dTrump = d.suit === trumpSuit;
            if (aTrump && dTrump) return DURAK_RANK_ORDER[d.rank] > DURAK_RANK_ORDER[a.rank];
            if (!aTrump && dTrump) return true;
            if (aTrump && !dTrump) return false;
            if (a.suit === d.suit) return DURAK_RANK_ORDER[d.rank] > DURAK_RANK_ORDER[a.rank];
            return false;
        }

        function durakEnsureTransfersClient(row) {
            if (!row || typeof row !== 'object') return [];
            if (Array.isArray(row.transferStack)) return row.transferStack;
            if (row.transferCard) return [{ card: row.transferCard, defense: row.transferDefense || null }];
            return [];
        }

        function durakNextDefendTargetClient(battle) {
            const table = (battle && battle.table) || [];
            for (const row of table) {
                if (!row.defense) return { row, beatAttack: true };
                const ts = durakEnsureTransfersClient(row);
                for (let i = 0; i < ts.length; i++) {
                    if (!ts[i].defense) return { row, beatAttack: false };
                }
            }
            return null;
        }

        function durakEnumerateBeatTargetsClient(battle, defendCardId, trumpSuit) {
            const out = [];
            const table = (battle && battle.table) || [];
            for (const row of table) {
                if (!row.defense && durakCanBeatClient(row.attack, defendCardId, trumpSuit)) {
                    out.push({ row, anchor: row.attack });
                }
                const ts = durakEnsureTransfersClient(row);
                for (let i = 0; i < ts.length; i++) {
                    const t = ts[i];
                    if (!t.defense && durakCanBeatClient(t.card, defendCardId, trumpSuit)) {
                        out.push({ row, anchor: t.card });
                    }
                }
            }
            return out;
        }

        function durakCanTransferOnRowClient(g, row, cardId) {
            if (!g || g.mode !== 'perevodnoy') return false;
            if (row.defense) return false;
            if (row.beatType === 'toss') return false;
            const tr = durakParseCardClient(cardId);
            const lead = durakParseCardClient(row.attack);
            return !!(tr && lead && tr.rank === lead.rank);
        }

        /** Клик/сброс без зоны: нужен явный выбор ряда (несколько целей или побить/перевод). */
        function durakHandPlayNeedsTableChoice(cardId) {
            const g = durakGameState;
            if (!g || !myId || g.battle?.subPhase !== 'defend') return false;
            const pl = g.players || [];
            const defPid = pl[g.defenderIndex] ? pl[g.defenderIndex].id : '';
            if (defPid !== myId) return false;
            const b = g.battle;
            const trump = g.trump;
            const beats = durakEnumerateBeatTargetsClient(b, cardId, trump);
            const xferRows = (b.table || []).filter((row) => durakCanTransferOnRowClient(g, row, cardId));
            if (beats.length > 1) return true;
            if (xferRows.length > 1) return true;
            if (beats.length === 1 && xferRows.length === 1 && xferRows[0] === beats[0].row) {
                const row = beats[0].row;
                const tr = durakParseCardClient(cardId);
                const lead = durakParseCardClient(row.attack);
                if (tr && lead && tr.rank === lead.rank && durakCanBeatClient(row.attack, cardId, trump)) return true;
            }
            if (beats.length === 1 && xferRows.length === 1 && xferRows[0] !== beats[0].row) return true;
            return false;
        }

        function durakPlayCard(cardId, target, against) {
            const action = { type: 'play', card: cardId };
            if (target === 'beat' || target === 'transfer') action.target = target;
            if (against) action.against = against;
            sendDurak({ type: 'durak-action', action });
        }

        function durakDropCardToTarget(card, targetEl) {
            if (!card) return;
            const target = targetEl || null;
            if (target && (target.closest?.('#durakMyHand') || target.closest?.('.durak-hand-wrap'))) {
                window.__durakDragCard = null;
                return;
            }
            const beatEl = target && target.closest ? target.closest('[data-durak-beat-anchor]') : null;
            if (beatEl) {
                durakPlayCard(card, 'beat', beatEl.getAttribute('data-durak-beat-anchor'));
                return;
            }
            const z = target && target.closest ? target.closest('[data-durak-drop]') : null;
            if (z) {
                const drop = z.getAttribute('data-durak-drop');
                const against = z.getAttribute('data-durak-against') || '';
                if (drop === 'transfer') durakPlayCard(card, 'transfer', against || undefined);
                return;
            }
            if (durakHandPlayNeedsTableChoice(card)) {
                showNotification('Дурак', 'Перетащите карту на атакующую карту или в слот перевода', 'info');
                return;
            }
            durakPlayCard(card);
        }

        function durakClearTouchDragUi(ov) {
            try {
                const st = window.__durakTouchDragState;
                if (st && st.ghost && st.ghost.remove) st.ghost.remove();
            } catch (_) {}
            window.__durakTouchDragState = null;
            try { ov?.classList?.remove('durak-dragging-from-hand'); } catch (_) {}
            try { ov?.querySelectorAll?.('[data-durak-drop]')?.forEach((z) => z.classList.remove('durak-drop-hover')); } catch (_) {}
        }

        function durakStartTouchDrag(ov, cardId, touch) {
            if (!ov || !cardId || !touch) return;
            const ghost = document.createElement('div');
            ghost.className = 'durak-card-face durak-card-fly-ghost';
            ghost.style.position = 'fixed';
            ghost.style.zIndex = '2500';
            ghost.style.pointerEvents = 'none';
            ghost.style.width = '68px';
            ghost.style.height = '94px';
            ghost.style.transform = 'translate(-50%, -50%)';
            ghost.style.opacity = '0.94';
            ghost.style.boxShadow = '0 18px 30px rgba(0,0,0,0.42)';
            ghost.style.filter = 'saturate(1.08)';
            const st = durakCardFaceStyle(cardId);
            if (st) ghost.style.cssText += `;${st}`;
            ghost.style.left = `${touch.clientX}px`;
            ghost.style.top = `${touch.clientY}px`;
            document.body.appendChild(ghost);
            window.__durakTouchDragState = { cardId, ghost };
            ov.classList.add('durak-dragging-from-hand');
        }

        function durakMoveTouchDrag(ov, touch) {
            const st = window.__durakTouchDragState;
            if (!st || !touch) return;
            if (st.ghost) {
                st.ghost.style.left = `${touch.clientX}px`;
                st.ghost.style.top = `${touch.clientY}px`;
            }
            ov.querySelectorAll('[data-durak-drop]').forEach((z) => z.classList.remove('durak-drop-hover'));
            const under = document.elementFromPoint(touch.clientX, touch.clientY);
            const drop = under && under.closest ? under.closest('[data-durak-drop]') : null;
            if (drop) drop.classList.add('durak-drop-hover');
        }

        function durakTableDrop(ev) {
            ev.preventDefault();
            const card = ev.dataTransfer?.getData?.('text/plain') || window.__durakDragCard;
            window.__durakDragCard = null;
            durakDropCardToTarget(card, ev.target);
        }

        function durakBeatAnchorAttr(row, defPid, myPid, sub, kind) {
            if (!myPid || defPid !== myPid || sub !== 'defend') return '';
            if (kind === 'attack' && !row.defense) {
                return ` data-durak-beat-anchor="${row.attack}"`;
            }
            return '';
        }

        function durakBeatAnchorTransferCard(row, defPid, myPid, sub, tcard) {
            if (!myPid || defPid !== myPid || sub !== 'defend') return '';
            if (!tcard) return '';
            const slot = durakEnsureTransfersClient(row).find((t) => t.card === tcard);
            if (!slot || slot.defense) return '';
            return ` data-durak-beat-anchor="${tcard}"`;
        }

        function durakHasAnyDefenseOnTableClient(battle) {
            const rows = (battle && battle.table) || [];
            for (const row of rows) {
                if (row.defense) return true;
                const ts = durakEnsureTransfersClient(row);
                for (const t of ts) {
                    if (t.defense) return true;
                }
            }
            return false;
        }

        function durakRowCanTransferFromHand(g, row) {
            if (!g?.myHand?.length) return false;
            const lead = durakParseCardClient(row.attack);
            if (!lead) return false;
            const hasSameRank = g.myHand.some((cid) => {
                const p = durakParseCardClient(cid);
                return p && p.rank === lead.rank;
            });
            if (!hasSameRank) return false;
            const b = g.battle || { table: [] };
            const cap = g.firstDealRules ? 5 : 6;
            const need = durakTotalCardsInAttackPileAfterOneMoreTransferClient(b, row);
            if (need > cap) return false;
            const ni = durakResolveNextDefenderIndexClient(g);
            const np = (g.players || [])[ni];
            const nextDefCount = np && typeof np.cardCount === 'number' ? np.cardCount : 0;
            return nextDefCount >= need;
        }

        function durakResolveNextDefenderIndexClient(g) {
            const players = g?.players || [];
            const n = players.length;
            if (!n) return 0;
            let ni = (((g?.defenderIndex || 0) % n) + 1) % n;
            let steps = 0;
            while (steps < n) {
                const p = players[ni];
                if (p && (p.cardCount || 0) > 0) return ni;
                ni = (ni + 1) % n;
                steps++;
            }
            return (((g?.defenderIndex || 0) % n) + 1) % n;
        }

        function durakTotalCardsInAttackPileAfterOneMoreTransferClient(battle, targetRow) {
            let n = 0;
            const rows = (battle && battle.table) || [];
            for (const row of rows) {
                const ts = durakEnsureTransfersClient(row);
                const addHere = row === targetRow ? 1 : 0;
                if (!row.defense) {
                    n += 1 + ts.length + addHere;
                } else {
                    for (const t of ts) {
                        if (!t.defense) n++;
                    }
                }
            }
            return n;
        }

        function durakTransferSlotBesideRowHtml(g, row, defPid, myPid, sub) {
            if (g.mode !== 'perevodnoy' || !myPid || defPid !== myPid || sub !== 'defend') return '';
            if (durakHasAnyDefenseOnTableClient(g.battle)) return '';
            if (row.defense || row.beatType === 'toss') return '';
            if (!durakRowCanTransferFromHand(g, row)) return '';
            return `<div class="durak-transfer-slot durak-drop-zone" data-durak-drop="transfer" data-durak-against="${row.attack}" title="Перевод"></div>`;
        }

        function renderDurakUi() {
            if (durakUiTickTimer) {
                clearTimeout(durakUiTickTimer);
                durakUiTickTimer = null;
            }
            ensureDurakTopbarLine();
            ensureDurakControlButton();
            ensureDurakCallPanelToggle();
            const vc = document.getElementById('videosContainer');
            if (!vc) return;
            let ov = document.getElementById('durakOverlay');
            if (!durakGameState) {
                window.__durakLastPlayAnimSeq = 0;
                durakCloseResultsWindow();
                if (window.__durakEndSplashEl) {
                    const sp = window.__durakEndSplashEl;
                    sp.remove();
                    window.__durakEndSplashEl = null;
                }
                if (ov) ov.remove();
                applyDurakFocusMode(false);
                syncDurakCallScreenClasses(null);
                const line = document.getElementById('durakTopbarLine');
                if (line) line.textContent = '';
                return;
            }
            const g = durakGameState;
            if (g.phase !== 'ended') {
                durakCloseResultsWindow();
                if (window.__durakEndSplashEl) {
                    const sp = window.__durakEndSplashEl;
                    sp.remove();
                    window.__durakEndSplashEl = null;
                }
            }
            if (g.phase !== 'playing') {
                window.__durakLastPlayAnimSeq = 0;
            }
            applyDurakFocusMode(g.phase === 'lobby' || g.phase === 'playing');
            const line = document.getElementById('durakTopbarLine');
            const starterName = g.names && g.initiatorId ? g.names[g.initiatorId] : (g.players || []).find((p) => p.id === g.initiatorId)?.name || '';
            if (line) {
                if (g.phase === 'lobby') {
                    line.textContent = `${starterName || 'Игрок'} начинает игру`;
                } else if (g.phase === 'playing') {
                    line.textContent = `Козырь: ${durakSuitRu(g.trump)} · в колоде: ${g.deckCount}`;
                } else {
                    line.textContent = g.winnerId ? 'Игра окончена' : 'Игра окончена';
                }
            }
            if (!ov) {
                ov = document.createElement('div');
                ov.id = 'durakOverlay';
                ov.className = 'durak-overlay';
                vc.appendChild(ov);
            }
            const inLobby = g.phase === 'lobby';
            const imIn = (g.players || []).some((p) => p.id === myId);
            const mod = isCreator || isGuestAdmin;
            let html = '<div class="durak-overlay-inner">';
            if (inLobby) {
                const canCancel = mod || g.initiatorId === myId;
                {
                    const names = (g.players || [])
                        .map((p) => String(p?.name || '').trim())
                        .filter(Boolean);
                    const n = names.length;
                    const list = n ? names.join(', ') : '—';
                    html += `<div class="durak-banner">Дурак (${n}): ${escapeHtml(list)}</div>`;
                }
                html += '<div class="durak-lobby-actions">';
                if (!imIn) {
                    html += '<button type="button" id="durakActJoin">Присоединиться</button>';
                } else {
                    html += '<button type="button" id="durakActLeaveLobby">Выйти</button>';
                }
                html += `<button type="button" id="durakActStart" ${(g.players || []).length < 2 ? 'disabled' : ''}>Начать</button>`;
                if (canCancel) html += '<button type="button" id="durakActCancel">Отмена</button>';
                html += '</div>';
            } else if (g.phase === 'playing') {
                const battle = g.battle || { table: [], subPhase: '', attackerPid: '', defenderPid: '' };
                const pl = g.players || [];
                const defPid = pl[g.defenderIndex] ? pl[g.defenderIndex].id : '';
                const attPid = pl[g.attackerIndex] ? pl[g.attackerIndex].id : '';
                const sub = battle.subPhase || '';
                const takeTossLeftSec =
                    sub === 'take_toss' && g.turnDeadline
                        ? Math.max(0, Math.ceil((Number(g.turnDeadline) - Date.now()) / 1000))
                        : 0;
                const mobUi = isMobileLayout();
                const npl = pl.length;
                const defIdx = typeof g.defenderIndex === 'number' ? g.defenderIndex : -1;
                const leftNeighbor = npl > 0 && defIdx >= 0 ? pl[(defIdx - 1 + npl) % npl]?.id || '' : '';
                const rightNeighbor = npl > 0 && defIdx >= 0 ? pl[(defIdx + 1) % npl]?.id || '' : '';
                const donePidSet = new Set([leftNeighbor, rightNeighbor].filter(Boolean));
                const doneEligiblePids = (sub === 'toss' || sub === 'take_toss')
                    ? pl.filter((p) => donePidSet.has(p.id) && Number(p.cardCount || 0) > 0).map((p) => p.id)
                    : [];
                const neighborTossPids =
                    sub === 'defend' && Array.isArray(battle.neighborTossEligiblePids)
                        ? battle.neighborTossEligiblePids.map((x) => String(x))
                        : [];
                const showTakeBtn = defPid === myId && sub === 'defend' && !!durakNextDefendTargetClient(battle);
                const showDoneBtn = doneEligiblePids.includes(myId) && (sub === 'toss' || sub === 'take_toss');
                const doneLabel = sub === 'take_toss' ? `Бито (${takeTossLeftSec})` : 'Бито';
                const sameAtkDef = !!(attPid && defPid && attPid === defPid);
                const others = pl.filter((p) => p.id !== myId);
                const finishOrder = Array.isArray(g.finishOrder) ? g.finishOrder.map((x) => String(x)) : [];
                const placeOf = (pid) => {
                    const i = finishOrder.indexOf(String(pid || ''));
                    return i >= 0 ? i + 1 : 0;
                };
                const placeLabel = (place) => {
                    if (!place) return '';
                    if (place === 1) return '👑';
                    if (place === 2) return '🥈';
                    if (place === 3) return '🥉';
                    return `${place} место`;
                };
                const highlightId = battle.attackerPid || attPid || '';
                const thoughtPid = sub === 'take_toss' ? String(battle.takePid || battle.defenderPid || '') : '';
                let oppHtml = '';
                others.forEach((p) => {
                    const hi = p.id === highlightId ? ' is-highlight' : '';
                    const defenderClass = battle.defenderPid && p.id === battle.defenderPid ? ' is-defender' : '';
                    const tosserClass =
                        (((sub === 'toss' || sub === 'take_toss') && doneEligiblePids.includes(p.id)) ||
                            (sub === 'defend' && neighborTossPids.includes(String(p.id))))
                            ? ' is-tosser'
                            : '';
                    const place = placeOf(p.id);
                    const placeClass = place > 0 && place <= 3 ? ` is-place-${place}` : '';
                    const thought = thoughtPid && String(p.id) === thoughtPid ? '<div class="durak-think-bubble is-bottom">Беру</div>' : '';
                    const roles = [];
                    if (sameAtkDef && battle.defenderPid && p.id === battle.defenderPid) {
                        roles.push('Отбивается');
                    } else {
                        if (battle.defenderPid && p.id === battle.defenderPid) roles.push('Отбивается');
                        if (battle.attackerPid && p.id === battle.attackerPid) roles.push('Ходит');
                        if (
                            ((sub === 'toss' || sub === 'take_toss') && doneEligiblePids.includes(p.id)) ||
                            (sub === 'defend' && neighborTossPids.includes(String(p.id)))
                        ) {
                            if (String(p.id) !== String(battle.defenderPid || '')) roles.push('Подкидывает');
                        }
                    }
                    const roleStr = roles.length ? `<div class="durak-tile-role">${roles.join(' · ')}</div>` : '';
                    const placeBubble = place ? `<div class="durak-place-badge is-bottom">${escapeHtml(placeLabel(place))}</div>` : '';
                    const countText = place ? `${place} место` : `${p.cardCount} карт`;
                    oppHtml += `<div class="durak-player-tile-wrap">${thought}${placeBubble}<div class="durak-player-tile${hi}${defenderClass}${tosserClass}${placeClass}" data-durak-pid="${durakEscapeDataAttr(p.id)}"><div class="durak-tile-name">${escapeHtml(p.name)}</div><div class="durak-tile-count">${countText}</div>${roleStr}</div></div>`;
                });
                const mePl = pl.find((p) => p.id === myId);
                let meRoleLine = '';
                if (mePl) {
                    const mr = [];
                    if (sameAtkDef && battle.defenderPid && mePl.id === battle.defenderPid) mr.push('Отбивается');
                    else {
                        if (battle.defenderPid && mePl.id === battle.defenderPid) mr.push('Отбивается');
                        if (battle.attackerPid && mePl.id === battle.attackerPid) mr.push('Ходит');
                        if (
                            ((sub === 'toss' || sub === 'take_toss') && doneEligiblePids.includes(mePl.id)) ||
                            (sub === 'defend' && neighborTossPids.includes(String(mePl.id)))
                        ) {
                            if (String(mePl.id) !== String(battle.defenderPid || '')) mr.push('Подкидывает');
                        }
                    }
                    if (mr.length) meRoleLine = `<div class="durak-tile-role">${mr.join(' · ')}</div>`;
                }
                const meHi = mePl && highlightId === myId ? ' is-highlight' : '';
                const meDef = mePl && battle.defenderPid && mePl.id === battle.defenderPid ? ' is-defender' : '';
                const meTosser =
                    mePl &&
                    (((sub === 'toss' || sub === 'take_toss') && doneEligiblePids.includes(mePl.id)) ||
                        (sub === 'defend' && neighborTossPids.includes(String(mePl.id))))
                        ? ' is-tosser'
                        : '';
                const meThought = mePl && thoughtPid && String(mePl.id) === thoughtPid ? '<div class="durak-think-bubble">Беру</div>' : '';
                const mePlace = mePl ? placeOf(mePl.id) : 0;
                const mePlaceClass = mePlace > 0 && mePlace <= 3 ? ` is-place-${mePlace}` : '';
                const mePlaceBubble = mePlace ? `<div class="durak-place-badge is-top">${escapeHtml(placeLabel(mePlace))}</div>` : '';
                const meInlineActions =
                    !mobUi && (showTakeBtn || showDoneBtn)
                        ? `<div class="durak-me-inline-actions">${showTakeBtn ? '<button type="button" class="durak-btn-primary" id="durakTake">Беру</button>' : ''}${showDoneBtn ? `<button type="button" class="durak-btn-primary" id="durakDone">${doneLabel}</button>` : ''}</div>`
                        : '';
                const meHtml = mePl
                    ? `<div class="durak-me-strip"><div class="durak-me-tile-row">${meInlineActions}<div class="durak-player-tile-wrap">${meThought}${mePlaceBubble}<div class="durak-player-tile is-me${meHi}${meDef}${meTosser}${mePlaceClass}" data-durak-pid="${durakEscapeDataAttr(mePl.id)}"><div class="durak-tile-name">${escapeHtml(mePl.name)} (вы)</div><div class="durak-tile-count">${mePlace ? `${mePlace} место` : `${mePl.cardCount} карт`}</div>${meRoleLine}</div></div></div></div>`
                    : '';
                const deckN = typeof g.deckCount === 'number' ? g.deckCount : 0;
                const showDeckStack = deckN > 0;
                const trumpSt = g.trumpCard ? durakCardFaceStyle(g.trumpCard) : '';
                html += '<div class="durak-stage">';
                html += `<div class="durak-opponents-ring">${oppHtml}</div>`;
                html += '<div class="durak-middle">';
                html += '<div class="durak-table-board">';
                html += '<div class="durak-deck-column">';
                html += `<div class="durak-deck-count" title="Карт в колоде">${deckN}</div>`;
                if (showDeckStack) {
                    html += '<div class="durak-deck-stack" title="Колода">';
                    html += '<div class="durak-card-face durak-card-back-layer"></div>';
                    html += '<div class="durak-card-face durak-card-back-layer"></div>';
                    html += '<div class="durak-card-face durak-card-back-layer"></div>';
                    html += '</div>';
                } else {
                    html += '<div class="durak-deck-stack durak-deck-empty" title="Колода пуста">';
                    html += '<div class="durak-card-face durak-card-back-layer"></div>';
                    html += '</div>';
                }
                html += '<div class="durak-trump-slot">';
                if (g.trumpCard && trumpSt) {
                    html += '<div class="durak-trump-card-wrap">';
                    html += `<div class="durak-card-face durak-trump-card" style="${trumpSt}"></div>`;
                    html += '</div>';
                }
                html += `<span class="durak-trump-label">Козырь: ${escapeHtml(durakSuitRu(g.trump))}</span>`;
                html += '</div></div>';
                html += '<div class="durak-table" id="durakTable">';
                (battle.table || []).forEach((row) => {
                    const ts = durakEnsureTransfersClient(row);
                    const hasTr = ts.length > 0;
                    const beat = !!row.defense;
                    const aa = durakBeatAnchorAttr(row, defPid, myId, sub, 'attack');
                    const xferSlot = durakTransferSlotBesideRowHtml(g, row, defPid, myId, sub);
                    const beatMarker = xferSlot ? ' data-durak-beatable="1"' : '';
                    html += `<div class="durak-row-pair ${beat ? 'beat' : ''} ${hasTr ? 'transfer' : ''}">`;
                    if (hasTr) {
                        html += '<div class="durak-row-transfer-beat">';
                        html += `<div class="durak-row-with-transfer"><div class="durak-beat-stack">`;
                        html += `<div class="durak-card-face"${aa}${beatMarker} data-durak-card="${durakEscapeDataAttr(row.attack)}" style="${durakCardFaceStyle(row.attack)}"></div>`;
                        if (row.defense) {
                            html += `<div class="durak-card-face def" data-durak-card="${durakEscapeDataAttr(row.defense)}" style="${durakCardFaceStyle(row.defense)}"></div>`;
                        }
                        html += `</div></div><div class="durak-beat-stack">`;
                        for (const t of ts) {
                            const tb = durakBeatAnchorTransferCard(row, defPid, myId, sub, t.card);
                            html += `<div class="durak-card-face"${tb}${beatMarker} data-durak-card="${durakEscapeDataAttr(t.card)}" style="${durakCardFaceStyle(t.card)}"></div>`;
                            if (t.defense) {
                                html += `<div class="durak-card-face transfer-def" data-durak-card="${durakEscapeDataAttr(t.defense)}" style="${durakCardFaceStyle(t.defense)}"></div>`;
                            }
                        }
                        html += `</div>${xferSlot}</div>`;
                    } else {
                        html += `<div class="durak-row-with-transfer"><div class="durak-beat-stack">`;
                        html += `<div class="durak-card-face"${aa}${beatMarker} data-durak-card="${durakEscapeDataAttr(row.attack)}" style="${durakCardFaceStyle(row.attack)}"></div>`;
                        if (row.defense) {
                            html += `<div class="durak-card-face def" data-durak-card="${durakEscapeDataAttr(row.defense)}" style="${durakCardFaceStyle(row.defense)}"></div>`;
                        }
                        html += `</div>${xferSlot}</div>`;
                    }
                    html += '</div>';
                });
                html += '</div></div></div>';
                html += '<div class="durak-bottom-panel">';
                html += meHtml;
                html += '<div class="durak-actions-hand-row">';
                html += '<div class="durak-actions-col">';
                if (mobUi && showTakeBtn) {
                    html += '<button type="button" class="durak-btn-primary" id="durakTake">Беру</button>';
                }
                if (mobUi && showDoneBtn) {
                    html += `<button type="button" class="durak-btn-primary" id="durakDone">${doneLabel}</button>`;
                }
                html +=
                    '<button type="button" class="durak-btn-icon" id="durakLeaveGame" title="Выйти из игры" aria-label="Выйти из игры"><i class="fas fa-sign-out-alt" aria-hidden="true"></i><span class="durak-btn-icon-label">Выйти</span></button>';
                if (mod) {
                    html +=
                        '<button type="button" class="durak-btn-icon" id="durakEndGame" title="Завершить для всех" aria-label="Завершить для всех"><i class="fas fa-flag-checkered" aria-hidden="true"></i><span class="durak-btn-icon-label">Завершить</span></button>';
                }
                html += '</div>';
                const handMob = mobUi;
                const tossHint = sub === 'take_toss' && showDoneBtn ? ' is-toss-hint' : '';
                html += `<div class="durak-hand-wrap${tossHint}"><div class="durak-hand${handMob ? ' durak-hand-mobile' : ''}" id="durakMyHand">`;
                (g.myHand || []).forEach((cid, idx) => {
                    const st = durakCardFaceStyle(cid);
                    html += `<div class="durak-card-face" draggable="true" data-card="${cid}" style="${st};--deal-i:${idx}" ondragstart="event.dataTransfer.setData('text/plain','${cid}');window.__durakDragCard='${cid}'"></div>`;
                });
                html += '</div></div></div></div>';
                html += '</div>';
            } else if (g.phase === 'ended') {
                html += '<div class="durak-banner">Игра завершена</div>';
                html += '<div class="durak-lobby-actions"><button type="button" id="durakCloseEnded">Закрыть</button></div>';
            }
            html += '</div>';
            const callBarPre = document.querySelector('.call-bottom-bar');
            const togglePre = document.getElementById('durakCallPanelToggle');
            if (ov && callBarPre && togglePre && ov.contains(togglePre)) {
                callBarPre.appendChild(togglePre);
            }
            let durakFlyFromRectSnap = null;
            if (g.phase === 'playing' && ov && g.lastPlay && g.lastPlay.seq && g.lastPlay.cards && g.lastPlay.cards.length) {
                const seenFly = window.__durakLastPlayAnimSeq || 0;
                if (g.lastPlay.seq > seenFly && g.lastPlay.kind !== 'take' && String(g.lastPlay.by) !== String(myId)) {
                    const byFly = String(g.lastPlay.by);
                    const prevRing = ov.querySelector('.durak-opponents-ring');
                    if (prevRing) {
                        const prevTiles = prevRing.querySelectorAll('.durak-player-tile[data-durak-pid]');
                        for (let fi = 0; fi < prevTiles.length; fi++) {
                            if (String(prevTiles[fi].getAttribute('data-durak-pid')) === byFly) {
                                const pr = prevTiles[fi].getBoundingClientRect();
                                if (pr.width >= 4 && pr.height >= 4) {
                                    durakFlyFromRectSnap = { left: pr.left, top: pr.top, width: pr.width, height: pr.height };
                                }
                                break;
                            }
                        }
                    }
                }
            }
            ov.innerHTML = html;
            durakPrepFlyTargetsHidden(ov, g);
            ensureDurakCallPanelToggle();
            ov.style.display = '';
            ensureDurakOverlayDragUi(ov);
            const bind = (id, fn) => {
                const el = document.getElementById(id);
                if (el) el.onclick = fn;
            };
            bind('durakActJoin', () => sendDurak({ type: 'durak-join' }));
            bind('durakActLeaveLobby', () => sendDurak({ type: 'durak-leave' }));
            bind('durakActStart', () => sendDurak({ type: 'durak-start', force: false }));
            bind('durakActCancel', () => sendDurak({ type: 'durak-cancel' }));
            bind('durakTake', () => sendDurak({ type: 'durak-action', action: { type: 'take' } }));
            bind('durakDone', () => sendDurak({ type: 'durak-action', action: { type: 'done' } }));
            bind('durakEndGame', () => sendDurak({ type: 'durak-end' }));
            bind('durakLeaveGame', () => sendDurak({ type: 'durak-leave' }));
            bind('durakCloseEnded', () => {
                sendDurak({ type: 'durak-leave' });
            });
            document.querySelectorAll('#durakMyHand .durak-card-face').forEach((el) => {
                el.addEventListener('click', () => {
                    const c = el.getAttribute('data-card');
                    if (durakHandPlayNeedsTableChoice(c)) {
                        showNotification('Дурак', 'Перетащите карту на атакующую карту или в слот перевода', 'info');
                        return;
                    }
                    durakPlayCard(c);
                });
                // Mobile: drag without long-press (touch-drag starts immediately).
                el.addEventListener('touchstart', (e) => {
                    const c = el.getAttribute('data-card');
                    if (!c) return;
                    window.__durakTouchTouchMeta = {
                        card: c,
                        sx: e.touches?.[0]?.clientX || 0,
                        sy: e.touches?.[0]?.clientY || 0,
                        dragging: false,
                        scrolling: false
                    };
                }, { passive: true });
                el.addEventListener('touchmove', (e) => {
                    const meta = window.__durakTouchTouchMeta;
                    const touch = e.touches && e.touches[0];
                    if (!touch) return;
                    if (!meta) return;
                    const dx = touch.clientX - (meta.sx || 0);
                    const dy = touch.clientY - (meta.sy || 0);
                    // Горизонтальный свайп по руке — это скролл списка карт.
                    if (!meta.dragging && !meta.scrolling && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                        meta.scrolling = true;
                    }
                    if (meta.scrolling) return;
                    // Вертикальный/диагональный сдвиг — старт drag сразу, без long-press.
                    if (!meta.dragging && (Math.abs(dy) > 8 || Math.abs(dx) + Math.abs(dy) > 18)) {
                        meta.dragging = true;
                        window.__durakDragCard = meta.card;
                        durakStartTouchDrag(ov, meta.card, touch);
                    }
                    if (meta.dragging) {
                        durakMoveTouchDrag(ov, touch);
                        e.preventDefault();
                    }
                }, { passive: false });
                el.addEventListener('touchend', (e) => {
                    const meta = window.__durakTouchTouchMeta;
                    window.__durakTouchTouchMeta = null;
                    const card = window.__durakDragCard;
                    window.__durakDragCard = null;
                    const t = e.changedTouches && e.changedTouches[0];
                    const target = t ? document.elementFromPoint(t.clientX, t.clientY) : null;
                    if (meta && meta.dragging) {
                        durakDropCardToTarget(card || meta.card, target);
                        durakClearTouchDragUi(ov);
                        e.preventDefault();
                    }
                }, { passive: false });
                el.addEventListener('touchcancel', () => {
                    window.__durakTouchTouchMeta = null;
                    window.__durakDragCard = null;
                    durakClearTouchDragUi(ov);
                }, { passive: true });
            });
            ov.ondragover = (e) => {
                e.preventDefault();
                if (!ov.classList.contains('durak-dragging-from-hand')) return;
                const handEl = ov.querySelector('.durak-hand-wrap');
                const tableEl = ov.querySelector('#durakTable');
                const overHand = e.target.closest?.('.durak-hand-wrap');
                const overTable = e.target.closest?.('#durakTable');
                const dt = e.dataTransfer;
                if (overHand && handEl) {
                    if (dt) dt.dropEffect = 'copy';
                    handEl.classList.add('durak-drag-over-return');
                    tableEl?.classList.remove('durak-drag-over-play');
                } else if (overTable && tableEl) {
                    if (dt) dt.dropEffect = 'move';
                    tableEl.classList.add('durak-drag-over-play');
                    handEl?.classList.remove('durak-drag-over-return');
                } else {
                    handEl?.classList.remove('durak-drag-over-return');
                    tableEl?.classList.remove('durak-drag-over-play');
                }
            };
            ov.ondrop = durakTableDrop;
            ov.querySelectorAll('[data-durak-drop]').forEach((z) => {
                z.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    z.classList.add('durak-drop-hover');
                });
                z.addEventListener('dragleave', () => z.classList.remove('durak-drop-hover'));
            });
            syncDurakCallScreenClasses(g);
            placeDurakCallPanelToggle();
            if (g.phase === 'playing') {
                const hand = document.getElementById('durakMyHand');
                const bf = typeof g.battlesFinished === 'number' ? g.battlesFinished : 0;
                if (hand && window.__durakDealAnimBattle !== bf) {
                    window.__durakDealAnimBattle = bf;
                    hand.classList.remove('durak-deal-anim');
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            hand.classList.add('durak-deal-anim');
                            setTimeout(() => hand.classList.remove('durak-deal-anim'), 780);
                        });
                    });
                    if (bf === 0 && !!g.firstDealRules) {
                        durakRunDealAnimation(ov, g);
                    }
                }
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => durakRunPlayFlyAnimations(ov, g, durakFlyFromRectSnap));
                });
            } else {
                window.__durakDealAnimBattle = undefined;
            }
            updateEmptyState();
            if (g.phase === 'playing' && g.battle && g.battle.subPhase === 'take_toss') {
                const tickDoneLabel = () => {
                    if (!durakGameState || durakGameState.phase !== 'playing') return;
                    const b = durakGameState.battle || {};
                    if (b.subPhase !== 'take_toss') return;
                    const left = Math.max(0, Math.ceil((Number(durakGameState.turnDeadline || 0) - Date.now()) / 1000));
                    const btn = document.getElementById('durakDone');
                    if (btn) btn.textContent = `Бито (${left})`;
                    if (left <= 0) return;
                    durakUiTickTimer = setTimeout(tickDoneLabel, 300);
                };
                durakUiTickTimer = setTimeout(tickDoneLabel, 300);
            }
        }

