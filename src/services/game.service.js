import prisma from "../prisma/client.js";

export async function getUserElo(id) {
	return prisma.elo.findUnique({ where: { id } });
}

export async function insertElo(id, elo) {
	return prisma.elo.create({ data: { id, elo } });
}

export async function updateElo(id, elo) {
	return prisma.elo.update({ where: { id }, data: { elo } });
}

export async function getUsersByElo() {
	const users = await prisma.user.findMany({
		include: { elo: true },
		orderBy: { elo: { elo: "desc" } },
	});
	return users
		.filter((u) => u.elo)
		.map((u) => ({ ...u, elo: u.elo?.elo ?? null }));
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
