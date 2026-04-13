import prisma from "../prisma/client.js";
import { getLoadoutSlot } from "../utils/cs.utils.js";

export async function getCsSkin(id) {
	return prisma.csSkin.findUnique({ where: { id } });
}

export async function getUserCsInventory(userId) {
	return prisma.csSkin.findMany({
		where: { userId, loadoutSlot: null },
		orderBy: { price: "desc" },
	});
}

export async function getUserLoadout(userId) {
	const skins = await prisma.csSkin.findMany({
		where: { userId, loadoutSlot: { not: null } },
		orderBy: { price: "desc" },
	});

	// Self-heal: fix loadoutSlot values set by the old buggy code
	// (e.g., "★ Sport Gloves" → "gloves", "★ Karambit" → "knife")
	const toFix = skins.filter((s) => getLoadoutSlot(s) !== s.loadoutSlot);
	if (toFix.length > 0) {
		await prisma.$transaction(
			toFix.map((s) =>
				prisma.csSkin.update({ where: { id: s.id }, data: { loadoutSlot: getLoadoutSlot(s) } }),
			),
		);
		for (const s of toFix) s.loadoutSlot = getLoadoutSlot(s);
	}

	return skins;
}

export async function equipSkin(userId, skinId, slot) {
	// Find all equipped skins for this user that map to the same logical slot
	// (handles both the current format and legacy formats like "★ Sport Gloves")
	const allEquipped = await prisma.csSkin.findMany({
		where: { userId, loadoutSlot: { not: null } },
		select: { id: true, marketHashName: true, loadoutSlot: true },
	});
	const conflicting = allEquipped.filter((s) => s.id !== skinId && getLoadoutSlot(s) === slot);

	return prisma.$transaction([
		// Clear all conflicting skins (whether they have old or new slot format)
		...conflicting.map((s) =>
			prisma.csSkin.update({ where: { id: s.id }, data: { loadoutSlot: null, loadoutPriceUpdatedAt: null } }),
		),
		// Equip the target skin
		prisma.csSkin.update({
			where: { id: skinId },
			data: { loadoutSlot: slot },
		}),
	]);
}

export async function unequipSkin(skinId, userId) {
	return prisma.csSkin.update({
		where: { id: skinId, userId },
		data: { loadoutSlot: null, loadoutPriceUpdatedAt: null },
	});
}

export async function getAllEquippedSkins() {
	return prisma.csSkin.findMany({
		where: { loadoutSlot: { not: null } },
	});
}

export async function updateLoadoutSkinPrice(skinId, price) {
	return prisma.csSkin.update({
		where: { id: skinId },
		data: { price, loadoutPriceUpdatedAt: new Date() },
	});
}

export async function getUserCsSkinsByRarity(userId, rarity) {
	return prisma.csSkin.findMany({
		where: { userId, rarity },
		orderBy: { price: "desc" },
	});
}

export async function getAllOwnedCsSkins() {
	return prisma.csSkin.findMany({
		where: { userId: { not: null } },
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
