const Chat = {
  init() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    sendBtn.addEventListener('click', () => this.send());
  },

  send() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    Socket.emit('chat:message', { text });
    input.value = '';
  },

  onMessage(data) {
    const container = document.getElementById('chat-messages');
    const shouldScroll = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;

    const msg = document.createElement('div');
    msg.className = 'chat-msg';

    const avatar = document.createElement('span');
    avatar.className = 'chat-msg-avatar';
    avatar.textContent = AVATARS[data.avatarId] || '🎵';

    const username = document.createElement('span');
    username.className = 'chat-msg-username';
    username.textContent = data.username;

    const text = document.createElement('span');
    text.className = 'chat-msg-text';
    text.textContent = data.text;

    msg.appendChild(avatar);
    msg.appendChild(username);
    msg.appendChild(text);
    container.appendChild(msg);

    // Trim old messages (keep last 200 in DOM)
    while (container.children.length > 200) {
      container.removeChild(container.firstChild);
    }

    if (shouldScroll) {
      container.scrollTop = container.scrollHeight;
    }
  },

  onHistory(messages) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    if (!messages) return;
    messages.forEach(msg => this.onMessage(msg));
  },

  addSystemMessage(text) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = 'chat-msg chat-msg-system';
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }
};
