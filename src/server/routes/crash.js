import express from "express";
import * as userService from "../../services/user.service.js";
import * as logService from "../../services/log.service.js";
import { client } from "../../bot/client.js";
import { emitCrashUpdate, emitCrashToast } from "../socket.js";
import { EmbedBuilder } from "discord.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveUser } from "../../utils/index.js";
import { createCrashRoom, placeBet, cashOut, settleAll, resetForNewRound } from "../../game/crash.js";

// --- EXPRESS ROUTES & GAME LOOP ---

export function crashRoutes(io) {
	const router = express.Router();
	const room = createCrashRoom();
	let isProcessing = false;

	function snapshot(r) {
		return {
			id: r.id,
			name: r.name,
			status: r.status,
			phase_ends_at: r.phase_ends_at,
			flight_started_at: r.flight_started_at,
			minBet: r.minBet,
			maxBet: r.maxBet,
			crashPoint: r.status === "payout" || r.status === "crashed" ? r.crashPoint : null,
			currentMultiplier: r.currentMultiplier,
			history: r.history,
			players: Object.values(r.players).map((p) => ({
				id: p.id,
				username: p.username,
				avatar: p.avatar,
				bank: p.bank,
				betAmount: p.betAmount,
				autoCashout: p.autoCashout,
				cashedOut: p.cashedOut,
				winAmount: p.winAmount,
				inRound: p.inRound,
			})),
		};
	}

	router.get("/", (req, res) => {
		res.status(200).json({ room: snapshot(room) });
	});

	router.post("/join", requireAuth, async (req, res) => {
		const userId = req.userId;
		if (room.players[userId]) return res.status(200).json({ message: "Already here" });

		const user = await resolveUser(client, userId);
		const bank = (await userService.getUser(userId))?.coins ?? 0;

		room.players[userId] = {
			id: userId,
			username: user.username,
			globalName: user.globalName || user.username,
			avatar: user.displayAvatarURL({ dynamic: true, size: 256 }),
			bank,
			inRound: false,
			betAmount: 0,
			autoCashout: null,
			cashedOut: false,
			winAmount: 0,
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
					.setDescription(`<@${userId}> joue au Crash 🛩️`)
					.addFields(
						{ name: `Gains`, value: `**0** Flopos`, inline: true },
						{ name: `Mises jouées`, value: `**0**`, inline: true },
					)
					.setColor("#5865f2")
					.setTimestamp(new Date());

				const msg = await generalChannel.send({ embeds: [embed] });
				room.players[userId].msgId = msg.id;
			}
		} catch (e) {}

		emitCrashUpdate("crash-player-joined", snapshot(room));
		return res.status(200).json({ message: "joined" });
	});

	router.post("/leave", requireAuth, async (req, res) => {
		const userId = req.userId;
		const p = room.players[userId];
		if (!p) return res.status(403).json({ message: "not in room" });

		if (p.inRound && room.status !== "betting") {
			room.leavingAfterRound[userId] = true;
			return res.status(200).json({ message: "will-leave-after-round" });
		} else {
			delete room.players[userId];
			emitCrashUpdate("crash-player-left", snapshot(room));
			return res.status(200).json({ message: "left" });
		}
	});

	router.post("/bet", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { amount, autoCashout } = req.body;
		const p = room.players[userId];
		if (!p) return res.status(404).json({ message: "not in room" });

		const bet = Math.floor(Number(amount) || 0);
		const cashoutVal = autoCashout ? Number(autoCashout) : null;

		try {
			if (!room.settings.fakeMoney) {
				const userDB = await userService.getUser(userId);
				const coins = userDB?.coins ?? 0;
				if (coins < bet) return res.status(403).json({ message: "insufficient-funds" });

				await userService.updateUserCoins(userId, coins - bet);
				await logService.insertLog({
					id: `${userId}-crash-bet-${Date.now()}`,
					userId,
					targetUserId: null,
					action: "CRASH_BET",
					coinsAmount: -bet,
					userNewAmount: coins - bet,
				});
			}

			placeBet(room, userId, bet, cashoutVal);
			emitCrashToast({ type: "player-bet", userId, amount: bet, autoCashout: cashoutVal });
			emitCrashUpdate("crash-bet-placed", snapshot(room));

			return res.status(200).json({ message: "bet-accepted" });
		} catch (e) {
			return res.status(400).json({ message: e.message });
		}
	});

	router.post("/cashout", requireAuth, async (req, res) => {
		const userId = req.userId;
		try {
			const player = cashOut(room, userId, room.currentMultiplier);
			emitCrashToast({
				type: "player-cashed-out",
				userId,
				multiplier: room.currentMultiplier,
				winAmount: player.winAmount,
			});
			emitCrashUpdate("crash-player-cashed-out", snapshot(room));
			return res.status(200).json({ message: "cashed-out", winAmount: player.winAmount });
		} catch (e) {
			return res.status(400).json({ message: e.message });
		}
	});

	setInterval(async () => {
		const now = Date.now();

		if (room.status === "betting" && now >= room.phase_ends_at) {

			room.status = "flying";
			room.flight_started_at = now;
			room.currentMultiplier = 1.0;
			emitCrashUpdate("crash-flying", snapshot(room));
			return;
		}

		if (room.status === "flying") {
			const elapsedMs = now - room.flight_started_at;
			const calculatedMultiplier = Math.pow(Math.E, (elapsedMs / 1000) * 0.08);
			room.currentMultiplier = Number(Math.max(1.0, calculatedMultiplier).toFixed(2));

			if (room.currentMultiplier >= room.crashPoint) {
				room.currentMultiplier = room.crashPoint;
				room.status = "crashed";

				if (isProcessing) return;
				isProcessing = true;

				try {
					const allRes = await settleAll(room);
					room.status = "payout";
					room.phase_ends_at = now + room.settings.phaseDurations.payoutMs;
					emitCrashUpdate("crash-crashed", { room: snapshot(room), allRes });
				} finally {
					isProcessing = false;
				}
			} else {
				let someoneCashedOut = false;

				for (const p of Object.values(room.players)) {
					if (p.inRound && !p.cashedOut && p.autoCashout !== null && room.currentMultiplier >= p.autoCashout) {
						p.cashedOut = true;
						p.winAmount = Math.floor(p.betAmount * p.autoCashout);

						emitCrashToast({
							type: "player-cashed-out",
							userId: p.id,
							multiplier: p.autoCashout,
							winAmount: p.winAmount,
						});
						someoneCashedOut = true;
					}
				}

				if (someoneCashedOut) {
					emitCrashUpdate("crash-update", snapshot(room));
				}

				emitCrashUpdate("crash-tick", { currentMultiplier: room.currentMultiplier });
			}
		}

		if (room.status === "payout" && now >= room.phase_ends_at) {
			for (const userId of Object.keys(room.leavingAfterRound)) {
				delete room.players[userId];
			}
			resetForNewRound(room);
			room.phase_ends_at = Date.now() + room.settings.phaseDurations.bettingMs;
			emitCrashUpdate("crash-new-round", snapshot(room));
		}
	}, 100);

	return router;
}
