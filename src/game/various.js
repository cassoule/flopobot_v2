// --- Constants for Games ---
export const C4_ROWS = 6;
export const C4_COLS = 7;

// A predefined list of choices for the /timeout command's duration option.
const TimesChoices = [
    { name: '1 minute', value: 60 },
    { name: '5 minutes', value: 300 },
    { name: '10 minutes', value: 600 },
    { name: '15 minutes', value: 900 },
    { name: '30 minutes', value: 1800 },
    { name: '1 heure', value: 3600 },
    { name: '2 heures', value: 7200 },
    { name: '3 heures', value: 10800 },
    { name: '6 heures', value: 21600 },
    { name: '9 heures', value: 32400 },
    { name: '12 heures', value: 43200 },
    { name: '16 heures', value: 57600 },
    { name: '1 jour', value: 86400 },
];

/**
 * Returns the array of time choices for use in command definitions.
 * @returns {Array<object>} The array of time choices.
 */
export function getTimesChoices() {
    return TimesChoices;
}


// --- Connect 4 Logic ---

/**
 * Creates a new, empty Connect 4 game board.
 * @returns {Array<Array<null>>} A 2D array representing the board.
 */
export function createConnect4Board() {
    return Array(C4_ROWS).fill(null).map(() => Array(C4_COLS).fill(null));
}

/**
 * Checks if a player has won the Connect 4 game.
 * @param {Array<Array<string>>} board - The game board.
 * @param {string} player - The player's symbol ('R' or 'Y').
 * @returns {object} An object with `win` (boolean) and `pieces` (array of winning piece coordinates).
 */
export function checkConnect4Win(board, player) {
    // Check horizontal
    for (let r = 0; r < C4_ROWS; r++) {
        for (let c = 0; c <= C4_COLS - 4; c++) {
            if (board[r][c] === player && board[r][c+1] === player && board[r][c+2] === player && board[r][c+3] === player) {
                return { win: true, pieces: [{row:r, col:c}, {row:r, col:c+1}, {row:r, col:c+2}, {row:r, col:c+3}] };
            }
        }
    }

    // Check vertical
    for (let r = 0; r <= C4_ROWS - 4; r++) {
        for (let c = 0; c < C4_COLS; c++) {
            if (board[r][c] === player && board[r+1][c] === player && board[r+2][c] === player && board[r+3][c] === player) {
                return { win: true, pieces: [{row:r, col:c}, {row:r+1, col:c}, {row:r+2, col:c}, {row:r+3, col:c}] };
            }
        }
    }

    // Check diagonal (down-right)
    for (let r = 0; r <= C4_ROWS - 4; r++) {
        for (let c = 0; c <= C4_COLS - 4; c++) {
            if (board[r][c] === player && board[r+1][c+1] === player && board[r+2][c+2] === player && board[r+3][c+3] === player) {
                return { win: true, pieces: [{row:r, col:c}, {row:r+1, col:c+1}, {row:r+2, col:c+2}, {row:r+3, col:c+3}] };
            }
        }
    }

    // Check diagonal (up-right)
    for (let r = 3; r < C4_ROWS; r++) {
        for (let c = 0; c <= C4_COLS - 4; c++) {
            if (board[r][c] === player && board[r-1][c+1] === player && board[r-2][c+2] === player && board[r-3][c+3] === player) {
                return { win: true, pieces: [{row:r, col:c}, {row:r-1, col:c+1}, {row:r-2, col:c+2}, {row:r-3, col:c+3}] };
            }
        }
    }

    return { win: false, pieces: [] };
}

/**
 * Checks if the Connect 4 game is a draw (the board is full).
 * @param {Array<Array<string>>} board - The game board.
 * @returns {boolean} True if the game is a draw.
 */
export function checkConnect4Draw(board) {
    // A draw occurs if the top row is completely full.
    return board[0].every(cell => cell !== null);
}

/**
 * Formats a Connect 4 board into a string with emojis for Discord display.
 * @param {Array<Array<string>>} board - The game board.
 * @returns {string} The formatted string representation of the board.
 */
export function formatConnect4BoardForDiscord(board) {
    const symbols = {
        'R': '🔴',
        'Y': '🟡',
        null: '⚪' // Using a white circle for empty slots
    };
    return board.map(row => row.map(cell => symbols[cell]).join('')).join('\n');
}