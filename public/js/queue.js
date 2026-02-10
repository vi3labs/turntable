const Queue = {
  myQueue: [],
  isDJ: false,
  searchTimeout: null,

  init() {
    const input = document.getElementById('add-track-input');
    const addBtn = document.getElementById('add-track-btn');

    input.addEventListener('input', () => {
      clearTimeout(this.searchTimeout);
      const value = input.value.trim();
      if (!value) {
        document.getElementById('search-results').classList.add('hidden');
        return;
      }
      // Debounce search
      this.searchTimeout = setTimeout(() => this.handleInput(value), 400);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        if (value) this.handleInput(value);
      }
    });

    addBtn.addEventListener('click', () => {
      const value = document.getElementById('add-track-input').value.trim();
      if (value) this.handleInput(value);
    });

    // Sidebar tab switching
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      });
    });
  },

  async handleInput(value) {
    // Check if it's a YouTube URL
    const urlPatterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];

    let videoId = null;
    for (const pattern of urlPatterns) {
      const match = value.match(pattern);
      if (match) {
        videoId = match[1];
        break;
      }
    }

    if (videoId) {
      // Direct URL/ID — queue immediately
      Socket.emit('dj:queueTrack', { url: value });
      document.getElementById('add-track-input').value = '';
      document.getElementById('search-results').classList.add('hidden');
      Toast.show('Adding track...');
    } else {
      // Search YouTube
      await this.search(value);
    }
  },

  async search(query) {
    const resultsEl = document.getElementById('search-results');

    try {
      const response = await fetch('/api/youtube/search?q=' + encodeURIComponent(query));
      const results = await response.json();

      if (results.error) {
        resultsEl.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px;">Search unavailable. Try pasting a YouTube URL instead.</div>';
        resultsEl.classList.remove('hidden');
        return;
      }

      if (!Array.isArray(results) || results.length === 0) {
        resultsEl.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px;">No results found.</div>';
        resultsEl.classList.remove('hidden');
        return;
      }

      resultsEl.innerHTML = '';
      results.forEach(track => {
        const el = document.createElement('div');
        el.className = 'search-result';

        const thumb = document.createElement('img');
        thumb.className = 'search-result-thumb';
        thumb.src = track.thumbnail || '';
        thumb.alt = '';
        thumb.loading = 'lazy';

        const info = document.createElement('div');
        info.className = 'search-result-info';

        const title = document.createElement('div');
        title.className = 'search-result-title';
        title.textContent = track.title;

        const channel = document.createElement('div');
        channel.className = 'search-result-channel';
        channel.textContent = track.channel + ' · ' + formatTime(track.duration);

        info.appendChild(title);
        info.appendChild(channel);

        const addBtn = document.createElement('button');
        addBtn.className = 'search-result-add';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addFromSearch(track);
        });

        el.appendChild(thumb);
        el.appendChild(info);
        el.appendChild(addBtn);

        el.addEventListener('click', () => this.addFromSearch(track));

        resultsEl.appendChild(el);
      });

      resultsEl.classList.remove('hidden');
    } catch (err) {
      resultsEl.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px;">Search failed. Try pasting a YouTube URL.</div>';
      resultsEl.classList.remove('hidden');
    }
  },

  addFromSearch(track) {
    Socket.emit('dj:queueTrack', {
      videoId: track.videoId,
      title: track.title,
      thumbnail: track.thumbnail,
      duration: track.duration
    });
    document.getElementById('add-track-input').value = '';
    document.getElementById('search-results').classList.add('hidden');
    Toast.show('Added: ' + track.title.substring(0, 40));
  },

  onDJUpdate(data) {
    const myId = Socket.myId;
    const mySlot = data.slots.find(s => s.userId === myId);

    this.isDJ = !!mySlot;
    this.myQueue = mySlot ? mySlot.queue : [];

    this.renderQueue();
  },

  renderQueue() {
    const container = document.getElementById('queue-tracks');
    const emptyEl = document.getElementById('queue-empty');
    const addSection = document.getElementById('add-track-section');

    if (!this.isDJ) {
      container.innerHTML = '';
      emptyEl.classList.add('hidden');
      addSection.classList.add('hidden');
      container.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px 0;">Step up as a DJ to queue tracks!</div>';
      return;
    }

    addSection.classList.remove('hidden');

    if (this.myQueue.length === 0) {
      container.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    container.innerHTML = '';

    this.myQueue.forEach((track, index) => {
      const el = document.createElement('div');
      el.className = 'queue-track';

      const thumb = document.createElement('img');
      thumb.className = 'queue-track-thumb';
      thumb.src = track.thumbnail || '';
      thumb.alt = '';

      const info = document.createElement('div');
      info.className = 'queue-track-info';

      const title = document.createElement('div');
      title.className = 'queue-track-title';
      title.textContent = track.title || track.videoId;

      const duration = document.createElement('div');
      duration.className = 'queue-track-duration';
      duration.textContent = formatTime(track.duration || 0);

      info.appendChild(title);
      info.appendChild(duration);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-track-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        Socket.emit('dj:removeTrack', { trackIndex: index });
      });

      el.appendChild(thumb);
      el.appendChild(info);
      el.appendChild(removeBtn);
      container.appendChild(el);
    });
  },

  updateVisibility(isDJ) {
    this.isDJ = isDJ;
    const addSection = document.getElementById('add-track-section');
    if (!isDJ) {
      addSection.classList.add('hidden');
    } else {
      addSection.classList.remove('hidden');
    }
  }
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
