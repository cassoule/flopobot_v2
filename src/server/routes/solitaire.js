import express from "express";

// --- Game Logic Imports ---
import {
	createDeck,
	deal,
	isValidMove,
	moveCard,
	drawCard,
	checkWinCondition,
	createSeededRNG,
	seededShuffle,
	undoMove,
	draw3Cards,
	getRankValue,
	getCardColor,
	serializeGameState,
	isAutoSolvable,
	autoComplete,
} from "../../game/solitaire.js";

// --- Game State & Database Imports ---
import { activeSolitaireGames, sotdResetVotes } from "../../game/state.js";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import * as solitaireService from "../../services/solitaire.service.js";
import { socketEmit } from "../socket.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { initTodaysSOTD } from "../../game/points.js";
import { resolveUser } from "../../utils/index.js";
import { randomUUID } from "crypto";

const SOTD_RESET_VOTES_THRESHOLD = parseInt(process.env.SOTD_RESET_VOTES_THRESHOLD) || 3;

const router = express.Router();

// Stores guest wins waiting to be claimed after login
const pendingSubmissions = {};
// Stores active guest games, keyed by gameId
const guestGames = {};

/** Gets the active game by userId (logged in) or gameId (guest). */
function getActiveGame(userId, gameId) {
	if (userId && activeSolitaireGames[userId]) {
		return activeSolitaireGames[userId];
	}
	if (!userId && gameId && guestGames[gameId]) {
		return guestGames[gameId];
	}
	return null;
}

/** Deletes an active game. */
function deleteActiveGame(userId, gameId) {
	if (userId && activeSolitaireGames[userId]) {
		delete activeSolitaireGames[userId];
	}
	if (!userId && gameId && guestGames[gameId]) {
		delete guestGames[gameId];
	}
}

/**
 * Factory function to create and configure the solitaire API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function solitaireRoutes(client, io) {
	// --- Game Initialization Endpoints ---

	router.post("/start", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { userSeed, hardMode } = req.body;

		// Return existing game if user already has one
		if (userId && activeSolitaireGames[userId] && !activeSolitaireGames[userId].isSOTD) {
			return res.json({
				success: true,
				gameState: serializeGameState(activeSolitaireGames[userId]),
			});
		}

		let deck, seed;
		if (userSeed) {
			seed = userSeed;
		} else {
			seed = Date.now().toString(36) + Math.random().toString(36).substr(2);
		}

		let numericSeed = 0;
		for (let i = 0; i < seed.length; i++) {
			numericSeed = (numericSeed + seed.charCodeAt(i)) & 0xffffffff;
		}

		const rng = createSeededRNG(numericSeed);
		deck = seededShuffle(createDeck(), rng);

		const gameState = deal(deck);
		gameState.seed = seed;
		gameState.isSOTD = false;
		gameState.score = 0;
		gameState.moves = 0;
		gameState.hist = [];
		gameState.hardMode = hardMode ?? false;
		gameState.startTime = Date.now();
		gameState.endTime = null;

		if (userId) {
			activeSolitaireGames[userId] = gameState;
			res.json({ success: true, gameState: serializeGameState(gameState) });
		} else {
			// Guest: store game with a generated gameId
			const gameId = randomUUID();
			guestGames[gameId] = gameState;
			res.json({ success: true, gameState: serializeGameState(gameState), gameId });
		}
	});

	router.post("/start/sotd", optionalAuth, async (req, res) => {
		const userId = req.userId;

		if (userId && activeSolitaireGames[userId]?.isSOTD) {
			return res.json({
				success: true,
				gameState: serializeGameState(activeSolitaireGames[userId]),
			});
		}

		const sotd = await solitaireService.getSOTD();
		if (!sotd) {
			return res.status(500).json({ error: "Solitaire of the Day is not configured." });
		}

		const gameState = {
			tableauPiles: JSON.parse(sotd.tableauPiles),
			foundationPiles: JSON.parse(sotd.foundationPiles),
			stockPile: JSON.parse(sotd.stockPile),
			wastePile: JSON.parse(sotd.wastePile),
			isDone: false,
			isSOTD: true,
			startTime: Date.now(),
			endTime: null,
			moves: 0,
			score: 0,
			seed: sotd.seed,
			hist: [],
			hardMode: false,
		};

		if (userId) {
			activeSolitaireGames[userId] = gameState;
			res.json({ success: true, gameState: serializeGameState(gameState) });
		} else {
			// Guest SOTD: store game with a generated gameId
			const gameId = randomUUID();
			guestGames[gameId] = gameState;
			res.json({ success: true, gameState: serializeGameState(gameState), gameId });
		}
	});

	// --- Game State & Action Endpoints ---

	router.get("/sotd/reset-votes", optionalAuth, async (req, res) => {
		try {
			const rankings = await solitaireService.getAllSOTDStats();
			res.json({
				count: sotdResetVotes.size,
				threshold: SOTD_RESET_VOTES_THRESHOLD,
				hasVoted: req.userId ? sotdResetVotes.has(req.userId) : false,
				locked: rankings.length > 0,
			});
		} catch (e) {
			res.status(500).json({ error: "Failed to fetch SOTD reset votes." });
		}
	});

	router.post("/sotd/reset-vote", requireAuth, async (req, res) => {
		const userId = req.userId;

		const rankings = await solitaireService.getAllSOTDStats();
		if (rankings.length > 0) {
			return res.status(400).json({ error: "Reset voting is locked: a player already completed today's SOTD." });
		}

		sotdResetVotes.add(userId);

		if (sotdResetVotes.size >= SOTD_RESET_VOTES_THRESHOLD) {
			await initTodaysSOTD();
			await socketEmit("sotd-reset", {});
			await socketEmit("sotd-reset-vote-update", {
				count: 0,
				threshold: SOTD_RESET_VOTES_THRESHOLD,
				locked: false,
			});
			return res.json({ success: true, reset: true, count: 0, threshold: SOTD_RESET_VOTES_THRESHOLD });
		}

		await socketEmit("sotd-reset-vote-update", {
			count: sotdResetVotes.size,
			threshold: SOTD_RESET_VOTES_THRESHOLD,
			locked: false,
		});
		res.json({
			success: true,
			reset: false,
			count: sotdResetVotes.size,
			threshold: SOTD_RESET_VOTES_THRESHOLD,
		});
	});

	router.get("/sotd/rankings", async (req, res) => {
		try {
			const rankings = await solitaireService.getAllSOTDStats();
			res.json({ rankings });
		} catch (e) {
			res.status(500).json({ error: "Failed to fetch SOTD rankings." });
		}
	});

	router.get("/state/:userId", (req, res) => {
		const { userId } = req.params;
		const gameState = activeSolitaireGames[userId];
		if (gameState) {
			res.json({ success: true, gameState: serializeGameState(gameState) });
		} else {
			res.status(404).json({ error: "No active game found for this user." });
		}
	});

	router.post("/reset", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { gameId } = req.body;
		deleteActiveGame(userId, gameId);
		res.json({ success: true, message: "Game reset." });
	});

	router.post("/move", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { gameId, ...moveData } = req.body;
		const gameState = getActiveGame(userId, gameId);

		if (!gameState) return res.status(404).json({ error: "Game not found." });
		if (gameState.isDone) return res.status(400).json({ error: "This game is already completed." });

		if (isValidMove(gameState, moveData)) {
			moveCard(gameState, moveData);
			updateGameStats(gameState, "move", moveData);

			const win = checkWinCondition(gameState);
			if (win) {
				gameState.isDone = true;
				if (userId) {
					const result = await handleWin(userId, gameState, io, client);
					res.json({
						success: true,
						gameState: serializeGameState(gameState),
						win,
						isNewUser: result?.isNewUser || false,
					});
				} else {
					// Guest player: store the win for later claim
					const submissionToken = randomUUID();
					pendingSubmissions[submissionToken] = {
						gameState,
						timeTaken: Date.now() - gameState.startTime,
					};
					deleteActiveGame(null, gameId);
					res.json({ success: true, gameState: serializeGameState(gameState), win, submissionToken });
				}
			} else {
				res.json({ success: true, gameState: serializeGameState(gameState), win });
			}
		} else {
			res.status(400).json({ error: "Invalid move", gameState: serializeGameState(gameState) });
		}
	});

	router.post("/draw", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { gameId } = req.body;
		const gameState = getActiveGame(userId, gameId);

		if (!gameState) return res.status(404).json({ error: "Game not found." });
		if (gameState.isDone) return res.status(400).json({ error: "This game is already completed." });

		if (gameState.hardMode) {
			draw3Cards(gameState);
		} else {
			drawCard(gameState);
		}
		updateGameStats(gameState, "draw");
		res.json({ success: true, gameState: serializeGameState(gameState) });
	});

	router.post("/undo", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { gameId } = req.body;
		const gameState = getActiveGame(userId, gameId);

		if (!gameState) return res.status(404).json({ error: "Game not found." });
		if (gameState.isDone) return res.status(400).json({ error: "This game is already completed." });
		if (gameState.hist.length === 0) return res.status(400).json({ error: "No moves to undo." });

		undoMove(gameState);
		res.json({ success: true, gameState: serializeGameState(gameState) });
	});

	router.post("/auto-complete", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { gameId } = req.body;
		const gameState = getActiveGame(userId, gameId);

		if (!gameState) return res.status(404).json({ error: "Game not found." });
		if (gameState.isDone) return res.status(400).json({ error: "This game is already completed." });

		// Server-side guard: only auto-complete from a genuinely solvable state.
		if (!isAutoSolvable(gameState)) {
			return res.status(400).json({
				error: "Game is not in an auto-completable state.",
				gameState: serializeGameState(gameState),
			});
		}

		autoComplete(gameState);

		const win = checkWinCondition(gameState);
		if (!win) {
			// Should be unreachable: an auto-solvable state always completes.
			return res.status(500).json({
				error: "Auto-complete failed to finish the game.",
				gameState: serializeGameState(gameState),
			});
		}

		gameState.isDone = true;
		if (userId) {
			const result = await handleWin(userId, gameState, io, client);
			res.json({
				success: true,
				gameState: serializeGameState(gameState),
				win,
				isNewUser: result?.isNewUser || false,
			});
		} else {
			// Guest player: store the win for later claim, same as a normal win.
			const submissionToken = randomUUID();
			pendingSubmissions[submissionToken] = {
				gameState,
				timeTaken: Date.now() - gameState.startTime,
			};
			deleteActiveGame(null, gameId);
			res.json({ success: true, gameState: serializeGameState(gameState), win, submissionToken });
		}
	});

	router.post("/claim-submission", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { submissionToken } = req.body;

		if (!submissionToken || !pendingSubmissions[submissionToken]) {
			return res.status(404).json({ error: "No pending submission found." });
		}

		const { gameState, timeTaken } = pendingSubmissions[submissionToken];
		delete pendingSubmissions[submissionToken];

		const result = await handleWin(userId, gameState, io, client);

		res.json({
			success: true,
			time: timeTaken,
			moves: gameState.moves,
			score: gameState.score,
			isNewUser: result?.isNewUser || false,
		});
	});

	return router;
}

// --- Helper Functions ---

/** Updates game stats like moves and score after an action. */
function updateGameStats(gameState, actionType, moveData = {}) {
	gameState.moves++;
	if (actionType === "move") {
		if (moveData.destPileType === "foundationPiles") {
			gameState.score += 10;
		}
		if (moveData.sourcePileType === "foundationPiles") {
			gameState.score -= 15;
		}
	}
	if (actionType === "draw" && gameState.wastePile.length === 0) {
		gameState.score -= 5;
	}
}

/** Handles the logic when a game is won. Returns an object with isNewUser flag. */
async function handleWin(userId, gameState, io, client) {
	let currentUser = await userService.getUser(userId);
	let isNewUser = false;

	// Auto-register user if they don't exist yet
	if (!currentUser) {
		try {
			const discordUser = await resolveUser(client, userId);
			if (!discordUser) return;

			await userService.insertUser({
				id: discordUser.id,
				username: discordUser.username,
				globalName: discordUser.globalName,
				warned: 0,
				warns: 0,
				allTimeWarns: 0,
				totalRequests: 0,
				avatarUrl: discordUser.displayAvatarURL({ dynamic: true, size: 256 }),
				isAkhy: 0,
			});

			// Give welcome bonus coins like the dashboard registration
			await userService.updateUserCoins(userId, 5000);
			await logService.insertLog({
				id: `${userId}-welcome-${Date.now()}`,
				userId: userId,
				action: "WELCOME_BONUS",
				targetUserId: null,
				coinsAmount: 5000,
				userNewAmount: 5000,
			});

			currentUser = await userService.getUser(userId);
			if (!currentUser) return;

			isNewUser = true;
			console.log(
				`Auto-registered user ${discordUser.username} (${discordUser.id}) via solitaire win with welcome bonus`,
			);
		} catch (e) {
			console.error("Failed to auto-register user during solitaire win:", e);
			return;
		}
	}

	if (gameState.hardMode) {
		const bonus = 500;
		const newCoins = currentUser.coins + bonus;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-hardmode-solitaire-${Date.now()}`,
			userId: userId,
			action: "HARDMODE_SOLITAIRE_WIN",
			targetUserId: null,
			coinsAmount: bonus,
			userNewAmount: newCoins,
		});
		await socketEmit("data-updated", { table: "users" });
	}

	if (!gameState.isSOTD) return { isNewUser };

	gameState.endTime = Date.now();
	const timeTaken = gameState.endTime - gameState.startTime;

	const existingStats = await solitaireService.getUserSOTDStats(userId);

	if (!existingStats) {
		const bonus = 1000;
		const newCoins = currentUser.coins + bonus;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-sotd-complete-${Date.now()}`,
			userId: userId,
			action: "SOTD_WIN",
			targetUserId: null,
			coinsAmount: bonus,
			userNewAmount: newCoins,
		});
		await socketEmit("data-updated", { table: "users" });
	}

	const isNewBest =
		!existingStats ||
		gameState.score > existingStats.score ||
		(gameState.score === existingStats.score && gameState.moves < existingStats.moves) ||
		(gameState.score === existingStats.score &&
			gameState.moves === existingStats.moves &&
			timeTaken < existingStats.time);

	if (isNewBest) {
		await solitaireService.deleteUserSOTDStats(userId);
		await solitaireService.insertSOTDStats({
			id: userId,
			userId: userId,
			time: timeTaken,
			moves: gameState.moves,
			score: gameState.score,
		});
		await socketEmit("sotd-update");
		console.log(`New SOTD high score for ${currentUser.globalName}: ${gameState.score} points.`);
	}

	if (activeSolitaireGames[userId]) {
		delete activeSolitaireGames[userId];
	}

	return { isNewUser };
}
