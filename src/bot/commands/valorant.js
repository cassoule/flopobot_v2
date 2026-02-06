import { InteractionResponseFlags, InteractionResponseType } from "discord-interactions";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { DiscordRequest } from "../../api/discord.js";
import * as userService from "../../services/user.service.js";
import * as skinService from "../../services/skin.service.js";
import * as logService from "../../services/log.service.js";
import { skins } from "../../game/state.js";

/**
 * Handles the /valorant slash command for opening a "skin case".
 *
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleValorantCommand(req, res, client) {
	return res.send({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `L'ouverture de caisses Valorant en commande discord est désactivée. Tu peux aller en ouvrir sur FlopoSite.`,
			flags: InteractionResponseFlags.EPHEMERAL,
		},
	});

	const { member, token } = req.body;
	const userId = member.user.id;
	const valoPrice = parseInt(process.env.VALO_PRICE, 10) || 500;

	try {
		// --- 1. Verify and process payment ---

		const commandUser = await userService.getUser(userId);
		if (!commandUser) {
			return res.send({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: "Erreur lors de la récupération de votre profil utilisateur.",
					flags: InteractionResponseFlags.EPHEMERAL,
				},
			});
		}
		if (commandUser.coins < valoPrice) {
			return res.send({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: `Pas assez de FlopoCoins (${valoPrice} requis).`,
					flags: InteractionResponseFlags.EPHEMERAL,
				},
			});
		}

		await logService.insertLog({
			id: `${userId}-${Date.now()}`,
			userId: userId,
			action: "VALO_CASE_OPEN",
			targetUserId: null,
			coinsAmount: -valoPrice,
			userNewAmount: commandUser.coins - valoPrice,
		});
		await userService.updateUserCoins(userId, commandUser.coins - valoPrice);

		// --- 2. Send Initial "Opening" Response ---
		// Acknowledge the interaction immediately with a loading message.
		const initialEmbed = new EmbedBuilder()
			.setTitle("Ouverture de la caisse...")
			.setImage("https://media.tenor.com/gIWab6ojBnYAAAAd/weapon-line-up-valorant.gif")
			.setColor("#F2F3F3");

		await res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { embeds: [initialEmbed] },
		});

		// --- 3. Run the skin reveal logic after a delay ---
		setTimeout(async () => {
			const webhookEndpoint = `webhooks/${process.env.APP_ID}/${token}/messages/@original`;
			try {
				// --- Skin Selection ---
				const availableSkins = await skinService.getAllAvailableSkins();
				if (availableSkins.length === 0) {
					throw new Error("No available skins to award.");
				}
				const dbSkin = availableSkins[Math.floor(Math.random() * availableSkins.length)];
				const randomSkinData = skins.find((skin) => skin.uuid === dbSkin.uuid);
				if (!randomSkinData) {
					throw new Error(`Could not find skin data for UUID: ${dbSkin.uuid}`);
				}

				// --- Randomize Level and Chroma ---
				const randomLevel = Math.floor(Math.random() * randomSkinData.levels.length) + 1;
				let randomChroma = 1;
				if (randomLevel === randomSkinData.levels.length && randomSkinData.chromas.length > 1) {
					// Ensure chroma is at least 1 and not greater than the number of chromas
					randomChroma = Math.floor(Math.random() * randomSkinData.chromas.length) + 1;
				}

				// --- Calculate Price ---
				const calculatePrice = () => {
					let result = parseFloat(dbSkin.basePrice);
					result *= 1 + randomLevel / Math.max(randomSkinData.levels.length, 2);
					result *= 1 + randomChroma / 4;
					return parseFloat(result.toFixed(0));
				};
				const finalPrice = calculatePrice();

				// --- Update Database ---
				await skinService.updateSkin({
					uuid: randomSkinData.uuid,
					userId: userId,
					currentLvl: randomLevel,
					currentChroma: randomChroma,
					currentPrice: finalPrice,
				});

				// --- Prepare Final Embed and Components ---
				const finalEmbed = buildFinalEmbed(dbSkin, randomSkinData, randomLevel, randomChroma, finalPrice);
				const components = buildComponents(randomSkinData, randomLevel, randomChroma);

				// --- Edit the Original Message with the Result ---
				await DiscordRequest(webhookEndpoint, {
					method: "PATCH",
					body: {
						embeds: [finalEmbed],
						components: components,
					},
				});
			} catch (revealError) {
				console.error("Error during skin reveal:", revealError);
				// Inform the user that something went wrong
				await DiscordRequest(webhookEndpoint, {
					method: "PATCH",
					body: {
						content: "Oups, il y a eu un petit problème lors de l'ouverture de la caisse.",
						embeds: [],
					},
				});
			}
		}, 5000); // 5-second delay for suspense
	} catch (error) {
		console.error("Error handling /valorant command:", error);
		// This catches errors from the initial interaction, e.g., the payment API call.
		return res.status(500).json({ error: "Failed to initiate the case opening." });
	}
}

// --- Helper Functions ---

/** Builds the final embed to display the won skin. */
function buildFinalEmbed(dbSkin, skinData, level, chroma, price) {
	const selectedChromaData = skinData.chromas[chroma - 1] || {};

	const getChromaName = () => {
		if (chroma > 1) {
			const name = selectedChromaData.displayName
				?.replace(/[\r\n]+/g, " ")
				.replace(skinData.displayName, "")
				.trim();
			const match = name?.match(/Variante\s*[0-9\s]*-\s*([^)]+)/i);
			return match ? match[1].trim() : name || "Chroma Inconnu";
		}
		return "Base";
	};

	const getImageUrl = () => {
		if (level === skinData.levels.length) {
			return selectedChromaData.fullRender || selectedChromaData.displayIcon || skinData.displayIcon;
		}
		const levelData = skinData.levels[level - 1];
		return levelData?.displayIcon || skinData.displayIcon;
	};

	const lvlText =
		(level >= 1 ? "1️⃣" : "") +
		(level >= 2 ? "2️⃣" : "") +
		(level >= 3 ? "3️⃣" : "") +
		(level >= 4 ? "4️⃣" : "") +
		(level >= 5 ? "5️⃣" : "") +
		(level >= 6 ? "6️⃣" : "") +
		"◾".repeat(skinData.levels.length - level);
	const chromaText = "💠".repeat(chroma) + "◾".repeat(skinData.chromas.length - chroma);

	return new EmbedBuilder()
		.setTitle(`${skinData.displayName} | ${getChromaName()}`)
		.setDescription(dbSkin.tierText)
		.setColor(`#${dbSkin.tierColor}`)
		.setImage(getImageUrl())
		.setFields([
			{ name: "Lvl", value: lvlText || "N/A", inline: true },
			{ name: "Chroma", value: chromaText || "N/A", inline: true },
			{
				name: "Prix",
				value: `**${price}** <:vp:1362964205808128122>`,
				inline: true,
			},
		])
		.setFooter({ text: "Skin ajouté à votre inventaire !" });
}

/** Builds the action row with a video button if a video is available. */
function buildComponents(skinData, level, chroma) {
	const selectedLevelData = skinData.levels[level - 1] || {};
	const selectedChromaData = skinData.chromas[chroma - 1] || {};

	let videoUrl = null;
	if (level === skinData.levels.length) {
		videoUrl = selectedChromaData.streamedVideo;
	}
	videoUrl = videoUrl || selectedLevelData.streamedVideo;

	if (videoUrl) {
		return [
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setLabel("🎬 Aperçu Vidéo").setStyle(ButtonStyle.Link).setURL(videoUrl),
			),
		];
	}
	return []; // Return an empty array if no video is available
}
