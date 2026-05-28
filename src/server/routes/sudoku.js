import express from "express";
import { generatePuzzle, validateSolution } from "../../game/sudoku.js";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import * as sudokuService from "../../services/sudoku.service.js";
import { socketEmit } from "../socket.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { randomUUID } from "crypto";

const gameStates = {};
const userGameMap = {};
const pendingSubmissions = {};

const router = express.Router();

const REWARDS_BY_DIFFICULTY = {
	easy: 100,
	medium: 200,
	hard: 500,
	expert: 1000,
};

function getOptionalUserId(req) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
	try {
		const token = authHeader.slice(7);
		const jwt = require("jsonwebtoken");
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		return decoded.userId;
	} catch (err) {
		return null;
	}
}

export function sudokuRoutes(client, io) {
	router.post("/start", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { difficulty = "medium" } = req.body;

		const { puzzle, solution, difficulty: diff } = generatePuzzle(difficulty);
		const gameId = randomUUID();

		console.log(`\n🆕 [GAME START] New game started (ID: ${gameId})`);

		const gameState = {
			puzzle,
			solution,
			difficulty: diff,
			isSOTD: false,
			isDone: false,
			startTime: Date.now(),
		};

		gameStates[gameId] = gameState;

		if (userId) {
			userGameMap[userId] = gameId;
		}

		const { solution: _, ...safeState } = gameState;
		res.json({ success: true, gameState: safeState, gameId });
	});

	router.post("/start/sotd", optionalAuth, async (req, res) => {
		const userId = req.userId;

		const sotd = await sudokuService.getSudokuOTD();
		if (!sotd) {
			return res.status(500).json({ error: "Sudoku of the Day is not configured." });
		}

		const gameId = randomUUID();

		console.log(`\n☀️ [SOTD START] Player started Sudoku of the Day`);

		const gameState = {
			puzzle: sotd.puzzle,
			solution: sotd.solution,
			difficulty: sotd.difficulty,
			isSOTD: true,
			isDone: false,
			startTime: Date.now(),
		};

		gameStates[gameId] = gameState;

		if (userId) {
			if (userGameMap[userId]) {
				delete gameStates[userGameMap[userId]];
			}
			userGameMap[userId] = gameId;
		}

		const { solution: _, ...safeState } = gameState;
		res.json({ success: true, gameState: safeState, gameId });
	});

	router.get("/sotd/rankings", async (req, res) => {
		try {
			const rankings = await sudokuService.getAllSudokuOTDStats();
			res.json({ rankings });
		} catch (e) {
			res.status(500).json({ error: "Failed to fetch Sudoku OTD rankings." });
		}
	});

	router.get("/state/:userId", (req, res) => {
		const { userId } = req.params;
		const gameId = userGameMap[userId];
		const gameState = gameId ? gameStates[gameId] : null;
		if (gameState) {
			const { solution, ...safeState } = gameState;
			res.json({ success: true, gameState: safeState, gameId });
		} else {
			res.status(404).json({ error: "No active game found for this user." });
		}
	});

	router.post("/progress", optionalAuth, (req, res) => {
		const { gameId, grid, notes } = req.body;
		if (!gameId || !gameStates[gameId]) {
			return res.status(404).json({ error: "Game not found" });
		}

		const gameState = gameStates[gameId];
		if (gameState.isDone) {
			return res.status(400).json({ error: "Game already completed" });
		}

		if (grid && typeof grid === "string" && grid.length === 81) {
			gameState.progress = grid;
		}
		if (Array.isArray(notes) && notes.length === 81) {
			gameState.notes = notes;
		}
		res.json({ success: true });
	});

	router.post("/reset", optionalAuth, (req, res) => {
		const { gameId } = req.body;
		if (gameId && gameStates[gameId]) {
			delete gameStates[gameId];
		}

		const userId = req.userId;
		if (userId && userGameMap[userId]) {
			delete gameStates[userGameMap[userId]];
			delete userGameMap[userId];
		}

		res.json({ success: true, message: "Game reset." });
	});

	router.post("/submit", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { gameId, grid, timeTaken: clientTime } = req.body;

		if (!gameId || !gameStates[gameId]) {
			return res.status(404).json({ error: "Game not found" });
		}

		const gameState = gameStates[gameId];
		if (gameState.isDone) {
			return res.status(400).json({ error: "This game is already completed." });
		}

		if (!grid || typeof grid !== "string" || grid.length !== 81 || !/^[0-9]+$/.test(grid)) {
			return res.status(400).json({ error: "Invalid grid. Expected 81 characters (0-9)." });
		}

		const { valid, errors } = validateSolution(grid, gameState.solution);

		if (valid) {
			gameState.isDone = true;
			// Use client time if provided (more accurate), fallback to server calculation
			const timeTaken = clientTime || (Date.now() - gameState.startTime);

			if (userId) {
				// Logged in user: give rewards immediately
				await handleWin(userId, gameState, gameId, timeTaken);
				delete gameStates[gameId];
				delete userGameMap[userId];
				res.json({ success: true, valid: true, time: timeTaken });
			} else {
				// Guest player: keep the win pending
				const submissionToken = randomUUID();
				pendingSubmissions[submissionToken] = {
					gameState,
					timeTaken,
				};
				delete gameStates[gameId];
				res.json({ success: true, valid: true, time: timeTaken, submissionToken });
			}
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

		await handleWin(userId, gameState, null, timeTaken);

		res.json({ success: true, time: timeTaken });
	});

	return router;
}

async function handleWin(userId, gameState, gameId, timeTaken) {
	const currentUser = await userService.getUser(userId);
	if (!currentUser) return;

	if (!gameState.isSOTD) {
		const reward = REWARDS_BY_DIFFICULTY[gameState.difficulty] || 250;
		const newCoins = currentUser.coins + reward;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-sudoku-win-${Date.now()}`,
			userId: userId,
			action: "SUDOKU_WIN",
			targetUserId: null,
			coinsAmount: reward,
			userNewAmount: newCoins,
		});
		await socketEmit("data-updated", { table: "users" });
		return;
	}

	const finalTime = timeTaken || (Date.now() - gameState.startTime);
	const existingStats = await sudokuService.getUserSudokuOTDStats(userId);

	if (!existingStats) {
		const bonus = 1000;
		const newCoins = currentUser.coins + bonus;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-sudoku-sotd-complete-${Date.now()}`,
			userId: userId,
			action: "SUDOKU_SOTD_WIN",
			targetUserId: null,
			coinsAmount: bonus,
			userNewAmount: newCoins,
		});
		await socketEmit("data-updated", { table: "users" });
	}

	const isNewBest = !existingStats || finalTime < existingStats.time;

	if (isNewBest) {
		await sudokuService.deleteUserSudokuOTDStats(userId);
		await sudokuService.insertSudokuOTDStats({
			id: userId,
			userId: userId,
			time: finalTime,
		});
		await socketEmit("sudoku-sotd-update");
		console.log(`New Sudoku SOTD best time for ${currentUser.globalName}: ${finalTime}ms.`);
	}
}

export function clearAllSOTDGames() {
	for (const [userId, gameId] of Object.entries(userGameMap)) {
		const gameState = gameStates[gameId];
		if (gameState && gameState.isSOTD) {
			delete gameStates[gameId];
			delete userGameMap[userId];
			emitSudokuUpdate(userId);
		}
	}
}
