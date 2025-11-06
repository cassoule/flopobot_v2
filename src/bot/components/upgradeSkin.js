import {
	InteractionResponseType,
	InteractionResponseFlags,
	MessageComponentTypes,
	ButtonStyleTypes,
} from "discord-interactions";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { DiscordRequest } from "../../api/discord.js";
import { postAPOBuy } from "../../utils/index.js";
import { activeInventories, skins } from "../../game/state.js";
import { getSkin, getUser, insertLog, updateSkin, updateUserCoins } from "../../database/index.js";

/**
 * Handles the click of the 'Upgrade' button on a skin in the inventory.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
export async function handleUpgradeSkin(req, res) {
	const { member, data } = req.body;
	const { custom_id } = data;

	const interactionId = custom_id.replace("upgrade_", "");
	const userId = member.user.id;

	// --- 1. Retrieve Session and Validate ---
	const inventorySession = activeInventories[interactionId];
	if (!inventorySession) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Cet affichage d'inventaire a expiré.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	// Ensure the user clicking is the inventory owner
	if (inventorySession.akhyId !== userId || inventorySession.userId !== userId) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Vous ne pouvez pas améliorer un skin qui ne vous appartient pas.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const skinToUpgrade = inventorySession.inventorySkins[inventorySession.page];
	const skinData = skins.find((s) => s.uuid === skinToUpgrade.uuid);

	if (
		!skinData ||
		(skinToUpgrade.currentLvl >= skinData.levels.length && skinToUpgrade.currentChroma >= skinData.chromas.length)
	) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Ce skin est déjà au niveau maximum et ne peut pas être amélioré.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	// --- 2. Handle Payment ---
	const upgradePrice = parseFloat(process.env.VALO_UPGRADE_PRICE) || parseFloat(skinToUpgrade.maxPrice) / 10;

	const commandUser = getUser.get(userId);

	if (!commandUser) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Erreur lors de la récupération de votre profil utilisateur.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}
	if (commandUser.coins < upgradePrice) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: `Pas assez de FlopoCoins (${upgradePrice.toFixed(0)} requis).`,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	insertLog.run({
		id: `${userId}-${Date.now()}`,
		user_id: userId,
		action: "VALO_SKIN_UPGRADE",
		target_user_id: null,
		coins_amount: -upgradePrice.toFixed(0),
		user_new_amount: commandUser.coins - upgradePrice.toFixed(0),
	});
	updateUserCoins.run({
		id: userId,
		coins: commandUser.coins - upgradePrice.toFixed(0),
	});

	// --- 3. Show Loading Animation ---
	// Acknowledge the click immediately and then edit the message to show a loading state.
	await res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });

	await DiscordRequest(inventorySession.endpoint, {
		method: "PATCH",
		body: {
			embeds: [
				{
					title: "Amélioration en cours...",
					image: {
						url: "https://media.tenor.com/HD8nVN2QP9MAAAAC/thoughts-think.gif",
					},
					color: 0x4f545c,
				},
			],
			components: [],
		},
	});

	// --- 4. Perform Upgrade Logic ---
	let succeeded = false;
	const isLevelUpgrade = skinToUpgrade.currentLvl < skinData.levels.length;

	if (isLevelUpgrade) {
		// Upgrading Level
		const successProb =
			1 - (skinToUpgrade.currentLvl / skinData.levels.length) * (parseInt(skinToUpgrade.tierRank) / 5 + 0.5);
		if (Math.random() < successProb) {
			succeeded = true;
			skinToUpgrade.currentLvl++;
		}
	} else {
		// Upgrading Chroma
		const successProb =
			1 - (skinToUpgrade.currentChroma / skinData.chromas.length) * (parseInt(skinToUpgrade.tierRank) / 5 + 0.5);
		if (Math.random() < successProb) {
			succeeded = true;
			skinToUpgrade.currentChroma++;
		}
	}

	// --- 5. Update Database if Successful ---
	if (succeeded) {
		const calculatePrice = () => {
			let result = parseFloat(skinToUpgrade.basePrice);
			result *= 1 + skinToUpgrade.currentLvl / Math.max(skinData.levels.length, 2);
			result *= 1 + skinToUpgrade.currentChroma / 4;
			return parseFloat(result.toFixed(0));
		};
		skinToUpgrade.currentPrice = calculatePrice();

		await updateSkin.run({
			uuid: skinToUpgrade.uuid,
			user_id: skinToUpgrade.user_id,
			currentLvl: skinToUpgrade.currentLvl,
			currentChroma: skinToUpgrade.currentChroma,
			currentPrice: skinToUpgrade.currentPrice,
		});
		// Update the session cache
		inventorySession.inventorySkins[inventorySession.page] = skinToUpgrade;
	}

	// --- 6. Send Final Result ---
	setTimeout(async () => {
		// Fetch the latest state of the skin from the database
		const finalSkinState = getSkin.get(skinToUpgrade.uuid);
		const finalEmbed = buildFinalEmbed(succeeded, finalSkinState, skinData);
		const finalComponents = buildFinalComponents(succeeded, skinData, finalSkinState, interactionId);

		await DiscordRequest(inventorySession.endpoint, {
			method: "PATCH",
			body: {
				embeds: [finalEmbed],
				components: finalComponents,
			},
		});
	}, 2000); // Delay for the result to feel more impactful
}

// --- Helper Functions ---

/** Builds the result embed (success or failure). */
function buildFinalEmbed(succeeded, skin, skinData) {
	const embed = new EmbedBuilder()
		.setTitle(succeeded ? "Amélioration Réussie ! 🎉" : "L'amélioration a échoué... ❌")
		.setDescription(`**${skin.displayName}**`)
		.setImage(skin.displayIcon) // A static image is fine here
		.setColor(succeeded ? 0x22a55b : 0xed4245);

	if (succeeded) {
		embed.addFields(
			{
				name: "Nouveau Niveau",
				value: `${skin.currentLvl}/${skinData.levels.length}`,
				inline: true,
			},
			{
				name: "Nouveau Chroma",
				value: `${skin.currentChroma}/${skinData.chromas.length}`,
				inline: true,
			},
			{
				name: "Nouvelle Valeur",
				value: `**${skin.currentPrice} Flopos**`,
				inline: true,
			},
		);
	} else {
		embed.addFields({ name: "Statut", value: "Aucun changement." });
	}
	return embed;
}

/** Builds the result components (Retry button or Video link). */
function buildFinalComponents(succeeded, skinData, skin, interactionId) {
	const isMaxed = skin.currentLvl >= skinData.levels.length && skin.currentChroma >= skinData.chromas.length;

	if (isMaxed) return []; // No buttons if maxed out

	const row = new ActionRowBuilder();
	if (succeeded) {
		// Check for video on the new level/chroma
		const levelData = skinData.levels[skin.currentLvl - 1] || {};
		const chromaData = skinData.chromas[skin.currentChroma - 1] || {};
		const videoUrl = levelData.streamedVideo || chromaData.streamedVideo;

		if (videoUrl) {
			row.addComponents(new ButtonBuilder().setLabel("🎬 Aperçu Vidéo").setStyle(ButtonStyle.Link).setURL(videoUrl));
		} else {
			return []; // No button if no video
		}
	} else {
		// Add a "Retry" button
		row.addComponents(
			new ButtonBuilder()
				.setLabel("Réessayer 🔄️")
				.setStyle(ButtonStyle.Primary)
				.setCustomId(`upgrade_${interactionId}`),
		);
	}
	return [row];
}
