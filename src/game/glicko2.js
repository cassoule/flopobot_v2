/**
 * Glicko-2 Rating System
 * Based on Mark Glickman's paper: http://www.glicko.net/glicko/glicko2.pdf
 */

// --- Constants ---
const TAU = 0.5;
const EPSILON = 0.000001;
const SCALE = 173.7178;

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOLATILITY = 0.06;
export const PLACEMENT_GAMES = 5;
const MIN_RD = 30;
const MAX_RD = 350;

// --- Scale conversion (Glicko <-> Glicko-2 internal) ---

function scaleDown(rating, rd) {
	return {
		mu: (rating - 1500) / SCALE,
		phi: rd / SCALE,
	};
}

function scaleUp(mu, phi) {
	return {
		rating: mu * SCALE + 1500,
		rd: phi * SCALE,
	};
}

// --- Core Glicko-2 functions ---

/** Step 3: g function - reduces impact of opponent's RD on expected outcome */
function g(phi) {
	return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Step 3: Expected outcome (probability of winning) */
function E(mu, muJ, phiJ) {
	return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Step 3: Estimated variance of the player's rating based on game outcomes */
function computeVariance(mu, opponentMu, opponentPhi) {
	const gPhi = g(opponentPhi);
	const e = E(mu, opponentMu, opponentPhi);
	return 1 / (gPhi * gPhi * e * (1 - e));
}

/** Step 4: Compute the quantity delta (estimated improvement in rating) */
function computeDelta(mu, opponentMu, opponentPhi, score, v) {
	const gPhi = g(opponentPhi);
	const e = E(mu, opponentMu, opponentPhi);
	return v * gPhi * (score - e);
}

/** Step 5: Compute new volatility using the Illinois algorithm */
function computeNewVolatility(sigma, phi, delta, v) {
	const a = Math.log(sigma * sigma);
	const phiSq = phi * phi;
	const tauSq = TAU * TAU;

	function f(x) {
		const ex = Math.exp(x);
		const d = phiSq + v + ex;
		const term1 = (ex * (delta * delta - phiSq - v - ex)) / (2 * d * d);
		const term2 = (x - a) / tauSq;
		return term1 - term2;
	}

	// Set initial bracket values
	let A = a;
	let B;
	if (delta * delta > phiSq + v) {
		B = Math.log(delta * delta - phiSq - v);
	} else {
		let k = 1;
		while (f(a - k * TAU) < 0) {
			k++;
		}
		B = a - k * TAU;
	}

	// Illinois algorithm (modified regula falsi)
	let fA = f(A);
	let fB = f(B);
	while (Math.abs(B - A) > EPSILON) {
		const C = A + ((A - B) * fA) / (fB - fA);
		const fC = f(C);
		if (fC * fB <= 0) {
			A = B;
			fA = fB;
		} else {
			fA = fA / 2;
		}
		B = C;
		fB = fC;
	}

	return Math.exp(A / 2);
}

/**
 * Calculate new Glicko-2 ratings for a player after a single game.
 * @param {{ rating: number, rd: number, volatility: number }} player
 * @param {{ rating: number, rd: number }} opponent
 * @param {number} score - 1 (win), 0.5 (draw), 0 (loss)
 * @returns {{ rating: number, rd: number, volatility: number }}
 */
export function calculateNewRatings(player, opponent, score) {
	// Step 1-2: Convert to Glicko-2 scale
	const { mu, phi } = scaleDown(player.rating, player.rd);
	const { mu: muJ, phi: phiJ } = scaleDown(opponent.rating, opponent.rd);
	const sigma = player.volatility;

	// Step 3: Compute variance
	const v = computeVariance(mu, muJ, phiJ);

	// Step 4: Compute delta
	const delta = computeDelta(mu, muJ, phiJ, score, v);

	// Step 5: Compute new volatility
	const newSigma = computeNewVolatility(sigma, phi, delta, v);

	// Step 6: Update RD to pre-rating period value
	const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

	// Step 7: Update rating and RD
	const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
	const gPhiJ = g(phiJ);
	const eVal = E(mu, muJ, phiJ);
	const newMu = mu + newPhi * newPhi * gPhiJ * (score - eVal);

	// Convert back to Glicko scale
	const result = scaleUp(newMu, newPhi);

	return {
		rating: Math.round(result.rating),
		rd: Math.max(MIN_RD, Math.min(MAX_RD, Math.round(result.rd * 100) / 100)),
		volatility: Math.round(newSigma * 1000000) / 1000000,
	};
}
