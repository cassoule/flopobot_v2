import Database from 'better-sqlite3';

/**
 * Werewolf game persistence layer
 * Handles saving/loading game states and statistics
 */
export class WerewolfPersistence {
  constructor(dbInstanceOrPath) {
    // Support both existing DB instance or path to new DB
    if (typeof dbInstanceOrPath === 'string') {
      this.db = new Database(dbInstanceOrPath);
      this.db.pragma('journal_mode = WAL');
      this.ownDb = true; // We created the DB, we should close it
    } else {
      this.db = dbInstanceOrPath; // Use existing DB instance
      this.ownDb = false;
    }

    this.initializePreparedStatements();
  }

  /**
   * Initialize prepared statements
   * Note: Schema initialization is done separately in index.js
   */
  initializePreparedStatements() {

    // ===== GAME PERSISTENCE =====

    this.statements = {
      // Save game state
      saveGame: this.db.prepare(`
        INSERT OR REPLACE INTO werewolf_games (
          id, room_id, host_user_id, config, phase, turn, is_started,
          winners_team, created_at, started_at, ended_at, players_snapshot,
          action_history, death_history, player_count, duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      // Get game by ID
      getGame: this.db.prepare(`
        SELECT * FROM werewolf_games WHERE id = ?
      `),

      // Get game by room ID
      getGameByRoomId: this.db.prepare(`
        SELECT * FROM werewolf_games WHERE room_id = ?
      `),

      // ===== PLAYER GAME RECORDS =====

      savePlayerGame: this.db.prepare(`
        INSERT INTO werewolf_player_games (
          game_id, user_id, username, role_id, role_name, team,
          is_winner, survived, death_turn, death_phase, death_cause,
          actions_performed, votes_cast, items_used, damage_dealt,
          damage_taken, players_killed, joined_at, left_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      getPlayerGames: this.db.prepare(`
        SELECT * FROM werewolf_player_games
        WHERE user_id = ?
        ORDER BY joined_at DESC
        LIMIT ? OFFSET ?
      `),

      // ===== PLAYER STATISTICS =====

      getPlayerStats: this.db.prepare(`
        SELECT * FROM werewolf_player_stats WHERE user_id = ?
      `),

      upsertPlayerStats: this.db.prepare(`
        INSERT INTO werewolf_player_stats (
          user_id, username, total_games, total_wins, total_losses,
          games_as_villager, games_as_werewolf, games_as_neutral,
          wins_as_villager, wins_as_werewolf, wins_as_neutral,
          role_stats, total_kills, total_deaths, times_survived,
          average_survival_turns, total_actions, total_votes,
          total_items_used, first_game_at, last_game_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          total_games = excluded.total_games,
          total_wins = excluded.total_wins,
          total_losses = excluded.total_losses,
          games_as_villager = excluded.games_as_villager,
          games_as_werewolf = excluded.games_as_werewolf,
          games_as_neutral = excluded.games_as_neutral,
          wins_as_villager = excluded.wins_as_villager,
          wins_as_werewolf = excluded.wins_as_werewolf,
          wins_as_neutral = excluded.wins_as_neutral,
          role_stats = excluded.role_stats,
          total_kills = excluded.total_kills,
          total_deaths = excluded.total_deaths,
          times_survived = excluded.times_survived,
          average_survival_turns = excluded.average_survival_turns,
          total_actions = excluded.total_actions,
          total_votes = excluded.total_votes,
          total_items_used = excluded.total_items_used,
          last_game_at = excluded.last_game_at,
          updated_at = excluded.updated_at
      `),

      // ===== SAVED STATES =====

      saveRoomState: this.db.prepare(`
        INSERT OR REPLACE INTO werewolf_saved_states (
          room_id, game_id, room_state, current_phase, current_turn,
          phase_end_time, is_active, player_count, saved_at, last_action_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      getRoomState: this.db.prepare(`
        SELECT * FROM werewolf_saved_states
        WHERE room_id = ? AND is_active = 1
      `),

      deactivateRoomState: this.db.prepare(`
        UPDATE werewolf_saved_states
        SET is_active = 0
        WHERE room_id = ?
      `),

      getActiveStates: this.db.prepare(`
        SELECT * FROM werewolf_saved_states
        WHERE is_active = 1
        ORDER BY last_action_at DESC
      `),

      // ===== LEADERBOARDS =====

      getTopPlayers: this.db.prepare(`
        SELECT user_id, username, total_games, total_wins, total_losses,
               CAST(total_wins AS REAL) / NULLIF(total_games, 0) as win_rate
        FROM werewolf_player_stats
        WHERE total_games >= ?
        ORDER BY total_wins DESC
        LIMIT ?
      `),

      getTopPlayersByWinRate: this.db.prepare(`
        SELECT user_id, username, total_games, total_wins,
               CAST(total_wins AS REAL) / NULLIF(total_games, 0) as win_rate
        FROM werewolf_player_stats
        WHERE total_games >= ?
        ORDER BY win_rate DESC, total_wins DESC
        LIMIT ?
      `),

      // ===== ACHIEVEMENTS =====

      unlockAchievement: this.db.prepare(`
        INSERT OR IGNORE INTO werewolf_player_achievements (
          user_id, achievement_id, game_id, unlocked_at
        ) VALUES (?, ?, ?, ?)
      `),

      getPlayerAchievements: this.db.prepare(`
        SELECT a.*, pa.unlocked_at, pa.game_id
        FROM werewolf_achievements a
        JOIN werewolf_player_achievements pa ON a.id = pa.achievement_id
        WHERE pa.user_id = ?
        ORDER BY pa.unlocked_at DESC
      `),

      // ===== CLEANUP =====

      deleteOldGames: this.db.prepare(`
        DELETE FROM werewolf_games
        WHERE ended_at IS NOT NULL AND ended_at < ?
      `),

      deleteInactiveStates: this.db.prepare(`
        DELETE FROM werewolf_saved_states
        WHERE is_active = 0 AND saved_at < ?
      `)
    };
  }

  // ===== GAME PERSISTENCE METHODS =====

  /**
   * Save complete game state
   * @param {GameRoom} room
   * @returns {boolean}
   */
  saveGameState(room) {
    try {
      const gameId = room.roomId + '_' + room.createdAt;

      this.statements.saveGame.run(
        gameId,
        room.roomId,
        room.hostUserId,
        JSON.stringify(room.config),
        room.phase,
        room.turn,
        room.isStarted ? 1 : 0,
        room.winnersTeam,
        room.createdAt,
        room.startedAt,
        room.endedAt,
        JSON.stringify(this.serializePlayers(room)),
        JSON.stringify(room.actionHistory),
        JSON.stringify(room.deathHistory),
        room.players.size,
        room.endedAt ? room.endedAt - room.startedAt : null
      );

      return true;
    } catch (error) {
      console.error('[Werewolf] Failed to save game state:', error);
      return false;
    }
  }

  /**
   * Save room state for persistence/recovery
   * @param {GameRoom} room
   * @returns {boolean}
   */
  saveRoomStateForRecovery(room) {
    try {
      const gameId = room.roomId + '_' + room.createdAt;

      this.statements.saveRoomState.run(
        room.roomId,
        gameId,
        JSON.stringify(this.serializeRoom(room)),
        room.phase,
        room.turn,
        room.phaseEndTime,
        1, // is_active
        room.players.size,
        Date.now(),
        Date.now()
      );

      return true;
    } catch (error) {
      console.error('[Werewolf] Failed to save room state:', error);
      return false;
    }
  }

  /**
   * Load room state from database
   * @param {string} roomId
   * @returns {Object|null}
   */
  loadRoomState(roomId) {
    try {
      const saved = this.statements.getRoomState.get(roomId);

      if (!saved) return null;

      return JSON.parse(saved.room_state);
    } catch (error) {
      console.error('[Werewolf] Failed to load room state:', error);
      return null;
    }
  }

  /**
   * Deactivate saved state (when game ends)
   * @param {string} roomId
   */
  deactivateSavedState(roomId) {
    this.statements.deactivateRoomState.run(roomId);
  }

  /**
   * Get all active saved states (for recovery on restart)
   * @returns {Array}
   */
  getActiveSavedStates() {
    return this.statements.getActiveStates.all();
  }

  // ===== PLAYER STATISTICS =====

  /**
   * Update player statistics after a game
   * @param {string} userId
   * @param {string} username
   * @param {Object} gameResult
   */
  updatePlayerStats(userId, username, gameResult) {
    try {
      const stats = this.statements.getPlayerStats.get(userId) || this.getDefaultStats(userId, username);

      // Update totals
      stats.total_games++;
      if (gameResult.isWinner) {
        stats.total_wins++;
      } else {
        stats.total_losses++;
      }

      // Update team stats
      if (gameResult.team === 'villagers') {
        stats.games_as_villager++;
        if (gameResult.isWinner) stats.wins_as_villager++;
      } else if (gameResult.team === 'werewolves') {
        stats.games_as_werewolf++;
        if (gameResult.isWinner) stats.wins_as_werewolf++;
      } else {
        stats.games_as_neutral++;
        if (gameResult.isWinner) stats.wins_as_neutral++;
      }

      // Update role stats
      const roleStats = stats.role_stats ? JSON.parse(stats.role_stats) : {};
      if (!roleStats[gameResult.roleId]) {
        roleStats[gameResult.roleId] = { games: 0, wins: 0 };
      }
      roleStats[gameResult.roleId].games++;
      if (gameResult.isWinner) roleStats[gameResult.roleId].wins++;
      stats.role_stats = JSON.stringify(roleStats);

      // Update performance
      stats.total_kills += gameResult.playersKilled || 0;
      if (!gameResult.survived) stats.total_deaths++;
      if (gameResult.survived) stats.times_survived++;

      // Update average survival
      const totalTurns = (stats.average_survival_turns * (stats.total_games - 1)) + (gameResult.deathTurn || gameResult.totalTurns);
      stats.average_survival_turns = totalTurns / stats.total_games;

      // Update activity
      stats.total_actions += gameResult.actionsPerformed || 0;
      stats.total_votes += gameResult.votesCast || 0;
      stats.total_items_used += gameResult.itemsUsed || 0;

      // Update timestamps
      if (!stats.first_game_at) stats.first_game_at = Date.now();
      stats.last_game_at = Date.now();
      stats.updated_at = Date.now();

      // Save to database
      this.statements.upsertPlayerStats.run(
        userId, username, stats.total_games, stats.total_wins, stats.total_losses,
        stats.games_as_villager, stats.games_as_werewolf, stats.games_as_neutral,
        stats.wins_as_villager, stats.wins_as_werewolf, stats.wins_as_neutral,
        stats.role_stats, stats.total_kills, stats.total_deaths, stats.times_survived,
        stats.average_survival_turns, stats.total_actions, stats.total_votes,
        stats.total_items_used, stats.first_game_at, stats.last_game_at, stats.updated_at
      );

      // Check for achievements
      this.checkAchievements(userId, stats, gameResult);

      return stats;
    } catch (error) {
      console.error('[Werewolf] Failed to update player stats:', error);
      return null;
    }
  }

  /**
   * Get default stats object
   */
  getDefaultStats(userId, username) {
    return {
      user_id: userId,
      username,
      total_games: 0,
      total_wins: 0,
      total_losses: 0,
      games_as_villager: 0,
      games_as_werewolf: 0,
      games_as_neutral: 0,
      wins_as_villager: 0,
      wins_as_werewolf: 0,
      wins_as_neutral: 0,
      role_stats: '{}',
      total_kills: 0,
      total_deaths: 0,
      times_survived: 0,
      average_survival_turns: 0,
      total_actions: 0,
      total_votes: 0,
      total_items_used: 0,
      first_game_at: null,
      last_game_at: null,
      updated_at: Date.now()
    };
  }

  // ===== ACHIEVEMENTS =====

  /**
   * Check and unlock achievements
   * @param {string} userId
   * @param {Object} stats
   * @param {Object} gameResult
   */
  checkAchievements(userId, stats, gameResult) {
    const achievements = [];

    // First win
    if (stats.total_wins === 1) {
      achievements.push('first_win');
    }

    // Role-specific wins
    const roleStats = JSON.parse(stats.role_stats);
    if (roleStats.werewolf?.wins >= 10) {
      achievements.push('werewolf_master');
    }

    // Team wins
    if (stats.wins_as_villager >= 10) {
      achievements.push('villager_hero');
    }

    // Kills
    if (stats.total_kills >= 50) {
      achievements.push('serial_killer');
    }

    // Unlock achievements
    achievements.forEach(achievementId => {
      this.statements.unlockAchievement.run(
        userId,
        achievementId,
        gameResult.gameId,
        Date.now()
      );
    });

    return achievements;
  }

  // ===== LEADERBOARDS =====

  /**
   * Get top players by total wins
   * @param {number} minGames
   * @param {number} limit
   * @returns {Array}
   */
  getLeaderboard(minGames = 5, limit = 100) {
    return this.statements.getTopPlayers.all(minGames, limit);
  }

  /**
   * Get top players by win rate
   * @param {number} minGames
   * @param {number} limit
   * @returns {Array}
   */
  getLeaderboardByWinRate(minGames = 10, limit = 100) {
    return this.statements.getTopPlayersByWinRate.all(minGames, limit);
  }

  // ===== UTILITIES =====

  /**
   * Serialize players for storage
   * @param {GameRoom} room
   * @returns {Array}
   */
  serializePlayers(room) {
    return Array.from(room.players.values()).map(player => ({
      userId: player.userId,
      username: player.username,
      role: player.role?.id,
      team: player.team,
      isAlive: player.isAlive,
      lives: player.lives,
      armor: player.armor,
      items: player.items,
      isHost: player.isHost
    }));
  }

  /**
   * Serialize complete room state
   * @param {GameRoom} room
   * @returns {Object}
   */
  serializeRoom(room) {
    return {
      roomId: room.roomId,
      hostUserId: room.hostUserId,
      config: room.config,
      phase: room.phase,
      turn: room.turn,
      isStarted: room.isStarted,
      players: this.serializePlayers(room),
      actionHistory: room.actionHistory,
      deathHistory: room.deathHistory,
      chatChannels: room.chatChannels,
      createdAt: room.createdAt,
      startedAt: room.startedAt
    };
  }

  /**
   * Cleanup old games and inactive states
   * @param {number} retentionDays
   */
  cleanup(retentionDays = 30) {
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    const deletedGames = this.statements.deleteOldGames.run(cutoffTime);
    const deletedStates = this.statements.deleteInactiveStates.run(cutoffTime);

    console.log(`[Werewolf] Cleanup: ${deletedGames.changes} games, ${deletedStates.changes} states`);
  }

  /**
   * Close database connection (only if we own it)
   */
  close() {
    if (this.ownDb) {
      this.db.close();
    }
  }
}
