import { sleep } from 'openai/core';
import { gork } from '../../utils/ai.js';
import {formatTime, postAPOBuy, getAPOUsers, getAkhys} from '../../utils/index.js';
import { channelPointsHandler, slowmodesHandler, randomSkinPrice, initTodaysSOTD } from '../../game/points.js';
import { requestTimestamps, activeSlowmodes, activePolls, skins } from '../../game/state.js';
import {flopoDB, getUser, getAllUsers, updateManyUsers, insertUser, updateUserAvatar} from '../../database/index.js';
import {client} from "../client.js";

// Constants for the AI rate limiter
const MAX_REQUESTS_PER_INTERVAL = parseInt(process.env.MAX_REQUESTS || "5");
const SPAM_INTERVAL = parseInt(process.env.SPAM_INTERVAL || "60000"); // 60 seconds default

/**
 * Handles all logic for when a message is created.
 * @param {object} message - The Discord.js message object.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 */
export async function handleMessageCreate(message, client, io) {
    // Ignore all messages from bots to prevent loops
    if (message.author.bot) return;

    // --- Specific User Gags ---
    if (message.author.id === process.env.PATA_ID) {
        if (message.content.toLowerCase().startsWith('feur') || message.content.toLowerCase().startsWith('rati')) {
            await sleep(1000);
            await message.delete().catch(console.error);
        }
    }

    // --- Main Guild Features (Points & Slowmode) ---
    if (message.guildId === process.env.GUILD_ID) {
        // Award points for activity
        const pointsAwarded = await channelPointsHandler(message);
        if (pointsAwarded) {
            io.emit('data-updated', { table: 'users', action: 'update' });
        }

        // Enforce active slowmodes
        const wasSlowmoded = await slowmodesHandler(message, activeSlowmodes);
        if (wasSlowmoded.deleted) {
            io.emit('slowmode-update');
        }
    }

    // --- AI Mention Handler ---
    if (message.mentions.has(client.user) || message.mentions.repliedUser?.id === client.user.id) {
        await handleAiMention(message, client, io);
        return; // Stop further processing after AI interaction
    }

    // --- "Quoi/Feur" Gag ---
    if (message.content.toLowerCase().includes("quoi")) {
        const prob = Math.random();
        if (prob < (parseFloat(process.env.FEUR_PROB) || 0.05)) {
            message.channel.send('feur').catch(console.error);
        }
        return;
    }

    // --- Admin/Dev Guild Commands ---
    if (message.guildId === process.env.DEV_GUILD_ID && message.author.id === process.env.DEV_ID) {
        await handleAdminCommands(message);
    }
}


// --- Sub-handler for AI Logic ---

async function handleAiMention(message, client, io) {
    const authorId = message.author.id;
    let authorDB = getUser.get(authorId);
    if (!authorDB) return; // Should not happen if user is in DB, but good practice

    // --- Rate Limiting ---
    const now = Date.now();
    const timestamps = (requestTimestamps.get(authorId) || []).filter(ts => now - ts < SPAM_INTERVAL);

    if (timestamps.length >= MAX_REQUESTS_PER_INTERVAL) {
        console.log(`Rate limit exceeded for ${authorDB.username}`);
        if (!authorDB.warned) {
            await message.reply(`T'abuses fréro, attends un peu ⏳`).catch(console.error);
        }
        // Update user's warn status
        authorDB.warned = 1;
        authorDB.warns += 1;
        authorDB.allTimeWarns += 1;
        updateManyUsers([authorDB]);

        // Apply timeout if warn count is too high
        if (authorDB.warns > (parseInt(process.env.MAX_WARNS) || 10)) {
            try {
                const member = await message.guild.members.fetch(authorId);
                const time = parseInt(process.env.SPAM_TIMEOUT_TIME);
                await member.timeout(time, 'Spam excessif du bot AI.');
                message.channel.send(`Ce bouffon de <@${authorId}> a été timeout pendant ${formatTime(time / 1000)}, il me cassait les couilles 🤫`).catch(console.error);
            } catch (e) {
                console.error('Failed to apply timeout for AI spam:', e);
                message.channel.send(`<@${authorId}>, tu as de la chance que je ne puisse pas te timeout...`).catch(console.error);
            }
        }
        return;
    }

    timestamps.push(now);
    requestTimestamps.set(authorId, timestamps);

    // Reset warns if user is behaving, and increment their request count
    authorDB.warned = 0;
    authorDB.warns = 0;
    authorDB.totalRequests += 1;
    updateManyUsers([authorDB]);


    // --- AI Processing ---
    try {
        message.channel.sendTyping();
        // Fetch last 20 messages for context
        const fetchedMessages = await message.channel.messages.fetch({ limit: 20 });
        const messagesArray = Array.from(fetchedMessages.values()).reverse(); // Oldest to newest

        const requestMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

        // Format the conversation for the AI
        const messageHistory = messagesArray.map(msg => ({
            role: msg.author.id === client.user.id ? 'assistant' : 'user',
            content: `<@${msg.author.id}> a dit: ${msg.content}`
        }));

        // Add system prompts
        messageHistory.unshift(
            { role: 'system', content: "Adopte une attitude détendue de membre du serveur. Réponds comme si tu participais à la conversation, pas trop long, pas de retour à la ligne. Utilise les emojis du serveur quand c'est pertinent. Ton id est <@132380758368780288>, ton nom est FlopoBot." },
            { role: 'system', content: `L'utilisateur qui s'adresse à toi est <@${authorId}>. Son message est une réponse à ${message.mentions.repliedUser ? `<@${message.mentions.repliedUser.id}>` : 'personne'}.` }
        );

        const reply = await gork(messageHistory);
        await message.reply(reply);

    } catch (err) {
        console.error("Error processing AI mention:", err);
        await message.reply("Oups, mon cerveau a grillé. Réessaie plus tard.").catch(console.error);
    }
}


// --- Sub-handler for Admin Commands ---

async function handleAdminCommands(message) {
    const prefix = process.env.DEV_SITE === 'true' ? 'dev' : 'flopo';
    const [command, ...args] = message.content.split(' ');

    switch(command) {
        case '?u':
            console.log(await getAPOUsers());
            break;
        case '?b':
            console.log(await postAPOBuy('650338922874011648', args[0]));
            break;
        case '?v':
            console.log('Active Polls:', activePolls);
            break;
        case '?sv':
            const amount = parseInt(args[0], 10);
            if (isNaN(amount)) return message.reply('Invalid amount.');
            let sum = 0;
            const start_at = Date.now();
            for (let i = 0; i < amount; i++) {
                sum += parseFloat(randomSkinPrice());
            }
            console.log(`Result for ${amount} skins: Avg: ~${(sum / amount).toFixed(2)}€ | Total: ${sum.toFixed(2)}€ | Elapsed: ${Date.now() - start_at}ms`);
            break;
        case `${prefix}:sotd`:
            initTodaysSOTD();
            message.reply('New Solitaire of the Day initialized.');
            break;
        case `${prefix}:users`:
            console.log(getAllUsers.all());
            break;
        case `${prefix}:sql`:
            const sqlCommand = args.join(' ');
            try {
                const stmt = flopoDB.prepare(sqlCommand);
                const result = sqlCommand.trim().toUpperCase().startsWith('SELECT') ? stmt.all() : stmt.run();
                console.log(result);
                message.reply('```json\n' + JSON.stringify(result, null, 2).substring(0, 1900) + '\n```');
            } catch (e) {
                console.error(e);
                message.reply(`SQL Error: ${e.message}`);
            }
            break;
        case `${prefix}:fetch-data`:
            await getAkhys(client);
            break;
        case `${prefix}:avatars`:
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const members = await guild.members.fetch();
            const akhys = members.filter(m => !m.user.bot && m.roles.cache.has(process.env.AKHY_ROLE_ID));

            const usersToUpdate = akhys.map(akhy => ({
                id: akhy.user.id,
                avatarUrl: akhy.user.displayAvatarURL({ dynamic: true, size: 256 }),
            }));

            usersToUpdate.forEach(user => {
                try { updateUserAvatar.run(user) } catch (err) {}
            })
            break;
    }
}