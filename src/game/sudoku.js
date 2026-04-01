import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { getSudoku } = require("sudoku-gen");

/**
 * Generates a sudoku puzzle with its solution.
 * @param {"easy"|"medium"|"hard"|"expert"} difficulty
 * @returns {{ puzzle: string, solution: string, difficulty: string }}
 */
export function generatePuzzle(difficulty = "medium") {
	const { puzzle, solution, difficulty: diff } = getSudoku(difficulty);
	return { puzzle, solution, difficulty: diff };
}

/**
 * Validates a submitted solution against the stored one.
 * Both are 81-char strings (a-i characters).
 * @param {string} submitted - The user's submitted grid (81 chars, a-i)
 * @param {string} solution - The correct solution
 * @returns {{ valid: boolean, errors: number[] }}
 */
export function validateSolution(submitted, solution) {
	const errors = [];
	for (let i = 0; i < 81; i++) {
		if (submitted[i] !== solution[i]) {
			errors.push(i);
		}
	}
	return { valid: errors.length === 0, errors };
}
