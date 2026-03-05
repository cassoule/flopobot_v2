import {
	InteractionResponseType,
	MessageComponentTypes,
	ButtonStyleTypes,
	InteractionResponseFlags,
} from "discord-interactions";

import { DiscordRequest } from "../../api/discord.js";
import { activeInventories } from "../../game/state.js";
import { buildSkinEmbed } from "../commands/inventory.js";

/**
 * Handles navigation button clicks (Previous/Next) for the inventory embed.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleInventoryNav(req, res, client) {
	const { member, data, guild_id } = req.body;
	const { custom_id } = data;

	const [direction, page, interactionId] = custom_id.split("_");

	const inventorySession = activeInventories[interactionId];

	if (!inventorySession) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Oups, cet affichage d'inventaire a expiré. Veuillez relancer la commande `/inventory`.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	if (inventorySession.userId !== member.user.id) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Vous ne pouvez pas naviguer dans l'inventaire de quelqu'un d'autre.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const { amount } = inventorySession;
	if (direction === "next") {
		inventorySession.page = (inventorySession.page + 1) % amount;
	} else if (direction === "prev") {
		inventorySession.page = (inventorySession.page - 1 + amount) % amount;
	}

	try {
		const { inventorySkins } = inventorySession;
		const currentPage = inventorySession.page;
		const currentSkin = inventorySkins[currentPage];

		const guild = await client.guilds.fetch(guild_id);
		const targetMember = await guild.members.fetch(inventorySession.akhyId);
		const totalPrice = inventorySkins.reduce((sum, skin) => {
			return sum + (skin._type === "cs" ? skin.price || 0 : skin.currentPrice || 0);
		}, 0);

		const embed = buildSkinEmbed(currentSkin, targetMember, currentPage + 1, amount, totalPrice);

		let components = [
			{
				type: MessageComponentTypes.BUTTON,
				custom_id: `prev_page_${interactionId}`,
				label: "⏮️ Préc.",
				style: ButtonStyleTypes.SECONDARY,
			},
			{
				type: MessageComponentTypes.BUTTON,
				custom_id: `next_page_${interactionId}`,
				label: "Suiv. ⏭️",
				style: ButtonStyleTypes.SECONDARY,
			},
		];

		await DiscordRequest(inventorySession.endpoint, {
			method: "PATCH",
			body: {
				embeds: [embed],
				components: [
					{ type: MessageComponentTypes.ACTION_ROW, components: components },
					{
						type: MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: MessageComponentTypes.BUTTON,
								url: `${process.env.FLAPI_URL}/akhy/${targetMember.id}`,
								label: "Voir sur FlopoSite",
								style: ButtonStyleTypes.LINK,
							},
						],
					},
				],
			},
		});

		return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
	} catch (error) {
		console.error("Error handling inventory navigation:", error);
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Une erreur est survenue lors de la mise à jour de l'inventaire.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}
}
