import prisma from "../prisma/client.js";

export async function insertLog(data) {
	return prisma.log.create({ data });
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
		await prisma.$executeRawUnsafe(
			`DELETE FROM logs WHERE id IN (
				SELECT id FROM (
					SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
					FROM logs WHERE user_id = ?
				) WHERE rn > ?
			)`,
			userId,
			limit,
		);
	}
}
