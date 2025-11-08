import {
	clearSOTDStats,
	deleteSOTD,
	getAllSkins,
	getAllSOTDStats,
	getUser,
	insertGame,
	insertLog,
	insertSOTD,
	pruneOldLogs,
	updateUserCoins
} from "../database/index.js";
import { activeSlowmodes, messagesTimestamps, skins } from "./state.js";
import { createDeck, createSeededRNG, deal, seededShuffle } from "./solitaire.js";

/**
 * Handles awarding points (coins) to users for their message activity.
 * Limits points to 10 messages within a 15-minute window.
 * @param {object} message - The Discord.js message object.
 * @returns {boolean} True if points were awarded, false otherwise.
 */
export async function channelPointsHandler(message) {
	const author = message.author;
	const authorDB = getUser.get(author.id);

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

	updateUserCoins.run({
		id: author.id,
		coins: newCoinTotal,
	});

	insertLog.run({
		id: `${author.id}-${now}`,
		user_id: author.id,
		action: "AUTO_COINS",
		target_user_id: null,
		coins_amount: coinsToAdd,
		user_new_amount: newCoinTotal,
	});

	await pruneOldLogs();

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
export function randomSkinPrice() {
	const dbSkins = getAllSkins.all();
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
export function initTodaysSOTD() {
	console.log("Initializing new Solitaire of the Day...");

	// 1. Award previous day's winner
	const rankings = getAllSOTDStats.all();
	if (rankings.length > 0) {
		const winnerId = rankings[0].user_id;
		const winnerUser = getUser.get(winnerId);

		if (winnerUser) {
			const reward = 1000;
			const newCoinTotal = winnerUser.coins + reward;
			updateUserCoins.run({ id: winnerId, coins: newCoinTotal });
			insertLog.run({
				id: `${winnerId}-sotd-win-${Date.now()}`,
				target_user_id: null,
				user_id: winnerId,
				action: "SOTD_FIRST_PLACE",
				coins_amount: reward,
				user_new_amount: newCoinTotal,
			});
			console.log(
				`${winnerUser.globalName || winnerUser.username} won the previous SOTD and received ${reward} coins.`,
			);
			insertGame.run({
				id: `${winnerId}-${Date.now()}`,
				p1: winnerId,
				p2: null,
				p1_score: rankings[0].score,
				p2_score: null,
				p1_elo: winnerUser.elo,
				p2_elo: null,
				p1_new_elo: winnerUser.elo,
				p2_new_elo: null,
				type: "SOTD",
				timestamp: Date.now(),
			});
		}
	}

	// 2. Generate a new seeded deck for today
	const newRandomSeed = Date.now().toString(36) + Math.random().toString(36).substr(2);
	let numericSeed = 0;
	for (let i = 0; i < newRandomSeed.length; i++) {
		numericSeed = (numericSeed + newRandomSeed.charCodeAt(i)) & 0xffffffff;
	}

	const rng = createSeededRNG(numericSeed);
	const deck = createDeck();
	const shuffledDeck = seededShuffle(deck, rng);
	const todaysSOTD = deal(shuffledDeck);

	// 3. Clear old stats and save the new game state to the database
	try {
		clearSOTDStats.run();
		deleteSOTD.run();
		insertSOTD.run({
			tableauPiles: JSON.stringify(todaysSOTD.tableauPiles),
			foundationPiles: JSON.stringify(todaysSOTD.foundationPiles),
			stockPile: JSON.stringify(todaysSOTD.stockPile),
			wastePile: JSON.stringify(todaysSOTD.wastePile),
			seed: newRandomSeed,
		});
		console.log("Today's SOTD is ready with a new seed.");
	} catch (e) {
		console.error("Error saving new SOTD to database:", e);
	}
}
