export let csSkinsData = {};

// Raw Skinport data, grouped by market_hash_name then by version ("" for no-version).
// Shape: { [market_hash_name]: { [version || ""]: { suggested_price, min_price, ... } } }
export let csSkinsPrices = {};

// Structured index: baseSkinName -> variant (base|stattrak|souvenir)
//                -> wearState -> { [version || ""]: priceData }
export let csSkinsPriceIndex = {};

// weaponType -> rarity -> [baseSkinName, ...] (only skins that have Skinport prices)
export let weaponRarityPriceMap = {};

// Base skin name (e.g. "★ Karambit | Gamma Doppler") -> [versionName, ...]
// Populated only from Skinport rows whose `version` field is set.
export let csSkinsVersionMap = {};

const wearRegex = /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/;

function parseSkinportKey(key) {
	const wearMatch = key.match(wearRegex);
	if (!wearMatch) return null;

	const wearState = wearMatch[1];
	let baseName = key.slice(0, wearMatch.index);
	let variant = "base";

	if (baseName.startsWith("★ StatTrak™ ")) {
		variant = "stattrak";
		baseName = "★ " + baseName.slice("★ StatTrak™ ".length);
	} else if (baseName.startsWith("StatTrak™ ")) {
		variant = "stattrak";
		baseName = baseName.slice("StatTrak™ ".length);
	} else if (baseName.startsWith("Souvenir ")) {
		variant = "souvenir";
		baseName = baseName.slice("Souvenir ".length);
	}

	return { baseName, variant, wearState };
}

export function buildPriceIndex() {
	csSkinsPriceIndex = {};

	for (const [hash, byVersion] of Object.entries(csSkinsPrices)) {
		const parsed = parseSkinportKey(hash);
		if (!parsed) continue;
		const { baseName, variant, wearState } = parsed;

		if (!csSkinsPriceIndex[baseName]) csSkinsPriceIndex[baseName] = {};
		if (!csSkinsPriceIndex[baseName][variant]) csSkinsPriceIndex[baseName][variant] = {};
		if (!csSkinsPriceIndex[baseName][variant][wearState]) csSkinsPriceIndex[baseName][variant][wearState] = {};

		for (const [versionKey, priceData] of Object.entries(byVersion)) {
			csSkinsPriceIndex[baseName][variant][wearState][versionKey] = priceData;
		}
	}

	const indexedCount = Object.keys(csSkinsPriceIndex).length;
	const totalSkins = Object.keys(csSkinsData).length;
	const coverage = totalSkins > 0 ? ((indexedCount / totalSkins) * 100).toFixed(1) : 0;
	console.log(
		`[Skinport] Price index built: ${indexedCount} skins indexed, ${totalSkins} total skins (${coverage}% coverage)`,
	);
}

export function buildWeaponRarityPriceMap() {
	weaponRarityPriceMap = {};

	for (const [skinName, skinData] of Object.entries(csSkinsData)) {
		// Only include skins that have at least one Skinport price entry
		if (!csSkinsPriceIndex[skinName]) continue;

		const weapon = skinData.weapon?.name;
		const rarity = skinData.rarity?.name;
		if (!weapon || !rarity) continue;

		if (!weaponRarityPriceMap[weapon]) {
			weaponRarityPriceMap[weapon] = {};
		}
		if (!weaponRarityPriceMap[weapon][rarity]) {
			weaponRarityPriceMap[weapon][rarity] = [];
		}
		weaponRarityPriceMap[weapon][rarity].push(skinName);
	}

	console.log(`[Skinport] Weapon/rarity price map built: ${Object.keys(weaponRarityPriceMap).length} weapon types`);
}

export function buildVersionMap() {
	csSkinsVersionMap = {};
	// Walk the full price index and collect any non-empty version keys per base skin.
	for (const [baseName, variants] of Object.entries(csSkinsPriceIndex)) {
		const versions = new Set();
		for (const wearMap of Object.values(variants)) {
			for (const versionMap of Object.values(wearMap)) {
				for (const versionKey of Object.keys(versionMap)) {
					if (versionKey) versions.add(versionKey);
				}
			}
		}
		if (versions.size > 0) csSkinsVersionMap[baseName] = Array.from(versions);
	}
	console.log(`[Skinport] Version map built: ${Object.keys(csSkinsVersionMap).length} phased families`);
}
