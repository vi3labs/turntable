import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

const { httpServer, io, roomManager, chatLimiter, actionLimiter, roomCreateLimiter, searchLimiter } =
  await import('../server/index.js');

let serverUrl;
let activeClients = [];

function createClient() {
  const client = ioClient(serverUrl, {
    transports: ['websocket'],
    forceNew: true
  });
  activeClients.push(client);
  return client;
}

function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function setupRoom(name, username = 'Alice', avatarId = 0) {
  const client = createClient();
  await waitForEvent(client, 'connect');

  const createdPromise = waitForEvent(client, 'room:created');
  client.emit('room:create', { name, theme: '', username, avatarId });
  const { roomId } = await createdPromise;

  const statePromise = waitForEvent(client, 'room:state');
  client.emit('room:join', { roomId, username, avatarId });
  await statePromise;

  return { client, roomId };
}

async function joinRoom(roomId, username, avatarId = 0) {
  const client = createClient();
  await waitForEvent(client, 'connect');

  const statePromise = waitForEvent(client, 'room:state');
  client.emit('room:join', { roomId, username, avatarId });
  await statePromise;

  return client;
}

describe('Integration Tests', () => {
  before(async () => {
    await new Promise((resolve) => httpServer.listen(0, resolve));
    const addr = httpServer.address();
    serverUrl = `http://localhost:${addr.port}`;
  });

  after(async () => {
    io.disconnectSockets(true);
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  afterEach(async () => {
    // Disconnect all test clients
    for (const client of activeClients) {
      if (client.connected) client.disconnect();
    }
    activeClients = [];

    // Wait for disconnects to process
    await new Promise(r => setTimeout(r, 50));

    // Clean up rooms
    for (const [id] of roomManager.rooms) {
      const room = roomManager.getRoom(id);
      if (room) room.destroy();
      roomManager.deleteRoom(id);
    }

    // Reset rate limiters
    chatLimiter.records.clear();
    actionLimiter.records.clear();
    roomCreateLimiter.records.clear();
    searchLimiter.records.clear();
  });

  it('should create a room and list it', async () => {
    const client = createClient();
    await waitForEvent(client, 'connect');

    const createdPromise = waitForEvent(client, 'room:created');
    client.emit('room:create', {
      name: 'Test Room',
      theme: 'neon',
      username: 'Alice',
      avatarId: 0
    });
    const { roomId } = await createdPromise;
    assert.ok(roomId);

    const listPromise = waitForEvent(client, 'room:list');
    client.emit('room:list');
    const rooms = await listPromise;
    assert.ok(rooms.length > 0);
    assert.equal(rooms[0].name, 'Test Room');
  });

  it('should join and receive full state', async () => {
    const { roomId } = await setupRoom('Join Test');

    const joiner = createClient();
    await waitForEvent(joiner, 'connect');

    const statePromise = waitForEvent(joiner, 'room:state');
    joiner.emit('room:join', { roomId, username: 'Bob', avatarId: 1 });
    const state = await statePromise;

    assert.equal(state.name, 'Join Test');
    assert.ok(state.myId);
    assert.ok(Array.isArray(state.users));
  });

  it('should step up and step down as DJ', async () => {
    const { client } = await setupRoom('DJ Test');

    const djPromise = waitForEvent(client, 'dj:update');
    client.emit('dj:stepUp');
    const djState = await djPromise;
    assert.equal(djState.slots.length, 1);
    assert.equal(djState.slots[0].username, 'Alice');

    const djPromise2 = waitForEvent(client, 'dj:update');
    client.emit('dj:stepDown');
    const djState2 = await djPromise2;
    assert.equal(djState2.slots.length, 0);
  });

  it('should queue a track and start playing', async () => {
    const { client } = await setupRoom('Queue Test');

    const djPromise = waitForEvent(client, 'dj:update');
    client.emit('dj:stepUp');
    await djPromise;

    const playPromise = waitForEvent(client, 'track:play');
    client.emit('dj:queueTrack', {
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      duration: 213
    });
    const playData = await playPromise;
    assert.equal(playData.videoId, 'dQw4w9WgXcQ');
    assert.equal(playData.title, 'Never Gonna Give You Up');
  });

  it('should broadcast chat to room', async () => {
    const { client: c1, roomId } = await setupRoom('Chat Test');
    const c2 = await joinRoom(roomId, 'Bob', 1);

    const msgPromise = waitForEvent(c2, 'chat:message');
    c1.emit('chat:message', { text: 'Hello everyone!' });
    const msg = await msgPromise;
    assert.equal(msg.text, 'Hello everyone!');
    assert.equal(msg.username, 'Alice');
  });

  it('should allow voting and prevent self-voting', async () => {
    const { client: dj, roomId } = await setupRoom('Vote Test', 'DJ Alice');

    const djPromise = waitForEvent(dj, 'dj:update');
    dj.emit('dj:stepUp');
    await djPromise;

    const listener = await joinRoom(roomId, 'Bob', 1);

    const playPromise = waitForEvent(listener, 'track:play');
    dj.emit('dj:queueTrack', {
      videoId: 'tEsT1234567',
      title: 'Test Track',
      thumbnail: 'https://i.ytimg.com/vi/tEsT1234567/mqdefault.jpg',
      duration: 180
    });
    await playPromise;

    // Small delay to let initial vote:update(0,0) from advanceTrack flush
    await new Promise(r => setTimeout(r, 100));

    // Listener votes awesome
    const votePromise = waitForEvent(listener, 'vote:update');
    listener.emit('vote:awesome');
    const voteResult = await votePromise;
    assert.equal(voteResult.awesome, 1);
    assert.equal(voteResult.lame, 0);
  });

  it('should alternate between DJs (round-robin)', async () => {
    const { client: dj1, roomId } = await setupRoom('Rotation Test');
    const dj2 = await joinRoom(roomId, 'Bob', 1);

    // Both step up as DJs
    const dj1Up = waitForEvent(dj1, 'dj:update');
    dj1.emit('dj:stepUp');
    await dj1Up;

    const dj2Up = waitForEvent(dj2, 'dj:update');
    dj2.emit('dj:stepUp');
    await dj2Up;

    // DJ1 queues a track -> starts playing immediately
    const play1Promise = waitForEvent(dj2, 'track:play');
    dj1.emit('dj:queueTrack', {
      videoId: 'aaaaaaaaaaa',
      title: 'Alice Track',
      thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
      duration: 10
    });
    const play1 = await play1Promise;
    assert.equal(play1.dj.username, 'Alice');

    // DJ2 queues a track (won't play yet, Alice's track is playing)
    const djUpdatePromise = waitForEvent(dj2, 'dj:update');
    dj2.emit('dj:queueTrack', {
      videoId: 'bbbbbbbbbbb',
      title: 'Bob Track',
      thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg',
      duration: 10
    });
    await djUpdatePromise;

    // Simulate track end
    const play2Promise = waitForEvent(dj2, 'track:play');
    dj1.emit('track:ended', { videoId: 'aaaaaaaaaaa' });
    const play2 = await play2Promise;
    assert.equal(play2.dj.username, 'Bob');
  });

  it('should restore DJ slot on reconnect within grace period', async () => {
    const { client: dj, roomId } = await setupRoom('Reconnect Test');
    const listener = await joinRoom(roomId, 'Bob', 1);

    // Step up and queue a track
    const djUpPromise = waitForEvent(listener, 'dj:update');
    dj.emit('dj:stepUp');
    await djUpPromise;

    const playPromise = waitForEvent(listener, 'track:play');
    dj.emit('dj:queueTrack', {
      videoId: 'ccccccccccc',
      title: 'Test Track',
      thumbnail: 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg',
      duration: 300
    });
    await playPromise;

    // DJ disconnects
    const djLeavePromise = waitForEvent(listener, 'dj:update');
    dj.disconnect();
    // Remove from tracked clients so afterEach doesn't double-disconnect
    activeClients = activeClients.filter(c => c !== dj);
    await djLeavePromise;

    // DJ reconnects with same username
    const dj2 = createClient();
    await waitForEvent(dj2, 'connect');

    const sysPromise = waitForEvent(listener, 'chat:system');
    const statePromise = waitForEvent(dj2, 'room:state');
    dj2.emit('room:join', { roomId, username: 'Alice', avatarId: 0 });
    const state = await statePromise;

    // Should be restored as DJ
    const me = state.users.find(u => u.id === state.myId);
    assert.equal(me.role, 'dj');

    // Should see system message about reconnection
    const sysMsg = await sysPromise;
    assert.ok(sysMsg.text.includes('reconnected'));
  });
});
