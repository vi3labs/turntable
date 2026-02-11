import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { searchVideos, getVideoInfo, extractVideoId } from './youtube.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.youtube.com", "https://s.ytimg.com"],
      frameSrc: ["https://www.youtube.com"],
      imgSrc: ["'self'", "https://i.ytimg.com", "https://*.ggpht.com", "https://api.qrserver.com", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    }
  },
  crossOriginEmbedderPolicy: false, // YouTube iframes need this off
}));

app.use(express.static('public'));
app.use(express.json());

const roomManager = new RoomManager();

// =============================================================================
// Rate Limiter (generic, reusable for sockets and REST)
// =============================================================================
class RateLimiter {
  constructor(maxHits, windowMs) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
    this.records = new Map();
  }

  check(key) {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }
    record.timestamps = record.timestamps.filter(t => now - t < this.windowMs);
    if (record.timestamps.length >= this.maxHits) return false;
    record.timestamps.push(now);
    return true;
  }

  delete(key) {
    this.records.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.records) {
      record.timestamps = record.timestamps.filter(t => now - t < this.windowMs);
      if (record.timestamps.length === 0) this.records.delete(key);
    }
  }
}

// Per-IP rate limiters
const chatLimiter = new RateLimiter(5, 10000);       // 5 msgs / 10s
const actionLimiter = new RateLimiter(10, 5000);      // 10 actions / 5s (DJ, vote, etc.)
const roomCreateLimiter = new RateLimiter(3, 60000);   // 3 rooms / 60s
const searchLimiter = new RateLimiter(10, 60000);      // 10 searches / 60s per IP

// =============================================================================
// Connection limits
// =============================================================================
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_TOTAL_ROOMS = 50;
const ipConnectionCounts = new Map();

function getSocketIP(socket) {
  return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.address
    || 'unknown';
}

io.use((socket, next) => {
  const ip = getSocketIP(socket);
  const count = ipConnectionCounts.get(ip) || 0;
  if (count >= MAX_CONNECTIONS_PER_IP) {
    return next(new Error('Too many connections'));
  }
  ipConnectionCounts.set(ip, count + 1);
  next();
});

// =============================================================================
// Input validation helpers
// =============================================================================
function isString(val) {
  return typeof val === 'string';
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isValidAvatarId(val) {
  return Number.isInteger(val) && val >= 0 && val <= 11;
}

function sanitizeString(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().substring(0, maxLen);
}

// Only allow YouTube thumbnail URLs
function isValidThumbnailUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return ['i.ytimg.com', 'i9.ytimg.com', 'img.youtube.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

// =============================================================================
// REST API (with rate limiting)
// =============================================================================
app.get('/api/youtube/search', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  if (!searchLimiter.check(ip)) {
    return res.status(429).json({ error: 'Too many searches. Try again later.' });
  }
  const q = req.query.q;
  if (!q || typeof q !== 'string') return res.json([]);
  const results = await searchVideos(q.substring(0, 200));
  if (results && results.quotaExceeded) {
    return res.status(503).json(results);
  }
  res.json(results);
});

app.get('/api/youtube/video/:id', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  if (!searchLimiter.check(ip)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  // Validate video ID format
  if (!/^[a-zA-Z0-9_-]{11}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }
  const info = await getVideoInfo(req.params.id);
  res.json(info || { error: 'Not found' });
});

// =============================================================================
// Helpers
// =============================================================================
function broadcastRoomList() {
  io.emit('room:list', roomManager.listRooms());
}

function advanceTrack(room) {
  const result = room.playNextTrack();
  if (result) {
    io.to(room.id).emit('track:play', {
      videoId: result.track.videoId,
      title: result.track.title,
      thumbnail: result.track.thumbnail,
      duration: result.track.duration,
      dj: result.dj,
      sync: result.sync
    });
    io.to(room.id).emit('vote:update', { awesome: 0, lame: 0 });
    io.to(room.id).emit('dj:update', room.getPublicDJState());
  } else {
    io.to(room.id).emit('track:idle');
  }
}

// =============================================================================
// Socket.io
// =============================================================================
io.on('connection', (socket) => {
  const socketIP = getSocketIP(socket);
  let currentRoomId = null;

  // --- Room list ---
  socket.on('room:list', () => {
    socket.emit('room:list', roomManager.listRooms());
  });

  // --- Create room ---
  socket.on('room:create', (data) => {
    if (!data || typeof data !== 'object') return;
    if (!isNonEmptyString(data.name) || !isNonEmptyString(data.username)) {
      return socket.emit('room:error', { message: 'Name and username required' });
    }

    if (!roomCreateLimiter.check(socketIP)) {
      return socket.emit('room:error', { message: 'Too many rooms created. Wait a minute.' });
    }

    if (roomManager.rooms.size >= MAX_TOTAL_ROOMS) {
      return socket.emit('room:error', { message: 'Server is full. Try again later.' });
    }

    const room = roomManager.createRoom(
      sanitizeString(data.name, 50),
      sanitizeString(data.theme, 30),
      socket.id
    );

    room.onTrackEndCallback = (r) => advanceTrack(r);

    socket.emit('room:created', { roomId: room.id });
    broadcastRoomList();
  });

  // --- Join room ---
  socket.on('room:join', (data) => {
    if (!data || typeof data !== 'object') return;
    if (!isString(data.roomId)) return;

    const room = roomManager.getRoom(data.roomId);
    if (!room) {
      return socket.emit('room:error', { message: 'Room not found' });
    }

    // Leave previous room if any
    if (currentRoomId && currentRoomId !== data.roomId) {
      leaveCurrentRoom(socket);
    }

    // Cancel pending room deletion
    if (room._deleteTimer) {
      clearTimeout(room._deleteTimer);
      room._deleteTimer = null;
    }

    const username = sanitizeString(data.username, 20) || 'anon';
    const avatarId = isValidAvatarId(data.avatarId) ? data.avatarId : 0;

    currentRoomId = data.roomId;
    socket.join(data.roomId);
    const { restored } = room.addUser(socket.id, username, avatarId);

    // Ensure track end callback is set
    if (!room.onTrackEndCallback) {
      room.onTrackEndCallback = (r) => advanceTrack(r);
    }

    // Send full state to joining client (includes myId)
    socket.emit('room:state', room.getFullState(socket.id));

    // Notify room
    const user = room.users.get(socket.id);
    socket.to(data.roomId).emit('user:joined', room.sanitizeUser(user));
    io.to(data.roomId).emit('roster:update', { users: room.sanitizeUsers() });

    if (restored) {
      io.to(data.roomId).emit('chat:system', {
        text: username + ' reconnected and reclaimed their DJ slot'
      });
      io.to(data.roomId).emit('dj:update', room.getPublicDJState());
    }

    broadcastRoomList();
  });

  // --- Leave room ---
  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
  });

  // --- Clock sync ---
  socket.on('ping:sync', (data, callback) => {
    if (typeof callback === 'function' && data && typeof data.t0 === 'number') {
      callback({ t0: data.t0, t1: Date.now() });
    }
  });

  // --- DJ ---

  socket.on('dj:stepUp', () => {
    if (!currentRoomId) return;
    if (!actionLimiter.check(socketIP)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user) return;

    const result = room.djQueue.stepUp(socket.id, user.username, user.avatarId);
    if (result.error) {
      return socket.emit('room:error', { message: result.error });
    }

    user.role = 'dj';
    io.to(currentRoomId).emit('dj:update', room.getPublicDJState());
    io.to(currentRoomId).emit('roster:update', { users: room.sanitizeUsers() });
  });

  socket.on('dj:stepDown', () => {
    if (!currentRoomId) return;
    if (!actionLimiter.check(socketIP)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user) return;

    room.djQueue.stepDown(socket.id);
    user.role = 'listener';

    io.to(currentRoomId).emit('dj:update', room.getPublicDJState());
    io.to(currentRoomId).emit('roster:update', { users: room.sanitizeUsers() });
  });

  socket.on('dj:queueTrack', async (data) => {
    if (!currentRoomId) return;
    if (!data || typeof data !== 'object') return;
    if (!actionLimiter.check(socketIP)) {
      return socket.emit('room:error', { message: 'Slow down!' });
    }

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    // Must be a DJ to queue tracks
    if (!room.djQueue.isDJ(socket.id)) {
      return socket.emit('room:error', { message: 'You must be a DJ to queue tracks' });
    }

    let track;
    const { videoId, url, title, thumbnail, duration } = data;

    if (isString(videoId) && isNonEmptyString(title) && typeof duration === 'number' && duration > 0) {
      // Full track info from search results — validate videoId format
      const cleanId = extractVideoId(videoId) || videoId;
      if (!/^[a-zA-Z0-9_-]{11}$/.test(cleanId)) {
        return socket.emit('room:error', { message: 'Invalid video ID' });
      }
      track = {
        videoId: cleanId,
        title: sanitizeString(title, 200),
        thumbnail: isValidThumbnailUrl(thumbnail) ? thumbnail : '',
        duration: Math.min(Math.max(duration, 1), 43200) // Cap at 12 hours
      };
    } else if (isString(url) || isString(videoId)) {
      const id = extractVideoId(url || videoId);
      if (!id) {
        return socket.emit('room:error', { message: 'Invalid YouTube URL' });
      }
      const info = await getVideoInfo(id);
      if (info && !info.error) {
        track = info;
      } else {
        track = { videoId: id, title: 'Loading...', thumbnail: '', duration: 300 };
      }
    } else {
      return socket.emit('room:error', { message: 'No video specified' });
    }

    track.addedAt = Date.now();

    const result = room.djQueue.addTrack(socket.id, track);
    if (result.error) {
      return socket.emit('room:error', { message: result.error });
    }

    io.to(currentRoomId).emit('dj:update', room.getPublicDJState());

    // Notify room that a track was added
    const queueUser = room.users.get(socket.id);
    io.to(currentRoomId).emit('chat:system', {
      text: queueUser.username + ' queued "' + track.title.substring(0, 50) + '"'
    });

    // If room is idle, start playing immediately
    if (!room.syncEngine.isPlaying && !room.syncEngine.currentTrack) {
      advanceTrack(room);
    }
  });

  socket.on('dj:removeTrack', (data) => {
    if (!currentRoomId) return;
    if (!data || typeof data !== 'object') return;
    if (!actionLimiter.check(socketIP)) return;

    const trackIndex = data.trackIndex;
    if (!Number.isInteger(trackIndex)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const result = room.djQueue.removeTrack(socket.id, trackIndex);
    if (result.error) {
      return socket.emit('room:error', { message: result.error });
    }

    io.to(currentRoomId).emit('dj:update', room.getPublicDJState());
  });

  // --- DJ skip own track ---

  socket.on('dj:skipTrack', () => {
    if (!currentRoomId) return;
    if (!actionLimiter.check(socketIP)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    // Only the current DJ can skip their own track
    if (room.syncEngine.currentDJ !== socket.id) return;

    const user = room.users.get(socket.id);
    io.to(currentRoomId).emit('track:skip', {
      reason: (user?.username || 'DJ') + ' skipped their track'
    });
    room.syncEngine.handleTrackEnd();
  });

  // --- Voting ---

  socket.on('vote:awesome', () => {
    if (!currentRoomId) return;
    if (!actionLimiter.check(socketIP)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const result = room.vote(socket.id, 'awesome');
    if (result) {
      io.to(currentRoomId).emit('vote:update', {
        awesome: result.awesome,
        lame: result.lame
      });
    }
  });

  socket.on('vote:lame', () => {
    if (!currentRoomId) return;
    if (!actionLimiter.check(socketIP)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const result = room.vote(socket.id, 'lame');
    if (result) {
      io.to(currentRoomId).emit('vote:update', {
        awesome: result.awesome,
        lame: result.lame
      });

      if (result.shouldSkip) {
        io.to(currentRoomId).emit('track:skip', { reason: 'Voted off!' });
        room.syncEngine.handleTrackEnd();
      }
    }
  });

  // --- Chat ---

  socket.on('chat:message', (data) => {
    if (!currentRoomId) return;
    if (!data || typeof data !== 'object') return;
    if (!isString(data.text) || !data.text.trim()) return;

    if (!chatLimiter.check(socketIP)) {
      return socket.emit('room:error', { message: 'Slow down! Too many messages.' });
    }

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user) return;

    const message = {
      userId: user.publicId,
      username: user.username,
      avatarId: user.avatarId,
      text: sanitizeString(data.text, 500),
      timestamp: Date.now()
    };

    // Store with socket ID internally for lookup, send public ID to clients
    room.addChatMessage({ ...message, userId: socket.id });
    io.to(currentRoomId).emit('chat:message', message);
  });

  // --- Track events from client ---

  // Only the current DJ can report metadata
  socket.on('track:metadata', (data) => {
    if (!currentRoomId) return;
    if (!data || typeof data !== 'object') return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;

    const sync = room.syncEngine;

    // SECURITY: Only accept metadata from the current DJ
    if (sync.currentDJ !== socket.id) return;

    if (!isString(data.videoId) || sync.currentTrack?.videoId !== data.videoId) return;

    if (isNonEmptyString(data.title)) {
      sync.currentTrack.title = sanitizeString(data.title, 200);
    }

    if (typeof data.duration === 'number' && data.duration > 0) {
      // Cap duration to reasonable range (1 sec to 12 hours)
      const duration = Math.min(Math.max(Math.round(data.duration), 1), 43200);
      sync.currentTrack.duration = duration;

      // Reset the track end timer with the real duration
      sync.clearTimer();
      const elapsed = sync.getElapsedSeconds();
      const remaining = duration - elapsed + 1.5;
      if (remaining > 0) {
        sync.trackEndTimer = setTimeout(() => sync.handleTrackEnd(), remaining * 1000);
      }
    }

    io.to(currentRoomId).emit('track:metadata:update', {
      videoId: data.videoId,
      title: sync.currentTrack.title,
      duration: sync.currentTrack.duration
    });
  });

  socket.on('track:ended', (data) => {
    if (!currentRoomId) return;
    if (!data || typeof data !== 'object') return;
    if (!isString(data.videoId)) return;

    const room = roomManager.getRoom(currentRoomId);
    if (!room) return;
    room.syncEngine.reportTrackEnded(data.videoId);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    // Decrement IP connection count
    const count = ipConnectionCounts.get(socketIP) || 0;
    if (count <= 1) {
      ipConnectionCounts.delete(socketIP);
    } else {
      ipConnectionCounts.set(socketIP, count - 1);
    }

    leaveCurrentRoom(socket);
  });

  function leaveCurrentRoom(sock) {
    if (!currentRoomId) return;
    const room = roomManager.getRoom(currentRoomId);
    const roomId = currentRoomId;
    currentRoomId = null;

    if (!room) return;

    // Get public ID before removing user
    const publicId = room.getPublicId(sock.id);

    room.removeUser(sock.id);
    sock.leave(roomId);

    io.to(roomId).emit('user:left', { userId: publicId });
    io.to(roomId).emit('roster:update', { users: room.sanitizeUsers() });
    io.to(roomId).emit('dj:update', room.getPublicDJState());

    // Delete empty rooms after grace period
    if (room.users.size === 0) {
      if (room._deleteTimer) clearTimeout(room._deleteTimer);
      room._deleteTimer = setTimeout(() => {
        if (room.users.size === 0) {
          roomManager.deleteRoom(roomId);
          broadcastRoomList();
        }
      }, 10000);
    }

    broadcastRoomList();
  }
});

// Periodic rate limiter cleanup (every 5 min)
setInterval(() => {
  chatLimiter.cleanup();
  actionLimiter.cleanup();
  roomCreateLimiter.cleanup();
  searchLimiter.cleanup();
}, 5 * 60 * 1000);

// Periodic sync broadcast (every 5 seconds for active rooms)
setInterval(() => {
  for (const [roomId, room] of roomManager.rooms) {
    if (room.syncEngine.isPlaying) {
      io.to(roomId).emit('track:sync', room.getPublicSyncState());
    }
  }
}, 5000);

export { httpServer, io, roomManager, chatLimiter, actionLimiter, roomCreateLimiter, searchLimiter };

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  const PORT = process.env.PORT || 3005;
  httpServer.listen(PORT, () => {
    console.log(`Turntable server running on http://localhost:${PORT}`);
  });
}
