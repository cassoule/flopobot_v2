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
import {emitDataUpdated, socketEmit} from "../socket.js";
import {formatTime} from "../../../utils.js";

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

    router.post('/user/:id/daily', async (req, res) => {
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

            await emitDataUpdated({ table: 'users' });
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
                id: `${commandUserId}-changenick-${Date.now()}`,
                user_id: commandUserId,
                action: 'CHANGE_NICKNAME',
                target_user_id: userId,
                coins_amount: -1000,
                user_new_amount: newCoins,
            });

            res.status(200).json({ message: `Le pseudo de ${member.user.username} a été changé.` });
        } catch (error) {
            res.status(500).json({ message: `Erreur: Impossible de changer le pseudo.` });
        }
    });

    router.post('/spam-ping', async (req, res) => {
        const { userId, commandUserId } = req.body;

        const user = getUser.get(userId);
        const commandUser = getUser.get(commandUserId);

        if (!commandUser || !user) return res.status(404).json({ message: 'Oups petit soucis' });

        if (commandUser.coins < 10000) return res.status(403).json({ message: 'Pas assez de coins' });

        try {
            const discordUser = await client.users.fetch(userId);

            await discordUser.send(`<@${userId}>`)

            res.status(200).json({ message : 'C\'est parti ehehe' });

            updateUserCoins.run({
                id: commandUserId,
                coins: commandUser.coins - 10000,
            })
            insertLog.run({
                id: commandUserId + '-' + Date.now(),
                user_id: commandUserId,
                action: 'SPAM_PING',
                target_user_id: userId,
                coins_amount: -10000,
                user_new_amount: commandUser.coins - 10000,
            })
            await emitDataUpdated({ table: 'users', action: 'update' });

            for (let i = 0; i < 29; i++) {
                await discordUser.send(`<@${userId}>`)
                await sleep(1000);
            }
        } catch (err) {
            console.log(err)
            res.status(500).json({ message : "Oups ça n'a pas marché" });
        }
    });

    // --- Slowmode Routes ---

    router.get('/slowmodes', (req, res) => {
        res.status(200).json({ slowmodes: activeSlowmodes });
    });

    router.post('/slowmode', async (req, res) => {
        let { userId, commandUserId} = req.body

        const user = getUser.get(userId)
        const commandUser = getUser.get(commandUserId);

        if (!commandUser || !user) return res.status(404).json({ message: 'Oups petit soucis' });

        if (commandUser.coins < 10000) return res.status(403).json({ message: 'Pas assez de coins' });

        if (!user) return res.status(403).send({ message: 'Oups petit problème'})

        if (activeSlowmodes[userId]) {
            if (userId === commandUserId) {
                delete activeSlowmodes[userId];
                return res.status(200).json({ message: 'Slowmode retiré'})
            } else {
                let timeLeft = (activeSlowmodes[userId].endAt - Date.now())/1000
                timeLeft = timeLeft > 60 ? (timeLeft/60).toFixed()?.toString() + 'min' : timeLeft.toFixed()?.toString() + 'sec'
                return res.status(403).json({ message: `${user.globalName} est déjà en slowmode (${timeLeft})`})
            }
        } else if (userId === commandUserId) {
            return res.status(403).json({ message: 'Impossible de te mettre toi-même en slowmode'})
        }

        activeSlowmodes[userId] = {
            userId: userId,
            endAt: Date.now() + 60 * 60 * 1000, // 1 heure
            lastMessage: null,
        };
        await socketEmit('new-slowmode', { action: 'new slowmode' });

        updateUserCoins.run({
            id: commandUserId,
            coins: commandUser.coins - 10000,
        })
        insertLog.run({
            id: commandUserId + '-' + Date.now(),
            user_id: commandUserId,
            action: 'SLOWMODE',
            target_user_id: userId,
            coins_amount: -10000,
            user_new_amount: commandUser.coins - 10000,
        })
        await emitDataUpdated({ table: 'users', action: 'update' });

        return res.status(200).json({ message: `${user.globalName} est maintenant en slowmode pour 1h`})
    });

    // --- Prediction Routes ---

    router.get('/predis', (req, res) => {
        const reversedPredis = Object.fromEntries(Object.entries(activePredis).reverse());
        res.status(200).json({ predis: reversedPredis });
    });

    router.post('/start-predi', async (req, res) => {
        let { commandUserId, label, options, closingTime, payoutTime } = req.body

        const commandUser = getUser.get(commandUserId)

        if (!commandUser) return res.status(403).send({ message: 'Oups petit problème'})
        if (commandUser.coins < 100) return res.status(403).send({ message: 'Tu n\'as pas assez de FlopoCoins'})

        if (Object.values(activePredis).find(p => p.creatorId === commandUserId && (p.endTime > Date.now() && !p.closed))) {
            return res.status(403).json({ message: `Tu ne peux pas lancer plus d'une prédi à la fois !`})
        }

        const startTime = Date.now()
        const newPrediId = commandUserId?.toString() + '-' + startTime?.toString()

        let msgId;
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const generalChannel = guild.channels.cache.find(
                ch => ch.name === 'général' || ch.name === 'general'
            );
            const embed = new EmbedBuilder()
                .setTitle(`Prédiction de ${commandUser.username}`)
                .setDescription(`**${label}**`)
                .addFields(
                    { name: `${options[0]}`, value: ``, inline: true },
                    { name: ``, value: `ou`, inline: true },
                    { name: `${options[1]}`, value: ``, inline: true }
                )
                .setFooter({ text: `${formatTime(closingTime).replaceAll('*', '')} pour voter` })
                .setColor('#5865f2')
                .setTimestamp(new Date());

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`option_0_${newPrediId}`)
                        .setLabel(`+10 sur '${options[0]}'`)
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`option_1_${newPrediId}`)
                        .setLabel(`+10 sur '${options[1]}'`)
                        .setStyle(ButtonStyle.Primary)
                );

            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Voter sur FlopoSite')
                        .setURL(`${process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
                        .setStyle(ButtonStyle.Link)
                )

            const msg = await generalChannel.send({ embeds: [embed], components: [/*row,*/ row2] });
            msgId = msg.id;
        } catch (e) {
            console.log(e)
            return res.status(500).send({ message: 'Erreur lors de l\'envoi du message'})
        }

        const formattedOptions = [
            { label: options[0], votes: [], total: 0, percent: 0, },
            { label: options[1], votes: [], total: 0, percent: 0, },
        ]
        activePredis[newPrediId] = {
            creatorId: commandUserId,
            label: label,
            options: formattedOptions,
            startTime: startTime,
            closingTime: startTime + (closingTime * 1000),
            endTime: startTime + (closingTime * 1000) + (payoutTime * 1000),
            closed: false,
            winning: null,
            cancelledTime: null,
            paidTime: null,
            msgId: msgId,
        };
        await socketEmit('new-predi', { action: 'new predi' });

        updateUserCoins.run({
            id: commandUserId,
            coins: commandUser.coins - 100,
        })
        insertLog.run({
            id: commandUserId + '-' + Date.now(),
            user_id: commandUserId,
            action: 'START_PREDI',
            target_user_id: null,
            coins_amount: -100,
            user_new_amount: commandUser.coins - 100,
        })
        await emitDataUpdated({ table: 'users', action: 'update' });

        return res.status(200).json({ message: `Ta prédi '${label}' a commencée !`})
    });

    router.post('/vote-predi', async (req, res) => {
        const { commandUserId, predi, amount, option } = req.body

        let warning = false;

        let intAmount = parseInt(amount)
        if (intAmount < 10 || intAmount > 250000) return res.status(403).send({ message: 'Montant invalide'})

        const commandUser = getUser.get(commandUserId)
        if (!commandUser) return res.status(403).send({ message: 'Oups, je ne te connais pas'})
        if (commandUser.coins < intAmount) return res.status(403).send({ message: 'Tu n\'as pas assez de FlopoCoins'})

        const prediObject = activePredis[predi]
        if (!prediObject) return res.status(403).send({ message: 'Prédiction introuvable'})

        if (prediObject.endTime < Date.now()) return res.status(403).send({ message: 'Les votes de cette prédiction sont clos'})

        const otherOption = option === 0 ? 1 : 0;
        if (prediObject.options[otherOption].votes.find(v => v.id === commandUserId) && commandUserId !== process.env.DEV_ID) return res.status(403).send({ message: 'Tu ne peux pas voter pour les 2 deux options'})

        if (prediObject.options[option].votes.find(v => v.id === commandUserId)) {
            activePredis[predi].options[option].votes.forEach(v => {
                if (v.id === commandUserId) {
                    if (v.amount === 250000) {
                        return res.status(403).send({ message: 'Tu as déjà parié le max (250K)'})
                    }
                    if (v.amount + intAmount > 250000) {
                        intAmount = 250000-v.amount
                        warning = true
                    }
                    v.amount += intAmount
                }
            })
        } else {
            activePredis[predi].options[option].votes.push({
                id: commandUserId,
                amount: intAmount,
            })
        }
        activePredis[predi].options[option].total += intAmount

        activePredis[predi].options[option].percent = (activePredis[predi].options[option].total / (activePredis[predi].options[otherOption].total + activePredis[predi].options[option].total)) * 100
        activePredis[predi].options[otherOption].percent = 100 - activePredis[predi].options[option].percent

        await socketEmit('new-predi', { action: 'new vote' });

        updateUserCoins.run({
            id: commandUserId,
            coins: commandUser.coins - intAmount,
        })
        insertLog.run({
            id: commandUserId + '-' + Date.now(),
            user_id: commandUserId,
            action: 'PREDI_VOTE',
            target_user_id: null,
            coins_amount: -intAmount,
            user_new_amount: commandUser.coins - intAmount,
        })
        await emitDataUpdated({ table: 'users', action: 'update' });

        return res.status(200).send({ message : `Vote enregistré!` });
    });

    router.post('/end-predi', async (req, res) => {
        const { commandUserId, predi, confirm, winningOption } = req.body

        const commandUser = getUser.get(commandUserId)
        if (!commandUser) return res.status(403).send({ message: 'Oups, je ne te connais pas'})
        if (commandUserId !== process.env.DEV_ID) return res.status(403).send({ message: 'Tu n\'as pas les permissions requises' })

        const prediObject = activePredis[predi]
        if (!prediObject) return res.status(403).send({ message: 'Prédiction introuvable'})
        if (prediObject.closed) return res.status(403).send({ message: 'Prédiction déjà close'})

        if (!confirm) {
            activePredis[predi].cancelledTime = new Date();
            activePredis[predi].options[0].votes.forEach((v) => {
                const tempUser = getUser.get(v.id)
                try {
                    updateUserCoins.run({
                        id: v.id,
                        coins: tempUser.coins + v.amount
                    })
                    insertLog.run({
                        id: v.id + '-' + Date.now(),
                        user_id: v.id,
                        action: 'PREDI_REFUND',
                        target_user_id: v.id,
                        coins_amount: v.amount,
                        user_new_amount: tempUser.coins + v.amount,
                    })
                } catch (e) {
                    console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`)
                }
            })
            activePredis[predi].options[1].votes.forEach((v) => {
                const tempUser = getUser.get(v.id)
                try {
                    updateUserCoins.run({
                        id: v.id,
                        coins: tempUser.coins + v.amount
                    })
                    insertLog.run({
                        id: v.id + '-' + Date.now(),
                        user_id: v.id,
                        action: 'PREDI_REFUND',
                        target_user_id: v.id,
                        coins_amount: v.amount,
                        user_new_amount: tempUser.coins + v.amount,
                    })
                } catch (e) {
                    console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`)
                }
            })
            activePredis[predi].closed = true;
        }
        else {
            const losingOption = winningOption === 0 ? 1 : 0;
            activePredis[predi].options[winningOption].votes.forEach((v) => {
                const tempUser = getUser.get(v.id)
                const ratio = activePredis[predi].options[winningOption].total === 0 ? 0 : activePredis[predi].options[losingOption].total / activePredis[predi].options[winningOption].total
                try {
                    updateUserCoins.run({
                        id: v.id,
                        coins: tempUser.coins + (v.amount * (1 + ratio))
                    })
                    insertLog.run({
                        id: v.id + '-' + Date.now(),
                        user_id: v.id,
                        action: 'PREDI_RESULT',
                        target_user_id: v.id,
                        coins_amount: v.amount * (1 + ratio),
                        user_new_amount: tempUser.coins + (v.amount * (1 + ratio)),
                    })
                } catch (e) {
                    console.log(`Impossible de créditer ${v.id} (${v.amount} coins pariés, *${1 + ratio})`)
                }
            })
            activePredis[predi].paidTime = new Date();
            activePredis[predi].closed = true;
            activePredis[predi].winning = winningOption;
        }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const generalChannel = guild.channels.cache.find(
                ch => ch.name === 'général' || ch.name === 'general'
            );
            const message = await generalChannel.messages.fetch(activePredis[predi].msgId)
            const updatedEmbed = new EmbedBuilder()
                .setTitle(`Prédiction de ${commandUser.username}`)
                .setDescription(`**${activePredis[predi].label}**`)
                .setFields({ name: `${activePredis[predi].options[0].label}`, value: ``, inline: true },
                    { name: ``, value: `ou`, inline: true },
                    { name: `${activePredis[predi].options[1].label}`, value: ``, inline: true },
                )
                .setFooter({ text: `${activePredis[predi].cancelledTime !== null ? 'Prédi annulée' : 'Prédi confirmée !' }` })
                .setTimestamp(new Date());
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Voir')
                        .setURL(`${process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
                        .setStyle(ButtonStyle.Link)
                )
            await message.edit({ embeds: [updatedEmbed], components: [row] });
        } catch (err) {
            console.error('Error updating prédi message:', err);
        }

        await socketEmit('new-predi', { action: 'closed predi' });
        await emitDataUpdated({ table: 'users', action: 'fin predi' });

        return res.status(200).json({ message: 'Prédi close' });
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

        res.status(200).json({ message: `Added ${coins} coins.` });
    });

    return router;
}