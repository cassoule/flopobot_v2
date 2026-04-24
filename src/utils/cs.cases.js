import { csSkinsData, csSkinsPriceIndex } from "./cs.state.js";
import {
	generatePrice,
	getRandomFloatInRange,
	getWearState,
	rollSouvenir,
	rollStattrak,
} from "./cs.utils.js";

const EUR_TO_FLOPOS = parseInt(process.env.EUR_TO_FLOPOS) || 6;

// Canonical CS case drop odds. Rarities absent from a case are skipped and the
// remaining weights are renormalized.
const CASE_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.0026 }, // Rare Special (knives/gloves)
	{ rarity: "Covert", weight: 0.0064 },
	{ rarity: "Classified", weight: 0.032 },
	{ rarity: "Restricted", weight: 0.1598 },
	{ rarity: "Mil-Spec Grade", weight: 0.7992 },
];

// Each case picks one price band per rarity (or null to disable). Overflow is
// the chance that a Covert / Extraordinary roll ignores the assigned band and
// pulls from the full global pool instead — this is the "lottery" knob.
const CASE_DEFINITIONS = [
	{
		id: "case_starter",
		name: "Starter Case",
		price: 100,
		overflow: 0.02,
		buckets: {
			"Mil-Spec Grade": "cheap",
			Restricted: "cheap",
			Classified: "cheap",
			Covert: "cheap",
			Extraordinary: null,
		},
	},
	{
		id: "case_standard",
		name: "Standard Case",
		price: 250,
		overflow: 0.05,
		buckets: {
			"Mil-Spec Grade": "cheap",
			Restricted: "mid",
			Classified: "mid",
			Covert: "mid",
			Extraordinary: "cheap",
		},
	},
	{
		id: "case_premium",
		name: "Premium Case",
		price: 500,
		overflow: 0.1,
		buckets: {
			"Mil-Spec Grade": "mid",
			Restricted: "mid",
			Classified: "mid",
			Covert: "mid",
			Extraordinary: "mid",
		},
	},
	{
		id: "case_elite",
		name: "Elite Case",
		price: 1000,
		overflow: 0.2,
		buckets: {
			"Mil-Spec Grade": "mid",
			Restricted: "expensive",
			Classified: "expensive",
			Covert: "expensive",
			Extraordinary: "mid",
		},
	},
	{
		id: "case_flagship",
		name: "Flagship Case",
		price: 2500,
		overflow: 0.5,
		buckets: {
			"Mil-Spec Grade": "expensive",
			Restricted: "expensive",
			Classified: "expensive",
			Covert: "expensive",
			Extraordinary: "expensive",
		},
	},
];

const WEAR_STATES = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

// Deterministic fallback (EUR) for skins with no Skinport price — keeps band
// sorting stable instead of re-rolling each call to generatePrice.
const FALLBACK_EUR_BY_RARITY = {
	"Consumer Grade": 0.06,
	"Industrial Grade": 0.15,
	"Mil-Spec Grade": 0.8,
	Restricted: 5.0,
	Classified: 20.0,
	Covert: 80.0,
	Extraordinary: 400.0,
};

let rarityBands = {}; // rarity -> { cheap: [], mid: [], expensive: [] }
let globalPoolByRarity = {}; // rarity -> [skinName, ...] (all skins in this rarity)
let skinValueCache = {}; // skinName -> FlopoCoin value (stable estimate)
let caseRegistry = {}; // caseId -> { ...def, ev, activeRarities }

function estimateSkinValue(skinName) {
	if (skinValueCache[skinName] != null) return skinValueCache[skinName];
	const skin = csSkinsData[skinName];
	if (!skin) return (skinValueCache[skinName] = 0);
	const rarity = skin.rarity?.name;
	const entry = csSkinsPriceIndex[skinName];

	const prices = [];
	if (entry?.base) {
		for (const ws of WEAR_STATES) {
			const p = entry.base[ws];
			const v = p?.suggested_price ?? p?.median_price ?? p?.mean_price ?? p?.min_price;
			if (typeof v === "number" && v > 0) prices.push(v);
		}
	}
	const eur =
		prices.length > 0
			? prices.reduce((a, b) => a + b, 0) / prices.length
			: (FALLBACK_EUR_BY_RARITY[rarity] ?? 0.1);
	const value = Math.max(1, Math.round(eur * EUR_TO_FLOPOS));
	skinValueCache[skinName] = value;
	return value;
}

function splitIntoBands(sortedAsc) {
	const n = sortedAsc.length;
	if (n === 0) return { cheap: [], mid: [], expensive: [] };
	if (n === 1) return { cheap: sortedAsc, mid: sortedAsc, expensive: sortedAsc };
	if (n === 2) return { cheap: [sortedAsc[0]], mid: [sortedAsc[0]], expensive: [sortedAsc[1]] };
	const third = Math.ceil(n / 3);
	return {
		cheap: sortedAsc.slice(0, third),
		mid: sortedAsc.slice(third, 2 * third),
		expensive: sortedAsc.slice(2 * third),
	};
}

function averageValue(pool) {
	if (!pool || pool.length === 0) return 0;
	return pool.reduce((s, n) => s + estimateSkinValue(n), 0) / pool.length;
}

function computeCaseEV(caseDef) {
	const active = CASE_RARITY_ODDS.filter((o) => caseDef.buckets[o.rarity] != null);
	if (active.length === 0) return 0;
	const total = active.reduce((s, o) => s + o.weight, 0);
	let ev = 0;
	for (const { rarity, weight } of active) {
		const prob = weight / total;
		const band = caseDef.buckets[rarity];
		const bandAvg = averageValue(rarityBands[rarity]?.[band]);
		const globalAvg = averageValue(globalPoolByRarity[rarity]);
		const slotAvg =
			rarity === "Covert" || rarity === "Extraordinary"
				? caseDef.overflow * globalAvg + (1 - caseDef.overflow) * bandAvg
				: bandAvg;
		ev += prob * slotAvg;
	}
	return ev;
}

export function buildCaseRegistry() {
	rarityBands = {};
	globalPoolByRarity = {};
	skinValueCache = {};
	caseRegistry = {};

	// Group skins by rarity
	const byRarity = {};
	for (const [name, data] of Object.entries(csSkinsData)) {
		const r = data.rarity?.name;
		if (!r) continue;
		if (!byRarity[r]) byRarity[r] = [];
		byRarity[r].push(name);
	}

	// Sort each rarity ascending by estimated value, split into terciles
	for (const [rarity, names] of Object.entries(byRarity)) {
		const sorted = [...names].sort((a, b) => estimateSkinValue(a) - estimateSkinValue(b));
		rarityBands[rarity] = splitIntoBands(sorted);
		globalPoolByRarity[rarity] = sorted;
	}

	// Register cases (with precomputed analytical EV)
	for (const def of CASE_DEFINITIONS) {
		const activeRarities = Object.keys(def.buckets).filter((r) => def.buckets[r] != null);
		caseRegistry[def.id] = { ...def, ev: computeCaseEV(def), activeRarities };
	}

	// Coverage audit: every (rarity, band) with skins should be referenced by at least one case
	const allBands = new Set();
	for (const r of Object.keys(rarityBands)) {
		for (const b of ["cheap", "mid", "expensive"]) {
			if (rarityBands[r][b] && rarityBands[r][b].length > 0) allBands.add(`${r}|${b}`);
		}
	}
	const usedBands = new Set();
	for (const def of CASE_DEFINITIONS) {
		for (const [r, b] of Object.entries(def.buckets)) {
			if (b) usedBands.add(`${r}|${b}`);
		}
	}
	const orphanBands = [...allBands].filter((x) => !usedBands.has(x));

	console.log(`[CS Cases] ${Object.keys(caseRegistry).length} curated cases built:`);
	for (const c of Object.values(caseRegistry)) {
		console.log(
			`  - ${c.name} (${c.price} FC, overflow ${Math.round(c.overflow * 100)}%): ` +
				`EV ${c.ev.toFixed(1)} FC (${((c.ev / c.price) * 100).toFixed(1)}% of price)`,
		);
	}
	if (orphanBands.length > 0) {
		console.warn(`[CS Cases] ${orphanBands.length} rarity/band combos not in any case: ${orphanBands.join(", ")}`);
	}
}

export function getAllCases() {
	return Object.values(caseRegistry).map((c) => ({
		id: c.id,
		name: c.name,
		price: c.price,
		overflow: c.overflow,
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
	for (const rarity of Object.keys(c.buckets)) {
		const band = c.buckets[rarity];
		if (!band) continue;
		contents[rarity] = {
			band,
			skins: rarityBands[rarity]?.[band] || [],
		};
	}
	return {
		id: c.id,
		name: c.name,
		price: c.price,
		overflow: c.overflow,
		ev: c.ev,
		skinsByRarity: contents,
	};
}

export function findOrphanSkins() {
	const placed = new Set();
	for (const rarity of Object.keys(rarityBands)) {
		for (const band of ["cheap", "mid", "expensive"]) {
			for (const name of rarityBands[rarity][band] || []) placed.add(name);
		}
	}
	const orphans = [];
	for (const [name, data] of Object.entries(csSkinsData)) {
		if (!placed.has(name)) orphans.push({ name, rarity: data.rarity?.name || "Unknown" });
	}
	return orphans;
}

function rollRarityForCase(caseDef) {
	const active = CASE_RARITY_ODDS.filter((o) => caseDef.buckets[o.rarity] != null);
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

	let pool;
	let fromOverflow = false;
	if ((rarity === "Covert" || rarity === "Extraordinary") && Math.random() < caseDef.overflow) {
		pool = globalPoolByRarity[rarity];
		fromOverflow = true;
	} else {
		const band = caseDef.buckets[rarity];
		pool = rarityBands[rarity]?.[band];
	}
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
		fromOverflow,
		isStattrak,
		isSouvenir,
		wearState,
		float,
		price: generatePrice(skinName, rarity, float, isStattrak, isSouvenir),
	};
}
