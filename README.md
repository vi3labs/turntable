# Turntable

A social DJ web app inspired by [Turntable.fm](https://en.wikipedia.org/wiki/Turntable.fm). Users hang out in virtual rooms, take turns DJing, and everyone listens together in sync.

## Features

- **Rooms** - Create themed rooms, see who's listening
- **DJ Rotation** - Up to 5 DJs per room, round-robin playback
- **Synced Playback** - Everyone hears the same music at the same time via YouTube
- **Track Queue** - Search YouTube or paste URLs to build your DJ set
- **Voting** - Awesome/Lame votes with animated reactions; majority lame auto-skips
- **Real-time Chat** - Room chat with system notifications
- **QR Sharing** - QR code widget for easy room sharing on phones
- **Room Themes** - Auto-applied themes based on room topic (neon, chill, retro, midnight)
- **Light/Dark Mode** - Toggle between light and dark themes
- **Mobile Ready** - Responsive layout for phones and tablets with resizable sidebar
- **Auto-Reconnect** - Automatic reconnection with room rejoin

## Quick Start

```bash
# Clone
git clone https://github.com/vi3labs/turntable.git
cd turntable

# Install
npm install

# Configure
cp .env.example .env
# Add your YouTube Data API v3 key to .env

# Run
npm start
```

Open `http://localhost:3005` in your browser.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key for search |
| `PORT` | No | Server port (default: 3005) |

## How It Works

1. Pick a username and avatar in the lobby
2. Create a room or join an existing one
3. Click "Step Up to DJ" to claim a DJ slot
4. Search YouTube or paste a URL to queue tracks
5. Your tracks play in rotation with other DJs
6. Everyone in the room hears the same thing in sync
7. Vote Awesome or Lame on tracks - majority lame skips the song

## Tech Stack

- Node.js + Express + Socket.io
- YouTube IFrame Player API + Data API v3
- Vanilla HTML/CSS/JS (no framework)
- In-memory data (rooms are ephemeral)

## License

Private
