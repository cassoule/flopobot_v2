import {
	InteractionResponseType,
	InteractionResponseFlags,
	MessageComponentTypes,
	ButtonStyleTypes,
} from "discord-interactions";

import { formatTime, getOnlineUsersWithRole } from "../../utils/index.js";
import { DiscordRequest } from "../../api/discord.js";
import { activePolls } from "../../game/state.js";
import { getSocketIo } from "../../server/socket.js";
import { getUser } from "../../database/index.js";

/**
 * Handles the /timeout slash command.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {object} client - The Discord.js client instance.
 */
export async function handleTimeoutCommand(req, res, client) {
	const io = getSocketIo();
	const { id, member, guild_id, channel_id, token, data } = req.body;
	const { options } = data;

	// Extract command options
	const userId = member.user.id;
	const targetUserId = options[0].value;
	const time = options[1].value;

	// Fetch member objects from Discord
	const guild = await client.guilds.fetch(guild_id);
	const fromMember = await guild.members.fetch(userId);
	const toMember = await guild.members.fetch(targetUserId);

	// --- Validation Checks ---
	// 1. Check if a poll is already running for the target user
	const existingPoll = Object.values(activePolls).find((poll) => poll.toUserId === targetUserId);
	if (existingPoll) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: `Impossible de lancer un vote pour **${toMember.user.globalName}**, un vote est déjà en cours.`,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	// 2. Check if the user is already timed out
	if (toMember.communicationDisabledUntilTimestamp > Date.now()) {
		return res.send({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: `**${toMember.user.globalName}** est déjà timeout.`,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	// --- Poll Initialization ---
	const pollId = id; // Use the interaction ID as the unique poll ID
	const webhookEndpoint = `webhooks/${process.env.APP_ID}/${token}/messages/@original`;

	// Calculate required votes
	const onlineEligibleUsers = await getOnlineUsersWithRole(guild, process.env.VOTING_ROLE_ID);
	const requiredMajority = Math.max(
		parseInt(process.env.MIN_VOTES, 10),
		Math.floor(onlineEligibleUsers.size / (time >= 21600 ? 2 : 3)) + 1,
	);

	// Store poll data in the active state
	activePolls[pollId] = {
		id: userId,
		username: fromMember.user.globalName,
		toUserId: targetUserId,
		toUsername: toMember.user.globalName,
		time: time,
		time_display: formatTime(time),
		for: 0,
		against: 0,
		voters: [],
		channelId: channel_id,
		endpoint: webhookEndpoint,
		endTime: Date.now() + parseInt(process.env.POLL_TIME, 10) * 1000,
		requiredMajority: requiredMajority,
	};

	// --- Set up Countdown Interval ---
	const countdownInterval = setInterval(async () => {
		const poll = activePolls[pollId];

		// If poll no longer exists, clear the interval
		if (!poll) {
			clearInterval(countdownInterval);
			return;
		}

		const remaining = Math.max(0, Math.floor((poll.endTime - Date.now()) / 1000));
		const votesNeeded = Math.max(0, poll.requiredMajority - poll.for);
		const countdownText = `**${Math.floor(remaining / 60)}m ${remaining % 60}s** restantes`;

		// --- Poll Expiration Logic ---
		if (remaining === 0) {
			clearInterval(countdownInterval);

			const votersList = poll.voters
				.map((voterId) => {
					const user = getUser.get(voterId);
					return `- ${user?.globalName || "Utilisateur Inconnu"}`;
				})
				.join("\n");

			try {
				await DiscordRequest(poll.endpoint, {
					method: "PATCH",
					body: {
						embeds: [
							{
								title: `Le vote pour timeout ${poll.toUsername} a échoué 😔`,
								description: `Il manquait **${votesNeeded}** vote(s).`,
								fields: [
									{
										name: "Pour",
										value: `✅ ${poll.for}\n${votersList}`,
										inline: true,
									},
								],
								color: 0xff4444, // Red for failure
							},
						],
						components: [], // Remove buttons
					},
				});
			} catch (err) {
				console.error("Error updating failed poll message:", err);
			}

			// Clean up the poll from active state
			delete activePolls[pollId];
			io.emit("poll-update"); // Notify frontend
			return;
		}

		// --- Periodic Update Logic ---
		// Update the message every second with the new countdown
		try {
			const votersList = poll.voters
				.map((voterId) => {
					const user = getUser.get(voterId);
					return `- ${user?.globalName || "Utilisateur Inconnu"}`;
				})
				.join("\n");

			await DiscordRequest(poll.endpoint, {
				method: "PATCH",
				body: {
					embeds: [
						{
							title: "Vote de Timeout",
							description: `**${poll.username}** propose de timeout **${poll.toUsername}** pendant ${poll.time_display}.\nIl manque **${votesNeeded}** vote(s).`,
							fields: [
								{
									name: "Pour",
									value: `✅ ${poll.for}\n${votersList}`,
									inline: true,
								},
								{
									name: "Temps restant",
									value: `⏳ ${countdownText}`,
									inline: false,
								},
							],
							color: 0x5865f2, // Discord Blurple
						},
					],
					// Keep the components so people can still vote
					components: [
						{
							type: MessageComponentTypes.ACTION_ROW,
							components: [
								{
									type: MessageComponentTypes.BUTTON,
									custom_id: `vote_for_${pollId}`,
									label: "Oui ✅",
									style: ButtonStyleTypes.SUCCESS,
								},
							],
						},
					],
				},
			});
		} catch (err) {
			console.error("Error updating countdown:", err);
			// If the message was deleted, stop trying to update it.
			if (err.message.includes("Unknown Message")) {
				clearInterval(countdownInterval);
				delete activePolls[pollId];
				io.emit("poll-update");
			}
		}
	}, 2000); // Update every 2 seconds to avoid rate limits

	// --- Send Initial Response ---
	io.emit("poll-update"); // Notify frontend

	return res.send({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			embeds: [
				{
					title: "Vote de Timeout",
					description: `**${activePolls[pollId].username}** propose de timeout **${activePolls[pollId].toUsername}** pendant ${activePolls[pollId].time_display}.\nIl manque **${activePolls[pollId].requiredMajority}** vote(s).`,
					fields: [
						{
							name: "Pour",
							value: "✅ 0",
							inline: true,
						},
						{
							name: "Temps restant",
							value: `⏳ **${Math.floor((activePolls[pollId].endTime - Date.now()) / 60000)}m**`,
							inline: false,
						},
					],
					color: 0x5865f2,
				},
			],
			components: [
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `vote_for_${pollId}`,
							label: "Oui ✅",
							style: ButtonStyleTypes.SUCCESS,
						},
					],
				},
			],
		},
	});
}
