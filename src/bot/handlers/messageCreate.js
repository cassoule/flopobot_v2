import { sleep } from 'openai/core';
import {
    buildAiMessages,
    buildParticipantsMap,
    buildTranscript,
    CONTEXT_LIMIT,
    gork, INCLUDE_ATTACHMENT_URLS, MAX_ATTS_PER_MESSAGE,
    stripMentionsOfBot
} from '../../utils/ai.js';
import {
    formatTime,
    postAPOBuy,
    getAPOUsers,
    getAkhys,
    calculateBasePrice,
    calculateMaxPrice
} from '../../utils/index.js';
import { channelPointsHandler, slowmodesHandler, randomSkinPrice, initTodaysSOTD } from '../../game/points.js';
import {requestTimestamps, activeSlowmodes, activePolls, skins, activeSolitaireGames} from '../../game/state.js';
import {
    flopoDB,
    getUser,
    getAllUsers,
    updateManyUsers,
    insertUser,
    updateUserAvatar,
    getAllSkins, hardUpdateSkin
} from '../../database/index.js';
import {client} from "../client.js";
import {autoSolveMoves} from "../../game/solitaire.js";

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
        await message.channel.sendTyping();

        // 1) Récup contexte
        const fetched = await message.channel.messages.fetch({ limit: Math.min(CONTEXT_LIMIT, 100) });
        const messagesArray = Array.from(fetched.values()).reverse(); // oldest -> newest

        const requestText = stripMentionsOfBot(message.content, client.user.id);
        const invokerId = message.author.id;
        const invokerName = message.member?.nickname || message.author.globalName || message.author.username;
        const repliedUserId = message.mentions?.repliedUser?.id || null;

        // 2) Compact transcript & participants
        const participants = buildParticipantsMap(messagesArray);
        const transcript = buildTranscript(messagesArray, client.user.id);

        const invokerAttachments = Array.from(message.attachments?.values?.() || []).slice(0, MAX_ATTS_PER_MESSAGE).map(a => ({
            id: a.id,
            name: a.name,
            type: a.contentType || 'application/octet-stream',
            size: a.size,
            isImage: !!(a.contentType && a.contentType.startsWith('image/')),
            url: INCLUDE_ATTACHMENT_URLS ? a.url : undefined,
        }));

        // 3) Construire prompts
        const messageHistory = buildAiMessages({
            botId: client.user.id,
            botName: 'FlopoBot',
            invokerId,
            invokerName,
            requestText,
            transcript,
            participants,
            repliedUserId,
            invokerAttachments,
        });

        // 4) Appel modèle
        const reply = await gork(messageHistory);

        // 5) Réponse
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
            console.log(`Result for ${amount} skins: Avg: ~${(sum / amount).toFixed(0)} Flopos | Total: ${sum.toFixed(0)} Flopos | Elapsed: ${Date.now() - start_at}ms`);
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
        case `${prefix}:rework-skins`:
            console.log("Reworking all skin prices...");
            const dbSkins = getAllSkins.all();
            dbSkins.forEach(skin => {
                const fetchedSkin = skins.find(s => s.uuid === skin.uuid);
                const basePrice = calculateBasePrice(fetchedSkin, skin.tierRank)?.toFixed(0);
                const calculatePrice = () => {
                    if (!skin.basePrice) return null;
                    let result = parseFloat(basePrice);
                    result *= (1 + (skin.currentLvl / Math.max(fetchedSkin.levels.length, 2)));
                    result *= (1 + (skin.currentChroma / 4));
                    return parseFloat(result.toFixed(0));
                };
                const maxPrice = calculateMaxPrice(basePrice, fetchedSkin).toFixed(0);
                hardUpdateSkin.run({
                    uuid: skin.uuid,
                    displayName: skin.displayName,
                    contentTierUuid: skin.contentTierUuid,
                    displayIcon: skin.displayIcon,
                    user_id: skin.user_id,
                    tierRank: skin.tierRank,
                    tierColor: skin.tierColor,
                    tierText: skin.tierText,
                    basePrice: basePrice,
                    currentLvl: skin.currentLvl || null,
                    currentChroma: skin.currentChroma || null,
                    currentPrice: skin.currentPrice ? calculatePrice() : null,
                    maxPrice: maxPrice,
                })
            })
            console.log('Reworked', dbSkins.length, 'skins.');
            break;
        case `${prefix}:solve-solitaire`:
            autoSolveMoves(
                { "tableauPiles": [ [ { "suit": "d", "rank": "K", "faceUp": true }, { "suit": "s", "rank": "Q", "faceUp": true }, { "suit": "d", "rank": "J", "faceUp": true }, { "suit": "c", "rank": "T", "faceUp": true }, { "suit": "h", "rank": "9", "faceUp": true }, { "suit": "c", "rank": "8", "faceUp": true }, { "suit": "h", "rank": "7", "faceUp": true }, { "suit": "c", "rank": "6", "faceUp": true }, { "suit": "h", "rank": "5", "faceUp": true } ], [ { "suit": "h", "rank": "K", "faceUp": true }, { "suit": "c", "rank": "Q", "faceUp": true }, { "suit": "h", "rank": "J", "faceUp": true }, { "suit": "s", "rank": "T", "faceUp": true }, { "suit": "d", "rank": "9", "faceUp": true } ], [ { "suit": "s", "rank": "K", "faceUp": true }, { "suit": "d", "rank": "Q", "faceUp": true }, { "suit": "c", "rank": "J", "faceUp": true }, { "suit": "h", "rank": "T", "faceUp": true }, { "suit": "c", "rank": "9", "faceUp": true }, { "suit": "h", "rank": "8", "faceUp": true } ], [], [], [ { "suit": "c", "rank": "K", "faceUp": true }, { "suit": "h", "rank": "Q", "faceUp": true }, { "suit": "s", "rank": "J", "faceUp": true }, { "suit": "d", "rank": "T", "faceUp": true }, { "suit": "s", "rank": "9", "faceUp": true }, { "suit": "d", "rank": "8", "faceUp": true }, { "suit": "c", "rank": "7", "faceUp": true }, { "suit": "h", "rank": "6", "faceUp": true }, { "suit": "c", "rank": "5", "faceUp": true }, { "suit": "h", "rank": "4", "faceUp": true } ], [ { "suit": "h", "rank": "3", "faceUp": true } ] ], "foundationPiles": [ [ { "suit": "c", "rank": "A", "faceUp": true }, { "suit": "c", "rank": "2", "faceUp": true }, { "suit": "c", "rank": "3", "faceUp": true }, { "suit": "c", "rank": "4", "faceUp": true } ], [ { "suit": "h", "rank": "A", "faceUp": true }, { "suit": "h", "rank": "2", "faceUp": true } ], [ { "suit": "s", "rank": "A", "faceUp": true }, { "suit": "s", "rank": "2", "faceUp": true }, { "suit": "s", "rank": "3", "faceUp": true }, { "suit": "s", "rank": "4", "faceUp": true }, { "suit": "s", "rank": "5", "faceUp": true }, { "suit": "s", "rank": "6", "faceUp": true }, { "suit": "s", "rank": "7", "faceUp": true }, { "suit": "s", "rank": "8", "faceUp": true } ], [ { "suit": "d", "rank": "A", "faceUp": true }, { "suit": "d", "rank": "2", "faceUp": true }, { "suit": "d", "rank": "3", "faceUp": true }, { "suit": "d", "rank": "4", "faceUp": true }, { "suit": "d", "rank": "5", "faceUp": true }, { "suit": "d", "rank": "6", "faceUp": true }, { "suit": "d", "rank": "7", "faceUp": true } ] ], "stockPile": [], "wastePile": [], "seed": "mgqnxweyjp8fggj6ol9", "isSOTD": false, "score": 205, "moves": 90, "hist": [ { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 3, "sourceCardIndex": 3, "destPileType": "tableauPiles", "destPileIndex": 4, "cardsMoved": [ { "suit": "c", "rank": "9", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 6, "sourceCardIndex": 6, "destPileType": "foundationPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "A", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 5, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "c", "rank": "5", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 4, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "h", "rank": "4", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 6, "sourceCardIndex": 5, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "h", "rank": "9", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 6, "sourceCardIndex": 4, "destPileType": "foundationPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "h", "rank": "A", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 6, "sourceCardIndex": 3, "destPileType": "tableauPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "d", "rank": "8", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 6, "sourceCardIndex": 2, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "8", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "h", "rank": "2", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "foundationPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "h", "rank": "2", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "h", "rank": "Q", "faceUp": true } }, { "move": "draw", "card": { "suit": "h", "rank": "5", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "h", "rank": "5", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "d", "rank": "K", "faceUp": true } }, { "move": "draw", "card": { "suit": "c", "rank": "J", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 2, "destPileType": "tableauPiles", "destPileIndex": 6, "cardsMoved": [ { "suit": "c", "rank": "J", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 4, "sourceCardIndex": 4, "destPileType": "tableauPiles", "destPileIndex": 6, "cardsMoved": [ { "suit": "h", "rank": "T", "faceUp": true }, { "suit": "c", "rank": "9", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "d", "rank": "4", "faceUp": true } }, { "move": "draw", "card": { "suit": "h", "rank": "K", "faceUp": true } }, { "move": "draw", "card": { "suit": "s", "rank": "3", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 4, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "s", "rank": "3", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "K", "faceUp": true } }, { "move": "draw", "card": { "suit": "h", "rank": "7", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 5, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "h", "rank": "7", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 3, "sourceCardIndex": 2, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "6", "faceUp": true }, { "suit": "h", "rank": "5", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "h", "rank": "8", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 5, "destPileType": "tableauPiles", "destPileIndex": 6, "cardsMoved": [ { "suit": "h", "rank": "8", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "Q", "faceUp": true } }, { "move": "draw", "card": { "suit": "s", "rank": "A", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 6, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "A", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "d", "rank": "J", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 6, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "d", "rank": "J", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 0, "sourceCardIndex": 0, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "c", "rank": "T", "faceUp": true }, { "suit": "h", "rank": "9", "faceUp": true }, { "suit": "c", "rank": "8", "faceUp": true }, { "suit": "h", "rank": "7", "faceUp": true }, { "suit": "c", "rank": "6", "faceUp": true }, { "suit": "h", "rank": "5", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "4", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 6, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "c", "rank": "4", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "s", "rank": "5", "faceUp": true } }, { "move": "draw", "card": { "suit": "h", "rank": "J", "faceUp": true } }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 4, "sourceCardIndex": 3, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "d", "rank": "3", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "2", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 8, "destPileType": "foundationPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "2", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "c", "rank": "7", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 8, "destPileType": "tableauPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "c", "rank": "7", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 1, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "h", "rank": "6", "faceUp": true }, { "suit": "c", "rank": "5", "faceUp": true }, { "suit": "h", "rank": "4", "faceUp": true }, { "suit": "s", "rank": "3", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "d", "rank": "5", "faceUp": true } }, { "move": "draw", "card": { "suit": "d", "rank": "A", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 9, "destPileType": "foundationPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "A", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "c", "rank": "3", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 9, "destPileType": "foundationPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "3", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "d", "rank": "7", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 9, "destPileType": "tableauPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "7", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "d", "rank": "6", "faceUp": true } }, { "move": "draw-reset" }, { "move": "draw", "card": { "suit": "h", "rank": "Q", "faceUp": true } }, { "move": "draw", "card": { "suit": "d", "rank": "K", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "d", "rank": "K", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 3, "destPileType": "tableauPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "s", "rank": "Q", "faceUp": true }, { "suit": "d", "rank": "J", "faceUp": true }, { "suit": "c", "rank": "T", "faceUp": true }, { "suit": "h", "rank": "9", "faceUp": true }, { "suit": "c", "rank": "8", "faceUp": true }, { "suit": "h", "rank": "7", "faceUp": true }, { "suit": "c", "rank": "6", "faceUp": true }, { "suit": "h", "rank": "5", "faceUp": true }, { "suit": "c", "rank": "4", "faceUp": true }, { "suit": "d", "rank": "3", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 2, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "2", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 2, "sourceCardIndex": 8, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "3", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 1, "sourceCardIndex": 0, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "4", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 1, "destPileType": "foundationPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "2", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 0, "sourceCardIndex": 10, "destPileType": "foundationPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "3", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 0, "sourceCardIndex": 9, "destPileType": "foundationPiles", "destPileIndex": 0, "cardsMoved": [ { "suit": "c", "rank": "4", "faceUp": true } ], "cardWasFlipped": true, "points": 11 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 5, "sourceCardIndex": 0, "destPileType": "tableauPiles", "destPileIndex": 6, "cardsMoved": [ { "suit": "s", "rank": "7", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "d", "rank": "4", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 1, "destPileType": "foundationPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "4", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "h", "rank": "K", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "h", "rank": "K", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "K", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "c", "rank": "K", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "h", "rank": "Q", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 4, "sourceCardIndex": 2, "destPileType": "tableauPiles", "destPileIndex": 5, "cardsMoved": [ { "suit": "s", "rank": "J", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "draw", "card": { "suit": "c", "rank": "Q", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "c", "rank": "Q", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "draw", "card": { "suit": "s", "rank": "5", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "5", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "h", "rank": "J", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "h", "rank": "J", "faceUp": true } ], "cardWasFlipped": false, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 4, "sourceCardIndex": 1, "destPileType": "tableauPiles", "destPileIndex": 1, "cardsMoved": [ { "suit": "s", "rank": "T", "faceUp": true } ], "cardWasFlipped": true, "points": 1 }, { "move": "move", "sourcePileType": "tableauPiles", "sourcePileIndex": 4, "sourceCardIndex": 0, "destPileType": "foundationPiles", "destPileIndex": 2, "cardsMoved": [ { "suit": "s", "rank": "6", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "d", "rank": "5", "faceUp": true } }, { "move": "move", "sourcePileType": "wastePile", "sourcePileIndex": null, "sourceCardIndex": 0, "destPileType": "foundationPiles", "destPileIndex": 3, "cardsMoved": [ { "suit": "d", "rank": "5", "faceUp": true } ], "cardWasFlipped": false, "points": 11 }, { "move": "draw", "card": { "suit": "d", "rank": "6", "faceUp": true } } ], "hardMode": false, "autocompleting": false }
            );
    }
}