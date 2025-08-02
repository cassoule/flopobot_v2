import express from "express";
import { v4 as uuidv4 } from 'uuid';
import {eryniesRooms} from "../../game/state.js";
import {socketEmit} from "../socket.js";

const router = express.Router();

/**
 * Factory function to create and configure the Erynies API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function eryniesRoutes(client, io) {

    // --- Router Management Endpoints

    router.get('/', (req, res) => {
        res.status(200).json({ rooms: eryniesRooms })
    })

    router.get('/:id', (req, res) => {
        const room = eryniesRooms[req.params.id];
        if (room) {
            res.status(200).json({ room });
        } else {
            res.status(404).json({ message: 'Room not found.' });
        }
    })

    router.post('/create', async (req, res) => {
        const { creatorId } = req.body;
        if (!creatorId) return res.status(404).json({ message: 'Creator ID is required.' });

        if (Object.values(eryniesRooms).some(room => creatorId === room.host_id || room.players[creatorId])) {
            res.status(404).json({ message: 'You are already in a room.' });
        }

        const creator = await client.users.fetch(creatorId);
        const id = uuidv4()

        eryniesRooms[id] = {
            id,
            host_id: creatorId,
            host_name: creator.globalName,
            created_at: Date.now(),
            last_move_at: null,
            players: {},
            current_player: null,
            current_turn: null,
            playing: false,
            winners: [],
        };

        await socketEmit('erynies-update', { room: eryniesRooms[id], type: 'room-created' });
        res.status(200).json({ room: id });
    })

    return router;
}