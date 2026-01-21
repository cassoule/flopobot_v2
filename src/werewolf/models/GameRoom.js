import { Player } from './Player.js';
import { generateRoleDistribution } from './Role.js';

/**
 * GameRoom class - Manages a single Werewolf game instance
 * Handles game state, phases, player actions, and win conditions
 */
export class GameRoom {
  constructor(roomId, hostUserId, config = {}) {
    this.roomId = roomId;
    this.hostUserId = hostUserId;

    // Configuration
    this.config = {
      minPlayers: config.minPlayers || 2,
      maxPlayers: config.maxPlayers || 20,
      dayDuration: config.dayDuration || 120000, // 2 minutes
      nightDuration: config.nightDuration || 90000, // 1.5 minutes
      voteDuration: config.voteDuration || 60000, // 1 minute
      discussionDuration: config.discussionDuration || 180000, // 3 minutes
      enableItems: config.enableItems !== false,
      enableChat: config.enableChat !== false,
      customRoles: config.customRoles || null
    };

    // Game state
    this.players = new Map(); // userId -> Player
    this.phase = 'lobby'; // 'lobby', 'night', 'day', 'voting', 'ended'
    this.turn = 0;
    this.isStarted = false;
    this.winnersTeam = null;

    // Phase-specific state
    this.nightActions = new Map(); // playerId -> {action, target}
    this.dayVotes = new Map(); // playerId -> targetId
    this.chatChannels = {
      all: [],
      werewolves: [],
      dead: []
    };

    // Timers
    this.phaseTimer = null;
    this.phaseEndTime = null;

    // History
    this.actionHistory = [];
    this.deathHistory = [];

    // Metadata
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
  }

  // ===== PLAYER MANAGEMENT =====

  /**
   * Add a player to the room
   * @param {string} userId
   * @param {string} username
   * @param {string} socketId
   * @returns {Player|null}
   */
  addPlayer(userId, username, socketId) {
    if (this.isStarted) {
      throw new Error('Cannot join game in progress');
    }

    if (this.players.size >= this.config.maxPlayers) {
      throw new Error('Room is full');
    }

    if (this.players.has(userId)) {
      // Update socket ID if reconnecting
      const player = this.players.get(userId);
      player.socketId = socketId;
      return player;
    }

    const player = new Player(userId, username, socketId);
    player.isHost = userId === this.hostUserId;
    this.players.set(userId, player);

    return player;
  }

  /**
   * Remove a player from the room
   * @param {string} userId
   * @returns {boolean}
   */
  removePlayer(userId) {
    if (this.isStarted) {
      // Don't remove, just mark as disconnected
      const player = this.players.get(userId);
      if (player) {
        player.socketId = null;
      }
      return false;
    }

    return this.players.delete(userId);
  }

  /**
   * Get player by user ID
   * @param {string} userId
   * @returns {Player|null}
   */
  getPlayer(userId) {
    return this.players.get(userId) || null;
  }

  /**
   * Get all alive players
   * @returns {Array<Player>}
   */
  getAlivePlayers() {
    return Array.from(this.players.values()).filter(p => p.isAlive);
  }

  /**
   * Get players by team
   * @param {string} team
   * @returns {Array<Player>}
   */
  getPlayersByTeam(team) {
    return Array.from(this.players.values()).filter(p => p.team === team);
  }

  // ===== GAME FLOW =====

  /**
   * Start the game
   * @returns {boolean}
   */
  startGame() {
    if (this.isStarted) {
      throw new Error('Game already started');
    }

    if (this.players.size < this.config.minPlayers) {
      throw new Error(`Need at least ${this.config.minPlayers} players`);
    }

    // Check all players are ready
    const notReady = Array.from(this.players.values()).filter(p => !p.isReady && !p.isHost);
    if (notReady.length > 0) {
      throw new Error('Not all players are ready');
    }

    // Assign roles
    this.assignRoles();

    // Initialize game state
    this.isStarted = true;
    this.startedAt = Date.now();
    this.turn = 1;

    // Start first night
    this.transitionToPhase('night');

    this.logAction('GAME_START', null, null, { playerCount: this.players.size });

    return true;
  }

  /**
   * Assign roles to all players
   */
  assignRoles() {
    const playerArray = Array.from(this.players.values());
    const roles = this.config.customRoles || generateRoleDistribution(playerArray.length);

    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    // Assign to players
    playerArray.forEach((player, index) => {
      const role = roles[index];
      player.role = role;
      player.team = role.team;
      player.lives = role.maxLives;
      player.armor = role.initialArmor;
    });
  }

  /**
   * Transition to a new game phase
   * @param {string} newPhase
   */
  transitionToPhase(newPhase) {
    this.phase = newPhase;

    // Clear previous phase data
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }

    this.nightActions.clear();
    this.dayVotes.clear();

    // Set phase duration
    let duration;
    switch (newPhase) {
      case 'night':
        duration = this.config.nightDuration;
        break;
      case 'day':
        duration = this.config.discussionDuration;
        break;
      case 'voting':
        duration = this.config.voteDuration;
        break;
      default:
        duration = 0;
    }

    if (duration > 0) {
      this.phaseEndTime = Date.now() + duration;
      this.phaseTimer = setTimeout(() => {
        this.handlePhaseEnd();
      }, duration);
    }

    this.logAction('PHASE_CHANGE', null, null, { phase: newPhase, turn: this.turn });
  }

  /**
   * Handle end of current phase
   */
  handlePhaseEnd() {
    switch (this.phase) {
      case 'night':
        this.resolveNightActions();
        break;
      case 'day':
        this.transitionToPhase('voting');
        break;
      case 'voting':
        this.resolveVoting();
        break;
    }
  }

  // ===== NIGHT PHASE =====

  /**
   * Register a night action
   * @param {string} playerId
   * @param {string} abilityId
   * @param {string|Array<string>} targets
   * @returns {boolean}
   */
  registerNightAction(playerId, abilityId, targets) {
    const player = this.getPlayer(playerId);

    if (!player || !player.canAct()) {
      throw new Error('Player cannot act');
    }

    if (this.phase !== 'night') {
      throw new Error('Not night phase');
    }

    // Validate ability
    const ability = player.role.abilities.find(a => a.id === abilityId && a.type === 'night');
    if (!ability) {
      throw new Error('Invalid ability');
    }

    // Validate targets
    const targetArray = Array.isArray(targets) ? targets : [targets];
    if (!this.validateTargets(player, ability, targetArray)) {
      throw new Error('Invalid targets');
    }

    this.nightActions.set(playerId, {
      playerId,
      abilityId,
      targets: targetArray,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Resolve all night actions
   */
  resolveNightActions() {
    const actions = Array.from(this.nightActions.values());

    // Sort by role priority (higher priority executes first)
    actions.sort((a, b) => {
      const playerA = this.getPlayer(a.playerId);
      const playerB = this.getPlayer(b.playerId);
      return (playerB.role?.priority || 0) - (playerA.role?.priority || 0);
    });

    const results = [];

    // Werewolf collective kill
    const werewolfVotes = actions.filter(a => a.abilityId === 'werewolf_kill');
    if (werewolfVotes.length > 0) {
      const targetCounts = {};
      werewolfVotes.forEach(vote => {
        const target = vote.targets[0];
        targetCounts[target] = (targetCounts[target] || 0) + 1;
      });

      const mostVoted = Object.keys(targetCounts).reduce((a, b) =>
        targetCounts[a] > targetCounts[b] ? a : b
      );

      const target = this.getPlayer(mostVoted);
      if (target) {
        const result = target.takeDamage(1);
        results.push({
          type: 'werewolf_kill',
          target: mostVoted,
          result
        });

        if (result.killed) {
          this.deathHistory.push({
            playerId: mostVoted,
            turn: this.turn,
            phase: 'night',
            cause: 'werewolf_attack'
          });
        }
      }
    }

    // Execute other actions
    actions.forEach(action => {
      if (action.abilityId === 'werewolf_kill') return; // Already handled

      const result = this.executeAbility(action);
      if (result) {
        results.push(result);
      }
    });

    // Tick status effects
    this.getAlivePlayers().forEach(p => p.tickStatusEffects());

    // Check win condition
    if (this.checkWinCondition()) {
      this.endGame();
    } else {
      // Move to day phase
      this.turn++;
      this.transitionToPhase('day');
    }

    return results;
  }

  // ===== DAY/VOTING PHASE =====

  /**
   * Register a vote
   * @param {string} voterId
   * @param {string} targetId
   * @returns {boolean}
   */
  registerVote(voterId, targetId) {
    const voter = this.getPlayer(voterId);

    if (!voter || !voter.canAct()) {
      throw new Error('Player cannot vote');
    }

    if (this.phase !== 'voting') {
      throw new Error('Not voting phase');
    }

    const target = this.getPlayer(targetId);
    if (!target || !target.isAlive) {
      throw new Error('Invalid target');
    }

    this.dayVotes.set(voterId, targetId);
    return true;
  }

  /**
   * Resolve voting
   */
  resolveVoting() {
    const votes = Array.from(this.dayVotes.values());
    const voteCounts = {};

    votes.forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedId = null;

    Object.entries(voteCounts).forEach(([playerId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = playerId;
      }
    });

    // Eliminate player if majority reached
    const alivePlayers = this.getAlivePlayers();
    const majorityNeeded = Math.floor(alivePlayers.length / 2) + 1;

    if (eliminatedId && maxVotes >= majorityNeeded) {
      const eliminated = this.getPlayer(eliminatedId);
      eliminated.takeDamage(eliminated.lives); // Instant kill
      eliminated.isAlive = false;

      this.deathHistory.push({
        playerId: eliminatedId,
        turn: this.turn,
        phase: 'day',
        cause: 'voted_out',
        votes: maxVotes
      });

      this.logAction('PLAYER_ELIMINATED', null, eliminatedId, { votes: maxVotes });
    }

    // Check win condition
    if (this.checkWinCondition()) {
      this.endGame();
    } else {
      // Move to next night
      this.transitionToPhase('night');
    }
  }

  // ===== ABILITY EXECUTION =====

  /**
   * Execute an ability
   * @param {Object} action
   * @returns {Object|null}
   */
  executeAbility(action) {
    const player = this.getPlayer(action.playerId);
    if (!player) return null;

    switch (action.abilityId) {
      case 'seer_vision':
        return this.executeSeerVision(player, action.targets[0]);

      case 'guard_protect':
        return this.executeGuardProtect(player, action.targets[0]);

      case 'witch_heal':
        return this.executeWitchHeal(player, action.targets[0]);

      case 'witch_kill':
        return this.executeWitchKill(player, action.targets[0]);

      case 'hunter_revenge':
        return this.executeHunterRevenge(player, action.targets[0]);

      default:
        return null;
    }
  }

  executeSeerVision(seer, targetId) {
    const target = this.getPlayer(targetId);
    if (!target) return null;

    return {
      type: 'seer_vision',
      seer: seer.userId,
      target: targetId,
      role: target.role.name,
      team: target.team
    };
  }

  executeGuardProtect(guard, targetId) {
    const target = this.getPlayer(targetId);
    if (!target) return null;

    target.isProtected = true;

    return {
      type: 'guard_protect',
      guard: guard.userId,
      target: targetId
    };
  }

  executeWitchHeal(witch, targetId) {
    const target = this.getPlayer(targetId);
    if (!target) return null;

    // Find if target was killed tonight
    const killedTonight = this.deathHistory.find(
      d => d.playerId === targetId && d.turn === this.turn && d.phase === 'night'
    );

    if (killedTonight) {
      target.isAlive = true;
      target.lives = 1;

      // Remove from death history
      this.deathHistory = this.deathHistory.filter(d => d !== killedTonight);

      return {
        type: 'witch_heal',
        witch: witch.userId,
        target: targetId,
        success: true
      };
    }

    return {
      type: 'witch_heal',
      witch: witch.userId,
      target: targetId,
      success: false
    };
  }

  executeWitchKill(witch, targetId) {
    const target = this.getPlayer(targetId);
    if (!target) return null;

    const result = target.takeDamage(999); // Instant kill

    if (result.killed) {
      this.deathHistory.push({
        playerId: targetId,
        turn: this.turn,
        phase: 'night',
        cause: 'witch_poison'
      });
    }

    return {
      type: 'witch_kill',
      witch: witch.userId,
      target: targetId,
      result
    };
  }

  executeHunterRevenge(hunter, targetId) {
    const target = this.getPlayer(targetId);
    if (!target) return null;

    const result = target.takeDamage(999);

    if (result.killed) {
      this.deathHistory.push({
        playerId: targetId,
        turn: this.turn,
        phase: this.phase,
        cause: 'hunter_revenge'
      });
    }

    return {
      type: 'hunter_revenge',
      hunter: hunter.userId,
      target: targetId,
      result
    };
  }

  // ===== VALIDATION =====

  /**
   * Validate ability targets
   * @param {Player} player
   * @param {Ability} ability
   * @param {Array<string>} targets
   * @returns {boolean}
   */
  validateTargets(player, ability, targets) {
    const restrictions = ability.targetRestrictions;

    // Check target count
    if (ability.targetType === 'single' && targets.length !== 1) return false;
    if (restrictions.targetCount && targets.length !== restrictions.targetCount) return false;

    // Check each target
    for (const targetId of targets) {
      const target = this.getPlayer(targetId);
      if (!target) return false;

      if (!restrictions.canTargetDead && !target.isAlive) return false;
      if (!restrictions.canTargetSelf && targetId === player.userId) return false;
      if (restrictions.mustNotBeWerewolf && target.team === 'werewolves') return false;
    }

    return true;
  }

  // ===== WIN CONDITION =====

  /**
   * Check if a team has won
   * @returns {boolean}
   */
  checkWinCondition() {
    const aliveVillagers = this.getPlayersByTeam('villagers').filter(p => p.isAlive);
    const aliveWerewolves = this.getPlayersByTeam('werewolves').filter(p => p.isAlive);

    // Werewolves win if they equal or outnumber villagers
    if (aliveWerewolves.length >= aliveVillagers.length && aliveWerewolves.length > 0) {
      this.winnersTeam = 'werewolves';
      return true;
    }

    // Villagers win if all werewolves are dead
    if (aliveWerewolves.length === 0) {
      this.winnersTeam = 'villagers';
      return true;
    }

    return false;
  }

  /**
   * End the game
   */
  endGame() {
    this.phase = 'ended';
    this.endedAt = Date.now();

    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }

    this.logAction('GAME_END', null, null, {
      winner: this.winnersTeam,
      duration: this.endedAt - this.startedAt,
      turns: this.turn
    });
  }

  // ===== UTILITIES =====

  /**
   * Log an action to history
   * @param {string} type
   * @param {string|null} actorId
   * @param {string|null} targetId
   * @param {Object} metadata
   */
  logAction(type, actorId, targetId, metadata = {}) {
    this.actionHistory.push({
      type,
      actorId,
      targetId,
      metadata,
      turn: this.turn,
      phase: this.phase,
      timestamp: Date.now()
    });
  }

  /**
   * Get room state for a specific player
   * @param {string} userId
   * @returns {Object}
   */
  getRoomStateForPlayer(userId) {
    const player = this.getPlayer(userId);
    const isPlayer = !!player;
    const canSeeAll = !player?.isAlive; // Dead players see everything

    return {
      roomId: this.roomId,
      phase: this.phase,
      turn: this.turn,
      isStarted: this.isStarted,
      phaseEndTime: this.phaseEndTime,
      config: this.config,
      players: Array.from(this.players.values()).map(p =>
        p.userId === userId || canSeeAll ? p.getPrivateData() : p.getPublicData()
      ),
      myPlayer: player ? player.getPrivateData() : null,
      chatChannels: this.getChatChannelsForPlayer(userId),
      recentDeaths: this.deathHistory.slice(-3),
      winnersTeam: this.winnersTeam
    };
  }

  /**
   * Get accessible chat channels for a player
   * @param {string} userId
   * @returns {Array<string>}
   */
  getChatChannelsForPlayer(userId) {
    const player = this.getPlayer(userId);
    if (!player) return ['all'];

    const channels = ['all'];

    if (player.team === 'werewolves' && player.isAlive) {
      channels.push('werewolves');
    }

    if (!player.isAlive) {
      channels.push('dead');
    }

    return channels;
  }
}
