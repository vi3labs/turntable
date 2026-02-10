const Roster = {
  users: [],
  djSlots: { slots: [], currentIndex: -1 },

  init() {
    document.getElementById('dj-step-up').addEventListener('click', () => {
      Socket.emit('dj:stepUp');
    });

    document.getElementById('dj-step-down').addEventListener('click', () => {
      Socket.emit('dj:stepDown');
    });
  },

  onUpdate(data) {
    if (data.users) this.users = data.users;
    this.render();
  },

  onDJUpdate(data) {
    this.djSlots = data;
    this.render();
  },

  onUserJoined(user) {
    Chat.addSystemMessage(user.username + ' joined the room');
  },

  onUserLeft(data) {
    const user = this.users.find(u => u.id === data.userId);
    if (user) {
      Chat.addSystemMessage(user.username + ' left the room');
    }
  },

  render() {
    const myId = Socket.myId;
    const djContainer = document.getElementById('roster-djs');
    const listenerContainer = document.getElementById('roster-listeners');
    const djCountEl = document.getElementById('dj-count');
    const djMaxEl = document.getElementById('dj-max');
    const stepUpBtn = document.getElementById('dj-step-up');
    const stepDownBtn = document.getElementById('dj-step-down');
    const userCountEl = document.getElementById('room-user-count');

    const djUserIds = new Set(this.djSlots.slots.map(s => s.userId));
    const isDJ = djUserIds.has(myId);
    const currentDJUserId = this.djSlots.currentIndex >= 0 && this.djSlots.slots[this.djSlots.currentIndex]
      ? this.djSlots.slots[this.djSlots.currentIndex].userId
      : null;

    // Update counts
    djCountEl.textContent = this.djSlots.slots.length;
    djMaxEl.textContent = this.djSlots.maxSlots || 5;
    userCountEl.textContent = this.users.length + (this.users.length === 1 ? ' person' : ' people');

    // Show/hide DJ buttons
    stepUpBtn.classList.toggle('hidden', isDJ);
    stepDownBtn.classList.toggle('hidden', !isDJ);

    // Render DJs
    djContainer.innerHTML = '';
    this.djSlots.slots.forEach(slot => {
      const el = document.createElement('div');
      el.className = 'roster-user is-dj' + (slot.userId === currentDJUserId ? ' is-current-dj' : '');

      const avatar = document.createElement('span');
      avatar.className = 'roster-user-avatar';
      avatar.textContent = AVATARS[slot.avatarId] || '🎵';

      const name = document.createElement('span');
      name.className = 'roster-user-name';
      name.textContent = slot.username + (slot.userId === myId ? ' (you)' : '');

      const badge = document.createElement('span');
      badge.className = 'roster-user-badge';
      badge.textContent = slot.userId === currentDJUserId ? 'NOW' : 'DJ';

      const rep = document.createElement('span');
      rep.className = 'roster-user-rep';
      rep.textContent = slot.totalAwesome ? '+' + slot.totalAwesome : '';

      el.appendChild(avatar);
      el.appendChild(name);
      el.appendChild(badge);
      el.appendChild(rep);
      djContainer.appendChild(el);
    });

    // Render listeners (non-DJs)
    listenerContainer.innerHTML = '';
    this.users.filter(u => !djUserIds.has(u.id)).forEach(user => {
      const el = document.createElement('div');
      el.className = 'roster-user';

      const avatar = document.createElement('span');
      avatar.className = 'roster-user-avatar';
      avatar.textContent = AVATARS[user.avatarId] || '🎵';

      const name = document.createElement('span');
      name.className = 'roster-user-name';
      name.textContent = user.username + (user.id === myId ? ' (you)' : '');

      el.appendChild(avatar);
      el.appendChild(name);
      listenerContainer.appendChild(el);
    });

    // Update queue panel visibility
    Queue.updateVisibility(isDJ);
  }
};
