import 'dotenv/config';
import cron from 'node-cron';
import { adjectives, animals, uniqueNamesGenerator } from 'unique-names-generator';

// --- Local Imports ---
import { getValorantSkins, getSkinTiers } from '../api/valorant.js';
import { DiscordRequest } from '../api/discord.js';
import { initTodaysSOTD } from '../game/points.js';
import {
    insertManyUsers, insertManySkins, resetDailyReward,
    pruneOldLogs, getAllUsers as dbGetAllUsers, getSOTD, getUser, getAllUsers, insertUser, stmtUsers,
} from '../database/index.js';
import { activeInventories, activeSearchs, activePredis, pokerRooms, skins } from '../game/state.js';

export async function InstallGlobalCommands(appId, commands) {
    // API endpoint to overwrite global commands
    const endpoint = `applications/${appId}/commands`;

    try {
        // This is calling the bulk overwrite endpoint: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
        await DiscordRequest(endpoint, { method: 'PUT', body: commands });
    } catch (err) {
        console.error(err);
    }
}

// --- Data Fetching & Initialization ---

/**
 * Fetches all members with the 'Akhy' role and all Valorant skins,
 * then syncs them with the database.
 * @param {object} client - The Discord.js client instance.
 */
export async function getAkhys(client) {
    try {
        // 1. Fetch Discord Members
        const initial_akhys = getAllUsers.all().length;
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const members = await guild.members.fetch();
        const akhys = members.filter(m => !m.user.bot && m.roles.cache.has(process.env.AKHY_ROLE_ID));


        const usersToInsert = akhys.map(akhy => ({
            id: akhy.user.id,
            username: akhy.user.username,
            globalName: akhy.user.globalName,
            warned: 0,
            warns: 0,
            allTimeWarns: 0,
            totalRequests: 0,
            avatarUrl: akhy.user.displayAvatarURL({ dynamic: true, size: 256 }),
        }));

        if (usersToInsert.length > 0) {
            usersToInsert.forEach(user => {
                try { insertUser.run(user) } catch (err) {}
            })
        }

        const new_akhys = getAllUsers.all().length;
        const diff = new_akhys - initial_akhys
        
        console.log(`[Sync] Found and synced ${usersToInsert.length} ${diff !== 0 ? '(' + (diff > 0 ? '+' + diff : diff) + ') ' : ''}users with the 'Akhy' role. (ID:${process.env.AKHY_ROLE_ID})`);

        // 2. Fetch Valorant Skins
        const [fetchedSkins, fetchedTiers] = await Promise.all([getValorantSkins(), getSkinTiers()]);

        // Clear and rebuild the in-memory skin cache
        skins.length = 0;
        fetchedSkins.forEach(skin => skins.push(skin));

        const skinsToInsert = fetchedSkins
            .filter(skin => skin.contentTierUuid)
            .map(skin => {
                const tier = fetchedTiers.find(t => t.uuid === skin.contentTierUuid) || {};
                const basePrice = calculateBasePrice(skin, tier.rank);
                return {
                    uuid: skin.uuid,
                    displayName: skin.displayName,
                    contentTierUuid: skin.contentTierUuid,
                    displayIcon: skin.displayIcon,
                    user_id: null,
                    tierRank: tier.rank,
                    tierColor: tier.highlightColor?.slice(0, 6) || 'F2F3F3',
                    tierText: formatTierText(tier.rank, skin.displayName),
                    basePrice: basePrice.toFixed(2),
                    maxPrice: calculateMaxPrice(basePrice, skin).toFixed(2),
                };
            });

        if (skinsToInsert.length > 0) {
            insertManySkins(skinsToInsert);
        }
        console.log(`[Sync] Fetched and synced ${skinsToInsert.length} Valorant skins.`);

    } catch (err) {
        console.error('Error during initial data sync (getAkhys):', err);
    }
}


// --- Cron Jobs / Scheduled Tasks ---

/**
 * Sets up all recurring tasks for the application.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 */
export function setupCronJobs(client, io) {
    // Every 10 minutes: Clean up expired interactive sessions
    cron.schedule('*/10 * * * *', () => {
        const now = Date.now();
        const FIVE_MINUTES = 5 * 60 * 1000;
        const ONE_DAY = 24 * 60 * 60 * 1000;

        const cleanup = (sessions, name) => {
            let cleanedCount = 0;
            for (const id in sessions) {
                if (now >= (sessions[id].timestamp || 0) + FIVE_MINUTES) {
                    delete sessions[id];
                    cleanedCount++;
                }
            }
            if (cleanedCount > 0) console.log(`[Cron] Cleaned up ${cleanedCount} expired ${name} sessions.`);
        };

        cleanup(activeInventories, 'inventory');
        cleanup(activeSearchs, 'search');

        // Cleanup for predis and poker rooms...
        // ...
    });

    // Daily at midnight: Reset daily rewards and init SOTD
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Running daily midnight tasks...');
        try {
            resetDailyReward.run();
            console.log('[Cron] Daily rewards have been reset for all users.');
            //if (!getSOTD.get()) {
            initTodaysSOTD();
            //}
        } catch (e) {
            console.error('[Cron] Error during daily reset:', e);
        }
    });

    // Daily at 7 AM: Re-sync users and skins
    cron.schedule('0 7 * * *', async () => {
        console.log('[Cron] Running daily 7 AM data sync...');
        await getAkhys(client);
    });
}


// --- Formatting Helpers ---

export function capitalize(str) {
    if (typeof str !== 'string' || str.length === 0) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatTime(seconds) {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`**${d}** jour${d > 1 ? 's' : ''}`);
    if (h > 0) parts.push(`**${h}** heure${h > 1 ? 's' : ''}`);
    if (m > 0) parts.push(`**${m}** minute${m > 1 ? 's' : ''}`);
    if (s > 0 || parts.length === 0) parts.push(`**${s}** seconde${s > 1 ? 's' : ''}`);

    return parts.join(', ').replace(/,([^,]*)$/, ' et$1');
}

// --- External API Helpers ---

/**
 * Fetches user data from the "APO" service.
 */
export async function getAPOUsers() {
    const fetchUrl = `${process.env.APO_BASE_URL}/users?serverId=${process.env.GUILD_ID}`;
    try {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching APO users:', error);
        return null;
    }
}

/**
 * Sends a "buy" request to the "APO" service.
 * @param {string} userId - The Discord user ID.
 * @param {number} amount - The amount to "buy".
 */
export async function postAPOBuy(userId, amount) {
    const fetchUrl = `${process.env.APO_BASE_URL}/buy?serverId=${process.env.GUILD_ID}&userId=${userId}&amount=${amount}`;
    return fetch(fetchUrl, { method: 'POST' });
}


// --- Miscellaneous Helpers ---

export async function getOnlineUsersWithRole(guild, roleId) {
    if (!guild || !roleId) return new Map();
    try {
        const members = await guild.members.fetch();
        return members.filter(m => !m.user.bot && m.presence?.status !== 'offline' && m.roles.cache.has(roleId));
    } catch (err) {
        console.error('Error fetching online members with role:', err);
        return new Map();
    }
}

export function getRandomEmoji(list = 0) {
    const emojiLists = [
        ['😭','😄','😌','🤓','😎','😤','🤖','😶‍🌫️','🌏','📸','💿','👋','🌊','✨'],
        ['<:CAUGHT:1323810730155446322>', '<:hinhinhin:1072510144933531758>', '<:o7:1290773422451986533>', '<:zhok:1115221772623683686>', '<:nice:1154049521110765759>', '<:nerd:1087658195603951666>', '<:peepSelfie:1072508131839594597>'],
    ];
    const selectedList = emojiLists[list] || [''];
    return selectedList[Math.floor(Math.random() * selectedList.length)];
}

export function formatAmount(amount) {
    if (amount >= 1000000000) {
        amount /= 1000000000
        return (
            amount
                .toFixed(2)
                .toString()
                .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + 'Md'
        )
    }
    if (amount >= 1000000) {
        amount /= 1000000
        return (
            amount
                .toFixed(2)
                .toString()
                .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + 'M'
        )
    }
    if (amount >= 10000) {
        amount /= 1000
        return (
            amount
                .toFixed(2)
                .toString()
                .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + 'K'
        )
    }
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}


// --- Private Helpers ---

function calculateBasePrice(skin, tierRank) {
    const name = skin.displayName.toLowerCase();
    let price = 6000; // Default for melee
    if (name.includes('classic')) price = 150;
    else if (name.includes('shorty')) price = 300;
    else if (name.includes('frenzy')) price = 450;
    else if (name.includes('ghost')) price = 500;
    // ... add all other weapon prices ...
    else if (name.includes('vandal') || name.includes('phantom')) price = 2900;

    price *= (1 + (tierRank || 0));
    if (name.includes('vct')) price *= 1.25;
    if (name.includes('champions')) price *= 2;

    return price / 1111;
}

function calculateMaxPrice(basePrice, skin) {
    let res = basePrice;
    res *= (1 + (skin.levels.length / Math.max(skin.levels.length, 2)));
    res *= (1 + (skin.chromas.length / 4));
    return res;
}

function formatTierText(rank, displayName) {
    const tiers = {
        0: '**<:select:1362964319498670222> Select**',
        1: '**<:deluxe:1362964308094488797> Deluxe**',
        2: '**<:premium:1362964330349330703> Premium**',
        3: '**<:exclusive:1362964427556651098> Exclusive**',
        4: '**<:ultra:1362964339685986314> Ultra**',
    };
    let res = tiers[rank] || 'Pas de tier';
    if (displayName.includes('VCT')) res += ' | Esports';
    if (displayName.toLowerCase().includes('champions')) res += ' | Champions';
    return res;
}