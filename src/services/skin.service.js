import prisma from "../prisma/client.js";

export async function getSkin(uuid) {
	return prisma.skin.findUnique({ where: { uuid } });
}

export async function getAllSkins() {
	return prisma.skin.findMany({ orderBy: { maxPrice: "desc" } });
}

export async function getAllAvailableSkins() {
	return prisma.skin.findMany({ where: { userId: null } });
}

export async function getUserInventory(userId) {
	return prisma.skin.findMany({
		where: { userId },
		orderBy: { currentPrice: "desc" },
	});
}

export async function getTopSkins() {
	return prisma.skin.findMany({ orderBy: { maxPrice: "desc" }, take: 10 });
}

export async function insertSkin(data) {
	return prisma.skin.create({ data });
}

export async function updateSkin(data) {
	const { uuid, ...rest } = data;
	return prisma.skin.update({ where: { uuid }, data: rest });
}

export async function hardUpdateSkin(data) {
	const { uuid, ...rest } = data;
	return prisma.skin.update({ where: { uuid }, data: rest });
}

export async function insertManySkins(skins) {
	return prisma.$transaction(
		skins.map((skin) =>
			prisma.skin.upsert({
				where: { uuid: skin.uuid },
				update: {},
				create: skin,
			}),
		),
	);
}

export async function updateManySkins(skins) {
	return prisma.$transaction(
		skins.map((skin) => {
			const { uuid, ...data } = skin;
			return prisma.skin.update({ where: { uuid }, data });
		}),
	);
}
