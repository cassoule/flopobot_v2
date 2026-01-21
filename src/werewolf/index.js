/**
 * Werewolf Game - Main Entry Point
 * Exports all necessary modules for integration with the main server
 *
 * This module is designed to be integrated with the existing FlopoBot infrastructure
 * while remaining logically separated. It shares the same database and server but
 * operates independently.
 */

// Models
export { Player } from './models/Player.js';
export { Role, Ability, ROLES, getAvailableRoles, generateRoleDistribution } from './models/Role.js';
export { GameRoom } from './models/GameRoom.js';

// Managers
export { RoomManager, roomManager } from './managers/RoomManager.js';

// Routes
export { werewolfRoutes } from './routes/werewolfRoutes.js';

// WebSocket
export { initializeWerewolfSocket, emitPhaseChange, emitActionResults } from './socket/werewolfSocket.js';

// Database
export { initializeWerewolfSchema, seedAchievements } from './database/schema.js';
export { WerewolfPersistence } from './database/persistence.js';

// Configuration
export { GAME_CONFIG, getConfigForPlayerCount, validateConfig, getItem, getRandomItem } from './config/gameConfig.js';

// Internal imports for the initialization function
import { initializeWerewolfSchema, seedAchievements } from './database/schema.js';
import { initializeWerewolfSocket } from './socket/werewolfSocket.js';
import { WerewolfPersistence } from './database/persistence.js';
import { roomManager } from './managers/RoomManager.js';
import { Player } from './models/Player.js';
import { GameRoom } from './models/GameRoom.js';
import { GAME_CONFIG } from './config/gameConfig.js';

/**
 * Initialize Werewolf game module
 * @param {Object} io - Socket.IO server instance
 * @param {Database} db - Shared better-sqlite3 database instance
 * @param {Object} options - Configuration options
 */
export function initializeWerewolf(io, db, options = {}) {
  console.log('[Werewolf] Initializing game module...');

  // Initialize database schema (adds tables to existing DB)
  initializeWerewolfSchema(db);
  seedAchievements(db);

  // Initialize WebSocket handlers
  initializeWerewolfSocket(io);

  // Create persistence instance with shared DB
  const persistence = new WerewolfPersistence(db);

  // Setup periodic tasks
  setupPeriodicTasks(persistence);

  // Attempt to recover active games
  recoverActiveGames(persistence).catch(err => {
    console.error('[Werewolf] Failed to recover active games:', err);
  });

  console.log('[Werewolf] Game module initialized successfully');

  return { persistence };
}

/**
 * Setup periodic background tasks
 * @param {WerewolfPersistence} persistence
 */
function setupPeriodicTasks(persistence) {
  // Auto-save active games every 30 seconds
  setInterval(() => {
    const rooms = Array.from(roomManager.rooms.values());
    const activeRooms = rooms.filter(r => r.isStarted && r.phase !== 'ended');

    activeRooms.forEach(room => {
      persistence.saveRoomStateForRecovery(room);
    });

    if (activeRooms.length > 0) {
      console.log(`[Werewolf] Auto-saved ${activeRooms.length} active games`);
    }
  }, GAME_CONFIG.AUTO_SAVE_INTERVAL);

  // Cleanup old data daily
  setInterval(() => {
    persistence.cleanup(GAME_CONFIG.GAME_RETENTION_DAYS);
  }, 24 * 60 * 60 * 1000);

  console.log('[Werewolf] Periodic tasks scheduled');
}

/**
 * Recover active games from database (on server restart)
 * @param {WerewolfPersistence} persistence
 */
async function recoverActiveGames(persistence) {
  console.log('[Werewolf] Recovering active games from database...');

  const savedStates = persistence.getActiveSavedStates();

  if (savedStates.length === 0) {
    console.log('[Werewolf] No active games to recover');
    return;
  }

  let recovered = 0;

  for (const saved of savedStates) {
    try {
      const roomState = JSON.parse(saved.room_state);

      // Check if game is too old (more than 24 hours inactive)
      const inactiveTime = Date.now() - saved.last_action_at;
      if (inactiveTime > 24 * 60 * 60 * 1000) {
        console.log(`[Werewolf] Skipping old inactive game: ${saved.room_id}`);
        persistence.deactivateSavedState(saved.room_id);
        continue;
      }

      // Recreate GameRoom instance
      const room = new GameRoom(roomState.roomId, roomState.hostUserId, roomState.config);
      Object.assign(room, roomState);

      // Restore players
      room.players = new Map();
      roomState.players.forEach(playerData => {
        const player = new Player(playerData.userId, playerData.username, null);
        Object.assign(player, playerData);
        room.players.set(player.userId, player);
      });

      // Add to room manager
      roomManager.rooms.set(room.roomId, room);
      room.players.forEach((player, userId) => {
        roomManager.userToRoom.set(userId, room.roomId);
      });

      recovered++;
      console.log(`[Werewolf] Recovered game: ${room.roomId} (${room.players.size} players)`);
    } catch (error) {
      console.error(`[Werewolf] Failed to recover game ${saved.room_id}:`, error);
      persistence.deactivateSavedState(saved.room_id);
    }
  }

  console.log(`[Werewolf] Recovered ${recovered}/${savedStates.length} active games`);
}
