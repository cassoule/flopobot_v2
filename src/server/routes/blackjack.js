// /routes/blackjack.js
import express from "express";
import {
	applyAction,
	autoActions,
	createBlackjackRoom,
	dealerShouldHit,
	dealInitial,
	draw,
	everyoneDone,
	handValue,
	publicPlayerView,
	settleAll,
	startBetting,
} from "../../game/blackjack.js";

// Optional: hook into your DB & Discord systems if available
import { getUser, insertLog, updateUserCoins } from "../../database/index.js";
import { client } from "../../bot/client.js";
import { emitToast, emitUpdate, emitPlayerUpdate } from "../socket.js";
import { EmbedBuilder, time } from "discord.js";

export function blackjackRoutes(io) {
	const router = express.Router();

	// --- Singleton continuous room ---
	const room = createBlackjackRoom({
		minBet: 10,
		maxBet: 10000,
		fakeMoney: false,
		decks: 6,
		hitSoft17: false, // S17 (dealer stands on soft 17) if false
		blackjackPayout: 1.5, // 3:2
		cutCardRatio: 0.25,
		phaseDurations: {
			bettingMs: 10000,
			dealMs: 2000,
			playMsPerPlayer: 20000,
			revealMs: 1000,
			payoutMs: 7000,
		},
		animation: { dealerDrawMs: 1000 },
	});

	const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
	let animatingDealer = false;

	async function runDealerAnimation() {
		if (animatingDealer) return;
		animatingDealer = true;

		room.status = "dealer";
		room.dealer.holeHidden = false;
		await sleep(room.settings.phaseDurations.revealMs ?? 1000);
		room.phase_ends_at = Date.now() + (room.settings.phaseDurations.revealMs ?? 1000);
		emitUpdate("dealer-reveal", snapshot(room));
		await sleep(room.settings.phaseDurations.revealMs ?? 1000);

		while (dealerShouldHit(room.dealer.cards, room.settings.hitSoft17)) {
			room.dealer.cards.push(draw(room.shoe));
			room.phase_ends_at = Date.now() + (room.settings.animation?.dealerDrawMs ?? 500);
			emitUpdate("dealer-hit", snapshot(room));
			await sleep(room.settings.animation?.dealerDrawMs ?? 500);
		}

		settleAll(room);
		room.status = "payout";
		room.phase_ends_at = Date.now() + (room.settings.phaseDurations.payoutMs ?? 10000);
		emitUpdate("payout", snapshot(room));

		animatingDealer = false;
	}

	function autoTimeoutAFK(now) {
		if (room.status !== "playing") return false;
		if (!room.phase_ends_at || now < room.phase_ends_at) return false;

		let changed = false;
		for (const p of Object.values(room.players)) {
			try {
				if (!p.inRound) continue;
				const h = p.hands[p.activeHand];
				if (h && !h.hasActed && !h.busted && !h.stood && !h.surrendered) {
					h.surrendered = true;
					h.stood = true;
					h.hasActed = true;
					//room.leavingAfterRound[p.id] = true; // kick at end of round
					emitToast({ type: "player-timeout", userId: p.id });
					changed = true;
				} else if (h && h.hasActed && !h.stood) {
					h.stood = true;
					//room.leavingAfterRound[p.id] = true; // kick at end of round
					emitToast({ type: "player-auto-stand", userId: p.id });
					changed = true;
				}
			} catch (e) {
				console.log(e);
			}
		}
		if (changed) emitUpdate("auto-surrender", snapshot(room));
		return changed;
	}

	function snapshot(r) {
		return {
			id: r.id,
			name: r.name,
			status: r.status,
			phase_ends_at: r.phase_ends_at,
			minBet: r.minBet,
			maxBet: r.maxBet,
			settings: r.settings,
			dealer: {
				cards: r.dealer.holeHidden ? [r.dealer.cards[0], "XX"] : r.dealer.cards,
				total: r.dealer.holeHidden ? null : handValue(r.dealer.cards).total,
			},
			players: Object.values(r.players).map(publicPlayerView),
			shoeCount: r.shoe.length,
		};
	}

	// --- Public endpoints ---
	router.get("/", (req, res) => res.status(200).json({ room: snapshot(room) }));

	router.post("/join", async (req, res) => {
		const { userId } = req.body;
		if (!userId) return res.status(400).json({ message: "userId required" });
		if (room.players[userId]) return res.status(200).json({ message: "Already here" });

		const user = await client.users.fetch(userId);
		const bank = getUser.get(userId)?.coins ?? 0;

		room.players[userId] = {
			id: userId,
			globalName: user.globalName || user.username,
			avatar: user.displayAvatarURL({ dynamic: true, size: 256 }),
			bank,
			currentBet: 0,
			inRound: false,
			hands: [
				{
					cards: [],
					stood: false,
					busted: false,
					doubled: false,
					surrendered: false,
					hasActed: false,
					bet: 0,
				},
			],
			activeHand: 0,
			joined_at: Date.now(),
			msgId: null,
			totalDelta: 0,
			totalBets: 0,
		};

		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.BOT_CHANNEL_ID);
			const embed = new EmbedBuilder()
				.setDescription(`<@${userId}> joue au Blackjack`)
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
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
		}

		emitUpdate("player-joined", snapshot(room));
		emitPlayerUpdate({ id: userId, msg: `${user?.globalName || user?.username} a rejoint la table de Blackjack.`, timestamp: Date.now() });
		return res.status(200).json({ message: "joined" });
	});

	router.post("/leave", async (req, res) => {
		const { userId } = req.body;
		if (!userId || !room.players[userId]) return res.status(403).json({ message: "not in room" });

		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.BOT_CHANNEL_ID);
			const msg = await generalChannel.messages.fetch(room.players[userId].msgId);
			const updatedEmbed = new EmbedBuilder()
				.setDescription(`<@${userId}> a quitté la table de Blackjack.`)
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
				.setColor(room.players[userId].totalDelta >= 0 ? 0x22a55b : 0xed4245)
				.setTimestamp(new Date());
			await msg.edit({ embeds: [updatedEmbed], components: [] });
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
		}

		const p = room.players[userId];
		if (p?.inRound) {
			// leave after round to avoid abandoning an active bet
			room.leavingAfterRound[userId] = true;
			return res.status(200).json({ message: "will-leave-after-round" });
		} else {
			delete room.players[userId];
			emitUpdate("player-left", snapshot(room));
			const user = await client.users.fetch(userId);
			emitPlayerUpdate({ id: userId, msg: `${user?.globalName || user?.username} a quitté la table de Blackjack.`, timestamp: Date.now() });
			return res.status(200).json({ message: "left" });
		}
	});

	router.post("/bet", (req, res) => {
		const { userId, amount } = req.body;
		const p = room.players[userId];
		if (!p) return res.status(404).json({ message: "not in room" });
		if (room.status !== "betting") return res.status(403).json({ message: "betting-closed" });

		const bet = Math.floor(Number(amount) || 0);
		if (bet < room.minBet || bet > room.maxBet) return res.status(400).json({ message: "invalid-bet" });

		if (!room.settings.fakeMoney) {
			const userDB = getUser.get(userId);
			const coins = userDB?.coins ?? 0;
			if (coins < bet) return res.status(403).json({ message: "insufficient-funds" });
			updateUserCoins.run({ id: userId, coins: coins - bet });
			insertLog.run({
				id: `${userId}-blackjack-${Date.now()}`,
				user_id: userId,
				target_user_id: null,
				action: "BLACKJACK_BET",
				coins_amount: -bet,
				user_new_amount: coins - bet,
			});
			p.bank = coins - bet;
		}

		p.currentBet = bet;
		p.hands[p.activeHand].bet = bet;
		emitToast({ type: "player-bet", userId, amount: bet });
		emitUpdate("bet-placed", snapshot(room));
		return res.status(200).json({ message: "bet-accepted" });
	});

	router.post("/action/:action", (req, res) => {
		const { userId } = req.body;
		const action = req.params.action;
		const p = room.players[userId];
		if (!p) return res.status(404).json({ message: "not in room" });
		if (!p.inRound || room.status !== "playing") return res.status(403).json({ message: "not-your-turn" });

		// Handle extra coin lock for double
		if (action === "double" && !room.settings.fakeMoney) {
			const userDB = getUser.get(userId);
			const coins = userDB?.coins ?? 0;
			const hand = p.hands[p.activeHand];
			if (coins < hand.bet) return res.status(403).json({ message: "insufficient-funds-for-double" });
			updateUserCoins.run({ id: userId, coins: coins - hand.bet });
			insertLog.run({
				id: `${userId}-blackjack-${Date.now()}`,
				user_id: userId,
				target_user_id: null,
				action: "BLACKJACK_DOUBLE",
				coins_amount: -hand.bet,
				user_new_amount: coins - hand.bet,
			});
			p.bank = coins - hand.bet;
			// effective bet size is handled in settlement via hand.doubled flag
		}

		if (action === "split" && !room.settings.fakeMoney) {
			const userDB = getUser.get(userId);
			const coins = userDB?.coins ?? 0;
			const hand = p.hands[p.activeHand];
			if (coins < hand.bet) return res.status(403).json({ message: "insufficient-funds-for-split" });
			updateUserCoins.run({ id: userId, coins: coins - hand.bet });
			insertLog.run({
				id: `${userId}-blackjack-${Date.now()}`,
				user_id: userId,
				target_user_id: null,
				action: "BLACKJACK_SPLIT",
				coins_amount: -hand.bet,
				user_new_amount: coins - hand.bet,
			});
			p.bank = coins - hand.bet;
			// effective bet size is handled in settlement via hand.doubled flag
		}

		try {
			const evt = applyAction(room, userId, action);
			emitToast({ type: `player-${evt}`, userId });
			emitUpdate("player-action", snapshot(room));
			return res.status(200).json({ message: "ok" });
		} catch (e) {
			return res.status(400).json({ message: e.message });
		}
	});

	// --- Game loop ---
	// Simple phase machine that runs regardless of player count.
	setInterval(async () => {
		const now = Date.now();

		if (room.status === "betting" && now >= room.phase_ends_at) {
			const hasBets = Object.values(room.players).some((p) => p.currentBet >= room.minBet);
			if (!hasBets) {
				// Extend betting window if no one bet
				room.phase_ends_at = now + room.settings.phaseDurations.bettingMs;
				emitUpdate("betting-extend", snapshot(room));
				return;
			}
			dealInitial(room);
			autoActions(room);
			emitUpdate("initial-deal", snapshot(room));

			room.phase_ends_at = Date.now() + room.settings.phaseDurations.playMsPerPlayer;
			emitUpdate("playing-start", snapshot(room));
			return;
		}

		if (room.status === "playing") {
			// If the per-round playing timer expired, auto-surrender AFKs (you already added this)
			if (room.phase_ends_at && now >= room.phase_ends_at) {
				autoTimeoutAFK(now);
			}

			// Everyone acted before the timer? Cut short and go straight to dealer.
			if (everyoneDone(room) && !animatingDealer) {
				// Set a new server-driven deadline for the reveal pause,
				// so the client's countdown immediately reflects the phase change.
				room.phase_ends_at = Date.now();
				emitUpdate("playing-cut-short", snapshot(room));

				// Now run the animated dealer with per-step updates
				runDealerAnimation();
			}
		}

		if (room.status === "payout" && now >= room.phase_ends_at) {
			// Remove leavers
			for (const userId of Object.keys(room.leavingAfterRound)) {
				delete room.players[userId];
				const user = await client.users.fetch(userId);
				emitPlayerUpdate({ id: userId, msg: `${user?.globalName || user?.username} a quitté la table de Blackjack.`, timestamp: Date.now() });
			}
			// Prepare next round
			startBetting(room, now);
			emitUpdate("new-round", snapshot(room));
		}
	}, 100);

	return router;
}
