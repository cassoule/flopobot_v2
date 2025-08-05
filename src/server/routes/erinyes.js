import express from "express";
import { v4 as uuidv4 } from 'uuid';
import {erinyesRooms} from "../../game/state.js";
import {socketEmit} from "../socket.js";

const router = express.Router();

/**
 * Factory function to create and configure the erinyes API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function erinyesRoutes(client, io) {

    // --- Router Management Endpoints

    router.get('/', (req, res) => {
        res.status(200).json({ rooms: erinyesRooms })
    })

    router.get('/:id', (req, res) => {
        const room = erinyesRooms[req.params.id];
        if (room) {
            res.status(200).json({ room });
        } else {
            res.status(404).json({ message: 'Room not found.' });
        }
    })

    router.post('/create', async (req, res) => {
        const { creatorId } = req.body;
        if (!creatorId) return res.status(404).json({ message: 'Creator ID is required.' });

        if (Object.values(erinyesRooms).some(room => creatorId === room.host_id || room.players[creatorId])) {
            res.status(404).json({ message: 'You are already in a room.' });
        }

        const creator = await client.users.fetch(creatorId);
        const id = uuidv4()

        createRoom({
            host_id: creatorId,
            host_name: creator.globalName,
            game_rules: {}, // Specific game rules
            roles: [], // Every role in the game
        })

        await socketEmit('erinyes-update', { room: erinyesRooms[id], type: 'room-created' });
        res.status(200).json({ room: id });
    })

    return router;
}

function createRoom(config) {
    erinyesRooms[config.id] = {
        host_id: config.host_id,
        host_name: config.host_name,
        created_at: Date.now(),
        last_move_at: null,
        players: {},
        current_player: null,
        current_turn: null,
        playing: false,
        game_rules: createGameRules(config.game_rules),
        roles: config.roles,
        roles_rules: createRolesRules(config.roles),
        bonuses: {}
    }
}

function createGameRules(config) {
    return {
        day_vote_time: config.day_vote_time ?? 60000,
        // ...
    };
}

function createRolesRules(roles) {
    const roles_rules = {}

    roles.forEach(role => {
        switch (role) {
            case 'erynie':
                roles_rules[role] = {
                    //...
                };
                break;
            //...
            default:
                roles_rules[role] = {
                    //...
                };
                break;
        }
    })

    return roles_rules;
}