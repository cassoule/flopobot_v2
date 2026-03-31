import prisma from "../prisma/client.js";

export async function getUserElo(id) {
	return prisma.elo.findUnique({ where: { id } });
}

export async function insertElo(id, elo = 1500, rd = 350.0, volatility = 0.06) {
	return prisma.elo.create({ data: { id, elo, rd, volatility, gamesPlayed: 0 } });
}

export async function updateElo(id, { elo, rd, volatility, gamesPlayed }) {
	return prisma.elo.update({ where: { id }, data: { elo, rd, volatility, gamesPlayed } });
}

export async function getUsersByElo() {
	const users = await prisma.user.findMany({
		include: { elo: true },
		orderBy: { elo: { elo: "desc" } },
	});
	return users
		.filter((u) => u.elo)
		.map((u) => ({
			...u,
			elo: u.elo?.elo ?? null,
			rd: u.elo?.rd ?? null,
			gamesPlayed: u.elo?.gamesPlayed ?? 0,
			isPlacement: (u.elo?.gamesPlayed ?? 0) < 5,
		}))
		.sort((a, b) => {
			// Ranked players first, then placement players
			if (a.isPlacement !== b.isPlacement) return a.isPlacement ? 1 : -1;
			return (b.elo ?? 0) - (a.elo ?? 0);
		});
}

function toGame(game) {
	return { ...game, timestamp: game.timestamp != null ? game.timestamp.getTime() : null };
}

export async function insertGame(data) {
	return prisma.game.create({
		data: {
			...data,
			timestamp: data.timestamp != null ? new Date(data.timestamp) : null,
		},
	});
}

export async function getGames() {
	const games = await prisma.game.findMany();
	return games.map(toGame);
}

export async function getUserGames(userId) {
	const games = await prisma.game.findMany({
		where: { OR: [{ p1: userId }, { p2: userId }] },
		orderBy: { timestamp: "asc" },
	});
	return games.map(toGame);
}
