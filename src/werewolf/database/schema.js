/**
 * Database schema for Werewolf game persistence
 * Supports both SQLite and potential future migration to PostgreSQL
 */

export const WEREWOLF_SCHEMA = {
  // ===== GAME SESSIONS =====
  werewolf_games: `
    CREATE TABLE IF NOT EXISTS werewolf_games (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      host_user_id TEXT NOT NULL,

      -- Game configuration
      config TEXT NOT NULL, -- JSON serialized config

      -- Game state
      phase TEXT NOT NULL DEFAULT 'lobby', -- lobby, night, day, voting, ended
      turn INTEGER DEFAULT 0,
      is_started BOOLEAN DEFAULT 0,
      winners_team TEXT, -- villagers, werewolves, neutral, null

      -- Timestamps
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,

      -- Game data (serialized for persistence)
      players_snapshot TEXT, -- JSON serialized player states
      action_history TEXT, -- JSON serialized action log
      death_history TEXT, -- JSON serialized death log

      -- Metadata
      player_count INTEGER DEFAULT 0,
      duration INTEGER, -- Game duration in milliseconds

      UNIQUE(room_id)
    )
  `,

  // ===== PLAYER GAME RECORDS =====
  werewolf_player_games: `
    CREATE TABLE IF NOT EXISTS werewolf_player_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,

      -- Role & team
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      team TEXT NOT NULL,

      -- Game outcome
      is_winner BOOLEAN DEFAULT 0,
      survived BOOLEAN DEFAULT 0,
      death_turn INTEGER,
      death_phase TEXT,
      death_cause TEXT,

      -- Stats
      actions_performed INTEGER DEFAULT 0,
      votes_cast INTEGER DEFAULT 0,
      items_used INTEGER DEFAULT 0,
      damage_dealt INTEGER DEFAULT 0,
      damage_taken INTEGER DEFAULT 0,
      players_killed INTEGER DEFAULT 0,

      -- Timestamps
      joined_at INTEGER NOT NULL,
      left_at INTEGER,

      FOREIGN KEY (game_id) REFERENCES werewolf_games(id) ON DELETE CASCADE
    )
  `,

  // ===== PLAYER STATISTICS =====
  werewolf_player_stats: `
    CREATE TABLE IF NOT EXISTS werewolf_player_stats (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,

      -- Overall stats
      total_games INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_losses INTEGER DEFAULT 0,

      -- Team stats
      games_as_villager INTEGER DEFAULT 0,
      games_as_werewolf INTEGER DEFAULT 0,
      games_as_neutral INTEGER DEFAULT 0,
      wins_as_villager INTEGER DEFAULT 0,
      wins_as_werewolf INTEGER DEFAULT 0,
      wins_as_neutral INTEGER DEFAULT 0,

      -- Role stats (JSON: {roleId: {games, wins, ...}})
      role_stats TEXT,

      -- Performance metrics
      total_kills INTEGER DEFAULT 0,
      total_deaths INTEGER DEFAULT 0,
      times_survived INTEGER DEFAULT 0,
      average_survival_turns REAL DEFAULT 0,

      -- Activity
      total_actions INTEGER DEFAULT 0,
      total_votes INTEGER DEFAULT 0,
      total_items_used INTEGER DEFAULT 0,

      -- Timestamps
      first_game_at INTEGER,
      last_game_at INTEGER,
      updated_at INTEGER NOT NULL
    )
  `,

  // ===== SAVED GAME STATES (for persistence/recovery) =====
  // Note: No FOREIGN KEY constraint here - states are saved independently for crash recovery
  werewolf_saved_states: `
    CREATE TABLE IF NOT EXISTS werewolf_saved_states (
      room_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,

      -- Complete serialized state
      room_state TEXT NOT NULL, -- Full GameRoom serialization

      -- Phase info
      current_phase TEXT NOT NULL,
      current_turn INTEGER NOT NULL,
      phase_end_time INTEGER,

      -- Quick checks
      is_active BOOLEAN DEFAULT 1,
      player_count INTEGER NOT NULL,

      -- Timestamps
      saved_at INTEGER NOT NULL,
      last_action_at INTEGER NOT NULL
    )
  `,

  // ===== ACHIEVEMENTS =====
  werewolf_achievements: `
    CREATE TABLE IF NOT EXISTS werewolf_achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      rarity TEXT DEFAULT 'common', -- common, rare, epic, legendary

      -- Unlock criteria (JSON)
      criteria TEXT NOT NULL,

      UNIQUE(name)
    )
  `,

  werewolf_player_achievements: `
    CREATE TABLE IF NOT EXISTS werewolf_player_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,

      -- Context
      game_id TEXT,
      unlocked_at INTEGER NOT NULL,

      FOREIGN KEY (achievement_id) REFERENCES werewolf_achievements(id) ON DELETE CASCADE,
      UNIQUE(user_id, achievement_id)
    )
  `,

  // ===== LEADERBOARDS =====
  werewolf_leaderboard_snapshots: `
    CREATE TABLE IF NOT EXISTS werewolf_leaderboard_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL, -- daily, weekly, monthly, all-time
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,

      -- Leaderboard data (JSON array of ranked players)
      data TEXT NOT NULL,

      created_at INTEGER NOT NULL,

      UNIQUE(period, period_start)
    )
  `
};

/**
 * Database indexes for performance
 */
export const WEREWOLF_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_werewolf_games_created_at ON werewolf_games(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_games_phase ON werewolf_games(phase)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_games_is_started ON werewolf_games(is_started)',

  'CREATE INDEX IF NOT EXISTS idx_werewolf_player_games_user_id ON werewolf_player_games(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_player_games_game_id ON werewolf_player_games(game_id)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_player_games_role ON werewolf_player_games(role_id)',

  'CREATE INDEX IF NOT EXISTS idx_werewolf_stats_wins ON werewolf_player_stats(total_wins DESC)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_stats_games ON werewolf_player_stats(total_games DESC)',

  'CREATE INDEX IF NOT EXISTS idx_werewolf_saved_states_active ON werewolf_saved_states(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_saved_states_last_action ON werewolf_saved_states(last_action_at)',

  'CREATE INDEX IF NOT EXISTS idx_werewolf_player_achievements_user ON werewolf_player_achievements(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_werewolf_player_achievements_unlocked ON werewolf_player_achievements(unlocked_at DESC)'
];

/**
 * Initialize database schema
 * @param {Database} db - better-sqlite3 database instance
 */
export function initializeWerewolfSchema(db) {
  try {
    // Migration: Drop and recreate werewolf_saved_states if it has the old FK constraint
    // This is safe because saved states are temporary crash recovery data
    try {
      const tableInfo = db.prepare(`PRAGMA foreign_key_list(werewolf_saved_states)`).all();
      if (tableInfo.length > 0) {
        console.log('[Werewolf] Migrating werewolf_saved_states table (removing FK constraint)...');
        db.exec(`DROP TABLE IF EXISTS werewolf_saved_states`);
      }
    } catch (e) {
      // Table doesn't exist yet, that's fine
    }

    // Create tables
    Object.values(WEREWOLF_SCHEMA).forEach(schema => {
      db.exec(schema);
    });

    // Create indexes
    WEREWOLF_INDEXES.forEach(index => {
      db.exec(index);
    });

    console.log('[Werewolf] Database schema initialized successfully');
    return true;
  } catch (error) {
    console.error('[Werewolf] Failed to initialize database schema:', error);
    throw error;
  }
}

/**
 * Default achievements
 */
export const DEFAULT_ACHIEVEMENTS = [
  {
    id: 'first_win',
    name: 'Premier Sang',
    description: 'Gagnez votre première partie',
    rarity: 'common',
    criteria: JSON.stringify({ type: 'wins', count: 1 })
  },
  {
    id: 'werewolf_master',
    name: 'Alpha Suprême',
    description: 'Gagnez 10 parties en tant que Loup-Garou',
    rarity: 'rare',
    criteria: JSON.stringify({ type: 'role_wins', role: 'werewolf', count: 10 })
  },
  {
    id: 'villager_hero',
    name: 'Héros du Village',
    description: 'Gagnez 10 parties en tant que Villageois',
    rarity: 'rare',
    criteria: JSON.stringify({ type: 'team_wins', team: 'villagers', count: 10 })
  },
  {
    id: 'serial_killer',
    name: 'Tueur en Série',
    description: 'Tuez 50 joueurs au total',
    rarity: 'epic',
    criteria: JSON.stringify({ type: 'kills', count: 50 })
  },
  {
    id: 'survivor',
    name: 'Survivant Ultime',
    description: 'Survivez 20 parties consécutives',
    rarity: 'epic',
    criteria: JSON.stringify({ type: 'consecutive_survivals', count: 20 })
  },
  {
    id: 'seer_vision',
    name: 'Clairvoyant',
    description: 'Identifiez correctement tous les loups en tant que Voyante',
    rarity: 'legendary',
    criteria: JSON.stringify({ type: 'special', condition: 'identify_all_werewolves' })
  },
  {
    id: 'perfect_game',
    name: 'Perfection',
    description: 'Gagnez une partie sans qu\'aucun villageois ne meure',
    rarity: 'legendary',
    criteria: JSON.stringify({ type: 'special', condition: 'perfect_villager_win' })
  }
];

/**
 * Seed default achievements
 * @param {Database} db
 */
export function seedAchievements(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO werewolf_achievements (id, name, description, icon, rarity, criteria)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((achievements) => {
    for (const achievement of achievements) {
      insert.run(
        achievement.id,
        achievement.name,
        achievement.description,
        achievement.icon || null,
        achievement.rarity,
        achievement.criteria
      );
    }
  });

  insertMany(DEFAULT_ACHIEVEMENTS);
  console.log(`[Werewolf] Seeded ${DEFAULT_ACHIEVEMENTS.length} achievements`);
}
