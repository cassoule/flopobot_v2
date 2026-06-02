import * as userService from "../services/user.service.js";
import * as skinService from "../services/skin.service.js";
import * as logService from "../services/log.service.js";
import * as solitaireService from "../services/solitaire.service.js";
import * as sudokuService from "../services/sudoku.service.js";
import * as motsFlechesService from "../services/motsFleches.service.js";
import {
	activeSlowmodes,
	activeSolitaireGames,
	activeSudokuGames,
	activeMotsFlechesGames,
	messagesTimestamps,
	skins,
	sotdResetVotes,
} from "./state.js";
import { createDeck, createSeededRNG, deal, seededShuffle } from "./solitaire.js";
import { generatePuzzle } from "./sudoku.js";
import { emitSolitaireUpdate, emitSudokuUpdate, emitMotsFlechesUpdate } from "../server/socket.js";
import { generateWithDefinitions, getAllWords } from "mots-fleches";
import { clearAllSOTDGames } from "../server/routes/sudoku.js";

/**
 * Handles awarding points (coins) to users for their message activity.
 * Limits points to 10 messages within a 15-minute window.
 * @param {object} message - The Discord.js message object.
 * @returns {boolean} True if points were awarded, false otherwise.
 */
export async function channelPointsHandler(message) {
	const author = message.author;
	const authorDB = await userService.getUser(author.id);

	if (!authorDB) {
		// User not in our database, do nothing.
		return false;
	}

	// Ignore short messages or commands that might be spammed
	if (message.content.length < 3 || message.content.startsWith("?")) {
		return false;
	}

	const now = Date.now();
	const userTimestamps = messagesTimestamps.get(author.id) || [];

	// Filter out timestamps older than 15 minutes (900,000 ms)
	const recentTimestamps = userTimestamps.filter((ts) => now - ts < 900000);

	// If the user has already sent 10 messages in the last 15 mins, do nothing
	if (recentTimestamps.length >= 10) {
		return false;
	}

	// Add the new message timestamp
	recentTimestamps.push(now);
	messagesTimestamps.set(author.id, recentTimestamps);

	// Award 50 coins for the 10th message, 10 for others
	const coinsToAdd = recentTimestamps.length === 10 ? 50 : 10;
	const newCoinTotal = authorDB.coins + coinsToAdd;

	await userService.updateUserCoins(author.id, newCoinTotal);

	await logService.insertLog({
		id: `${author.id}-${now}`,
		userId: author.id,
		action: "AUTO_COINS",
		targetUserId: null,
		coinsAmount: coinsToAdd,
		userNewAmount: newCoinTotal,
	});

	await logService.pruneOldLogs();

	return true; // Indicate that points were awarded
}

/**
 * Handles message deletion for users currently under a slowmode effect.
 * @param {object} message - The Discord.js message object.
 * @returns {object} An object indicating if a message was deleted or a slowmode expired.
 */
export async function slowmodesHandler(message) {
	const author = message.author;
	const authorSlowmode = activeSlowmodes[author.id];

	if (!authorSlowmode) {
		return { deleted: false, expired: false };
	}

	const now = Date.now();

	// Check if the slowmode duration has passed
	if (now > authorSlowmode.endAt) {
		console.log(`Slowmode for ${author.username} has expired.`);
		delete activeSlowmodes[author.id];
		return { deleted: false, expired: true };
	}

	// Check if the user is messaging too quickly (less than 1 minute between messages)
	if (authorSlowmode.lastMessage && now - authorSlowmode.lastMessage < 60 * 1000) {
		try {
			await message.delete();
			console.log(`Deleted a message from slowmoded user: ${author.username}`);
			return { deleted: true, expired: false };
		} catch (err) {
			console.error(`Failed to delete slowmode message:`, err);
			return { deleted: false, expired: false };
		}
	} else {
		// Update the last message timestamp for the user
		authorSlowmode.lastMessage = now;
		return { deleted: false, expired: false };
	}
}

/**
 * Calculates a random price for a skin based on its properties.
 * Used for testing and simulations.
 * @returns {string} The calculated random price as a string.
 */
export async function randomSkinPrice() {
	const dbSkins = await skinService.getAllSkins();
	if (dbSkins.length === 0) return "0.00";

	const randomDbSkin = dbSkins[Math.floor(Math.random() * dbSkins.length)];
	const randomSkinData = skins.find((skin) => skin.uuid === randomDbSkin.uuid);

	if (!randomSkinData) return "0.00";

	// Generate random level and chroma
	const randomLevel = Math.floor(Math.random() * randomSkinData.levels.length) + 1;
	let randomChroma = 1;
	if (randomLevel === randomSkinData.levels.length && randomSkinData.chromas.length > 1) {
		randomChroma = Math.floor(Math.random() * randomSkinData.chromas.length) + 1;
	}

	// Calculate price based on these random values
	let result = parseFloat(randomDbSkin.basePrice);
	result *= 1 + randomLevel / Math.max(randomSkinData.levels.length, 2);
	result *= 1 + randomChroma / 4;

	return result.toFixed(0);
}

/**
 * Initializes the Solitaire of the Day.
 * This function clears previous stats, awards the winner, and generates a new daily seed.
 */
export async function initTodaysSOTD() {
	console.log(`Initializing new Solitaire of the Day...`);

	const rankings = await solitaireService.getAllSOTDStats();
	if (rankings.length > 0) {
		const winnerId = rankings[0].userId;
		const secondPlaceId = rankings[1] ? rankings[1].userId : null;
		const thirdPlaceId = rankings[2] ? rankings[2].userId : null;
		const winnerUser = await userService.getUser(winnerId);
		const secondPlaceUser = secondPlaceId ? await userService.getUser(secondPlaceId) : null;
		const thirdPlaceUser = thirdPlaceId ? await userService.getUser(thirdPlaceId) : null;

		if (winnerUser) {
			const reward = 2500;
			const newCoinTotal = winnerUser.coins + reward;
			try {
				await userService.updateUserCoins(winnerId, newCoinTotal);
				await logService.insertLog({
					id: `${winnerId}-sotd-win-${Date.now()}`,
					targetUserId: null,
					userId: winnerId,
					action: "SOTD_FIRST_PLACE",
					coinsAmount: reward,
					userNewAmount: newCoinTotal,
				});
			} catch (e) {
				console.error(`Error awarding SOTD winner:`, e);
			}
			console.log(
				`${winnerUser.globalName || winnerUser.username} won the previous SOTD and received ${reward} coins.`,
			);
		}
		if (secondPlaceUser) {
			const reward = 1500;
			const newCoinTotal = secondPlaceUser.coins + reward;
			try {
				await userService.updateUserCoins(secondPlaceId, newCoinTotal);
				await logService.insertLog({
					id: `${secondPlaceId}-sotd-second-${Date.now()}`,
					targetUserId: null,
					userId: secondPlaceId,
					action: "SOTD_SECOND_PLACE",
					coinsAmount: reward,
					userNewAmount: newCoinTotal,
				});
			} catch (e) {
				console.error(`Error awarding SOTD second place:`, e);
			}
			console.log(
				`${secondPlaceUser.globalName || secondPlaceUser.username} got second place in the previous SOTD and received ${reward} coins.`,
			);
		}
		if (thirdPlaceUser) {
			const reward = 750;
			const newCoinTotal = thirdPlaceUser.coins + reward;
			try {
				await userService.updateUserCoins(thirdPlaceId, newCoinTotal);
				await logService.insertLog({
					id: `${thirdPlaceId}-sotd-third-${Date.now()}`,
					targetUserId: null,
					userId: thirdPlaceId,
					action: "SOTD_THIRD_PLACE",
					coinsAmount: reward,
					userNewAmount: newCoinTotal,
				});
			} catch (e) {
				console.error(`Error awarding SOTD third place:`, e);
			}
			console.log(
				`${thirdPlaceUser.globalName || thirdPlaceUser.username} got third place in the previous SOTD and received ${reward} coins.`,
			);
		}
	}
	const newRandomSeed = Date.now().toString(36) + Math.random().toString(36).substr(2);
	let numericSeed = 0;
	for (let i = 0; i < newRandomSeed.length; i++) {
		numericSeed = (numericSeed + newRandomSeed.charCodeAt(i)) & 0xffffffff;
	}

	const rng = createSeededRNG(numericSeed);
	const deck = createDeck();
	const shuffledDeck = seededShuffle(deck, rng);
	const todaysSOTD = deal(shuffledDeck);

	try {
		await solitaireService.clearSOTDStats();
		await solitaireService.deleteSOTD();
		await solitaireService.insertSOTD({
			tableauPiles: JSON.stringify(todaysSOTD.tableauPiles),
			foundationPiles: JSON.stringify(todaysSOTD.foundationPiles),
			stockPile: JSON.stringify(todaysSOTD.stockPile),
			wastePile: JSON.stringify(todaysSOTD.wastePile),
			seed: newRandomSeed,
		});
		for (const [userId, gameData] of Object.entries(activeSolitaireGames)) {
			if (gameData.isSOTD) {
				delete activeSolitaireGames[userId];
				emitSolitaireUpdate(userId);
			}
		}

		sotdResetVotes.clear();

		console.log(`Today's SOTD is ready with a new seed.`);
	} catch (e) {
		console.error(`Error saving new SOTD to database:`, e);
	}
}

/**
 * Initializes the Sudoku of the Day.
 * Awards previous day's winners and generates a new daily puzzle.
 */
export async function initTodaysSudokuOTD() {
	console.log(`Initializing new Sudoku of the Day...`);

	const rankings = await sudokuService.getAllSudokuOTDStats();
	if (rankings.length > 0) {
		const places = [
			{ index: 0, reward: 2500, action: "SUDOKU_SOTD_FIRST_PLACE" },
			{ index: 1, reward: 1500, action: "SUDOKU_SOTD_SECOND_PLACE" },
			{ index: 2, reward: 750, action: "SUDOKU_SOTD_THIRD_PLACE" },
		];

		for (const { index, reward, action } of places) {
			if (!rankings[index]) continue;
			const playerId = rankings[index].userId;
			const player = await userService.getUser(playerId);
			if (!player) continue;

			const newCoinTotal = player.coins + reward;
			try {
				await userService.updateUserCoins(playerId, newCoinTotal);
				await logService.insertLog({
					id: `${playerId}-sudoku-sotd-${action.toLowerCase()}-${Date.now()}`,
					targetUserId: null,
					userId: playerId,
					action,
					coinsAmount: reward,
					userNewAmount: newCoinTotal,
				});
			} catch (e) {
				console.error(`Error awarding Sudoku SOTD ${action.toLowerCase()}:`, e);
			}

			console.log(
				`${player.globalName || player.username} got ${action.replace("SUDOKU_SOTD_", "").toLowerCase().replace("_", " ")} in the previous Sudoku SOTD and received ${reward} coins.`,
			);
		}
	}

	const { puzzle, solution, difficulty } = generatePuzzle("medium");

	try {
		await sudokuService.clearSudokuOTDStats();
		await sudokuService.deleteSudokuOTD();
		await sudokuService.insertSudokuOTD({ puzzle, solution, difficulty });

		clearAllSOTDGames();

		console.log(`Today's Sudoku OTD is ready.`);
	} catch (e) {
		console.error(`Error saving new Sudoku OTD to database:`, e);
	}
}

/**
 * Initializes a Mots Fléchés of the Day grid.
 * Archive-based (no clobber): inserts a new row per local calendar date.
 *
 * @param {string|null} [dateArg] Optional `YYYY-MM-DD` date to generate the grid for.
 *   - Omitted (daily rollover): generates today's grid, seeds from the current
 *     timestamp, awards the previous day's top 3, and clears any live SOTD sessions.
 *   - Provided (manual backfill): generates only that date's grid, seeded
 *     deterministically from the date, with no reward payout. Live sessions are
 *     only cleared when the target date is the current day.
 * @returns {Promise<{date: string, skipped?: boolean, error?: boolean, id?: number, wordCount?: number}>}
 */
export async function initTodaysMotsFlechesOTD(dateArg = null) {
	const nowIso = new Date().toISOString();
	const isManualDate = !!dateArg;
	// Use the local calendar date so generation matches the read side
	// (getTodaysMotsFlechesOTD -> todayLocal). The cron fires at local midnight,
	// where the UTC date can still be the previous day.
	const todayStr = motsFlechesService.todayLocal();
	const dateStr = isManualDate ? dateArg : todayStr;
	// Daily rollover seeds from the current timestamp; a manual backfill seeds
	// deterministically from the target date so a given day always yields the same grid.
	const seedString = isManualDate ? `${dateArg}T00:00:00.000Z` : nowIso;

	console.log(`Initializing new Mots Fléchés OTD for ${dateStr}...`);

	const existing = await motsFlechesService.getMotsFlechesOTDByDate(dateStr);
	if (existing) {
		console.log(`Mots Fléchés OTD for ${dateStr} already exists, skipping generation.`);
		return { date: dateStr, skipped: true };
	}

	// Only award the previous day's winners on the real daily rollover.
	// A manual backfill for a specific date must not trigger any payout.
	if (!isManualDate) {
		try {
			const latestPast = await (async () => {
				const all = await motsFlechesService.listArchive(null, 7);
				return all.find((r) => r.date < dateStr) || null;
			})();
			if (latestPast) {
				const rankings = await motsFlechesService.getAllStatsForOTD(latestPast.id);
				if (rankings.length > 0) {
					const places = [
						{ index: 0, reward: 2500, action: "MOTSFLECHES_OTD_FIRST_PLACE" },
						{ index: 1, reward: 1500, action: "MOTSFLECHES_OTD_SECOND_PLACE" },
						{ index: 2, reward: 750, action: "MOTSFLECHES_OTD_THIRD_PLACE" },
					];
					for (const { index, reward, action } of places) {
						if (!rankings[index]) continue;
						const playerId = rankings[index].userId;
						const player = await userService.getUser(playerId);
						if (!player) continue;
						const newCoinTotal = player.coins + reward;
						await userService.updateUserCoins(playerId, newCoinTotal);
						await logService.insertLog({
							id: `${playerId}-motsfleches-otd-${action.toLowerCase()}-${Date.now()}`,
							targetUserId: null,
							userId: playerId,
							action,
							coinsAmount: reward,
							userNewAmount: newCoinTotal,
						});
						console.log(
							`${player.globalName || player.username} got ${action.replace("MOTSFLECHES_OTD_", "").toLowerCase().replace("_", " ")} in the previous Mots Fléchés OTD and received ${reward} coins.`,
						);
					}
				}
			}
		} catch (e) {
			console.error("Error awarding previous Mots Fléchés OTD winners:", e);
		}
	}

	const words = getAllWords();
	let result = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			result = await generateWithDefinitions(words, 9, 11, { seedString });
			if (result) break;
		} catch (e) {
			console.error(`[MotsFleches] gen attempt ${attempt} failed:`, e?.message || e);
		}
		if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
	}

	if (!result) {
		console.error(`[MotsFleches] generation failed after 3 attempts — no grid for ${dateStr}.`);
		return { date: dateStr, error: true };
	}

	try {
		const defCellsObj = Object.fromEntries(result.defCells);
		const inserted = await motsFlechesService.insertMotsFlechesOTD({
			date: dateStr,
			rows: result.grid.length,
			cols: result.grid[0]?.length || 0,
			grid: JSON.stringify(result.grid),
			slots: JSON.stringify(result.slots),
			defCells: JSON.stringify(defCellsObj),
			definitions: JSON.stringify(result.definitions || {}),
			wordCount: result.wordCount,
			seedString: result.seedString || null,
			generationMs: Math.round(result.generationTimeMs ?? 0),
		});

		// Clear any live SOTD sessions only when (re)generating the current day's grid.
		if (dateStr === todayStr) {
			for (const [userId, gameData] of Object.entries(activeMotsFlechesGames)) {
				if (gameData.isSOTD) {
					delete activeMotsFlechesGames[userId];
					emitMotsFlechesUpdate(userId);
				}
			}
		}

		console.log(
			`Mots Fléchés OTD for ${dateStr} is ready (id=${inserted.id}, ${result.wordCount} mots, gen=${result.generationTimeMs}ms).`,
		);
		return { date: dateStr, id: inserted.id, wordCount: result.wordCount };
	} catch (e) {
		console.error(`Error saving new Mots Fléchés OTD:`, e);
		return { date: dateStr, error: true };
	}
}
