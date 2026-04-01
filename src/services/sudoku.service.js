import prisma from "../prisma/client.js";

export async function getSudokuOTD() {
	return prisma.sudokuOtd.findUnique({ where: { id: 0 } });
}

export async function insertSudokuOTD(data) {
	return prisma.sudokuOtd.create({ data: { id: 0, ...data } });
}

export async function deleteSudokuOTD() {
	return prisma.sudokuOtd.delete({ where: { id: 0 } }).catch(() => {});
}

export async function getAllSudokuOTDStats() {
	return prisma.sudokuStat.findMany({
		include: { user: { select: { username: true, globalName: true, avatarUrl: true } } },
		orderBy: [{ time: "asc" }],
	});
}

export async function getUserSudokuOTDStats(userId) {
	return prisma.sudokuStat.findFirst({ where: { userId } });
}

export async function insertSudokuOTDStats(data) {
	return prisma.sudokuStat.create({ data });
}

export async function clearSudokuOTDStats() {
	return prisma.sudokuStat.deleteMany();
}

export async function deleteUserSudokuOTDStats(userId) {
	return prisma.sudokuStat.deleteMany({ where: { userId } });
}
