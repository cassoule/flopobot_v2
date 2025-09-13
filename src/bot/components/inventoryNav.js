import {
    InteractionResponseType,
    MessageComponentTypes,
    ButtonStyleTypes,
    InteractionResponseFlags,
} from 'discord-interactions';

import { DiscordRequest } from '../../api/discord.js';
import { activeInventories, skins } from '../../game/state.js';

/**
 * Handles navigation button clicks (Previous/Next) for the inventory embed.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleInventoryNav(req, res, client) {
    const { member, data, guild_id } = req.body;
    const { custom_id } = data;

    // Extract direction ('prev' or 'next') and the original interaction ID from the custom_id
    const [direction, page, interactionId] = custom_id.split('_');

    // --- 1. Retrieve the interactive session ---
    const inventorySession = activeInventories[interactionId];

    // --- 2. Validation Checks ---
    if (!inventorySession) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Oups, cet affichage d'inventaire a expiré. Veuillez relancer la commande `/inventory`.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // Ensure the user clicking the button is the one who initiated the command
    if (inventorySession.userId !== member.user.id) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Vous ne pouvez pas naviguer dans l'inventaire de quelqu'un d'autre.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }


    // --- 3. Update Page Number ---
    const { amount } = inventorySession;
    if (direction === 'next') {
        inventorySession.page = (inventorySession.page + 1) % amount;
    } else if (direction === 'prev') {
        inventorySession.page = (inventorySession.page - 1 + amount) % amount;
    }


    try {
        // --- 4. Rebuild Embed with New Page Content ---
        const { page, inventorySkins } = inventorySession;
        const currentSkin = inventorySkins[page];
        const skinData = skins.find((s) => s.uuid === currentSkin.uuid);
        if (!skinData) {
            throw new Error(`Skin data not found for UUID: ${currentSkin.uuid}`);
        }

        const guild = await client.guilds.fetch(guild_id);
        const targetMember = await guild.members.fetch(inventorySession.akhyId);
        const totalPrice = inventorySkins.reduce((sum, skin) => sum + (skin.currentPrice || 0), 0);

        // --- Helper functions for formatting ---
        const getChromaText = (skin, skinInfo) => {
            let result = "";
            for (let i = 1; i <= skinInfo.chromas.length; i++) {
                result += skin.currentChroma === i ? '💠 ' : '◾ ';
            }
            return result || 'N/A';
        };

        const getChromaName = (skin, skinInfo) => {
            if (skin.currentChroma > 1) {
                const name = skinInfo.chromas[skin.currentChroma - 1]?.displayName.replace(/[\r\n]+/g, ' ').replace(skinInfo.displayName, '').trim();
                const match = name.match(/Variante\s*[0-9\s]*-\s*([^)]+)/i);
                return match ? match[1].trim() : name;
            }
            return 'Base';
        };

        const getImageUrl = (skin, skinInfo) => {
            if (skin.currentLvl === skinInfo.levels.length) {
                const chroma = skinInfo.chromas[skin.currentChroma - 1];
                return chroma?.fullRender || chroma?.displayIcon || skinInfo.displayIcon;
            }
            const level = skinInfo.levels[skin.currentLvl - 1];
            return level?.displayIcon || skinInfo.displayIcon || skinInfo.chromas[0].fullRender;
        };

        // --- 5. Rebuild Components (Buttons) ---
        let components = [
            { type: MessageComponentTypes.BUTTON, custom_id: `prev_page_${interactionId}`, label: '⏮️ Préc.', style: ButtonStyleTypes.SECONDARY },
            { type: MessageComponentTypes.BUTTON, custom_id: `next_page_${interactionId}`, label: 'Suiv. ⏭️', style: ButtonStyleTypes.SECONDARY },
        ];

        const isUpgradable = currentSkin.currentLvl < skinData.levels.length || currentSkin.currentChroma < skinData.chromas.length;
        // Conditionally add the upgrade button
        if (isUpgradable && inventorySession.akhyId === inventorySession.userId) {
            components.push({
                type: MessageComponentTypes.BUTTON,
                custom_id: `upgrade_${interactionId}`,
                label: `Upgrade ⏫ (${process.env.VALO_UPGRADE_PRICE || (currentSkin.maxPrice/10).toFixed(0)} Flopos)`,
                style: ButtonStyleTypes.PRIMARY,
            });
        }

        // --- 6. Send PATCH Request to Update the Message ---
        await DiscordRequest(inventorySession.endpoint, {
            method: 'PATCH',
            body: {
                embeds: [{
                    title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
                    color: parseInt(currentSkin.tierColor, 16) || 0xF2F3F3,
                    footer: { text: `Page ${page + 1}/${amount} | Valeur Totale : ${totalPrice.toFixed(0)} Flopos` },
                    fields: [{
                        name: `${currentSkin.displayName} | ${currentSkin.currentPrice.toFixed(0)} Flopos`,
                        value: `${currentSkin.tierText}\nChroma : ${getChromaText(currentSkin, skinData)} | ${getChromaName(currentSkin, skinData)}\nLvl : **${currentSkin.currentLvl}**/${skinData.levels.length}`,
                    }],
                    image: { url: getImageUrl(currentSkin, skinData) },
                }],
                components: [{ type: MessageComponentTypes.ACTION_ROW, components: components },
                             { type: MessageComponentTypes.ACTION_ROW,
                               components: [{
                                type: MessageComponentTypes.BUTTON,
                                url: `${process.env.FLAPI_URL}/akhy/${targetMember.id}`,
                                label: 'Voir sur FlopoSite',
                                style: ButtonStyleTypes.LINK,}]
                             }],
            },
        });

        // --- 7. Acknowledge the Interaction ---
        // This tells Discord the interaction was received, and since the message is already updated,
        // no further action is needed.
        return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });

    } catch (error) {
        console.error('Error handling inventory navigation:', error);
        // In case of an error, we should still acknowledge the interaction to prevent it from failing.
        // We can send a silent, ephemeral error message.
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Une erreur est survenue lors de la mise à jour de l\'inventaire.',
                flags: InteractionResponseFlags.EPHEMERAL,
            }
        });
    }
}