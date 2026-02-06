import prisma from "../prisma/client.js";

export async function insertTransaction(data) {
	return prisma.transaction.create({ data });
}

export async function getTransactionBySessionId(sessionId) {
	return prisma.transaction.findUnique({ where: { sessionId } });
}

export async function getAllTransactions() {
	return prisma.transaction.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getUserTransactions(userId) {
	return prisma.transaction.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	});
}
