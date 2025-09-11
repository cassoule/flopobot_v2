// /routes/blackjack.js
import express from "express";
import { createBlackjackRoom, startBetting, dealInitial, autoActions, everyoneDone, dealerPlay, settleAll, applyAction, publicPlayerView, handValue } from "../../game/blackjack.js";

// Optional: hook into your DB & Discord systems if available
import { getUser, updateUserCoins, insertLog } from "../../database/index.js";
import { client } from "../../bot/client.js";
import {emitToast, emitUpdate} from "../socket.js";

export function blackjackRoutes(io) {
  const router = express.Router();

  // --- Singleton continuous room ---
  const room = createBlackjackRoom({
    minBet: 10,
    maxBet: 5000,
    fakeMoney: false,
    decks: 6,
    hitSoft17: false,      // S17 (dealer stands on soft 17) if false
    blackjackPayout: 1.5,  // 3:2
    cutCardRatio: 0.25,
    phaseDurations: { bettingMs: 15000, dealMs: 1000, playMsPerPlayer: 15000, revealMs: 1000, payoutMs: 2000 },
  });

  function snapshot(r) {
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      phase_ends_at: r.phase_ends_at,
      minBet: r.minBet,
      maxBet: r.maxBet,
      settings: r.settings,
      dealer: { cards: r.dealer.holeHidden ? [r.dealer.cards[0], "XX"] : r.dealer.cards, total: r.dealer.holeHidden ? null : handValue(r.dealer.cards).total },
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
      hands: [{ cards: [], stood: false, busted: false, doubled: false, surrendered: false, hasActed: false }],
      activeHand: 0,
      joined_at: Date.now(),
    };

    emitUpdate("player-joined", snapshot(room));
    return res.status(200).json({ message: "joined" });
  });

  router.post("/leave", (req, res) => {
    const { userId } = req.body;
    if (!userId || !room.players[userId]) return res.status(404).json({ message: "not in room" });

    const p = room.players[userId];
    if (p.inRound) {
      // leave after round to avoid abandoning an active bet
      room.leavingAfterRound[userId] = true;
      return res.status(200).json({ message: "will-leave-after-round" });
    } else {
      delete room.players[userId];
      emitUpdate("player-left", snapshot(room));
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
        user_id: userId, target_user_id: null,
        action: 'BLACKJACK_BET',
        coins_amount: -bet, user_new_amount: coins - bet,
      });
      p.bank = coins - bet;
    }

    p.currentBet = bet;
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
      if (coins < p.currentBet) return res.status(403).json({ message: "insufficient-funds-for-double" });
      updateUserCoins.run({ id: userId, coins: coins - p.currentBet });
      insertLog.run({
        id: `${userId}-blackjack-${Date.now()}`,
        user_id: userId, target_user_id: null,
        action: 'BLACKJACK_DOUBLE',
        coins_amount: -p.currentBet, user_new_amount: coins - p.currentBet,
      });
      p.bank = coins - p.currentBet;
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
  setInterval(() => {
    const now = Date.now();

    if (room.status === "betting" && now >= room.phase_ends_at) {
      const hasBets = Object.values(room.players).some(p => p.currentBet >= room.minBet);
      if (!hasBets) {
        // Extend betting window if no one bet
        room.phase_ends_at = now + room.settings.phaseDurations.bettingMs;
        emitUpdate("betting-extend", snapshot(room));
        return;
      }
      dealInitial(room);
      autoActions(room);
      emitUpdate("initial-deal", snapshot(room));
    }

    if (room.status === "playing") {
      // When all active players are done, proceed to dealer play
      if (everyoneDone(room)) {
        dealerPlay(room);
        emitUpdate("dealer-start", snapshot(room));
      }
    }

    if (room.status === "dealer") {
      settleAll(room);

      // Apply coin deltas
      for (const p of Object.values(room.players)) {
        if (!p.inRound) continue;
        const h = p.hands[p.activeHand];
        if (room.settings.fakeMoney) continue;
        if (typeof h.delta === "number" && h.delta !== 0) {
          const userDB = getUser.get(p.id);
          if (userDB) {
            updateUserCoins.run({ id: p.id, coins: userDB.coins + h.delta });
            insertLog.run({
              id: `${p.id}-blackjack-${Date.now()}`,
              user_id: p.id, target_user_id: null,
              action: `BLACKJACK_${h.delta > 0 ? "WIN" : "LOSE"}`,
              coins_amount: h.delta, user_new_amount: userDB.coins + h.delta,
            });
          }
        }
      }

      room.phase_ends_at = now + room.settings.phaseDurations.payoutMs;
      emitUpdate("payout", snapshot(room));
      room.status = "payout";
    }

    if (room.status === "payout" && now >= room.phase_ends_at) {
      // Remove leavers
      for (const userId of Object.keys(room.leavingAfterRound)) {
        delete room.players[userId];
      }
      // Prepare next round
      startBetting(room, now);
      emitUpdate("new-round", snapshot(room));
    }
  }, 400);

  return router;
}