import {
    InteractionResponseType,
    InteractionResponseFlags,
} from 'discord-interactions';
import { DiscordRequest } from '../../api/discord.js';
import { activePolls } from '../../game/state.js';
import { getSocketIo } from '../../server/socket.js';
import { getUser } from '../../database/index.js';

/**
 * Handles clicks on the 'Yes' or 'No' buttons of a timeout poll.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
export async function handlePollVote(req, res) {
    const io = getSocketIo();
    const { member, data, guild_id } = req.body;
    const { custom_id } = data;

    // --- 1. Parse Component ID ---
    const [_, voteType, pollId] = custom_id.split('_'); // e.g., ['vote', 'for', '12345...']
    const isVotingFor = voteType === 'for';

    // --- 2. Retrieve Poll and Validate ---
    const poll = activePolls[pollId];
    const voterId = member.user.id;

    if (!poll) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Ce sondage de timeout n'est plus actif.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // Check if the voter has the required role
    if (!member.roles.includes(process.env.VOTING_ROLE_ID)) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Vous n'avez pas le rôle requis pour participer à ce vote.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // Prevent user from voting on themselves
    if (poll.toUserId === voterId) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Vous ne pouvez pas voter pour vous-même.",
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // Prevent double voting
    if (poll.voters.includes(voterId)) {
        return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Vous avez déjà voté pour ce sondage.',
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    }

    // --- 3. Record the Vote ---
    poll.voters.push(voterId);
    if (isVotingFor) {
        poll.for++;
    } else {
        poll.against++;
    }

    io.emit('poll-update'); // Notify frontend clients of the change

    const votersList = poll.voters.map(vId => `- ${getUser.get(vId)?.globalName || 'Utilisateur Inconnu'}`).join('\n');


    // --- 4. Check for Majority ---
    if (isVotingFor && poll.for >= poll.requiredMajority) {
        // --- SUCCESS CASE: MAJORITY REACHED ---

        // a. Update the poll message to show success
        try {
            await DiscordRequest(poll.endpoint, {
                method: 'PATCH',
                body: {
                    embeds: [{
                        title: 'Vote Terminé - Timeout Appliqué !',
                        description: `La majorité a été atteinte. **${poll.toUsername}** a été timeout pendant ${poll.time_display}.`,
                        fields: [{ name: 'Votes Pour', value: `✅ ${poll.for}\n${votersList}`, inline: true }],
                        color: 0x22A55B, // Green for success
                    }],
                    components: [], // Remove buttons
                },
            });
        } catch (err) {
            console.error('Error updating final poll message:', err);
        }

        // b. Execute the timeout via Discord API
        try {
            const timeoutUntil = new Date(Date.now() + poll.time * 1000).toISOString();
            const endpointTimeout = `guilds/${guild_id}/members/${poll.toUserId}`;
            await DiscordRequest(endpointTimeout, {
                method: 'PATCH',
                body: { communication_disabled_until: timeoutUntil },
            });

            // c. Send a public confirmation message and clean up
            delete activePolls[pollId];
            io.emit('poll-update');
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: `💥 <@${poll.toUserId}> a été timeout pendant **${poll.time_display}** par décision démocratique !`,
                },
            });

        } catch (err) {
            console.error('Error timing out user:', err);
            delete activePolls[pollId];
            io.emit('poll-update');
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: `La majorité a été atteinte, mais une erreur est survenue lors de l'application du timeout sur <@${poll.toUserId}>.`,
                },
            });
        }
    } else {
        // --- PENDING CASE: NO MAJORITY YET ---

        // a. Send an ephemeral acknowledgment to the voter
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Votre vote a été enregistré ! ✅',
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });

        // b. Update the original poll message asynchronously (no need to await)
        // The main countdown interval will also handle this, but this provides a faster update.
        const votesNeeded = Math.max(0, poll.requiredMajority - poll.for);
        const remaining = Math.max(0, Math.floor((poll.endTime - Date.now()) / 1000));
        const countdownText = `**${Math.floor(remaining / 60)}m ${remaining % 60}s** restantes`;

        DiscordRequest(poll.endpoint, {
            method: 'PATCH',
            body: {
                embeds: [{
                    title: 'Vote de Timeout',
                    description: `**${poll.username}** propose de timeout **${poll.toUsername}** pendant ${poll.time_display}.\nIl manque **${votesNeeded}** vote(s).`,
                    fields: [{
                        name: 'Pour',
                        value: `✅ ${poll.for}\n${votersList}`,
                        inline: true,
                    }, {
                        name: 'Temps restant',
                        value: `⏳ ${countdownText}`,
                        inline: false,
                    }],
                    color: 0x5865F2,
                }],
                // Keep the original components so people can still vote
                components: req.body.message.components,
            },
        }).catch(err => console.error("Error updating poll after vote:", err));
    }
}