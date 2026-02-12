export class DJQueue {
  constructor(maxSlots = 5) {
    this.maxSlots = maxSlots;
    this.slots = []; // Array<{userId, username, avatarId, queue: Track[], totalAwesome: 0}>
    this.currentIndex = -1;
    this.reservedSlots = new Map(); // username -> { slot, timer, originalIndex }
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

    // Check if this videoId already exists in the DJ's queue
    if (dj.queue.some(t => t.videoId === track.videoId)) {
      return { error: 'Track already in your queue' };
    }

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

  reserveSlot(userId, username) {
    const index = this.slots.findIndex(d => d.userId === userId);
    if (index === -1) return false;

    const slot = { ...this.slots[index], queue: [...this.slots[index].queue] };
    const originalIndex = index;

    // Remove from active slots (same logic as stepDown)
    this.slots.splice(index, 1);
    if (this.slots.length === 0) {
      this.currentIndex = -1;
    } else if (index <= this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    // Clear any existing reservation for this username
    this.clearReservation(username);

    // Store reservation with 30-second expiry
    const timer = setTimeout(() => {
      this.reservedSlots.delete(username);
    }, 30000);

    this.reservedSlots.set(username, { slot, timer, originalIndex });
    return true;
  }

  claimReservation(username, newUserId, newAvatarId) {
    const reservation = this.reservedSlots.get(username);
    if (!reservation) return null;

    clearTimeout(reservation.timer);
    this.reservedSlots.delete(username);

    const slot = reservation.slot;
    slot.userId = newUserId;
    slot.avatarId = newAvatarId;

    // Re-insert at original position if possible, otherwise append
    const insertAt = Math.min(reservation.originalIndex, this.slots.length);
    this.slots.splice(insertAt, 0, slot);

    // Adjust currentIndex if we inserted before or at it
    if (this.currentIndex >= 0 && insertAt <= this.currentIndex) {
      this.currentIndex++;
    }

    return slot;
  }

  clearReservation(username) {
    const existing = this.reservedSlots.get(username);
    if (existing) {
      clearTimeout(existing.timer);
      this.reservedSlots.delete(username);
    }
  }

  hasReservation(username) {
    return this.reservedSlots.has(username);
  }

  clearAllReservations() {
    for (const [, reservation] of this.reservedSlots) {
      clearTimeout(reservation.timer);
    }
    this.reservedSlots.clear();
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
