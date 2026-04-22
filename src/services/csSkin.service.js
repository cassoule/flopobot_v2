import prisma from "../prisma/client.js";
import { getCategoryForSkin, getWeaponKey, isWeaponAllowedOnSide, parseLoadoutSlot } from "../utils/cs.weapons.js";

// How long a skin stays locked in its loadout slot after being equipped.
// Guards against intra-hour price-snapshot arbitrage (prices refresh hourly).
export const LOADOUT_LOCK_HOURS = 24;
const LOADOUT_LOCK_MS = LOADOUT_LOCK_HOURS * 60 * 60 * 1000;

// Unlock-via-flopocoins pricing:
//   cost = currentPrice * UNLOCK_TIME_RATE * (remainingMs / LOCK_MS)
//        + max(0, currentPrice - equippedPrice)
// Fresher locks and larger unrealized gains cost more to skip.
const UNLOCK_TIME_RATE = 0.2;

/** Returns ms remaining on the lock, or 0 if unlocked (or never equipped). */
export function getLoadoutLockRemainingMs(skin) {
	if (!skin?.loadoutEquippedAt) return 0;
	const equippedAt = new Date(skin.loadoutEquippedAt).getTime();
	const elapsed = Date.now() - equippedAt;
	return Math.max(0, LOADOUT_LOCK_MS - elapsed);
}

function formatLockRemaining(ms) {
	const totalMinutes = Math.ceil(ms / 60000);
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	if (h > 0 && m > 0) return `${h}h ${m}m`;
	if (h > 0) return `${h}h`;
	return `${m}m`;
}

function lockError(skin) {
	const remaining = getLoadoutLockRemainingMs(skin);
	if (remaining <= 0) return null;
	const err = new Error(
		`${skin.displayName || "Ce skin"} est verrouillé dans son emplacement (${formatLockRemaining(remaining)} restant).`,
	);
	err.statusCode = 423;
	err.lockRemainingMs = remaining;
	return err;
}

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
	return prisma.csSkin.findMany({
		where: { userId, loadoutSlot: { not: null } },
		orderBy: { price: "desc" },
	});
}

/**
 * Equips a skin into a specific loadout slot.
 * Validates category + side + starting-pistol rules, and enforces
 * "one weapon per side" by clearing any other skin of the same weapon
 * on the same side.
 * @throws Error with a user-facing French message on validation failure.
 */
export async function equipSkin(userId, skinId, slot) {
	const parsed = parseLoadoutSlot(slot);
	if (!parsed) {
		const err = new Error("Slot invalide.");
		err.statusCode = 400;
		throw err;
	}
	const skin = await prisma.csSkin.findUnique({ where: { id: skinId } });
	if (!skin) {
		const err = new Error("Skin introuvable.");
		err.statusCode = 404;
		throw err;
	}
	if (skin.userId !== userId) {
		const err = new Error("Vous ne possédez pas ce skin.");
		err.statusCode = 403;
		throw err;
	}

	const category = getCategoryForSkin(skin);
	const weaponKey = getWeaponKey(skin);
	if (!category || category !== parsed.category) {
		const err = new Error("Ce skin n'appartient pas à cette catégorie.");
		err.statusCode = 400;
		throw err;
	}
	if (!isWeaponAllowedOnSide(weaponKey, parsed.side)) {
		const err = new Error(`Cette arme n'est pas disponible côté ${parsed.side.toUpperCase()}.`);
		err.statusCode = 400;
		throw err;
	}
	// Starting pistol: T-side must be Glock-18, CT-side must be USP-S or P2000.
	if (parsed.category === "starting") {
		if (parsed.side === "t" && weaponKey !== "Glock-18") {
			const err = new Error("Le pistolet de départ côté T est le Glock-18.");
			err.statusCode = 400;
			throw err;
		}
		if (parsed.side === "ct" && weaponKey !== "USP-S" && weaponKey !== "P2000") {
			const err = new Error("Le pistolet de départ côté CT doit être un USP-S ou un P2000.");
			err.statusCode = 400;
			throw err;
		}
	}

	// Find skins to clear: same target slot (other skin there), OR same weapon on same side
	// (except knife/gloves whose "weapon" would conflict across every slot — they have only 1 slot
	// per side anyway so the target-slot clear covers it).
	const sidePrefix = `${parsed.side}_`;
	const sideEquipped = await prisma.csSkin.findMany({
		where: { userId, loadoutSlot: { startsWith: sidePrefix } },
		select: { id: true, marketHashName: true, loadoutSlot: true, loadoutEquippedAt: true, displayName: true },
	});

	const toClear = [];
	for (const s of sideEquipped) {
		if (s.id === skinId) continue;
		if (s.loadoutSlot === slot) {
			toClear.push(s);
			continue;
		}
		// Duplicate weapon on same side check (only for actual weapons)
		if (weaponKey !== "knife" && weaponKey !== "gloves" && getWeaponKey(s) === weaponKey) {
			toClear.push(s);
		}
	}

	// Lock enforcement: the skin being moved (if already equipped) AND every skin about
	// to leave its slot must have passed the LOADOUT_LOCK_HOURS grace period.
	if (skin.loadoutSlot && skin.loadoutSlot !== slot) {
		const err = lockError(skin);
		if (err) throw err;
	}
	for (const s of toClear) {
		const err = lockError(s);
		if (err) throw err;
	}

	return prisma.$transaction([
		...toClear.map((s) =>
			prisma.csSkin.update({
				where: { id: s.id },
				data: {
					loadoutSlot: null,
					loadoutPriceUpdatedAt: null,
					loadoutEquippedAt: null,
					loadoutEquippedPrice: null,
				},
			}),
		),
		prisma.csSkin.update({
			where: { id: skinId },
			data: {
				loadoutSlot: slot,
				loadoutEquippedAt: new Date(),
				loadoutEquippedPrice: skin.price ?? 0,
			},
		}),
	]);
}

export async function unequipSkin(skinId, userId) {
	const skin = await prisma.csSkin.findUnique({ where: { id: skinId } });
	if (!skin || skin.userId !== userId) {
		const err = new Error("Skin introuvable.");
		err.statusCode = 404;
		throw err;
	}
	const err = lockError(skin);
	if (err) throw err;
	return prisma.csSkin.update({
		where: { id: skinId, userId },
		data: {
			loadoutSlot: null,
			loadoutPriceUpdatedAt: null,
			loadoutEquippedAt: null,
			loadoutEquippedPrice: null,
		},
	});
}

/**
 * Cost in flopocoins to skip a skin's remaining loadout lock.
 * 0 if the skin isn't currently locked.
 */
export function computeUnlockCost(skin) {
	const remainingMs = getLoadoutLockRemainingMs(skin);
	if (remainingMs <= 0) return 0;
	const currentPrice = skin.price ?? 0;
	const equippedPrice = skin.loadoutEquippedPrice ?? currentPrice;
	const timeComponent = currentPrice * UNLOCK_TIME_RATE * (remainingMs / LOADOUT_LOCK_MS);
	const gainComponent = Math.max(0, currentPrice - equippedPrice);
	return Math.max(1, Math.round(timeComponent + gainComponent));
}

/**
 * Spends flopocoins to clear the remaining lock on a skin the caller owns.
 * Keeps the skin equipped (only the lock fields are cleared).
 */
export async function unlockLoadoutSkin(skinId, userId) {
	const skin = await prisma.csSkin.findUnique({ where: { id: skinId } });
	if (!skin || skin.userId !== userId) {
		const err = new Error("Skin introuvable.");
		err.statusCode = 404;
		throw err;
	}
	if (!skin.loadoutSlot) {
		const err = new Error("Ce skin n'est pas équipé.");
		err.statusCode = 400;
		throw err;
	}
	const remainingMs = getLoadoutLockRemainingMs(skin);
	if (remainingMs <= 0) {
		const err = new Error("Ce skin n'est pas verrouillé.");
		err.statusCode = 400;
		throw err;
	}

	const cost = computeUnlockCost(skin);
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
	if (!user) {
		const err = new Error("Utilisateur introuvable.");
		err.statusCode = 404;
		throw err;
	}
	if ((user.coins ?? 0) < cost) {
		const err = new Error(`Flopocoins insuffisants (${cost} requis).`);
		err.statusCode = 402;
		throw err;
	}

	const [, updatedSkin] = await prisma.$transaction([
		prisma.user.update({ where: { id: userId }, data: { coins: { decrement: cost } } }),
		prisma.csSkin.update({
			where: { id: skinId },
			data: { loadoutEquippedAt: null, loadoutEquippedPrice: null },
		}),
	]);

	return { skin: updatedSkin, cost, newCoins: (user.coins ?? 0) - cost };
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

export async function insertSkinPriceHistory(csSkinId, price) {
	return prisma.csSkinPriceHistory.create({ data: { csSkinId, price } });
}

export async function insertManySkinPriceHistory(entries) {
	if (!entries || entries.length === 0) return 0;
	const result = await prisma.csSkinPriceHistory.createMany({ data: entries });
	return result.count;
}

export async function getSkinPriceHistory(csSkinId, days = 7) {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	return prisma.csSkinPriceHistory.findMany({
		where: { csSkinId, createdAt: { gte: cutoff } },
		orderBy: { createdAt: "asc" },
		select: { price: true, createdAt: true },
	});
}

export async function pruneOldSkinPriceHistory(days = 30) {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const result = await prisma.csSkinPriceHistory.deleteMany({
		where: { createdAt: { lt: cutoff } },
	});
	return result.count;
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
