import {
	InteractionResponseType,
	MessageComponentTypes,
	ButtonStyleTypes,
	InteractionResponseFlags,
} from "discord-interactions";
import { activeInventories, skins } from "../../game/state.js";
import { getUserInventory } from "../../database/index.js";

/**
 * Handles the /inventory slash command.
 * Displays a paginated, interactive embed of a user's Valorant skin inventory.
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
	// User can specify another member, otherwise it defaults to themself
	const targetUserId = data.options && data.options.length > 0 ? data.options[0].value : commandUserId;

	try {
		// --- 1. Fetch Data ---
		const guild = await client.guilds.fetch(guild_id);
		const targetMember = await guild.members.fetch(targetUserId);
		const inventorySkins = getUserInventory.all({ user_id: targetUserId });

		// --- 2. Handle Empty Inventory ---
		if (inventorySkins.length === 0) {
			return res.send({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					embeds: [
						{
							title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
							description: "Cet inventaire est vide.",
							color: 0x4f545c, // Discord Gray
						},
					],
				},
			});
		}

		// --- 3. Store Interactive Session State ---
		// This state is crucial for the component handlers to know which inventory to update.
		activeInventories[interactionId] = {
			akhyId: targetUserId, // The inventory owner
			userId: commandUserId, // The user who ran the command
			page: 0,
			amount: inventorySkins.length,
			endpoint: `webhooks/${process.env.APP_ID}/${token}/messages/@original`,
			timestamp: Date.now(),
			inventorySkins: inventorySkins, // Cache the skins to avoid re-querying the DB on each page turn
		};

		// --- 4. Prepare Embed Content ---
		const currentSkin = inventorySkins[0];
		const skinData = skins.find((s) => s.uuid === currentSkin.uuid);
		if (!skinData) {
			throw new Error(`Skin data not found for UUID: ${currentSkin.uuid}`);
		}
		const totalPrice = inventorySkins.reduce((sum, skin) => sum + (skin.currentPrice || 0), 0);

		// --- Helper functions for formatting ---
		const getChromaText = (skin, skinInfo) => {
			let result = "";
			for (let i = 1; i <= skinInfo.chromas.length; i++) {
				result += skin.currentChroma === i ? "💠 " : "◾ ";
			}
			return result || "N/A";
		};

		const getChromaName = (skin, skinInfo) => {
			if (skin.currentChroma > 1) {
				const name = skinInfo.chromas[skin.currentChroma - 1]?.displayName
					.replace(/[\r\n]+/g, " ")
					.replace(skinInfo.displayName, "")
					.trim();
				const match = name.match(/Variante\s*[0-9\s]*-\s*([^)]+)/i);
				return match ? match[1].trim() : name;
			}
			return "Base";
		};

		const getImageUrl = (skin, skinInfo) => {
			if (skin.currentLvl === skinInfo.levels.length) {
				const chroma = skinInfo.chromas[skin.currentChroma - 1];
				return chroma?.fullRender || chroma?.displayIcon || skinInfo.displayIcon;
			}
			const level = skinInfo.levels[skin.currentLvl - 1];
			return level?.displayIcon || skinInfo.displayIcon || skinInfo.chromas[0].fullRender;
		};

		// --- 5. Build Initial Components (Buttons) ---
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

		const isUpgradable =
			currentSkin.currentLvl < skinData.levels.length || currentSkin.currentChroma < skinData.chromas.length;
		// Only show upgrade button if the skin is upgradable AND the command user owns the inventory
		if (isUpgradable && targetUserId === commandUserId) {
			components.push({
				type: MessageComponentTypes.BUTTON,
				custom_id: `upgrade_${interactionId}`,
				label: `Upgrade ⏫ (${process.env.VALO_UPGRADE_PRICE || (currentSkin.maxPrice / 10).toFixed(0)} Flopos)`,
				style: ButtonStyleTypes.PRIMARY,
			});
		}

		// --- 6. Send Final Response ---
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				embeds: [
					{
						title: `Inventaire de ${targetMember.user.globalName || targetMember.user.username}`,
						color: parseInt(currentSkin.tierColor, 16) || 0xf2f3f3,
						footer: {
							text: `Page 1/${inventorySkins.length} | Valeur Totale : ${totalPrice.toFixed(0)} Flopos`,
						},
						fields: [
							{
								name: `${currentSkin.displayName} | ${currentSkin.currentPrice.toFixed(0)} Flopos`,
								value: `${currentSkin.tierText}\nChroma : ${getChromaText(currentSkin, skinData)} | ${getChromaName(currentSkin, skinData)}\nLvl : **${currentSkin.currentLvl}**/${skinData.levels.length}`,
							},
						],
						image: { url: getImageUrl(currentSkin, skinData) },
					},
				],
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
