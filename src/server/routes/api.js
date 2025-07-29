import express from 'express';
import { sleep } from 'openai/core';

// --- Database Imports ---
import {
    getAllUsers, getUsersByElo, pruneOldLogs, getLogs, getUser,
    getUserLogs, getUserElo, getUserGames, getUserInventory,
    queryDailyReward, updateUserCoins, insertLog,
} from '../../database/index.js';

// --- Game State Imports ---
import { activePolls, activeSlowmodes, activePredis } from '../../game/state.js';

// --- Utility and API Imports ---
import { getOnlineUsersWithRole } from '../../utils/index.js';
import { DiscordRequest } from '../../api/discord.js';

// --- Discord.js Builder Imports ---
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Create a new router instance
const router = express.Router();

/**
 * Factory function to create and configure the main API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function apiRoutes(client, io) {
    // --- Server Health & Basic Data ---

    router.get('/check', (req, res) => {
        res.status(200).json({ status: 'OK', message: 'FlopoBot API is running.' });
    });

    router.get('/users', (req, res) => {
        try {
            const users = getAllUsers.all();
            res.json(users);
        } catch (error) {
            console.error("Error fetching users:", error);
            res.status(500).json({ error: 'Failed to fetch users.' });
        }
    });

    router.get('/users/by-elo', (req, res) => {
        try {
            const users = getUsersByElo.all();
            res.json(users);
        } catch (error) {
            console.error("Error fetching users by Elo:", error);
            res.status(500).json({ error: 'Failed to fetch users by Elo.' });
        }
    });

    router.get('/logs', async (req, res) => {
        try {
            await pruneOldLogs();
            const logs = getLogs.all();
            res.status(200).json(logs);
        } catch (error) {
            console.error("Error fetching logs:", error);
            res.status(500).json({ error: 'Failed to fetch logs.' });
        }
    });

    // --- User-Specific Routes ---

    router.get('/user/:id/avatar', async (req, res) => {
        try {
            const user = await client.users.fetch(req.params.id);
            const avatarUrl = user.displayAvatarURL({ format: 'png', size: 256 });
            res.json({ avatarUrl });
        } catch (error) {
            res.status(404).json({ error: 'User not found or failed to fetch avatar.' });
        }
    });

    router.get('/user/:id/username', async (req, res) => {
        try {
            const user = await client.users.fetch(req.params.id);
            res.json({ user });
        } catch (error) {
            res.status(404).json({ error: 'User not found.' });
        }
    });

    router.get('/user/:id/sparkline', (req, res) => {
        try {
            const logs = getUserLogs.all({ user_id: req.params.id });
            res.json({ sparkline: logs });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch logs for sparkline.' });
        }
    });

    router.get('/user/:id/elo', (req, res) => {
        try {
            const eloData = getUserElo.get({ id: req.params.id });
            res.json({ elo: eloData?.elo || null });
        } catch(e) {
            res.status(500).json({ error: 'Failed to fetch Elo data.' });
        }
    });

    router.get('/user/:id/elo-graph', (req, res) => {
        try {
            const games = getUserGames.all({ user_id: req.params.id });
            const eloHistory = games.map(game => game.p1 === req.params.id ? game.p1_new_elo : game.p2_new_elo);
            res.json({ elo_graph: eloHistory });
        } catch (e) {
            res.status(500).json({ error: 'Failed to generate Elo graph.' });
        }
    });

    router.get('/user/:id/inventory', (req, res) => {
        try {
            const inventory = getUserInventory.all({ user_id: req.params.id });
            res.json({ inventory });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch inventory.' });
        }
    });

    router.post('/user/:id/daily', (req, res) => {
        const { id } = req.params;
        try {
            const akhy = getUser.get(id);
            if (!akhy) return res.status(404).json({ message: 'Utilisateur introuvable' });
            if (akhy.dailyQueried) return res.status(403).json({ message: 'Récompense journalière déjà récupérée.' });

            const amount = 200;
            const newCoins = akhy.coins + amount;
            queryDailyReward.run(id);
            updateUserCoins.run({ id, coins: newCoins });
            insertLog.run({
                id: `${id}-daily-${Date.now()}`, user_id: id, action: 'DAILY_REWARD',
                coins_amount: amount, user_new_amount: newCoins,
            });

            io.emit('data-updated', { table: 'users' });
            res.status(200).json({ message: `+${amount} FlopoCoins! Récompense récupérée !` });
        } catch (error) {
            res.status(500).json({ error: "Failed to process daily reward." });
        }
    });

    // --- Poll & Timeout Routes ---

    router.get('/polls', (req, res) => {
        res.json({ activePolls });
    });

    router.post('/timedout', async (req, res) => {
        try {
            const { userId } = req.body;
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            res.status(200).json({ isTimedOut: member?.isCommunicationDisabled() || false });
        } catch (e) {
            res.status(404).send({ message: 'Member not found or guild unavailable.' });
        }
    });

    // --- Shop & Interaction Routes ---

    router.post('/change-nickname', async (req, res) => {
        const { userId, nickname, commandUserId } = req.body;
        const commandUser = getUser.get(commandUserId);
        if (!commandUser) return res.status(404).json({ message: 'Command user not found.' });
        if (commandUser.coins < 1000) return res.status(403).json({ message: 'Pas assez de FlopoCoins (1000 requis).' });

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            await member.setNickname(nickname);

            const newCoins = commandUser.coins - 1000;
            updateUserCoins.run({ id: commandUserId, coins: newCoins });
            insertLog.run({
                id: `${commandUserId}-changenick-${Date.now()}`, user_id: commandUserId, action: 'CHANGE_NICKNAME',
                target_user_id: userId, coins_amount: -1000, user_new_amount: newCoins,
            });

            io.emit('data-updated', { table: 'users' });
            res.status(200).json({ message: `Le pseudo de ${member.user.username} a été changé.` });
        } catch (error) {
            res.status(500).json({ message: `Erreur: Impossible de changer le pseudo.` });
        }
    });

    router.post('/spam-ping', async (req, res) => {
        // Implement spam-ping logic here...
        res.status(501).json({ message: "Not Implemented" });
    });

    // --- Slowmode Routes ---

    router.get('/slowmodes', (req, res) => {
        res.status(200).json({ slowmodes: activeSlowmodes });
    });

    router.post('/slowmode', (req, res) => {
        // Implement slowmode logic here...
        res.status(501).json({ message: "Not Implemented" });
    });

    // --- Prediction Routes ---

    router.get('/predis', (req, res) => {
        const reversedPredis = Object.fromEntries(Object.entries(activePredis).reverse());
        res.status(200).json({ predis: reversedPredis });
    });

    router.post('/start-predi', async (req, res) => {
        // Implement prediction start logic here...
        res.status(501).json({ message: "Not Implemented" });
    });

    router.post('/vote-predi', (req, res) => {
        // Implement prediction vote logic here...
        res.status(501).json({ message: "Not Implemented" });
    });

    router.post('/end-predi', (req, res) => {
        // Implement prediction end logic here...
        res.status(501).json({ message: "Not Implemented" });
    });

    // --- Admin Routes ---

    router.post('/buy-coins', (req, res) => {
        const { commandUserId, coins } = req.body;
        const user = getUser.get(commandUserId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const newCoins = user.coins + coins;
        updateUserCoins.run({ id: commandUserId, coins: newCoins });
        insertLog.run({
            id: `${commandUserId}-buycoins-${Date.now()}`, user_id: commandUserId, action: 'BUY_COINS_ADMIN',
            coins_amount: coins, user_new_amount: newCoins
        });

        io.emit('data-updated', { table: 'users' });
        res.status(200).json({ message: `Added ${coins} coins.` });
    });

    return router;
}