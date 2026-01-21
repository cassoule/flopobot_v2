import { getUser } from '../../database/index.js';

/**
 * Player model for Werewolf game
 * Represents a single player in a game room
 */
export class Player {
  constructor(userId, username, socketId) {
    this.userId = userId;
    this.username = username;
    this.avatarUrl = getUser.get(userId)?.avatarUrl || null;
    this.socketId = socketId;

    // Game state
    this.role = null;
    this.team = null;
    this.isAlive = true;
    this.lives = 1; // Can be increased by role/items
    this.armor = 0;  // Damage reduction

    // Status effects
    this.isProtected = false; // Protected this turn
    this.isSilenced = false;  // Cannot vote
    this.isRevealed = false;  // Role is public
    this.statusEffects = [];  // Array of {type, duration, source}

    // Inventory & stats
    this.items = [];
    this.bonuses = [];
    this.votesAgainst = 0; // Current round votes
    this.actionsUsed = 0;  // Actions performed this turn

    // Metadata
    this.isHost = false;
    this.isReady = false;
    this.lastAction = null;
    this.joinedAt = Date.now();
  }

  /**
   * Apply damage to player, accounting for armor and lives
   * @param {number} damage - Amount of damage to apply
   * @returns {Object} Result of damage application
   */
  takeDamage(damage) {
    if (this.isProtected) {
      return { killed: false, damageDealt: 0, protected: true };
    }

    const actualDamage = Math.max(0, damage - this.armor);

    if (actualDamage > 0) {
      this.lives -= actualDamage;

      if (this.lives <= 0) {
        this.isAlive = false;
        return { killed: true, damageDealt: actualDamage, livesRemaining: 0 };
      }
    }

    return { killed: false, damageDealt: actualDamage, livesRemaining: this.lives };
  }

  /**
   * Heal player
   * @param {number} amount - Amount of lives to restore
   */
  heal(amount) {
    const maxLives = this.role?.maxLives || 1;
    this.lives = Math.min(this.lives + amount, maxLives);
  }

  /**
   * Add an item to player's inventory
   * @param {Object} item - Item to add
   */
  addItem(item) {
    this.items.push({
      id: item.id,
      name: item.name,
      type: item.type,
      usesRemaining: item.uses || 1,
      acquiredAt: Date.now()
    });
  }

  /**
   * Use an item from inventory
   * @param {string} itemId - ID of item to use
   * @returns {Object|null} Item if found and usable, null otherwise
   */
  useItem(itemId) {
    const itemIndex = this.items.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return null;

    const item = this.items[itemIndex];
    item.usesRemaining--;

    if (item.usesRemaining <= 0) {
      this.items.splice(itemIndex, 1);
    }

    return item;
  }

  /**
   * Add a status effect
   * @param {string} type - Effect type (e.g., 'poison', 'shield')
   * @param {number} duration - Duration in turns
   * @param {string} source - Source of the effect
   */
  addStatusEffect(type, duration, source) {
    this.statusEffects.push({
      type,
      duration,
      source,
      appliedAt: Date.now()
    });
  }

  /**
   * Tick down status effect durations
   */
  tickStatusEffects() {
    this.statusEffects = this.statusEffects.filter(effect => {
      effect.duration--;
      return effect.duration > 0;
    });

    // Reset temporary flags
    this.isProtected = false;
    this.isSilenced = false;
  }

  /**
   * Check if player can perform actions
   * @returns {boolean}
   */
  canAct() {
    return this.isAlive && !this.isSilenced;
  }

  /**
   * Get sanitized player data for public view
   * @param {boolean} includeRole - Whether to include role info
   * @returns {Object}
   */
  getPublicData(includeRole = false) {
    return {
      userId: this.userId,
      username: this.username,
      avatarUrl: this.avatarUrl,
      isAlive: this.isAlive,
      lives: this.lives,
      armor: this.armor,
      isProtected: this.isProtected,
      isSilenced: this.isSilenced,
      isRevealed: this.isRevealed,
      isHost: this.isHost,
      isReady: this.isReady,
      role: (includeRole || this.isRevealed) ? this.role?.name : null,
      team: (includeRole || this.isRevealed) ? this.team : null,
      itemCount: this.items.length,
      statusEffects: this.statusEffects.map(e => ({ type: e.type, duration: e.duration }))
    };
  }

  /**
   * Get complete player data (for the player themselves)
   * @returns {Object}
   */
  getPrivateData() {
    return {
      ...this.getPublicData(true),
      items: this.items,
      bonuses: this.bonuses,
      actionsUsed: this.actionsUsed
    };
  }
}
