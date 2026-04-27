import * as userService from "../services/user.service.js";
import * as logService from "../services/log.service.js";
import { client } from "../bot/client.js";
import { EmbedBuilder } from "discord.js";

/**
 * Rules and payouts for each Sic Bo bet type.
 */
const SICBO = {
	big: {
		payout: 1,
		checkWin: (dice) => {
			const sum = dice[0] + dice[1] + dice[2];
			const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
			return sum >= 11 && sum <= 17 && !isTriple;
		},
	},
	small: {
		payout: 1,
		checkWin: (dice) => {
			const sum = dice[0] + dice[1] + dice[2];
			const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
			return sum >= 4 && sum <= 10 && !isTriple;
		},
	},
	even: {
		payout: 1,
		checkWin: (dice) => {
			const sum = dice[0] + dice[1] + dice[2];
			const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
			return sum % 2 === 0 && !isTriple;
		},
	},
	odd: {
		payout: 1,
		checkWin: (dice) => {
			const sum = dice[0] + dice[1] + dice[2];
			const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
			return sum % 2 !== 0 && !isTriple;
		},
	},
	any_triple: {
		payout: 30,
		checkWin: (dice) => {
			return dice[0] === dice[1] && dice[1] === dice[2];
		},
	},
	triple_1: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 1),
	},
	triple_2: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 2),
	},
	triple_3: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 3),
	},
	triple_4: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 4),
	},
	triple_5: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 5),
	},
	triple_6: {
		payout: 180,
		checkWin: (dice) => dice.every((d) => d === 6),
	},
	double_1: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 1).length >= 2,
	},
	double_2: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 2).length >= 2,
	},
	double_3: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 3).length >= 2,
	},
	double_4: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 4).length >= 2,
	},
	double_5: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 5).length >= 2,
	},
	double_6: {
		payout: 10,
		checkWin: (dice) => dice.filter((d) => d === 6).length >= 2,
	},
	total_4: {
		payout: 50,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 4,
	},
	total_5: {
		payout: 18,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 5,
	},
	total_6: {
		payout: 14,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 6,
	},
	total_7: {
		payout: 12,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 7,
	},
	total_8: {
		payout: 8,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 8,
	},
	total_9: {
		payout: 6,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 9,
	},
	total_10: {
		payout: 6,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 10,
	},
	total_11: {
		payout: 6,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 11,
	},
	total_12: {
		payout: 6,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 12,
	},
	total_13: {
		payout: 8,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 13,
	},
	total_14: {
		payout: 12,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 14,
	},
	total_15: {
		payout: 14,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 15,
	},
	total_16: {
		payout: 18,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 16,
	},
	total_17: {
		payout: 50,
		checkWin: (dice) => dice[0] + dice[1] + dice[2] === 17,
	},
	single_1: {
		payout: 1,
		checkWin: (dice) => dice.includes(1),
	},
	single_2: {
		payout: 1,
		checkWin: (dice) => dice.includes(2),
	},
	single_3: {
		payout: 1,
		checkWin: (dice) => dice.includes(3),
	},
	single_4: {
		payout: 1,
		checkWin: (dice) => dice.includes(4),
	},
	single_5: {
		payout: 1,
		checkWin: (dice) => dice.includes(5),
	},
	single_6: {
		payout: 1,
		checkWin: (dice) => dice.includes(6),
	},
};

/**
 * Returns an array of 3 dice values.
 * @returns {number[]} The array of dice values.
 */
export function rollDice() {
	return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

/**
 * Creates a new room object with default settings.
 * @returns {object} The room object.
 */
export function createSicboRoom({
	minBet = 10,
	maxBet = 10000,
	fakeMoney = false,
	phaseDurations = {
		bettingMs: 20000,
		rollingMs: 6000,
		payoutMs: 10000,
	},
	animation = {
		diceRollMs: 3000,
	},
} = {}) {
	return {
		id: "sicbo-room",
		name: "Sic-Bo",
		created_at: Date.now(),
		status: "betting", // betting | rolling | payout
		phase_ends_at: Date.now() + phaseDurations.bettingMs,
		minBet,
		maxBet,
		fakeMoney,
		settings: {
			phaseDurations,
			animation,
		},
		dice: [],
		history: [],
		players: {}, // userId -> { id, globalName, avatar, bank, inRound, bets: [{ type: "big", amount: 50 }], totalBetAmount: 0 }
		leavingAfterRound: {},
	};
}

/**
 * Resets the room and player data for a new round.
 * @param {object} room - The room to reset.
 */
export function resetForNewRound(room) {
	room.status = "betting";
	room.dice = [];
	room.leavingAfterRound = {};
	for (const p of Object.values(room.players)) {
		p.inRound = false;
		p.currentBet = 0;
		p.totalBetAmount = 0;
		p.bets = [];
	}
}

/**
 * Adds a bet to a player's list if they have enough balance.
 * @returns {object} The updated player object.
 */
export function placeBet(room, playerId, betType, amount) {
	if (room.status !== "betting") {
		throw new Error("Bets are close");
	}
	const player = room.players[playerId];
	if (!player) {
		throw new Error("Player not found.");
	}
	if (!SICBO[betType]) {
		throw new Error("Bet type is missing");
	}
	if (amount < room.minBet || amount > room.maxBet) {
		throw new Error(`The amount need to be between ${room.minBet} and ${room.maxBet}`);
	}
	if (player.bank < amount) {
		throw new Error("No bank found.");
	}

	player.bank -= amount;

	player.bets.push({
		type: betType,
		amount: amount,
	});

	player.inRound = true;
	player.totalBets = (player.totalBets || 0) + 1;

	return player;
}

/**
 * Settles all bets, updates user balances and logs results.
 * @param {object} room - The room to settle.
 * @returns {object} The results mapped by player ID.
 */
export async function settleAll(room) {
	const allRes = {};

	for (const p of Object.values(room.players)) {
		if (!p.inRound) continue;

		let totalReturn = 0;
		let roundDelta = 0;
		const playerResults = [];

		for (const bet of p.bets) {
			const rule = SICBO[bet.type];

			let delta = 0;
			const isWin = rule.checkWin(room.dice);
			if (isWin) {
				delta = bet.amount * rule.payout;
				totalReturn += bet.amount + delta;
			} else {
				delta = -bet.amount;
			}

			roundDelta += delta;
			playerResults.push({ type: bet.type, amount: bet.amount, isWin, delta });
		}

		p.totalDelta = (p.totalDelta || 0) + roundDelta;
		allRes[p.id] = playerResults;

		if (totalReturn > 0) {
			const userDB = await userService.getUser(p.id);
			if (userDB) {
				const newBalance = userDB.coins + totalReturn;
				try {
					await userService.updateUserCoins(p.id, newBalance);
					await logService.insertLog({
						id: `${p.id}-sicbo-${Date.now()}`,
						userId: p.id,
						targetUserId: null,
						action: "SICBO_PAYOUT",
						coinsAmount: totalReturn,
						userNewAmount: newBalance,
					});
					p.bank = newBalance;
				} catch (e) {
					console.log(`[${Date.now()}]`, e);
				}
			}
		}

		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.BOT_CHANNEL_ID);
			if (p.msgId && generalChannel) {
				const msg = await generalChannel.messages.fetch(p.msgId);
				const updatedEmbed = new EmbedBuilder()
					.setDescription(`<@${p.id}> joue au Sic Bo 🎲.`)
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
						},
					)
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
