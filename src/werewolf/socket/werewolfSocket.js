import { roomManager } from '../managers/RoomManager.js';

/**
 * Initialize Werewolf WebSocket handlers
 * @param {Socket} io - Socket.IO instance
 */
export function initializeWerewolfSocket(io) {
  const werewolfNamespace = io.of('/werewolf');

  werewolfNamespace.on('connection', (socket) => {
    console.log(`[Werewolf] Client connected: ${socket.id}`);

    // Store authenticated user info on the socket
    let currentUserId = null;
    let currentUsername = null;
    let currentRoomId = null;

    // ===== CONNECTION & AUTHENTICATION =====

    socket.on('authenticate', ({ userId, username }) => {
      if (!userId) {
        socket.emit('error', { message: 'userId is required for authentication' });
        return;
      }

      currentUserId = userId;
      currentUsername = username || `User_${userId.substring(0, 6)}`;

      console.log(`[Werewolf] User authenticated: ${currentUsername} (${userId})`);

      // Update socket ID if user is reconnecting
      roomManager.updateUserSocket(userId, socket.id);

      const room = roomManager.getRoomByUser(userId);
      if (room) {
        currentRoomId = room.roomId;
        socket.join(currentRoomId);

        // Send current room state
        socket.emit('room-state', room.getRoomStateForPlayer(userId));
      }

      // Send available rooms
      socket.emit('available-rooms', roomManager.getAvailableRooms());

      // Confirm authentication
      socket.emit('authenticated', { userId: currentUserId, username: currentUsername });
    });

    // ===== ROOM MANAGEMENT =====

    socket.on('create-room', ({ userId, username, config }) => {
      try {
        // Use stored auth info if not provided
        const effectiveUserId = userId || currentUserId;
        const effectiveUsername = username || currentUsername;

        if (!effectiveUserId) {
          socket.emit('error', { message: 'Please authenticate first' });
          return;
        }

        const room = roomManager.createRoom(effectiveUserId, effectiveUsername, socket.id, config);
        currentRoomId = room.roomId;
        currentUserId = effectiveUserId;
        currentUsername = effectiveUsername;

        socket.join(currentRoomId);

        socket.emit('room-created', {
          roomId: room.roomId,
          state: room.getRoomStateForPlayer(effectiveUserId)
        });

        // Broadcast updated room list
        werewolfNamespace.emit('available-rooms', roomManager.getAvailableRooms());

        console.log(`[Werewolf] Room created: ${room.roomId} by ${effectiveUsername}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('join-room', ({ roomId, userId, username }) => {
      try {
        // Use stored auth info if not provided
        const effectiveUserId = userId || currentUserId;
        const effectiveUsername = username || currentUsername;

        if (!effectiveUserId) {
          socket.emit('error', { message: 'Please authenticate first' });
          return;
        }

        const room = roomManager.joinRoom(roomId, effectiveUserId, effectiveUsername, socket.id);
        currentRoomId = roomId;
        currentUserId = effectiveUserId;
        currentUsername = effectiveUsername;

        socket.join(currentRoomId);

        // Send room state to joining player
        socket.emit('room-joined', {
          roomId: room.roomId,
          state: room.getRoomStateForPlayer(effectiveUserId)
        });

        // Notify all players in room
        werewolfNamespace.to(currentRoomId).emit('player-joined', {
          userId: effectiveUserId,
          username: effectiveUsername,
          playerCount: room.players.size
        });

        // Update room state for all
        emitRoomUpdate(werewolfNamespace, room);

        // Broadcast updated room list
        werewolfNamespace.emit('available-rooms', roomManager.getAvailableRooms());

        console.log(`[Werewolf] ${effectiveUsername} joined room ${roomId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave-room', ({ roomId, userId }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        const username = room?.getPlayer(effectiveUserId)?.username || currentUsername;

        roomManager.leaveRoom(effectiveUserId, effectiveRoomId);
        socket.leave(effectiveRoomId);

        socket.emit('room-left');

        // Notify remaining players
        if (room && room.players.size > 0) {
          werewolfNamespace.to(effectiveRoomId).emit('player-left', {
            userId: effectiveUserId,
            username,
            playerCount: room.players.size
          });

          emitRoomUpdate(werewolfNamespace, room);
        }

        // Broadcast updated room list
        werewolfNamespace.emit('available-rooms', roomManager.getAvailableRooms());

        currentRoomId = null;

        console.log(`[Werewolf] ${username} left room ${effectiveRoomId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('toggle-ready', ({ roomId, userId }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        const player = room.getPlayer(effectiveUserId);
        if (!player) throw new Error('Player not found');

        player.isReady = !player.isReady;

        emitRoomUpdate(werewolfNamespace, room);

        console.log(`[Werewolf] ${player.username} toggled ready: ${player.isReady}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // ===== GAME FLOW =====

    socket.on('start-game', ({ roomId, userId }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        const player = room.getPlayer(effectiveUserId);
        if (!player?.isHost) throw new Error('Only host can start game');

        room.startGame();

        // Notify all players
        werewolfNamespace.to(effectiveRoomId).emit('game-started', {
          turn: room.turn,
          phase: room.phase
        });

        emitRoomUpdate(werewolfNamespace, room);

        // Broadcast updated room list
        werewolfNamespace.emit('available-rooms', roomManager.getAvailableRooms());

        console.log(`[Werewolf] Game started in room ${effectiveRoomId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('night-action', ({ roomId, userId, abilityId, targets }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        room.registerNightAction(effectiveUserId, abilityId, targets);

        socket.emit('action-registered', { abilityId, targets });

        // Check if all players have acted
        const alivePlayers = room.getAlivePlayers();
        const werewolves = alivePlayers.filter(p => p.team === 'werewolves');
        const werewolfVotes = Array.from(room.nightActions.values())
          .filter(a => a.abilityId === 'werewolf_kill');

        // If all werewolves voted, notify
        if (werewolfVotes.length === werewolves.length) {
          werewolfNamespace.to(effectiveRoomId).emit('werewolves-voted');
        }

        console.log(`[Werewolf] Night action: ${abilityId} by ${effectiveUserId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('vote', ({ roomId, userId, targetId }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        room.registerVote(effectiveUserId, targetId);

        socket.emit('vote-registered', { targetId });

        // Broadcast vote count (without revealing who voted for whom)
        const voteCounts = {};
        room.dayVotes.forEach(targetId => {
          voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
        });

        werewolfNamespace.to(effectiveRoomId).emit('vote-update', {
          voteCounts,
          totalVotes: room.dayVotes.size,
          requiredVotes: Math.floor(room.getAlivePlayers().length / 2) + 1
        });

        console.log(`[Werewolf] Vote: ${effectiveUserId} -> ${targetId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('use-item', ({ roomId, userId, itemId, targets }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        const player = room.getPlayer(effectiveUserId);
        if (!player) throw new Error('Player not found');

        const item = player.useItem(itemId);
        if (!item) throw new Error('Item not found or no uses remaining');

        socket.emit('item-used', { item, targets });

        emitRoomUpdate(werewolfNamespace, room);

        console.log(`[Werewolf] Item used: ${itemId} by ${effectiveUserId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // ===== CHAT =====

    socket.on('chat-message', ({ roomId, userId, channel, message }) => {
      try {
        const effectiveUserId = userId || currentUserId;
        const effectiveRoomId = roomId || currentRoomId;

        const room = roomManager.getRoom(effectiveRoomId);
        if (!room) throw new Error('Room not found');

        const player = room.getPlayer(effectiveUserId);
        if (!player) throw new Error('Player not found');

        // Validate channel access
        const allowedChannels = room.getChatChannelsForPlayer(effectiveUserId);
        if (!allowedChannels.includes(channel)) {
          throw new Error('Cannot access this channel');
        }

        const chatMessage = {
          userId: effectiveUserId,
          username: player.username,
          message,
          channel,
          timestamp: Date.now()
        };

        // Store in room
        if (!room.chatChannels[channel]) {
          room.chatChannels[channel] = [];
        }
        room.chatChannels[channel].push(chatMessage);

        // Broadcast to appropriate channel
        if (channel === 'werewolves') {
          // Only to werewolves
          const werewolves = room.getPlayersByTeam('werewolves')
            .filter(p => p.isAlive && p.socketId);

          werewolves.forEach(p => {
            werewolfNamespace.to(p.socketId).emit('chat-message', chatMessage);
          });
        } else if (channel === 'dead') {
          // Only to dead players
          const deadPlayers = Array.from(room.players.values())
            .filter(p => !p.isAlive && p.socketId);

          deadPlayers.forEach(p => {
            werewolfNamespace.to(p.socketId).emit('chat-message', chatMessage);
          });
        } else {
          // Broadcast to all in room
          werewolfNamespace.to(effectiveRoomId).emit('chat-message', chatMessage);
        }

        console.log(`[Werewolf] Chat [${channel}] ${player.username}: ${message}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // ===== PHASE TRANSITIONS =====

    socket.on('request-phase-skip', ({ roomId, userId }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) throw new Error('Room not found');

        const player = room.getPlayer(userId);
        if (!player?.isHost) throw new Error('Only host can skip phase');

        // Manually trigger phase end
        room.handlePhaseEnd();

        console.log(`[Werewolf] Phase skipped by host in room ${roomId}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // ===== DISCONNECTION =====

    socket.on('disconnect', () => {
      console.log(`[Werewolf] Client disconnected: ${socket.id}`);

      if (currentUserId && currentRoomId) {
        const room = roomManager.getRoom(currentRoomId);

        if (room && !room.isStarted) {
          // If in lobby, remove player
          roomManager.leaveRoom(currentUserId, currentRoomId);

          werewolfNamespace.to(currentRoomId).emit('player-left', {
            userId: currentUserId,
            playerCount: room.players.size
          });

          if (room.players.size > 0) {
            emitRoomUpdate(werewolfNamespace, room);
          }

          werewolfNamespace.emit('available-rooms', roomManager.getAvailableRooms());
        } else if (room) {
          // If game started, just mark as disconnected
          const player = room.getPlayer(currentUserId);
          if (player) {
            player.socketId = null;

            werewolfNamespace.to(currentRoomId).emit('player-disconnected', {
              userId: currentUserId,
              username: player.username
            });
          }
        }
      }
    });
  });

  // Listen to phase transitions from game rooms
  setupPhaseListeners(werewolfNamespace);

  console.log('[Werewolf] WebSocket handlers initialized');
}

/**
 * Setup listeners for automatic phase transitions
 * @param {Namespace} namespace
 */
function setupPhaseListeners(namespace) {
  // This would be called by GameRoom when phases change
  // For now, we'll handle it via polling or events
}

/**
 * Emit room update to all players
 * @param {Namespace} namespace
 * @param {GameRoom} room
 */
function emitRoomUpdate(namespace, room) {
  room.players.forEach((player, userId) => {
    if (player.socketId) {
      namespace.to(player.socketId).emit('room-state', room.getRoomStateForPlayer(userId));
    }
  });
}

/**
 * Emit phase change to all players in room
 * @param {Namespace} namespace
 * @param {GameRoom} room
 */
export function emitPhaseChange(namespace, room) {
  namespace.to(room.roomId).emit('phase-changed', {
    phase: room.phase,
    turn: room.turn,
    phaseEndTime: room.phaseEndTime
  });

  emitRoomUpdate(namespace, room);
}

/**
 * Emit action results to room
 * @param {Namespace} namespace
 * @param {GameRoom} room
 * @param {Array} results
 */
export function emitActionResults(namespace, room, results) {
  // Send results to specific players based on their role/team
  results.forEach(result => {
    if (result.type === 'seer_vision') {
      // Only send to seer
      const seer = room.getPlayer(result.seer);
      if (seer?.socketId) {
        namespace.to(seer.socketId).emit('seer-vision', {
          target: result.target,
          role: result.role,
          team: result.team
        });
      }
    }
  });

  // Broadcast deaths
  const deaths = room.deathHistory.filter(d => d.turn === room.turn);
  if (deaths.length > 0) {
    namespace.to(room.roomId).emit('deaths-occurred', { deaths });
  }

  emitRoomUpdate(namespace, room);
}
