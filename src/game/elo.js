import { getUser, getUserElo, insertElos, insertGame, updateElo } from "../database/index.js";
import { ButtonStyle, EmbedBuilder } from "discord.js";
import { client } from "../bot/client.js";

/**
 * Handles Elo calculation for a standard 1v1 game.
 * @param {string} p1Id - The ID of player 1.
 * @param {string} p2Id - The ID of player 2.
 * @param {number} p1Score - The score for player 1 (1 for win, 0.5 for draw, 0 for loss).
 * @param {number} p2Score - The score for player 2.
 * @param {string} type - The type of game being played (e.g., 'TICTACTOE', 'CONNECT4').
 */
export async function eloHandler(p1Id, p2Id, p1Score, p2Score, type) {
	// --- 1. Fetch Player Data ---
	const p1DB = getUser.get(p1Id);
	const p2DB = getUser.get(p2Id);
	if (!p1DB || !p2DB) {
		console.error(`[${Date.now()}] Elo Handler: Could not find user data for ${p1Id} or ${p2Id}.`);
		return;
	}

	let p1EloData = getUserElo.get({ id: p1Id });
	let p2EloData = getUserElo.get({ id: p2Id });

	// --- 2. Initialize Elo if it doesn't exist ---
	if (!p1EloData) {
		await insertElos.run({ id: p1Id, elo: 1000 });
		p1EloData = { id: p1Id, elo: 1000 };
	}
	if (!p2EloData) {
		await insertElos.run({ id: p2Id, elo: 1000 });
		p2EloData = { id: p2Id, elo: 1000 };
	}

	const p1CurrentElo = p1EloData.elo;
	const p2CurrentElo = p2EloData.elo;

	// --- 3. Calculate Elo Change ---
	// The K-factor determines how much the Elo rating changes after a game.
	const K_FACTOR = 32;

	// Calculate expected scores
	const expectedP1 = 1 / (1 + Math.pow(10, (p2CurrentElo - p1CurrentElo) / 400));
	const expectedP2 = 1 / (1 + Math.pow(10, (p1CurrentElo - p2CurrentElo) / 400));

	// Calculate new Elo ratings
	const p1NewElo = Math.round(p1CurrentElo + K_FACTOR * (p1Score - expectedP1));
	const p2NewElo = Math.round(p2CurrentElo + K_FACTOR * (p2Score - expectedP2));

	// Ensure Elo doesn't drop below a certain threshold (e.g., 100)
	const finalP1Elo = Math.max(0, p1NewElo);
	const finalP2Elo = Math.max(0, p2NewElo);

	console.log(`[${Date.now()}] Elo Update (${type}) for ${p1DB.globalName}: ${p1CurrentElo} -> ${finalP1Elo}`);
	console.log(`[${Date.now()}] Elo Update (${type}) for ${p2DB.globalName}: ${p2CurrentElo} -> ${finalP2Elo}`);
	try {
		const generalChannel = await client.channels.fetch(process.env.BOT_CHANNEL_ID);
		const user1 = await client.users.fetch(p1Id);
		const user2 = await client.users.fetch(p2Id);
		const diff1 = finalP1Elo - p1CurrentElo;
		const diff2 = finalP2Elo - p2CurrentElo;
		const embed = new EmbedBuilder()
			.setTitle(`FlopoRank - ${type}`)
			.setDescription(
				`
                **${user1.globalName || user1.username}** a ${diff1 > 0 ? "gagné" : "perdu"} **${Math.abs(diff1)}** elo 🏆 ${p1CurrentElo} ${diff1 > 0 ? "↗️" : "↘️"} **${finalP1Elo}**\n
                **${user2.globalName || user2.username}** a ${diff2 > 0 ? "gagné" : "perdu"} **${Math.abs(diff2)}** elo 🏆 ${p2CurrentElo} ${diff2 > 0 ? "↗️" : "↘️"} **${finalP2Elo}**\n
            `,
			)
			.setColor("#5865f2");
		await generalChannel.send({ embeds: [embed] });
	} catch (e) {
		console.error(`[${Date.now()}] Failed to post elo update message`, e);
	}

	// --- 4. Update Database ---
	updateElo.run({ id: p1Id, elo: finalP1Elo });
	updateElo.run({ id: p2Id, elo: finalP2Elo });

	insertGame.run({
		id: `${p1Id}-${p2Id}-${Date.now()}`,
		p1: p1Id,
		p2: p2Id,
		p1_score: p1Score,
		p2_score: p2Score,
		p1_elo: p1CurrentElo,
		p2_elo: p2CurrentElo,
		p1_new_elo: finalP1Elo,
		p2_new_elo: finalP2Elo,
		type: type,
		timestamp: Date.now(),
	});
}

/**
 * Handles Elo calculation for a multi-player poker game.
 * @param {object} room - The poker room object containing player and winner info.
 */
export async function pokerEloHandler(room) {
	if (room.fakeMoney) {
		console.log("Skipping Elo update for fake money poker game.");
		return;
	}

	const playerIds = Object.keys(room.players);
	if (playerIds.length < 2) return; // Not enough players to calculate Elo

	// Fetch all players' Elo data at once
	const dbPlayers = playerIds.map((id) => {
		const user = getUser.get(id);
		const elo = getUserElo.get({ id })?.elo || 1000;
		return { ...user, elo };
	});

	const winnerIds = new Set(room.winners);
	const playerCount = dbPlayers.length;
	const K_BASE = 16; // A lower K-factor is often used for multi-player games

	const averageElo = dbPlayers.reduce((sum, p) => sum + p.elo, 0) / playerCount;

	dbPlayers.forEach((player) => {
		// Expected score is the chance of winning against an "average" player from the field
		const expectedScore = 1 / (1 + Math.pow(10, (averageElo - player.elo) / 400));

		// Determine actual score
		let actualScore;
		if (winnerIds.has(player.id)) {
			// Winners share the "win" points
			actualScore = 1 / winnerIds.size;
		} else {
			actualScore = 0;
		}

		// Dynamic K-factor: higher impact for more significant results
		const kFactor = K_BASE * playerCount;
		const eloChange = kFactor * (actualScore - expectedScore);
		const newElo = Math.max(100, Math.round(player.elo + eloChange));

		if (!isNaN(newElo)) {
			console.log(
				`Elo Update (POKER) for ${player.globalName}: ${player.elo} -> ${newElo} (Δ: ${eloChange.toFixed(2)})`,
			);
			updateElo.run({ id: player.id, elo: newElo });

			insertGame.run({
				id: `${player.id}-poker-${Date.now()}`,
				p1: player.id,
				p2: null, // No single opponent
				p1_score: actualScore,
				p2_score: null,
				p1_elo: player.elo,
				p2_elo: Math.round(averageElo), // Log the average opponent Elo for context
				p1_new_elo: newElo,
				p2_new_elo: null,
				type: "POKER_ROUND",
				timestamp: Date.now(),
			});
		} else {
			console.error(`[${Date.now()}] Error calculating new Elo for ${player.globalName}.`);
		}
	});
}
