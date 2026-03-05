import {
	InteractionResponseType,
	MessageComponentTypes,
	ButtonStyleTypes,
	InteractionResponseFlags,
} from "discord-interactions";
import { activeInventories, skins } from "../../game/state.js";
import * as skinService from "../../services/skin.service.js";
import * as csSkinService from "../../services/csSkin.service.js";
import { RarityToColor } from "../../utils/cs.utils.js";

/**
 * Handles the /inventory slash command.
 * Displays a paginated, interactive embed of a user's skin inventory.
 *
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 * @param {string} interactionId - The unique ID of the interaction.
 */
export async function handleInventoryCommand(req, res, client, interactionId) {
	return res.send({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `La commande /inventory est désactivée. Tu peux consulter ton inventaire sur FlopoSite.`,
			flags: InteractionResponseFlags.EPHEMERAL,
		},
	});
	const { member, guild_id, token, data } = req.body;
	const commandUserId = member.user.id;
	const targetUserId = data.options && data.options.length > 0 ? data.options[0].value : commandUserId;

	try {
		const guild = await client.guilds.fetch(guild_id);
		const targetMember = await guild.members.fetch(targetUserId);

		// Fetch both Valorant and CS2 inventories
		const valoSkins = await skinService.getUserInventory(targetUserId);
		const csSkins = await csSkinService.getUserCsInventory(targetUserId);

		// Combine into a unified list with a type marker
		const inventorySkins = [
			...csSkins.map((s) => ({ ...s, _type: "cs" })),
			...valoSkins.map((s) => ({ ...s, _type: "valo" })),
		];

		if (inventorySkins.length === 0) {
			return res.send({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					embeds: [
						{
							title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
							description: "Cet inventaire est vide.",
							color: 0x4f545c,
						},
					],
				},
			});
		}

		activeInventories[interactionId] = {
			akhyId: targetUserId,
			userId: commandUserId,
			page: 0,
			amount: inventorySkins.length,
			endpoint: `webhooks/${process.env.APP_ID}/${token}/messages/@original`,
			timestamp: Date.now(),
			inventorySkins: inventorySkins,
		};

		const currentSkin = inventorySkins[0];
		const totalPrice = inventorySkins.reduce((sum, skin) => {
			return sum + (skin._type === "cs" ? skin.price || 0 : skin.currentPrice || 0);
		}, 0);

		const embed = buildSkinEmbed(currentSkin, targetMember, 1, inventorySkins.length, totalPrice);

		const components = [
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

		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
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
	} catch (error) {
		console.error("Error handling /inventory command:", error);
		return res.status(500).json({ error: "Failed to generate inventory." });
	}
}

/**
 * Builds an embed for a single skin (CS2 or Valorant).
 */
export function buildSkinEmbed(skin, targetMember, page, total, totalPrice) {
	if (skin._type === "cs") {
		const badges = [
			skin.isStattrak ? "StatTrak™" : null,
			skin.isSouvenir ? "Souvenir" : null,
		].filter(Boolean).join(" | ");

		return {
			title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
			color: RarityToColor[skin.rarity] || 0xf2f3f3,
			footer: {
				text: `Page ${page}/${total} | Valeur Totale : ${totalPrice} Flopos`,
			},
			fields: [
				{
					name: `${skin.displayName} | ${skin.price} Flopos`,
					value: `${skin.rarity}${badges ? ` | ${badges}` : ""}\n${skin.wearState} (float: ${skin.float?.toFixed(8)})\n${skin.weaponType || ""}`,
				},
			],
			image: skin.imageUrl ? { url: skin.imageUrl } : undefined,
		};
	}

	// Valorant skin fallback
	const skinData = skins.find((s) => s.uuid === skin.uuid);
	return {
		title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
		color: parseInt(skin.tierColor, 16) || 0xf2f3f3,
		footer: {
			text: `Page ${page}/${total} | Valeur Totale : ${totalPrice} Flopos`,
		},
		fields: [
			{
				name: `${skin.displayName} | ${(skin.currentPrice || 0).toFixed(0)} Flopos`,
				value: `${skin.tierText || "Valorant"}\nLvl : **${skin.currentLvl}**/${skinData?.levels?.length || "?"}`,
			},
		],
		image: skinData ? { url: skinData.displayIcon } : undefined,
	};
}
