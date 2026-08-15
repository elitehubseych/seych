        let roomId, localStream, ws;
        let isCreator = false, userName = '', remoteName = '';
        let userAvatar = '', remoteAvatar = '';
        let videoEnabled = false, audioEnabled = true;
        let remoteVideo = false, remoteAudio = true;
        let isScreenSharing = false, remoteScreen = false;
        let isSpeaking = false, remoteSpeaking = false;
        let animationId;
        let callStartTime = null;
        let callTimerInterval = null;
        let isGuestAdmin = false;
        let isConnected = false;
        let myId = null;
        
        let peers = new Map();
        let participants = new Map();
        let participantAvatars = new Map();
        let participantStates = new Map();
        let screenConnMap = new Map();
        let localScreenShareId = null;
        let ownerId = null;
        let currentContextTargetId = null;

        let videoTiles = new Map();
        let screenTiles = new Map();
        let remoteMediaStreams = new Map();
        let remoteAudioEls = new Map();
        let audioUnlockShown = false;
        let audioContextRef = null;
        let screenStreamLocal = null;
        
        let videoTrack = null;
        let cameraSourceTrack = null;
        let selfPreviewTrack = null;
        let outgoingTrackCleanup = null;
        let cameraFacingMode = 'user';
        let cameraSwitchInProgress = false;
        let videoPrewarmPromise = null;
        let authProfile = null;
        let pendingRoomJoin = null;
        let appUserId = '';
        let vkContacts = [];
        let vkCustomContacts = [];
        let vkHiddenContactIds = [];
        let friendsState = { friends: [], incomingRequests: [], outgoingRequests: [], incomingCalls: [], outgoingCalls: [] };
        let friendsSearchResults = [];
        let friendsSearchValue = '';
        let friendsActiveTab = 'friends';
        let friendsPanelOpenMobile = false;
        let friendsNotificationsEnabled = true;
        let systemNotifyPermissionAsked = false;
        let pushRegistration = null;
        let pushInitPromise = null;
        let friendsPollTimer = null;
        let incomingFriendModal = null;
        let incomingCallModal = null;
        let incomingCallSound = null;
        let incomingCallSoundRetryTimer = null;
        let knownIncomingCallIds = new Set();
        let knownOutgoingCallStatuses = new Map();
        let outgoingFriendCallSession = null;
        let outgoingFriendCallTimeout = null;
        let incomingCallAutoDeclineTimeout = null;
        let audioPlaybackUnlocked = false;
        
        // Call audio settings.
        let echoCancellationEnabled = true;
        let autoGainControlEnabled = true;
        let connectingAudioParticipants = new Set();
        let selectedMicDeviceId = '';
        let selectedSpeakerDeviceId = '';
        let rawMicTrack = null;
        let googleIdInitialized = false;
        let googleTokenClient = null;
        let watchPartyState = null;
        let durakGameState = null;
        let durakUiTickTimer = null;
        let durakDragCard = null;
        let watchPartyTile = null;
        let watchPartyMediaElement = null;
        let watchPartySupportsVolume = false;
        let watchPartyVolume = 80;
        let watchPartyVolumeApplier = null;
        let watchFocusEnabled = false;
        let watchFocusIdleTimer = null;
        let roomIsPrivate = false;
        let pendingJoinRequests = [];
        let joinPendingModal = null;
        let roomSettingsMenu = null;
        let participantConnectionQuality = new Map();
        let connectionQualityBusy = false;
        let rtcIceServers = [...DEFAULT_ICE_SERVERS];
        let avPeerRecoverTimers = new Map();
        let iceRestartTimers = new Map();
        let wsReconnectTimer = null;
        let wsReconnectAttempts = 0;
        let wsLastInitialMsg = null;
        const EMPTY_CHAT_PHRASES = [
            'Похоже здесь пусто, как думаете этому пользователю не одиноко?',
            'Здесь же совсем ничего нет, хотите начать новую историю?',
            'К сожалению, здесь вообще ничего нет, сделаем легендарное дуо?',
            'Тишина… А ведь первое слово может изменить всё',
            'Пусто, как в космосе. Запустим диалог?',
            'Ни одного сообщения. Пока не поздно — начните!',
            'Этот чат ждёт своего героя. Им будете вы?',
            'Пустой чат — чистый лист. Напишите первую главу!',
            'Здесь так тихо, что слышно эхо. Скажите что-нибудь!',
            'Ноль сообщений. Это вызов — примете его?',
            'Ваш шанс начать что-то великое прямо сейчас',
            'Диалог ещё не начался. Будьте первопроходцем!',
            'Пустота — это возможность. Воспользуйтесь ей!',
            'Кто-то должен написать первым. Почему не вы?',
            'Этот чат ещё спит. Разбудите его сообщением!',
            'Ни единого слова. Самое время стать первым!',
            'Пустой чат — как необитаемый остров. Высадимся?',
            'Здесь нет ни одного сообщения… пока что!',
            'Молчание — золото, но сообщения — бесценны',
            'Чат пуст. Но не для вас, правда?',
            'Здесь можно начать что-то особенное',
            'Первое сообщение — как первый шаг на луну',
            'Пока тут пусто, но вы можете это изменить',
            'Чат без сообщений — как вечеринка без гостей',
            'Одиноко тут… Напишите что-нибудь!',
            'Пусто, но потенциал безграничен. Начнём?',
            'Здесь только вы и тишина. Побейте её!',
            'Ни одного сообщения — это вызов судьбе!',
            'Чат пуст, но зато весь ваш. Напишите!',
            'Первое сообщение — самый сложный шаг. Попробуйте!',
            'Пустой чат — как незаполненный холст. Рискуйте!',
            'Тут ничего нет, разорвите эту тишину!',
            'Молчание — не всегда знак согласия. Напишите!',
            'Чат ждёт вашего первого слова. Не заставляйте ждать!',
            'Пустота здесь — временна. Начните диалог!',
            'Ни единого сообщения. Это ваш момент!',
            'Пустой чат — приглашение к действию',
            'Тишина здесь оглушительна. Скажите что-нибудь!',
            'Этот чат — чистый лист. Что вы напишете?',
            'Ноль сообщений — это просто начало чего-то великого',
            'Пусто? Значит, вы можете быть первым во всём!',
            'Чат без истории. Создайте её прямо сейчас!',
            'Здесь пока ничего нет, но всё в ваших руках',
            'Первый шаг — самое сложное. Но вы справитесь!',
            'Пустой чат — это не конец, это начало!',
            'Тишина здесь — ваш шанс заговорить первым',
            'Ни слова ещё не сказано. Будьте первым!',
            'Пустота — это свобода. Напишите что хотите!',
            'Чат пуст, но ваше сообщение всё изменит',
            'Здесь пока тихо. Подкиньте искру!',
            'Пустой чат — как книга без единой буквы. Напишите первую!',
            'Сюда ещё не долетело ни одно сообщение. Отправьте!',
            'Вакуум. Но вы можете его нарушить!',
            'Тут пусто, но зато никакого спама!',
            'Чат свежий, как утренний воздух. Напишите!',
            'Ни одного сообщения — и это ваш шанс быть первым',
            'Пустота зовёт. Ответьте ей сообщением!',
            'Этот диалог ещё не начался. Станьте инициатором!',
            'Пустой чат — как неразгаданная тайна. Разгадайте!',
            'Тишина — это скучно. Нарушьте её!',
            'Здесь ничего нет, но вы можете создать всё',
            'Чат без сообщений — как концерт без музыки',
            'Первое слово — самое важное. Начните!',
            'Пусто? Это просто сцена без актёров. Выходите!',
            'Ни единого сообщения. Время менять ситуацию!',
            'Чат пуст, но потенциал огромный. Действуйте!',
            'Здесь пока только эхо. Скажите что-то!',
            'Пустой чат — ваш холст. Творите!',
            'Ноль сообщений — это ноль ограничений!',
            'Молчание — это уютно, но диалог — это жизнь',
            'Пустота здесь — временная. Начните!',
            'Чат ждёт первого сообщения как рассвет',
            'Ни слова. Это ваш шанс написать легенду!',
            'Пустой чат — как старый телефон. Позвоните!',
            'Тишина здесь — не навсегда. Напишите!',
            'Чат пуст, но ваше слово наполнит его смыслом',
            'Здесь ничего нет. Пока вы не решите иначе!',
            'Первое сообщение — как ключ к двери. Откройте!',
            'Пустота — это начало всех великих историй',
            'Ни одного сообщения. Но это легко исправить!',
            'Чат без слов — как море без волн. Встряхните!',
            'Пусто, но это не приговор. Это приглашение!',
            'Тишина здесь — ваш друг. Но диалог — лучше!',
            'Ноль сообщений. Ноль проблем. Начните общение!',
            'Пустой чат — как замок без ключа. Вы — ключ!',
            'Здесь пока тихо, но громкость в ваших руках',
            'Чат пуст. Но первое слово всё изменит!',
            'Ни единого сообщения. Это ваш звёздный час!',
            'Пустота — это чистый старт. Поехали!',
            'Молчание — это пауза перед великим диалогом',
            'Чат без сообщений — как небо без звёзд. Зажгите!',
            'Пусто? Отлично! Никаких стереотипов!',
            'Первое сообщение — как первый кирпич. Стройте!',
            'Здесь ничего нет, и это прекрасно. Свобода!',
            'Чат пуст, но ваше сообщение станет легендарным',
            'Тишина — это момент перед бурей. Создайте бурю!',
            'Ни слова ещё. Но вы можете изменить это!',
            'Пустой чат — как пустая сцена. Ваш выход!',
            'Здесь пусто, но ваша искра зажжёт диалог!'
        ];

        let emptyChatPhraseIndex = Math.floor(Math.random() * EMPTY_CHAT_PHRASES.length);
        let emptyChatCurrentPhrase = EMPTY_CHAT_PHRASES[emptyChatPhraseIndex];
        let emptyChatPhraseTimer = null;
        let emptyChatPhraseFading = false;

