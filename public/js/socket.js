const Socket = {
  io: null,
  roomId: null,
  myId: null, // Public ID assigned by server (not socket ID)
  currentDJId: null, // Public ID of current DJ

  init() {
    this.io = io();

    this.io.on('connect', () => {
      const banner = document.getElementById('connection-banner');
      if (banner) banner.classList.add('hidden');
    });

    this.io.on('disconnect', () => {
      const banner = document.getElementById('connection-banner');
      if (banner) {
        banner.textContent = 'Connection lost. Reconnecting...';
        banner.classList.remove('hidden');
      }
    });

    this.io.on('reconnect_attempt', (attempt) => {
      const banner = document.getElementById('connection-banner');
      if (banner) {
        banner.textContent = 'Reconnecting... (attempt ' + attempt + ')';
      }
    });

    this.io.on('reconnect', () => {
      const banner = document.getElementById('connection-banner');
      if (banner) banner.classList.add('hidden');

      Toast.show('Reconnected!');

      if (this.roomId) {
        this.io.emit('room:join', {
          roomId: this.roomId,
          username: sessionStorage.getItem('tt_username') || 'anon',
          avatarId: parseInt(sessionStorage.getItem('tt_avatar') || '0')
        });
      }
    });

    this.io.on('room:error', ({ message }) => {
      Toast.show(message, 'error');
    });
  },

  emit(event, data, callback) {
    this.io.emit(event, data, callback);
  },

  on(event, handler) {
    this.io.on(event, handler);
  }
};
