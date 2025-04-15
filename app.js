import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import {
  getRandomEmoji,
  DiscordRequest,
  getOnlineUsersWithRole,
  formatTime,
  gork,
  getRandomHydrateText
} from './utils.js';
import { getShuffledOptions, getResult } from './game.js';
import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';

// Create an express app
const app = express();
// Get port, or default to 25578
const PORT = process.env.PORT || 25578;
// To keep track of our active games
const activeGames = {};
const activePolls = {};
let todaysHydrateCron = ''

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,             // For guild events
    GatewayIntentBits.GuildMessages,      // For messages in guilds
    GatewayIntentBits.MessageContent,     // For reading message content (privileged intent)
  ]
});

// Login to Discord using your bot token (set BOT_TOKEN in your .env file)
client.login(process.env.BOT_TOKEN);

// Listen for message events
client.on('messageCreate', async (message) => {
  // Ignore messages from bots to avoid feedback loops
  if (message.author.bot) return;

  // Check if the message content includes the word "quoi" (case-insensitive)
  if (message.content.toLowerCase().includes("quoi")) {
    let prob = Math.random()
    console.log(`feur ? ${prob} ${process.env.FEUR_PROB}`)
    if (prob < process.env.FEUR_PROB) {
      console.log('feur!')
      // Send a message "feur" to the same channel
      message.channel.send(`feur`)
          .catch(console.error);
    }
  }

  if (message.content.toLowerCase().startsWith(`<@${process.env.APP_ID}>`) || message.mentions.repliedUser?.id === process.env.APP_ID) {
    try {
      // Fetch last 10 messages from the channel
      const fetched = await message.channel.messages.fetch({ limit: 50 });
      const messagesArray = Array.from(fetched.values()).reverse(); // oldest to newest

      const requestMessage = message.content.replace(`<@${process.env.APP_ID}>`, '')

      // Map to OpenAI format
      let formatted = messagesArray.map(msg => ({
        role: msg.author.bot ? "assistant" : "user",
        content: `${msg.author.id} | ${msg.content} | ${msg.id}`,
      }));

      const members = await getOnlineUsersWithRole(process.env.GUILD_ID, process.env.VOTING_ROLE_ID);

      formatted.push({
        role: 'developer',
        content: `Les prochaines entrées sont les différents utilisateurs présents. Chaque entrée comporte l'id, le nom sur le serveur et le nom sur discord d'un utilisateur`,
      })
      members.forEach(member => {
        formatted.push({
          role: 'developer',
          content: `${member.user.id} : ${member.user.global_name}, ${member.user.username}`,
        })
      })

      // Add a final user prompt to clarify the request
      formatted.push(
          {
            role: "developer",
            content: "Sachant que chaque message d'utilisateur comporte l'id de l'utilisateur ayant écrit le message au début de l'entrée, le contenu du message, et l'id du message pour finir (formaté comme suit : user_id | content | message_id, par contre ne formatte jamais tes réponses ainsi, met juste la partie content). Adopte une attitude détendue et répond comme si tu participais à la conversation, essaye d'imiter au mieux la façon de parler des utilisateurs et/ou d'un utilisateur de twitter (X). N'hésites pas à utiliser des abréviations mais sans en abuser. Fait plutôt court, une ou deux phrases maximum "
          },
          {
            role: "developer",
            content: `L'utilisateur qui s'adresse a toi dans la prochaine phrase est : ${message.author}, si le message de l'utilisateur est vide et/ou ne comporte que ton ID, agis comme s'il voulait savoir si tu es présent, et réponds de manière très très courte dans ce cas, 2 ou 3 mots`
          },
          {
            role: "user",
            content: requestMessage.length > 1 ? requestMessage : 'Répond de manière approprié aux derniers messages de cette conversation. Sans prendre en compte mon dernier message vide',
          },
          {
            role: 'developer',
            content: message.mentions.repliedUser?.id ? `La phrase de l'utilisateur répond à un message de ${message.mentions.repliedUser?.id === process.env.APP_ID ? 'toi-même' : message.mentions.repliedUser?.id}, l'id du message est : ${message.reference?.messageId}` : '',
          },
          {
            role: "developer",
            content: "Considère chaque messages d'utilisateurs afin d'établir un contexte de la situation, si tu ne comprends pas le dernière demande utilisateur analyse le reste des demandes."
          },
          {
            role: "developer",
            content: 'En te basant sur la liste des utilisateurs et des id utilisateurs présent au début de chaque message, lorsque tu parles d\'un utilisateur présent dans cette liste que ce soit via son \'user.global_name\', son \'user.username\' ou son \'user.id\' , identifie le avec son \'user.id\' plutôt que d\'utiliser son \'user.global_name\', ça doit ressembler à ça en remplaçant \'ID\' <@ID>. Fait le la première fois que tu évoques l\'utilisateur mais donne juste son \'user.global_name\' ensuite',
          },
          {
            role: "developer",
            content: `Ton id est : ${process.env.APP_ID}, évite de l'utiliser et ne formatte pas tes messages avec ton propre id, si jamais tu utilises un id formatte le comme suit : <@ID>, en remplacant ID par l'id. Ton username et global_name sont : ${process.env.APP_NAME}`
          });

      const reply = await gork(formatted);

      // Send response to the channel
      await message.channel.send(reply);
    } catch (err) {
      console.error("Error fetching or sending messages:", err);
      await message.channel.send("Oups, y'a eu un problème!");
    }
  }
});

// Once bot is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  const randomMinute = Math.floor(Math.random() * 60);
  const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
  todaysHydrateCron = `${randomMinute} ${randomHour} * * *`
  console.log(todaysHydrateCron)

  // ─── 💀 Midnight Chaos Timer ──────────────────────
  cron.schedule(process.env.CRON_EXPR, async () => {
    const randomMinute = Math.floor(Math.random() * 60);
    const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
    todaysHydrateCron = `${randomMinute} ${randomHour} * * *`

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
    const members = await getOnlineUsersWithRole(guild.id, roleId);

    // Filter out bots and members the bot can't moderate
    const eligible = members.filter(member => !member.user.bot);

    const prob = Math.random();
    if (eligible.length === 0 || prob > process.env.CHAOS_PROB) {
      console.log(`No roulette tonight ${prob}`)
      return
    }

    const randomMember = eligible[Math.floor(Math.random() * eligible.length)];

    const timeoutUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    try {
      await guild.members.edit(randomMember.user.id, {
        communication_disabled_until: timeoutUntil,
        reason: 'Roulette Russe 🔔',
      });

      const generalChannel = guild.channels.cache.find(
          ch => ch.name === 'général' || ch.name === 'general'
      );

      if (generalChannel && generalChannel.isTextBased()) {
        generalChannel.send(
            `🎯 <@${randomMember.user.id}> ça dégage, à mimir ! (jusqu'à 12h00)`
        );
      }

      console.log(`${randomMember.user.username} has been timed out until ${timeoutUntil}`);
    } catch (err) {
      console.error('Failed to timeout random member:', err);
    }
  });

  cron.schedule(todaysHydrateCron, async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    try {
      const generalChannel = guild.channels.cache.find(
          ch => ch.name === 'général' || ch.name === 'general'
      );

      if (generalChannel && generalChannel.isTextBased()) {
        generalChannel.send(
            `${getRandomHydrateText()} <@${process.env.VOTING_ROLE_ID}> ${getRandomEmoji()}`
        );
      }

      console.log(`Message hydratation`);
    } catch (err) {
      console.error('Message hydratation:', err);
    }
  });
});

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;
    console.log(name)

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          // Fetches a random emoji to send from a helper function
          content: `hello world ${getRandomEmoji()}`,
        },
      });
    }

    // "challenge" command
    if (name === 'challenge') {
      // Interaction context
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      // User's object choice
      const objectName = req.body.data.options[0].value;

      // Create active game using message ID as the game ID
      activeGames[id] = {
        id: userId,
        objectName,
      };

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Rock papers scissors challenge from <@${userId}>`,
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the game ID to use later on
                  custom_id: `accept_button_${req.body.id}`,
                  label: 'Accept',
                  style: ButtonStyleTypes.PRIMARY,
                },
              ],
            },
          ],
        },
      });
    }

    // 'timeout' command
    if (name === 'timeout') {
      // Interaction context
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      // User's choices
      const akhy = req.body.data.options[0].value;
      const time = req.body.data.options[1].value;

      // Save the poll information along with channel ID so we can notify later
      activePolls[id] = {
        id: userId,
        toUserId: akhy,
        time: time,
        time_display: formatTime(time),
        for: 0,
        against: 0,
        voters: new Set(),
        channelId: req.body.channel_id,  // Capture channel for follow-up notification
        endpoint: `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
      };

      const guildId = req.body.guild_id;
      const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
      const onlineEligibleUsers = await getOnlineUsersWithRole(guildId, roleId);
      const requiredMajority = Math.max(parseInt(process.env.MIN_VOTES), Math.floor(onlineEligibleUsers.length / 2) + 1);
      const votesNeeded = Math.max(0, requiredMajority - activePolls[id].for);

      // Set a timeout for 5 minutes to end the poll if no majority is reached
     /* setTimeout(async () => {
        if (activePolls[id]) {
          // Poll has expired without enough votes
          // Send a notification to the channel that the vote failed
          try {
            await DiscordRequest(
                `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
                {
                  method: 'PATCH',
                  body: {
                    content: `Le vote pour timeout de <@${activePolls[id].toUserId}> a expiré sans atteindre la majorité.`,
                    components: []  // remove the buttons
                  },
                }
            );
          } catch (err) {
            console.error('Error sending vote failure message:', err);
          }
          // Clear the poll
          delete activePolls[id];
        }
      }, process.env.POLL_TIME * 1000);*/
      activePolls[id].endTime = Date.now() + process.env.POLL_TIME * 1000;

// Set an interval to update the countdown every 10 seconds (or more often if you want)
      const countdownInterval = setInterval(async () => {
        const poll = activePolls[id];

        const remaining = Math.max(0, Math.floor((poll.endTime - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const countdownText = `**${minutes}m ${seconds}s** restantes`;
        const requiredMajority = Math.max(parseInt(process.env.MIN_VOTES), Math.floor(onlineEligibleUsers.length / 2) + 1);
        const votesNeeded = Math.max(0, requiredMajority - activePolls[id].for);

        if (!poll || remaining === 0) {
          try {
            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    content:
                        `> Le vote pour timeout <@${poll.toUserId}> pendant ${poll.time_display} a échoué 😔\n > \n` +
                        `> Il manquait **${votesNeeded}** vote(s)\n`,
                    components: [],
                  },
                }
            );
          } catch (err) {
            console.error('Error updating countdown:', err);
          }
          clearInterval(countdownInterval);
          return;
        }

        try {
          await DiscordRequest(
              poll.endpoint,
              {
                method: 'PATCH',
                body: {
                  content:
                      `> <@${poll.id}> propose de timeout <@${poll.toUserId}> pendant ${poll.time_display}\n > \n` +
                      `> ✅ **${poll.for}**\n > \n` +
                      `> Il manque **${votesNeeded}** vote(s)\n` +
                      `> ⏳ Temps restant : ${countdownText}\n`,
                  components: [
                    {
                      type: MessageComponentTypes.ACTION_ROW,
                      components: [
                        {
                          type: MessageComponentTypes.BUTTON,
                          custom_id: `vote_for_${req.body.id}`,
                          label: 'Oui ✅',
                          style: ButtonStyleTypes.SECONDARY,
                        },
                        {
                          type: MessageComponentTypes.BUTTON,
                          custom_id: `vote_against_${req.body.id}`,
                          label: 'Non ❌',
                          style: ButtonStyleTypes.SECONDARY,
                        },
                      ],
                    },
                  ],
                },
              }
          );
        } catch (err) {
          console.error('Error updating countdown:', err);
        }
      }, 1000); // every second

      const remaining = Math.max(0, Math.floor((activePolls[id].endTime - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      const countdownText = `**${minutes}m ${seconds}s** restantes`;

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `> <@${activePolls[id].id}> propose de timeout <@${activePolls[id].toUserId}> pendant ${activePolls[id].time_display}\n > \n` +
              `> ✅ **${activePolls[id].for}**\n > \n` +
              `> Il manque **${votesNeeded}** vote(s)\n` +
              `> ⏳ Temps restant : ${countdownText}\n`,
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  custom_id: `vote_for_${req.body.id}`,
                  label: 'Oui ✅',
                  style: ButtonStyleTypes.SECONDARY,
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  custom_id: `vote_against_${req.body.id}`,
                  label: 'Non ❌',
                  style: ButtonStyleTypes.SECONDARY,
                },
              ],
            },
          ],
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
// custom_id set in payload when sending message component
    const componentId = data.custom_id;

    if (componentId.startsWith('accept_button_')) {
      // get the associated game ID
      const gameId = componentId.replace('accept_button_', '');
      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      try {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'What is your object of choice?',
            // Indicates it'll be an ephemeral message
            flags: InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                  {
                    type: MessageComponentTypes.STRING_SELECT,
                    // Append game ID
                    custom_id: `select_choice_${gameId}`,
                    options: getShuffledOptions(),
                  },
                ],
              },
            ],
          },
        });
        // Delete previous message
        await DiscordRequest(endpoint, { method: 'DELETE' });
      } catch (err) {
        console.error('Error sending message:', err);
      }
    }
    else if (componentId.startsWith('select_choice_')) {
      // get the associated game ID
      const gameId = componentId.replace('select_choice_', '');

      if (activeGames[gameId]) {
        // Interaction context
        const context = req.body.context;
        // Get user ID and object choice for responding user
        // User ID is in user field for (G)DMs, and member for servers
        const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

        // User's object choice
        const objectName = data.values[0];

        // Calculate result from helper function
        const resultStr = getResult(activeGames[gameId], {
          id: userId,
          objectName,
        });

        // Remove game from storage
        delete activeGames[gameId];
        // Update message with token in request body
        const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;

        try {
          // Send results
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: resultStr },
          });
          // Update ephemeral message
          await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: {
              content: 'Nice choice ' + getRandomEmoji(),
              components: []
            }
          });
        } catch (err) {
          console.error('Error sending message:', err);
        }
      }
    }
    else if (componentId.startsWith('vote_')) {
      let gameId, isVotingFor;

      if (componentId.startsWith('vote_for_')) {
        gameId = componentId.replace('vote_for_', '');
        isVotingFor = true;
      } else {
        gameId = componentId.replace('vote_against_', '');
        isVotingFor = false;
      }

      if (activePolls[gameId]) {
        const poll = activePolls[gameId];
        poll.voters = poll.voters || new Set();
        const voterId = req.body.member.user.id;

        // Check if the voter has the required voting role
        const voterRoles = req.body.member.roles || [];
        if (!voterRoles.includes(process.env.VOTING_ROLE_ID)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "Tu n'as pas le rôle requis pour voter.",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        // Enforce one vote per eligible user
        if (poll.voters.has(voterId)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "Tu as déjà voté !",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        // Record the vote
        poll.voters.add(voterId);
        if (isVotingFor) {
          poll.for++;
        } else {
          poll.against++;
        }

        // Retrieve online eligible users (ensure your bot has the necessary intents)
        const guildId = req.body.guild_id;
        const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
        const onlineEligibleUsers = await getOnlineUsersWithRole(guildId, roleId);
        const requiredMajority = Math.max(parseInt(process.env.MIN_VOTES), Math.floor(onlineEligibleUsers.length / 2) + 1);
        const votesNeeded = Math.max(0, requiredMajority - poll.for);

        // Check if the majority is reached
        if (poll.for >= requiredMajority) {
          try {
            // Build the updated poll message content
            const updatedContent = `> <@${poll.id}> propose de timeout <@${poll.toUserId}> pendant ${poll.time_display}\n > \n` +
                `> ✅ **${poll.for}** votes au total\n > \n`;

            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    content: updatedContent,
                    components: [], // remove buttons
                  },
                }
            );
          } catch (err) {
            console.error('Error updating poll message:', err);
          }
          // Clear the poll so the setTimeout callback doesn't fire later
          delete activePolls[gameId];

          // **Actual Timeout Action**
          try {
            // Calculate the ISO8601 timestamp to disable communications until now + poll.time seconds
            const timeoutUntil = new Date(Date.now() + poll.time * 1000).toISOString();
            const endpointTimeout = `guilds/${req.body.guild_id}/members/${poll.toUserId}`;
            await DiscordRequest(endpointTimeout, {
              method: 'PATCH',
              body: { communication_disabled_until: timeoutUntil },
            });
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `<@${poll.toUserId}> a été timeout pendant ${poll.time_display} par décision démocratique 👊`,
              },
            });
          } catch (err) {
            console.error('Error timing out user:', err);
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `Impossible de timeout <@${poll.toUserId}>, désolé... 😔`,
              },
            });
          }
        }

        // If the vote is "for", update the original poll message to reflect the new vote count.
        if (isVotingFor) {
          const remaining = Math.max(0, Math.floor((poll.endTime - Date.now()) / 1000));
          const minutes = Math.floor(remaining / 60);
          const seconds = remaining % 60;
          const countdownText = `**${minutes}m ${seconds}s** restantes`;
          try {
            // Build the updated poll message content
            const updatedContent = `> <@${poll.id}> propose de timeout <@${poll.toUserId}> pendant ${poll.time_display}\n > \n` +
                    `> ✅ **${poll.for}**\n > \n` +
                    `> Il manque **${votesNeeded}** vote(s)\n` +
                    `> ⏳ Temps restant : ${countdownText}\n`;

            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    content: updatedContent,
                    components: req.body.message.components, // preserve the buttons
                  },
                }
            );
          } catch (err) {
            console.error('Error updating poll message:', err);
          }
        }

        // Send an ephemeral acknowledgement to the voter
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Vote enregistré ! ✅`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
    }
    return;
  }


  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});