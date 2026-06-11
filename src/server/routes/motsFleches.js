import express from "express";
import { activeMotsFlechesGames } from "../../game/state.js";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import * as motsFlechesService from "../../services/motsFleches.service.js";
import { socketEmit, emitMotsFlechesUpdate } from "../socket.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { resolveUser } from "../../utils/index.js";
import { randomUUID } from "crypto";

const router = express.Router();

// Stores guest wins waiting to be claimed after login, keyed by submissionToken.
const pendingSubmissions = {};
// Stores active guest games, keyed by gameId.
const guestGames = {};

/** Gets the active game by userId (logged in) or gameId (guest). */
function getActiveGame(userId, gameId) {
	if (userId && activeMotsFlechesGames[userId]) {
		return activeMotsFlechesGames[userId];
	}
	if (!userId && gameId && guestGames[gameId]) {
		return guestGames[gameId];
	}
	return null;
}

/** Deletes an active game for a logged-in user or a guest. */
function deleteActiveGame(userId, gameId) {
	if (userId && activeMotsFlechesGames[userId]) {
		delete activeMotsFlechesGames[userId];
	}
	if (!userId && gameId && guestGames[gameId]) {
		delete guestGames[gameId];
	}
}

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

const HINT_COST = 100;
const HINT_SCORE_PENALTY = 500;
const FAILED_ATTEMPT_SCORE_PENALTY = 1000;

function computeScore(time, cluesSolved, hintsUsed = 0, failedAttempts = 0) {
	const base = cluesSolved * 1000 - Math.min(time / 1000, 600) * 5;
	const penalty = hintsUsed * HINT_SCORE_PENALTY + failedAttempts * FAILED_ATTEMPT_SCORE_PENALTY;
	return Math.max(0, Math.round(base - penalty));
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
	router.post("/start/sotd", optionalAuth, async (req, res) => {
		const userId = req.userId;

		if (userId && activeMotsFlechesGames[userId]?.isSOTD) {
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
			hintsUsed: 0,
			failedAttempts: 0,
			revealed: {},
		};

		if (userId) {
			activeMotsFlechesGames[userId] = state;
			res.json({ success: true, gameState: publicGameState(state) });
		} else {
			// Guest: store game with a generated gameId
			const gameId = randomUUID();
			guestGames[gameId] = state;
			res.json({ success: true, gameState: publicGameState(state), gameId });
		}
	});

	router.post("/start/archive", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { date } = req.body || {};
		if (!date || typeof date !== "string") {
			return res.status(400).json({ error: "Missing date." });
		}

		const today = motsFlechesService.todayLocal();
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
			hintsUsed: 0,
			failedAttempts: 0,
			revealed: {},
		};

		if (userId) {
			activeMotsFlechesGames[userId] = state;
			res.json({ success: true, gameState: publicGameState(state) });
		} else {
			// Guest: store game with a generated gameId
			const gameId = randomUUID();
			guestGames[gameId] = state;
			res.json({ success: true, gameState: publicGameState(state), gameId });
		}
	});

	router.post("/hint", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { gameId, r, c } = req.body || {};
		const state = getActiveGame(userId, gameId);
		if (!state) return res.status(404).json({ error: "No active game found." });
		if (state.isDone) return res.status(400).json({ error: "Cette grille est déjà terminée." });

		if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= state.rows || c < 0 || c >= state.cols) {
			return res.status(400).json({ error: "Case invalide." });
		}

		const solution = state.grid[r]?.[c];
		if (!solution || solution === "#" || solution === ".") {
			return res.status(400).json({ error: "Cette case ne contient pas de lettre." });
		}

		const key = `${r},${c}`;
		const letter = solution.toUpperCase();

		if (!state.isSOTD) {
			state.revealed[key] = true;
			return res.json({ success: true, r, c, letter, free: true });
		}
		if (!userId) {
			return res.status(401).json({ error: "Connecte-toi pour utiliser un indice sur la grille du jour." });
		}

		if (state.revealed[key]) {
			return res.json({ success: true, r, c, letter, free: true, hintsUsed: state.hintsUsed });
		}

		const user = await userService.getUser(userId);
		if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
		if ((user.coins ?? 0) < HINT_COST) {
			return res.status(400).json({ error: "Pas assez de FlopoCoins pour un indice.", coins: user.coins ?? 0 });
		}

		const newCoins = user.coins - HINT_COST;
		await userService.updateUserCoins(userId, newCoins);
		await logService.insertLog({
			id: `${userId}-motsfleches-otd-hint-${Date.now()}`,
			userId,
			action: "MOTSFLECHES_OTD_HINT",
			targetUserId: null,
			coinsAmount: -HINT_COST,
			userNewAmount: newCoins,
		});

		state.revealed[key] = true;
		state.hintsUsed = (state.hintsUsed || 0) + 1;

		res.json({ success: true, r, c, letter, cost: HINT_COST, coins: newCoins, hintsUsed: state.hintsUsed });
	});

	router.get("/archive", optionalAuth, async (req, res) => {
		try {
			const userId = req.userId || null;
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

	router.post("/progress", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { gameId, filledGrid } = req.body || {};
		const state = getActiveGame(userId, gameId);
		if (!state) return res.status(404).json({ error: "No active game found." });
		if (state.isDone) return res.status(400).json({ error: "Game is already completed." });

		if (!Array.isArray(filledGrid) || filledGrid.length !== state.rows) {
			return res.status(400).json({ error: "Invalid filledGrid shape." });
		}
		state.filledGrid = filledGrid;
		res.json({ success: true });
	});

	router.post("/reset", optionalAuth, (req, res) => {
		const userId = req.userId;
		const { gameId } = req.body || {};
		deleteActiveGame(userId, gameId);
		res.json({ success: true });
	});

	router.post("/submit", optionalAuth, async (req, res) => {
		const userId = req.userId;
		const { gameId, filledGrid } = req.body || {};
		const state = getActiveGame(userId, gameId);
		if (!state) return res.status(404).json({ error: "Game not found." });
		if (state.isDone) return res.status(400).json({ error: "This game is already completed." });

		const { valid, errors, cluesSolved, badShape } = validateGrid(filledGrid, state.grid, state.slots);

		if (badShape) {
			return res.status(400).json({ error: "Invalid grid shape." });
		}

		if (!valid) {
			state.failedAttempts = (state.failedAttempts || 0) + 1;
			return res.json({ success: true, valid: false, errors, cluesSolved, failedAttempts: state.failedAttempts });
		}

		const time = Date.now() - state.startTime;
		const score = computeScore(time, cluesSolved, state.hintsUsed || 0, state.failedAttempts || 0);

		state.isDone = true;

		if (userId) {
			if (state.isSOTD) {
				await handleSOTDWin(userId, state, { time, cluesSolved, score }, client);
			}
			deleteActiveGame(userId, gameId);
			res.json({ success: true, valid: true, time, cluesSolved, score });
		} else if (state.isSOTD) {
			const submissionToken = randomUUID();
			pendingSubmissions[submissionToken] = { state, time, cluesSolved, score };
			deleteActiveGame(null, gameId);
			res.json({ success: true, valid: true, time, cluesSolved, score, submissionToken });
		} else {
			deleteActiveGame(null, gameId);
			res.json({ success: true, valid: true, time, cluesSolved, score });
		}
	});

	router.post("/claim-submission", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { submissionToken } = req.body;

		if (!submissionToken || !pendingSubmissions[submissionToken]) {
			return res.status(404).json({ error: "No pending submission found." });
		}

		const { state, time, cluesSolved, score } = pendingSubmissions[submissionToken];
		delete pendingSubmissions[submissionToken];

		const result = await handleSOTDWin(userId, state, { time, cluesSolved, score }, client);

		res.json({ success: true, time, cluesSolved, score, isNewUser: result?.isNewUser || false });
	});

	return router;
}

async function handleSOTDWin(userId, state, { time, cluesSolved, score }, client) {
	let currentUser = await userService.getUser(userId);
	let isNewUser = false;

	// Auto-register user if they don't exist yet (e.g. a guest who just logged in).
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
				`Auto-registered user ${discordUser.username} (${discordUser.id}) via mots fléchés win with welcome bonus`,
			);
		} catch (e) {
			console.error("Failed to auto-register user during mots fléchés win:", e);
			return;
		}
	}

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

	return { isNewUser };
}
