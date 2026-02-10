export class DJQueue {
  constructor(maxSlots = 5) {
    this.maxSlots = maxSlots;
    this.slots = []; // Array<{userId, username, avatarId, queue: Track[], totalAwesome: 0}>
    this.currentIndex = -1;
  }

  stepUp(userId, username, avatarId) {
    if (this.slots.length >= this.maxSlots) {
      return { error: 'DJ slots full' };
    }
    if (this.slots.find(d => d.userId === userId)) {
      return { error: 'Already a DJ' };
    }
    this.slots.push({
      userId,
      username,
      avatarId,
      queue: [],
      totalAwesome: 0
    });
    return { success: true, position: this.slots.length - 1 };
  }

  stepDown(userId) {
    const index = this.slots.findIndex(d => d.userId === userId);
    if (index === -1) return { error: 'Not a DJ' };

    this.slots.splice(index, 1);

    if (this.slots.length === 0) {
      this.currentIndex = -1;
    } else if (index <= this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    return { success: true };
  }

  addTrack(userId, track) {
    const dj = this.slots.find(d => d.userId === userId);
    if (!dj) return { error: 'Not a DJ' };
    if (dj.queue.length >= 20) return { error: 'Queue full (max 20 tracks)' };
    dj.queue.push(track);
    return { success: true, position: dj.queue.length - 1 };
  }

  removeTrack(userId, trackIndex) {
    const dj = this.slots.find(d => d.userId === userId);
    if (!dj) return { error: 'Not a DJ' };
    if (trackIndex < 0 || trackIndex >= dj.queue.length) return { error: 'Invalid index' };
    dj.queue.splice(trackIndex, 1);
    return { success: true };
  }

  getNextTrack() {
    if (this.slots.length === 0) return null;

    const startIndex = this.currentIndex;
    let attempts = 0;

    while (attempts < this.slots.length) {
      this.currentIndex = (this.currentIndex + 1) % this.slots.length;
      const dj = this.slots[this.currentIndex];

      if (dj.queue.length > 0) {
        const track = dj.queue.shift();
        return { track, dj };
      }
      attempts++;
    }

    // All DJs have empty queues
    return null;
  }

  isDJ(userId) {
    return this.slots.some(d => d.userId === userId);
  }

  getDJ(userId) {
    return this.slots.find(d => d.userId === userId);
  }

  awardReputation(userId, points) {
    const dj = this.slots.find(d => d.userId === userId);
    if (dj) dj.totalAwesome += points;
  }

  getState() {
    return {
      slots: this.slots.map(d => ({
        userId: d.userId,
        username: d.username,
        avatarId: d.avatarId,
        queueLength: d.queue.length,
        queue: d.queue,
        totalAwesome: d.totalAwesome
      })),
      currentIndex: this.currentIndex,
      maxSlots: this.maxSlots
    };
  }
}
