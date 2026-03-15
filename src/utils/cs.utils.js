import { csSkinsData, csSkinsPriceIndex, weaponRarityPriceMap } from "./cs.state.js";

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
	[StateFactoryNew]:    { min: 0.00, max: 0.07 },
	[StateMinimalWear]:   { min: 0.07, max: 0.15 },
	[StateFieldTested]:   { min: 0.15, max: 0.38 },
	[StateWellWorn]:      { min: 0.38, max: 0.45 },
	[StateBattleScarred]: { min: 0.45, max: 1.00 },
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
	"Consumer Grade": { min: 0.03, max: 0.10 },
	"Industrial Grade": { min: 0.05, max: 0.30 },
	"Mil-Spec Grade": { min: 0.10, max: 1.50 },
	"Restricted": { min: 1.00, max: 10.00 },
	"Classified": { min: 5.00, max: 40.00 },
	"Covert": { min: 25.00, max: 150.00 },
	"Extraordinary": { min: 100.00, max: 800.00 },
};

export const TRADE_UP_MAP = {
	"Consumer Grade": "Industrial Grade",
	"Industrial Grade": "Mil-Spec Grade",
	"Mil-Spec Grade": "Restricted",
	"Restricted": "Classified",
	"Classified": "Covert",
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

function lookupSkinportEurPrice(skinName, wearState, isStattrak, isSouvenir) {
	const skinEntry = csSkinsPriceIndex[skinName];
	if (!skinEntry) return null;

	const variant = isSouvenir ? "souvenir" : isStattrak ? "stattrak" : "base";

	// 1. Exact match: correct variant + wear state
	let price = getSkinportPrice(skinEntry[variant]?.[wearState]);
	if (price !== null) return price;

	// 2. Drop variant: use base price × multiplier
	if (variant !== "base") {
		const basePrice = getSkinportPrice(skinEntry["base"]?.[wearState]);
		if (basePrice !== null) {
			const multiplier = isSouvenir ? SOUVENIR_FALLBACK_MULTIPLIER : STATTRAK_FALLBACK_MULTIPLIER;
			return basePrice * multiplier;
		}
	}

	// 3. Adjacent wear state (same variant, then base with multiplier)
	for (const adjWear of getAdjacentWearStates(wearState)) {
		const adjPrice = getSkinportPrice(skinEntry[variant]?.[adjWear]);
		if (adjPrice !== null) return adjPrice;

		if (variant !== "base") {
			const adjBase = getSkinportPrice(skinEntry["base"]?.[adjWear]);
			if (adjBase !== null) {
				const multiplier = isSouvenir ? SOUVENIR_FALLBACK_MULTIPLIER : STATTRAK_FALLBACK_MULTIPLIER;
				return adjBase * multiplier;
			}
		}
	}

	return null;
}

function findSimilarSkinPrice(skinName, rarity, wearState) {
	const skinData = csSkinsData[skinName];
	const weapon = skinData?.weapon?.name;
	if (!weapon) return null;

	const candidates = weaponRarityPriceMap[weapon]?.[rarity];
	if (!candidates || candidates.length === 0) return null;

	// Pick a random candidate that has a price for this wear state
	const shuffled = [...candidates].sort(() => Math.random() - 0.5);
	for (const candidate of shuffled) {
		if (candidate === skinName) continue;
		const entry = csSkinsPriceIndex[candidate];
		if (!entry) continue;
		// Try base variant first
		const price = getSkinportPrice(entry["base"]?.[wearState]);
		if (price !== null) return price;
		// Try any wear state
		for (const ws of WEAR_STATE_ORDER) {
			const wsPrice = getSkinportPrice(entry["base"]?.[ws]);
			if (wsPrice !== null) return wsPrice;
		}
	}

	return null;
}

export function generatePrice(skinName, rarity, float, isStattrak, isSouvenir) {
	const wearState = getWearState(float);
	let eurPrice = lookupSkinportEurPrice(skinName, wearState, isStattrak, isSouvenir);

	if (eurPrice === null) {
		// 4. Similar skin: same weapon + same rarity
		eurPrice = findSimilarSkinPrice(skinName, rarity, wearState);
	}

	if (eurPrice === null) {
		// 5. Last resort: rarity-based random range (already in EUR-ish scale)
		const ranges = basePriceRanges[rarity] || basePriceRanges["Industrial Grade"];
		eurPrice = ranges.min + Math.random() * (ranges.max - ranges.min);
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
	const filteredSkinNames = skinNames.filter(name => csSkinsData[name].rarity.name === selectedRarity);
	const randomIndex = Math.floor(Math.random() * filteredSkinNames.length);

	const skinName = filteredSkinNames[randomIndex];
	const skinData = csSkinsData[skinName];
	const float = (u_float !== null && u_float !== undefined) ? u_float : getRandomFloatInRange(skinData.min_float, skinData.max_float);
	const wearState = getWearState(float);
	const skinIsStattrak = rollStattrak(skinData.stattrak);
	const skinIsSouvenir = rollSouvenir(skinData.souvenir);

	return {
		name: skinName,
		data: skinData,
		isStattrak: skinIsStattrak,
		isSouvenir: skinIsSouvenir,
		wearState,
		float,
		price: generatePrice(skinName, skinData.rarity.name, float, skinIsStattrak, skinIsSouvenir),
	};
}
