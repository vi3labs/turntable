# CLAUDE.md

## What is this?

Turntable is a social DJ web app inspired by Turntable.fm. Users hang out in virtual rooms, take turns DJing from a shared queue, and everyone listens together in sync via YouTube.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Backend**: Node.js + Express + Socket.io (ES modules)
- **Music**: YouTube IFrame Player API (playback) + YouTube Data API v3 (search)
- **Data**: In-memory only (rooms are ephemeral, no database)
- **Auth**: Simple username + emoji avatar picker on entry
- **Security**: Helmet CSP, nanoid public IDs, rate limiting, XSS prevention via textContent

## Commands

```bash
npm start          # Start server (port 3005)
npm run dev        # Start with --watch (auto-restart on changes)
```

Server runs on `http://localhost:3005`. Requires `YOUTUBE_API_KEY` in `.env`.

## Project Structure

```
server/
  index.js          # Express + Socket.io server, all socket event handlers
  Room.js           # Room class (users, chat history, votes)
  RoomManager.js    # Room lifecycle (create/destroy/list)
  DJQueue.js        # DJ rotation + per-DJ track queues
  SyncEngine.js     # Server-authoritative playback clock + track transitions
  youtube.js        # YouTube Data API v3 search + video info

public/
  index.html        # Lobby (room list + create)
  room.html         # Room view (player + chat + queue + roster)
  css/
    variables.css   # CSS custom properties (theming, dark/light mode)
    lobby.css       # Lobby styles
    room.css        # Room styles + responsive + room themes
  js/
    socket.js       # Socket.io client wrapper + reconnect logic
    player.js       # YouTube player wrapper + clock sync
    chat.js         # Chat UI
    queue.js        # DJ queue UI + YouTube search + read-only listener view
    roster.js       # Room roster UI (DJs + listeners)
    voting.js       # Awesome/Lame UI + floating vote animations
    room.js         # Room orchestrator (binds all modules)
    lobby.js        # Lobby controller
    theme.js        # Light/dark mode toggle
```

## Architecture

### Sync Strategy
Server-authoritative playback clock. Server tracks `{trackId, playStartedAt, isPlaying}`. Clients calculate seek position from server timestamp. Clock offset calibrated via 3-ping NTP-lite on connect. Server broadcasts sync pulse every 5 seconds; clients correct if drift > 500ms.

### DJ Rotation
Up to 5 DJ slots per room. Round-robin through DJs. Each DJ queues tracks; when current track ends, next DJ's track plays. Server timer is primary end-detection (not dependent on any single client).

### Voting
Awesome/Lame per track. 60% lame majority (minimum 3 voters) triggers auto-skip. Floating +1/-1 animations on vote updates.

### Public IDs
Clients never see socket IDs. Server assigns 8-char nanoid public IDs on connect. All client-facing data uses these public IDs.

## Socket Events

### Client -> Server
| Event | Payload | Description |
|-------|---------|-------------|
| `room:join` | `{roomId, username, avatarId}` | Join a room |
| `room:leave` | - | Leave current room |
| `chat:message` | `{text}` | Send chat message |
| `dj:stepUp` | - | Join DJ queue |
| `dj:stepDown` | - | Leave DJ queue |
| `dj:queueTrack` | `{url}` or `{videoId, title, thumbnail, duration}` | Add track to queue |
| `dj:removeTrack` | `{trackIndex}` | Remove track from own queue |
| `dj:skipTrack` | - | Skip own currently-playing track |
| `vote:awesome` | - | Vote awesome on current track |
| `vote:lame` | - | Vote lame on current track |
| `clock:ping` | `{t0}` | Clock calibration ping |

### Server -> Client
| Event | Payload | Description |
|-------|---------|-------------|
| `room:state` | Full room state | Sent on join |
| `track:play` | Track + sync data | New track started |
| `track:sync` | Sync data | Periodic sync pulse |
| `track:idle` | - | No tracks playing |
| `track:skip` | `{reason}` | Track was skipped |
| `track:metadata:update` | `{title, duration}` | Resolved metadata |
| `chat:message` | `{username, text, timestamp}` | Chat message |
| `chat:system` | `{text}` | System message |
| `vote:update` | `{awesome, lame}` | Vote counts |
| `user:joined` | User data | User entered room |
| `user:left` | `{userId}` | User left room |
| `roster:update` | Users array | Full roster update |
| `dj:update` | `{slots, currentIndex}` | DJ queue state |
| `clock:pong` | `{t0, t1}` | Clock calibration response |

## Conventions

- All user-generated strings rendered via `textContent` (never `innerHTML`) to prevent XSS
- CSS custom properties in `variables.css` for all colors, spacing, typography
- Dark/light mode via `data-theme` attribute on `<html>`
- Room themes override CSS variables on `.room-layout` (neon, chill, retro, midnight)
- Responsive breakpoint at 1024px (covers phones + tablets)
- Rate limiting on chat (1/sec), actions (2/sec), room creation (1/10sec), search (1/2sec)
- YouTube API key stays server-side; client searches via `/api/youtube/search`

## Environment Variables

```
YOUTUBE_API_KEY=   # YouTube Data API v3 key (required for search)
PORT=3005          # Server port (default: 3005)
```
