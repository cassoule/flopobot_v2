import { InteractionResponseType } from "discord-interactions";
import { getTopSkins } from "../../database/index.js";

/**
 * Handles the /skins slash command.
 * Fetches and displays the top 10 most valuable skins from the database.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleSkinsCommand(req, res, client) {
	const { guild_id } = req.body;

	try {
		// --- 1. Fetch Data ---
		const topSkins = getTopSkins.all();
		const guild = await client.guilds.fetch(guild_id);
		const fields = [];

		// --- 2. Build Embed Fields Asynchronously ---
		// We use a for...of loop to handle the async fetch for each owner.
		for (const [index, skin] of topSkins.entries()) {
			let ownerText = "Libre"; // Default text if the skin has no owner

			// If the skin has an owner, fetch their details
			if (skin.user_id) {
				try {
					const owner = await guild.members.fetch(skin.user_id);
					// Use globalName if available, otherwise fallback to username
					ownerText = `**@${owner.user.globalName || owner.user.username}** ✅`;
				} catch (e) {
					// This can happen if the user has left the server
					console.warn(`Could not fetch owner for user ID: ${skin.user_id}`);
					ownerText = "Appartient à un utilisateur inconnu";
				}
			}

			// Add the formatted skin info to our fields array
			fields.push({
				name: `#${index + 1} - **${skin.displayName}**`,
				value: `Valeur Max: **${skin.maxPrice} Flopos** | ${ownerText}`,
				inline: false,
			});
		}

		// --- 3. Send the Response ---
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				embeds: [
					{
						title: "🏆 Top 10 des Skins les Plus Chers",
						description: "Classement des skins par leur valeur maximale potentielle.",
						fields: fields,
						color: 0xffd700, // Gold color for a leaderboard
						footer: {
							text: "Utilisez /inventory pour voir vos propres skins.",
						},
					},
				],
			},
		});
	} catch (error) {
		console.error("Error handling /skins command:", error);
		return res.status(500).json({ error: "Failed to fetch the skins leaderboard." });
	}
}
