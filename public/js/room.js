const RoomController = {
  roomId: null,
  _wasDJ: false,

  init() {
    // Get room ID from URL
    const params = new URLSearchParams(window.location.search);
    this.roomId = params.get('id');

    if (!this.roomId) {
      window.location.href = '/';
      return;
    }

    const username = sessionStorage.getItem('tt_username');
    if (!username) {
      window.location.href = '/';
      return;
    }

    // Initialize modules
    Socket.init();
    Socket.roomId = this.roomId;
    Player.init('youtube-player');
    Chat.init();
    Roster.init();
    Queue.init();
    Voting.init();

    // Back button
    document.getElementById('back-btn').addEventListener('click', () => {
      Socket.emit('room:leave');
      window.location.href = '/';
    });

    // Skip button
    document.getElementById('skip-btn').addEventListener('click', () => {
      Socket.emit('dj:skipTrack');
    });

    // Bind socket events
    this.bindEvents();

    // Initialize mobile resize handle
    this.initResizeHandle();

    // Initialize QR code
    this.initQRCode();

    // Initialize name editor
    this.initNameEditor();

    // Calibrate clock then join
    Player.calibrateClock().then(() => {
      Socket.emit('room:join', {
        roomId: this.roomId,
        username,
        avatarId: parseInt(sessionStorage.getItem('tt_avatar') || '0')
      });
    });

    // Recalibrate clock every 5 minutes
    setInterval(() => Player.calibrateClock(), 5 * 60 * 1000);
  },

  bindEvents() {
    // Full room state on join
    Socket.on('room:state', (state) => {
      // Store our public ID from server
      Socket.myId = state.myId;

      document.getElementById('room-name').textContent = state.name;
      if (state.theme) {
        document.getElementById('room-theme').textContent = state.theme;
      }

      // Apply room theme based on keywords
      this.applyRoomTheme(state.theme);

      Roster.users = state.users;
      Roster.djSlots = state.djSlots;
      Roster.render();

      Chat.onHistory(state.chatHistory);
      Queue.onDJUpdate(state.djSlots);
      Voting.onUpdate(state.votes);

      if (state.sync.trackId) {
        Player.onTrackPlay({
          videoId: state.sync.trackId,
          title: state.sync.title,
          thumbnail: state.sync.thumbnail,
          duration: state.sync.duration,
          dj: state.sync.dj,
          sync: state.sync
        });
        Socket.currentDJId = state.sync.dj ? state.sync.dj.userId : null;
        this.updateSkipButton();
      } else {
        Player.onIdle();
        Socket.currentDJId = null;
        this.updateSkipButton();
      }
    });

    // Playback events
    Socket.on('track:play', (data) => {
      Player.onTrackPlay(data);
      Voting.resetVote();
      Voting.onUpdate({ awesome: 0, lame: 0 });
      Chat.addSystemMessage('Now playing: ' + data.title + ' (DJ: ' + data.dj.username + ')');
      Socket.currentDJId = data.dj ? data.dj.userId : null;
      this.updateSkipButton();
    });

    Socket.on('track:sync', (data) => {
      Player.sync(data);
    });

    // Metadata update (title/duration resolved from YouTube)
    Socket.on('track:metadata:update', (data) => {
      if (data.title) {
        document.getElementById('np-title').textContent = data.title;
        Player.currentDuration = data.duration || Player.currentDuration;
      }
    });

    Socket.on('track:idle', () => {
      Player.onIdle();
      Socket.currentDJId = null;
      this.updateSkipButton();
    });

    Socket.on('track:skip', (data) => {
      Player.onSkip(data);
      Chat.addSystemMessage('Track was skipped: ' + (data.reason || ''));
    });

    // Server system messages (queue notifications, etc.)
    Socket.on('chat:system', (data) => {
      Chat.addSystemMessage(data.text);
    });

    // Voting
    Socket.on('vote:update', (data) => Voting.onUpdate(data));

    // Chat
    Socket.on('chat:message', (data) => Chat.onMessage(data));

    // Roster
    Socket.on('user:joined', (data) => Roster.onUserJoined(data));
    Socket.on('user:left', (data) => Roster.onUserLeft(data));
    Socket.on('roster:update', (data) => {
      Roster.onUpdate(data);
    });

    // DJ updates
    Socket.on('dj:update', (data) => {
      Roster.onDJUpdate(data);
      Queue.onDJUpdate(data);

      // Auto-switch to Queue tab when user first becomes a DJ
      const mySlot = data.slots.find(s => s.userId === Socket.myId);
      if (mySlot && !this._wasDJ) {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        const queueTab = document.querySelector('.sidebar-tab[data-tab="queue"]');
        if (queueTab) queueTab.classList.add('active');
        document.getElementById('panel-queue').classList.add('active');
        const searchInput = document.getElementById('add-track-input');
        if (searchInput) setTimeout(() => searchInput.focus(), 100);
      }
      this._wasDJ = !!mySlot;
    });

    // Room not found
    Socket.on('room:error', ({ message }) => {
      if (message === 'Room not found') {
        Toast.show('Room not found. Redirecting...', 'error');
        setTimeout(() => window.location.href = '/', 2000);
      }
    });
  },

  updateSkipButton() {
    const skipBtn = document.getElementById('skip-btn');
    const isMyTrack = Socket.currentDJId && Socket.currentDJId === Socket.myId;
    skipBtn.classList.toggle('hidden', !isMyTrack);
  },

  applyRoomTheme(themeText) {
    const layout = document.querySelector('.room-layout');
    layout.classList.remove('room-theme-neon', 'room-theme-chill', 'room-theme-retro', 'room-theme-midnight');

    if (!themeText) return;

    const validThemes = ['neon', 'chill', 'retro', 'midnight'];
    if (validThemes.includes(themeText)) {
      layout.classList.add('room-theme-' + themeText);
      return;
    }

    // Fallback regex for backward compat with old free-text themes
    const t = themeText.toLowerCase();
    if (/neon|rave|edm|techno|electric|house/.test(t)) {
      layout.classList.add('room-theme-neon');
    } else if (/chill|lofi|lo-fi|ambient|relax|jazz|acoustic/.test(t)) {
      layout.classList.add('room-theme-chill');
    } else if (/retro|80s|synthwave|funk|soul|disco|vaporwave/.test(t)) {
      layout.classList.add('room-theme-retro');
    } else if (/midnight|night|dark|gothic|metal/.test(t)) {
      layout.classList.add('room-theme-midnight');
    }
  },

  initResizeHandle() {
    const handle = document.getElementById('sidebar-resize-handle');
    const sidebar = document.querySelector('.room-sidebar');
    if (!handle || !sidebar) return;

    let startY, startH;

    const onStart = (e) => {
      e.preventDefault();
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startH = sidebar.offsetHeight;
      sidebar.style.transition = 'none';
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchend', onEnd);
      document.addEventListener('mouseup', onEnd);
    };

    const onMove = (e) => {
      e.preventDefault();
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const delta = startY - y;
      const newH = Math.min(window.innerHeight * 0.8, Math.max(120, startH + delta));
      sidebar.style.maxHeight = newH + 'px';
      sidebar.style.height = newH + 'px';
    };

    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('mouseup', onEnd);
      sidebar.style.transition = '';
    };

    handle.addEventListener('touchstart', onStart, { passive: false });
    handle.addEventListener('mousedown', onStart);
  },

  initQRCode() {
    const roomUrl = window.location.href;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=' + encodeURIComponent(roomUrl);

    // Toggle button + collapsible widget
    const toggleBtn = document.getElementById('qr-toggle-btn');
    const widget = document.getElementById('qr-widget');
    const img = document.getElementById('qr-img');
    img.src = qrApiUrl;

    // Toggle QR visibility
    toggleBtn.addEventListener('click', () => {
      widget.classList.toggle('hidden');
    });

    // Modal elements
    const modal = document.getElementById('qr-modal');
    const modalImg = document.getElementById('qr-modal-img');
    const modalUrl = document.getElementById('qr-modal-url');
    const copyBtn = document.getElementById('qr-copy-btn');
    const closeBtn = document.getElementById('qr-close-btn');

    modalImg.src = qrApiUrl;
    modalUrl.textContent = roomUrl;

    // Click QR image to open full modal
    widget.addEventListener('click', (e) => {
      if (e.target === toggleBtn) return;
      modal.classList.remove('hidden');
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });

    // Copy link
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(roomUrl).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
      });
    });
  },

  initNameEditor() {
    const username = sessionStorage.getItem('tt_username');
    const display = document.getElementById('room-username');
    const editBtn = document.getElementById('edit-name-btn');
    if (!display || !editBtn) return;

    display.textContent = username;

    editBtn.addEventListener('click', () => {
      const current = display.textContent;
      display.textContent = '';
      const input = document.createElement('input');
      input.className = 'edit-name-input';
      input.value = current;
      input.maxLength = 20;
      display.appendChild(input);
      input.focus();
      input.select();

      const save = () => {
        const newName = input.value.trim() || current;
        display.textContent = newName;
        sessionStorage.setItem('tt_username', newName);
        Socket.emit('user:rename', { username: newName });
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { display.textContent = current; }
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => RoomController.init());
