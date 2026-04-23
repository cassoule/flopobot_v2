import { csSkinsData, csSkinsPriceIndex, csSkinsVersionMap, weaponRarityPriceMap } from "./cs.state.js";

const StateFactoryNew = "Factory New";
const StateMinimalWear = "Minimal Wear";
const StateFieldTested = "Field-Tested";
const StateWellWorn = "Well-Worn";
const StateBattleScarred = "Battle-Scarred";

const EUR_TO_FLOPOS = parseInt(process.env.EUR_TO_FLOPOS) || 6;
const FLOAT_MODIFIER_MAX = 0.05;
const STATTRAK_FALLBACK_MULTIPLIER = 3.5;
const SOUVENIR_FALLBACK_MULTIPLIER = 6;

const WEAR_STATE_ORDER = [StateFactoryNew, StateMinimalWear, StateFieldTested, StateWellWorn, StateBattleScarred];
const WEAR_STATE_RANGES = {
	[StateFactoryNew]: { min: 0.0, max: 0.07 },
	[StateMinimalWear]: { min: 0.07, max: 0.15 },
	[StateFieldTested]: { min: 0.15, max: 0.38 },
	[StateWellWorn]: { min: 0.38, max: 0.45 },
	[StateBattleScarred]: { min: 0.45, max: 1.0 },
};

export const RarityToColor = {
	Gold: 0xffd700, // Standard Gold
	Extraordinary: 0xffae00, // Orange
	Covert: 0xeb4b4b, // Red
	Classified: 0xd32ce6, // Pink/Magenta
	Restricted: 0x8847ff, // Purple
	"Mil-Spec Grade": 0x4b69ff, // Dark Blue
	"Industrial Grade": 0x5e98d9, // Light Blue
	"Consumer Grade": 0xb0c3d9, // Light Grey/White
};

// Last-resort fallback price ranges in EUR (used only when Skinport has no data)
const basePriceRanges = {
	"Consumer Grade": { min: 0.03, max: 0.1 },
	"Industrial Grade": { min: 0.05, max: 0.3 },
	"Mil-Spec Grade": { min: 0.1, max: 1.5 },
	Restricted: { min: 1.0, max: 10.0 },
	Classified: { min: 5.0, max: 40.0 },
	Covert: { min: 25.0, max: 150.0 },
	Extraordinary: { min: 100.0, max: 800.0 },
};

export const TRADE_UP_MAP = {
	"Consumer Grade": "Industrial Grade",
	"Industrial Grade": "Mil-Spec Grade",
	"Mil-Spec Grade": "Restricted",
	Restricted: "Classified",
	Classified: "Covert",
};

export function randomSkinRarity() {
	const roll = Math.random();

	const goldLimit = 0.003;
	const extraLimit = goldLimit + 0.014;
	const classifiedLimit = extraLimit + 0.04;
	const restrictedLimit = classifiedLimit + 0.2;
	const milSpecLimit = restrictedLimit + 0.5;
	const industrialLimit = milSpecLimit + 0.2;

	if (roll < goldLimit) return "Covert";
	if (roll < extraLimit) return "Extraordinary";
	if (roll < classifiedLimit) return "Classified";
	if (roll < restrictedLimit) return "Restricted";
	if (roll < milSpecLimit) return "Mil-Spec Grade";
	if (roll < industrialLimit) return "Industrial Grade";
	return "Consumer Grade";
}

function getSkinportPrice(priceData) {
	if (!priceData) return null;
	return priceData.suggested_price ?? priceData.median_price ?? priceData.mean_price ?? priceData.min_price ?? null;
}

function applyFloatModifier(basePrice, float, wearState) {
	const range = WEAR_STATE_RANGES[wearState];
	if (!range) return basePrice;
	const span = range.max - range.min;
	if (span <= 0) return basePrice;
	// 0 = best float in range, 1 = worst
	const positionInRange = (float - range.min) / span;
	const modifier = 1 + FLOAT_MODIFIER_MAX * (1 - 2 * positionInRange);
	return basePrice * modifier;
}

function getAdjacentWearStates(wearState) {
	const idx = WEAR_STATE_ORDER.indexOf(wearState);
	if (idx === -1) return [];
	// Return wear states ordered by proximity
	const adjacent = [];
	for (let dist = 1; dist < WEAR_STATE_ORDER.length; dist++) {
		if (idx - dist >= 0) adjacent.push(WEAR_STATE_ORDER[idx - dist]);
		if (idx + dist < WEAR_STATE_ORDER.length) adjacent.push(WEAR_STATE_ORDER[idx + dist]);
	}
	return adjacent;
}

// Reads from the version-bucketed price index:
// csSkinsPriceIndex[baseName][variant][wearState][versionKey]  — versionKey "" for non-phased skins.
function getVersionedPrice(wearMap, wearState, versionKey) {
	const versionMap = wearMap?.[wearState];
	if (!versionMap) return null;
	// Prefer the exact version; fall back to the no-version bucket (e.g. Phase N missing but
	// the family has a no-version entry) — then to any other version to keep us in-family.
	if (versionMap[versionKey] !== undefined) {
		const p = getSkinportPrice(versionMap[versionKey]);
		if (p !== null) return p;
	}
	if (versionKey && versionMap[""] !== undefined) {
		const p = getSkinportPrice(versionMap[""]);
		if (p !== null) return p;
	}
	for (const [vk, data] of Object.entries(versionMap)) {
		if (vk === versionKey) continue;
		const p = getSkinportPrice(data);
		if (p !== null) return p;
	}
	return null;
}

function lookupSkinportEurPrice(skinName, wearState, isStattrak, isSouvenir, version) {
	const skinEntry = csSkinsPriceIndex[skinName];
	if (!skinEntry) return null;

	const variant = isSouvenir ? "souvenir" : isStattrak ? "stattrak" : "base";
	const versionKey = version || "";

	// 1. Exact match: correct variant + wear state + version
	let price = getVersionedPrice(skinEntry[variant], wearState, versionKey);
	if (price !== null) return price;

	// 2. Drop variant: use base price × multiplier
	if (variant !== "base") {
		const basePrice = getVersionedPrice(skinEntry["base"], wearState, versionKey);
		if (basePrice !== null) {
			const multiplier = isSouvenir ? SOUVENIR_FALLBACK_MULTIPLIER : STATTRAK_FALLBACK_MULTIPLIER;
			return basePrice * multiplier;
		}
	}

	// 3. Adjacent wear state (same variant, then base with multiplier)
	for (const adjWear of getAdjacentWearStates(wearState)) {
		const adjPrice = getVersionedPrice(skinEntry[variant], adjWear, versionKey);
		if (adjPrice !== null) return adjPrice;

		if (variant !== "base") {
			const adjBase = getVersionedPrice(skinEntry["base"], adjWear, versionKey);
			if (adjBase !== null) {
				const multiplier = isSouvenir ? SOUVENIR_FALLBACK_MULTIPLIER : STATTRAK_FALLBACK_MULTIPLIER;
				return adjBase * multiplier;
			}
		}
	}

	return null;
}

// FNV-1a 32-bit hash — deterministic, tiny, dependency-free.
function hashString(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Returns the median base-variant Skinport price of every sibling skin sharing the
 * same weapon + rarity. Deterministic (no RNG), and robust against high-variance
 * buckets like ★ Karambit Covert where individual siblings span ~10×.
 */
function findSimilarSkinPrice(skinName, rarity, wearState) {
	const skinData = csSkinsData[skinName];
	const weapon = skinData?.weapon?.name;
	if (!weapon) return null;

	const candidates = weaponRarityPriceMap[weapon]?.[rarity];
	if (!candidates || candidates.length === 0) return null;

	// For phased families, fall back to the median across the same-family siblings of the
	// same weapon+rarity bucket — same logic as before, just using the new nested shape.
	const prices = [];
	for (const candidate of candidates) {
		if (candidate === skinName) continue;
		const entry = csSkinsPriceIndex[candidate];
		if (!entry) continue;
		let p = getVersionedPrice(entry["base"], wearState, "");
		if (p === null) {
			for (const ws of WEAR_STATE_ORDER) {
				const alt = getVersionedPrice(entry["base"], ws, "");
				if (alt !== null) {
					p = alt;
					break;
				}
			}
		}
		if (p !== null) prices.push(p);
	}
	if (prices.length === 0) return null;

	prices.sort((a, b) => a - b);
	const mid = prices.length >> 1;
	return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

export function generatePrice(skinName, rarity, float, isStattrak, isSouvenir, version = null) {
	const wearState = getWearState(float);
	let eurPrice = lookupSkinportEurPrice(skinName, wearState, isStattrak, isSouvenir, version);

	if (eurPrice === null) {
		// 4. Similar skin: same weapon + same rarity
		eurPrice = findSimilarSkinPrice(skinName, rarity, wearState);
	}

	if (eurPrice === null) {
		// 5. Last resort: rarity-based range, seeded by a hash of the skin identity
		// so the same skin always gets the same price across refreshes.
		const ranges = basePriceRanges[rarity] || basePriceRanges["Industrial Grade"];
		const seed = hashString(`${skinName}|${version || ""}|${wearState}|${isStattrak ? 1 : 0}|${isSouvenir ? 1 : 0}`);
		const ratio = (seed % 10000) / 10000;
		eurPrice = ranges.min + ratio * (ranges.max - ranges.min);
	}

	let finalPrice = Math.round(eurPrice * EUR_TO_FLOPOS);
	finalPrice = applyFloatModifier(finalPrice, float, wearState);
	finalPrice = Math.max(Math.round(finalPrice), 1);

	return finalPrice.toFixed(0);
}

export function rollStattrak(canBeStattrak) {
	if (!canBeStattrak) return false;
	return Math.random() < 0.15;
}

export function rollSouvenir(canBeSouvenir) {
	if (!canBeSouvenir) return false;
	return Math.random() < 0.15;
}

export function getRandomFloatInRange(min, max) {
	return min + Math.random() * (max - min);
}

export function getWearState(wear) {
	const clamped = Math.max(0.0, Math.min(1.0, wear));

	if (clamped < 0.07) return StateFactoryNew;
	if (clamped < 0.15) return StateMinimalWear;
	if (clamped < 0.38) return StateFieldTested;
	if (clamped < 0.45) return StateWellWorn;
	return StateBattleScarred;
}

export async function getRandomSkinWithRandomSpecs(u_float, forcedRarity) {
	const skinNames = Object.keys(csSkinsData);
	const selectedRarity = forcedRarity || randomSkinRarity();
	const filteredSkinNames = skinNames.filter((name) => csSkinsData[name].rarity.name === selectedRarity);
	const randomIndex = Math.floor(Math.random() * filteredSkinNames.length);

	const skinName = filteredSkinNames[randomIndex];
	const skinData = csSkinsData[skinName];

	// Phased/gem families (Gamma Doppler Phase 1-4, Doppler Ruby, etc.) share one market_hash_name
	// on Skinport — the variant is reported via a separate `version` field. Roll one uniformly so
	// the draw mirrors CS2's real behavior and the price reflects the specific variant.
	const versions = csSkinsVersionMap[skinName];
	const version = versions && versions.length > 0 ? versions[Math.floor(Math.random() * versions.length)] : null;

	const float =
		u_float !== null && u_float !== undefined ? u_float : getRandomFloatInRange(skinData.min_float, skinData.max_float);
	const wearState = getWearState(float);
	const skinIsStattrak = rollStattrak(skinData.stattrak);
	const skinIsSouvenir = rollSouvenir(skinData.souvenir);

	return {
		name: skinName,
		data: skinData,
		version,
		isStattrak: skinIsStattrak,
		isSouvenir: skinIsSouvenir,
		wearState,
		float,
		price: generatePrice(skinName, skinData.rarity.name, float, skinIsStattrak, skinIsSouvenir, version),
	};
}
