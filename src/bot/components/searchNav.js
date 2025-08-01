import {
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
    ButtonStyleTypes,
} from 'discord-interactions';

import { DiscordRequest } from '../../api/discord.js';
import { activeSearchs, skins } from '../../game/state.js';

/**
 * Handles navigation button clicks (Previous/Next) for the search results embed.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleSearchNav(req, res, client) {
    const { member, data, guild_id } = req.body;
    const { custom_id } = data;

    // Extract direction and the original interaction ID from the custom_id
    const [direction, _, page, interactionId] = custom_id.split('_'); // e.g., ['next', 'search', 'page', '123...']

    // --- 1. Retrieve the interactive session ---
    const searchSession = activeSearchs[interactionId];

    // --- 2. Validation Checks ---
    if (!searchSession) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Oups, cette recherche a expiré. Veuillez relancer la commande `/search`.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // Ensure the user clicking the button is the one who initiated the command
    if (searchSession.userId !== member.user.id) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Vous ne pouvez pas naviguer dans les résultats de recherche de quelqu'un d'autre.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // --- 3. Update Page Number ---
    const { amount } = searchSession;
    if (direction === 'next') {
        searchSession.page = (searchSession.page + 1) % amount;
    } else if (direction === 'prev') {
        searchSession.page = (searchSession.page - 1 + amount) % amount;
    }

    try {
        // --- 4. Rebuild Embed with New Page Content ---
        const { page, resultSkins, searchValue } = searchSession;
        const currentSkin = resultSkins[page];
        const skinData = skins.find((s) => s.uuid === currentSkin.uuid);
        if (!skinData) {
            throw new Error(`Skin data not found for UUID: ${currentSkin.uuid}`);
        }

        // Fetch owner details if the skin is owned
        let ownerText = '';
        if (currentSkin.user_id) {
            try {
                const owner = await client.users.fetch(currentSkin.user_id);
                ownerText = `| **@${owner.globalName || owner.username}** ✅`;
            } catch (e) {
                console.warn(`Could not fetch owner for user ID: ${currentSkin.user_id}`);
                ownerText = '| Appartenant à un utilisateur inconnu';
            }
        }

        // Helper to get the best possible image for the skin
        const getImageUrl = (skinInfo) => {
            const lastChroma = skinInfo.chromas[skinInfo.chromas.length - 1];
            if (lastChroma?.fullRender) return lastChroma.fullRender;
            if (lastChroma?.displayIcon) return lastChroma.displayIcon;
            const lastLevel = skinInfo.levels[skinInfo.levels.length - 1];
            if (lastLevel?.displayIcon) return lastLevel.displayIcon;
            return skinInfo.displayIcon;
        };

        // --- 5. Send PATCH Request to Update the Message ---
        // Note: The components (buttons) do not change, so we can reuse them from the original message.
        await DiscordRequest(searchSession.endpoint, {
            method: 'PATCH',
            body: {
                embeds: [{
                    title: 'Résultats de la recherche',
                    description: `🔎 _"${searchValue}"_`,
                    color: parseInt(currentSkin.tierColor, 16) || 0xF2F3F3,
                    fields: [{
                        name: `**${currentSkin.displayName}**`,
                        value: `${currentSkin.tierText}\nValeur Max: **${currentSkin.maxPrice}€** ${ownerText}`,
                    }],
                    image: { url: getImageUrl(skinData) },
                    footer: { text: `Résultat ${page + 1}/${amount}` },
                }],
                components: req.body.message.components, // Reuse existing components
            },
        });

        // --- 6. Acknowledge the Interaction ---
        return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });

    } catch (error) {
        console.error('Error handling search navigation:', error);
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Une erreur est survenue lors de la mise à jour de la recherche.',
                flags: InteractionResponseFlags.EPHEMERAL,
            }
        });
    }
}