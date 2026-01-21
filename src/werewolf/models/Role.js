/**
 * Role definitions for Werewolf game
 * Defines abilities, teams, and win conditions for each role
 */

export class Role {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.team = config.team; // 'villagers', 'werewolves', 'neutral'
    this.description = config.description;

    // Stats
    this.maxLives = config.maxLives || 1;
    this.initialArmor = config.initialArmor || 0;

    // Abilities
    this.abilities = config.abilities || [];
    this.passiveAbilities = config.passiveAbilities || [];

    // Constraints
    this.maxPerGame = config.maxPerGame || 1;
    this.requiredPlayerCount = config.requiredPlayerCount || 0;

    // Metadata
    this.priority = config.priority || 0; // Action resolution order
    this.isUnique = config.isUnique !== false;
  }

  /**
   * Check if role can be used in a game with given player count
   * @param {number} playerCount
   * @returns {boolean}
   */
  isAvailableFor(playerCount) {
    return playerCount >= this.requiredPlayerCount;
  }
}

/**
 * Ability definition
 */
export class Ability {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type; // 'night', 'day', 'passive', 'triggered'
    this.usesPerGame = config.usesPerGame || Infinity;
    this.usesPerNight = config.usesPerNight || 1;
    this.cooldown = config.cooldown || 0;
    this.targetType = config.targetType; // 'single', 'multiple', 'self', 'none'
    this.targetRestrictions = config.targetRestrictions || {}; // {canTargetDead, canTargetSelf, etc}
  }
}

/**
 * Predefined roles for the game
 */
export const ROLES = {
  // ===== VILLAGERS TEAM =====
  VILLAGER: new Role({
    id: 'villager',
    name: 'Villageois',
    team: 'villagers',
    description: 'Un habitant ordinaire du village. Pas de pouvoir spécial, mais peut voter.',
    maxLives: 1,
    maxPerGame: Infinity,
    priority: 0
  }),

  SEER: new Role({
    id: 'seer',
    name: 'Voyante',
    team: 'villagers',
    description: 'Peut voir le rôle d\'un joueur chaque nuit.',
    maxLives: 1,
    abilities: [
      new Ability({
        id: 'seer_vision',
        name: 'Vision',
        description: 'Révèle le rôle d\'un joueur',
        type: 'night',
        usesPerNight: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false, canTargetSelf: false }
      })
    ],
    requiredPlayerCount: 4,
    priority: 50
  }),

  GUARDIAN: new Role({
    id: 'guardian',
    name: 'Gardien',
    team: 'villagers',
    description: 'Protège un joueur chaque nuit contre une attaque.',
    maxLives: 1,
    abilities: [
      new Ability({
        id: 'guard_protect',
        name: 'Protection',
        description: 'Protège un joueur pour cette nuit',
        type: 'night',
        usesPerNight: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false, canTargetSelf: true }
      })
    ],
    requiredPlayerCount: 6,
    priority: 100
  }),

  WITCH: new Role({
    id: 'witch',
    name: 'Sorcière',
    team: 'villagers',
    description: 'Possède une potion de vie et une potion de mort (utilisables une fois).',
    maxLives: 1,
    abilities: [
      new Ability({
        id: 'witch_heal',
        name: 'Potion de Vie',
        description: 'Ressuscite un joueur tué cette nuit',
        type: 'night',
        usesPerGame: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: true, mustBeKilledTonight: true }
      }),
      new Ability({
        id: 'witch_kill',
        name: 'Potion de Mort',
        description: 'Tue un joueur',
        type: 'night',
        usesPerGame: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false, canTargetSelf: false }
      })
    ],
    requiredPlayerCount: 8,
    priority: 90
  }),

  HUNTER: new Role({
    id: 'hunter',
    name: 'Chasseur',
    team: 'villagers',
    description: 'Peut tuer un joueur en mourant.',
    maxLives: 1,
    abilities: [
      new Ability({
        id: 'hunter_revenge',
        name: 'Vengeance',
        description: 'Tue un joueur en mourant',
        type: 'triggered',
        usesPerGame: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false }
      })
    ],
    requiredPlayerCount: 6,
    priority: 200
  }),

  // ===== WEREWOLVES TEAM =====
  WEREWOLF: new Role({
    id: 'werewolf',
    name: 'Loup-Garou',
    team: 'werewolves',
    description: 'Tue un villageois chaque nuit avec les autres loups.',
    maxLives: 1,
    maxPerGame: Infinity,
    abilities: [
      new Ability({
        id: 'werewolf_kill',
        name: 'Attaque',
        description: 'Vote pour tuer un joueur (collectif)',
        type: 'night',
        usesPerNight: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false, canTargetSelf: false, mustNotBeWerewolf: true }
      })
    ],
    requiredPlayerCount: 3,
    priority: 10
  }),

  ALPHA_WEREWOLF: new Role({
    id: 'alpha_werewolf',
    name: 'Loup Alpha',
    team: 'werewolves',
    description: 'Loup-Garou avec 2 vies et une armure.',
    maxLives: 2,
    initialArmor: 1,
    abilities: [
      new Ability({
        id: 'werewolf_kill',
        name: 'Attaque',
        description: 'Vote pour tuer un joueur (collectif)',
        type: 'night',
        usesPerNight: 1,
        targetType: 'single',
        targetRestrictions: { canTargetDead: false, canTargetSelf: false, mustNotBeWerewolf: true }
      })
    ],
    requiredPlayerCount: 10,
    priority: 10
  }),

  // ===== NEUTRAL ROLES =====
  TRICKSTER: new Role({
    id: 'trickster',
    name: 'Farceur',
    team: 'neutral',
    description: 'Gagne si il survit jusqu\'à la fin ou si il se fait éliminer par vote.',
    maxLives: 1,
    abilities: [
      new Ability({
        id: 'trickster_confuse',
        name: 'Confusion',
        description: 'Échange les rôles apparents de 2 joueurs pour la Voyante',
        type: 'night',
        usesPerGame: 2,
        targetType: 'multiple',
        targetRestrictions: { targetCount: 2, canTargetDead: false }
      })
    ],
    requiredPlayerCount: 8,
    priority: 60
  }),

  CURSED: new Role({
    id: 'cursed',
    name: 'Maudit',
    team: 'villagers',
    description: 'Villageois qui devient loup-garou s\'il est attaqué par les loups.',
    maxLives: 1,
    passiveAbilities: ['transform_on_attack'],
    requiredPlayerCount: 10,
    priority: 5
  })
};

/**
 * Get roles suitable for a game with given player count
 * @param {number} playerCount
 * @returns {Object} Available roles
 */
export function getAvailableRoles(playerCount) {
  const available = {};

  for (const [key, role] of Object.entries(ROLES)) {
    if (role.isAvailableFor(playerCount)) {
      available[key] = role;
    }
  }

  return available;
}

/**
 * Generate a balanced role distribution for a game
 * @param {number} playerCount
 * @returns {Array<Role>} Array of roles to assign
 */
export function generateRoleDistribution(playerCount) {
  const roles = [];

  // Calculate werewolf count (roughly 1/3 of players, minimum 1)
  const werewolfCount = Math.max(1, Math.floor(playerCount / 3));

  // Add werewolves
  for (let i = 0; i < werewolfCount; i++) {
    if (i === 0 && playerCount >= 10) {
      roles.push(ROLES.ALPHA_WEREWOLF);
    } else {
      roles.push(ROLES.WEREWOLF);
    }
  }

  // Add special villager roles based on player count
  const availableRoles = getAvailableRoles(playerCount);
  const specialRoles = [];

  if (availableRoles.SEER) specialRoles.push(ROLES.SEER);
  if (availableRoles.GUARDIAN && playerCount >= 6) specialRoles.push(ROLES.GUARDIAN);
  if (availableRoles.WITCH && playerCount >= 8) specialRoles.push(ROLES.WITCH);
  if (availableRoles.HUNTER && playerCount >= 6) specialRoles.push(ROLES.HUNTER);
  if (availableRoles.TRICKSTER && playerCount >= 8 && Math.random() > 0.5) {
    specialRoles.push(ROLES.TRICKSTER);
  }
  if (availableRoles.CURSED && playerCount >= 10 && Math.random() > 0.7) {
    specialRoles.push(ROLES.CURSED);
  }

  // Add special roles
  roles.push(...specialRoles);

  // Fill remaining slots with regular villagers
  while (roles.length < playerCount) {
    roles.push(ROLES.VILLAGER);
  }

  return roles;
}
