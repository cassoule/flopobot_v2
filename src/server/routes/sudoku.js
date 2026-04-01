import express from "express";
import { generatePuzzle, validateSolution } from "../../game/sudoku.js";
import { activeSudokuGames } from "../../game/state.js";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import * as sudokuService from "../../services/sudoku.service.js";
import { socketEmit } from "../socket.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const REWARDS_BY_DIFFICULTY = {
	easy: 100,
	medium: 200,
	hard: 500,
	expert: 1000,
};

export function sudokuRoutes(client, io) {
	router.post("/start", requireAuth, (req, res) => {
		const userId = req.userId;
		const { difficulty = "medium" } = req.body;

		if (activeSudokuGames[userId] && !activeSudokuGames[userId].isSOTD) {
			const { solution, ...safeState } = activeSudokuGames[userId];
			return res.json({ success: true, gameState: safeState });
		}

		const { puzzle, solution, difficulty: diff } = generatePuzzle(difficulty);

		const gameState = {
			puzzle,
			solution,
			difficulty: diff,
			isSOTD: false,
			isDone: false,
			startTime: Date.now(),
		};

		activeSudokuGames[userId] = gameState;

		const { solution: _, ...safeState } = gameState;
		res.json({ success: true, gameState: safeState });
	});

	router.post("/start/sotd", requireAuth, async (req, res) => {
		const userId = req.userId;

		if (activeSudokuGames[userId]?.isSOTD) {
			const { solution, ...safeState } = activeSudokuGames[userId];
			return res.json({ success: true, gameState: safeState });
		}

		const sotd = await sudokuService.getSudokuOTD();
		if (!sotd) {
			return res.status(500).json({ error: "Sudoku of the Day is not configured." });
		}

		const gameState = {
			puzzle: sotd.puzzle,
			solution: sotd.solution,
			difficulty: sotd.difficulty,
			isSOTD: true,
			isDone: false,
			startTime: Date.now(),
		};

		activeSudokuGames[userId] = gameState;

		const { solution: _, ...safeState } = gameState;
		res.json({ success: true, gameState: safeState });
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
		const gameState = activeSudokuGames[userId];
		if (gameState) {
			const { solution, ...safeState } = gameState;
			res.json({ success: true, gameState: safeState });
		} else {
			res.status(404).json({ error: "No active game found for this user." });
		}
	});

	router.post("/progress", requireAuth, (req, res) => {
		const userId = req.userId;
		const gameState = activeSudokuGames[userId];

		if (!gameState) return res.status(404).json({ error: "No active game found." });
		if (gameState.isDone) return res.status(400).json({ error: "Game is already completed." });

		const { grid, notes } = req.body;

		if (grid && typeof grid === "string" && grid.length === 81) {
			gameState.progress = grid;
		}

		if (Array.isArray(notes) && notes.length === 81) {
			gameState.notes = notes;
		}

		res.json({ success: true });
	});

	router.post("/reset", requireAuth, (req, res) => {
		const userId = req.userId;
		if (activeSudokuGames[userId]) {
			delete activeSudokuGames[userId];
		}
		res.json({ success: true, message: "Game reset." });
	});

	router.post("/submit", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { grid } = req.body;
		const gameState = activeSudokuGames[userId];

		grid.toString();
		if (!gameState) return res.status(404).json({ error: "Game not found." });
		if (gameState.isDone) return res.status(400).json({ error: "This game is already completed." });

		if (!grid || typeof grid !== "string" || grid.length !== 81 || !/^[0-9]+$/.test(grid)) {
			return res.status(400).json({ error: "Invalid grid. Expected 81 characters (0-9)." });
		}

		const { valid, errors } = validateSolution(grid, gameState.solution);

		if (!valid) {
			return res.json({ success: true, valid: false, errors });
		}

		gameState.isDone = true;
		await handleWin(userId, gameState);

		delete activeSudokuGames[userId];
		res.json({ success: true, valid: true, time: Date.now() - gameState.startTime });
	});

	return router;
}

async function handleWin(userId, gameState) {
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

	const timeTaken = Date.now() - gameState.startTime;
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

	const isNewBest = !existingStats || timeTaken < existingStats.time;

	if (isNewBest) {
		await sudokuService.deleteUserSudokuOTDStats(userId);
		await sudokuService.insertSudokuOTDStats({
			id: userId,
			userId: userId,
			time: timeTaken,
		});
		await socketEmit("sudoku-sotd-update");
		console.log(`New Sudoku SOTD best time for ${currentUser.globalName}: ${timeTaken}ms.`);
	}
}
