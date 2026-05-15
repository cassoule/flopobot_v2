import crypto from "crypto";
import * as userService from "../services/user.service.js";
import * as logService from "../services/log.service.js";
import { client } from "../bot/client.js";
import { EmbedBuilder } from "discord.js";

/**
 * Generates the multiplier where the plane will crash.
 * Uses a mathematical formula to have many small crashes
 * and very few huge crashes (similar to real casinos).
 * @returns {number} The crash multiplier (e.g., 1.00, 2.45, 15.20).
 */
export function generateCrashPoint() {
	const houseEdge = 0.1; // 10%

	const hash = crypto.randomBytes(32).toString("hex");
	const h = parseInt(hash.slice(0, 13), 16);

	const e = Math.pow(2, 52);

	const rawRatio = e / (e - h);

	const power = 0.95;

	let result = Math.pow(rawRatio, power) * 100;

	let crash = Math.floor(result * (1 - houseEdge)) / 100;

	const MAX_MULTIPLIER = 10000.0;

	crash = Math.min(crash, MAX_MULTIPLIER);

	return Math.max(1.0, crash);
}

/**
 * Creates a new Crash room object.
 * @returns {object} The room object.
 */
export function createCrashRoom({
	minBet = 10,
	maxBet = 10000,
	fakeMoney = false,
	phaseDurations = {
		bettingMs: 10000,
		payoutMs: 5000,
	},
} = {}) {
	return {
		id: "crash-room",
		name: "Crash",
		created_at: Date.now(),
		status: "betting", // betting | flying | crashed | payout
		phase_ends_at: Date.now() + phaseDurations.bettingMs,
		minBet,
		maxBet,
		fakeMoney,
		settings: {
			phaseDurations,
		},
		crashPoint: 1.0,
		currentMultiplier: 1.0,
		history: [],
		players: {}, // userId -> { id, globalName, avatar, bank, inRound, betAmount: 50, autoCashout: 2.00, cashedOut: false, winAmount: 0 }
		leavingAfterRound: {},
	};
}

/**
 * Resets the room and player data for a new round.
 * @param {object} room - The room to reset.
 */
export function resetForNewRound(room) {
	room.status = "betting";
	room.crashPoint = generateCrashPoint();
	room.currentMultiplier = 1.0;
	room.leavingAfterRound = {};

	for (const p of Object.values(room.players)) {
		p.inRound = false;
		p.betAmount = 0;
		p.autoCashout = null;
		p.cashedOut = false;
		p.winAmount = 0;
	}
}

/**
 * Adds a bet to a player if they have enough balance.
 * The player can optionally define an auto-cashout multiplier.
 * @returns {object} The updated player object.
 */
export function placeBet(room, playerId, amount, autoCashout = null) {
	if (room.status !== "betting") {
		throw new Error("Bets are closed.");
	}
	const player = room.players[playerId];
	if (!player) {
		throw new Error("Player not found.");
	}
	if (amount < room.minBet || amount > room.maxBet) {
		throw new Error(`The amount needs to be between ${room.minBet} and ${room.maxBet}.`);
	}
	if (player.bank < amount) {
		throw new Error("No bank found.");
	}

	if (autoCashout !== null && autoCashout <= 1.0) {
		throw new Error("Auto-cashout must be greater than 1.00x");
	}

	player.bank -= amount;
	player.betAmount = amount;
	player.autoCashout = autoCashout;
	player.cashedOut = false;
	player.winAmount = 0;

	player.inRound = true;
	player.totalBets = (player.totalBets || 0) + 1;

	return player;
}

/**
 * Allows a player to cash out while the plane is flying.
 * Call this when the player clicks the "Cashout" button on Discord.
 * @param {object} room - The active room.
 * @param {string} playerId - The player ID.
 * @param {number} currentMultiplayer - The multiplier at the exact moment of the click.
 * @returns {object} The updated player object.
 */
export function cashOut(room, playerId, currentMultiplayer) {
	if (room.status !== "flying") {
		throw new Error("The plane is not flying right now.");
	}

	const player = room.players[playerId];
	if (!player || !player.inRound) {
		throw new Error("You are not in this round.");
	}

	if (player.cashedOut) {
		throw new Error("You have already cashed out!");
	}

	// Security check in case the plane already crashed (API latency)
	if (currentMultiplayer >= room.crashPoint) {
		throw new Error("Too late, the plane has crashed!");
	}

	// The player successfully cashed out
	player.cashedOut = true;
	player.winAmount = Math.floor(player.betAmount * currentMultiplayer);

	return player;
}

/**
 * Processes auto-cashouts for all players during the flight.
 * Needs to be called inside your game loop when room.status === "flying".
 * @param {object} room - The active room.
 * @returns {Array} List of players who just auto-cashed out.
 */
export function processAutoCashouts(room) {
	const cashedOutPlayers = [];
	if (room.status !== "flying") return cashedOutPlayers;

	for (const p of Object.values(room.players)) {
		if (p.inRound && !p.cashedOut && p.autoCashout !== null && room.currentMultiplier >= p.autoCashout) {
			p.cashedOut = true;
			p.winAmount = Math.floor(p.betAmount * p.autoCashout);
			cashedOutPlayers.push(p);
		}
	}
	return cashedOutPlayers;
}

/**
 * Settles all bets after the crash, updates user balances and logs results.
 * @param {object} room - The room to settle.
 * @returns {object} The results mapped by player ID.
 */
export async function settleAll(room) {
	const allRes = {};

	// Add the result to the room history
	room.history.push(room.crashPoint);
	if (room.history.length > 10) room.history.shift(); // Keep the last 10

	for (const p of Object.values(room.players)) {
		if (!p.inRound) continue;

		let totalReturn = 0;
		let roundDelta = 0;
		let isWin = false;

		// Security failsafe: auto-cashout check in case the game loop missed the exact tick
		if (!p.cashedOut && p.autoCashout !== null && room.crashPoint >= p.autoCashout) {
			p.cashedOut = true;
			p.winAmount = Math.floor(p.betAmount * p.autoCashout);
		}

		if (p.cashedOut) {
			isWin = true;
			totalReturn = p.winAmount;
			roundDelta = totalReturn - p.betAmount;
		} else {
			isWin = false;
			totalReturn = 0;
			roundDelta = -p.betAmount;
		}

		p.totalDelta = (p.totalDelta || 0) + roundDelta;
		allRes[p.id] = { betAmount: p.betAmount, winAmount: p.winAmount, isWin, delta: roundDelta };

		// Database payout
		if (totalReturn > 0) {
			const userDB = await userService.getUser(p.id);
			if (userDB) {
				const newBalance = userDB.coins + totalReturn;
				try {
					await userService.updateUserCoins(p.id, newBalance);
					await logService.insertLog({
						id: `${p.id}-crash-${Date.now()}`,
						userId: p.id,
						targetUserId: null,
						action: "CRASH_PAYOUT",
						coinsAmount: totalReturn,
						userNewAmount: newBalance,
					});
					p.bank = newBalance;
				} catch (e) {
					console.log(`[${Date.now()}]`, e);
				}
			}
		}

		// Update the Discord Embed for this player
		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.BOT_CHANNEL_ID);
			if (p.msgId && generalChannel) {
				const msg = await generalChannel.messages.fetch(p.msgId);
				const updatedEmbed = new EmbedBuilder()
					.setDescription(`<@${p.id}> joue au Crash 🛩️.`)
					.addFields(
						{
							name: `Gains`,
							value: `**${p.totalDelta >= 0 ? "+" + p.totalDelta : p.totalDelta}** Flopos`,
							inline: true,
						},
						{
							name: `Mises jouées`,
							value: `**${p.totalBets}**`,
							inline: true,
						})
					.setColor(p.totalDelta >= 0 ? 0x22a55b : 0xed4245)
					.setTimestamp(new Date());
				await msg.edit({ embeds: [updatedEmbed], components: [] });
			}
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
		}
	}

	return allRes;
}
