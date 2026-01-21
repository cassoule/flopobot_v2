import { GameRoom } from '../models/GameRoom.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * RoomManager - Singleton that manages all active game rooms
 * Handles room creation, deletion, and persistence
 */
export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> GameRoom
    this.userToRoom = new Map(); // userId -> roomId
  }

  /**
   * Create a new game room
   * @param {string} hostUserId
   * @param {string} hostUsername
   * @param {string} socketId
   * @param {Object} config
   * @returns {GameRoom}
   */
  createRoom(hostUserId, hostUsername, socketId, config = {}) {
    // Check if user is already in a room
    if (this.userToRoom.has(hostUserId)) {
      const existingRoomId = this.userToRoom.get(hostUserId);
      const existingRoom = this.rooms.get(existingRoomId);

      if (existingRoom && !existingRoom.isStarted) {
        // Leave existing lobby
        this.leaveRoom(hostUserId, existingRoomId);
      } else {
        throw new Error('User is already in a game');
      }
    }

    const roomId = this.generateRoomCode();
    const room = new GameRoom(roomId, hostUserId, config);

    // Add host as first player
    room.addPlayer(hostUserId, hostUsername, socketId);

    this.rooms.set(roomId, room);
    this.userToRoom.set(hostUserId, roomId);

    return room;
  }

  /**
   * Join an existing room
   * @param {string} roomId
   * @param {string} userId
   * @param {string} username
   * @param {string} socketId
   * @returns {GameRoom}
   */
  joinRoom(roomId, userId, username, socketId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    // Check if user is already in another room
    const currentRoomId = this.userToRoom.get(userId);
    if (currentRoomId && currentRoomId !== roomId) {
      const currentRoom = this.rooms.get(currentRoomId);
      if (currentRoom && !currentRoom.isStarted) {
        this.leaveRoom(userId, currentRoomId);
      } else {
        throw new Error('User is already in another game');
      }
    }

    room.addPlayer(userId, username, socketId);
    this.userToRoom.set(userId, roomId);

    return room;
  }

  /**
   * Leave a room
   * @param {string} userId
   * @param {string} roomId
   * @returns {boolean}
   */
  leaveRoom(userId, roomId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    room.removePlayer(userId);
    this.userToRoom.delete(userId);

    // If room is empty and not started, delete it
    if (room.players.size === 0 && !room.isStarted) {
      this.rooms.delete(roomId);
    } else if (room.isStarted && room.players.size === 0) {
      // If game is started but everyone left, end it
      room.endGame();
    } else if (userId === room.hostUserId && room.players.size > 0) {
      // Transfer host to another player
      const newHost = Array.from(room.players.values())[0];
      newHost.isHost = true;
      room.hostUserId = newHost.userId;
    }

    return true;
  }

  /**
   * Get room by ID
   * @param {string} roomId
   * @returns {GameRoom|null}
   */
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get room that a user is in
   * @param {string} userId
   * @returns {GameRoom|null}
   */
  getRoomByUser(userId) {
    const roomId = this.userToRoom.get(userId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  /**
   * Get all active rooms
   * @returns {Array<Object>}
   */
  getAllRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      roomId: room.roomId,
      hostUserId: room.hostUserId,
      playerCount: room.players.size,
      maxPlayers: room.config.maxPlayers,
      isStarted: room.isStarted,
      phase: room.phase,
      createdAt: room.createdAt
    }));
  }

  /**
   * Get available rooms (lobbies)
   * @returns {Array<Object>}
   */
  getAvailableRooms() {
    return Array.from(this.rooms.values())
      .filter(room => !room.isStarted && room.players.size < room.config.maxPlayers)
      .map(room => ({
        roomId: room.roomId,
        hostUserId: room.hostUserId,
        hostUsername: Array.from(room.players.values()).find(p => p.isHost)?.username,
        playerCount: room.players.size,
        maxPlayers: room.config.maxPlayers,
        createdAt: room.createdAt
      }));
  }

  /**
   * Delete a room
   * @param {string} roomId
   * @returns {boolean}
   */
  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    // Remove all players from userToRoom map
    room.players.forEach((player, userId) => {
      this.userToRoom.delete(userId);
    });

    // Clear any timers
    if (room.phaseTimer) {
      clearTimeout(room.phaseTimer);
    }

    this.rooms.delete(roomId);
    return true;
  }

  /**
   * Update socket ID for a user
   * @param {string} userId
   * @param {string} newSocketId
   */
  updateUserSocket(userId, newSocketId) {
    const room = this.getRoomByUser(userId);

    if (room) {
      const player = room.getPlayer(userId);
      if (player) {
        player.socketId = newSocketId;
      }
    }
  }

  /**
   * Clean up finished games periodically
   */
  cleanupFinishedGames() {
    const now = Date.now();
    const CLEANUP_DELAY = 30 * 60 * 1000; // 30 minutes

    this.rooms.forEach((room, roomId) => {
      if (room.phase === 'ended' && room.endedAt && now - room.endedAt > CLEANUP_DELAY) {
        this.deleteRoom(roomId);
      }
    });
  }

  /**
   * Generate a unique 6-character room code
   * @returns {string}
   */
  generateRoomCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;

    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }
    } while (this.rooms.has(code));

    return code;
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const rooms = Array.from(this.rooms.values());

    return {
      totalRooms: rooms.length,
      activeGames: rooms.filter(r => r.isStarted && r.phase !== 'ended').length,
      lobbies: rooms.filter(r => !r.isStarted).length,
      finishedGames: rooms.filter(r => r.phase === 'ended').length,
      totalPlayers: Array.from(this.userToRoom.keys()).length
    };
  }
}

// Singleton instance
export const roomManager = new RoomManager();

// Start cleanup interval
setInterval(() => {
  roomManager.cleanupFinishedGames();
}, 5 * 60 * 1000); // Every 5 minutes
