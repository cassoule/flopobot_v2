import prisma from "../prisma/client.js";
import { socketEmit } from "../server/socket.js";
import { getAllSOTDStats } from "./solitaire.service.js";
import { getAllSudokuOTDStats } from "./sudoku.service.js";
import { getUserGames } from "./game.service.js";

export async function getUser(id) {
	const user = await prisma.user.findUnique({
		where: { id },
		include: { elo: true },
	});
	const solitaireOTDRankings = await getAllSOTDStats();
	const sudokuOTDRankings = await getAllSudokuOTDStats();
	const games = await getUserGames(id);
	const wins = games.filter(
		(g) => (g.p1 === id && g.p1Score > g.p2Score) || (g.p2 === id && g.p2Score > g.p1Score),
	).length;
	const winRate = games.length > 0 ? (wins / games.length) * 100 : 0;
	if (!user) return null;
	return {
		...user,
		elo: user.elo?.elo ?? null,
		winRate: winRate.toFixed(2),
		solitaireOTDRank: solitaireOTDRankings.findIndex((s) => s.userId === id) + 1 || null,
		sudokuOTDRank: sudokuOTDRankings.findIndex((s) => s.userId === id) + 1 || null,
	};
}

export async function getAllUsers() {
	const users = await prisma.user.findMany({
		include: { elo: true },
		orderBy: { coins: "desc" },
	});

	return users.map((u) => ({
		...u,
		elo: u.elo?.elo ?? null,
	}));
}

export async function getAllAkhys() {
	const users = await prisma.user.findMany({
		where: { isAkhy: 1 },
		include: { elo: true },
		orderBy: { coins: "desc" },
	});
	return users.map((u) => ({ ...u, elo: u.elo?.elo ?? null }));
}

export async function insertUser(data) {
	return prisma.user.create({ data });
}

export async function updateUser(data) {
	const { id, ...rest } = data;
	return prisma.user.update({ where: { id }, data: rest });
}

export async function updateUserCoins(id, coins) {
	await socketEmit("data-updated", { table: "users", action: "update", userId: id, newCoins: coins });
	return prisma.user.update({ where: { id }, data: { coins } });
}

export async function updateUserAvatar(id, avatarUrl) {
	return prisma.user.update({ where: { id }, data: { avatarUrl } });
}

export async function queryDailyReward(id) {
	return prisma.user.update({ where: { id }, data: { dailyQueried: 1 } });
}

export async function resetDailyReward() {
	return prisma.user.updateMany({ data: { dailyQueried: 0 } });
}

export async function insertManyUsers(users) {
	return prisma.$transaction(
		users.map((user) =>
			prisma.user.upsert({
				where: { id: user.id },
				update: {},
				create: user,
			}),
		),
	);
}

export async function updateManyUsers(users) {
	return prisma.$transaction(
		users.map((user) => {
			const { id, elo, ...data } = user;
			return prisma.user.update({ where: { id }, data });
		}),
	);
}
