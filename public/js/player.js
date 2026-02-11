const Player = {
  ytPlayer: null,
  isReady: false,
  clockOffset: 0,
  currentVideoId: null,
  currentDuration: 0,
  isPlaying: false,
  autoplayBlocked: false,
  progressInterval: null,
  _autoplayCheckTimer: null,
  _userPaused: false,
  _pendingTrack: null,  // Track waiting for YouTube API to be ready
  _lastLoadTime: null,

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
          controls: 1,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          origin: window.location.origin,
          autoplay: 1
        },
        events: {
          onReady: () => {
            this.isReady = true;
            // Load any track that arrived before the API was ready
            if (this._pendingTrack) {
              const p = this._pendingTrack;
              this._pendingTrack = null;
              this.loadTrack(p.videoId, p.seekTo);
            }
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
    this._lastLoadTime = Date.now();

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
    this.currentDuration = data.duration;
    this.isPlaying = true;

    document.getElementById('player-idle').classList.add('hidden');

    const seekTo = data.sync ? data.sync.elapsed : 0;

    if (this.isReady) {
      this.currentVideoId = data.videoId;
      this.ytPlayer.loadVideoById({
        videoId: data.videoId,
        startSeconds: seekTo
      });
    } else {
      // YouTube API not ready yet — queue for when it is
      this._pendingTrack = { videoId: data.videoId, seekTo };
      // Don't set currentVideoId so sync() will retry loading when API is ready
      this.currentVideoId = null;
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
      // Detect suspiciously fast endings (embed failures)
      if (this.currentVideoId && this._lastLoadTime) {
        const playDuration = (Date.now() - this._lastLoadTime) / 1000;
        if (playDuration < 5 && this.currentDuration > 30) {
          Toast.show('Track may have failed to load properly', 'error');
          Socket.emit('track:ended', {
            videoId: this.currentVideoId,
            error: true,
            errorReason: 'Track ended suspiciously fast (' + Math.round(playDuration) + 's)'
          });
          return;
        }
      }
      Socket.emit('track:ended', { videoId: this.currentVideoId });
    }

    // When video starts playing: hide autoplay overlay + report metadata once
    if (event.data === YT.PlayerState.PLAYING) {
      // Always dismiss the autoplay overlay when we're actually playing
      this.autoplayBlocked = false;
      this._userPaused = false;
      if (this._autoplayCheckTimer) {
        clearTimeout(this._autoplayCheckTimer);
        this._autoplayCheckTimer = null;
      }
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

    // Detect autoplay block — check if we're not playing after loading
    if (event.data === YT.PlayerState.UNSTARTED && this.currentVideoId) {
      if (this._autoplayCheckTimer) clearTimeout(this._autoplayCheckTimer);
      this._autoplayCheckTimer = setTimeout(() => {
        const state = this.ytPlayer.getPlayerState();
        if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
          this.autoplayBlocked = true;
          document.getElementById('autoplay-overlay').classList.remove('hidden');
        }
      }, 2000);
    }

    // Also detect autoplay block from CUED state (loadVideoById failed to autoplay)
    if (event.data === YT.PlayerState.CUED && this.currentVideoId) {
      this.autoplayBlocked = true;
      document.getElementById('autoplay-overlay').classList.remove('hidden');
    }

    // Detect pause immediately after load (browser blocked autoplay mid-play)
    if (event.data === YT.PlayerState.PAUSED && this.currentVideoId && !this._userPaused) {
      const currentTime = this.ytPlayer.getCurrentTime();
      if (currentTime < 1) {
        this.autoplayBlocked = true;
        document.getElementById('autoplay-overlay').classList.remove('hidden');
      }
    }
  },

  onError(event) {
    const code = event.data;
    const messages = {
      2: 'Invalid video ID',
      5: 'HTML5 player error',
      100: 'Video not found or removed',
      101: 'Embedding not allowed by video owner',
      150: 'Embedding not allowed by video owner'
    };
    const reason = messages[code] || 'Unknown player error (code ' + code + ')';
    Toast.show(reason + '. Skipping...', 'error');
    Socket.emit('track:ended', {
      videoId: this.currentVideoId,
      error: true,
      errorCode: code,
      errorReason: reason
    });
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
