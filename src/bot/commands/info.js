import { InteractionResponseType } from "discord-interactions";

/**
 * Handles the /info slash command.
 * Fetches and displays a list of all members who are currently timed out in the guild.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleInfoCommand(req, res, client) {
	const { guild_id } = req.body;

	try {
		// Fetch the guild object from the client
		const guild = await client.guilds.fetch(guild_id);

		// Fetch all members to ensure the cache is up to date
		await guild.members.fetch();

		// Filter the cached members to find those who are timed out
		// A member is timed out if their `communicationDisabledUntil` property is a future date.
		const timedOutMembers = guild.members.cache.filter(
			(member) => member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now(),
		);

		// --- Case 1: No members are timed out ---
		if (timedOutMembers.size === 0) {
			return res.send({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					embeds: [
						{
							title: "Membres Timeout",
							description: "Aucun membre n'est actuellement timeout.",
							color: 0x4f545c, // Discord's gray color
						},
					],
				},
			});
		}

		// --- Case 2: At least one member is timed out ---
		// Format the list of timed-out members for the embed
		const memberList = timedOutMembers
			.map((member) => {
				// toLocaleString provides a user-friendly date and time format
				const expiration = new Date(member.communicationDisabledUntilTimestamp).toLocaleString("fr-FR");
				return `▫️ **${member.user.globalName || member.user.username}** (jusqu'au ${expiration})`;
			})
			.join("\n");

		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				embeds: [
					{
						title: "Membres Actuellement Timeout",
						description: memberList,
						color: 0xed4245, // Discord's red color
					},
				],
			},
		});
	} catch (error) {
		console.error("Error handling /info command:", error);
		return res.status(500).json({ error: "Failed to fetch timeout information." });
	}
}
