import { nanoid } from 'nanoid';
import { SyncEngine } from './SyncEngine.js';
import { DJQueue } from './DJQueue.js';

export class Room {
  constructor(id, name, theme, creatorId) {
    this.id = id;
    this.name = name;
    this.theme = theme || '';
    this.createdAt = Date.now();
    this.createdBy = creatorId;

    this.users = new Map(); // Map<socketId, User>
    this.socketToPublicId = new Map(); // socketId -> publicId
    this.djQueue = new DJQueue(5);
    this.syncEngine = new SyncEngine(() => this.onTrackEnd());

    // Votes for current track
    this.votes = {
      awesome: new Set(),
      lame: new Set(),
      trackId: null
    };

    // Chat history (last 100 messages)
    this.chatHistory = [];
    this.maxChatHistory = 100;

    // Callback set by RoomManager
    this.onTrackEndCallback = null;
  }

  addUser(socketId, username, avatarId) {
    const publicId = nanoid(8);
    this.socketToPublicId.set(socketId, publicId);

    let role = 'listener';

    // Check for DJ slot reservation (reconnecting DJ)
    const restored = this.djQueue.claimReservation(username, socketId, avatarId);
    if (restored) {
      role = 'dj';
    }

    this.users.set(socketId, {
      id: socketId,
      publicId,
      username,
      avatarId,
      role,
      reputation: 0,
      joinedAt: Date.now()
    });
    return { publicId, restored: !!restored };
  }

  removeUser(socketId) {
    const user = this.users.get(socketId);
    if (!user) return;

    // If DJ, reserve slot for reconnection (30s grace period)
    if (this.djQueue.isDJ(socketId)) {
      this.djQueue.reserveSlot(socketId, user.username);
    }

    this.users.delete(socketId);
    this.socketToPublicId.delete(socketId);

    // Remove their votes
    this.votes.awesome.delete(socketId);
    this.votes.lame.delete(socketId);
  }

  getPublicId(socketId) {
    return this.socketToPublicId.get(socketId) || null;
  }

  // Sanitize a user object for client consumption (no socket IDs)
  sanitizeUser(user) {
    return {
      id: user.publicId,
      username: user.username,
      avatarId: user.avatarId,
      role: user.role,
      reputation: user.reputation
    };
  }

  sanitizeUsers() {
    return [...this.users.values()].map(u => this.sanitizeUser(u));
  }

  // Get DJ state with public IDs instead of socket IDs
  getPublicDJState() {
    const state = this.djQueue.getState();
    return {
      ...state,
      slots: state.slots.map(s => ({
        ...s,
        userId: this.getPublicId(s.userId) || s.userId
      }))
    };
  }

  // Get sync state with public IDs
  getPublicSyncState() {
    const state = this.syncEngine.getSyncState();
    if (state.dj) {
      state.dj = {
        userId: this.getPublicId(state.dj.userId) || state.dj.userId,
        username: state.dj.username
      };
    }
    return state;
  }

  addChatMessage(message) {
    this.chatHistory.push(message);
    if (this.chatHistory.length > this.maxChatHistory) {
      this.chatHistory.shift();
    }
  }

  // Get chat history with public IDs
  getPublicChatHistory() {
    return this.chatHistory.map(msg => ({
      ...msg,
      userId: this.getPublicId(msg.userId) || msg.userId
    }));
  }

  vote(socketId, voteType) {
    if (!this.syncEngine.currentTrack) return null;
    const user = this.users.get(socketId);
    if (!user) return null;

    // Can't vote on your own track
    if (this.syncEngine.currentDJ === socketId) return null;

    // Remove previous vote
    this.votes.awesome.delete(socketId);
    this.votes.lame.delete(socketId);

    if (voteType === 'awesome') {
      this.votes.awesome.add(socketId);
    } else if (voteType === 'lame') {
      this.votes.lame.add(socketId);
    }

    // Check skip threshold (60% lame, minimum 3 users)
    const totalUsers = this.users.size;
    const lameCount = this.votes.lame.size;
    const skipThreshold = Math.ceil(totalUsers * 0.6);

    const shouldSkip = lameCount >= skipThreshold && totalUsers >= 3;

    return {
      awesome: this.votes.awesome.size,
      lame: this.votes.lame.size,
      shouldSkip
    };
  }

  resetVotes() {
    const awesomeCount = this.votes.awesome.size;
    this.votes.awesome.clear();
    this.votes.lame.clear();
    this.votes.trackId = null;
    return awesomeCount;
  }

  onTrackEnd() {
    // Award reputation to DJ
    const awesomeCount = this.resetVotes();
    if (this.syncEngine.currentDJ) {
      this.djQueue.awardReputation(this.syncEngine.currentDJ, awesomeCount);
      const user = this.users.get(this.syncEngine.currentDJ);
      if (user) user.reputation += awesomeCount;
    }

    if (this.onTrackEndCallback) {
      this.onTrackEndCallback(this);
    }
  }

  playNextTrack() {
    const next = this.djQueue.getNextTrack();
    if (!next) {
      this.syncEngine.goIdle();
      return null;
    }

    this.votes.trackId = next.track.videoId;
    this.syncEngine.startTrack(next.track, next.dj.userId, next.dj.username);

    return {
      track: next.track,
      dj: {
        userId: this.getPublicId(next.dj.userId) || next.dj.userId,
        username: next.dj.username
      },
      sync: this.getPublicSyncState()
    };
  }

  getFullState(forSocketId) {
    return {
      id: this.id,
      name: this.name,
      theme: this.theme,
      myId: this.getPublicId(forSocketId),
      users: this.sanitizeUsers(),
      djSlots: this.getPublicDJState(),
      sync: this.getPublicSyncState(),
      votes: {
        awesome: this.votes.awesome.size,
        lame: this.votes.lame.size
      },
      chatHistory: this.getPublicChatHistory()
    };
  }

  getSummary() {
    return {
      id: this.id,
      name: this.name,
      theme: this.theme,
      userCount: this.users.size,
      djCount: this.djQueue.slots.length,
      currentTrack: this.syncEngine.currentTrack?.title || null,
      currentDJ: this.syncEngine.currentDJ
        ? this.users.get(this.syncEngine.currentDJ)?.username || null
        : null
    };
  }

  destroy() {
    this.syncEngine.destroy();
    this.djQueue.clearAllReservations();
  }
}
