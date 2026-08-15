(function () {
    'use strict';

    var AUTH_API_HOSTS = (function () {
        var list = [];
        var push = function (value) {
            var s = String(value || '').trim();
            if (!s || list.indexOf(s) !== -1) return;
            list.push(s);
        };
        try {
            var saved = String(localStorage.getItem('seych-auth-api-url') || '').trim();
            if (saved) push(saved);
        } catch (_) {}
        if (typeof WS_ORIGIN !== 'undefined' && WS_ORIGIN) push(WS_ORIGIN + '/auth');
        if (typeof API_BASE !== 'undefined' && API_BASE) push(API_BASE + '/backend/auth_api.php');
        return list;
    })();

    var currentTab = isMobileDevice() ? 'login' : 'qr';
    var regStep = 0;
    var regData = {};
    var qrToken = '';
    var qrPollTimer = null;
    var qrCountdownTimer = null;
    var qrExpiresAt = 0;
    var scannerStream = null;
    var scannerFrame = null;

    function isMobileDevice() {
        try {
            if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || '')) return true;
            return (window.innerWidth || 0) < 760;
        } catch (_) {
            return false;
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function qs(selector) {
        return document.querySelector(selector);
    }

    function debounce(fn, ms) {
        var timer = null;
        return function () {
            var args = arguments;
            var self = this;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(self, args);
            }, ms);
        };
    }

    function authApi(action, payload) {
        var requestBody = { action: action };
        if (payload && typeof payload === 'object') {
            Object.keys(payload).forEach(function (key) {
                requestBody[key] = payload[key];
            });
        }
        return (async function () {
            var lastErr = null;
            for (var i = 0; i < AUTH_API_HOSTS.length; i++) {
                var apiUrl = AUTH_API_HOSTS[i];
                try {
                    var response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    var rawText = await response.text();
                    var data = null;
                    try {
                        data = rawText ? JSON.parse(rawText) : null;
                    } catch (_) {
                        if (/^\s*</.test(String(rawText || ''))) throw new Error('Сервер вернул HTML вместо JSON');
                        throw new Error(rawText ? 'Некорректный ответ сервера' : 'Пустой ответ сервера');
                    }
                    if (!data || !data.success) {
                        var err = new Error((data && data.error) || 'Ошибка сервера');
                        err.serverError = true;
                        throw err;
                    }
                    if (i > 0 && apiUrl !== AUTH_API_HOSTS[0]) {
                        try {
                            localStorage.setItem('seych-auth-api-url', apiUrl);
                        } catch (_) {}
                    }
                    return data.data || {};
                } catch (err) {
                    lastErr = err;
                    if (err.serverError) break;
                }
            }
            throw lastErr || new Error('Сервер недоступен');
        })();
    }

    function render() {
        document.getElementById('app').innerHTML = [
            '<div class="main-screen main-screen--auth">',
            '    <div class="gradient-bg"></div>',
            '    <div class="authw-wrap">',
            '        <div class="authw-brand"><img src="' + getAssetPath('upload/icon.jpg') + '" alt="Seych"><span>Seych</span></div>',
            '        <div class="authw-tabs" role="tablist">',
            '            <button type="button" class="authw-tab" data-authw-tab="login" role="tab">Вход</button>',
            '            <button type="button" class="authw-tab" data-authw-tab="register" role="tab">Регистрация</button>',
            '            <button type="button" class="authw-tab" data-authw-tab="qr" role="tab">Вход по QR</button>',
            '        </div>',
            '        <div class="authw-body">',
            '            <div class="authw-pane authw-pane--login" data-authw-pane="login"></div>',
            '            <div class="authw-pane authw-pane--register" data-authw-pane="register"></div>',
            '            <div class="authw-pane authw-pane--qr" data-authw-pane="qr"></div>',
            '        </div>',
            '        <div class="authw-social">',
            '            <div class="authw-social-title">Вход через соцсети</div>',
            '            <div class="authw-social-row">',
            '                <div class="authw-social-tg" id="telegramAuthWidget"></div>',
            '                <button type="button" class="authw-social-btn authw-social-btn--google" onclick="startGoogleAuth()"><i class="fab fa-google"></i> Google</button>',
            '                <div class="authw-social-vk" id="vkAuthWidget"></div>',
            '            </div>',
            '        </div>',
            '    </div>',
            '</div>'
        ].join('\n');

        renderLoginPane();
        renderRegisterPane();
        renderQrPane();
        setTab(currentTab);

        try {
            if (typeof renderTelegramWidget === 'function') renderTelegramWidget();
            if (typeof renderVkIdWidget === 'function') renderVkIdWidget();
        } catch (_) {}

        var tabs = document.querySelectorAll('[data-authw-tab]');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function () {
                setTab(this.getAttribute('data-authw-tab'));
            });
        }
    }

    function getAssetPath(rel) {
        try {
            if (typeof getBasePath === 'function') {
                var base = getBasePath().replace(/\/$/, '');
                return base + '/' + String(rel || '').replace(/^\/+/, '');
            }
        } catch (_) {}
        return '/' + String(rel || '').replace(/^\/+/, '');
    }

    function setTab(tab) {
        currentTab = tab;
        var tabs = document.querySelectorAll('[data-authw-tab]');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-authw-tab') === tab);
        }
        var panes = document.querySelectorAll('[data-authw-pane]');
        for (var j = 0; j < panes.length; j++) {
            panes[j].classList.toggle('active', panes[j].getAttribute('data-authw-pane') === tab);
        }
        if (tab === 'qr') {
            startQrFlow();
        } else {
            stopQrFlow();
        }
    }

    function setPaneMessage(paneSel, kind, text) {
        var el = document.querySelector(paneSel + ' .authw-form-message');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'authw-form-message' + (kind ? ' authw-form-message--' + kind : '');
    }

    function setBtnLoading(btn, loading, text) {
        if (!btn) return;
        btn.disabled = !!loading;
        btn.classList.toggle('authw-btn--loading', !!loading);
        if (loading && text) btn.setAttribute('data-authw-text', btn.textContent);
        if (loading) {
            btn.textContent = '';
            var spin = document.createElement('i');
            spin.className = 'fas fa-spinner fa-spin';
            btn.appendChild(spin);
        } else if (btn.getAttribute('data-authw-text')) {
            btn.textContent = btn.getAttribute('data-authw-text');
        }
    }

    /* ===================== ВХОД ===================== */

    function renderLoginPane() {
        var pane = document.querySelector('[data-authw-pane="login"]');
        if (!pane) return;
        pane.innerHTML = [
            '<div class="authw-form">',
            '    <h2 class="authw-title">С возвращением!</h2>',
            '    <p class="authw-subtitle">Войдите в аккаунт Seych</p>',
            '    <label class="authw-field">',
            '        <span class="authw-label">Логин</span>',
            '        <input type="text" id="authwLoginUsername" class="authw-input" placeholder="username" autocomplete="username" autocapitalize="off">',
            '    </label>',
            '    <label class="authw-field">',
            '        <span class="authw-label">Пароль</span>',
            '        <div class="authw-input-wrap">',
            '            <input type="password" id="authwLoginPassword" class="authw-input" placeholder="••••••••" autocomplete="current-password">',
            '            <button type="button" class="authw-eye" data-authw-eye="authwLoginPassword" aria-label="Показать пароль"><i class="fas fa-eye"></i></button>',
            '        </div>',
            '    </label>',
            '    <div class="authw-form-message"></div>',
            '    <button type="button" id="authwLoginSubmit" class="authw-btn authw-btn--primary">Войти</button>',
            '    <button type="button" class="authw-link-btn" data-authw-goto="qr">Войти по QR-коду с телефона</button>',
            '</div>'
        ].join('');

        pane.querySelector('[data-authw-eye="authwLoginPassword"]').addEventListener('click', function () {
            togglePasswordVisibility('authwLoginPassword', this);
        });
        pane.querySelector('[data-authw-goto="qr"]').addEventListener('click', function () {
            setTab('qr');
        });
        pane.querySelector('#authwLoginSubmit').addEventListener('click', submitLogin);
        pane.querySelector('#authwLoginPassword').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submitLogin();
        });
        pane.querySelector('#authwLoginUsername').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submitLogin();
        });
    }

    function togglePasswordVisibility(inputId, btn) {
        var input = document.getElementById(inputId);
        if (!input) return;
        var isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    }

    function submitLogin() {
        var username = String(document.getElementById('authwLoginUsername')?.value || '').trim();
        var password = document.getElementById('authwLoginPassword')?.value || '';
        var btn = document.getElementById('authwLoginSubmit');
        if (!username || !password) {
            setPaneMessage('[data-authw-pane="login"]', 'error', 'Заполните логин и пароль');
            return;
        }
        setPaneMessage('[data-authw-pane="login"]', '', '');
        setBtnLoading(btn, true);
        authApi('login', { username: username, password: password })
            .then(function (data) {
                var profile = {
                    provider: 'seych',
                    name: data.name || username,
                    username: data.username || username,
                    email: data.email || '',
                    avatar: data.avatar || '',
                    appUserId: data.appUserId || '',
                    login: username
                };
                finishAuth(profile);
            })
            .catch(function (err) {
                setPaneMessage('[data-authw-pane="login"]', 'error', (err && err.message) || 'Не удалось войти');
                setBtnLoading(btn, false);
            });
    }

    /* ===================== РЕГИСТРАЦИЯ ===================== */

    var REG_STEPS = [
        { key: 'name', title: 'Как вас зовут?', subtitle: 'Как к вам обращаться в Seych' },
        { key: 'email', title: 'Почта', subtitle: 'Email для восстановления (необязательно)' },
        { key: 'username', title: 'Придумайте username', subtitle: 'По нему вас найдут друзья: @username' },
        { key: 'password', title: 'Придумайте пароль', subtitle: 'Не короче 6 символов' },
        { key: 'passwordRepeat', title: 'Повторите пароль', subtitle: 'Для надёжности' },
        { key: 'avatar', title: 'Загрузите аватар', subtitle: 'Последний шаг!' }
    ];

    function renderRegisterPane() {
        var pane = document.querySelector('[data-authw-pane="register"]');
        if (!pane) return;
        pane.innerHTML = [
            '<div class="authw-form authw-form--register">',
            '    <div class="authw-reg-top">',
            '        <button type="button" class="authw-back" id="authwRegBack" aria-label="Назад"><i class="fas fa-arrow-left"></i></button>',
            '        <div class="authw-steps" id="authwRegStepsBar" role="tablist"></div>',
            '    </div>',
            '    <div class="authw-reg-steps" id="authwRegSteps"></div>',
            '</div>'
        ].join('');
        document.getElementById('authwRegBack').addEventListener('click', regGoBack);
        renderRegStep(0, true);
    }

    function regGoBack() {
        if (regStep > 0) {
            renderRegStep(regStep - 1, false);
        }
    }

    function regGoNext() {
        if (!validateRegStep(regStep)) return;
        if (regStep < REG_STEPS.length - 1) {
            renderRegStep(regStep + 1, true);
        }
    }

    function renderRegStep(step, forward) {
        regStep = step;
        var container = document.getElementById('authwRegSteps');
        if (!container) return;
        var stepDef = REG_STEPS[step];

        var bar = document.getElementById('authwRegStepsBar');
        if (bar) {
            var barHtml = '';
            for (var i = 0; i < REG_STEPS.length; i++) {
                var cls = i < step ? 'done' : (i === step ? 'current' : '');
                barHtml += '<div class="authw-step' + (cls ? ' authw-step--' + cls : '') + '" data-authw-step="' + i + '" role="tab" title="' + escapeHtml(REG_STEPS[i].title) + '">' + (i < step ? '<i class="fas fa-check"></i>' : (i + 1)) + '</div>';
                if (i < REG_STEPS.length - 1) {
                    barHtml += '<div class="authw-step-line' + (i < step ? ' authw-step-line--done' : '') + '"></div>';
                }
            }
            bar.innerHTML = barHtml;
            var dots = bar.querySelectorAll('[data-authw-step]');
            for (var d = 0; d < dots.length; d++) {
                dots[d].addEventListener('click', (function (target) {
                    return function () {
                        if (target < regStep) renderRegStep(target, false);
                    };
                })(parseInt(dots[d].getAttribute('data-authw-step'), 10)));
            }
        }

        var html = '';
        if (step === 0) {
            html = [
                '<h2 class="authw-title">' + escapeHtml(stepDef.title) + '</h2>',
                '<p class="authw-subtitle">' + escapeHtml(stepDef.subtitle) + '</p>',
                '<label class="authw-field">',
                '    <div class="authw-input-wrap">',
                '        <i class="fas fa-user authw-input-icon"></i>',
                '        <input type="text" id="authwRegName" class="authw-input" placeholder="Иван" autocomplete="name" value="' + escapeHtml(regData.name || '') + '">',
                '    </div>',
                '</label>',
                '<div class="authw-form-message"></div>',
                '<button type="button" class="authw-btn authw-btn--primary" data-authw-next>Далее</button>'
            ].join('');
        } else if (step === 1) {
            html = [
                '<h2 class="authw-title">' + escapeHtml(stepDef.title) + '</h2>',
                '<p class="authw-subtitle">' + escapeHtml(stepDef.subtitle) + '</p>',
                '<label class="authw-field">',
                '    <div class="authw-input-wrap">',
                '        <i class="fas fa-envelope authw-input-icon"></i>',
                '        <input type="email" id="authwRegEmail" class="authw-input" placeholder="you@example.com" autocomplete="email" inputmode="email" value="' + escapeHtml(regData.email || '') + '">',
                '    </div>',
                '</label>',
                '<div class="authw-form-message"></div>',
                '<button type="button" class="authw-btn authw-btn--primary" data-authw-next>Далее</button>'
            ].join('');
        } else if (step === 2) {
            html = [
                '<h2 class="authw-title">' + escapeHtml(stepDef.title) + '</h2>',
                '<p class="authw-subtitle">' + escapeHtml(stepDef.subtitle) + '</p>',
                '<label class="authw-field">',
                '    <div class="authw-input-wrap">',
                '        <i class="fas fa-at authw-input-icon"></i>',
                '        <input type="text" id="authwRegUsername" class="authw-input" placeholder="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + escapeHtml(regData.username || '') + '">',
                '    </div>',
                '    <div class="authw-hint" id="authwRegUsernameHint"></div>',
                '</label>',
                '<div class="authw-form-message"></div>',
                '<button type="button" class="authw-btn authw-btn--primary" data-authw-next>Далее</button>'
            ].join('');
        } else if (step === 3 || step === 4) {
            var isRepeat = step === 4;
            var id = isRepeat ? 'authwRegPasswordRepeat' : 'authwRegPassword';
            html = [
                '<h2 class="authw-title">' + escapeHtml(stepDef.title) + '</h2>',
                '<p class="authw-subtitle">' + escapeHtml(stepDef.subtitle) + '</p>',
                '<label class="authw-field">',
                '    <div class="authw-input-wrap">',
                '        <i class="fas fa-lock authw-input-icon"></i>',
                '        <input type="password" id="' + id + '" class="authw-input" placeholder="••••••••" autocomplete="new-password">',
                '        <button type="button" class="authw-eye" data-authw-eye="' + id + '" aria-label="Показать пароль"><i class="fas fa-eye"></i></button>',
                '    </div>',
                '</label>',
                '<div class="authw-form-message"></div>',
                '<button type="button" class="authw-btn authw-btn--primary" data-authw-next>Далее</button>'
            ].join('');
        } else if (step === 5) {
            html = [
                '<h2 class="authw-title">' + escapeHtml(stepDef.title) + '</h2>',
                '<p class="authw-subtitle">' + escapeHtml(stepDef.subtitle) + '</p>',
                '<div class="authw-avatar-upload" id="authwRegAvatarBox">',
                '    <div class="authw-avatar-preview" id="authwRegAvatarPreview"><i class="fas fa-camera"></i></div>',
                '    <input type="file" id="authwRegAvatarFile" accept="image/*" hidden>',
                '    <button type="button" class="authw-link-btn" data-authw-pick>Выбрать фото</button>',
                '</div>',
                '<div class="authw-form-message"></div>',
                '<div class="authw-reg-actions">',
                '    <button type="button" class="authw-btn authw-btn--ghost" data-authw-skip>Пропустить</button>',
                '    <button type="button" class="authw-btn authw-btn--primary" id="authwRegCreate">Создать аккаунт</button>',
                '</div>'
            ].join('');
        }

        container.className = 'authw-reg-steps';
        container.innerHTML = html;
        void container.offsetWidth;
        container.className = 'authw-reg-steps' + (forward ? ' authw-anim-forward' : ' authw-anim-back');

        container.querySelectorAll('[data-authw-next]').forEach(function (btn) {
            btn.addEventListener('click', regGoNext);
        });

        var back = document.getElementById('authwRegBack');
        if (back) back.style.visibility = step === 0 ? 'hidden' : 'visible';

        var eye = container.querySelector('[data-authw-eye]');
        if (eye) {
            eye.addEventListener('click', function () {
                togglePasswordVisibility(this.getAttribute('data-authw-eye'), this);
            });
        }

        if (step === 0) {
            var nameInput = document.getElementById('authwRegName');
            nameInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') regGoNext();
            });
            nameInput.focus();
        } else if (step === 1) {
            var emailInput = document.getElementById('authwRegEmail');
            emailInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') regGoNext();
            });
            emailInput.focus();
        } else if (step === 2) {
            var usernameInput = document.getElementById('authwRegUsername');
            usernameInput.addEventListener('input', debounce(function () {
                checkUsernameLive(usernameInput.value);
            }, 450));
            usernameInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') regGoNext();
            });
            usernameInput.focus();
        } else if (step === 3) {
            var passInput = document.getElementById('authwRegPassword');
            passInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') regGoNext();
            });
            passInput.focus();
        } else if (step === 4) {
            var passRepeatInput = document.getElementById('authwRegPasswordRepeat');
            passRepeatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') regGoNext();
            });
            passRepeatInput.focus();
        } else if (step === 5) {
            var pickBtn = container.querySelector('[data-authw-pick]');
            var fileInput = document.getElementById('authwRegAvatarFile');
            pickBtn.addEventListener('click', function () {
                fileInput.click();
            });
            fileInput.addEventListener('change', function () {
                readAvatarFile(fileInput);
            });
            container.querySelector('[data-authw-skip]').addEventListener('click', function () {
                regData.avatar = '';
                submitRegistration();
            });
            document.getElementById('authwRegCreate').addEventListener('click', submitRegistration);
        }
    }

    function checkUsernameLive(value) {
        var hint = document.getElementById('authwRegUsernameHint');
        if (!hint) return;
        var v = String(value || '').trim().replace(/^@+/, '').toLowerCase();
        if (!v) {
            hint.textContent = '';
            return;
        }
        if (!/^[a-z0-9_]{3,32}$/.test(v)) {
            hint.textContent = 'Латинские буквы, цифры и _, от 3 символов';
            hint.className = 'authw-hint authw-hint--error';
            return;
        }
        authApi('check_username', { username: v })
            .then(function (data) {
                if (!hint) return;
                if (data.available) {
                    hint.textContent = 'Свободно: @' + v;
                    hint.className = 'authw-hint authw-hint--ok';
                } else {
                    hint.textContent = 'Этот username занят';
                    hint.className = 'authw-hint authw-hint--error';
                }
            })
            .catch(function () {});
    }

    function readAvatarFile(fileInput) {
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            setPaneMessage('[data-authw-pane="register"]', 'error', 'Выберите файл изображения');
            return;
        }
        if (file.size > 4 * 1024 * 1024) {
            setPaneMessage('[data-authw-pane="register"]', 'error', 'Фото не больше 4 МБ');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var dataUrl = String(reader.result || '');
            compressAvatar(dataUrl, function (compressed) {
                regData.avatar = compressed || dataUrl;
                var preview = document.getElementById('authwRegAvatarPreview');
                if (preview) {
                    preview.innerHTML = '<img src="' + escapeHtml(regData.avatar) + '" alt="">';
                }
            });
        };
        reader.readAsDataURL(file);
    }

    function compressAvatar(dataUrl, callback) {
        try {
            var img = new Image();
            img.onload = function () {
                try {
                    var MAX = 512;
                    var scale = Math.min(1, MAX / Math.max(img.width, img.height));
                    var w = Math.max(1, Math.round(img.width * scale));
                    var h = Math.max(1, Math.round(img.height * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    callback(canvas.toDataURL('image/jpeg', 0.85));
                } catch (_) {
                    callback(dataUrl);
                }
            };
            img.onerror = function () {
                callback(dataUrl);
            };
            img.src = dataUrl;
        } catch (_) {
            callback(dataUrl);
        }
    }

    function validateRegStep(step) {
        var msgEl = document.querySelector('[data-authw-pane="register"] .authw-form-message');
        var showError = function (text) {
            if (msgEl) {
                msgEl.textContent = text;
                msgEl.className = 'authw-form-message authw-form-message--error';
            }
            return false;
        };
        if (step === 0) {
            var name = String(document.getElementById('authwRegName')?.value || '').trim();
            if (!name) return showError('Укажите, как вас зовут');
            if (name.length > 100) return showError('Имя слишком длинное');
            regData.name = name;
            return true;
        }
        if (step === 1) {
            var email = String(document.getElementById('authwRegEmail')?.value || '').trim().toLowerCase();
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Некорректный email');
            regData.email = email;
            return true;
        }
        if (step === 2) {
            var username = String(document.getElementById('authwRegUsername')?.value || '').trim().replace(/^@+/, '').toLowerCase();
            if (!username) return showError('Придумайте username');
            if (!/^[a-z0-9_]{3,32}$/.test(username)) return showError('Латинские буквы, цифры и _, от 3 до 32 символов');
            regData.username = username;
            return true;
        }
        if (step === 3) {
            var password = document.getElementById('authwRegPassword')?.value || '';
            if (password.length < 6) return showError('Пароль не короче 6 символов');
            regData.password = password;
            return true;
        }
        if (step === 4) {
            var repeat = document.getElementById('authwRegPasswordRepeat')?.value || '';
            if (!regData.password) return showError('Начните с пароля');
            if (repeat !== regData.password) return showError('Пароли не совпадают');
            return true;
        }
        return true;
    }

    function submitRegistration() {
        var btn = document.getElementById('authwRegCreate');
        if (btn) setBtnLoading(btn, true);
        setPaneMessage('[data-authw-pane="register"]', '', '');
        authApi('register', {
            name: regData.name || '',
            email: regData.email || '',
            username: regData.username || '',
            password: regData.password || '',
            passwordRepeat: regData.password || '',
            avatar: regData.avatar || ''
        })
            .then(function (data) {
                var profile = {
                    provider: 'seych',
                    name: data.name || regData.name || '',
                    username: data.username || regData.username || '',
                    email: data.email || regData.email || '',
                    avatar: data.avatar || regData.avatar || '',
                    appUserId: data.appUserId || ''
                };
                finishAuth(profile);
            })
            .catch(function (err) {
                setPaneMessage('[data-authw-pane="register"]', 'error', (err && err.message) || 'Не удалось создать аккаунт');
                if (btn) setBtnLoading(btn, false);
            });
    }

    function finishAuth(profile) {
        try {
            if (typeof saveProfile === 'function') {
                saveProfile(profile);
            } else if (typeof setAuthenticatedProfile === 'function') {
                setAuthenticatedProfile(profile);
                return;
            }
        } catch (_) {}
        try {
            if (typeof setAuthenticatedProfile === 'function') {
                setAuthenticatedProfile(profile);
                return;
            }
        } catch (_) {}
        window.location.reload();
    }

    /* ===================== QR (ПК) ===================== */

    function renderQrPane() {
        var pane = document.querySelector('[data-authw-pane="qr"]');
        if (!pane) return;
        pane.innerHTML = [
            '<div class="authw-form authw-form--qr">',
            '    <h2 class="authw-title">Вход по QR-коду</h2>',
            '    <p class="authw-subtitle">На телефоне: Настройки → Вход по QR-код, отсканируйте этот код</p>',
            '    <label class="authw-field">',
            '        <span class="authw-label">Название устройства</span>',
            '        <div class="authw-input-wrap">',
            '            <i class="fas fa-laptop authw-input-icon"></i>',
            '            <input type="text" id="authwQrDeviceName" class="authw-input" placeholder="Например, Ноутбук" maxlength="60">',
            '        </div>',
            '    </label>',
            '    <button type="button" class="authw-btn authw-btn--primary" id="authwQrStart">Показать QR-код</button>',
            '    <div class="authw-qr-box" id="authwQrBox">',
            '        <div class="authw-qr-placeholder" id="authwQrPlaceholder"><i class="fas fa-qrcode"></i><span>Нажмите, чтобы получить код</span></div>',
            '        <canvas id="authwQrCanvas" hidden></canvas>',
            '    </div>',
            '    <div class="authw-form-message"></div>',
            '    <div class="authw-qr-status" id="authwQrStatus"></div>',
            '    <div class="authw-qr-countdown" id="authwQrCountdown"></div>',
            '</div>'
        ].join('');
        document.getElementById('authwQrStart').addEventListener('click', startQrFlow);
        document.getElementById('authwQrDeviceName').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') startQrFlow();
        });
    }

    function startQrFlow() {
        if (!window.qrcode) {
            setQrStatus('Не загрузился модуль QR. Обновите страницу.', true);
            return;
        }
        stopQrFlow();
        var deviceName = String(document.getElementById('authwQrDeviceName')?.value || '').trim().slice(0, 60);
        setQrStatus('Создаём QR-код...');
        fetchGeo()
            .then(function (geo) {
                return authApi('qr_create', {
                    deviceName: deviceName,
                    ip: geo.ip || '',
                    city: geo.city || ''
                });
            })
            .then(function (data) {
                qrToken = String(data.token || '').trim();
                if (!qrToken) throw new Error('Не удалось получить токен');
                var ttlSec = Number(data.expiresIn || 300);
                qrExpiresAt = Date.now() + ttlSec * 1000;
                drawQr(String(data.qrData || ('seych-qr:' + qrToken)));
                setQrStatus('Отсканируйте QR-код с телефона');
                qrPollTimer = setInterval(qrPollTick, 2500);
                qrCountdownTimer = setInterval(updateQrCountdown, 1000);
                updateQrCountdown();
            })
            .catch(function (err) {
                setQrStatus((err && err.message) || 'Не удалось получить QR-код', true);
            });
    }

    function stopQrFlow() {
        if (qrPollTimer) clearInterval(qrPollTimer);
        if (qrCountdownTimer) clearInterval(qrCountdownTimer);
        qrPollTimer = null;
        qrCountdownTimer = null;
        qrToken = '';
    }

    function setQrStatus(text, isError) {
        var el = document.getElementById('authwQrStatus');
        if (el) {
            el.textContent = text || '';
            el.className = 'authw-qr-status' + (isError ? ' authw-qr-status--error' : '');
        }
    }

    function updateQrCountdown() {
        var el = document.getElementById('authwQrCountdown');
        if (!el) return;
        if (!qrToken) {
            el.textContent = '';
            return;
        }
        var left = Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000));
        el.textContent = left > 0 ? 'Код действителен ' + left + ' с' : 'Код истёк, обновите';
    }

    function qrPollTick() {
        if (!qrToken) return;
        if (Date.now() > qrExpiresAt) {
            setQrStatus('Код истёк. Нажмите "Показать QR-код" ещё раз.', true);
            stopQrFlow();
            return;
        }
        authApi('qr_poll', { token: qrToken })
            .then(function (data) {
                if (data.status === 'confirmed' && data.user) {
                    stopQrFlow();
                    showQrSuccessAnimation(function () {
                        var user = data.user;
                        var profile = {
                            provider: String(user.provider || authProfile?.provider || 'seych'),
                            name: user.name || 'Пользователь',
                            username: user.username || '',
                            avatar: user.avatar || '',
                            appUserId: user.appUserId || '',
                            externalKey: user.externalKey || ''
                        };
                        finishAuth(profile);
                    });
                } else if (data.status === 'expired') {
                    setQrStatus('Код истёк. Нажмите "Показать QR-код" ещё раз.', true);
                    stopQrFlow();
                }
            })
            .catch(function () {});
    }

    function drawQr(text) {
        var canvas = document.getElementById('authwQrCanvas');
        var placeholder = document.getElementById('authwQrPlaceholder');
        if (!canvas) return;
        try {
            var qr = window.qrcode(0, 'M');
            qr.addData(text);
            qr.make();
            var n = qr.getModuleCount();
            var quiet = 4;
            var size = 260;
            canvas.width = canvas.height = size;
            var cell = size / (n + quiet * 2);
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#121a24';
            for (var r = 0; r < n; r++) {
                for (var c = 0; c < n; c++) {
                    if (qr.isDark(r, c)) {
                        ctx.fillRect(Math.round(c * cell + quiet * cell), Math.round(r * cell + quiet * cell), Math.ceil(cell), Math.ceil(cell));
                    }
                }
            }
            canvas.hidden = false;
            if (placeholder) placeholder.style.display = 'none';
        } catch (err) {
            setQrStatus('Не удалось нарисовать QR: ' + err.message, true);
        }
    }

    function showQrSuccessAnimation(callback) {
        var box = document.getElementById('authwQrBox');
        var statusEl = document.getElementById('authwQrStatus');
        var canvas = document.getElementById('authwQrCanvas');
        if (box) {
            box.innerHTML = [
                '<div class="authw-check">',
                '    <svg viewBox="0 0 52 52" class="authw-check-svg">',
                '        <circle cx="26" cy="26" r="25" fill="none" class="authw-check-circle"></circle>',
                '        <path fill="none" class="authw-check-mark" d="M14.1 27.2l7.1 7.2 16.7-16.8"></path>',
                '    </svg>',
                '</div>'
            ].join('');
        }
        if (statusEl) {
            statusEl.textContent = 'Вход выполнен!';
            statusEl.className = 'authw-qr-status authw-qr-status--ok';
        }
        if (canvas) canvas.hidden = true;
        setTimeout(callback, 1400);
    }

    function fetchGeo() {
        function fetchJson(url) {
            try {
                return fetch(url, { signal: AbortSignal.timeout(6000) }).then(function (r) {
                    return r.json();
                });
            } catch (_) {
                return Promise.reject(new Error('no geo'));
            }
        }
        return fetchJson('https://ipapi.co/json/')
            .catch(function () {
                return fetchJson('https://ipinfo.io/json');
            })
            .then(function (data) {
                if (!data || !data.ip) return {};
                return {
                    ip: String(data.ip || ''),
                    city: String(data.city || data.region || '') || ''
                };
            })
            .catch(function () {
                return {};
            });
    }

    /* ===================== QR (ТЕЛЕФОН / СКАНЕР) ===================== */

    function showSeychQrScanner() {
        if (!window.jsQR) {
            alert('Модуль сканера не загрузился. Обновите страницу и попробуйте ещё раз.');
            return;
        }
        var existing = document.getElementById('authwScanModal');
        if (existing) existing.remove();
        stopScannerStream();

        var modal = document.createElement('div');
        modal.className = 'authw-scan-modal';
        modal.id = 'authwScanModal';
        modal.innerHTML = [
            '<div class="authw-scan-content">',
            '    <div class="authw-scan-header"><i class="fas fa-qrcode"></i> Вход по QR-код</div>',
            '    <div class="authw-scan-viewport">',
            '        <video id="authwScanVideo" playsinline muted></video>',
            '        <div class="authw-scan-frame"></div>',
            '    </div>',
            '    <div class="authw-qr-status" id="authwScanStatus">Наведите камеру на QR-код</div>',
            '    <button type="button" class="authw-scan-close" id="authwScanClose"><i class="fas fa-times"></i> Закрыть</button>',
            '</div>'
        ].join('');
        document.body.appendChild(modal);
        document.getElementById('authwScanClose').addEventListener('click', function () {
            closeQrScanner();
        });

        var video = document.getElementById('authwScanVideo');
        var statusEl = document.getElementById('authwScanStatus');
        navigator.mediaDevices
            .getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            })
            .then(function (stream) {
                scannerStream = stream;
                video.srcObject = stream;
                video.setAttribute('playsinline', 'true');
                video.play().catch(function () {});
                startScanLoop();
            })
            .catch(function (err) {
                statusEl.textContent = 'Нет доступа к камере: ' + (err && err.name ? err.name : 'ошибка');
            });
    }

    function startScanLoop() {
        var video = document.getElementById('authwScanVideo');
        var canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        var skip = 0;
        var lastFound = '';
        function tick() {
            if (!document.getElementById('authwScanModal')) return;
            skip++;
            if (video.readyState === video.HAVE_ENOUGH_DATA && skip % 2 === 0) {
                ctx.drawImage(video, 0, 0, 640, 480);
                try {
                    var imageData = ctx.getImageData(0, 0, 640, 480);
                    var code = window.jsQR(imageData.data, 640, 480, { inversionAttempts: 'dontInvert' });
                    if (code && code.data && code.data !== lastFound) {
                        var match = /^seych-qr:(.+)$/.exec(String(code.data).trim());
                        if (match) {
                            lastFound = match[1];
                            handleScannedToken(match[1]);
                            return;
                        }
                    }
                } catch (_) {}
            }
            scannerFrame = requestAnimationFrame(tick);
        }
        scannerFrame = requestAnimationFrame(tick);
    }

    function handleScannedToken(token) {
        stopScannerStream();
        var statusEl = document.getElementById('authwScanStatus');
        if (statusEl) statusEl.textContent = 'Проверяем QR-код...';
        authApi('qr_info', { token: token })
            .then(function (data) {
                if (!data || data.status === 'expired') {
                    showScanError('QR-код недействителен или истёк. Попросите показать новый.');
                    return;
                }
                renderScanConfirm(token, data.requester || {});
            })
            .catch(function (err) {
                showScanError((err && err.message) || 'Не удалось проверить QR-код');
            });
    }

    function renderScanConfirm(token, requester) {
        var modal = document.getElementById('authwScanModal');
        if (!modal) return;
        modal.innerHTML = [
            '<div class="authw-scan-content authw-scan-content--confirm">',
            '    <div class="authw-scan-header"><i class="fas fa-desktop"></i> Подтверждение входа</div>',
            '    <div class="authw-confirm-body">',
            '        <div class="authw-confirm-avatar"><i class="fas fa-laptop"></i></div>',
            '        <div class="authw-confirm-name">' + escapeHtml(requester.name || 'Новое устройство') + '</div>',
            '        <div class="authw-confirm-meta">',
            '            <div class="authw-confirm-meta-row"><i class="fas fa-globe"></i><span>IP: <b>' + escapeHtml(requester.ip || '—') + '</b></span></div>',
            '            <div class="authw-confirm-meta-row"><i class="fas fa-city"></i><span>Город: <b>' + escapeHtml(requester.city || '—') + '</b></span></div>',
            '        </div>',
            '        <div class="authw-form-message"></div>',
            '        <div class="authw-confirm-actions">',
            '            <button type="button" class="authw-btn authw-btn--ghost" id="authwConfirmCancel">Отмена</button>',
            '            <button type="button" class="authw-btn authw-btn--primary" id="authwConfirmOk">Подтвердить</button>',
            '        </div>',
            '    </div>',
            '</div>'
        ].join('');
        document.getElementById('authwConfirmCancel').addEventListener('click', function () {
            closeQrScanner();
        });
        document.getElementById('authwConfirmOk').addEventListener('click', function () {
            confirmQrLogin(token);
        });
    }

    function confirmQrLogin(token) {
        var btn = document.getElementById('authwConfirmOk');
        var msgEl = document.querySelector('#authwScanModal .authw-form-message');
        if (btn) setBtnLoading(btn, true);
        var me = authProfile || {};
        var myUsername = '';
        try {
            if (typeof ensureGeneratedMessengerUsername === 'function') {
                myUsername = ensureGeneratedMessengerUsername(
                    (typeof messengerProfile !== 'undefined' && messengerProfile && messengerProfile.username) ||
                        me.vkUsername || '',
                    me.appUserId || ''
                );
            }
        } catch (_) {}
        var user = {
            appUserId: String(me.appUserId || ''),
            name: String(me.name || '').trim() || 'Пользователь',
            avatar: String(me.avatar || '').trim(),
            username: myUsername || String(me.username || '').trim(),
            externalKey: String(me.externalKey || (typeof buildExternalAccountKey === 'function' ? buildExternalAccountKey(me) : '') || ''),
            identityKeys: typeof buildIdentityKeys === 'function' ? buildIdentityKeys(me) : [],
            provider: String(me.provider || '').trim()
        };
        authApi('qr_confirm', { token: token, user: user })
            .then(function () {
                var modal = document.getElementById('authwScanModal');
                if (!modal) return;
                modal.innerHTML = [
                    '<div class="authw-scan-content authw-scan-content--confirm">',
                    '    <div class="authw-check">',
                    '        <svg viewBox="0 0 52 52" class="authw-check-svg">',
                    '            <circle cx="26" cy="26" r="25" fill="none" class="authw-check-circle"></circle>',
                    '            <path fill="none" class="authw-check-mark" d="M14.1 27.2l7.1 7.2 16.7-16.8"></path>',
                    '        </svg>',
                    '    </div>',
                    '    <div class="authw-confirm-name">Вход подтверждён</div>',
                    '</div>'
                ].join('');
                setTimeout(closeQrScanner, 1600);
            })
            .catch(function (err) {
                if (btn) setBtnLoading(btn, false);
                if (msgEl) {
                    msgEl.textContent = (err && err.message) || 'Не удалось подтвердить вход';
                    msgEl.className = 'authw-form-message authw-form-message--error';
                }
            });
    }

    function showScanError(text) {
        var modal = document.getElementById('authwScanModal');
        if (!modal) return;
        var statusEl = document.getElementById('authwScanStatus');
        var content = modal.querySelector('.authw-scan-content');
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.className = 'authw-qr-status authw-qr-status--error';
        } else if (content) {
            var div = document.createElement('div');
            div.className = 'authw-qr-status authw-qr-status--error';
            div.textContent = text;
            div.style.margin = '10px 0';
            content.appendChild(div);
        }
        var closeBtn = document.getElementById('authwScanClose');
        if (!closeBtn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'authw-scan-close';
            b.id = 'authwScanClose';
            b.innerHTML = '<i class="fas fa-times"></i> Закрыть';
            b.addEventListener('click', closeQrScanner);
            content.appendChild(b);
        }
    }

    function closeQrScanner() {
        stopScannerStream();
        var modal = document.getElementById('authwScanModal');
        if (modal) modal.remove();
    }

    function stopScannerStream() {
        if (scannerFrame) cancelAnimationFrame(scannerFrame);
        scannerFrame = null;
        if (scannerStream) {
            scannerStream.getTracks().forEach(function (track) {
                track.stop();
            });
            scannerStream = null;
        }
    }

    window.SeychAuth = {
        show: function () {
            if (typeof tryTelegramWebAppAuth === 'function') {
                try {
                    if (tryTelegramWebAppAuth()) return;
                } catch (_) {}
            }
            render();
        },
        isActive: function () {
            return !!document.querySelector('.authw-wrap');
        }
    };
    window.showSeychQrScanner = showSeychQrScanner;
})();
