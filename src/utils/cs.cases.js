import { csSkinsData, csSkinsPriceIndex } from "./cs.state.js";
import { generatePrice, getRandomFloatInRange, getWearState, rollSouvenir, rollStattrak } from "./cs.utils.js";

const EUR_TO_FLOPOS = parseInt(process.env.EUR_TO_FLOPOS) || 6;
const STARTER_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.0001 },
	{ rarity: "Covert", weight: 0.0001 },
	{ rarity: "Classified", weight: 0.003 },
	{ rarity: "Restricted", weight: 0.015 },
	{ rarity: "Mil-Spec Grade", weight: 0.5 },
	{ rarity: "Industrial Grade", weight: 0.23 },
	{ rarity: "Consumer Grade", weight: 0.2518 },
];

const STANDARD_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.0026 },
	{ rarity: "Covert", weight: 0.0064 },
	{ rarity: "Classified", weight: 0.045 },
	{ rarity: "Restricted", weight: 0.18 },
	{ rarity: "Mil-Spec Grade", weight: 0.6 },
	{ rarity: "Industrial Grade", weight: 0.06 },
	{ rarity: "Consumer Grade", weight: 0.105 },
];

const PREMIUM_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.02 },
	{ rarity: "Covert", weight: 0.04 },
	{ rarity: "Classified", weight: 0.1 },
	{ rarity: "Restricted", weight: 0.25 },
	{ rarity: "Mil-Spec Grade", weight: 0.55 },
	{ rarity: "Industrial Grade", weight: 0.02 },
	{ rarity: "Consumer Grade", weight: 0.02 },
];

const ELITE_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.06 },
	{ rarity: "Covert", weight: 0.1 },
	{ rarity: "Classified", weight: 0.22 },
	{ rarity: "Restricted", weight: 0.32 },
	{ rarity: "Mil-Spec Grade", weight: 0.3 },
];

const FLAGSHIP_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.2 },
	{ rarity: "Covert", weight: 0.2 },
	{ rarity: "Classified", weight: 0.2 },
	{ rarity: "Restricted", weight: 0.2 },
	{ rarity: "Mil-Spec Grade", weight: 0.1 },
];

const CASE_DEFINITIONS = [
	{ id: "case_starter", name: "Starter Case", price: 100, color: "#b0c3d9", rarityOdds: STARTER_RARITY_ODDS },
	{ id: "case_standard", name: "Standard Case", price: 250, color: "#5e98d9", rarityOdds: STANDARD_RARITY_ODDS },
	{ id: "case_premium", name: "Premium Case", price: 500, color: "#8847ff", rarityOdds: PREMIUM_RARITY_ODDS },
	{ id: "case_elite", name: "Elite Case", price: 1000, color: "#d32ce6", rarityOdds: ELITE_RARITY_ODDS },
	{ id: "case_flagship", name: "Flopo Case", price: 2000, color: "#eb4b4b", rarityOdds: FLAGSHIP_RARITY_ODDS },
];

const WEAR_STATES = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

const FALLBACK_EUR_BY_RARITY = {
	"Consumer Grade": 0.06,
	"Industrial Grade": 0.15,
	"Mil-Spec Grade": 0.8,
	Restricted: 5.0,
	Classified: 20.0,
	Covert: 80.0,
	Extraordinary: 400.0,
};

let poolByRarity = {}; // rarity -> [skinName, ...]
let poolAvgByRarity = {}; // rarity -> avg estimated value (for EV reporting)
let skinValueCache = {};
let caseRegistry = {};

function caseOdds(caseDef) {
	return caseDef.rarityOdds || DEFAULT_RARITY_ODDS;
}

function estimateSkinValue(skinName) {
	if (skinValueCache[skinName] != null) return skinValueCache[skinName];
	const skin = csSkinsData[skinName];
	if (!skin) return (skinValueCache[skinName] = 0);
	const rarity = skin.rarity?.name;
	const entry = csSkinsPriceIndex[skinName];

	// Index shape: csSkinsPriceIndex[base][variant][wearState] = { [versionKey]: priceData }.
	// versionKey is "" for non-phased skins; phased families (e.g. Doppler) hold one
	// entry per phase. Average across every wear state and every version for a stable
	// per-skin value used in EV reporting.
	const prices = [];
	if (entry?.base) {
		for (const ws of WEAR_STATES) {
			const versionMap = entry.base[ws];
			if (!versionMap) continue;
			for (const p of Object.values(versionMap)) {
				const v = p?.suggested_price ?? p?.median_price ?? p?.mean_price ?? p?.min_price;
				if (typeof v === "number" && v > 0) prices.push(v);
			}
		}
	}
	const eur =
		prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : (FALLBACK_EUR_BY_RARITY[rarity] ?? 0.1);
	const value = Math.max(1, Math.round(eur * EUR_TO_FLOPOS));
	skinValueCache[skinName] = value;
	return value;
}

function avgValue(skinList) {
	if (!skinList || skinList.length === 0) return 0;
	return skinList.reduce((s, n) => s + estimateSkinValue(n), 0) / skinList.length;
}

function evForCase(caseDef) {
	const odds = caseOdds(caseDef);
	const active = odds.filter((o) => poolByRarity[o.rarity]?.length > 0);
	if (active.length === 0) return 0;
	const total = active.reduce((s, o) => s + o.weight, 0);
	let ev = 0;
	for (const { rarity, weight } of active) {
		ev += (weight / total) * (poolAvgByRarity[rarity] || 0);
	}
	return ev;
}

export function buildCaseRegistry() {
	poolByRarity = {};
	poolAvgByRarity = {};
	skinValueCache = {};
	caseRegistry = {};

	for (const [name, data] of Object.entries(csSkinsData)) {
		const r = data.rarity?.name;
		if (!r) continue;
		if (!poolByRarity[r]) poolByRarity[r] = [];
		poolByRarity[r].push(name);
	}

	for (const r of Object.keys(poolByRarity)) {
		poolAvgByRarity[r] = avgValue(poolByRarity[r]);
	}

	for (const def of CASE_DEFINITIONS) {
		caseRegistry[def.id] = {
			...def,
			ev: evForCase(def),
			activeRarities: caseOdds(def)
				.map((o) => o.rarity)
				.filter((r) => poolByRarity[r]?.length > 0),
		};
	}

	console.log(`[CS Cases] ${Object.keys(caseRegistry).length} cases built:`);
	for (const c of Object.values(caseRegistry)) {
		const oddsLabel = c.rarityOdds ? "custom" : "canonical";
		const oddsSummary = caseOdds(c)
			.map((o) => `${o.rarity.split(" ")[0].slice(0, 5)}=${(o.weight * 100).toFixed(2)}%`)
			.join(" ");
		console.log(
			`  - ${c.name.padEnd(15)} ${String(c.price).padStart(4)} FC: ` +
				`EV ${c.ev.toFixed(0).padStart(5)} (${((c.ev / c.price) * 100).toFixed(1).padStart(5)}%) ` +
				`| odds ${oddsLabel} | ${oddsSummary}`,
		);
	}

	// Per-rarity pool sizes and averages — useful for hand-tuning odds.
	console.log(`[CS Cases] Pool stats per rarity:`);
	for (const r of Object.keys(poolByRarity)) {
		console.log(
			`  - ${r.padEnd(18)} count=${String(poolByRarity[r].length).padStart(5)}  avg=${poolAvgByRarity[r].toFixed(0)} FC`,
		);
	}

	const orphans = findOrphanSkins();
	if (orphans.length > 0) {
		console.warn(
			`[CS Cases] ${orphans.length} skins not reachable through any case (rarity not used by any case definition).`,
		);
	} else {
		console.log(`[CS Cases] All skins reachable.`);
	}
}

export function getAllCases() {
	return Object.values(caseRegistry).map((c) => ({
		id: c.id,
		name: c.name,
		price: c.price,
		color: c.color,
		ev: c.ev,
		activeRarities: c.activeRarities,
	}));
}

export function getCaseById(id) {
	return caseRegistry[id] || null;
}

export function findCaseByName(query) {
	if (!query) return null;
	const lower = query.toLowerCase();
	const cases = Object.values(caseRegistry);
	const exact = cases.find((c) => c.name.toLowerCase() === lower || c.id === lower);
	if (exact) return exact;
	return cases.find((c) => c.name.toLowerCase().includes(lower) || c.id.toLowerCase().includes(lower)) || null;
}

export function getCaseContents(caseId) {
	const c = getCaseById(caseId);
	if (!c) return null;
	const contents = {};
	for (const { rarity, weight } of caseOdds(c)) {
		if (!poolByRarity[rarity]) continue;
		contents[rarity] = { weight, skins: [...poolByRarity[rarity]] };
	}
	return {
		id: c.id,
		name: c.name,
		price: c.price,
		color: c.color,
		ev: c.ev,
		skinsByRarity: contents,
	};
}

export function findOrphanSkins() {
	// A skin is "orphan" if its rarity isn't included in any case's odds.
	const usedRarities = new Set();
	for (const c of Object.values(caseRegistry)) {
		for (const { rarity } of caseOdds(c)) usedRarities.add(rarity);
	}
	const orphans = [];
	for (const [name, data] of Object.entries(csSkinsData)) {
		const r = data.rarity?.name;
		if (!r || !usedRarities.has(r)) {
			orphans.push({ name, rarity: r || "Unknown" });
		}
	}
	return orphans;
}

function rollRarityForCase(caseDef) {
	const odds = caseOdds(caseDef);
	const active = odds.filter((o) => poolByRarity[o.rarity]?.length > 0);
	if (active.length === 0) return null;
	const total = active.reduce((s, o) => s + o.weight, 0);
	let r = Math.random() * total;
	for (const odd of active) {
		if (r < odd.weight) return odd.rarity;
		r -= odd.weight;
	}
	return active[active.length - 1].rarity;
}

export async function openCase(caseId, options = {}) {
	const caseDef = caseRegistry[caseId];
	if (!caseDef) return null;

	const rarity = options.forcedRarity || rollRarityForCase(caseDef);
	if (!rarity) return null;

	const pool = poolByRarity[rarity];
	if (!pool || pool.length === 0) return null;

	const skinName = pool[Math.floor(Math.random() * pool.length)];
	const skinData = csSkinsData[skinName];
	const minFloat = skinData.min_float ?? 0;
	const maxFloat = skinData.max_float ?? 1;
	const float = options.float ?? getRandomFloatInRange(minFloat, maxFloat);
	const wearState = getWearState(float);
	const isStattrak = rollStattrak(skinData.stattrak);
	const isSouvenir = rollSouvenir(skinData.souvenir);

	return {
		name: skinName,
		data: skinData,
		caseId: caseDef.id,
		caseName: caseDef.name,
		rarity,
		isStattrak,
		isSouvenir,
		wearState,
		float,
		price: generatePrice(skinName, rarity, float, isStattrak, isSouvenir),
	};
}
