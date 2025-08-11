import express from 'express';

// --- Game Logic Imports ---
import {
    createDeck, shuffle, deal, isValidMove, moveCard, drawCard,
    checkWinCondition, createSeededRNG, seededShuffle
} from '../../game/solitaire.js';

// --- Game State & Database Imports ---
import { activeSolitaireGames } from '../../game/state.js';
import {
    getSOTD, getUser, insertSOTDStats, deleteUserSOTDStats,
    getUserSOTDStats, updateUserCoins, insertLog, getAllSOTDStats
} from '../../database/index.js';
import {socketEmit} from "../socket.js";

// Create a new router instance
const router = express.Router();

/**
 * Factory function to create and configure the solitaire API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function solitaireRoutes(client, io) {

    // --- Game Initialization Endpoints ---

    router.post('/start', (req, res) => {
        const { userId, userSeed } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID is required.' });

        // If a game already exists for the user, return it instead of creating a new one.
        if (activeSolitaireGames[userId] && !activeSolitaireGames[userId].isSOTD) {
            return res.json({ success: true, gameState: activeSolitaireGames[userId] });
        }

        let deck, seed;
        if (userSeed) {
            // Use the provided seed to create a deterministic game
            seed = userSeed;
        } else {
            // Create a random seed if none is provided
            seed = Date.now().toString(36) + Math.random().toString(36).substr(2);
        }

        let numericSeed = 0;
        for (let i = 0; i < seed.length; i++) {
            numericSeed = (numericSeed + seed.charCodeAt(i)) & 0xFFFFFFFF;
        }

        const rng = createSeededRNG(numericSeed);
        deck = seededShuffle(createDeck(), rng);

        const gameState = deal(deck);
        gameState.seed = seed;
        gameState.isSOTD = false;
        activeSolitaireGames[userId] = gameState;

        res.json({ success: true, gameState });
    });

    router.post('/start/sotd', (req, res) => {
        const { userId } = req.body;
        /*if (!userId || !getUser.get(userId)) {
            return res.status(404).json({ error: 'User not found.' });
        }*/

        if (activeSolitaireGames[userId]?.isSOTD) {
            return res.json({ success: true, gameState: activeSolitaireGames[userId] });
        }

        const sotd = getSOTD.get();
        if (!sotd) {
            return res.status(500).json({ error: 'Solitaire of the Day is not configured.'});
        }

        const gameState = {
            tableauPiles: JSON.parse(sotd.tableauPiles),
            foundationPiles: JSON.parse(sotd.foundationPiles),
            stockPile: JSON.parse(sotd.stockPile),
            wastePile: JSON.parse(sotd.wastePile),
            isDone: false,
            isSOTD: true,
            startTime: Date.now(),
            endTime: null,
            moves: 0,
            score: 0,
            seed: sotd.seed,
        };

        activeSolitaireGames[userId] = gameState;
        res.json({ success: true, gameState });
    });

    // --- Game State & Action Endpoints ---

    router.get('/sotd/rankings', (req, res) => {
        try {
            const rankings = getAllSOTDStats.all();
            res.json({ rankings });
        } catch(e) {
            res.status(500).json({ error: "Failed to fetch SOTD rankings."});
        }
    });

    router.get('/state/:userId', (req, res) => {
        const { userId } = req.params;
        const gameState = activeSolitaireGames[userId];
        if (gameState) {
            res.json({ success: true, gameState });
        } else {
            res.status(404).json({ error: 'No active game found for this user.' });
        }
    });

    router.post('/reset', (req, res) => {
        const { userId } = req.body;
        if (activeSolitaireGames[userId]) {
            delete activeSolitaireGames[userId];
        }
        res.json({ success: true, message: "Game reset."});
    });

    router.post('/move', async (req, res) => {
        const { userId, ...moveData } = req.body;
        const gameState = activeSolitaireGames[userId];

        if (!gameState) return res.status(404).json({ error: 'Game not found.' });
        if (gameState.isDone) return res.status(400).json({ error: 'This game is already completed.'});

        if (isValidMove(gameState, moveData)) {
            moveCard(gameState, moveData);
            updateGameStats(gameState, 'move', moveData);

            const win = checkWinCondition(gameState);
            if (win) {
                gameState.isDone = true;
                await handleWin(userId, gameState, io);
            }
            res.json({ success: true, gameState, win });
        } else {
            res.status(400).json({ error: 'Invalid move' });
        }
    });

    router.post('/draw', (req, res) => {
        const { userId } = req.body;
        const gameState = activeSolitaireGames[userId];

        if (!gameState) return res.status(404).json({ error: 'Game not found.' });
        if (gameState.isDone) return res.status(400).json({ error: 'This game is already completed.'});

        drawCard(gameState);
        updateGameStats(gameState, 'draw');
        res.json({ success: true, gameState });
    });

    return router;
}


// --- Helper Functions ---

/** Updates game stats like moves and score after an action. */
function updateGameStats(gameState, actionType, moveData = {}) {
    if (!gameState.isSOTD) return; // Only track stats for SOTD

    gameState.moves++;
    if (actionType === 'move') {
        if (moveData.destPileType === 'foundationPiles') {
            gameState.score += 10; // Move card to foundation
        }
        if (moveData.sourcePileType === 'foundationPiles') {
            gameState.score -= 15; // Move card from foundation (penalty)
        }
    }
    if(actionType === 'draw' && gameState.wastePile.length === 0) {
        // Penalty for cycling through an empty stock pile
        gameState.score -= 5;
    }
}

/** Handles the logic when a game is won. */
async function handleWin(userId, gameState, io) {
    if (!gameState.isSOTD) return;

    gameState.endTime = Date.now();
    const timeTaken = gameState.endTime - gameState.startTime;

    const currentUser = getUser.get(userId);
    if (!currentUser) return;
    const existingStats = getUserSOTDStats.get(userId);

    if (!existingStats) {
        // First time completing the SOTD, grant bonus coins
        const bonus = 1000;
        const newCoins = currentUser.coins + bonus;
        updateUserCoins.run({ id: userId, coins: newCoins });
        insertLog.run({
            id: `${userId}-sotd-complete-${Date.now()}`, user_id: userId,
            action: 'SOTD_WIN', target_user_id: null,
            coins_amount: bonus, user_new_amount: newCoins,
        });
        await socketEmit('data-updated', { table: 'users' });
    }

    // Save the score if it's better than the previous one
    const isNewBest = !existingStats ||
        gameState.score > existingStats.score ||
        (gameState.score === existingStats.score && gameState.moves < existingStats.moves) ||
        (gameState.score === existingStats.score && gameState.moves === existingStats.moves && timeTaken < existingStats.time);

    if (isNewBest) {
        deleteUserSOTDStats.run(userId)
        insertSOTDStats.run({
            id: userId, user_id: userId,
            time: timeTaken,
            moves: gameState.moves,
            score: gameState.score,
        });
        await socketEmit('sotd-update')
        console.log(`New SOTD high score for ${currentUser.globalName}: ${gameState.score} points.`);
    }
}