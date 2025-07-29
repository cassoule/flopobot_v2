import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { uniqueNamesGenerator, adjectives } from 'unique-names-generator';

import { pokerRooms } from '../../game/state.js';
import { initialShuffledCards, getFirstActivePlayerAfterDealer, getNextActivePlayer, checkEndOfBettingRound, checkRoomWinners } from '../../game/poker.js';
import { pokerEloHandler } from '../../game/elo.js';
import { getUser, updateUserCoins, insertLog } from '../../database/index.js';
import {sleep} from "openai/core";

// Create a new router instance
const router = express.Router();

/**
 * Factory function to create and configure the poker API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function pokerRoutes(client, io) {

    // --- Room Management Endpoints ---

    router.get('/', (req, res) => {
        res.status(200).json({ rooms: pokerRooms });
    });

    router.get('/:id', (req, res) => {
        const room = pokerRooms[req.params.id];
        if (room) {
            res.status(200).json({ room });
        } else {
            res.status(404).json({ message: 'Poker room not found.' });
        }
    });

    router.post('/create', async (req, res) => {
        const { creatorId } = req.body;
        if (!creatorId) return res.status(400).json({ message: 'Creator ID is required.' });

        if (Object.values(pokerRooms).some(room => room.host_id === creatorId || room.players[creatorId])) {
            return res.status(403).json({ message: 'You are already in a poker room.' });
        }

        const creator = await client.users.fetch(creatorId);
        const id = uuidv4();
        const name = uniqueNamesGenerator({ dictionaries: [adjectives, ['Poker']], separator: ' ', style: 'capital' });

        pokerRooms[id] = {
            id,
            host_id: creatorId,
            host_name: creator.globalName || creator.username,
            name,
            created_at: Date.now(),
            last_move_at: Date.now(),
            players: {},
            queue: {},
            pioche: initialShuffledCards(),
            tapis: [],
            dealer: null,
            sb: null,
            bb: null,
            highest_bet: 0,
            current_player: null,
            current_turn: null, // 0: pre-flop, 1: flop, 2: turn, 3: river, 4: showdown
            playing: false,
            winners: [],
            waiting_for_restart: false,
            fakeMoney: false,
        };

        // Auto-join the creator to their own room
        await joinRoom(id, creatorId, io);

        io.emit('poker-update', { type: 'room-created', roomId: id });
        res.status(201).json({ roomId: id });
    });

    router.post('/join', async (req, res) => {
        const { userId, roomId } = req.body;
        if (!userId || !roomId) return res.status(400).json({ message: 'User ID and Room ID are required.' });
        if (!pokerRooms[roomId]) return res.status(404).json({ message: 'Room not found.' });

        if (Object.values(pokerRooms).some(r => r.players[userId])) {
            return res.status(403).json({ message: 'You are already in a room.' });
        }

        await joinRoom(roomId, userId, io);
        res.status(200).json({ message: 'Successfully joined room.' });
    });

    router.post('/leave', (req, res) => {
        // Implement leave logic...
        res.status(501).json({ message: "Not Implemented" });
    });

    // --- Game Action Endpoints ---

    router.post('/:roomId/start', async (req, res) => {
        const { roomId } = req.params;
        const room = pokerRooms[roomId];
        if (!room) return res.status(404).json({ message: 'Room not found.' });
        if (Object.keys(room.players).length < 2) return res.status(400).json({ message: 'Not enough players to start.' });

        await startNewHand(room, io);
        res.status(200).json({ message: 'Game started.' });
    });

    router.post('/:roomId/action', async (req, res) => {
        const { roomId } = req.params;
        const { playerId, action, amount } = req.body;
        const room = pokerRooms[roomId];

        if (!room || !room.players[playerId] || room.current_player !== playerId) {
            return res.status(403).json({ message: "It's not your turn or you are not in this game." });
        }

        const player = room.players[playerId];

        switch(action) {
            case 'fold':
                player.folded = true;
                io.emit('poker-update', { type: 'player-action', roomId, playerId, action, globalName: player.globalName });
                break;
            case 'check':
                if (player.bet < room.highest_bet) return res.status(400).json({ message: 'Cannot check, you must call or raise.' });
                io.emit('poker-update', { type: 'player-action', roomId, playerId, action, globalName: player.globalName });
                break;
            case 'call':
                const callAmount = room.highest_bet - player.bet;
                if (callAmount > player.bank) { // All-in call
                    player.bet += player.bank;
                    player.bank = 0;
                    player.allin = true;
                } else {
                    player.bet += callAmount;
                    player.bank -= callAmount;
                }
                updatePlayerCoins(player, -callAmount, room.fakeMoney);
                io.emit('poker-update', { type: 'player-action', roomId, playerId, action, globalName: player.globalName });
                break;
            case 'raise':
                const totalBet = player.bet + amount;
                if (amount > player.bank || totalBet <= room.highest_bet) return res.status(400).json({ message: 'Invalid raise amount.' });

                player.bet = totalBet;
                player.bank -= amount;
                if(player.bank === 0) player.allin = true;
                room.highest_bet = totalBet;
                updatePlayerCoins(player, -amount, room.fakeMoney);
                io.emit('poker-update', { type: 'player-action', roomId, playerId, action, amount, globalName: player.globalName });
                break;
            default:
                return res.status(400).json({ message: 'Invalid action.' });
        }

        player.last_played_turn = room.current_turn;
        await checkRoundCompletion(room, io);
        res.status(200).json({ message: `Action '${action}' successful.` });
    });

    return router;
}


// --- Helper Functions ---

async function joinRoom(roomId, userId, io) {
    const user = await client.users.fetch(userId);
    const userDB = getUser.get(userId);
    const bank = userDB?.coins >= 1000 ? userDB.coins : 1000;
    const isFake = userDB?.coins < 1000;

    pokerRooms[roomId].players[userId] = {
        id: userId,
        globalName: user.globalName || user.username,
        hand: [],
        bank: bank,
        bet: 0,
        folded: false,
        allin: false,
        last_played_turn: null,
    };

    if(isFake) pokerRooms[roomId].fakeMoney = true;

    io.emit('poker-update', { type: 'player-join', roomId, player: pokerRooms[roomId].players[userId] });
}

async function startNewHand(room, io) {
    room.playing = true;
    room.current_turn = 0; // Pre-flop
    room.pioche = initialShuffledCards();
    room.tapis = [];
    room.winners = [];
    room.waiting_for_restart = false;
    room.highest_bet = 20;

    // Reset players for the new hand
    Object.values(room.players).forEach(p => {
        p.hand = [room.pioche.pop(), room.pioche.pop()];
        p.bet = 0;
        p.folded = false;
        p.allin = false;
        p.last_played_turn = null;
    });

    // Handle blinds
    const playerIds = Object.keys(room.players);
    const sbPlayer = room.players[playerIds[0]];
    const bbPlayer = room.players[playerIds[1]];

    sbPlayer.bet = 10;
    sbPlayer.bank -= 10;
    updatePlayerCoins(sbPlayer, -10, room.fakeMoney);

    bbPlayer.bet = 20;
    bbPlayer.bank -= 20;
    updatePlayerCoins(bbPlayer, -20, room.fakeMoney);

    bbPlayer.last_played_turn = 0;
    room.current_player = playerIds[2 % playerIds.length];

    io.emit('poker-update', { type: 'new-hand', room });
}

async function checkRoundCompletion(room, io) {
    room.last_move_at = Date.now();
    const roundResult = checkEndOfBettingRound(room);

    if (roundResult.endRound) {
        if (roundResult.winner) {
            // Handle single winner case (everyone else folded)
            await handleShowdown(room, io, [roundResult.winner]);
        } else {
            // Proceed to the next phase
            await advanceToNextPhase(room, io, roundResult.nextPhase);
        }
    } else {
        // Continue the round
        room.current_player = getNextActivePlayer(room);
        io.emit('poker-update', { type: 'next-player', room });
    }
}

async function advanceToNextPhase(room, io, phase) {
    // Reset player turn markers for the new betting round
    Object.values(room.players).forEach(p => p.last_played_turn = null);

    switch(phase) {
        case 'flop':
            room.current_turn = 1;
            room.tapis = [room.pioche.pop(), room.pioche.pop(), room.pioche.pop()];
            break;
        case 'turn':
            room.current_turn = 2;
            room.tapis.push(room.pioche.pop());
            break;
        case 'river':
            room.current_turn = 3;
            room.tapis.push(room.pioche.pop());
            break;
        case 'showdown':
            const winners = checkRoomWinners(room);
            await handleShowdown(room, io, winners);
            return;
        case 'progressive-showdown':
            // Show cards and deal remaining community cards one by one
            io.emit('poker-update', { type: 'show-cards', room });
            while(room.tapis.length < 5) {
                await sleep(1500);
                room.tapis.push(room.pioche.pop());
                io.emit('poker-update', { type: 'community-card-deal', room });
            }
            const finalWinners = checkRoomWinners(room);
            await handleShowdown(room, io, finalWinners);
            return;
    }
    room.current_player = getFirstActivePlayerAfterDealer(room);
    io.emit('poker-update', { type: 'phase-change', room });
}

async function handleShowdown(room, io, winners) {
    room.current_turn = 4;
    room.playing = false;
    room.waiting_for_restart = true;
    room.winners = winners;

    const totalPot = Object.values(room.players).reduce((sum, p) => sum + p.bet, 0);
    const winAmount = Math.floor(totalPot / winners.length);

    winners.forEach(winnerId => {
        const winnerPlayer = room.players[winnerId];
        winnerPlayer.bank += winAmount;
        updatePlayerCoins(winnerPlayer, winAmount, room.fakeMoney);
    });

    await pokerEloHandler(room);
    io.emit('poker-update', { type: 'showdown', room, winners, winAmount });
}

function updatePlayerCoins(player, amount, isFake) {
    if (isFake) return;
    const user = getUser.get(player.id);
    if (!user) return;

    const newCoins = user.coins + amount;
    updateUserCoins.run({ id: player.id, coins: newCoins });
    insertLog.run({
        id: `${player.id}-poker-${Date.now()}`,
        user_id: player.id,
        action: `POKER_${amount > 0 ? 'WIN' : 'BET'}`,
        coins_amount: amount,
        user_new_amount: newCoins,
    });
}