import {
    InteractionType,
    InteractionResponseType,
} from 'discord-interactions';

// --- Command Handlers ---
import { handleTimeoutCommand } from '../commands/timeout.js';
import { handleInventoryCommand } from '../commands/inventory.js';
import { handleValorantCommand } from '../commands/valorant.js';
import { handleInfoCommand } from '../commands/info.js';
import { handleSkinsCommand } from '../commands/skins.js';
import { handleSearchCommand } from '../commands/search.js';
import { handleFlopoSiteCommand } from '../commands/floposite.js';

// --- Component Handlers ---
import { handlePollVote } from '../components/pollVote.js';
import { handleInventoryNav } from '../components/inventoryNav.js';
import { handleUpgradeSkin } from '../components/upgradeSkin.js';
import { handleSearchNav } from '../components/searchNav.js';

/**
 * The main handler for all incoming interactions from Discord.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleInteraction(req, res, client) {
    const { type, data, id } = req.body;

    try {
        if (type === InteractionType.PING) {
            return res.send({ type: InteractionResponseType.PONG });
        }

        if (type === InteractionType.APPLICATION_COMMAND) {
            const { name } = data;

            switch (name) {
                case 'timeout':
                    return await handleTimeoutCommand(req, res, client);
                case 'inventory':
                    return await handleInventoryCommand(req, res, client, id);
                case 'valorant':
                    return await handleValorantCommand(req, res, client);
                case 'info':
                    return await handleInfoCommand(req, res, client);
                case 'skins':
                    return await handleSkinsCommand(req, res, client);
                case 'search':
                    return await handleSearchCommand(req, res, client, id);
                case 'floposite':
                    return await handleFlopoSiteCommand(req, res);
                default:
                    console.error(`Unknown command: ${name}`);
                    return res.status(400).json({ error: 'Unknown command' });
            }
        }

        if (type === InteractionType.MESSAGE_COMPONENT) {
            const componentId = data.custom_id;

            if (componentId.startsWith('vote_')) {
                return await handlePollVote(req, res, client);
            }
            if (componentId.startsWith('prev_page') || componentId.startsWith('next_page')) {
                return await handleInventoryNav(req, res, client);
            }
            if (componentId.startsWith('upgrade_')) {
                return await handleUpgradeSkin(req, res, client);
            }
            if (componentId.startsWith('prev_search_page') || componentId.startsWith('next_search_page')) {
                return await handleSearchNav(req, res, client);
            }

            // Fallback for other potential components
            console.error(`Unknown component ID: ${componentId}`);
            return res.status(400).json({ error: 'Unknown component' });
        }

        // --- Fallback for Unknown Interaction Types ---
        console.error('Unknown interaction type:', type);
        return res.status(400).json({ error: 'Unknown interaction type' });

    } catch (error) {
        console.error('Error handling interaction:', error);
        // Send a generic error response to Discord if something goes wrong
        return res.status(500).json({ error: 'An internal error occurred' });
    }
}