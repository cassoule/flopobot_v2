import { csSkinsData, csSkinsPriceIndex } from "./cs.state.js";
import {
	generatePrice,
	getRandomFloatInRange,
	getWearState,
	rollSouvenir,
	rollStattrak,
} from "./cs.utils.js";

const EUR_TO_FLOPOS = parseInt(process.env.EUR_TO_FLOPOS) || 6;
const N_BANDS = 15;
const DEFAULT_EV_RATIO = 0.90;

const RARITY_KEYS = ["Mil-Spec Grade", "Restricted", "Classified", "Covert", "Extraordinary"];

// Canonical CS case drop odds.
const DEFAULT_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.0026 },
	{ rarity: "Covert", weight: 0.0064 },
	{ rarity: "Classified", weight: 0.032 },
	{ rarity: "Restricted", weight: 0.1598 },
	{ rarity: "Mil-Spec Grade", weight: 0.7992 },
];

const STARTER_RARITY_ODDS = [
	{ rarity: "Covert", weight: 0.009 },
	{ rarity: "Classified", weight: 0.032 },
	{ rarity: "Restricted", weight: 0.1598 },
	{ rarity: "Mil-Spec Grade", weight: 0.7992 },
];

const FLAGSHIP_RARITY_ODDS = [
	{ rarity: "Extraordinary", weight: 0.05 },
	{ rarity: "Covert", weight: 0.15 },
	{ rarity: "Classified", weight: 0.2 },
	{ rarity: "Restricted", weight: 0.3 },
	{ rarity: "Mil-Spec Grade", weight: 0.3 },
];

const CASE_DEFINITIONS = [
	{
		id: "case_starter",
		name: "Starter Case",
		price: 100,
		overflow: 0.02,
		color: '#b0c3d9',
		evRatio: DEFAULT_EV_RATIO,
		rarityOdds: STARTER_RARITY_ODDS,
	},
	{
		id: "case_standard",
		name: "Standard Case",
		price: 250,
		overflow: 0.05,
		color: '#5e98d9',
		evRatio: DEFAULT_EV_RATIO,
	},
	{
		id: "case_premium",
		name: "Premium Case",
		price: 500,
		overflow: 0.1,
		color: '#8847ff',
		evRatio: DEFAULT_EV_RATIO,
	},
	{
		id: "case_elite",
		name: "Elite Case",
		price: 1000,
		overflow: 0.2,
		color: '#d32ce6',
		evRatio: DEFAULT_EV_RATIO,
	},
	{
		id: "case_flagship",
		name: "Flopo Case",
		price: 2000,
		overflow: 0.1,
		color: '#eb4b4b',
		evRatio: DEFAULT_EV_RATIO,
		rarityOdds: FLAGSHIP_RARITY_ODDS,
	},
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

let bandsByRarity = {}; // rarity -> [skinsBand0, ..., skinsBand_{N-1}]
let bandAvgsByRarity = {}; // rarity -> [avg per band]
let topBandPoolByRarity = {}; // rarity -> top non-empty band's skin list (overflow target)
let topBandAvgByRarity = {}; // rarity -> top non-empty band's avg
let globalPoolByRarity = {};
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

function buildBandsForRarity(names) {
	const sorted = [...names].sort((a, b) => estimateSkinValue(a) - estimateSkinValue(b));
	const n = sorted.length;
	const bands = [];
	for (let i = 0; i < N_BANDS; i++) {
		const start = Math.floor((i * n) / N_BANDS);
		const end = Math.floor(((i + 1) * n) / N_BANDS);
		bands.push(sorted.slice(start, end));
	}
	return bands;
}

function avgValue(skinList) {
	if (!skinList || skinList.length === 0) return 0;
	return skinList.reduce((s, n) => s + estimateSkinValue(n), 0) / skinList.length;
}

function getSlotOptions(rarity) {
	const opts = [];
	if (!bandsByRarity[rarity]) return opts;
	for (let i = 0; i < N_BANDS; i++) {
		if (bandsByRarity[rarity][i]?.length > 0) opts.push([i]);
	}
	for (let i = 0; i < N_BANDS - 1; i++) {
		if (bandsByRarity[rarity][i]?.length > 0 && bandsByRarity[rarity][i + 1]?.length > 0) {
			opts.push([i, i + 1]);
		}
	}
	return opts;
}

function evForAssignment(slotBands, caseDef) {
	const odds = caseOdds(caseDef);
	const overflow = caseDef.overflow;
	const active = odds.filter((o) => slotBands[o.rarity] != null && slotBands[o.rarity].length > 0);
	if (active.length === 0) return 0;
	const total = active.reduce((s, o) => s + o.weight, 0);
	let ev = 0;
	for (const { rarity, weight } of active) {
		const bandList = slotBands[rarity];
		const slotAvg = bandList.reduce((s, b) => s + bandAvgsByRarity[rarity][b], 0) / bandList.length;
		const effectiveAvg =
			rarity === "Covert" || rarity === "Extraordinary"
				? overflow * (topBandAvgByRarity[rarity] || 0) + (1 - overflow) * slotAvg
				: slotAvg;
		ev += (weight / total) * effectiveAvg;
	}
	return ev;
}

function autoAssignBands(caseDef) {
	const targetEv = caseDef.price * caseDef.evRatio;
	const odds = caseOdds(caseDef);
	const rarities = odds.map((o) => o.rarity);
	const weights = odds.map((o) => o.weight);
	const optionLists = rarities.map((r) => getSlotOptions(r));
	if (optionLists.some((l) => l.length === 0)) return null;

	const totalWeight = weights.reduce((s, w) => s + w, 0);
	const normWeights = weights.map((w) => w / totalWeight);
	const overflow = caseDef.overflow;

	// Precompute per-option EV contribution (already weighted) per rarity slot.
	const contribs = rarities.map((r, i) => {
		const isJackpotRarity = r === "Covert" || r === "Extraordinary";
		const topAvg = topBandAvgByRarity[r] || 0;
		return optionLists[i].map((opt) => {
			const slotAvg = opt.reduce((s, b) => s + bandAvgsByRarity[r][b], 0) / opt.length;
			const effectiveAvg = isJackpotRarity ? overflow * topAvg + (1 - overflow) * slotAvg : slotAvg;
			return normWeights[i] * effectiveAvg;
		});
	});

	let bestIdx = null;
	let bestScore = Infinity;
	const cur = new Array(rarities.length);

	function enumerate(depth, evSoFar) {
		if (depth === rarities.length) {
			const overshoot = evSoFar > targetEv ? evSoFar - targetEv : 0;
			const undershoot = evSoFar < targetEv ? targetEv - evSoFar : 0;
			const score = overshoot * 1.5 + undershoot;
			if (score < bestScore) {
				bestScore = score;
				bestIdx = [...cur];
			}
			return;
		}
		const slotContribs = contribs[depth];
		for (let i = 0; i < slotContribs.length; i++) {
			cur[depth] = i;
			enumerate(depth + 1, evSoFar + slotContribs[i]);
		}
	}
	enumerate(0, 0);

	if (!bestIdx) return null;

	const slotBands = {};
	for (let i = 0; i < rarities.length; i++) {
		slotBands[rarities[i]] = optionLists[i][bestIdx[i]];
	}
	return slotBands;
}

function repairCoverage() {
	for (const rarity of RARITY_KEYS) {
		const usedBands = new Set();
		for (const c of Object.values(caseRegistry)) {
			const bs = c.slotBands[rarity];
			if (bs) bs.forEach((b) => usedBands.add(b));
		}
		for (let band = 0; band < N_BANDS; band++) {
			if (!bandsByRarity[rarity]?.[band] || bandsByRarity[rarity][band].length === 0) continue;
			if (usedBands.has(band)) continue;

			let bestCase = null;
			let bestDelta = Infinity;
			for (const c of Object.values(caseRegistry)) {
				const slot = c.slotBands[rarity];
				if (!slot) continue; // case doesn't include this rarity
				const newSlotBands = { ...c.slotBands, [rarity]: [...slot, band] };
				const newEv = evForAssignment(newSlotBands, c);
				const delta = Math.abs(newEv - c.price * c.evRatio);
				if (delta < bestDelta) {
					bestDelta = delta;
					bestCase = c;
				}
			}
			if (bestCase) {
				bestCase.slotBands[rarity] = [...bestCase.slotBands[rarity], band];
				bestCase.ev = evForAssignment(bestCase.slotBands, bestCase);
				usedBands.add(band);
			}
		}
	}
}

export function buildCaseRegistry() {
	bandsByRarity = {};
	bandAvgsByRarity = {};
	topBandPoolByRarity = {};
	topBandAvgByRarity = {};
	globalPoolByRarity = {};
	skinValueCache = {};
	caseRegistry = {};

	const byRarity = {};
	for (const [name, data] of Object.entries(csSkinsData)) {
		const r = data.rarity?.name;
		if (!r) continue;
		if (!byRarity[r]) byRarity[r] = [];
		byRarity[r].push(name);
	}

	for (const [rarity, names] of Object.entries(byRarity)) {
		bandsByRarity[rarity] = buildBandsForRarity(names);
		bandAvgsByRarity[rarity] = bandsByRarity[rarity].map((b) => avgValue(b));
		globalPoolByRarity[rarity] = [...names];

		let topIdx = -1;
		for (let i = N_BANDS - 1; i >= 0; i--) {
			if (bandsByRarity[rarity][i].length > 0) {
				topIdx = i;
				break;
			}
		}
		if (topIdx >= 0) {
			topBandPoolByRarity[rarity] = bandsByRarity[rarity][topIdx];
			topBandAvgByRarity[rarity] = bandAvgsByRarity[rarity][topIdx];
		} else {
			topBandPoolByRarity[rarity] = [];
			topBandAvgByRarity[rarity] = 0;
		}
	}

	for (const def of CASE_DEFINITIONS) {
		const slotBands = autoAssignBands(def);
		if (!slotBands) continue;
		caseRegistry[def.id] = {
			...def,
			slotBands,
			ev: evForAssignment(slotBands, def),
			activeRarities: Object.keys(slotBands).filter((r) => slotBands[r] != null),
		};
	}

	repairCoverage();

	console.log(`[CS Cases] ${Object.keys(caseRegistry).length} curated cases built (${N_BANDS} bands, multi-band tuning):`);
	for (const c of Object.values(caseRegistry)) {
		const oddsLabel = c.rarityOdds ? "custom" : "canonical";
		const slotSummary = caseOdds(c)
			.map((o) => o.rarity)
			.filter((r) => c.slotBands[r])
			.map((r) => `${r.split(" ")[0].slice(0, 5)}=[${c.slotBands[r].join(",")}]`)
			.join(" ");
		console.log(
			`  - ${c.name.padEnd(15)} ${String(c.price).padStart(4)} FC: ` +
				`EV ${c.ev.toFixed(0).padStart(5)} (${((c.ev / c.price) * 100).toFixed(1).padStart(5)}%) ` +
				`| target ${(c.evRatio * 100).toFixed(0)}% | odds ${oddsLabel} | ${slotSummary}`,
		);
	}

	const orphans = findOrphanSkins();
	if (orphans.length > 0) {
		console.warn(`[CS Cases] ${orphans.length} skins still orphaned (likely missing rarity).`);
	} else {
		console.log(`[CS Cases] All skins covered.`);
	}
}

export function getAllCases() {
	return Object.values(caseRegistry).map((c) => ({
		id: c.id,
		name: c.name,
		price: c.price,
		overflow: c.overflow,
		ev: c.ev,
		color: c.color,
		evRatio: c.evRatio,
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
	for (const rarity of Object.keys(c.slotBands)) {
		const bands = c.slotBands[rarity];
		if (!bands) continue;
		const skins = bands.flatMap((b) => bandsByRarity[rarity][b] || []);
		contents[rarity] = { bands, skins };
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
	for (const c of Object.values(caseRegistry)) {
		for (const rarity of Object.keys(c.slotBands)) {
			const bands = c.slotBands[rarity];
			if (!bands) continue;
			for (const b of bands) {
				for (const skin of bandsByRarity[rarity][b] || []) placed.add(skin);
			}
		}
	}
	const orphans = [];
	for (const [name, data] of Object.entries(csSkinsData)) {
		if (!placed.has(name)) orphans.push({ name, rarity: data.rarity?.name || "Unknown" });
	}
	return orphans;
}

function rollRarityForCase(caseDef) {
	const odds = caseOdds(caseDef);
	const active = odds.filter((o) => caseDef.slotBands[o.rarity] != null);
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
		pool = topBandPoolByRarity[rarity];
		fromOverflow = true;
	} else {
		const bands = caseDef.slotBands[rarity];
		pool = bands.flatMap((b) => bandsByRarity[rarity][b] || []);
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
