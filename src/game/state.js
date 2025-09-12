/**
 * This file acts as a simple in-memory store for the application's live state.
 * By centralizing state here, we avoid global variables and make data flow more predictable.
 */

// --- Game and Interaction State ---

// Stores active Connect 4 games, keyed by a unique game ID.
export let activeConnect4Games = {};

// Stores active Tic-Tac-Toe games, keyed by a unique game ID.
export let activeTicTacToeGames = {};

// Stores active Solitaire games, keyed by user ID.
export let activeSolitaireGames = {};

// Stores active Poker rooms, keyed by a unique room ID (uuidv4).
export let pokerRooms = {};

// Stores active erinyes rooms, keyed by a unique room ID (uuidv4).
export let erinyesRooms = {};

// --- User and Session State ---

// Stores active user inventories for paginated embeds, keyed by the interaction ID.
// Format: { [interactionId]: { userId, page, amount, endpoint, timestamp, inventorySkins } }
export let activeInventories = {};

// Stores active user skin searches for paginated embeds, keyed by the interaction ID.
// Format: { [interactionId]: { userId, page, amount, endpoint, timestamp, resultSkins, searchValue } }
export let activeSearchs = {};

// --- Feature-Specific State ---

// Stores active timeout polls, keyed by the interaction ID.
// Format: { [interactionId]: { toUserId, time, for, against, voters, endTime, ... } }
export let activePolls = {};

// Stores active predictions, keyed by a unique prediction ID.
// Format: { [prediId]: { creatorId, label, options, endTime, closed, ... } }
export let activePredis = {};

// Stores users who are currently under a slowmode effect, keyed by user ID.
// Format: { [userId]: { endAt, lastMessage } }
export let activeSlowmodes = {};


// --- Queues for Matchmaking ---

// Stores user IDs waiting to play Tic-Tac-Toe.
export let tictactoeQueue = [];

// Stores user IDs waiting to play Connect 4.
export let connect4Queue = [];

export let queueMessagesEndpoints = [];


// --- Rate Limiting and Caching ---

// Tracks message timestamps for the channel points system, keyed by user ID.
// Used to limit points earned over a 15-minute window.
// Format: Map<userId, [timestamp1, timestamp2, ...]>
export let messagesTimestamps = new Map();

// Tracks recent AI mention requests for rate limiting, keyed by user ID.
// Used to prevent spamming the AI.
// Format: Map<userId, [timestamp1, timestamp2, ...]>
export let requestTimestamps = new Map();

// In-memory cache for Valorant skin data fetched from the API.
// This prevents re-fetching the same data on every command use.
export let skins = [];