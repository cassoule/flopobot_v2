import express from "express";
import { activeMotsFlechesGames } from "../../game/state.js";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import * as motsFlechesService from "../../services/motsFleches.service.js";
import { socketEmit, emitMotsFlechesUpdate } from "../socket.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function hydrateFromRow(row) {
	return {
		otdId: row.id,
		date: row.date,
		rows: row.rows,
		cols: row.cols,
		grid: JSON.parse(row.grid),
		slots: JSON.parse(row.slots),
		defCells: JSON.parse(row.defCells),
		definitions: JSON.parse(row.definitions),
		wordCount: row.wordCount,
	};
}

function publicGameState(state) {
	const { grid, slots, definitions, defCells, ...safe } = state;
	const rows = state.rows;
	const cols = state.cols;
	const blackMask = grid.map((row) => row.map((ch) => ch === "#"));

	// Strip solution words from clues: resolve each clue's definition text
	// server-side and drop both `word` and the word-keyed `definitions` dict
	// so the client payload contains no answers.
	const publicDefCells = {};
	for (const [key, clues] of Object.entries(defCells || {})) {
		publicDefCells[key] = (clues || []).map((clue) => ({
			arrow: clue.arrow,
			dir: clue.dir,
			def: (definitions && clue.word ? definitions[clue.word.toUpperCase()] : "") || "",
		}));
	}

	return { ...safe, rows, cols, blackMask, defCells: publicDefCells };
}

function computeScore(time, cluesSolved) {
	return Math.max(0, Math.round(cluesSolved * 1000 - Math.min(time / 1000, 600) * 5));
}

function validateGrid(filledGrid, solutionGrid, slots) {
	const errors = [];
	const R = solutionGrid.length;
	const C = solutionGrid[0]?.length ?? 0;
	if (!Array.isArray(filledGrid) || filledGrid.length !== R) {
		return { valid: false, errors: [], cluesSolved: 0, badShape: true };
	}
	for (let r = 0; r < R; r++) {
		if (!Array.isArray(filledGrid[r]) || filledGrid[r].length !== C) {
			return { valid: false, errors: [], cluesSolved: 0, badShape: true };
		}
	}

	const norm = (ch) => (typeof ch === "string" ? ch.toUpperCase().trim() : "");

	for (let r = 0; r < R; r++) {
		for (let c = 0; c < C; c++) {
			const expected = solutionGrid[r][c];
			if (expected === "#" || expected === ".") continue;
			if (norm(filledGrid[r][c]) !== expected.toUpperCase()) {
				errors.push({ r, c });
			}
		}
	}

	let cluesSolved = 0;
	for (const slot of slots) {
		const ok = slot.cells.every(({ r, c }) => norm(filledGrid[r][c]) === solutionGrid[r][c].toUpperCase());
		if (ok) cluesSolved++;
	}

	return { valid: errors.length === 0, errors, cluesSolved, badShape: false };
}

export function motsFlechesRoutes(client, io) {
	router.post("/start/sotd", requireAuth, async (req, res) => {
		const userId = req.userId;

		if (activeMotsFlechesGames[userId]?.isSOTD) {
			return res.json({ success: true, gameState: publicGameState(activeMotsFlechesGames[userId]) });
		}

		const row = await motsFlechesService.getTodaysMotsFlechesOTD();
		if (!row) {
			return res.status(500).json({ error: "Mots Fléchés of the Day is not configured." });
		}

		const state = {
			...hydrateFromRow(row),
			isSOTD: true,
			isDone: false,
			startTime: Date.now(),
			filledGrid: null,
		};
		activeMotsFlechesGames[userId] = state;
		res.json({ success: true, gameState: publicGameState(state) });
	});

	router.post("/start/archive", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { date } = req.body || {};
		if (!date || typeof date !== "string") {
			return res.status(400).json({ error: "Missing date." });
		}

		const today = new Date().toISOString().slice(0, 10);
		if (date >= today) {
			return res.status(400).json({ error: "Use /start/sotd for the current day." });
		}

		const row = await motsFlechesService.getMotsFlechesOTDByDate(date);
		if (!row) {
			return res.status(404).json({ error: "Grid not found for this date." });
		}

		const state = {
			...hydrateFromRow(row),
			isSOTD: false,
			isDone: false,
			startTime: Date.now(),
			filledGrid: null,
		};
		activeMotsFlechesGames[userId] = state;
		res.json({ success: true, gameState: publicGameState(state) });
	});

	router.get("/archive", requireAuth, async (req, res) => {
		try {
			const userId = req.userId;
			const limit = Math.min(parseInt(req.query.limit ?? "60", 10) || 60, 200);
			const list = await motsFlechesService.listArchive(userId, limit);
			res.json({ archive: list });
		} catch (e) {
			console.error("Failed to fetch Mots Fléchés archive:", e);
			res.status(500).json({ error: "Failed to fetch archive." });
		}
	});

	router.get("/sotd/rankings", async (req, res) => {
		try {
			const today = await motsFlechesService.getTodaysMotsFlechesOTD();
			if (!today) return res.json({ rankings: [] });
			const rankings = await motsFlechesService.getAllStatsForOTD(today.id);
			res.json({ rankings });
		} catch (e) {
			console.error("Failed to fetch Mots Fléchés rankings:", e);
			res.status(500).json({ error: "Failed to fetch rankings." });
		}
	});

	router.get("/state/:userId", (req, res) => {
		const { userId } = req.params;
		const state = activeMotsFlechesGames[userId];
		if (!state) {
			return res.status(404).json({ error: "No active game found for this user." });
		}
		res.json({ success: true, gameState: publicGameState(state) });
	});

	router.post("/progress", requireAuth, (req, res) => {
		const userId = req.userId;
		const state = activeMotsFlechesGames[userId];
		if (!state) return res.status(404).json({ error: "No active game found." });
		if (state.isDone) return res.status(400).json({ error: "Game is already completed." });

		const { filledGrid } = req.body || {};
		if (!Array.isArray(filledGrid) || filledGrid.length !== state.rows) {
			return res.status(400).json({ error: "Invalid filledGrid shape." });
		}
		state.filledGrid = filledGrid;
		res.json({ success: true });
	});

	router.post("/reset", requireAuth, (req, res) => {
		const userId = req.userId;
		if (activeMotsFlechesGames[userId]) {
			delete activeMotsFlechesGames[userId];
		}
		res.json({ success: true });
	});

	router.post("/submit", requireAuth, async (req, res) => {
		const userId = req.userId;
		const state = activeMotsFlechesGames[userId];
		if (!state) return res.status(404).json({ error: "Game not found." });
		if (state.isDone) return res.status(400).json({ error: "This game is already completed." });

		const { filledGrid } = req.body || {};
		const { valid, errors, cluesSolved, badShape } = validateGrid(filledGrid, state.grid, state.slots);

		if (badShape) {
			return res.status(400).json({ error: "Invalid grid shape." });
		}

		const time = Date.now() - state.startTime;
		const score = valid ? computeScore(time, cluesSolved) : null;

		if (!valid) {
			return res.json({ success: true, valid: false, errors, cluesSolved });
		}

		state.isDone = true;

		if (state.isSOTD) {
			await handleSOTDWin(userId, state, { time, cluesSolved, score });
		}

		delete activeMotsFlechesGames[userId];
		res.json({ success: true, valid: true, time, cluesSolved, score });
	});

	return router;
}

async function handleSOTDWin(userId, state, { time, cluesSolved, score }) {
	const currentUser = await userService.getUser(userId);
	if (!currentUser) return;

	const existing = await motsFlechesService.getUserStatForOTD(state.otdId, userId);

	if (!existing) {
		const bonus = 1000;
		const newCoins = currentUser.coins + bonus;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-motsfleches-otd-complete-${Date.now()}`,
			userId,
			action: "MOTSFLECHES_OTD_WIN",
			targetUserId: null,
			coinsAmount: bonus,
			userNewAmount: newCoins,
		});
		await socketEmit("data-updated", { table: "users" });
	}

	const isNewBest = !existing || (score ?? 0) > (existing.score ?? 0);
	if (isNewBest) {
		await motsFlechesService.upsertUserStat({
			otdId: state.otdId,
			userId,
			time,
			cluesSolved,
			score,
		});
		emitMotsFlechesUpdate(userId);
		console.log(
			`Mots Fléchés OTD: ${currentUser.globalName || currentUser.username} → ${cluesSolved} mots, ${time}ms, score=${score}.`,
		);
	}
}
