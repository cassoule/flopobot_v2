import { csSkinsData, csSkinsPrices } from "./cs.state.js";
import { findReferenceSkin } from "../services/csSkin.service.js";

const StateFactoryNew = "Factory New";
const StateMinimalWear = "Minimal Wear";
const StateFieldTested = "Field-Tested";
const StateWellWorn = "Well-Worn";
const StateBattleScarred = "Battle-Scarred";

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

const basePriceRanges = {
	"Consumer Grade": { min: 1, max: 10 },
	"Industrial Grade": { min: 5, max: 50 },
	"Mil-Spec Grade": { min: 20, max: 150 },
	"Restricted": { min: 100, max: 1000 },
	"Classified": { min: 500, max: 4000 },
	"Covert": { min: 2500, max: 10000 },
	"Extraordinary": { min: 1500, max: 3000 },
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

export async function generatePrice(skinName, rarity, float, isStattrak, isSouvenir) {
	const ranges = basePriceRanges[rarity] || basePriceRanges["Industrial Grade"];

	let finalPrice;
	const ref = await findReferenceSkin(skinName, isStattrak, isSouvenir);

	if (ref && ref.float !== null) {
		// Derive base price from reference: refPrice = basePrice * (1 - refFloat) → basePrice = refPrice / (1 - refFloat)
		const refBasePrice = ref.price / Math.max(1 - ref.float, 0.01);
		finalPrice = refBasePrice * (1 - float);
	} else {
		// No reference: random base price, scaled by float
		const basePrice = ranges.min + Math.random() * (ranges.max - ranges.min);
		finalPrice = basePrice * (1 - float) + ranges.min * float;
	}

	const isGold = rarity === "Covert";
	if (isSouvenir && !isGold) {
		finalPrice *= 7;
	} else if (isStattrak && !isGold) {
		finalPrice *= 4;
	}

	if (finalPrice < 1) finalPrice = 1;

	const name = skinName.toLowerCase();

	// Special pattern multipliers (more specific patterns first)
	if (name.includes("marble fade")) {
		finalPrice *= 1.35;
	} else if (name.includes("gamma doppler")) {
		finalPrice *= 1.4;
	} else if (name.includes("doppler")) {
		finalPrice *= 1.5;
	} else if (name.includes("fade")) {
		finalPrice *= 1.4;
	} else if (name.includes("crimson web")) {
		finalPrice *= 1.3;
	} else if (name.includes("case hardened")) {
		finalPrice *= 1.25;
	} else if (name.includes("lore")) {
		finalPrice *= 1.25;
	} else if (name.includes("tiger tooth")) {
		finalPrice *= 1.2;
	} else if (name.includes("slaughter")) {
		finalPrice *= 1.2;
	}

	// Knife type boosts (more specific first)
	if (name.includes("butterfly")) {
		finalPrice *= 2;
	} else if (name.includes("karambit")) {
		finalPrice *= 1.8;
	} else if (name.includes("m9 bayonet")) {
		finalPrice *= 1.4;
	} else if (name.includes("talon")) {
		finalPrice *= 1.3;
	} else if (name.includes("skeleton")) {
		finalPrice *= 1.2;
	} else if (name.includes("bayonet")) {
		finalPrice *= 1.1;
	} else if (name.includes("gut") || name.includes("navaja") || name.includes("falchion")) {
		finalPrice *= 0.8;
	}

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
		price: await generatePrice(skinName, skinData.rarity.name, float, skinIsStattrak, skinIsSouvenir),
	};
}
