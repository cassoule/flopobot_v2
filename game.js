import { capitalize } from './utils.js';
import pkg from 'pokersolver';
const { Hand } = pkg;

import {
  updateUserCoins,
  getUser,
  insertLog,
  insertGame,
  getUserElo,
  insertElos,
  updateElo,
  getAllSkins
} from './init_database.js'
import {C4_COLS, C4_ROWS, skins} from "./index.js";

const messagesTimestamps = new Map();

const TimesChoices = [
  {
    name: '1 minute',
    value: 60,
  },
  {
    name: '5 minutes',
    value: 300,
  },
  {
    name: '10 minutes',
    value: 600,
  },
  {
    name: '15 minutes',
    value: 900,
  },
  {
    name: '30 minutes',
    value: 1800,
  },
  {
    name: '1 heure',
    value: 3600,
  },
  {
    name: '2 heures',
    value: 3600,
  },
  {
    name: '3 heures',
    value: 10800,
  },
  {
    name: '6 heures',
    value: 21600,
  },
  {
    name: '9 heures',
    value: 32400,
  },
  {
    name: '12 heures',
    value: 43200,
  },
  {
    name: '16 heures',
    value: 57600,
  },
  {
    name: '1 jour',
    value: 86400,
  },
  /*{
    name: '2 journées',
    value: 172800,
  },
  {
    name: '1 semaine',
    value: 604800,
  },
  {
    name: '2 semaines',
    value: 604800 * 2,
  },*/
];

export function getTimesChoices() {
  return TimesChoices
}

export function channelPointsHandler(msg) {
  const author = msg.author
  const authorDB = getUser.get(author.id)

  if (!authorDB) {
    console.log("message from an unknown user")
    return
  }

  if (msg.content.length < 3 || msg.content.startsWith('.')) return

  const now = Date.now();
  const timestamps = messagesTimestamps.get(author.id) || [];

  // Remove all timestamps if first one is older than 15 minutes
  const updatedTimestamps = now - timestamps[0] < 900000 ? timestamps : [];

  updatedTimestamps.push(now);
  messagesTimestamps.set(author.id, updatedTimestamps);

  if (messagesTimestamps.get(author.id).length <= 10) {
    // +10 or +50 coins
    let coins = messagesTimestamps.get(author.id).length === 10
            ? 50
            : 10
    updateUserCoins.run({
      id: author.id,
      coins: authorDB.coins + coins,
    })
    insertLog.run({
      id: author.id + '-' + Date.now(),
      user_id: author.id,
      action: 'AUTOCOINS',
      target_user_id: null,
      coins_amount: coins,
      user_new_amount: authorDB.coins + coins,
    })
  }
}

export async function slowmodesHandler(msg, activeSlowmodes) {
  const author = msg.author
  const authorDB = getUser.get(author.id)
  const authorSlowmode = activeSlowmodes[author.id]

  if (!authorDB) return false
  if (!authorSlowmode) return false

  console.log('Message from a slowmode user')

  const now = Date.now();
  if (now > authorSlowmode.endAt) {
    console.log('Slow mode is over')
    delete activeSlowmodes[author.id]
    return true
  }

  if (authorSlowmode.lastMessage && (authorSlowmode.lastMessage + 60 * 1000) > now) {
    await msg.delete()
    console.log('Message deleted')
  } else {
    authorSlowmode.lastMessage = Date.now()
  }
  return false
}

export async function eloHandler(p1, p2, p1score, p2score, type) {
  const p1DB = getUser.get(p1)
  const p2DB = getUser.get(p2)

  if (!p1DB || !p2DB) return

  let p1elo = await getUserElo.get({ id: p1 })
  let p2elo = await getUserElo.get({ id: p2 })

  if (!p1elo) {
    await insertElos.run({
      id: p1.toString(),
      elo: 100,
    })
    p1elo = await getUserElo.get({ id: p1 })
  }
  if (!p2elo) {
    await insertElos.run({
      id: p2.toString(),
      elo: 100,
    })
    p2elo = await getUserElo.get({ id: p2 })
  }

  if (p1score === p2score) {
    insertGame.run({
      id: p1.toString() + '-' + p2.toString() + '-' + Date.now().toString(),
      p1: p1,
      p2: p2,
      p1_score: p1score,
      p2_score: p2score,
      p1_elo: p1elo.elo,
      p2_elo: p2elo.elo,
      p1_new_elo: p1elo.elo,
      p2_new_elo: p2elo.elo,
      type: type,
      timestamp: Date.now(),
    })
    return
  }

  const prob1 = 1 / (1 + Math.pow(10, (p2elo.elo - p1elo.elo)/400))
  const prob2 = 1 / (1 + Math.pow(10, (p1elo.elo - p2elo.elo)/400))

  const p1newElo = Math.max(Math.floor(p1elo.elo + 10 * (p1score - prob1)), 0)
  const p2newElo = Math.max(Math.floor(p2elo.elo + 10 * (p2score - prob2)), 0)

  console.log(`${p1} elo update : ${p1elo.elo} -> ${p1newElo}`)
  console.log(`${p2} elo update : ${p2elo.elo} -> ${p2newElo}`)
  updateElo.run({ id: p1, elo: p1newElo })
  updateElo.run({ id: p2, elo: p2newElo })

  insertGame.run({
    id: p1.toString() + '-' + p2.toString() + '-' + Date.now().toString(),
    p1: p1,
    p2: p2,
    p1_score: p1score,
    p2_score: p2score,
    p1_elo: p1elo.elo,
    p2_elo: p2elo.elo,
    p1_new_elo: p1newElo,
    p2_new_elo: p2newElo,
    type: type,
    timestamp: Date.now(),
  })
}

export async function pokerEloHandler(room) {
  if (room.fakeMoney) return

  let DBplayers = []
  Object.keys(room.players).forEach(playerId => {
    const DBuser = getUser.get(playerId)
    if (DBuser) {
      DBplayers.push(DBuser)
    }
  })

  const winnerIds = new Set(room.winners)
  const playerCount = Object.keys(room.players).length
  const baseK = 10

  const avgOpponentElo = (player) => {
    const opponents = DBplayers.filter(p => p.id !== player.id);
    return opponents.reduce((sum, p) => sum + p.elo, 0) / opponents.length;
  };

  DBplayers.forEach(player => {
    const avgElo = avgOpponentElo(player);
    const expectedScore = 1 / (1 + 10 ** ((avgElo - player.elo) / 400))

    let actualScore;
    if (winnerIds.has(player.id)) {
      actualScore = (winnerIds.size === playerCount) ? 0.5 : 1;
    } else {
      actualScore = 0;
    }

    const K = winnerIds.has(player.id) ? (baseK * playerCount) : baseK
    const delta = K * (actualScore - expectedScore)

    const newElo = Math.max(Math.floor(player.elo + delta), 0)



    if (!isNaN(newElo)) {
      console.log(`${player.id} elo update: ${player.elo} -> ${newElo} (K: ${K.toFixed(2)}, Δ: ${delta.toFixed(2)})`);
      updateElo.run({ id: player.id, elo: newElo })

      insertGame.run({
        id: player.id + '-' + Date.now().toString(),
        p1: player.id,
        p2: null,
        p1_score: actualScore,
        p2_score: null,
        p1_elo: player.elo,
        p2_elo: avgElo,
        p1_new_elo: newElo,
        p2_new_elo: null,
        type: 'POKER_ROUND',
        timestamp: Date.now(),
      })
    } else {
      console.log(`# ELO UPDATE ERROR -> ${player.id} elo update: ${player.elo} -> ${newElo} (K: ${K.toFixed(2)}, Δ: ${delta.toFixed(2)})`);
    }
  })
}

export function randomSkinPrice(id=0) {
  const dbSkins = getAllSkins.all();
  const randomIndex = Math.floor(Math.random() * dbSkins.length);
  let randomSkin = skins.find((skin) => skin.uuid === dbSkins[randomIndex].uuid);

  // Generate random level and chroma
  const randomLevel = Math.floor(Math.random() * randomSkin.levels.length + 1);
  let randomChroma = randomLevel === randomSkin.levels.length
      ? Math.floor(Math.random() * randomSkin.chromas.length + 1)
      : 1;
  if (randomChroma === randomSkin.chromas.length && randomSkin.chromas.length >= 2) randomChroma--
  const selectedLevel = randomSkin.levels[randomLevel - 1]
  const selectedChroma = randomSkin.chromas[randomChroma - 1]


  // Helper functions (unchanged from your original code)
  const price = () => {
    let result = dbSkins[randomIndex].basePrice;

    result *= (1 + (randomLevel / Math.max(randomSkin.levels.length, 2)))
    result *= (1 + (randomChroma / 4))

    return result.toFixed(2);
  }

  const returnPrice = price()
  console.log(`#${id} :`, returnPrice)
  return returnPrice
}

export function createConnect4Board() {
  return Array(C4_ROWS).fill(null).map(() => Array(C4_COLS).fill(null));
}

export function checkConnect4Win(board, player) {
  // Check horizontal
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c <= C4_COLS - 4; c++) {
      if (board[r][c] === player && board[r][c+1] === player && board[r][c+2] === player && board[r][c+3] === player) {
        return { win: true, pieces: [{row:r, col:c}, {row:r, col:c+1}, {row:r, col:c+2}, {row:r, col:c+3}] };
      }
    }
  }

  // Check vertical
  for (let r = 0; r <= C4_ROWS - 4; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      if (board[r][c] === player && board[r+1][c] === player && board[r+2][c] === player && board[r+3][c] === player) {
        return { win: true, pieces: [{row:r, col:c}, {row:r+1, col:c}, {row:r+2, col:c}, {row:r+3, col:c}] };
      }
    }
  }

  // Check diagonal (down-right)
  for (let r = 0; r <= C4_ROWS - 4; r++) {
    for (let c = 0; c <= C4_COLS - 4; c++) {
      if (board[r][c] === player && board[r+1][c+1] === player && board[r+2][c+2] === player && board[r+3][c+3] === player) {
        return { win: true, pieces: [{row:r, col:c}, {row:r+1, col:c+1}, {row:r+2, col:c+2}, {row:r+3, col:c+3}] };
      }
    }
  }

  // Check diagonal (up-right)
  for (let r = 3; r < C4_ROWS; r++) {
    for (let c = 0; c <= C4_COLS - 4; c++) {
      if (board[r][c] === player && board[r-1][c+1] === player && board[r-2][c+2] === player && board[r-3][c+3] === player) {
        return { win: true, pieces: [{row:r, col:c}, {row:r-1, col:c+1}, {row:r-2, col:c+2}, {row:r-3, col:c+3}] };
      }
    }
  }

  return { win: false, pieces: [] };
}

export function checkConnect4Draw(board) {
  return board[0].every(cell => cell !== null);
}

export function formatConnect4BoardForDiscord(board) {
  const symbols = {
    'R': '🔴',
    'Y': '🟡',
    null: '⚪'
  };
  return board.map(row => row.map(cell => symbols[cell]).join('')).join('\n');
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * @param {Array} array - The array to shuffle.
 * @returns {Array} The shuffled array.
 */
export function shuffle(array) {
  let currentIndex = array.length,
      randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

/**
 * Deals a shuffled deck into the initial Solitaire game state.
 * @param {Array} deck - A shuffled deck of cards.
 * @returns {Object} The initial gameState object.
 */
export function deal(deck) {
  const gameState = {
    tableauPiles: [[], [], [], [], [], [], []],
    foundationPiles: [[], [], [], []],
    stockPile: [],
    wastePile: [],
  };

  // Deal cards to the tableau piles
  for (let i = 0; i < 7; i++) {
    for (let j = i; j < 7; j++) {
      gameState.tableauPiles[j].push(deck.shift());
    }
  }

  // Flip the top card of each tableau pile
  gameState.tableauPiles.forEach(pile => {
    if (pile.length > 0) {
      pile[pile.length - 1].faceUp = true;
    }
  });

  // The rest of the deck becomes the stock
  gameState.stockPile = deck;

  return gameState;
}

/**
 * Checks if a proposed move is valid according to the rules of Klondike Solitaire.
 * @param {Object} gameState - The current state of the game.
 * @param {Object} moveData - The details of the move.
 * @returns {boolean}
 */
export function isValidMove(gameState, moveData) {
  // Use more descriptive names to avoid confusion
  const { sourcePileType, sourcePileIndex, sourceCardIndex, destPileType, destPileIndex } = moveData;

  let sourcePile;
  // Get the actual source pile array based on its type and index
  if (sourcePileType === 'tableauPiles') {
    sourcePile = gameState.tableauPiles[sourcePileIndex];
  } else if (sourcePileType === 'wastePile') {
    sourcePile = gameState.wastePile;
  } else {
    return false; // Cannot drag from foundation or stock
  }

  // Get the actual card being dragged (the top of the stack)
  const sourceCard = sourcePile[sourceCardIndex];

  // A card must exist and be face-up to be moved
  if (!sourceCard || !sourceCard.faceUp) {
    return false;
  }

  // --- Validate move TO a Tableau Pile ---
  if (destPileType === 'tableauPiles') {
    const destinationPile = gameState.tableauPiles[destPileIndex];
    const topCard = destinationPile.length > 0 ? destinationPile[destinationPile.length - 1] : null;

    if (!topCard) {
      // If the destination tableau pile is empty, only a King can be moved there.
      return sourceCard.rank === 'K';
    }

    // If the destination pile is not empty, check game rules
    const sourceColor = getCardColor(sourceCard.suit);
    const destColor = getCardColor(topCard.suit);
    const sourceValue = getRankValue(sourceCard.rank);
    const destValue = getRankValue(topCard.rank);

    // Card being moved must be opposite color and one rank lower than the destination top card.
    return sourceColor !== destColor && destValue - sourceValue === 1;
  }

  // --- Validate move TO a Foundation Pile ---
  if (destPileType === 'foundationPiles') {
    // You can only move one card at a time to a foundation pile.
    const stackBeingMoved = sourcePile.slice(sourceCardIndex);
    if (stackBeingMoved.length > 1) {
      return false;
    }

    const destinationPile = gameState.foundationPiles[destPileIndex];
    const topCard = destinationPile.length > 0 ? destinationPile[destinationPile.length - 1] : null;

    if (!topCard) {
      // If the foundation is empty, only an Ace can be moved there.
      return sourceCard.rank === 'A';
    }

    // If not empty, card must be same suit and one rank higher.
    const sourceValue = getRankValue(sourceCard.rank);
    const destValue = getRankValue(topCard.rank);

    return sourceCard.suit === topCard.suit && sourceValue - destValue === 1;
  }

  return false;
}

/**
 * An array of suits and ranks to create a deck.
 */
const SUITS = ['h', 'd', 's', 'c']; // Hearts, Diamonds, Spades, Clubs
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

/**
 * Gets the numerical value of a card's rank.
 * @param {string} rank - e.g., 'A', 'K', '7'
 * @returns {number}
 */
function getRankValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'T') return 10;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return parseInt(rank, 10);
}

/**
 * Gets the color of a card's suit.
 * @param {string} suit - e.g., 'h', 's'
 * @returns {string} 'red' or 'black'
 */
function getCardColor(suit) {
  return suit === 'h' || suit === 'd' ? 'red' : 'black';
}

/**
 * Creates a standard 52-card deck.
 * @returns {Array<Object>}
 */
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, faceUp: false });
    }
  }
  return deck;
}

/**
 * Mutates the game state by performing a valid move, correctly handling stacks.
 * @param {Object} gameState - The current state of the game.
 * @param {Object} moveData - The details of the move.
 */
export function moveCard(gameState, moveData) {
  const { sourcePileType, sourcePileIndex, sourceCardIndex, destPileType, destPileIndex } = moveData;

  // Identify the source pile array
  const sourcePile = sourcePileType === 'tableauPiles'
      ? gameState.tableauPiles[sourcePileIndex]
      : gameState.wastePile;

  // Identify the destination pile array
  const destPile = destPileType === 'tableauPiles'
      ? gameState.tableauPiles[destPileIndex]
      : gameState.foundationPiles[destPileIndex];

  // Using splice(), cut the entire stack of cards to be moved from the source pile.
  const cardsToMove = sourcePile.splice(sourceCardIndex);

  // Add the stack of cards to the destination pile.
  // Using the spread operator (...) to add all items from the cardsToMove array.
  destPile.push(...cardsToMove);

  // After moving, if the source was a tableau pile and it's not empty,
  // flip the new top card to be face-up.
  if (sourcePileType === 'tableauPiles' && sourcePile.length > 0) {
    sourcePile[sourcePile.length - 1].faceUp = true;
  }
}

/**
 * Moves a card from the stock to the waste pile. If stock is empty, resets it from the waste.
 * @param {Object} gameState - The current state of the game.
 */
export function drawCard(gameState) {
  if (gameState.stockPile.length > 0) {
    const card = gameState.stockPile.pop();
    card.faceUp = true;
    gameState.wastePile.push(card);
  } else if (gameState.wastePile.length > 0) {
    // When stock is empty, move waste pile back to stock, face down
    gameState.stockPile = gameState.wastePile.reverse();
    gameState.stockPile.forEach(card => (card.faceUp = false));
    gameState.wastePile = [];
  }
}

/**
 * Checks if the game has been won (all cards are in the foundation piles).
 * @param {Object} gameState - The current state of the game.
 * @returns {boolean}
 */
export function checkWinCondition(gameState) {
  const foundationCardCount = gameState.foundationPiles.reduce(
      (acc, pile) => acc + pile.length,
      0
  );
  return foundationCardCount === 52;
}