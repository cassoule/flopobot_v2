import { getAllAvailableSkins, getSkin } from "../database/index.js";
import { skins } from "../game/state.js";
import { isChampionsSkin } from "./index.js";

export async function drawCaseContent(caseType = "standard", poolSize = 100) {
	if (caseType === "esport") {
		// Esport case: return all esport skins
		try {	
			const dbSkins = getAllAvailableSkins.all();
			const esportSkins = skins
				.filter((s) => dbSkins.find((dbSkin) => dbSkin.displayName.includes("Classic (VCT") && dbSkin.uuid === s.uuid))
				.map((s) => {
					const dbSkin = getSkin.get(s.uuid);
					return {
						...s, // Shallow copy to avoid mutating the imported 'skins' object
						tierColor: dbSkin?.tierColor,
					};
				});
			return esportSkins;
		} catch (e) {
			console.log(e);
		}
	}
	let tierWeights;
	switch (caseType) {
		case "standard":
			tierWeights = {
				"12683d76-48d7-84a3-4e09-6985794f0445": 50, // Select
				"0cebb8be-46d7-c12a-d306-e9907bfc5a25": 30, // Deluxe
				"60bca009-4182-7998-dee7-b8a2558dc369": 19, // Premium
				"e046854e-406c-37f4-6607-19a9ba8426fc": 1, // Exclusive
				"411e4a55-4e59-7757-41f0-86a53f101bb5": 0, // Ultra
			};
			break;
		case "premium":
			tierWeights = {
				"12683d76-48d7-84a3-4e09-6985794f0445": 25, // Select
				"0cebb8be-46d7-c12a-d306-e9907bfc5a25": 25, // Deluxe
				"60bca009-4182-7998-dee7-b8a2558dc369": 40, // Premium
				"e046854e-406c-37f4-6607-19a9ba8426fc": 8, // Exclusive
				"411e4a55-4e59-7757-41f0-86a53f101bb5": 2, // Ultra
			};
			break;
		case "ultra":
			tierWeights = {
				"12683d76-48d7-84a3-4e09-6985794f0445": 0, // Select
				"0cebb8be-46d7-c12a-d306-e9907bfc5a25": 0, // Deluxe
				"60bca009-4182-7998-dee7-b8a2558dc369": 33, // Premium
				"e046854e-406c-37f4-6607-19a9ba8426fc": 33, // Exclusive
				"411e4a55-4e59-7757-41f0-86a53f101bb5": 33, // Ultra
			};
			break;
		default:
			break;
	}

	try {
		const dbSkins = getAllAvailableSkins.all();
		const weightedPool = skins
			.filter((s) => dbSkins.find((dbSkin) => dbSkin.uuid === s.uuid))
			.filter((s) => {
				if (caseType === "ultra") {
					return !(s.displayName.toLowerCase().includes("vct") && s.displayName.toLowerCase().includes("classic"))
				} else {
					return !s.displayName.toLowerCase().includes("vct");
				}
			})
			.filter((s) => {
				if (caseType === "ultra") {
					return true
				} else {
					return isChampionsSkin(s.displayName) === false;
				}
			})
			.map((s) => {
				const dbSkin = getSkin.get(s.uuid);
				return {
					...s, // Shallow copy to avoid mutating the imported 'skins' object
					tierColor: dbSkin?.tierColor,
					weight: tierWeights[s.contentTierUuid] ?? 0,
				};
			})
			.filter((s) => s.weight > 0); // <--- CRITICAL: Remove 0 weight skins

		function weightedSample(arr, count) {
			let totalWeight = arr.reduce((sum, x) => sum + x.weight, 0);
			const list = [...arr];
			const result = [];

			// 2. Adjust count if the pool is smaller than requested
			const actualCount = Math.min(count, list.length) ;

			for (let i = 0; i < actualCount; i++) {
				let r = Math.random() * totalWeight;
				let running = 0;
				let pickIndex = -1;

				for (let j = 0; j < list.length; j++) {
					running += list[j].weight;
					// Changed to strictly less than for safer bounds,
					// though filtering weight > 0 above is the primary fix.
					if (r <= running) {
						pickIndex = j;
						break;
					}
				}

				if (pickIndex < 0) pickIndex = list.length - 1;

				const picked = list.splice(pickIndex, 1)[0];
				result.push(picked);
				totalWeight -= picked.weight;

				if (totalWeight <= 0) break; // Stop if no more weight exists
			}

			return result;
		}

		return poolSize === -1 ? weightedPool : weightedSample(weightedPool, poolSize);
	} catch (e) {
		console.log(e);
	}
}

export function drawCaseSkin(caseContent) {
	let randomSelectedSkinIndex;
	let randomSelectedSkinUuid;
	try {
		randomSelectedSkinIndex = Math.floor(Math.random() * (caseContent.length - 1));
		randomSelectedSkinUuid = caseContent[randomSelectedSkinIndex].uuid;
	} catch (e) {
		console.log(e);
		throw new Error("Failed to draw a skin from the case content.");
	}

	const dbSkin = getSkin.get(randomSelectedSkinUuid);
	const randomSkinData = skins.find((skin) => skin.uuid === dbSkin.uuid);
	if (!randomSkinData) {
		throw new Error(`Could not find skin data for UUID: ${dbSkin.uuid}`);
	}

	// --- Randomize Level and Chroma ---
	const randomLevel = Math.floor(Math.random() * randomSkinData.levels.length) + 1;
	let randomChroma = 1;
	if (randomLevel === randomSkinData.levels.length && randomSkinData.chromas.length > 1) {
		// Ensure chroma is at least 1 and not greater than the number of chromas
		randomChroma = Math.floor(Math.random() * randomSkinData.chromas.length) + 1;
	}

	// --- Calculate Price ---
	const calculatePrice = () => {
		let result = parseFloat(dbSkin.basePrice);
		result *= 1 + randomLevel / Math.max(randomSkinData.levels.length, 2);
		result *= 1 + randomChroma / 4;
		return parseFloat(result.toFixed(0));
	};
	const finalPrice = calculatePrice();

	return {
		caseContent,
		finalPrice,
		randomLevel,
		randomChroma,
		randomSkinData,
		randomSelectedSkinUuid,
		randomSelectedSkinIndex,
	};
}

export function getSkinUpgradeProbs(skin, skinData) {
	const successProb =
		(1 - (((skin.currentChroma + skin.currentLvl + skinData.chromas.length + skinData.levels.length) / 18) * (parseInt(skin.tierRank) / 4)))/1.5;
	const destructionProb = ((skin.currentChroma + skinData.levels.length) / (skinData.chromas.length + skinData.levels.length)) * (parseInt(skin.tierRank) / 5) * 0.075;
	const nextLvl = skin.currentLvl < skinData.levels.length ? skin.currentLvl + 1 : skin.currentLvl;
	const nextChroma = skin.currentLvl === skinData.levels.length && skin.currentChroma < skinData.chromas.length ? skin.currentChroma + 1 : skin.currentChroma;
	const calculateNextPrice = () => {
		let result = parseFloat(skin.basePrice);
		result *= 1 + nextLvl / Math.max(skinData.levels.length, 2);
		result *= 1 + nextChroma / 4;
		return parseFloat(result.toFixed(0));
	};
	const diff = calculateNextPrice() - parseFloat(skin.currentPrice);
	const upgradePrice = Math.max(Math.floor(diff * successProb), 1);
	return { successProb, destructionProb, upgradePrice };
}

export function getDummySkinUpgradeProbs(skinLevel, skinChroma, skinTierRank, skinMaxLevels, skinMaxChromas, skinMaxPrice) {
	const successProb =
		1 - (((skinChroma + skinLevel + (skinMaxChromas + skinMaxLevels)) / 18) * (parseInt(skinTierRank) / 4));
	const destructionProb = ((skinChroma + skinMaxLevels) / (skinMaxChromas + skinMaxLevels)) * (parseInt(skinTierRank) / 5) * 0.1;
	const upgradePrice = Math.max(Math.floor((parseFloat(skinMaxPrice) * (1 - successProb))), 1);
	return { successProb, destructionProb, upgradePrice };
}
