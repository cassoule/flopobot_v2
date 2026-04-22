/**
 * CS2 loadout weapon taxonomy — side + category maps, slot grammar, helpers.
 * Mirrored in `floposite/src/utils/csLoadout.js` (keep the two in sync).
 */

// Side each weapon can be bought on in CS2.
export const WEAPON_SIDES = {
	// T-exclusive
	"Glock-18": "t",
	"Tec-9": "t",
	"Sawed-Off": "t",
	"Galil AR": "t",
	"AK-47": "t",
	"SG 553": "t",
	"G3SG1": "t",
	"MAC-10": "t",
	// CT-exclusive
	"USP-S": "ct",
	"P2000": "ct",
	"Five-SeveN": "ct",
	"MAG-7": "ct",
	"MP9": "ct",
	"FAMAS": "ct",
	"M4A4": "ct",
	"M4A1-S": "ct",
	"AUG": "ct",
	"SCAR-20": "ct",
	// Shared
	"Desert Eagle": "both",
	"P250": "both",
	"CZ75-Auto": "both",
	"R8 Revolver": "both",
	"Dual Berettas": "both",
	"Nova": "both",
	"XM1014": "both",
	"MP5-SD": "both",
	"MP7": "both",
	"PP-Bizon": "both",
	"P90": "both",
	"UMP-45": "both",
	"M249": "both",
	"Negev": "both",
	"AWP": "both",
	"SSG 08": "both",
};

// Loadout category for each weapon. (Knife/gloves are handled separately from marketHashName.)
export const WEAPON_CATEGORY = {
	// Starting pistols
	"Glock-18": "starting",
	"USP-S": "starting",
	"P2000": "starting",
	// Other pistols
	"Desert Eagle": "other_pistol",
	"Tec-9": "other_pistol",
	"P250": "other_pistol",
	"CZ75-Auto": "other_pistol",
	"R8 Revolver": "other_pistol",
	"Dual Berettas": "other_pistol",
	"Five-SeveN": "other_pistol",
	// Mid-tier (SMGs, shotguns, LMGs)
	"Nova": "mid",
	"XM1014": "mid",
	"MAG-7": "mid",
	"Sawed-Off": "mid",
	"MAC-10": "mid",
	"MP5-SD": "mid",
	"MP7": "mid",
	"MP9": "mid",
	"PP-Bizon": "mid",
	"P90": "mid",
	"UMP-45": "mid",
	"M249": "mid",
	"Negev": "mid",
	// Rifles (includes snipers)
	"AK-47": "rifle",
	"Galil AR": "rifle",
	"SG 553": "rifle",
	"G3SG1": "rifle",
	"FAMAS": "rifle",
	"M4A4": "rifle",
	"M4A1-S": "rifle",
	"AUG": "rifle",
	"SCAR-20": "rifle",
	"AWP": "rifle",
	"SSG 08": "rifle",
};

// Per-side slot layout; rendered top-to-bottom in the UI.
export const LOADOUT_STRUCTURE = [
	{ category: "starting", count: 1, label: "Pistolet de départ" },
	{ category: "other_pistol", count: 4, label: "Autres pistolets" },
	{ category: "mid", count: 5, label: "Mid-tier" },
	{ category: "rifle", count: 5, label: "Rifles" },
	{ category: "knife", count: 1, label: "Couteau" },
	{ category: "gloves", count: 1, label: "Gants" },
];

export const SIDES = ["t", "ct"];

/** Returns the canonical weapon key for a skin: "knife", "gloves", or the weapon name. */
export function getWeaponKey(skin) {
	const name = skin?.marketHashName || "";
	const lower = name.toLowerCase();
	if (lower.includes("gloves") || lower.includes("wraps") || lower.includes("hand wrap")) return "gloves";
	if (name.startsWith("★")) return "knife";
	const sep = name.indexOf(" | ");
	return sep !== -1 ? name.slice(0, sep) : name;
}

/** Returns the category for a skin, or null if unknown. */
export function getCategoryForSkin(skin) {
	const key = getWeaponKey(skin);
	if (key === "knife" || key === "gloves") return key;
	return WEAPON_CATEGORY[key] || null;
}

/** True if a weapon can be equipped on the given side. Knives & gloves are shared. */
export function isWeaponAllowedOnSide(weaponKey, side) {
	if (weaponKey === "knife" || weaponKey === "gloves") return true;
	const weaponSide = WEAPON_SIDES[weaponKey];
	if (!weaponSide) return false;
	return weaponSide === "both" || weaponSide === side;
}

/**
 * Parses a slot string into its components.
 * Returns { side, category, index } or null if invalid.
 * Valid slots:
 *   {t,ct}_starting              → index 1
 *   {t,ct}_other_{1..4}
 *   {t,ct}_mid_{1..5}
 *   {t,ct}_rifle_{1..5}
 *   {t,ct}_knife                 → index 1
 *   {t,ct}_gloves                → index 1
 */
export function parseLoadoutSlot(slot) {
	if (typeof slot !== "string") return null;
	const m = slot.match(/^(t|ct)_(starting|other|mid|rifle|knife|gloves)(?:_(\d+))?$/);
	if (!m) return null;
	const [, side, cat, numStr] = m;
	const categoryKey = cat === "other" ? "other_pistol" : cat;
	const structure = LOADOUT_STRUCTURE.find((s) => s.category === categoryKey);
	if (!structure) return null;
	// Single-slot categories must not carry an index
	if (structure.count === 1) {
		if (numStr !== undefined) return null;
		return { side, category: categoryKey, index: 1 };
	}
	// Multi-slot categories require an index in range
	if (numStr === undefined) return null;
	const index = parseInt(numStr, 10);
	if (!Number.isInteger(index) || index < 1 || index > structure.count) return null;
	return { side, category: categoryKey, index };
}

/** Builds a slot string from components. */
export function buildLoadoutSlot(side, category, index = 1) {
	const structure = LOADOUT_STRUCTURE.find((s) => s.category === category);
	if (!structure) return null;
	const catToken = category === "other_pistol" ? "other" : category;
	if (structure.count === 1) return `${side}_${catToken}`;
	return `${side}_${catToken}_${index}`;
}

/** Returns all valid slots for a skin given its category + side allowances. */
export function getEligibleSlotsForSkin(skin) {
	const category = getCategoryForSkin(skin);
	if (!category) return [];
	const weaponKey = getWeaponKey(skin);
	const structure = LOADOUT_STRUCTURE.find((s) => s.category === category);
	if (!structure) return [];
	const slots = [];
	for (const side of SIDES) {
		if (!isWeaponAllowedOnSide(weaponKey, side)) continue;
		// Extra constraint for ct_starting: only USP-S / P2000 (Glock is t-only so naturally excluded)
		if (category === "starting" && side === "ct" && weaponKey !== "USP-S" && weaponKey !== "P2000") continue;
		for (let i = 1; i <= structure.count; i++) {
			slots.push(buildLoadoutSlot(side, category, i));
		}
	}
	return slots;
}
