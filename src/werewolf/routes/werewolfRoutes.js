import express from 'express';
import { roomManager } from '../managers/RoomManager.js';

/**
 * Werewolf API routes
 * Provides REST endpoints for game management (alternative to WebSocket)
 */
export function werewolfRoutes() {
  const router = express.Router();

  // ===== ROOM LISTING & INFO =====

  /**
   * GET /api/werewolf/rooms
   * Get all available rooms (lobbies)
   */
  router.get('/rooms', (req, res) => {
    try {
      const rooms = roomManager.getAvailableRooms();
      res.json({ success: true, rooms });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/werewolf/rooms/:roomId
   * Get specific room details
   */
  router.get('/rooms/:roomId', (req, res) => {
    try {
      const { roomId } = req.params;
      const { userId } = req.query;

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const state = userId
        ? room.getRoomStateForPlayer(userId)
        : {
            roomId: room.roomId,
            playerCount: room.players.size,
            maxPlayers: room.config.maxPlayers,
            isStarted: room.isStarted,
            phase: room.phase
          };

      res.json({ success: true, room: state });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/werewolf/stats
   * Get server statistics
   */
  router.get('/stats', (req, res) => {
    try {
      const stats = roomManager.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== ROOM MANAGEMENT =====

  /**
   * POST /api/werewolf/create
   * Create a new game room
   * Body: { userId, username, config }
   */
  router.post('/create', (req, res) => {
    try {
      const { userId, username, socketId, config } = req.body;

      if (!userId || !username) {
        return res.status(400).json({
          success: false,
          error: 'userId and username are required'
        });
      }

      const room = roomManager.createRoom(userId, username, socketId || 'http', config);

      res.json({
        success: true,
        roomId: room.roomId,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/join
   * Join an existing room
   * Body: { roomId, userId, username }
   */
  router.post('/join', (req, res) => {
    try {
      const { roomId, userId, username, socketId } = req.body;

      if (!roomId || !userId || !username) {
        return res.status(400).json({
          success: false,
          error: 'roomId, userId, and username are required'
        });
      }

      const room = roomManager.joinRoom(roomId, userId, username, socketId || 'http');

      res.json({
        success: true,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/leave
   * Leave a room
   * Body: { roomId, userId }
   */
  router.post('/leave', (req, res) => {
    try {
      const { roomId, userId } = req.body;

      if (!roomId || !userId) {
        return res.status(400).json({
          success: false,
          error: 'roomId and userId are required'
        });
      }

      const success = roomManager.leaveRoom(userId, roomId);

      res.json({ success });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/ready
   * Toggle ready status
   * Body: { roomId, userId }
   */
  router.post('/ready', (req, res) => {
    try {
      const { roomId, userId } = req.body;

      if (!roomId || !userId) {
        return res.status(400).json({
          success: false,
          error: 'roomId and userId are required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const player = room.getPlayer(userId);

      if (!player) {
        return res.status(404).json({ success: false, error: 'Player not found' });
      }

      player.isReady = !player.isReady;

      res.json({
        success: true,
        isReady: player.isReady,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== GAME FLOW =====

  /**
   * POST /api/werewolf/start
   * Start the game (host only)
   * Body: { roomId, userId }
   */
  router.post('/start', (req, res) => {
    try {
      const { roomId, userId } = req.body;

      if (!roomId || !userId) {
        return res.status(400).json({
          success: false,
          error: 'roomId and userId are required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const player = room.getPlayer(userId);

      if (!player?.isHost) {
        return res.status(403).json({
          success: false,
          error: 'Only the host can start the game'
        });
      }

      room.startGame();

      res.json({
        success: true,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/night-action
   * Register a night action
   * Body: { roomId, userId, abilityId, targets }
   */
  router.post('/night-action', (req, res) => {
    try {
      const { roomId, userId, abilityId, targets } = req.body;

      if (!roomId || !userId || !abilityId) {
        return res.status(400).json({
          success: false,
          error: 'roomId, userId, and abilityId are required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      room.registerNightAction(userId, abilityId, targets);

      res.json({
        success: true,
        message: 'Action registered',
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/vote
   * Register a day vote
   * Body: { roomId, userId, targetId }
   */
  router.post('/vote', (req, res) => {
    try {
      const { roomId, userId, targetId } = req.body;

      if (!roomId || !userId || !targetId) {
        return res.status(400).json({
          success: false,
          error: 'roomId, userId, and targetId are required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      room.registerVote(userId, targetId);

      // Calculate vote counts
      const voteCounts = {};
      room.dayVotes.forEach(targetId => {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      });

      res.json({
        success: true,
        message: 'Vote registered',
        voteCounts,
        totalVotes: room.dayVotes.size,
        requiredVotes: Math.floor(room.getAlivePlayers().length / 2) + 1
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/werewolf/use-item
   * Use an item
   * Body: { roomId, userId, itemId, targets }
   */
  router.post('/use-item', (req, res) => {
    try {
      const { roomId, userId, itemId, targets } = req.body;

      if (!roomId || !userId || !itemId) {
        return res.status(400).json({
          success: false,
          error: 'roomId, userId, and itemId are required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const player = room.getPlayer(userId);

      if (!player) {
        return res.status(404).json({ success: false, error: 'Player not found' });
      }

      const item = player.useItem(itemId);

      if (!item) {
        return res.status(400).json({
          success: false,
          error: 'Item not found or no uses remaining'
        });
      }

      res.json({
        success: true,
        message: 'Item used',
        item,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/werewolf/my-room
   * Get the room the user is currently in
   * Query: userId
   */
  router.get('/my-room', (req, res) => {
    try {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }

      const room = roomManager.getRoomByUser(userId);

      if (!room) {
        return res.json({ success: true, room: null });
      }

      res.json({
        success: true,
        room: room.getRoomStateForPlayer(userId)
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/werewolf/chat/:roomId
   * Get chat history for a room
   * Query: userId, channel
   */
  router.get('/chat/:roomId', (req, res) => {
    try {
      const { roomId } = req.params;
      const { userId, channel = 'all' } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      // Validate channel access
      const allowedChannels = room.getChatChannelsForPlayer(userId);

      if (!allowedChannels.includes(channel)) {
        return res.status(403).json({
          success: false,
          error: 'Cannot access this channel'
        });
      }

      const messages = room.chatChannels[channel] || [];

      res.json({
        success: true,
        messages,
        channel
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /api/werewolf/rooms/:roomId
   * Delete a room (admin/host only)
   */
  router.delete('/rooms/:roomId', (req, res) => {
    try {
      const { roomId } = req.params;
      const { userId } = req.body;

      const room = roomManager.getRoom(roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const player = room.getPlayer(userId);

      if (!player?.isHost) {
        return res.status(403).json({
          success: false,
          error: 'Only the host can delete the room'
        });
      }

      const success = roomManager.deleteRoom(roomId);

      res.json({ success });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
