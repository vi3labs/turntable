const Player = {
  ytPlayer: null,
  isReady: false,
  clockOffset: 0,
  currentVideoId: null,
  currentDuration: 0,
  isPlaying: false,
  autoplayBlocked: false,
  progressInterval: null,

  init(containerId) {
    // Load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      this.ytPlayer = new YT.Player(containerId, {
        height: '100%',
        width: '100%',
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            this.isReady = true;
          },
          onStateChange: (e) => this.onStateChange(e),
          onError: (e) => this.onError(e)
        }
      });
    };

    // Autoplay overlay
    const overlay = document.getElementById('autoplay-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        overlay.classList.add('hidden');
        this.autoplayBlocked = false;
        if (this.currentVideoId) {
          this.ytPlayer.playVideo();
        }
      });
    }

    // Start progress updater
    this.progressInterval = setInterval(() => this.updateProgress(), 1000);
  },

  async calibrateClock() {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const response = await new Promise((resolve) => {
        Socket.emit('ping:sync', { t0 }, resolve);
      });
      const t2 = Date.now();
      const rtt = t2 - t0;
      const offset = response.t1 - t0 - (rtt / 2);
      samples.push(offset);
      await new Promise(r => setTimeout(r, 200));
    }
    samples.sort((a, b) => a - b);
    this.clockOffset = samples[1]; // Median
  },

  loadTrack(videoId, seekTo = 0) {
    if (!this.isReady) return;
    this.currentVideoId = videoId;
    this._metadataReported = false;

    document.getElementById('player-idle').classList.add('hidden');

    this.ytPlayer.loadVideoById({
      videoId,
      startSeconds: seekTo
    });
  },

  sync(serverState) {
    if (!this.isReady || !serverState.trackId) return;

    // If different track, load it
    if (serverState.trackId !== this.currentVideoId) {
      this.currentVideoId = serverState.trackId;
      this.currentDuration = serverState.duration;
      this.loadTrack(serverState.trackId, serverState.elapsed);
      this.updateNowPlaying(serverState);
      return;
    }

    if (this.autoplayBlocked) return;

    // Calculate where we should be
    const timeSinceMessage = (Date.now() - serverState.serverTime + this.clockOffset) / 1000;
    const targetElapsed = serverState.elapsed + timeSinceMessage;
    const currentTime = this.ytPlayer.getCurrentTime();
    const drift = Math.abs(targetElapsed - currentTime);

    if (drift > 2.0) {
      this.ytPlayer.seekTo(targetElapsed, true);
    } else if (drift > 0.5) {
      this.ytPlayer.seekTo(targetElapsed, true);
    }

    // Ensure play/pause state matches
    const state = this.ytPlayer.getPlayerState();
    if (serverState.isPlaying && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
      this.ytPlayer.playVideo();
    } else if (!serverState.isPlaying && state === YT.PlayerState.PLAYING) {
      this.ytPlayer.pauseVideo();
    }

    this.updateNowPlaying(serverState);
  },

  onTrackPlay(data) {
    this.currentVideoId = data.videoId;
    this.currentDuration = data.duration;
    this.isPlaying = true;

    document.getElementById('player-idle').classList.add('hidden');

    if (this.isReady) {
      const seekTo = data.sync ? data.sync.elapsed : 0;
      this.ytPlayer.loadVideoById({
        videoId: data.videoId,
        startSeconds: seekTo
      });
    }

    this.updateNowPlaying({
      title: data.title,
      dj: data.dj,
      duration: data.duration,
      elapsed: 0
    });
  },

  onIdle() {
    this.currentVideoId = null;
    this.currentDuration = 0;
    this.isPlaying = false;

    if (this.isReady && this.ytPlayer.stopVideo) {
      this.ytPlayer.stopVideo();
    }

    document.getElementById('player-idle').classList.remove('hidden');
    document.getElementById('np-title').textContent = 'No track playing';
    document.getElementById('np-dj').textContent = '';
    document.getElementById('np-time').textContent = '';
    document.getElementById('progress-fill').style.width = '0%';
  },

  onSkip(data) {
    Toast.show(data.reason || 'Track skipped!');
  },

  onStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
      Socket.emit('track:ended', { videoId: this.currentVideoId });
    }

    // When video starts playing: hide autoplay overlay + report metadata once
    if (event.data === YT.PlayerState.PLAYING) {
      // Always dismiss the autoplay overlay when we're actually playing
      this.autoplayBlocked = false;
      document.getElementById('autoplay-overlay').classList.add('hidden');

      // Report real metadata to server (only once per video)
      if (this.currentVideoId && !this._metadataReported) {
        this._metadataReported = true;
        const videoData = this.ytPlayer.getVideoData();
        const duration = this.ytPlayer.getDuration();
        if (videoData && videoData.title) {
          Socket.emit('track:metadata', {
            videoId: this.currentVideoId,
            title: videoData.title,
            duration: Math.round(duration)
          });
          this.currentDuration = duration;
          document.getElementById('np-title').textContent = videoData.title;
        }
      }
    }

    // Detect autoplay block — only if we're stuck UNSTARTED well after loading
    if (event.data === YT.PlayerState.UNSTARTED && this.currentVideoId) {
      setTimeout(() => {
        const state = this.ytPlayer.getPlayerState();
        if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
          this.autoplayBlocked = true;
          document.getElementById('autoplay-overlay').classList.remove('hidden');
        }
      }, 3000);
    }
  },

  onError(event) {
    const code = event.data;
    // 2 = invalid param, 5 = HTML5 player error, 100 = not found, 101/150 = embed blocked
    if ([2, 5, 100, 101, 150].includes(code)) {
      const messages = {
        2: 'Invalid video ID',
        5: 'Playback error',
        100: 'Video not found',
        101: 'Embedding not allowed',
        150: 'Embedding not allowed'
      };
      Toast.show((messages[code] || 'Player error') + '. Skipping...', 'error');
      Socket.emit('track:ended', { videoId: this.currentVideoId, error: 'playback_error' });
    }
  },

  updateNowPlaying(state) {
    if (state.title) {
      document.getElementById('np-title').textContent = state.title;
    }
    if (state.dj) {
      const djName = typeof state.dj === 'object' ? state.dj.username : state.dj;
      document.getElementById('np-dj').textContent = 'DJ: ' + djName;
    }
    if (state.duration) {
      this.currentDuration = state.duration;
    }
  },

  updateProgress() {
    if (!this.isReady || !this.currentVideoId) return;

    const currentTime = this.ytPlayer.getCurrentTime() || 0;
    const duration = this.currentDuration || this.ytPlayer.getDuration() || 0;

    if (duration > 0) {
      const pct = Math.min(100, (currentTime / duration) * 100);
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('np-time').textContent =
        formatTime(currentTime) + ' / ' + formatTime(duration);
    }
  },

  destroy() {
    if (this.progressInterval) clearInterval(this.progressInterval);
    if (this.ytPlayer) this.ytPlayer.destroy();
  }
};
