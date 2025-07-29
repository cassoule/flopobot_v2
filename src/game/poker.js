import pkg from 'pokersolver';
const { Hand } = pkg;

// An array of all 52 standard playing cards.
export const initialCards = [
    'Ad', '2d', '3d', '4d', '5d', '6d', '7d', '8d', '9d', 'Td', 'Jd', 'Qd', 'Kd',
    'As', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', 'Ts', 'Js', 'Qs', 'Ks',
    'Ac', '2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c', 'Tc', 'Jc', 'Qc', 'Kc',
    'Ah', '2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h', 'Th', 'Jh', 'Qh', 'Kh',
];

/**
 * Creates a shuffled copy of the initial card deck.
 * @returns {Array<string>} A new array containing all 52 cards in a random order.
 */
export function initialShuffledCards() {
    // Create a copy and sort it randomly
    return [...initialCards].sort(() => 0.5 - Math.random());
}

/**
 * Finds the first active player to act after the dealer.
 * This is used to start betting rounds after the flop, turn, and river.
 * @param {object} room - The poker room object.
 * @returns {string|null} The ID of the next player, or null if none is found.
 */
export function getFirstActivePlayerAfterDealer(room) {
    const players = Object.values(room.players);
    const dealerPosition = players.findIndex((p) => p.id === room.dealer);

    // Loop through players starting from the one after the dealer
    for (let i = 1; i <= players.length; i++) {
        const nextPos = (dealerPosition + i) % players.length;
        const nextPlayer = players[nextPos];
        // Player must not be folded or all-in to be able to act
        if (nextPlayer && !nextPlayer.folded && !nextPlayer.allin) {
            return nextPlayer.id;
        }
    }
    return null; // Should not happen in a normal game
}

/**
 * Finds the next active player in turn order.
 * @param {object} room - The poker room object.
 * @returns {string|null} The ID of the next player, or null if none is found.
 */
export function getNextActivePlayer(room) {
    const players = Object.values(room.players);
    const currentPlayerPosition = players.findIndex((p) => p.id === room.current_player);

    // Loop through players starting from the one after the current player
    for (let i = 1; i <= players.length; i++) {
        const nextPos = (currentPlayerPosition + i) % players.length;
        const nextPlayer = players[nextPos];
        if (nextPlayer && !nextPlayer.folded && !nextPlayer.allin) {
            return nextPlayer.id;
        }
    }
    return null;
}

/**
 * Checks if the current betting round should end and what the next phase should be.
 * @param {object} room - The poker room object.
 * @returns {object} An object with `endRound`, `winner`, and `nextPhase` properties.
 */
export function checkEndOfBettingRound(room) {
    const activePlayers = Object.values(room.players).filter((p) => !p.folded);

    // --- Scenario 1: Only one player left (everyone else folded) ---
    if (activePlayers.length === 1) {
        return { endRound: true, winner: activePlayers[0].id, nextPhase: 'showdown' };
    }

    // --- Scenario 2: All remaining players are all-in ---
    // The hand goes immediately to a "progressive showdown".
    const allInPlayers = activePlayers.filter(p => p.allin);
    if (allInPlayers.length >= 2 && allInPlayers.length === activePlayers.length) {
        return { endRound: true, winner: null, nextPhase: 'progressive-showdown' };
    }

    // --- Scenario 3: All active players have acted and bets are equal ---
    const allBetsMatched = activePlayers.every(p =>
        p.allin || // Player is all-in
        (p.bet === room.highest_bet && p.last_played_turn === room.current_turn) // Or their bet matches the highest and they've acted this turn
    );

    if (allBetsMatched) {
        let nextPhase;
        switch (room.current_turn) {
            case 0: nextPhase = 'flop'; break;
            case 1: nextPhase = 'turn'; break;
            case 2: nextPhase = 'river'; break;
            case 3: nextPhase = 'showdown'; break;
            default: nextPhase = null; // Should not happen
        }
        return { endRound: true, winner: null, nextPhase: nextPhase };
    }

    // --- Default: The round continues ---
    return { endRound: false, winner: null, nextPhase: null };
}

/**
 * Determines the winner(s) of the hand at showdown.
 * @param {object} room - The poker room object.
 * @returns {Array<string>} An array of winner IDs. Can contain multiple IDs in case of a split pot.
 */
export function checkRoomWinners(room) {
    const communityCards = room.tapis;
    const activePlayers = Object.values(room.players).filter(p => !p.folded);

    // Solve each player's hand to find the best possible 5-card combination
    const playerSolutions = activePlayers.map(player => ({
        id: player.id,
        solution: Hand.solve([...communityCards, ...player.hand]),
    }));

    if (playerSolutions.length === 0) return [];

    // Use pokersolver's `Hand.winners()` to find the best hand(s)
    const winningSolutions = Hand.winners(playerSolutions.map(ps => ps.solution));

    // Find the player IDs that correspond to the winning hand solutions
    const winnerIds = [];
    for (const winningHand of winningSolutions) {
        for (const playerSol of playerSolutions) {
            // Compare description and card pool to uniquely identify the hand
            if (playerSol.solution.descr === winningHand.descr && playerSol.solution.cardPool.toString() === winningHand.cardPool.toString()) {
                if (!winnerIds.includes(playerSol.id)) {
                    winnerIds.push(playerSol.id);
                }
            }
        }
    }

    return winnerIds;
}