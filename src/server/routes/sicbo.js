import express from "express";
import { createSicboRoom, rollDice, resetForNewRound, placeBet, settleAll } from "../../game/sicbo.js";

import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import { client } from "../../bot/client.js";
import { emitToast, emitUpdate, emitPlayerUpdate } from "../socket.js";
import { EmbedBuilder } from "discord.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveUser } from "../../utils/index.js";


/**
 * Sets up the Sic Bo Express router and game logic loop.
 */
export function sicboRoutes(io) {
	const router = express.Router();

	const room = createSicboRoom();
	console.log(`[SicBo] Room initialized with ID: ${room.id}`);

	function snapshot(r) {
		return {
			id: r.id,
			name: r.name,
			status: r.status,
			phase_ends_at: r.phase_ends_at,
			minBet: r.minBet,
			maxBet: r.maxBet,
			dice: r.status === "rolling" || r.status === "payout" ? r.dice : [],
			history: r.history,
			players: Object.values(r.players).map((p) => ({
				id: p.id,
				username: p.username,
				avatar: p.avatar,
				bank: p.bank,
				bets: p.bets,
				totalBetAmount: p.totalBetAmount,
				inRound: p.inRound,
			})),
		};
	}

	router.get("/", (req, res) => {
		res.status(200).json({ room: snapshot(room) });
	});

	router.post("/join", requireAuth, async (req, res) => {
		const userId = req.userId;

		if (room.players[userId]) {
			return res.status(200).json({ message: "Already here" });
		}

		const user = await resolveUser(client, userId);
		const bank = (await userService.getUser(userId))?.coins ?? 0;

		room.players[userId] = {
			id: userId,
			username: user.username,
			globalName: user.globalName || user.username,
			avatar: user.displayAvatarURL({ dynamic: true, size: 256 }),
			bank,
			inRound: false,
			bets: [],
			totalBetAmount: 0,
			joined_at: Date.now(),
			msgId: null,
			totalDelta: 0,
			totalBets: 0,
		};

		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.BOT_CHANNEL_ID);

			if (generalChannel) {
				const embed = new EmbedBuilder()
					.setDescription(`<@${userId}> joue au Sic Bo 🎲`)
					.addFields(
						{
							name: `Gains`,
							value: `**${room.players[userId].totalDelta >= 0 ? "+" + room.players[userId].totalDelta : room.players[userId].totalDelta}** Flopos`,
							inline: true,
						},
						{
							name: `Mises jouées`,
							value: `**${room.players[userId].totalBets}**`,
							inline: true,
						},
					)
					.setColor("#5865f2")
					.setTimestamp(new Date());

				const msg = await generalChannel.send({ embeds: [embed] });
				room.players[userId].msgId = msg.id;
			} else {
				console.log(`[SicBo] JOIN WARNING - Discord channel not found for User ${userId}`);
			}
		} catch (e) {
			console.error(`[SicBo] JOIN ERROR - Discord message failed for User ${userId}:`, e);
		}

		emitUpdate("sicbo-player-joined", snapshot(room));
		return res.status(200).json({ message: "joined" });
	});

	router.post("/leave", requireAuth, async (req, res) => {
		const userId = req.userId;
		const p = room.players[userId];

		if (!p) {
			return res.status(403).json({ message: "not in room" });
		}

		if (p.inRound && room.status !== "betting") {
			room.leavingAfterRound[userId] = true;
			return res.status(200).json({ message: "will-leave-after-round" });
		} else {
			delete room.players[userId];
			emitUpdate("sicbo-player-left", snapshot(room));

			try {
				const guild = client.guilds.cache.get(process.env.GUILD_ID);
				const generalChannel = guild.channels.cache.get(process.env.BOT_CHANNEL_ID);

				if (p.msgId && generalChannel) {
					const msg = await generalChannel.messages.fetch(p.msgId);
					const updatedEmbed = new EmbedBuilder()
						.setDescription(`<@${userId}> a quitté le Sic Bo 🎲.`)
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
				console.error(`[SicBo] LEAVE ERROR - Discord message update failed for User ${userId}:`, e);
			}

			return res.status(200).json({ message: "left" });
		}
	});

	router.post("/bet", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { betType, amount } = req.body;

		const p = room.players[userId];
		if (!p) {
			return res.status(404).json({ message: "not in room" });
		}

		const bet = Math.floor(Number(amount) || 0);

		try {
			if (!room.settings.fakeMoney) {
				const userDB = await userService.getUser(userId);
				const coins = userDB?.coins ?? 0;

				if (coins < bet) {
					return res.status(403).json({ message: "insufficient-funds" });
				}

				await userService.updateUserCoins(userId, coins - bet);
				await logService.insertLog({
					id: `${userId}-sicbo-bet-${Date.now()}`,
					userId: userId,
					targetUserId: null,
					action: "SICBO_BET",
					coinsAmount: -bet,
					userNewAmount: coins - bet,
				});
			}

			placeBet(room, userId, betType, bet);

			emitToast({ type: "player-bet", userId, amount: bet, betType });
			emitUpdate("sicbo-bet-placed", snapshot(room));

			return res.status(200).json({ message: "bet-accepted" });
		} catch (e) {
			console.error(`[SicBo] BET ERROR - User ${userId}:`, e.message);
			return res.status(400).json({ message: e.message });
		}
	});

	setInterval(async () => {
		const now = Date.now();

		if (room.status === "betting" && now >= room.phase_ends_at) {
			const hasBets = Object.values(room.players).some((p) => p.inRound);

			if (!hasBets) {
				room.phase_ends_at = now + room.settings.phaseDurations.bettingMs;
				emitUpdate("sicbo-update", snapshot(room));
				return;
			}

			room.status = "rolling";
			room.dice = rollDice();
			console.log(`[SicBo] Les dés sont jetés : ${room.dice.join(" - ")}`);

			room.phase_ends_at = now + room.settings.phaseDurations.rollingMs;
			emitUpdate("sicbo-rolling", snapshot(room));
			return;
		}

		if (room.status === "rolling" && now >= room.phase_ends_at) {
			await settleAll(room);

			room.history.unshift([...room.dice]);
			if (room.history.length > 10) room.history.pop();

			room.status = "payout";
			room.phase_ends_at = now + room.settings.phaseDurations.payoutMs;

			emitUpdate("sicbo-payout", snapshot(room));
			return;
		}

		if (room.status === "payout" && now >= room.phase_ends_at) {
			for (const userId of Object.keys(room.leavingAfterRound)) {
				delete room.players[userId];
			}

			resetForNewRound(room);
			room.phase_ends_at = Date.now() + room.settings.phaseDurations.bettingMs;

			emitUpdate("sicbo-new-round", snapshot(room));
		}
	}, 100);

	return router;
}
