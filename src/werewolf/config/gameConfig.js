/**
 * Werewolf game configuration
 * Central configuration file for game rules and constants
 */

export const GAME_CONFIG = {
  // ===== ROOM LIMITS =====
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 20,
  DEFAULT_MAX_PLAYERS: 12,

  // ===== PHASE DURATIONS (milliseconds) =====
  NIGHT_DURATION: 90000, // 1.5 minutes
  DAY_DURATION: 180000, // 3 minutes
  VOTING_DURATION: 60000, // 1 minute
  DISCUSSION_DURATION: 120000, // 2 minutes

  // ===== GAME MECHANICS =====
  ENABLE_ITEMS: true,
  ENABLE_CHAT: true,
  ENABLE_MULTIPLE_LIVES: true,
  ENABLE_ARMOR: true,

  // ===== ROLE DISTRIBUTION =====
  WEREWOLF_RATIO: 0.33, // 33% of players are werewolves
  MIN_WEREWOLVES: 1,
  MAX_WEREWOLVES: 7,

  // Special roles unlock thresholds
  SEER_MIN_PLAYERS: 4,
  GUARDIAN_MIN_PLAYERS: 6,
  WITCH_MIN_PLAYERS: 8,
  HUNTER_MIN_PLAYERS: 6,
  ALPHA_WEREWOLF_MIN_PLAYERS: 10,
  TRICKSTER_MIN_PLAYERS: 8,
  CURSED_MIN_PLAYERS: 10,

  // ===== ITEMS & BONUSES =====
  ITEMS: {
    SHIELD: {
      id: 'shield',
      name: 'Bouclier',
      description: 'Protège contre une attaque',
      type: 'defensive',
      uses: 1,
      rarity: 'common'
    },
    EXTRA_LIFE: {
      id: 'extra_life',
      name: 'Vie Supplémentaire',
      description: 'Ajoute une vie',
      type: 'defensive',
      uses: 1,
      rarity: 'rare'
    },
    ARMOR: {
      id: 'armor',
      name: 'Armure',
      description: 'Réduit les dégâts de 1',
      type: 'defensive',
      uses: 3,
      rarity: 'uncommon'
    },
    VISION_POTION: {
      id: 'vision_potion',
      name: 'Potion de Vision',
      description: 'Révèle le rôle d\'un joueur',
      type: 'utility',
      uses: 1,
      rarity: 'rare'
    },
    SILENCE: {
      id: 'silence',
      name: 'Silence',
      description: 'Empêche un joueur de voter',
      type: 'offensive',
      uses: 1,
      rarity: 'uncommon'
    }
  },

  // ===== VOTING MECHANICS =====
  MAJORITY_VOTE_REQUIRED: true, // Requires >50% of alive players to vote
  TIE_BREAKER: 'no_elimination', // 'no_elimination' or 'random'

  // ===== WIN CONDITIONS =====
  WIN_CONDITIONS: {
    WEREWOLVES: 'werewolves_equal_or_outnumber_villagers',
    VILLAGERS: 'all_werewolves_dead',
    TRICKSTER: 'survive_or_voted_out'
  },

  // ===== CHAT CHANNELS =====
  CHAT_CHANNELS: {
    ALL: 'all',
    WEREWOLVES: 'werewolves',
    DEAD: 'dead'
  },

  // ===== PERSISTENCE =====
  AUTO_SAVE_INTERVAL: 30000, // Save game state every 30 seconds
  CLEANUP_INTERVAL: 300000, // Clean up finished games every 5 minutes
  GAME_RETENTION_DAYS: 30,

  // ===== RATE LIMITING =====
  MAX_ACTIONS_PER_PHASE: 5,
  MAX_CHAT_MESSAGES_PER_MINUTE: 10,

  // ===== NOTIFICATIONS =====
  NOTIFY_ON_DEATH: true,
  NOTIFY_ON_PHASE_CHANGE: true,
  NOTIFY_ON_ROLE_REVEAL: true,

  // ===== SPECTATOR MODE =====
  ALLOW_SPECTATORS: true,
  DEAD_PLAYERS_CAN_SPECTATE: true,
  SPECTATOR_CHAT_ENABLED: true
};

/**
 * Get configuration for a specific player count
 * @param {number} playerCount
 * @returns {Object}
 */
export function getConfigForPlayerCount(playerCount) {
  const werewolfCount = Math.max(
    GAME_CONFIG.MIN_WEREWOLVES,
    Math.min(
      GAME_CONFIG.MAX_WEREWOLVES,
      Math.floor(playerCount * GAME_CONFIG.WEREWOLF_RATIO)
    )
  );

  return {
    playerCount,
    werewolfCount,
    villagerCount: playerCount - werewolfCount,
    availableRoles: getAvailableRolesForCount(playerCount)
  };
}

/**
 * Get available roles for a player count
 * @param {number} playerCount
 * @returns {Array<string>}
 */
function getAvailableRolesForCount(playerCount) {
  const roles = ['VILLAGER', 'WEREWOLF'];

  if (playerCount >= GAME_CONFIG.SEER_MIN_PLAYERS) roles.push('SEER');
  if (playerCount >= GAME_CONFIG.GUARDIAN_MIN_PLAYERS) roles.push('GUARDIAN');
  if (playerCount >= GAME_CONFIG.WITCH_MIN_PLAYERS) roles.push('WITCH');
  if (playerCount >= GAME_CONFIG.HUNTER_MIN_PLAYERS) roles.push('HUNTER');
  if (playerCount >= GAME_CONFIG.ALPHA_WEREWOLF_MIN_PLAYERS) roles.push('ALPHA_WEREWOLF');
  if (playerCount >= GAME_CONFIG.TRICKSTER_MIN_PLAYERS) roles.push('TRICKSTER');
  if (playerCount >= GAME_CONFIG.CURSED_MIN_PLAYERS) roles.push('CURSED');

  return roles;
}

/**
 * Validate game configuration
 * @param {Object} config
 * @returns {Object} Validated config
 */
export function validateConfig(config) {
  return {
    minPlayers: Math.max(GAME_CONFIG.MIN_PLAYERS, config.minPlayers || GAME_CONFIG.MIN_PLAYERS),
    maxPlayers: Math.min(GAME_CONFIG.MAX_PLAYERS, config.maxPlayers || GAME_CONFIG.DEFAULT_MAX_PLAYERS),
    dayDuration: config.dayDuration || GAME_CONFIG.DAY_DURATION,
    nightDuration: config.nightDuration || GAME_CONFIG.NIGHT_DURATION,
    voteDuration: config.voteDuration || GAME_CONFIG.VOTING_DURATION,
    discussionDuration: config.discussionDuration || GAME_CONFIG.DISCUSSION_DURATION,
    enableItems: config.enableItems !== false,
    enableChat: config.enableChat !== false,
    customRoles: config.customRoles || null
  };
}

/**
 * Get item by ID
 * @param {string} itemId
 * @returns {Object|null}
 */
export function getItem(itemId) {
  return Object.values(GAME_CONFIG.ITEMS).find(item => item.id === itemId) || null;
}

/**
 * Get random item based on rarity
 * @returns {Object}
 */
export function getRandomItem() {
  const rarityWeights = {
    common: 50,
    uncommon: 30,
    rare: 15,
    epic: 4,
    legendary: 1
  };

  const items = Object.values(GAME_CONFIG.ITEMS);
  const totalWeight = items.reduce((sum, item) => sum + (rarityWeights[item.rarity] || 1), 0);

  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= rarityWeights[item.rarity] || 1;
    if (random <= 0) {
      return item;
    }
  }

  return items[0];
}
