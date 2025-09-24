// /game/blackjack.js
// Core blackjack helpers for a single continuous room.
// Inspired by your poker helpers API style.

import {emitToast} from "../server/socket.js";
import {getUser, insertLog, updateUserCoins} from "../database/index.js";
import {client} from "../bot/client.js";
import {EmbedBuilder} from "discord.js";

export const RANKS = ["A","2","3","4","5","6","7","8","9","T","J","Q","K"];
export const SUITS = ["d","s","c","h"];

// Build a single 52-card deck like "Ad","Ts", etc.
export const singleDeck = RANKS.flatMap(r => SUITS.map(s => `${r}${s}`));

export function buildShoe(decks = 6) {
  const shoe = [];
  for (let i = 0; i < decks; i++) shoe.push(...singleDeck);
  return shuffle(shoe);
}

export function shuffle(arr) {
  // Fisher–Yates
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draw one card from the shoe; if empty, caller should reshuffle at end of round.
export function draw(shoe) {
  return shoe.pop();
}

// Return an object describing the best value of a hand with flexible Aces.
export function handValue(cards) {
  // Count with all aces as 11, then reduce as needed
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c[0];
    if (r === "A") { total += 11; aces += 1; }
    else if (r === "T" || r === "J" || r === "Q" || r === "K") total += 10;
    else total += Number(r);
  }
  while (total > 21 && aces > 0) {
    total -= 10; // convert an Ace from 11 to 1
    aces -= 1;
  }
  const soft = (aces > 0); // if any Ace still counted as 11, it's a soft hand
  return { total, soft };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards) {
  return handValue(cards).total > 21;
}

// Dealer draw rule. By default, dealer stands on soft 17 (S17).
export function dealerShouldHit(dealerCards, hitSoft17 = false) {
  const v = handValue(dealerCards);
  if (v.total < 17) return true;
  if (v.total === 17 && v.soft && hitSoft17) return true;
  return false;
}

// Compare a player hand to dealer and return outcome.
export function compareHands(playerCards, dealerCards) {
  const pv = handValue(playerCards).total;
  const dv = handValue(dealerCards).total;
  if (pv > 21) return "lose";
  if (dv > 21) return "win";
  if (pv > dv) return "win";
  if (pv < dv) return "lose";
  return "push";
}

// Compute payout for a single finished hand (no splits here).
// options: { blackjackPayout: 1.5, allowSurrender: false }
export function settleHand({ bet, playerCards, dealerCards, doubled = false, surrendered = false, blackjackPayout = 1.5 }) {
  if (surrendered) return { delta: -bet / 2, result: "surrender" };

  const pBJ = isBlackjack(playerCards);
  const dBJ = isBlackjack(dealerCards);

  if (pBJ && !dBJ) return { delta: bet * blackjackPayout, result: "blackjack" };
  if (!pBJ && dBJ) return { delta: -bet, result: "lose" };
  if (pBJ && dBJ) return { delta: 0, result: "push" };

  const outcome = compareHands(playerCards, dealerCards);
  let unit = bet;
  if (outcome === "win") return { delta: unit, result: "win" };
  if (outcome === "lose") return { delta: -unit, result: "lose" };
  return { delta: 0, result: "push" };
}

// Helper to decide if doubling is still allowed (first decision, 2 cards, not hit yet).
export function canDouble(hand) {
  return hand.cards.length === 2 && !hand.hasActed;
}

// Very small utility to format a public-safe snapshot of room state
export function publicPlayerView(player) {
  // Hide hole cards until dealer reveal is fine for dealer only; player cards are visible.
  return {
    id: player.id,
    globalName: player.globalName,
    avatar: player.avatar,
    bank: player.bank,
    currentBet: player.currentBet,
    inRound: player.inRound,
    hands: player.hands.map(h => ({
      cards: h.cards,
      stood: h.stood,
      busted: h.busted,
      doubled: h.doubled,
      surrendered: h.surrendered,
      result: h.result ?? null,
      total: handValue(h.cards).total,
      soft: handValue(h.cards).soft,
      bet: h.bet,
    })),
  };
}

// Build initial room object
export function createBlackjackRoom({
  minBet = 10,
  maxBet = 1000,
  fakeMoney = false,
  decks = 6,
  hitSoft17 = false,
  blackjackPayout = 1.5,
  cutCardRatio = 0.25, // reshuffle when 25% of shoe remains
  phaseDurations = {
    bettingMs: 15000,
    dealMs: 1000,
    playMsPerPlayer: 15000,
    revealMs: 1000,
    payoutMs: 10000,
  },
  animation = {
    dealerDrawMs: 500,
  }
} = {}) {
  return {
    id: "blackjack-room",
    name: "Blackjack",
    created_at: Date.now(),
    status: "betting", // betting | dealing | playing | dealer | payout | shuffle
    phase_ends_at: Date.now() + phaseDurations.bettingMs,
    minBet, maxBet, fakeMoney,
    settings: { decks, hitSoft17, blackjackPayout, cutCardRatio, phaseDurations, animation },
    shoe: buildShoe(decks),
    discard: [],
    dealer: { cards: [], holeHidden: true },
    players: {}, // userId -> { id, globalName, avatar, bank, currentBet, inRound, hands: [{cards, stood, busted, doubled, surrendered, hasActed}], activeHand: 0 }
    leavingAfterRound: {},
  };
}

// Reshuffle at start of the next round if the shoe is low
export function needsReshuffle(room) {
  return room.shoe.length < singleDeck.length * room.settings.decks * room.settings.cutCardRatio;
}

// --- Round Lifecycle helpers ---

export function resetForNewRound(room) {
  room.status = "betting";
  room.dealer = { cards: [], holeHidden: true };
  room.leavingAfterRound = {};
  // Clear per-round attributes on players, but keep bank and presence
  for (const p of Object.values(room.players)) {
    p.inRound = false;
    p.currentBet = 0;
    p.hands = [ { cards: [], stood: false, busted: false, doubled: false, surrendered: false, hasActed: false, bet: 0 } ];
    p.activeHand = 0;
  }
}

export function startBetting(room, now) {
  resetForNewRound(room);
  if (needsReshuffle(room)) {
    room.status = "shuffle";
    // quick shuffle animation phase
    room.shoe = buildShoe(room.settings.decks);
  }
  room.status = "betting";
  room.phase_ends_at = now + room.settings.phaseDurations.bettingMs;
}

export function dealInitial(room) {
  room.status = "dealing";
  // Deal one to each player who placed a bet, then again, then dealer up + hole
  const actives = Object.values(room.players).filter(p => p.currentBet >= room.minBet);
  for (const p of actives) {
    p.inRound = true;
    p.hands = [ { cards: [draw(room.shoe)], stood: false, busted: false, doubled: false, surrendered: false, hasActed: false } ];
  }
  room.dealer.cards = [draw(room.shoe), draw(room.shoe)];
  room.dealer.holeHidden = true;
  for (const p of actives) {
    p.hands[0].cards.push(draw(room.shoe));
  }
  room.status = "playing";
}

export function autoActions(room) {
  // Auto-stand if player already blackjack
  for (const p of Object.values(room.players)) {
    if (!p.inRound) continue;
    const h = p.hands[p.activeHand];
    if (isBlackjack(h.cards)) {
      h.stood = true;
      h.hasActed = true;
    }
  }
}

export function everyoneDone(room) {
  return Object.values(room.players).every(p => {
    if (!p.inRound) return true;
    return p.hands.filter(h => !h.stood && !h.busted && !h.surrendered)?.length === 0;
  });
}

export function dealerPlay(room) {
  room.status = "dealer";
  room.dealer.holeHidden = false;
  while (dealerShouldHit(room.dealer.cards, room.settings.hitSoft17)) {
    room.dealer.cards.push(draw(room.shoe));
  }
}

export async function settleAll(room) {
  room.status = "payout";
  const allRes = {}
  for (const p of Object.values(room.players)) {
    if (!p.inRound) continue;
    for (const hand of Object.values(p.hands)) {
      const res = settleHand({
        bet: hand.bet,
        playerCards: hand.cards,
        dealerCards: room.dealer.cards,
        doubled: hand.doubled,
        surrendered: hand.surrendered,
        blackjackPayout: room.settings.blackjackPayout,
      });
      allRes[p.id] = res;
      p.totalDelta += res.delta
      p.totalBets++
      if (res.result === 'win' || res.result === 'push' || res.result === 'blackjack') {
        const userDB = getUser.get(p.id);
        if (userDB) {
          const coins = userDB.coins;
          try {
            updateUserCoins.run({ id: p.id, coins: coins + hand.bet + res.delta });
            insertLog.run({
              id: `${p.id}-blackjack-${Date.now()}`,
              user_id: p.id, target_user_id: null,
              action: 'BLACKJACK_PAYOUT',
              coins_amount: res.delta + hand.bet, user_new_amount: coins + hand.bet + res.delta,
            });
            p.bank = coins + hand.bet + res.delta
          } catch (e) {
            console.log(e)
          }
        }
      }
      emitToast({ type: `payout-res`, allRes });
      hand.result = res.result;
      hand.delta = res.delta;
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const generalChannel = guild.channels.cache.find(
            ch => ch.name === 'général' || ch.name === 'general'
        );
        const msg = await generalChannel.messages.fetch(p.msgId);
        const updatedEmbed = new EmbedBuilder()
            .setDescription(`<@${p.id}> joue au Blackjack.`)
            .addFields(
                {
                  name: `Gains`,
                  value: `**${p.totalDelta >= 0 ? '+' + p.totalDelta : p.totalDelta}** Flopos`,
                  inline: true
                },
                {
                  name: `Mises jouées`,
                  value: `**${p.totalBets}**`,
                  inline: true
                }
            )
            .setColor(p.totalDelta >= 0 ? 0x22A55B : 0xED4245)
            .setTimestamp(new Date());
        await msg.edit({ embeds: [updatedEmbed], components: [] });
      } catch (e) {
        console.log(e);
      }
    }
  }
}

// Apply a player decision; returns a string event or throws on invalid.
export function applyAction(room, playerId, action) {
  const p = room.players[playerId];
  if (!p || !p.inRound || room.status !== "playing") throw new Error("Not allowed");
  const hand = p.hands[p.activeHand];

  switch (action) {
    case "hit": {
      if (hand.stood || hand.busted) throw new Error("Already ended");
      hand.hasActed = true;
      hand.cards.push(draw(room.shoe));
      if (isBust(hand.cards)) hand.busted = true;
      return "hit";
    }
    case "stand": {
      hand.stood = true;
      hand.hasActed = true;
      return "stand";
    }
    case "double": {
      if (!canDouble(hand)) throw new Error("Cannot double now");
      hand.doubled = true;
      hand.bet*=2
      p.currentBet*=2
      hand.hasActed = true;
      // The caller (routes) must also handle additional balance lock on the bet if using real coins
      hand.cards.push(draw(room.shoe));
      if (isBust(hand.cards)) hand.busted = true;
      else hand.stood = true;
      return "double";
    }
    case "surrender": {
      if (hand.cards.length !== 2 || hand.hasActed) throw new Error("Cannot surrender now");
      hand.surrendered = true;
      hand.stood = true;
      hand.hasActed = true;
      return "surrender";
    }
    case "split": {
      if (hand.cards.length !== 2) throw new Error("Cannot split: not exactly 2 cards");
      const r0 = hand.cards[0][0];
      const r1 = hand.cards[1][0];
      if (r0 !== r1) throw new Error("Cannot split: cards not same rank");

      const cardA = hand.cards[0];
      const cardB = hand.cards[1];

      hand.cards = [cardA];
      hand.stood = false;
      hand.busted = false;
      hand.doubled = false;
      hand.surrendered = false;
      hand.hasActed = false;

      const newHand = {
        cards: [cardB],
        stood: false,
        busted: false,
        doubled: false,
        surrendered: false,
        hasActed: false,
        bet: hand.bet,
      }

      p.currentBet *= 2

      p.hands.splice(p.activeHand + 1, 0, newHand);

      hand.cards.push(draw(room.shoe));
      newHand.cards.push(draw(room.shoe));

      return "split";
    }
    default:
      throw new Error("Invalid action");
  }
}