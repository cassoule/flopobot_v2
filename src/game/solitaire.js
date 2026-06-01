// --- Constants for Deck Creation ---

const SUITS = ["h", "d", "s", "c"]; // Hearts, Diamonds, Spades, Clubs
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];

// --- Helper Functions for Card Logic ---

/**
 * Gets the numerical value of a card's rank for comparison.
 * @param {string} rank - e.g., 'A', 'K', '7'
 * @returns {number} The numeric value (Ace=1, King=13).
 */
export function getRankValue(rank) {
	if (rank === "A") return 1;
	if (rank === "T") return 10;
	if (rank === "J") return 11;
	if (rank === "Q") return 12;
	if (rank === "K") return 13;
	return parseInt(rank, 10);
}

/**
 * Gets the color ('red' or 'black') of a card's suit.
 * @param {string} suit - e.g., 'h', 's'
 * @returns {string} 'red' or 'black'.
 */
export function getCardColor(suit) {
	return suit === "h" || suit === "d" ? "red" : "black";
}

// --- Core Game Logic Functions ---

/**
 * Creates a standard 52-card deck. Each card is an object.
 * @returns {Array<Object>} The unshuffled deck of cards.
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
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * @param {Array} array - The array to shuffle.
 * @returns {Array} The shuffled array (mutated in place).
 */
export function shuffle(array) {
	let currentIndex = array.length;
	// While there remain elements to shuffle.
	while (currentIndex !== 0) {
		// Pick a remaining element.
		const randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex--;
		// And swap it with the current element.
		[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
	}
	return array;
}

/**
 * Creates a seedable pseudorandom number generator (PRNG) using Mulberry32.
 * @param {number} seed - An initial number to seed the generator.
 * @returns {function} A function that returns a pseudorandom number between 0 and 1.
 */
export function createSeededRNG(seed) {
	return function () {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Shuffles an array using a seedable PRNG via the Fisher-Yates algorithm.
 * @param {Array} array - The array to shuffle.
 * @param {function} rng - A seedable random number generator function.
 * @returns {Array} The shuffled array (mutated in place).
 */
export function seededShuffle(array, rng) {
	let currentIndex = array.length;
	// While there remain elements to shuffle.
	while (currentIndex !== 0) {
		// Pick a remaining element using the seeded RNG.
		const randomIndex = Math.floor(rng() * currentIndex);
		currentIndex--;
		// And swap it with the current element.
		[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
	}
	return array;
}

/**
 * Deals a shuffled deck into the initial Solitaire game state.
 * @param {Array<Object>} deck - A shuffled deck of cards.
 * @returns {Object} The initial gameState object for Klondike Solitaire.
 */
export function deal(deck) {
	const gameState = {
		tableauPiles: [[], [], [], [], [], [], []],
		foundationPiles: [[], [], [], []],
		stockPile: [],
		wastePile: [],
	};

	// Deal cards to the 7 tableau piles
	for (let i = 0; i < 7; i++) {
		for (let j = i; j < 7; j++) {
			gameState.tableauPiles[j].push(deck.shift());
		}
	}

	// Flip the top card of each tableau pile
	gameState.tableauPiles.forEach((pile) => {
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
 * @param {Object} moveData - The details of the move to be validated.
 * @returns {boolean} True if the move is valid, false otherwise.
 */
export function isValidMove(gameState, moveData) {
	const { sourcePileType, sourcePileIndex, sourceCardIndex, destPileType, destPileIndex } = moveData;

	// --- Get Source Pile and Card ---
	let sourcePile;
	if (sourcePileType === "tableauPiles") sourcePile = gameState.tableauPiles[sourcePileIndex];
	else if (sourcePileType === "wastePile") sourcePile = gameState.wastePile;
	else if (sourcePileType === "foundationPiles") sourcePile = gameState.foundationPiles[sourcePileIndex];
	else return false; // Invalid source type

	const sourceCard = sourcePile?.[sourceCardIndex];
	if (!sourceCard || !sourceCard.faceUp) {
		return false; // Cannot move a card that doesn't exist or is face-down
	}

	// --- Validate Move TO a Tableau Pile ---
	if (destPileType === "tableauPiles") {
		const destinationPile = gameState.tableauPiles[destPileIndex];
		const topCard = destinationPile[destinationPile.length - 1];

		if (!topCard) {
			// If the destination tableau is empty, only a King can be moved there.
			return sourceCard.rank === "K";
		}

		// Card must be opposite color and one rank lower than the destination top card.
		const sourceColor = getCardColor(sourceCard.suit);
		const destColor = getCardColor(topCard.suit);
		const sourceValue = getRankValue(sourceCard.rank);
		const destValue = getRankValue(topCard.rank);
		return sourceColor !== destColor && destValue - sourceValue === 1;
	}

	// --- Validate Move TO a Foundation Pile ---
	if (destPileType === "foundationPiles") {
		// You can only move one card at a time to a foundation pile.
		const stackBeingMoved = sourcePile.slice(sourceCardIndex);
		if (stackBeingMoved.length > 1) return false;

		const destinationPile = gameState.foundationPiles[destPileIndex];
		const topCard = destinationPile[destinationPile.length - 1];

		if (!topCard) {
			// If the foundation is empty, only an Ace of any suit can be moved there.
			return sourceCard.rank === "A";
		}

		// Card must be the same suit and one rank higher.
		const sourceValue = getRankValue(sourceCard.rank);
		const destValue = getRankValue(topCard.rank);
		return sourceCard.suit === topCard.suit && sourceValue - destValue === 1;
	}

	return false; // Invalid destination type
}

/**
 * Mutates the game state by performing a valid card move.
 * @param {Object} gameState - The current state of the game.
 * @param {Object} moveData - The details of the move.
 */
export function moveCard(gameState, moveData) {
	const { sourcePileType, sourcePileIndex, sourceCardIndex, destPileType, destPileIndex } = moveData;

	let sourcePile;
	if (sourcePileType === "tableauPiles") sourcePile = gameState.tableauPiles[sourcePileIndex];
	else if (sourcePileType === "wastePile") sourcePile = gameState.wastePile;
	else if (sourcePileType === "foundationPiles") sourcePile = gameState.foundationPiles[sourcePileIndex];

	let destPile;
	if (destPileType === "tableauPiles") destPile = gameState.tableauPiles[destPileIndex];
	else if (destPileType === "foundationPiles") destPile = gameState.foundationPiles[destPileIndex];

	// Cut the entire stack of cards to be moved from the source pile.
	const cardsToMove = sourcePile.splice(sourceCardIndex);
	// Add the stack to the destination pile.
	destPile.push(...cardsToMove);

	const histMove = {
		move: "move",
		sourcePileType: sourcePileType,
		sourcePileIndex: sourcePileIndex,
		sourceCardIndex: sourceCardIndex,
		destPileType: destPileType,
		destPileIndex: destPileIndex,
		cardsMoved: cardsToMove,
		cardWasFlipped: false,
		points: destPileType === "foundationPiles" ? 11 : 1, // Points for moving to foundation
	};

	// If the source was a tableau pile and there are cards left, flip the new top card.
	if (sourcePileType === "tableauPiles" && sourcePile.length > 0) {
		sourcePile[sourcePile.length - 1].faceUp = true;
		histMove.cardWasFlipped = true;
	}

	gameState.hist.push(histMove);
}

/**
 * Moves a card from the stock to the waste. If stock is empty, resets it from the waste.
 * @param {Object} gameState - The current state of the game.
 */
export function drawCard(gameState) {
	if (gameState.stockPile.length > 0) {
		const card = gameState.stockPile.pop();
		card.faceUp = true;
		gameState.wastePile.push(card);
		gameState.hist.push({
			move: "draw",
			card: card,
		});
	} else if (gameState.wastePile.length > 0) {
		// When stock is empty, move the entire waste pile back to stock, face down.
		gameState.stockPile = gameState.wastePile.reverse();
		gameState.stockPile.forEach((card) => (card.faceUp = false));
		gameState.wastePile = [];
		gameState.hist.push({
			move: "draw-reset",
		});
	}
}

export function draw3Cards(gameState) {
	if (gameState.stockPile.length > 0) {
		let cards = [];
		for (let i = 0; i < 3; i++) {
			if (gameState.stockPile.length > 0) {
				const card = gameState.stockPile.pop();
				card.faceUp = true;
				gameState.wastePile.push(card);
				cards.push(card);
			} else {
				break; // Stop if stock runs out
			}
		}
		gameState.hist.push({
			move: "draw-3",
			cards: cards,
		});
	} else if (gameState.wastePile.length > 0) {
		// When stock is empty, move the entire waste pile back to stock, face down.
		gameState.stockPile = gameState.wastePile.reverse();
		gameState.stockPile.forEach((card) => (card.faceUp = false));
		gameState.wastePile = [];
		gameState.hist.push({
			move: "draw-reset",
		});
	}
}

/**
 * Checks if the game has been won (all 52 cards are in the foundation piles).
 * @param {Object} gameState - The current state of the game.
 * @returns {boolean} True if the game is won.
 */
export function checkWinCondition(gameState) {
	const foundationCardCount = gameState.foundationPiles.reduce((acc, pile) => acc + pile.length, 0);
	return foundationCardCount === 52;
}

/**
 * Returns a lightweight, client-facing view of the game state.
 *
 * Omits server-only fields — most importantly `hist`, the undo history which
 * grows unbounded over a game and is never read by the client. The full
 * gameState (with `hist`) is kept in memory server-side for undo; this only
 * trims what we serialize onto the wire.
 *
 * @param {Object} gameState - The full server-side game state.
 * @returns {Object} The client-facing subset of the state.
 */
export function serializeGameState(gameState) {
	if (!gameState) return gameState;
	return {
		tableauPiles: gameState.tableauPiles,
		foundationPiles: gameState.foundationPiles,
		stockPile: gameState.stockPile,
		wastePile: gameState.wastePile,
		isDone: gameState.isDone,
		isSOTD: gameState.isSOTD,
		seed: gameState.seed,
		hardMode: gameState.hardMode,
		score: gameState.score,
		moves: gameState.moves,
		startTime: gameState.startTime,
	};
}

/** Whether a single card may be placed on top of a foundation pile. */
function canStackOnFoundation(card, foundationPile) {
	const topCard = foundationPile[foundationPile.length - 1];
	if (!topCard) return card.rank === "A";
	return card.suit === topCard.suit && getRankValue(card.rank) - getRankValue(topCard.rank) === 1;
}

/**
 * Whether the game has reached the "auto-completable" state: every tableau card
 * is face-up and both the stock and waste are empty. From this state Klondike is
 * mathematically guaranteed winnable, so the remaining cards can be dealt
 * straight to the foundations.
 * @param {Object} gameState - The current state of the game.
 * @returns {boolean}
 */
export function isAutoSolvable(gameState) {
	if (!gameState || gameState.isDone) return false;
	if (gameState.stockPile.length > 0 || gameState.wastePile.length > 0) return false;

	const allFaceUp = gameState.tableauPiles.every((pile) => pile.every((card) => card.faceUp));
	if (!allFaceUp) return false;

	const foundationCount = gameState.foundationPiles.reduce((acc, pile) => acc + pile.length, 0);
	return foundationCount < 52;
}

/**
 * Greedily moves every remaining tableau card to the foundations. Only valid
 * from an auto-solvable state (see isAutoSolvable). Mutates gameState in place,
 * scoring each placement like a normal foundation move (+10).
 * @param {Object} gameState - The current state of the game.
 */
export function autoComplete(gameState) {
	let movedAny = true;
	while (movedAny) {
		movedAny = false;
		for (const pile of gameState.tableauPiles) {
			if (pile.length === 0) continue;
			const card = pile[pile.length - 1];
			for (const foundationPile of gameState.foundationPiles) {
				if (canStackOnFoundation(card, foundationPile)) {
					pile.pop();
					foundationPile.push(card);
					gameState.moves++;
					gameState.score += 10;
					movedAny = true;
					break;
				}
			}
		}
	}
}

/**
 * Reverts the game state to its previous state based on the last move in the history.
 * This function mutates the gameState object directly.
 * @param {Object} gameState - The current game state, which includes a `hist` array.
 */
export function undoMove(gameState) {
	if (!gameState.hist || gameState.hist.length === 0) {
		return; // Nothing to undo
	}

	const lastMove = gameState.hist.pop(); // Get and remove the last move from history
	gameState.moves++; // Undoing a move counts as a new move
	gameState.score -= lastMove.points || 1; // Revert score based on points from the last move

	switch (lastMove.move) {
		case "move":
			undoCardMove(gameState, lastMove);
			break;
		case "draw":
			undoDraw(gameState, lastMove);
			break;
		case "draw-3":
			undoDraw3(gameState, lastMove);
			break;
		case "draw-reset":
			undoDrawReset(gameState, lastMove);
			break;
		default:
			// If an unknown move type is found, push it back to avoid corrupting the history
			gameState.hist.push(lastMove);
			gameState.moves--; // Revert the move count increment
			gameState.score += lastMove.points || 1; // Revert the score decrement
			console.error("Unknown move type in history:", lastMove);
			break;
	}
}

// --- Helper functions for undoing specific moves ---

function undoCardMove(gameState, moveData) {
	const { sourcePileType, sourcePileIndex, sourceCardIndex, destPileType, destPileIndex, cardsMoved, cardWasFlipped } =
		moveData;

	// 1. Find the destination pile (where the cards are NOW)
	let currentPile;
	if (destPileType === "tableauPiles") currentPile = gameState.tableauPiles[destPileIndex];
	else if (destPileType === "foundationPiles") currentPile = gameState.foundationPiles[destPileIndex];

	// 2. Remove the moved cards from their current pile
	// Using splice with a negative index removes from the end of the array
	currentPile.splice(-cardsMoved.length);

	// 3. Find the original source pile
	let originalPile;
	if (sourcePileType === "tableauPiles") originalPile = gameState.tableauPiles[sourcePileIndex];
	else if (sourcePileType === "wastePile") originalPile = gameState.wastePile;
	else if (sourcePileType === "foundationPiles") originalPile = gameState.foundationPiles[sourcePileIndex];

	// 4. Put the cards back where they came from
	// Using splice to insert the cards back at their original index
	originalPile.splice(sourceCardIndex, 0, ...cardsMoved);

	// 5. If a card was flipped during the move, flip it back to face-down
	if (cardWasFlipped) {
		const cardToUnflip = originalPile[sourceCardIndex - 1];
		if (cardToUnflip) {
			cardToUnflip.faceUp = false;
		}
	}
}

function undoDraw(gameState, moveData) {
	// A 'draw' move means a card went from stock to waste.
	// To undo, move it from waste back to stock and flip it face-down.
	const cardToReturn = gameState.wastePile.pop();
	if (cardToReturn) {
		cardToReturn.faceUp = false;
		gameState.stockPile.push(cardToReturn);
	}
}

function undoDraw3(gameState, moveData) {
	// A 'draw-3' move means up to 3 cards went from stock to
	// waste. To undo, move them back to stock and flip them face-down.
	const cardsToReturn = moveData.cards || [];
	for (let i = 0; i < cardsToReturn.length; i++) {
		const card = gameState.wastePile.pop();
		if (card) {
			card.faceUp = false;
			gameState.stockPile.push(card);
		}
	}
}

function undoDrawReset(gameState, moveData) {
	// A 'draw-reset' means the waste pile was moved to the stock pile.
	// To undo, move the stock pile back to the waste pile and flip cards face-up.
	gameState.wastePile = gameState.stockPile.reverse();
	gameState.wastePile.forEach((card) => (card.faceUp = true));
	gameState.stockPile = [];
}
