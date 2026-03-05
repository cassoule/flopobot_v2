import prisma from "../prisma/client.js";

export async function getCsSkin(id) {
	return prisma.csSkin.findUnique({ where: { id } });
}

export async function getUserCsInventory(userId) {
	return prisma.csSkin.findMany({
		where: { userId },
		orderBy: { price: "desc" },
	});
}

export async function getUserCsSkinsByRarity(userId, rarity) {
	return prisma.csSkin.findMany({
		where: { userId, rarity },
		orderBy: { price: "desc" },
	});
}

export async function insertCsSkin(data) {
	return prisma.csSkin.create({ data });
}

export async function updateCsSkin(data) {
	const { id, ...rest } = data;
	return prisma.csSkin.update({ where: { id }, data: rest });
}

export async function findReferenceSkin(marketHashName, isStattrak, isSouvenir) {
	return prisma.csSkin.findFirst({
		where: { marketHashName, isStattrak, isSouvenir, price: { not: null }, float: { not: null } },
		orderBy: { price: "desc" },
	});
}

export async function deleteCsSkin(id) {
	return prisma.csSkin.delete({ where: { id } });
}

export async function deleteManyCsSkins(ids) {
	return prisma.csSkin.deleteMany({ where: { id: { in: ids } } });
}
