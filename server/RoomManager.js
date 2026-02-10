import { nanoid } from 'nanoid';
import { Room } from './Room.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(name, theme, creatorId) {
    const id = nanoid(8);
    const room = new Room(id, name, theme, creatorId);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }

  listRooms() {
    return [...this.rooms.values()].map(room => room.getSummary());
  }

  // Find which room a socket is in
  findUserRoom(socketId) {
    for (const [roomId, room] of this.rooms) {
      if (room.users.has(socketId)) return room;
    }
    return null;
  }
}
