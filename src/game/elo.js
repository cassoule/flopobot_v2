import * as userService from "../services/user.service.js";
import * as gameService from "../services/game.service.js";
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
export async function eloHandler(p1Id, p2Id, p1Score, p2Score, type, scores = null) {
	// --- 1. Fetch Player Data ---
	const p1DB = await userService.getUser(p1Id);
	const p2DB = await userService.getUser(p2Id);
	if (!p1DB || !p2DB) {
		console.error(`Elo Handler: Could not find user data for ${p1Id} or ${p2Id}.`);
		return;
	}

	let p1EloData = await gameService.getUserElo(p1Id);
	let p2EloData = await gameService.getUserElo(p2Id);

	// --- 2. Initialize Elo if it doesn't exist ---
	if (!p1EloData) {
		await gameService.insertElo(p1Id, 1000);
		p1EloData = { id: p1Id, elo: 1000 };
	}
	if (!p2EloData) {
		await gameService.insertElo(p2Id, 1000);
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

	// Calculate raw Elo changes
	const p1Change = K_FACTOR * (p1Score - expectedP1);
	const p2Change = K_FACTOR * (p2Score - expectedP2);

	// Make losing friendlier: loser loses 70% of what winner gains
	let finalP1Change = p1Change;
	let finalP2Change = p2Change;

	if (p1Score > p2Score) {
		// P1 won, P2 lost
		finalP2Change = p2Change * 0.7;
	} else if (p2Score > p1Score) {
		// P2 won, P1 lost
		finalP1Change = p1Change * 0.7;
	}
	// If it's a draw (p1Score === p2Score), keep the original changes

	// Calculate new Elo ratings
	const p1NewElo = Math.round(p1CurrentElo + finalP1Change);
	const p2NewElo = Math.round(p2CurrentElo + finalP2Change);

	// Ensure Elo doesn't drop below a certain threshold (e.g., 100)
	const finalP1Elo = Math.max(0, p1NewElo);
	const finalP2Elo = Math.max(0, p2NewElo);

	console.log(`Elo Update (${type}) for ${p1DB.globalName}: ${p1CurrentElo} -> ${finalP1Elo}`);
	console.log(`Elo Update (${type}) for ${p2DB.globalName}: ${p2CurrentElo} -> ${finalP2Elo}`);
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
		console.error(`Failed to post elo update message`, e);
	}

	// --- 4. Update Database ---
	await gameService.updateElo(p1Id, finalP1Elo);
	await gameService.updateElo(p2Id, finalP2Elo);

	if (scores) {
		await gameService.insertGame({
				id: `${p1Id}-${p2Id}-${Date.now()}`,
				p1: p1Id,
				p2: p2Id,
				p1Score: scores.p1,
				p2Score: scores.p2,
				p1Elo: p1CurrentElo,
				p2Elo: p2CurrentElo,
				p1NewElo: finalP1Elo,
				p2NewElo: finalP2Elo,
				type: type,
				timestamp: Date.now(),
			});
	} else {
		await gameService.insertGame({
				id: `${p1Id}-${p2Id}-${Date.now()}`,
				p1: p1Id,
				p2: p2Id,
				p1Score: p1Score,
				p2Score: p2Score,
				p1Elo: p1CurrentElo,
				p2Elo: p2CurrentElo,
				p1NewElo: finalP1Elo,
				p2NewElo: finalP2Elo,
				type: type,
				timestamp: Date.now(),
			});
	}

	
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
	const dbPlayers = await Promise.all(playerIds.map(async (id) => {
		const user = await userService.getUser(id);
		const eloData = await gameService.getUserElo(id);
		const elo = eloData?.elo || 1000;
		return { ...user, elo };
	}));

	const winnerIds = new Set(room.winners);
	const playerCount = dbPlayers.length;
	const K_BASE = 16; // A lower K-factor is often used for multi-player games

	const averageElo = dbPlayers.reduce((sum, p) => sum + p.elo, 0) / playerCount;

	for (const player of dbPlayers) {
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
			await gameService.updateElo(player.id, newElo);

			await gameService.insertGame({
				id: `${player.id}-poker-${Date.now()}`,
				p1: player.id,
				p2: null, // No single opponent
				p1Score: actualScore,
				p2Score: null,
				p1Elo: player.elo,
				p2Elo: Math.round(averageElo), // Log the average opponent Elo for context
				p1NewElo: newElo,
				p2NewElo: null,
				type: "POKER_ROUND",
				timestamp: Date.now(),
			});
		} else {
			console.error(`Error calculating new Elo for ${player.globalName}.`);
		}
	}
}
