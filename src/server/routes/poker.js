import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { uniqueNamesGenerator, adjectives } from 'unique-names-generator';
import pkg from 'pokersolver';
const { Hand } = pkg;

import { pokerRooms } from '../../game/state.js';
import { initialShuffledCards, getFirstActivePlayerAfterDealer, getNextActivePlayer, checkEndOfBettingRound, checkRoomWinners } from '../../game/poker.js';
import { pokerEloHandler } from '../../game/elo.js';
import { getUser, updateUserCoins, insertLog } from '../../database/index.js';
import { sleep } from "openai/core";
import {client} from "../../bot/client.js";
import {emitPokerToast, emitPokerUpdate} from "../socket.js";

const router = express.Router();

/**
 * Factory function to create and configure the poker API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance. // FIX: Pass io in as a parameter
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
        const { creatorId, minBet, fakeMoney } = req.body;
        if (!creatorId) return res.status(400).json({ message: 'Creator ID is required.' });

        if (Object.values(pokerRooms).some(room => room.host_id === creatorId || room.players[creatorId])) {
            return res.status(403).json({ message: 'You are already in a poker room.' });
        }

        const creator = await client.users.fetch(creatorId);
        const id = uuidv4();
        const name = uniqueNamesGenerator({ dictionaries: [adjectives, ['Poker']], separator: ' ', style: 'capital' });

        pokerRooms[id] = {
            id, host_id: creatorId, host_name: creator.globalName || creator.username,
            name, created_at: Date.now(), last_move_at: null,
            players: {}, queue: {}, afk: {}, pioche: initialShuffledCards(), tapis: [],
            dealer: null, sb: null, bb: null, highest_bet: 0, current_player: null,
            current_turn: null, playing: false, winners: [], waiting_for_restart: false, fakeMoney: fakeMoney,
            minBet: minBet,
        };

        await joinRoom(id, creatorId, io); // Auto-join the creator
        await emitPokerUpdate({ room: pokerRooms[id], type: 'room-created' });
        res.status(201).json({ roomId: id });
    });

    router.post('/join', async (req, res) => {
        const { userId, roomId } = req.body;
        if (!userId || !roomId) return res.status(400).json({ message: 'User ID and Room ID are required.' });
        if (!pokerRooms[roomId]) return res.status(404).json({ message: 'Room not found.' });
        if (Object.values(pokerRooms).some(r => r.players[userId] || r.queue[userId])) {
            return res.status(403).json({ message: 'You are already in a room or queue.' });
        }
        if (!pokerRooms[roomId].fakeMoney && pokerRooms[roomId].minBet > (getUser.get(userId)?.coins ?? 0)) {
            return res.status(403).json({ message: 'You do not have enough coins to join this room.' });
        }

        await joinRoom(roomId, userId, io);
        res.status(200).json({ message: 'Successfully joined.' });
    });

    // NEW: Endpoint to accept a player from the queue
    router.post('/accept', async (req, res) => {
        const { hostId, playerId, roomId } = req.body;
        const room = pokerRooms[roomId];
        if (!room || room.host_id !== hostId || !room.queue[playerId]) {
            return res.status(403).json({ message: 'Unauthorized or player not in queue.' });
        }

        if (!room.fakeMoney) {
            const userDB = getUser.get(playerId);
            if (userDB) {
                updateUserCoins.run({ id: playerId, coins: userDB.coins - room.minBet });
                insertLog.run({
                    id: `${playerId}-poker-${Date.now()}`,
                    user_id: playerId, target_user_id: null,
                    action: 'POKER_JOIN',
                    coins_amount: -room.minBet, user_new_amount: userDB.coins - room.minBet,
                })
            }
        }

        room.players[playerId] = room.queue[playerId];
        delete room.queue[playerId];

        await emitPokerUpdate({ room: room, type: 'player-accepted' });
        res.status(200).json({ message: 'Player accepted.' });
    });

    router.post('/leave', async (req, res) => {
        const { userId, roomId } = req.body

        if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
        if (!pokerRooms[roomId].players[userId]) return res.status(404).send({ message: 'Joueur introuvable' })

        if (pokerRooms[roomId].playing && (pokerRooms[roomId].current_turn !== null && pokerRooms[roomId].current_turn !== 4)) {
            pokerRooms[roomId].afk[userId] = pokerRooms[roomId].players[userId]

            try {
                pokerRooms[roomId].players[userId].folded = true
                pokerRooms[roomId].players[userId].last_played_turn = pokerRooms[roomId].current_turn
                if (pokerRooms[roomId].current_player === userId) {
                    await checkRoundCompletion(pokerRooms[roomId], io);
                }
            } catch(e) {
                console.log(e)
            }

            await emitPokerUpdate({ type: 'player-afk' });
            return res.status(200)
        }

        try {
            updatePlayerCoins(pokerRooms[roomId].players[userId], pokerRooms[roomId].players[userId].bank, pokerRooms[roomId].fakeMoney);
            delete pokerRooms[roomId].players[userId]

            if (userId === pokerRooms[roomId].host_id) {
                const newHostId = Object.keys(pokerRooms[roomId].players).find(id => id !== userId)
                if (!newHostId) {
                    delete pokerRooms[roomId]
                } else {
                    pokerRooms[roomId].host_id = newHostId
                }
            }
        } catch (e) {
            //
        }

        await emitPokerUpdate({ type: 'player-left' });
        return res.status(200)
    });

    router.post('/kick', async (req, res) => {
        const { commandUserId, userId, roomId } = req.body

        if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
        if (!pokerRooms[roomId].players[commandUserId]) return res.status(404).send({ message: 'Joueur introuvable' })
        if (pokerRooms[roomId].host_id !== commandUserId) return res.status(403).send({ message: 'Seul l\'host peut kick' })
        if (!pokerRooms[roomId].players[userId]) return res.status(404).send({ message: 'Joueur introuvable' })

        if (pokerRooms[roomId].playing && (pokerRooms[roomId].current_turn !== null && pokerRooms[roomId].current_turn !== 4)) {
            return res.status(403).send({ message: 'Playing' })
        }

        try {
            updatePlayerCoins(pokerRooms[roomId].players[userId], pokerRooms[roomId].players[userId].bank, pokerRooms[roomId].fakeMoney);
            delete pokerRooms[roomId].players[userId]

            if (userId === pokerRooms[roomId].host_id) {
                const newHostId = Object.keys(pokerRooms[roomId].players).find(id => id !== userId)
                if (!newHostId) {
                    delete pokerRooms[roomId]
                } else {
                    pokerRooms[roomId].host_id = newHostId
                }
            }
        } catch (e) {
            //
        }

        await emitPokerUpdate({ type: 'player-kicked' });
        return res.status(200)
    });

    // --- Game Action Endpoints ---

    router.post('/start', async (req, res) => {
        const { roomId } = req.body;
        const room = pokerRooms[roomId];
        if (!room) return res.status(404).json({ message: 'Room not found.' });
        if (Object.keys(room.players).length < 2) return res.status(400).json({ message: 'Not enough players to start.' });

        await startNewHand(room, io);
        res.status(200).json({ message: 'Game started.' });
    });

    // NEW: Endpoint to start the next hand
    router.post('/next-hand', async (req, res) => {
        const { roomId } = req.body;
        const room = pokerRooms[roomId];
        if (!room || !room.waiting_for_restart) {
            return res.status(400).json({ message: 'Not ready for the next hand.' });
        }
        await startNewHand(room, io);
        res.status(200).json({ message: 'Next hand started.' });
    });

    router.post('/action/:action', async (req, res) => {
        const { playerId, amount, roomId } = req.body;
        const { action } = req.params;
        const room = pokerRooms[roomId];

        if (!room || !room.players[playerId] || room.current_player !== playerId) {
            return res.status(403).json({ message: "It's not your turn or you are not in this game." });
        }

        const player = room.players[playerId];

        switch(action) {
            case 'fold':
                player.folded = true;
                await emitPokerToast({
                    type: 'player-fold',
                    playerId: player.id,
                    playerName: player.globalName,
                    roomId: room.id,
                })
                break;
            case 'check':
                if (player.bet < room.highest_bet) return res.status(400).json({ message: 'Cannot check.' });
                await emitPokerToast({
                    type: 'player-check',
                    playerId: player.id,
                    playerName: player.globalName,
                    roomId: room.id,
                })
                break;
            case 'call':
                const callAmount = Math.min(room.highest_bet - player.bet, player.bank);
                player.bank -= callAmount;
                player.bet += callAmount;
                if (player.bank === 0) player.allin = true;
                await emitPokerToast({
                    type: 'player-call',
                    playerId: player.id,
                    playerName: player.globalName,
                    roomId: room.id,
                })
                break;
            case 'raise':
                if (amount <= 0 || amount > player.bank || (player.bet + amount) <= room.highest_bet) {
                    return res.status(400).json({ message: 'Invalid raise amount.' });
                }
                player.bank -= amount;
                player.bet += amount;
                if (player.bank === 0) player.allin = true;
                room.highest_bet = player.bet;
                await emitPokerToast({
                    type: 'player-raise',
                    amount: amount,
                    playerId: player.id,
                    playerName: player.globalName,
                    roomId: room.id,
                })
                break;
            default: return res.status(400).json({ message: 'Invalid action.' });
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
    const room = pokerRooms[roomId];

    const playerObject = {
        id: userId, globalName: user.globalName || user.username,
        hand: [], bank: room.minBet, bet: 0, folded: false, allin: false,
        last_played_turn: null, solve: null
    };

    if (room.playing) {
        room.queue[userId] = playerObject;
    } else {
        room.players[userId] = playerObject;
        if (!room.fakeMoney) {
            updateUserCoins.run({ id: userId, coins: userDB.coins - room.minBet });
            insertLog.run({
                id: `${userId}-poker-${Date.now()}`,
                user_id: userId, target_user_id: null,
                action: 'POKER_JOIN',
                coins_amount: -room.minBet, user_new_amount: userDB.coins - room.minBet,
            })
        }
    }

    await emitPokerUpdate({ room: room, type: 'player-joined' });
}

async function startNewHand(room, io) {
    const playerIds = Object.keys(room.players);
    if (playerIds.length < 2) {
        room.playing = false; // Not enough players to continue
        await emitPokerUpdate({ room: room, type: 'new-hand' });
        return;
    }

    room.playing = true;
    room.current_turn = 0; // Pre-flop
    room.pioche = initialShuffledCards();
    room.tapis = [];
    room.winners = [];
    room.waiting_for_restart = false;
    room.highest_bet = 20;
    room.last_move_at = Date.now();

    // Rotate dealer
    const oldDealerIndex = playerIds.indexOf(room.dealer);
    room.dealer = playerIds[(oldDealerIndex + 1) % playerIds.length];

    Object.values(room.players).forEach(p => {
        p.hand = [room.pioche.pop(), room.pioche.pop()];
        p.bet = 0; p.folded = false; p.allin = false; p.last_played_turn = null;
    });
    updatePlayerHandSolves(room); // NEW: Calculate initial hand strength

    // Handle blinds based on new dealer
    const dealerIndex = playerIds.indexOf(room.dealer);
    const sbPlayer = room.players[playerIds[(dealerIndex + 1) % playerIds.length]];
    const bbPlayer = room.players[playerIds[(dealerIndex + 2) % playerIds.length]];
    room.sb = sbPlayer.id;
    room.bb = bbPlayer.id;

    sbPlayer.bank -= 10; sbPlayer.bet = 10;
    bbPlayer.bank -= 20; bbPlayer.bet = 20;

    bbPlayer.last_played_turn = 0;
    room.current_player = playerIds[(dealerIndex + 3) % playerIds.length];
    await emitPokerUpdate({ room: room, type: 'room-started' });
}

async function checkRoundCompletion(room, io) {
    room.last_move_at = Date.now();
    const roundResult = checkEndOfBettingRound(room);

    if (roundResult.endRound) {
        if (roundResult.winner) {
            await handleShowdown(room, io, [roundResult.winner]);
        } else {
            await advanceToNextPhase(room, io, roundResult.nextPhase);
        }
    } else {
        room.current_player = getNextActivePlayer(room);
        await emitPokerUpdate({ room: room, type: 'round-continue' });
    }
}

async function advanceToNextPhase(room, io, phase) {
    Object.values(room.players).forEach(p => { if (!p.folded) p.last_played_turn = null; });

    switch(phase) {
        case 'flop':
            room.current_turn = 1;
            room.tapis.push(room.pioche.pop(), room.pioche.pop(), room.pioche.pop());
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
            await handleShowdown(room, io, checkRoomWinners(room));
            return;
        case 'progressive-showdown':
            await emitPokerUpdate({ room: room, type: 'progressive-showdown' });
            while(room.tapis.length < 5) {
                await sleep(500);
                room.tapis.push(room.pioche.pop());
                updatePlayerHandSolves(room);
                await emitPokerUpdate({ room: room, type: 'progressive-showdown' });
            }
            await handleShowdown(room, io, checkRoomWinners(room));
            return;
    }
    updatePlayerHandSolves(room); // NEW: Update hand strength after new cards
    room.current_player = getFirstActivePlayerAfterDealer(room);
    await emitPokerUpdate({ room: room, type: 'phase-advanced' });
}

async function handleShowdown(room, io, winners) {
    room.current_turn = 4;
    room.playing = false;
    room.waiting_for_restart = true;
    room.winners = winners;
    room.current_player = null;

    let totalPot = 0;
    Object.values(room.players).forEach(p => { totalPot += p.bet; });

    const winAmount = winners.length > 0 ? Math.floor(totalPot / winners.length) : 0;

    winners.forEach(winnerId => {
        const winnerPlayer = room.players[winnerId];
        if(winnerPlayer) {
            winnerPlayer.bank += winAmount;
        }
    });

    await clearAfkPlayers(room);

    console.log(room)

    //await pokerEloHandler(room);
    await emitPokerUpdate({ room: room, type: 'showdown' });
    await emitPokerToast({
        type: 'player-winner',
        playerIds: winners,
        roomId: room.id,
        amount: winAmount,
    })
}

// NEW: Function to calculate and update hand strength for all players
function updatePlayerHandSolves(room) {
    const communityCards = room.tapis;
    for (const player of Object.values(room.players)) {
        if (!player.folded) {
            const allCards = [...communityCards, ...player.hand];
            player.solve = Hand.solve(allCards).descr;
        }
    }
}

function updatePlayerCoins(player, amount, isFake) {
    if (isFake) return;
    const user = getUser.get(player.id);
    if (!user) return;

    const userDB = getUser.get(player.id);
    updateUserCoins.run({ id: player.id, coins: userDB.coins + amount });
    insertLog.run({
        id: `${player.id}-poker-${Date.now()}`,
        user_id: player.id, target_user_id: null,
        action: `POKER_${amount > 0 ? 'WIN' : 'BET'}`,
        coins_amount: amount, user_new_amount: userDB.coins + amount,
    });
}

async function clearAfkPlayers(room) {
    Object.keys(room.afk).forEach(playerId => {
        if (room.players[playerId]) {
            updatePlayerCoins(room.players[playerId], room.players[playerId].bank, room.fakeMoney);
            delete room.players[playerId];
        }
    });
    room.afk = {};
}