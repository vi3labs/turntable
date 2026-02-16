#!/usr/bin/env node

/**
 * Morning DJ Bot
 *
 * Creates a Turntable room with a random track from the morning playlist.
 * Stays connected to keep the room alive until the user joins.
 *
 * Usage: node morning-dj.js
 * Output: JSON with roomId and track info
 */

import { io } from 'socket.io-client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const playlist = JSON.parse(readFileSync(join(__dirname, 'morning-playlist.json'), 'utf-8'));

// Pick a random track
const track = playlist[Math.floor(Math.random() * playlist.length)];

const SERVER = process.env.TURNTABLE_URL || 'http://localhost:3005';
const socket = io(SERVER, { timeout: 10000 });

let roomId = null;

socket.on('connect', () => {
  // Create room with seed track
  socket.emit('room:create', {
    name: 'Morning Vibes',
    username: 'MorningDJ',
    theme: 'chill',
    seedTracks: [{ videoId: track.videoId }]
  });
});

socket.on('room:created', (data) => {
  roomId = data.roomId;

  // Join the room to trigger seed track auto-play
  socket.emit('room:join', {
    roomId: roomId,
    username: 'MorningDJ',
    avatarId: 7
  });
});

socket.on('room:state', () => {
  // Output result for the morning briefing to capture
  const result = {
    roomId,
    track: track.title,
    videoId: track.videoId,
    localUrl: `${SERVER}/room.html?id=${roomId}`,
  };
  console.log(JSON.stringify(result));
});

socket.on('room:error', (err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});

socket.on('connect_error', (err) => {
  console.error(JSON.stringify({ error: `Connection failed: ${err.message}` }));
  process.exit(1);
});

// Keep process alive but allow graceful shutdown
process.on('SIGINT', () => {
  socket.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  socket.disconnect();
  process.exit(0);
});
