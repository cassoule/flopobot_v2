import prisma from "../prisma/client.js";

export async function getSOTD() {
	return prisma.sotd.findUnique({ where: { id: 0 } });
}

export async function insertSOTD(data) {
	return prisma.sotd.create({ data: { id: 0, ...data } });
}

export async function deleteSOTD() {
	return prisma.sotd.delete({ where: { id: 0 } }).catch(() => {});
}

export async function getAllSOTDStats() {
	const stats = await prisma.sotdStat.findMany({
		include: { user: { select: { globalName: true } } },
		orderBy: [{ score: "desc" }, { moves: "asc" }, { time: "asc" }],
	});
	return stats.map((s) => ({
		...s,
		globalName: s.user?.globalName,
	}));
}

export async function getUserSOTDStats(userId) {
	return prisma.sotdStat.findFirst({ where: { userId } });
}

export async function insertSOTDStats(data) {
	return prisma.sotdStat.create({ data });
}

export async function clearSOTDStats() {
	return prisma.sotdStat.deleteMany();
}

export async function deleteUserSOTDStats(userId) {
	return prisma.sotdStat.deleteMany({ where: { userId } });
}
