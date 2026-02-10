const AVATARS = ['🎧', '🎤', '🎵', '🎸', '🥁', '🎹', '🎺', '🎻', '🪗', '🎷', '🪘', '🎶'];

const Lobby = {
  selectedAvatar: 0,
  socket: null,

  init() {
    this.socket = io();
    this.renderAvatarPicker();
    this.loadSavedIdentity();
    this.bindEvents();
    this.socket.emit('room:list');
    this.socket.on('room:list', (rooms) => this.renderRooms(rooms));
  },

  loadSavedIdentity() {
    const saved = sessionStorage.getItem('tt_username');
    const savedAvatar = sessionStorage.getItem('tt_avatar');
    if (saved) document.getElementById('username').value = saved;
    if (savedAvatar !== null) {
      this.selectedAvatar = parseInt(savedAvatar);
      this.updateAvatarSelection();
    }
  },

  saveIdentity() {
    const username = document.getElementById('username').value.trim();
    sessionStorage.setItem('tt_username', username);
    sessionStorage.setItem('tt_avatar', this.selectedAvatar);
  },

  renderAvatarPicker() {
    const picker = document.getElementById('avatar-picker');
    AVATARS.forEach((emoji, i) => {
      const btn = document.createElement('button');
      btn.className = 'avatar-option' + (i === this.selectedAvatar ? ' selected' : '');
      btn.textContent = emoji;
      btn.dataset.index = i;
      btn.addEventListener('click', () => {
        this.selectedAvatar = i;
        this.updateAvatarSelection();
      });
      picker.appendChild(btn);
    });
  },

  updateAvatarSelection() {
    document.querySelectorAll('.avatar-option').forEach((btn, i) => {
      btn.classList.toggle('selected', i === this.selectedAvatar);
    });
  },

  getUsername() {
    const input = document.getElementById('username').value.trim();
    if (!input) {
      document.getElementById('username').focus();
      document.getElementById('username').style.borderColor = 'var(--accent-lame)';
      setTimeout(() => {
        document.getElementById('username').style.borderColor = '';
      }, 1500);
      return null;
    }
    return input;
  },

  bindEvents() {
    // Create room
    document.getElementById('create-room-btn').addEventListener('click', () => {
      const username = this.getUsername();
      if (!username) return;

      const name = document.getElementById('room-name').value.trim();
      if (!name) {
        document.getElementById('room-name').focus();
        document.getElementById('room-name').style.borderColor = 'var(--accent-lame)';
        setTimeout(() => {
          document.getElementById('room-name').style.borderColor = '';
        }, 1500);
        return;
      }

      const theme = document.getElementById('room-theme').value.trim();
      this.saveIdentity();

      this.socket.emit('room:create', {
        name,
        theme,
        username,
        avatarId: this.selectedAvatar
      });
    });

    // Handle room created
    this.socket.on('room:created', ({ roomId }) => {
      window.location.href = `/room.html?id=${roomId}`;
    });

    // Handle errors
    this.socket.on('room:error', ({ message }) => {
      alert(message);
    });

    // Enter key on inputs
    document.getElementById('room-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('create-room-btn').click();
    });

    document.getElementById('username').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('room-name').focus();
    });
  },

  renderRooms(rooms) {
    const grid = document.getElementById('rooms-grid');
    const empty = document.getElementById('empty-state');

    if (!rooms || rooms.length === 0) {
      grid.innerHTML = '';
      grid.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = '';

    rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.addEventListener('click', () => this.joinRoom(room.id));

      let trackHtml = '';
      if (room.currentTrack) {
        trackHtml = `<div class="room-card-track">Now: ${this.escapeHtml(room.currentTrack)} <span>by ${this.escapeHtml(room.currentDJ || '?')}</span></div>`;
      } else {
        trackHtml = `<div class="room-card-track" style="color: var(--text-muted)">Waiting for DJs...</div>`;
      }

      card.innerHTML = `
        <div class="room-card-name">${this.escapeHtml(room.name)}</div>
        ${room.theme ? `<div class="room-card-theme">${this.escapeHtml(room.theme)}</div>` : ''}
        <div class="room-card-info">${room.userCount} ${room.userCount === 1 ? 'person' : 'people'} &middot; ${room.djCount} DJ${room.djCount !== 1 ? 's' : ''}</div>
        ${trackHtml}
      `;

      grid.appendChild(card);
    });
  },

  joinRoom(roomId) {
    const username = this.getUsername();
    if (!username) return;
    this.saveIdentity();
    window.location.href = `/room.html?id=${roomId}`;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => Lobby.init());
