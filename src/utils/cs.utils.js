import { csSkinsData, csSkinsPrices } from "./cs.state.js";

const StateFactoryNew = "Factory New";
const StateMinimalWear = "Minimal Wear";
const StateFieldTested = "Field-Tested";
const StateWellWorn = "Well-Worn";
const StateBattleScarred = "Battle-Scarred";

export const RarityToColor = {
	Gold: 0xffd700, // Standard Gold
	Covert: 0xeb4b4b, // Red
	Classified: 0xd32ce6, // Pink/Magenta
	Restricted: 0x8847ff, // Purple
	"Mil-Spec Grade": 0x4b69ff, // Dark Blue
	"Industrial Grade": 0x5e98d9, // Light Blue
	"Consumer Grade": 0xb0c3d9, // Light Grey/White
};

const basePriceRanges = {
	"Consumer Grade": { min: 1, max: 5 },
	"Industrial Grade": { min: 2, max: 10 },
	"Mil-Spec Grade": { min: 3, max: 70 },
	"Restricted": { min: 17, max: 400 },
	"Classified": { min: 70, max: 1700 },
	"Covert": { min: 350, max: 17000 },
	"Gold": { min: 10000, max: 100000 },
	"Extraordinary": { min: 10000, max: 100000 },
};

const wearStateMultipliers = {
	[StateFactoryNew]: 1,
	[StateMinimalWear]: 0.75,
	[StateFieldTested]: 0.65,
	[StateWellWorn]: 0.6,
	[StateBattleScarred]: 0.5,
};

export function randomSkinRarity() {
	const roll = Math.random();

	const goldLimit = 0.003;
	const covertLimit = goldLimit + 0.014;
	const classifiedLimit = covertLimit + 0.04;
	const restrictedLimit = classifiedLimit + 0.2;
    const milSpecLimit = restrictedLimit + 0.5;
    const industrialLimit = milSpecLimit + 0.2;

	if (roll < goldLimit) return "Extraordinary";
	if (roll < covertLimit) return "Covert";
	if (roll < classifiedLimit) return "Classified";
	if (roll < restrictedLimit) return "Restricted";
	if (roll < milSpecLimit) return "Mil-Spec Grade";
    if (roll < industrialLimit) return "Industrial Grade";
	return "Consumer Grade";
}

export function generatePrice(rarity, float, isStattrak, isSouvenir, wearState) {
	const ranges = basePriceRanges[rarity] || basePriceRanges["Industrial Grade"];
    console.log(ranges)

	let basePrice = ranges.min + (Math.random()) * (ranges.max - ranges.min);
    console.log(basePrice)

	const stateMultiplier = wearStateMultipliers[wearState] ?? 1.0;
    console.log(stateMultiplier)

	let finalPrice = basePrice * stateMultiplier;
    console.log(finalPrice)

	const isExtraordinary = rarity === "Extraordinary";

	if (isSouvenir && !isExtraordinary) {
		finalPrice *= 4 + (Math.random()) * (10.0 - 4);
	} else if (isStattrak && !isExtraordinary) {
		finalPrice *= 3 + (Math.random()) * (5.0 - 3);
	}
    console.log(finalPrice)
    finalPrice /= 1 + float; // Avoid division by zero and ensure float has a significant impact

	if (finalPrice < 1) finalPrice = 1;

	return finalPrice.toFixed(0);
}

export function isStattrak(canBeStattrak) {
	if (!canBeStattrak) return false;
	return Math.random() < 0.15;
}

export function isSouvenir(canBeSouvenir) {
	if (!canBeSouvenir) return false;
	return Math.random() < 0.15;
}

export function getRandomFloatInRange(min, max) {
	return min + (Math.random()) * (max - min);
}

export function getWearState(wear) {
	const clamped = Math.max(0.0, Math.min(1.0, wear));

	if (clamped < 0.07) return StateFactoryNew;
	if (clamped < 0.15) return StateMinimalWear;
	if (clamped < 0.38) return StateFieldTested;
	if (clamped < 0.45) return StateWellWorn;
	return StateBattleScarred;
}

export function getRandomSkinWithRandomSpecs(u_float=null) {
	const skinNames = Object.keys(csSkinsData);
    const randomRarity = randomSkinRarity();
    console.log(randomRarity)
    const filteredSkinNames = skinNames.filter(name => csSkinsData[name].rarity.name === randomRarity);
	const randomIndex = Math.floor(Math.random() * filteredSkinNames.length);

	const skinName = filteredSkinNames[randomIndex];
	const skinData = csSkinsData[skinName];
    const float = u_float !== null ? u_float : getRandomFloatInRange(skinData.min_float, skinData.max_float);
	return {
		name: skinName,
		data: skinData,
		isStattrak: isStattrak(skinData.stattrak),
		isSouvenir: isSouvenir(skinData.souvenir),
		wearState: getWearState(float),
        float: float,
        price: generatePrice(skinData.rarity.name, float, isStattrak(skinData.stattrak), isSouvenir(skinData.souvenir), getWearState(float)),
	};
}
