import prisma from "../prisma/client.js";

function printLog(log) {
	const timestamp = log.createdAt.toISOString();
	return `[${timestamp}][${log.action.padEnd(25)}] @${log.userId} balance: ${log.userNewAmount.toString().padStart(12)} (${log.coinsAmount >= 0 ? "+" : ""}${log.coinsAmount})`;
}

export async function insertLog(data) {
	try {
		const log = await prisma.log.create({ data });
		console.log(printLog(log));
		return 0;
	} catch (error) {		
		console.error("Error inserting log:", error);
		return 1;
	}
}

export async function getLogs() {
	return prisma.log.findMany();
}

export async function getUserLogs(userId) {
	return prisma.log.findMany({ where: { userId } });
}

export async function pruneOldLogs() {
	const limit = parseInt(process.env.LOGS_BY_USER);
	const usersWithExcess = await prisma.$queryRawUnsafe(
		`SELECT user_id FROM logs GROUP BY user_id HAVING COUNT(*) > ?`,
		limit,
	);
	for (const row of usersWithExcess) {
		const userId = row.user_id;
		const logsToKeep = await prisma.log.findMany({
			where: { userId },
			orderBy: { createdAt: "desc" },
			take: limit,
			select: { id: true },
		});
		await prisma.log.deleteMany({
			where: {
				userId,
				id: { notIn: logsToKeep.map((l) => l.id) },
			},
		});
	}
}
