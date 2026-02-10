const RoomController = {
  roomId: null,

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

    // Bind socket events
    this.bindEvents();

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
      } else {
        Player.onIdle();
      }
    });

    // Playback events
    Socket.on('track:play', (data) => {
      Player.onTrackPlay(data);
      Voting.resetVote();
      Voting.onUpdate({ awesome: 0, lame: 0 });
      Chat.addSystemMessage('Now playing: ' + data.title + ' (DJ: ' + data.dj.username + ')');
    });

    Socket.on('track:sync', (data) => {
      Player.sync(data);
    });

    // Metadata update (title/duration resolved from YouTube) — no chat message
    Socket.on('track:metadata:update', (data) => {
      if (data.title) {
        document.getElementById('np-title').textContent = data.title;
        Player.currentDuration = data.duration || Player.currentDuration;
      }
    });

    Socket.on('track:idle', () => {
      Player.onIdle();
    });

    Socket.on('track:skip', (data) => {
      Player.onSkip(data);
      Chat.addSystemMessage('Track was skipped: ' + (data.reason || ''));
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
    });

    // Room not found
    Socket.on('room:error', ({ message }) => {
      if (message === 'Room not found') {
        Toast.show('Room not found. Redirecting...', 'error');
        setTimeout(() => window.location.href = '/', 2000);
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => RoomController.init());
