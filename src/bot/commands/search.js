import {
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
    ButtonStyleTypes,
} from 'discord-interactions';
import { activeSearchs, skins } from '../../game/state.js';
import { getAllSkins } from '../../database/index.js';

/**
 * Handles the /search slash command.
 * Searches for skins by name or tier and displays them in a paginated embed.
 *
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 * @param {string} interactionId - The unique ID of the interaction.
 */
export async function handleSearchCommand(req, res, client, interactionId) {
    const { member, guild_id, token, data } = req.body;
    const userId = member.user.id;
    const searchValue = data.options[0].value.toLowerCase();

    try {
        // --- 1. Fetch and Filter Data ---
        const allDbSkins = getAllSkins.all();
        const resultSkins = allDbSkins.filter((skin) =>
            skin.displayName.toLowerCase().includes(searchValue) ||
            skin.tierText.toLowerCase().includes(searchValue)
        );

        // --- 2. Handle No Results ---
        if (resultSkins.length === 0) {
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Aucun skin ne correspond à votre recherche.',
                    flags: InteractionResponseFlags.EPHEMERAL,
                },
            });
        }

        // --- 3. Store Interactive Session State ---
        activeSearchs[interactionId] = {
            userId: userId,
            page: 0,
            amount: resultSkins.length,
            resultSkins: resultSkins,
            endpoint: `webhooks/${process.env.APP_ID}/${token}/messages/@original`,
            timestamp: Date.now(),
            searchValue: searchValue,
        };

        // --- 4. Prepare Initial Embed Content ---
        const guild = await client.guilds.fetch(guild_id);
        const currentSkin = resultSkins[0];
        const skinData = skins.find((s) => s.uuid === currentSkin.uuid);
        if (!skinData) {
            throw new Error(`Skin data not found for UUID: ${currentSkin.uuid}`);
        }

        // Fetch owner details if the skin is owned
        let ownerText = '';
        if (currentSkin.user_id) {
            try {
                const owner = await guild.members.fetch(currentSkin.user_id);
                ownerText = `| **@${owner.user.globalName || owner.user.username}** ✅`;
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

            return skinInfo.displayIcon; // Fallback to base icon
        };

        // --- 5. Build Initial Components & Embed ---
        const components = [
            {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                    { type: MessageComponentTypes.BUTTON, custom_id: `prev_search_page_${interactionId}`, label: '⏮️ Préc.', style: ButtonStyleTypes.SECONDARY },
                    { type: MessageComponentTypes.BUTTON, custom_id: `next_search_page_${interactionId}`, label: 'Suiv. ⏭️', style: ButtonStyleTypes.SECONDARY },
                ],
            },
        ];

        const embed = {
            title: 'Résultats de la recherche',
            description: `🔎 _"${searchValue}"_`,
            color: parseInt(currentSkin.tierColor, 16) || 0xF2F3F3,
            fields: [{
                name: `**${currentSkin.displayName}**`,
                value: `${currentSkin.tierText}\nValeur Max: **${currentSkin.maxPrice} Flopos** ${ownerText}`,
            }],
            image: { url: getImageUrl(skinData) },
            footer: { text: `Résultat 1/${resultSkins.length}` },
        };

        // --- 6. Send Final Response ---
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [embed],
                components: components,
            },
        });

    } catch (error) {
        console.error('Error handling /search command:', error);
        return res.status(500).json({ error: 'Failed to execute search.' });
    }
}