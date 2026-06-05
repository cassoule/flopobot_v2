import prisma from "../prisma/client.js";

export function todayLocal() {
	// en-CA formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

export async function getMotsFlechesOTDByDate(date) {
	return prisma.motsFlechesOtd.findUnique({ where: { date } });
}

export async function getTodaysMotsFlechesOTD() {
	return getMotsFlechesOTDByDate(todayLocal());
}

export async function getMotsFlechesOTDById(id) {
	return prisma.motsFlechesOtd.findUnique({ where: { id } });
}

export async function insertMotsFlechesOTD(data) {
	return prisma.motsFlechesOtd.create({ data });
}

export async function listArchive(userId, limit = 60) {
	const rows = await prisma.motsFlechesOtd.findMany({
		orderBy: { date: "desc" },
		take: limit,
		select: { id: true, date: true, rows: true, cols: true, wordCount: true },
	});
	if (!userId) return rows.map((r) => ({ ...r, hasPlayed: false }));

	const played = await prisma.motsFlechesStat.findMany({
		where: { userId, otdId: { in: rows.map((r) => r.id) } },
		select: { otdId: true },
	});
	const playedSet = new Set(played.map((p) => p.otdId));
	return rows.map((r) => ({ ...r, hasPlayed: playedSet.has(r.id) }));
}

export async function getAllStatsForOTD(otdId) {
	return prisma.motsFlechesStat.findMany({
		where: { otdId },
		include: { user: { select: { id: true, username: true, globalName: true, avatarUrl: true } } },
		orderBy: [{ score: "desc" }, { cluesSolved: "desc" }, { time: "asc" }],
	});
}

export async function getUserStatForOTD(otdId, userId) {
	return prisma.motsFlechesStat.findUnique({ where: { otdId_userId: { otdId, userId } } });
}

export async function upsertUserStat({ otdId, userId, time, cluesSolved, score }) {
	const id = `${otdId}-${userId}`;
	return prisma.motsFlechesStat.upsert({
		where: { otdId_userId: { otdId, userId } },
		create: { id, otdId, userId, time, cluesSolved, score },
		update: { time, cluesSolved, score, completedAt: new Date() },
	});
}
