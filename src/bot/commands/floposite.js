import { InteractionResponseType, MessageComponentTypes, ButtonStyleTypes } from "discord-interactions";

/**
 * Handles the /floposite slash command.
 * This command replies with a simple embed containing a link button to the main website.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
export async function handleFlopoSiteCommand(req, res) {
	// The URL for the link button. Consider moving to .env if it changes.
	const siteUrl = process.env.FLOPOSITE_URL || "https://floposite.com";

	// The URL for the thumbnail image.
	const thumbnailUrl = `${process.env.API_URL}/public/images/flopo.png`;

	// Define the components (the link button)
	const components = [
		{
			type: MessageComponentTypes.ACTION_ROW,
			components: [
				{
					type: MessageComponentTypes.BUTTON,
					label: "Aller sur FlopoSite",
					style: ButtonStyleTypes.LINK,
					url: siteUrl,
				},
			],
		},
	];

	// Define the embed message
	const embeds = [
		{
			title: "FlopoSite",
			description: "L'officiel et très goatesque site de FlopoBot.",
			color: 0x6571f3, // A custom blue color
			thumbnail: {
				url: thumbnailUrl,
			},
		},
	];

	// Send the response to Discord
	return res.send({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			embeds: embeds,
			components: components,
		},
	});
}
