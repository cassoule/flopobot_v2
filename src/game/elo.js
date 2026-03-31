import * as userService from "../services/user.service.js";
import * as gameService from "../services/game.service.js";
import { EmbedBuilder } from "discord.js";
import { client } from "../bot/client.js";
import { resolveUser } from "../utils/index.js";
import { calculateNewRatings, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOLATILITY, PLACEMENT_GAMES } from "./glicko2.js";

function formatPlayerLine(name, oldElo, newElo, gamesPlayed) {
	const diff = newElo - oldElo;
	const isPlacement = gamesPlayed < PLACEMENT_GAMES;
	if (isPlacement) {
		return `**${name}** — Placement (${gamesPlayed}/${PLACEMENT_GAMES}) 🏆 ${oldElo} ${diff > 0 ? "↗️" : diff < 0 ? "↘️" : "➡️"} **${newElo}** (${diff > 0 ? "+" : ""}${diff})`;
	}
	return `**${name}** a ${diff > 0 ? "gagné" : "perdu"} **${Math.abs(diff)}** elo 🏆 ${oldElo} ${diff > 0 ? "↗️" : "↘️"} **${newElo}**`;
}

/**
 * Handles Glicko-2 rating calculation for a standard 1v1 game.
 */
export async function eloHandler(p1Id, p2Id, p1Score, p2Score, type, scores = null) {
	const p1DB = await userService.getUser(p1Id);
	const p2DB = await userService.getUser(p2Id);
	if (!p1DB || !p2DB) {
		console.error(`Rating Handler: Could not find user data for ${p1Id} or ${p2Id}.`);
		return;
	}

	let p1EloData = await gameService.getUserElo(p1Id);
	let p2EloData = await gameService.getUserElo(p2Id);

	if (!p1EloData) {
		await gameService.insertElo(p1Id);
		p1EloData = { id: p1Id, elo: DEFAULT_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY, gamesPlayed: 0 };
	}
	if (!p2EloData) {
		await gameService.insertElo(p2Id);
		p2EloData = { id: p2Id, elo: DEFAULT_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY, gamesPlayed: 0 };
	}

	const p1Current = { rating: p1EloData.elo, rd: p1EloData.rd, volatility: p1EloData.volatility };
	const p2Current = { rating: p2EloData.elo, rd: p2EloData.rd, volatility: p2EloData.volatility };

	const p1Result = calculateNewRatings(p1Current, p2Current, p1Score);
	const p2Result = calculateNewRatings(p2Current, p1Current, p2Score);

	const finalP1Elo = Math.max(0, p1Result.rating);
	const finalP2Elo = Math.max(0, p2Result.rating);
	const p1NewGames = p1EloData.gamesPlayed + 1;
	const p2NewGames = p2EloData.gamesPlayed + 1;

	console.log(
		`Rating Update (${type}) for ${p1DB.globalName}: ${p1EloData.elo} -> ${finalP1Elo} (RD: ${p1EloData.rd} -> ${p1Result.rd})`,
	);
	console.log(
		`Rating Update (${type}) for ${p2DB.globalName}: ${p2EloData.elo} -> ${finalP2Elo} (RD: ${p2EloData.rd} -> ${p2Result.rd})`,
	);

	if (p1DB.isAkhy || p2DB.isAkhy) {
		try {
			const generalChannel = client.channels.cache.get(process.env.BOT_CHANNEL_ID);
			const user1 = await resolveUser(client, p1Id);
			const user2 = await resolveUser(client, p2Id);
			const embed = new EmbedBuilder()
				.setTitle(`FlopoRank - ${type}`)
				.setDescription(
					`${formatPlayerLine(user1.globalName || user1.username, p1EloData.elo, finalP1Elo, p1NewGames)}\n\n${formatPlayerLine(user2.globalName || user2.username, p2EloData.elo, finalP2Elo, p2NewGames)}`,
				)
				.setColor("#5865f2");
			await generalChannel.send({ embeds: [embed] });
		} catch (e) {
			console.error(`Failed to post rating update message`, e);
		}
	}

	await gameService.updateElo(p1Id, {
		elo: finalP1Elo,
		rd: p1Result.rd,
		volatility: p1Result.volatility,
		gamesPlayed: p1NewGames,
	});
	await gameService.updateElo(p2Id, {
		elo: finalP2Elo,
		rd: p2Result.rd,
		volatility: p2Result.volatility,
		gamesPlayed: p2NewGames,
	});

	const gameScores = scores || { p1: p1Score, p2: p2Score };
	await gameService.insertGame({
		id: `${p1Id}-${p2Id}-${Date.now()}`,
		p1: p1Id,
		p2: p2Id,
		p1Score: gameScores.p1,
		p2Score: gameScores.p2,
		p1Elo: p1EloData.elo,
		p2Elo: p2EloData.elo,
		p1NewElo: finalP1Elo,
		p2NewElo: finalP2Elo,
		p1Rd: p1EloData.rd,
		p2Rd: p2EloData.rd,
		p1NewRd: p1Result.rd,
		p2NewRd: p2Result.rd,
		type: type,
		timestamp: Date.now(),
	});

	return {
		[p1Id]: { oldElo: p1EloData.elo, newElo: finalP1Elo, gamesPlayed: p1NewGames },
		[p2Id]: { oldElo: p2EloData.elo, newElo: finalP2Elo, gamesPlayed: p2NewGames },
	};
}

/**
 * Handles Glicko-2 rating calculation for a multi-player poker game.
 * Treats the game as pairwise matchups against the average opponent.
 */
export async function pokerEloHandler(room) {
	if (room.fakeMoney) {
		return;
	}

	const playerIds = Object.keys(room.players);
	if (playerIds.length < 2) return;

	const dbPlayers = await Promise.all(
		playerIds.map(async (id) => {
			const user = await userService.getUser(id);
			const eloData = await gameService.getUserElo(id);
			return {
				...user,
				rating: eloData?.elo || DEFAULT_RATING,
				rd: eloData?.rd || DEFAULT_RD,
				volatility: eloData?.volatility || DEFAULT_VOLATILITY,
				gamesPlayed: eloData?.gamesPlayed || 0,
			};
		}),
	);

	const winnerIds = new Set(room.winners);
	const averageRating = dbPlayers.reduce((sum, p) => sum + p.rating, 0) / dbPlayers.length;
	const averageRd = dbPlayers.reduce((sum, p) => sum + p.rd, 0) / dbPlayers.length;

	for (const player of dbPlayers) {
		const actualScore = winnerIds.has(player.id) ? 1 / winnerIds.size : 0;

		const result = calculateNewRatings(
			{ rating: player.rating, rd: player.rd, volatility: player.volatility },
			{ rating: averageRating, rd: averageRd },
			actualScore,
		);

		const newElo = Math.max(0, result.rating);
		const newGames = player.gamesPlayed + 1;

		if (!isNaN(newElo)) {
			console.log(
				`Rating Update (POKER) for ${player.globalName}: ${player.rating} -> ${newElo} (RD: ${player.rd} -> ${result.rd})`,
			);
			await gameService.updateElo(player.id, {
				elo: newElo,
				rd: result.rd,
				volatility: result.volatility,
				gamesPlayed: newGames,
			});

			await gameService.insertGame({
				id: `${player.id}-poker-${Date.now()}`,
				p1: player.id,
				p2: null,
				p1Score: actualScore,
				p2Score: null,
				p1Elo: player.rating,
				p2Elo: Math.round(averageRating),
				p1NewElo: newElo,
				p2NewElo: null,
				p1Rd: player.rd,
				p2Rd: averageRd,
				p1NewRd: result.rd,
				p2NewRd: null,
				type: "POKER_ROUND",
				timestamp: Date.now(),
			});
		} else {
			console.error(`Error calculating new rating for ${player.globalName}.`);
		}
	}
}
