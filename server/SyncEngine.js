export class SyncEngine {
  constructor(onTrackEnd) {
    this.currentTrack = null;
    this.currentDJ = null;
    this.playStartedAt = 0;
    this.isPlaying = false;
    this.pausedAt = 0;
    this.trackEndTimer = null;
    this.transitioning = false;
    this.onTrackEnd = onTrackEnd;
  }

  startTrack(track, djUserId, djUsername) {
    this.clearTimer();
    this.currentTrack = track;
    this.currentDJ = djUserId;
    this.currentDJUsername = djUsername || null;
    this.playStartedAt = Date.now();
    this.isPlaying = true;
    this.pausedAt = 0;
    this.transitioning = false;

    // Schedule track end with 1.5s buffer for network variance
    this.trackEndTimer = setTimeout(() => {
      this.handleTrackEnd();
    }, (track.duration + 1.5) * 1000);
  }

  handleTrackEnd() {
    if (this.transitioning) return;
    this.transitioning = true;

    // Log premature track endings for diagnostics
    if (this.currentTrack) {
      const elapsed = this.getElapsedSeconds();
      const duration = this.currentTrack.duration;
      if (elapsed < duration * 0.9) {
        console.log(`[SyncEngine] Track ended prematurely: "${this.currentTrack.title}" elapsed=${elapsed.toFixed(1)}s / duration=${duration}s`);
      }
    }

    this.clearTimer();
    this.isPlaying = false;
    this.currentTrack = null;
    this.currentDJ = null;
    this.currentDJUsername = null;
    if (this.onTrackEnd) this.onTrackEnd();
  }

  reportTrackEnded(videoId) {
    // Client reported track ended — cross-check
    if (this.currentTrack && this.currentTrack.videoId === videoId) {
      this.handleTrackEnd();
    }
  }

  getElapsedSeconds() {
    if (!this.isPlaying) return this.pausedAt;
    return (Date.now() - this.playStartedAt) / 1000;
  }

  getSyncState() {
    return {
      trackId: this.currentTrack?.videoId || null,
      title: this.currentTrack?.title || null,
      thumbnail: this.currentTrack?.thumbnail || null,
      duration: this.currentTrack?.duration || 0,
      dj: this.currentDJ ? { userId: this.currentDJ, username: this.currentDJUsername } : null,
      isPlaying: this.isPlaying,
      elapsed: this.getElapsedSeconds(),
      serverTime: Date.now()
    };
  }

  goIdle() {
    this.clearTimer();
    this.currentTrack = null;
    this.currentDJ = null;
    this.currentDJUsername = null;
    this.isPlaying = false;
    this.pausedAt = 0;
    this.transitioning = false;
  }

  clearTimer() {
    if (this.trackEndTimer) {
      clearTimeout(this.trackEndTimer);
      this.trackEndTimer = null;
    }
  }

  destroy() {
    this.clearTimer();
  }
}
