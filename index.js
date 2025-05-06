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
  //getOnlineUsersWithRole,
  formatTime,
  gork,
  getRandomHydrateText,
  getAPOUsers,
  postAPOBuy
} from './utils.js';
import { channelPointsHandler } from './game.js';
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import cron from 'node-cron';
import Database from "better-sqlite3";
import {
  flopoDB,
  insertUser,
  insertManyUsers,
  updateUser,
  updateManyUsers,
  getUser,
  getAllUsers,
  stmtUsers,
  stmtSkins,
  updateManySkins,
  insertSkin,
  updateSkin,
  insertManySkins,
  getAllSkins,
  getSkin,
  getAllAvailableSkins,
  getUserInventory,
  getTopSkins, updateUserCoins,
} from './init_database.js';
import { getValorantSkins, getSkinTiers } from './valo.js';
import {sleep} from "openai/core";

// Create an express app
const app = express();
// Get port, or default to 25578
const PORT = process.env.PORT || 25578;
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.BASE_URL);
  res.header('Access-Control-Allow-Headers', 'Content-type, X-API-Key');
  next();
});
// To keep track of our active games
const activeGames = {};
const activePolls = {};
const activeInventories = {};
const activeSearchs = {};
let todaysHydrateCron = ''
const SPAM_INTERVAL = process.env.SPAM_INTERVAL

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,             // For guild events
    GatewayIntentBits.GuildMessages,      // For messages in guilds
    GatewayIntentBits.MessageContent, // For reading message content (privileged intent)
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ]
});

const requestTimestamps = new Map(); // userId => [timestamp1, timestamp2, ...]
const MAX_REQUESTS_PER_INTERVAL = parseInt(process.env.MAX_REQUESTS || "5");

const akhysData= new Map()
const skins = []

async function getAkhys() {
  try {
    stmtUsers.run();
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch(); // Fetch all members

    const akhys = members.filter(m => !m.user.bot && m.roles.cache.has(process.env.VOTING_ROLE_ID));

    akhys.forEach(akhy => {
      akhysData.set(akhy.user.id, {
        id: akhy.user.id,
        username: akhy.user.username,
        globalName: akhy.user.globalName,
        warned: false,
        warns: 0,
        allTimeWarns: 0,
        totalRequests: 0,
      });
      insertManyUsers([
        { 
          id: akhy.user.id, 
          username: akhy.user.username, 
          globalName: akhy.user.globalName, 
          warned: 0, 
          warns: 0, 
          allTimeWarns: 0, 
          totalRequests: 0
        },
      ]);
    });
  } catch (err) {
    console.error('Error while counting akhys:', err);
  }
  try {
    stmtSkins.run();

    const fetchedSkins = await getValorantSkins()
    const fetchedTiers = await getSkinTiers()

    fetchedSkins.forEach((skin) => {
      const chromas = []
      const levels = []
      skin.chromas.forEach((chroma) => {
        chromas.push({
          uuid: chroma.uuid,
          displayName: chroma.displayName,
          displayIcon: chroma.displayIcon,
          fullRender: chroma.fullRender,
          swatch: chroma.swatch,
          streamedVideo: chroma.streamedVideo,
        })
      })
      skin.levels.forEach((level) => {
        levels.push({
          uuid: level.uuid,
          displayName: level.displayName,
          displayIcon: level.displayIcon,
          streamedVideo: level.streamedVideo,
        })
      })
      skins.push({
        uuid: skin.uuid,
        displayName: skin.displayName,
        contentTierUuid: skin.contentTierUuid,
        displayIcon: skin.displayIcon,
        chromas: chromas,
        levels: levels,
      })
    })

    let newSkinCount = 0;
    let newSkinText = '';
    for (const skin of skins) {
      try {
        if (skin.contentTierUuid !== null) {
          const tierRank = () => {
            const tier = fetchedTiers.filter((tier) => { return tier.uuid === skin.contentTierUuid})[0]
            const rank = tier ? tier['rank'] : null;
            return rank ? rank + 1 : 0;
          }
          const tierColor = () => {
            const tier = fetchedTiers.filter((tier) => { return tier.uuid === skin.contentTierUuid})[0]
            return tier ? tier['highlightColor']?.slice(0, 6) : 'F2F3F3'
          }
          const tierText = () => {
            const tier = fetchedTiers.filter((tier) => { return tier.uuid === skin.contentTierUuid})[0]
            const rank = tier ? tier['rank'] : null;
            let res;
            if (rank === null) return 'Pas de tier';
            switch(rank) {
              case 0:
                res = '**<:select:1362964319498670222> Select**'
                break
              case 1:
                res = '**<:deluxe:1362964308094488797> Deluxe**'
                break
              case 2:
                res = '**<:premium:1362964330349330703> Premium**'
                break
              case 3:
                res = '**<:exclusive:1362964427556651098> Exclusive**'
                break
              case 4:
                res = '**<:ultra:1362964339685986314> Ultra**'
                break
              default:
                return 'Pas de tier'
            }
            res += skin.displayName.includes('VCT') ? ' | Esports Edition' : ''
            res += skin.displayName.toLowerCase().includes('champions') ? ' | Champions' : ''
            res += skin.displayName.toLowerCase().includes('arcane') ? ' | Arcane' : ''
            return res
          }
          const basePrice = () => {
            let res;
            if (skin.displayName.toLowerCase().includes('classic')){
              res = 150;
            } else if (skin.displayName.toLowerCase().includes('shorty')) {
              res = 300;
            } else if (skin.displayName.toLowerCase().includes('frenzy')) {
              res = 450;
            } else if (skin.displayName.toLowerCase().includes('ghost')) {
              res = 500;
            } else if (skin.displayName.toLowerCase().includes('sheriff')) {
              res = 800;
            } else if (skin.displayName.toLowerCase().includes('stinger')) {
              res = 1100;
            } else if (skin.displayName.toLowerCase().includes('spectre')) {
              res = 1600;
            } else if (skin.displayName.toLowerCase().includes('bucky')) {
              res = 850;
            } else if (skin.displayName.toLowerCase().includes('judge')) {
              res = 1850;
            } else if (skin.displayName.toLowerCase().includes('bulldog')) {
              res = 2050;
            } else if (skin.displayName.toLowerCase().includes('guardian')) {
              res = 2250;
            } else if (skin.displayName.toLowerCase().includes('phantom')) {
              res = 2900;
            } else if (skin.displayName.toLowerCase().includes('vandal')) {
              res = 2900;
            } else if (skin.displayName.toLowerCase().includes('marshal')) {
              res = 950;
            } else if (skin.displayName.toLowerCase().includes('outlaw')) {
              res = 2400;
            } else if (skin.displayName.toLowerCase().includes('operator')) {
              res = 4700;
            } else if (skin.displayName.toLowerCase().includes('ares')) {
              res = 1600;
            } else if (skin.displayName.toLowerCase().includes('odin')) {
              res = 3200;
            } else {
              res = 6000;
            }

            res *= (1 + (tierRank()))
            res *= skin.displayName.includes('VCT') ? 1.25 : 1;
            res *= skin.displayName.toLowerCase().includes('champions') ? 2 : 1;
            res *= skin.displayName.toLowerCase().includes('arcane') ? 1.5 : 1;
            res *= 1+(Math.random()/100) // [1 to 1.01]

            return (res/1111).toFixed(2);
          }

          const skinBasePrice = basePrice();

          const maxPrice = (price) => {
            let res = price

            res *= (1 + (skin.levels.length / Math.max(skin.levels.length, 2)))
            res *= (1 + (skin.chromas.length / 4))

            return res.toFixed(2);
          }

          await insertSkin.run(
              {
                uuid: skin.uuid,
                displayName: skin.displayName,
                contentTierUuid: skin.contentTierUuid,
                displayIcon: skin.displayIcon,
                user_id: null,
                tierRank: tierRank(),
                tierColor: tierColor(),
                tierText: tierText(),
                basePrice: skinBasePrice,
                currentLvl: null,
                currentChroma: null,
                currentPrice: null,
                maxPrice: maxPrice(skinBasePrice),
              });
          newSkinCount++;
          newSkinText += skin.displayName + ' | ';
        }
      } catch (e) {
       //
      }
    }
    console.log(`New skins : ${newSkinCount}`);
    if (newSkinCount <= 30 && newSkinCount > 0) console.log(newSkinText);
  } catch (e) {
    console.error('Error while fetching skins:', e);
  }
}

async function getOnlineUsersWithRole(guild_id=process.env.GUILD_ID, role_id=process.env.VOTING_ROLE_ID) {
  try {
    const guild = await client.guilds.fetch(guild_id);
    const members = await guild.members.fetch(); // Fetch all members

    const online = members.filter(m => !m.user.bot && m.presence?.status && m.roles.cache.has(role_id));
    return online
  } catch (err) {
    console.error('Error while counting online members:', err);
  }
}

// Login to Discord using bot token (optional)
client.login(process.env.BOT_TOKEN);

// Listen for message events
client.on('messageCreate', async (message) => {
  // Ignore messages from bots to avoid feedback loops
  if (message.author.bot) return;

  // hihihiha
  if (message.author.id === process.env.PATA_ID) {
    if (message.content.startsWith('feur')
        || message.content.startsWith('rati')) {
      await sleep(1000)
      await message.delete()
    }
  }

  // coins mecanich
  if (message.guildId === process.env.GUILD_ID) channelPointsHandler(message)

  if (message.content.toLowerCase().startsWith(`<@${process.env.APP_ID}>`) || message.mentions.repliedUser?.id === process.env.APP_ID) {
    let startTime = Date.now()
    console.log('-------------------------------')
    console.log('Request received : ' + startTime)
    let akhyAuthor = await getUser.get(message.author.id)

    const now = Date.now();
    const timestamps = requestTimestamps.get(message.author.id) || [];

    // Remove timestamps older than SPAM_INTERVAL seconds
    const updatedTimestamps = timestamps.filter(ts => now - ts < SPAM_INTERVAL);

    if (updatedTimestamps.length >= MAX_REQUESTS_PER_INTERVAL) {
      console.log(akhyAuthor.warned ? `${message.author.username} is restricted : ${updatedTimestamps}` : `Rate limit exceeded for ${message.author.username}`);
      if (!akhyAuthor.warned) {
        await message.reply(`T'abuses fréro, attends un peu ⏳`)
      } else if (akhyAuthor.warns === Math.max(1, process.env.MAX_WARNS - 3)) {
        await message.author.send("Attention si tu continues de spam tu vas te faire timeout 🤯")
      }
      await updateManyUsers([
        { 
          id: akhyAuthor.id, 
          username: akhyAuthor.username, 
          globalName: akhyAuthor.globalName, 
          warned: 1, // true
          warns: akhyAuthor.warns + 1, 
          allTimeWarns: akhyAuthor.allTimeWarns + 1, 
          totalRequests: akhyAuthor.totalRequests
        },
      ])
      akhyAuthor = await getUser.get(akhyAuthor.id)
      if (akhyAuthor.warns > process.env.MAX_WARNS ?? 10) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const time = parseInt(process.env.SPAM_TIMEOUT_TIME)
        try {
          await guild.members.edit(akhyAuthor.id, {
            communication_disabled_until: new Date(Date.now() + time).toISOString(),
            reason: 'Dose le spam fdp',
          });
        } catch (e) {
          console.log('Tried timeout for AI spam : ', e)
          message.channel.send(`<@${akhyAuthor.id}> tu me fais chier !! T'as de la chance que je puisse pas te timeout 🔪`)
            .catch(console.error);
          return
        }
        message.channel.send(`Ce bouffon de <@${akhyAuthor.id}> a été timeout pendant ${formatTime(time/1000)}, il me cassait les couilles 🤫`)
          .catch(console.error);
        return
      }
      return;
    }
    

    // Track this new usage
    updatedTimestamps.push(now);
    requestTimestamps.set(akhyAuthor.id, updatedTimestamps);
    await updateManyUsers([
      { 
        id: akhyAuthor.id, 
        username: akhyAuthor.username, 
        globalName: akhyAuthor.globalName, 
        warned: 0, // false
        warns: 0,  // reset 
        allTimeWarns: akhyAuthor.allTimeWarns, 
        totalRequests: akhyAuthor.totalRequests + 1
      },
    ])
    akhyAuthor = await getUser.get(akhyAuthor.id)

    try {
      // Fetch last messages from the channel
      const fetched = await message.channel.messages.fetch({ limit: 100 });
      const messagesArray = Array.from(fetched.values()).reverse(); // oldest to newest
      console.log('after Discord fetch : ' + startTime + ', ' + (Date.now() - startTime))

      const requestMessage = message.content.replace(`<@${process.env.APP_ID}>`, '')

      // Map to OpenAI/Gemini format
      console.log(process.env.MODEL)
      const allAkhys = await getAllUsers.all()
      let allAkhysText = ''
      allAkhys.forEach(akhy => {
        allAkhysText += `<@${akhy.id}> alias ${akhy.globalName}, `
      })
      let convo = 'Voici les derniers messages de la conversation pour contexte (du plus vieux au plus récent) :\n'
      messagesArray.forEach(msg => {
        convo += `<@${msg.author.id}> a dit : ${msg.content}.\n`
      })
      let formatted = [];
      if (process.env.MODEL === 'OpenAI' || process.env.MODEL === 'Gemini') {
          formatted.push({
            role: 'developer',
            content: `${convo}`,
          });
          formatted.push({
            role: 'developer',
            content: `Voici la liste des différents utilisateurs présents : ${allAkhysText}`,
          })
          formatted.push({
            role: 'developer',
            content: `Voici une liste de quelques emojis que tu peux utiliser sur le serveur: <:CAUGHT:1323810730155446322> quand tu te fais prendre la main dans le sac ou que tu a un avis divergent ou risqué, <:hinhinhin:1072510144933531758> pour le rire ou quand tu es moqueur, <:o7:1290773422451986533> pour payer respect ou remercier ou dire au revoir, <:zhok:1115221772623683686> pour quand quelquechose manque de sens, <:nice:1154049521110765759> pour quelquechose de bien, <:nerd~1:1087658195603951666> pour une explication technique ou une attitude nerd, <:peepSelfie:1072508131839594597> pour à peu près n\'importe quelle situation quand tu es blazé`
          })

          formatted.push(
              {
                role: "developer",
                content: "Adopte une attitude détendue et répond comme si tu participais à la conversation, pas trop long, pas de retour à la ligne, simple et utilise les emojis du serveur. N'hésites pas à utiliser des abréviations mais sans en abuser."
              },
              {
                role: 'developer',
                content: message.mentions.repliedUser?.id ? `La phrase de l'utilisateur répond à un message de ${message.mentions.repliedUser?.id === process.env.APP_ID ? 'toi-même' : message.mentions.repliedUser?.id}` : '',
              },
              {
                role: "developer",
                content: `Ton id est : <@${process.env.APP_ID}>, évite de l'utiliser. Ton username et global_name sont : ${process.env.APP_NAME}`
              },
              {
                role: "developer",
                content: `L'utilisateur qui s'adresse a toi est : <@${akhyAuthor.id}>`
              },
              {
                role: "user",
                content: requestMessage.length > 1 ? requestMessage : 'Salut',
              });
      }
      else if (process.env.MODEL === 'Mistral') {
        // Map to Mistral format
        formatted.push({
          role: 'system',
          content: `${convo}`,
        });

        formatted.push({
          role: 'system',
          content: `Voici la liste des différents utilisateurs présents : ${allAkhysText}`,
        });

        formatted.push(
            {
              role: "system",
              content: "Adopte une attitude détendue et répond comme si tu participais à la conversation, pas trop long, pas de retour à la ligne, simple. N'hésites pas à utiliser des abréviations mais sans en abuser."
            },
            {
              role: 'system',
              content: message.mentions.repliedUser?.id ? `La phrase de l'utilisateur répond à un message de ${message.mentions.repliedUser?.id === process.env.APP_ID ? 'toi-même' : message.mentions.repliedUser?.id}` : '',
            },

            {
              role: "system",
              content: `Ton id est : <@${process.env.APP_ID}>, évite de l'utiliser. Ton username et global_name sont : ${process.env.APP_NAME}`
            },
            {
              role: "system",
              content: `L'utilisateur qui s'adresse a toi est : <@${akhyAuthor.id}>`
            },
            {
              role: "user",
              content: requestMessage.length > 1 ? requestMessage : 'Salut',
            });
      }

      // await gork(formatted); IA en marche
      const reply = await gork(formatted);

      console.log('after AI fetch : ' + startTime + ', ' + (Date.now() - startTime))
    
      // Send response to the channel
      await message.reply(reply);
    } catch (err) {
      console.error("Error fetching or sending messages:", err);
      await message.reply("Oups, y'a eu un problème!");
    }
  }
  else if (message.content.toLowerCase().includes("quoi")) {
    let prob = Math.random()
    console.log(`feur ${prob}`)
    if (prob < process.env.FEUR_PROB) {
      // Send a message "feur" to the same channel
      message.channel.send(`feur`)
          .catch(console.error);
    }
  }
  else if (message.guildId === process.env.DEV_GUILD_ID) {
    // ADMIN COMMANDS
    if (message.content.toLowerCase().startsWith('?u')) {
      console.log(await getAPOUsers())
    }
    else if (message.content.toLowerCase().startsWith('?b')) {
      const amount = message.content.replace('?b ', '')
      console.log(amount)
      console.log(await postAPOBuy('650338922874011648', amount))
    }
    else if (message.content.toLowerCase().startsWith('?v')) {
      console.log('active polls :')
      console.log(activePolls)
    }
    else if (message.author.id === process.env.DEV_ID) {
      if (message.content === 'flopo:add-coins-to-users') {
        console.log(message.author.id)
        try {
          const stmtUpdateUsers = flopoDB.prepare(`
            ALTER TABLE users
              ADD coins INTEGER DEFAULT 0
          `);
          stmtUpdateUsers.run()
        } catch (e) {
          console.log(e)
        }
      }
      else if (message.content === 'flopo:users') {
        const allAkhys = getAllUsers.all()
        console.log(allAkhys)
      }
      else if (message.content === 'flopo:cancel') {
        await message.delete()
      }
      else if (message.content.startsWith('flopo:reset-user-coins')) {
        const userId = message.content.replace('flopo:reset-user-coins ', '')
        const authorDB = getUser.get(userId)
        if (authorDB) {
          updateUserCoins.run({
            id: userId,
            coins: 0,
          })
          console.log(`${authorDB.username}'s coins were reset to 0`)
        } else {
          console.log('invalid user')
        }
      }
      else if (message.content.startsWith('flopo:send-message')) {
        const msg = message.content.replace('flopo:send-message ', '')
        await fetch(process.env.BASE_URL + '/send-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channelId: '1368908514545631262',
            message: msg,
          })
        });
      }
    }
  }
});

// Once bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const randomMinute = Math.floor(Math.random() * 60);
  const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
  todaysHydrateCron = `${randomMinute} ${randomHour} * * *`
  console.log(todaysHydrateCron)
  await getAkhys();
  console.log('Ready')

  // every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    const FIVE_MINUTES = 5 * 60 * 1000;

    // clean 5 minutes old inventories
    for (const id in activeInventories) {
      const inventory = activeInventories[id];
      if (Date.now() >= inventory.timestamp + FIVE_MINUTES) {
        console.log(`Removing expired inventory : ${id}`);
        delete activeInventories[id];
      }
    }
    for (const id in activeSearchs) {
      const search = activeSearchs[id];
      if (Date.now() >= search.timestamp + FIVE_MINUTES) {
        console.log(`Removing expired searchs : ${id}`);
        delete activeSearchs[id];
      }
    }
  });

  // ─── 💀 Midnight Chaos Timer ──────────────────────
  cron.schedule(process.env.CRON_EXPR, async () => {
    const randomMinute = Math.floor(Math.random() * 60);
    const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
    todaysHydrateCron = `${randomMinute} ${randomHour} * * *`
    console.log(todaysHydrateCron)

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
    const members = await getOnlineUsersWithRole(process.env.GUILD_ID, roleId);

    const prob = Math.random();
    if (members.size === 0 || prob > process.env.CHAOS_PROB) {
      console.log(`No roulette tonight ${prob}`)
      return
    }

    const randomMember = members[Math.floor(Math.random() * members.size)];

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
            `${getRandomHydrateText()} ${getRandomEmoji(1)}`
        );
      }

      console.log(`Message hydratation`);
    } catch (err) {
      console.error('Message hydratation:', err);
    }
  });

  // users/skins dayly fetch at 7am
  cron.schedule('0 7 * * *', async() => {
    // fetch eventual new users/skins
    await getAkhys();
    console.log('Users and skins fetched')
  })
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

    // 'timeout' command
    if (name === 'timeout') {
      // Interaction context
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      // User's choices
      const akhy = req.body.data.options[0].value;
      const time = req.body.data.options[1].value;

      const guild = await client.guilds.fetch(req.body.guild_id);
      const fromMember = await guild.members.fetch(userId);
      const toMember = await guild.members.fetch(akhy);

      const already = Object.values(activePolls).find(poll => poll.toUsername === toMember.user);

      if (already) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Impossible de timeout **${toMember.user}** car un vote est déjà en cours`,
            flags: InteractionResponseFlags.EPHEMERAL,
          }
        });
      }

      if (toMember.communicationDisabledUntilTimestamp > Date.now()) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `**${toMember.user}** est déjà timeout`,
            flags: InteractionResponseFlags.EPHEMERAL,
          }
        });
      }

      // Save the poll information along with channel ID so we can notify later
      activePolls[id] = {
        id: userId,
        username: fromMember.user,
        toUserId: akhy,
        toUsername: toMember.user,
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
      const requiredMajority = Math.max(parseInt(process.env.MIN_VOTES), Math.floor(onlineEligibleUsers.size / 2) + 1);
      const votesNeeded = Math.max(0, requiredMajority - activePolls[id].for);

      activePolls[id].endTime = Date.now() + process.env.POLL_TIME * 1000;
      activePolls[id].requiredMajority = requiredMajority;

// Set an interval to update the countdown every 10 seconds (or more often if you want)
      const countdownInterval = setInterval(async () => {
        const poll = activePolls[id];

        if (!poll) {
          clearInterval(countdownInterval);
          return;
        }

        const remaining = Math.max(0, Math.floor((poll?.endTime - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const countdownText = `**${minutes}m ${seconds}s** restantes`;
        const votesNeeded = Math.max(0, activePolls[id].requiredMajority - activePolls[id].for);

        if (!poll || remaining === 0) {
          try {
            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    embeds: [
                      {
                        title: `Le vote pour timeout ${poll.toUsername.username} pendant ${poll.time_display} a échoué 😔`,
                        description: `Il manquait **${votesNeeded}** vote(s)`,
                        fields: [
                            {
                                name: 'Pour',
                                value: '✅ ' + poll.for,
                                inline: true,
                            },
                            {
                                name: 'Temps restant',
                                value: '⏳ ' + countdownText,
                                inline: false,
                            },
                        ],
                        color: 0xF2F3F3, // You can set the color of the embed
                      },
                    ],
                    components: [],
                  },
                }
            );
          } catch (err) {
            console.error('Error sending message', err);
          }
          console.log('clear poll')
          clearInterval(countdownInterval);
          delete activePolls[id];
          return;
        }

        try {
          await DiscordRequest(
              poll.endpoint,
              {
                method: 'PATCH',
                body: {
                  embeds: [
                    {
                      title: `Timeout`,
                      description: `**${poll.username}** propose de timeout **${poll.toUsername}** pendant ${poll.time_display}\nIl manque **${votesNeeded}** vote(s)`,
                      fields: [
                          {
                              name: 'Pour',
                              value: '✅ ' + poll.for,
                              inline: true,
                          },
                          {
                              name: 'Temps restant',
                              value: '⏳ ' + countdownText,
                              inline: false,
                          },
                      ],
                      color: 0xF2F3F3, // You can set the color of the embed
                    },
                  ],
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
          embeds: [
            {
              title: `Timeout`,
              description: `**${activePolls[id].username}** propose de timeout **${activePolls[id].toUsername}** pendant ${activePolls[id].time_display}\nIl manque **${votesNeeded}** vote(s)`,
              fields: [
                  {
                      name: 'Pour',
                      value: '✅ ' + activePolls[id].for,
                      inline: true,
                  },
                  {
                      name: 'Temps restant',
                      value: '⏳ ' + countdownText,
                      inline: false,
                  },
              ],
              color: 0xF2F3F3, // You can set the color of the embed
            },
          ],
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

    if (name === 'inventory') {
      // Interaction context
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      // User's choices
      const akhy = req.body.data.options ? req.body.data.options[0].value : userId;

      const guild = await client.guilds.fetch(req.body.guild_id);
      const completeAkhy = await guild.members.fetch(akhy);

      const invSkins = getUserInventory.all({user_id: akhy});

      const chromaText = (skin) => {
        let res = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          res += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return res
      }
      const chromaName = (skin) => {
        if (skin.currentChroma >= 2) {
          const name = skins.find((s) => s.uuid === skin.uuid).chromas[skin.currentChroma-1].displayName.replace(/[\r\n]+/g, '').replace(skin.displayName, '')
          const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
          const result = match ? match[2] : null;
          if (match) {
            return match[1].trim()
          } else {
            return name
          }
        }
        if (skin.currentChroma === 1) {
          return 'Base'
        }
        return ''
      };
      let content = '';
      let totalPrice = 0;
      let fields = [];
      invSkins.forEach(skin => {
        content += `- ${skin.displayName} | ${skin.currentPrice.toFixed()}€ \n`;
        totalPrice += skin.currentPrice;
        fields.push({
          name: `${skin.displayName} | ${skin.currentPrice.toFixed(2)}€`,
          value: `${skin.tierText}\nChroma : ${chromaText(skin)} | ${chromaName(skin)}\nLvl : **${skin.currentLvl}**/${skins.find((s) => s.uuid === skin.uuid).levels.length}\n`,
          inline: false,
        })
      })

      activeInventories[id] = {
        akhyId: akhy,
        userId: userId,
        page: 0,
        amount: invSkins.length,
        reqBodyId: req.body.id,
        endpoint: `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
        timestamp: Date.now(),
      };

      console.log(activeInventories[id].reqBodyId);

      if (invSkins.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [
              {
                title: `Inventaire de ${completeAkhy.user.username}`,
                description: "Aucun skin dans l'inventaire",
                color: 0xF2F3F3,
                footer: {text: `Total : ${totalPrice.toFixed(2)}€`},
              },
            ],
          },
        });
      }
      const trueSkin = skins.find((s) => s.uuid === invSkins[0].uuid);

      const imageUrl = () => {
        let res;
        if (invSkins[0].currentLvl === trueSkin.levels.length) {
          if (invSkins[0].currentChroma === 1) {
            res = trueSkin.chromas[0].displayIcon

          } else {
            res = trueSkin.chromas[invSkins[0].currentChroma-1].fullRender ?? trueSkin.chromas[invSkins[0].currentChroma-1].displayIcon
          }
        } else if (invSkins[0].currentLvl === 1) {
          res = trueSkin.levels[0].displayIcon ?? trueSkin.chromas[0].fullRender
        } else if (invSkins[0].currentLvl === 2 || invSkins[0].currentLvl === 3) {
          res = trueSkin.displayIcon
        }
        if (res) return res;
        return trueSkin.displayIcon
      };

      let components = [
            {
              type: MessageComponentTypes.BUTTON,
              custom_id: `prev_page_${req.body.id}`,
              label: '⏮️ Préc.',
              style: ButtonStyleTypes.SECONDARY,
            },
            {
              type: MessageComponentTypes.BUTTON,
              custom_id: `next_page_${req.body.id}`,
              label: 'Suiv. ⏭️',
              style: ButtonStyleTypes.SECONDARY,
            },
          ]

      if ((invSkins[0].currentLvl < trueSkin.levels.length || invSkins[0].currentChroma < trueSkin.chromas.length) && akhy === userId) {
          components.push({
            type: MessageComponentTypes.BUTTON,
            custom_id: `upgrade_${req.body.id}`,
            label: `Upgrade ⏫`,
            style: ButtonStyleTypes.PRIMARY,
          })
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: `Inventaire de ${completeAkhy.user.username}`,
              description: `${invSkins?.length > 0 ? '' : "Aucun skin dans l'inventaire"}`,
              color: 0xF2F3F3,
              footer: {text: `${activeInventories[id].page+1}/${invSkins?.length} | Total : ${totalPrice.toFixed(2)}€`},
              fields: [fields[activeInventories[id].page]],
              image: {
                url: invSkins?.length > 0 ? imageUrl() : '',
              }
            },
          ],
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: components,
            },
          ],
        },
      });
    }

    if (name === 'valorant') {
      const buyResponse = await postAPOBuy(req.body.member.user.id, process.env.VALO_PRICE ?? 150)

      if (buyResponse.status === 500 || buyResponse.ok === false) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'as pas assez d'argent...`,
            flags: InteractionResponseFlags.EPHEMERAL,
          }
        });
      }

      // First, send the initial response immediately
      const initialEmbed = new EmbedBuilder()
          .setTitle(`\t`)
          .setImage('https://media.tenor.com/gIWab6ojBnYAAAAd/weapon-line-up-valorant.gif')
          .setColor(`#F2F3F3`);

      // Send the initial response and store the reply object
      await res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [initialEmbed] }
      });

      // Get a random skin
      const dbSkins = getAllAvailableSkins.all();
      const randomIndex = Math.floor(Math.random() * dbSkins.length);
      let randomSkin;

      try {
        randomSkin = skins.find((skin) => skin.uuid === dbSkins[randomIndex].uuid);
        if (!randomSkin) throw new Error("Skin not found");
      } catch (e) {
        // Edit the original message if there's an error
        await DiscordRequest(
            `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
            {
              method: 'PATCH',
              body: {
                content: "Oups, ya eu un ptit problème",
                embeds: []
              }
            }
        );
        return;
      }

      // Generate random level and chroma
      const randomLevel = Math.floor(Math.random() * randomSkin.levels.length + 1);
      let randomChroma = randomLevel === randomSkin.levels.length
          ? Math.floor(Math.random() * randomSkin.chromas.length + 1)
          : 1;
      if (randomChroma === randomSkin.chromas.length && randomSkin.chromas.length >= 2) randomChroma--
      const selectedLevel = randomSkin.levels[randomLevel - 1]
      const selectedChroma = randomSkin.chromas[randomChroma - 1]

      // console.log(randomSkin.chromas)
      // console.log(randomIndex)

      // Set timeout for the reveal
      setTimeout(async () => {
        // Prepare the final embed
        const selectedLevel = randomSkin.levels[randomLevel - 1];
        const selectedChroma = randomSkin.chromas[randomChroma - 1];

        // Helper functions (unchanged from your original code)
        const videoUrl = () => {
          let res;
          if (randomLevel === randomSkin.levels.length) {
            if (randomChroma === 1) {
              res = randomSkin.levels[randomSkin.levels.length - 1].streamedVideo ?? randomSkin.chromas[0].streamedVideo
            } else {
              res = randomSkin.chromas[randomChroma-1].streamedVideo
            }
          } else {
            res = randomSkin.levels[randomLevel-1].streamedVideo
          }
          return res;
        };
        const imageUrl = () => {
          let res;
          if (randomLevel === randomSkin.levels.length) {
            if (randomChroma === 1) {
              res = randomSkin.chromas[0].displayIcon

            } else {
              res = randomSkin.chromas[randomChroma-1].fullRender ?? randomSkin.chromas[randomChroma-1].displayIcon
            }
          } else if (randomLevel === 1) {
            res = randomSkin.levels[0].displayIcon ?? randomSkin.chromas[0].fullRender
          } else if (randomLevel === 2 || randomLevel === 3) {
            res = randomSkin.displayIcon
          }
          if (res) return res;
          console.log('default')
          return randomSkin.displayIcon
        };
        const chromaName = () => {
          if (randomChroma >= 2) {
            const name = selectedChroma.displayName.replace(/[\r\n]+/g, '').replace(randomSkin.displayName, '')
            const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
            const result = match ? match[2] : null;
            if (match) {
              return match[1].trim()
            } else {
              return name
            }
          }
          if (randomChroma === 1) {
            return 'Base'
          }
          return ''
        };
        const lvlText = () => {
          let res = ""
          if (randomLevel >= 1) {
            res += '1️⃣ '
          }
          if (randomLevel >= 2) {
            res += '2️⃣ '
          }
          if (randomLevel >= 3) {
            res += '3️⃣ '
          }
          if (randomLevel >= 4) {
            res += '4️⃣ '
          }
          if (randomLevel >= 5) {
            res += '5️⃣ '
          }
          for (let i = 0; i < randomSkin.levels.length - randomLevel; i++) {
            res += '◾ '
          }
          return res
        }
        const chromaText = () => {
          let res = ""
          for (let i = 1; i <= randomSkin.chromas.length; i++) {
            res += randomChroma === i ? '💠 ' : '◾ '
          }
          return res
        }
        const price = () => {
          let res = dbSkins[randomIndex].basePrice;

          res *= (1 + (randomLevel / Math.max(randomSkin.levels.length, 2)))
          res *= (1 + (randomChroma / 4))

          return res.toFixed(2);
        }

        // Update the database
        try {
          await updateSkin.run({
            uuid: randomSkin.uuid,
            user_id: req.body.member.user.id,
            currentLvl: randomLevel,
            currentChroma: randomChroma,
            currentPrice: price()
          });
        } catch (e) {
          console.log('Database error', e);
        }

        // Build the final embed
        const finalEmbed = new EmbedBuilder()
            .setTitle(`${randomSkin.displayName} | ${chromaName()}`)
            .setFields([
              { name: '', value: `**Lvl** | ${lvlText()}`, inline: true },
              { name: '', value: `**Chroma** | ${chromaText()}`, inline: true },
              { name: '', value: `**Prix** | ${price()} <:vp:1362964205808128122>`, inline: true },
            ])
            .setDescription(dbSkins[randomIndex].tierText)
            .setImage(imageUrl())
            .setFooter({ text: 'Ajouté à ton inventaire' })
            .setColor(`#${dbSkins[randomIndex].tierColor}`);

        // Prepare components if video exists
        const video = videoUrl();
        const components = [];

        if (video) {
          components.push(
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setLabel('🎬 Aperçu vidéo')
                      .setStyle(ButtonStyle.Link)
                      .setURL(video)
              )
          );
        }

        // Edit the original message
        try {
          await DiscordRequest(
              `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
              {
                method: 'PATCH',
                body: {
                  embeds: [finalEmbed],
                  components: components
                }
              }
          );
        } catch (err) {
          console.error('Error editing message:', err);
        }
      }, 5000);

      return;
    }

    if (name === 'info') {
      const guild = await client.guilds.fetch(req.body.guild_id);

      await guild.members.fetch()

      const timedOutMembers = guild.members.cache.filter(
          (member) =>
              member.communicationDisabledUntil &&
              member.communicationDisabledUntil > new Date()
      );

      if (timedOutMembers.size === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [
              {
                title: `Membres timeout`,
                description: "Aucun membre n'est actuellement timeout.",
                color: 0xF2F3F3,
              },
            ],
          },
        });
      }

      const list = timedOutMembers.map(
          (member) =>
              `**${member.user.tag}** (jusqu'à ${member.communicationDisabledUntil.toLocaleString()})`
      ).join("\n");

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: `Membres timeout`,
              description: `${list}`,
              color: 0xF2F3F3,
            },
          ],
        },
      });
    }

    if (name === 'skins') {
      const topSkins = getTopSkins.all()
      const guild = await client.guilds.fetch(req.body.guild_id)

      let fields = []

      for (const skin of topSkins) {
        const index = topSkins.indexOf(skin);
        const owner = skin.user_id ? await guild.members.fetch(skin.user_id) : null;
        fields.push({
          name: `#${index+1} - **${skin.displayName}**`,
          value: `${skin.maxPrice}€ ${skin.user_id ? '| **@'+ owner.user.username+'** ✅' : ''}\n`,
          inline: false
        });
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              fields: fields,
              color: 0xF2F3F3,
            },
          ],
        },
      });
    }

    if (name === 'search') {
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      const searchValue = req.body.data.options[0].value.toLowerCase();

      const guild = await client.guilds.fetch(req.body.guild_id);

      let dbSkins = getAllSkins.all()

      let resultSkins = dbSkins.filter((skin) => {
        return skin.displayName.toLowerCase().includes(searchValue) || skin.tierText.toLowerCase().includes(searchValue);
      })

      if (resultSkins.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Aucun résultat ne correspond à ta recherche',
            flags: InteractionResponseFlags.EPHEMERAL,
          }
        })
      }

      const owner = await guild.members.fetch(resultSkins[0].user_id)
      let fields = [
        {
          name: `**${resultSkins[0].displayName}** | ${resultSkins[0].tierText}`,
          value: `${resultSkins[0].maxPrice}€ ${resultSkins[0].user_id ? '| **@'+ owner.user.username +'** ✅' : ''}`,
          inline: false,
        }
      ]

      activeSearchs[id] = {
        userId: userId,
        page: 0,
        amount: resultSkins.length,
        resultSkins: resultSkins,
        endpoint: `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
        timestamp: Date.now(),
        searchValue: searchValue,
      };

      const trueSkin = skins.find((s) => s.uuid === resultSkins[0].uuid);
      const imageUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].displayIcon) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].displayIcon
        } else if (trueSkin.levels[trueSkin.levels.length-1].displayIcon) {
          res = trueSkin.levels[trueSkin.levels.length-1].displayIcon
        } else {
          res = trueSkin.displayIcon
        }
        return res
      };

      const videoUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo
        } else if (trueSkin.levels[trueSkin.levels.length-1].streamedVideo) {
          res = trueSkin.levels[trueSkin.levels.length-1].streamedVideo
        } else {
          res = null
        }
        return res
      };

      const originalComponents = [
        {
          type: MessageComponentTypes.BUTTON,
          custom_id: `prev_search_page_${req.body.id}`,
          label: '⏮️ Préc.',
          style: ButtonStyleTypes.SECONDARY,
        },
        {
          type: MessageComponentTypes.BUTTON,
          custom_id: `next_search_page_${req.body.id}`,
          label: 'Suiv. ⏭️',
          style: ButtonStyleTypes.SECONDARY,
        },
      ];

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: `Résultat de recherche`,
              description: `🔎 ${searchValue}`,
              fields: fields,
              color: parseInt(resultSkins[0].tierColor, 16),
              image: { url: imageUrl() },
              footer: { text: `1/${resultSkins.length} résultat(s)` },
            },
          ],
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: originalComponents,
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
        const votesNeeded = Math.max(0, poll.requiredMajority - poll.for);

        // Check if the majority is reached
        if (poll.for >= poll.requiredMajority) {
          try {
            // Build the updated poll message content
            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    embeds: [
                      {
                        title: `Timeout`,
                        description: `Proposition de timeout **${poll.toUsername}** pendant ${poll.time_display}`,
                        fields: [
                            {
                                name: 'Votes totaux',
                                value: '✅ ' + poll.for,
                                inline: true,
                            },
                        ],
                        color: 0xF2F3F3, // You can set the color of the embed
                      },
                    ],
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

            await DiscordRequest(
                poll.endpoint,
                {
                  method: 'PATCH',
                  body: {
                    embeds: [
                      {
                        title: `Timeout`,
                        description: `**${poll.username}** propose de timeout **${poll.toUsername}** pendant ${poll.time_display}\nIl manque **${votesNeeded}** vote(s)`,
                        fields: [
                            {
                                name: 'Pour',
                                value: '✅ ' + poll.for,
                                inline: true,
                            },
                            {
                                name: 'Temps restant',
                                value: '⏳ ' + countdownText,
                                inline: false,
                            },
                        ],
                        color: 0xF2F3F3, // You can set the color of the embed
                      },
                    ],
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
    else if (componentId.startsWith('prev_page')) {
      let invId = componentId.replace('prev_page_', '');
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      const guild = await client.guilds.fetch(req.body.guild_id);
      if (!activeInventories[invId]) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Oups, cet affichage n'est plus actif.\nRelance la commande pour avoir un nouvel élément intéractif`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const completeAkhy = await guild.members.fetch(activeInventories[invId].akhyId);

      const invSkins = getUserInventory.all({user_id: activeInventories[invId].akhyId});

      const chromaText = (skin) => {
        let res = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          res += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return res
      }
      const chromaName = (skin) => {
        if (skin.currentChroma >= 2) {
          const name = skins.find((s) => s.uuid === skin.uuid).chromas[skin.currentChroma-1].displayName.replace(/[\r\n]+/g, '').replace(skin.displayName, '')
          const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
          const result = match ? match[2] : null;
          if (match) {
            return match[1].trim()
          } else {
            return name
          }
        }
        if (skin.currentChroma === 1) {
          return 'Base'
        }
        return ''
      };
      let content = '';
      let totalPrice = 0;
      let fields = [];
      invSkins.forEach(skin => {
        content += `- ${skin.displayName} | ${skin.currentPrice.toFixed()}€ \n`;
        totalPrice += skin.currentPrice;
        fields.push({
          name: `${skin.displayName} | ${skin.currentPrice.toFixed(2)}€`,
          value: `${skin.tierText}\nChroma : ${chromaText(skin)} | ${chromaName(skin)}\nLvl : **${skin.currentLvl}**/${skins.find((s) => s.uuid === skin.uuid).levels.length}\n`,
          inline: false,
        })
      })

      if (activeInventories[invId] && activeInventories[invId].userId === req.body.member.user.id) {
        if (activeInventories[invId].page === 0) {
          activeInventories[invId].page = activeInventories[invId].amount-1
        } else {
          activeInventories[invId].page--
        }
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'est pas à l'origine de cette commande /inventory`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const trueSkin = skins.find((s) => s.uuid === invSkins[activeInventories[invId].page].uuid);
      const imageUrl = () => {
        let res;
        if (invSkins[activeInventories[invId].page].currentLvl === trueSkin.levels.length) {
          if (invSkins[activeInventories[invId].page].currentChroma === 1) {
            res = trueSkin.chromas[0].displayIcon

          } else {
            res = trueSkin.chromas[invSkins[activeInventories[invId].page].currentChroma-1].fullRender ?? trueSkin.chromas[invSkins[activeInventories[invId].page].currentChroma-1].displayIcon
          }
        } else if (invSkins[activeInventories[invId].page].currentLvl === 1) {
          res = trueSkin.levels[0].displayIcon ?? trueSkin.chromas[0].fullRender
        } else if (invSkins[activeInventories[invId].page].currentLvl === 2 || invSkins[activeInventories[invId].page].currentLvl === 3) {
          res = trueSkin.displayIcon
        }
        if (res) return res;
        return trueSkin.displayIcon
      };

      let components = req.body.message.components;

      if ((invSkins[activeInventories[invId].page].currentLvl < trueSkin.levels.length || invSkins[activeInventories[invId].page].currentChroma < trueSkin.chromas.length) && activeInventories[invId].akhyId === activeInventories[invId].userId) {
        if (components[0].components.length === 2) {
          components[0].components.push({
            type: MessageComponentTypes.BUTTON,
            custom_id: `upgrade_${activeInventories[invId].reqBodyId}`,
            label: `Upgrade ⏫`,
            style: ButtonStyleTypes.PRIMARY,
          })
        }
      } else {
        if (components[0].components.length === 3) {
          components[0].components.pop()
        }
      }

      try {
        await DiscordRequest(
            activeInventories[invId].endpoint,
            {
              method: 'PATCH',
              body: {
                embeds: [
                  {
                    title: `Inventaire de ${completeAkhy.user.username}`,
                    description: `${invSkins?.length > 0 ? '' : "Aucun skin dans l'inventaire"}`,
                    color: 0xF2F3F3,
                    footer: {text: `${activeInventories[invId].page+1}/${invSkins?.length} | Total : ${totalPrice.toFixed(2)}€`},
                    fields: [fields[activeInventories[invId].page]],
                    image: {
                      url: invSkins?.length > 0 ? imageUrl() : '',
                    }
                  },
                ],
                components: components,
              },
            }
        );
      } catch (err) {
        console.log('Pas trouvé : ', err)
      }
      return res.send({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
    }
    else if (componentId.startsWith('next_page')) {
      let invId = componentId.replace('next_page_', '');
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      const guild = await client.guilds.fetch(req.body.guild_id);
      if (!activeInventories[invId]) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Oups, cet inventaire n'est plus actif.\nRelance la commande pour avoir un nouvel inventaire interactif`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
      const completeAkhy = await guild.members.fetch(activeInventories[invId].akhyId);

      const invSkins = getUserInventory.all({user_id: activeInventories[invId].akhyId});

      const chromaText = (skin) => {
        let res = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          res += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return res
      }
      const chromaName = (skin) => {
        if (skin.currentChroma >= 2) {
          const name = skins.find((s) => s.uuid === skin.uuid).chromas[skin.currentChroma-1].displayName.replace(/[\r\n]+/g, '').replace(skin.displayName, '')
          const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
          const result = match ? match[2] : null;
          if (match) {
            return match[1].trim()
          } else {
            return name
          }
        }
        if (skin.currentChroma === 1) {
          return 'Base'
        }
        return ''
      };
      let content = '';
      let totalPrice = 0;
      let fields = [];
      invSkins.forEach(skin => {
        content += `- ${skin.displayName} | ${skin.currentPrice.toFixed()}€ \n`;
        totalPrice += skin.currentPrice;
        fields.push({
          name: `${skin.displayName} | ${skin.currentPrice.toFixed(2)}€`,
          value: `${skin.tierText}\nChroma : ${chromaText(skin)} | ${chromaName(skin)}\nLvl : **${skin.currentLvl}**/${skins.find((s) => s.uuid === skin.uuid).levels.length}\n`,
          inline: false,
        })
      })

      if (activeInventories[invId] && activeInventories[invId].userId === req.body.member.user.id) {
        if (activeInventories[invId].page === activeInventories[invId].amount-1) {
          activeInventories[invId].page = 0
        } else {
          activeInventories[invId].page++
        }
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'est pas à l'origine de cette commande /inventory`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const trueSkin = skins.find((s) => s.uuid === invSkins[activeInventories[invId].page].uuid);
      const imageUrl = () => {
        let res;
        if (invSkins[activeInventories[invId].page].currentLvl === trueSkin.levels.length) {
          if (invSkins[activeInventories[invId].page].currentChroma === 1) {
            res = trueSkin.chromas[0].displayIcon

          } else {
            res = trueSkin.chromas[invSkins[activeInventories[invId].page].currentChroma-1].fullRender ?? trueSkin.chromas[invSkins[activeInventories[invId].page].currentChroma-1].displayIcon
          }
        } else if (invSkins[activeInventories[invId].page].currentLvl === 1) {
          res = trueSkin.levels[0].displayIcon ?? trueSkin.chromas[0].fullRender
        } else if (invSkins[activeInventories[invId].page].currentLvl === 2 || invSkins[activeInventories[invId].page].currentLvl === 3) {
          res = trueSkin.displayIcon
        }
        if (res) return res;
        return trueSkin.displayIcon
      };

      let components = req.body.message.components;

      if ((invSkins[activeInventories[invId].page].currentLvl < trueSkin.levels.length || invSkins[activeInventories[invId].page].currentChroma < trueSkin.chromas.length) && activeInventories[invId].akhyId === activeInventories[invId].userId) {
        if (components[0].components.length === 2) {
          components[0].components.push({
            type: MessageComponentTypes.BUTTON,
            custom_id: `upgrade_${activeInventories[invId].reqBodyId}`,
            label: `Upgrade ⏫`,
            style: ButtonStyleTypes.PRIMARY,
          })
        }
      } else {
        if (components[0].components.length === 3) {
          components[0].components.pop()
        }
      }

      try {
        await DiscordRequest(
            activeInventories[invId].endpoint,
            {
              method: 'PATCH',
              body: {
                embeds: [
                  {
                    title: `Inventaire de ${completeAkhy.user.username}`,
                    description: `${invSkins?.length > 0 ? '' : "Aucun skin dans l'inventaire"}`,
                    color: 0xF2F3F3,
                    footer: {text: `${activeInventories[invId].page+1}/${invSkins?.length} | Total : ${totalPrice.toFixed(2)}€`},
                    fields: [fields[activeInventories[invId].page]],
                    image: {
                      url: invSkins?.length > 0 ? imageUrl() : '',
                    }
                  },
                ],
                components: components,
              },
            }
        );
      } catch (err) {
        console.log('Pas trouvé : ', err)
      }
      return res.send({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
    }
    else if (componentId.startsWith('upgrade_')) {
      let invId = componentId.replace('upgrade_', '')
      const context = req.body.context
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id

      const guild = await client.guilds.fetch(req.body.guild.id)
      if (!activeInventories[invId]) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Oups, cet inventaire n'est plus actif.\nRelance la commande pour avoir un nouvel inventaire interactif`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
      const completeAkhy = await guild.members.fetch(activeInventories[invId].akhyId)

      const invSkins = getUserInventory.all({user_id: activeInventories[invId].akhyId})

      if (!activeInventories[invId] || activeInventories[invId].userId !== req.body.member.user.id) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'est pas à l'origine de cette commande /inventory`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const upgradePrice = process.env.VALO_UPGRADE_PRICE ?? invSkins[activeInventories[invId].page].maxPrice/10
      console.log(`upgrade price : ${upgradePrice}`)
      const buyResponse = await postAPOBuy(req.body.member.user.id, upgradePrice)

      if (buyResponse.status === 500 || buyResponse.ok === false) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'as pas assez d'argent, cette amélioration coûte ${upgradePrice}€`,
            flags: InteractionResponseFlags.EPHEMERAL,
          }
        });
      }

      const skin = invSkins[activeInventories[invId].page];
      const trueSkin = skins.find((s) => s.uuid === invSkins[activeInventories[invId].page].uuid);

      const lvlNb = trueSkin.levels.length
      const chromaNb = trueSkin.chromas.length
      const tierRank = trueSkin.tierRank
      const currentLvl = skin.currentLvl
      const currentChroma = skin.currentChroma

      let succeeded = false

      if (currentLvl < lvlNb) {
        let prob = (currentLvl/lvlNb)
        if (tierRank) prob *= ((tierRank+1)/4)+.1
        let rand = Math.random()
        console.log(`lvl upgrade prob : ${prob} | ${rand}`)
        succeeded = rand >= prob
        //amélioration du lvl
        if (succeeded) {
          let newLvl = skin.currentLvl + 1
          const price = () => {
            let res = skin.basePrice;

            res *= (1 + (newLvl / Math.max(trueSkin.levels.length, 2)))
            res *= (1 + (skin.currentChroma / 4))

            return res.toFixed(2);
          }
          try {
            await updateSkin.run({
              uuid: skin.uuid,
              user_id: skin.user_id,
              currentLvl: newLvl,
              currentChroma: skin.currentChroma,
              currentPrice: price()
            });
          } catch (e) {
            console.log('Database error', e);
          }
        }
      }
      else if (currentChroma < chromaNb) {
        let prob = (currentChroma/chromaNb)
        if (tierRank) prob *= ((tierRank+1)/4)+.1
        let rand = Math.random()
        console.log(`lvl upgrade prob : ${prob} | ${rand}`)
        succeeded = rand >= prob
        //amélioration du chroma
        if (succeeded) {
          let newChroma = skin.currentChroma + 1
          const price = () => {
            let res = skin.basePrice;

            res *= (1 + (skin.currentLvl / Math.max(trueSkin.levels.length, 2)))
            res *= (1 + (newChroma / 4))

            return res.toFixed(2);
          }
          try {
            await updateSkin.run({
              uuid: skin.uuid,
              user_id: skin.user_id,
              currentLvl: skin.currentLvl,
              currentChroma: newChroma,
              currentPrice: price()
            });
          } catch (e) {
            console.log('Database error', e);
          }
        }
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Ce skin n'est pas améliorable`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      // gif
      const initialEmbed = new EmbedBuilder()
          .setTitle(`Amélioration en cours...`)
          .setImage('https://media.tenor.com/HD8nVN2QP9MAAAAC/thoughts-think.gif')
          .setColor(0xF2F3F3);

      // Send the initial response and store the reply object
      await res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [initialEmbed] }
      });

      // then result
      setTimeout(async () => {
        // Prepare the final embed
        let updatedSkin = await getSkin.get(trueSkin.uuid)
        const randomLevel = updatedSkin.currentLvl
        const randomChroma = updatedSkin.currentChroma
        const selectedChroma = trueSkin.chromas[randomChroma-1]

        // Helper functions (unchanged from your original code)
        const videoUrl = () => {
          let res;
          if (randomLevel === trueSkin.levels.length) {
            if (randomChroma === 1) {
              res = trueSkin.levels[trueSkin.levels.length - 1].streamedVideo ?? trueSkin.chromas[0].streamedVideo
            } else {
              res = trueSkin.chromas[randomChroma-1].streamedVideo
            }
          } else {
            res = trueSkin.levels[randomLevel-1].streamedVideo
          }
          return res;
        };
        const imageUrl = () => {
          let res;
          if (randomLevel === trueSkin.levels.length) {
            if (randomChroma === 1) {
              res = trueSkin.chromas[0].displayIcon

            } else {
              res = trueSkin.chromas[randomChroma-1].fullRender ?? trueSkin.chromas[randomChroma-1].displayIcon
            }
          } else if (randomLevel === 1) {
            res = trueSkin.levels[0].displayIcon ?? trueSkin.chromas[0].fullRender
          } else if (randomLevel === 2 || randomLevel === 3) {
            res = trueSkin.displayIcon
          }
          if (res) return res;
          console.log('default')
          return trueSkin.displayIcon
        };
        const chromaName = () => {
          if (randomChroma >= 2) {
            const name = selectedChroma.displayName.replace(/[\r\n]+/g, '').replace(trueSkin.displayName, '')
            const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
            const result = match ? match[2] : null;
            if (match) {
              return match[1].trim()
            } else {
              return name
            }
          }
          if (randomChroma === 1) {
            return 'Base'
          }
          return ''
        };
        const lvlText = () => {
          let res = ""
          if (randomLevel >= 1) {
            res += '1️⃣ '
          }
          if (randomLevel >= 2) {
            res += '2️⃣ '
          }
          if (randomLevel >= 3) {
            res += '3️⃣ '
          }
          if (randomLevel >= 4) {
            res += '4️⃣ '
          }
          if (randomLevel >= 5) {
            res += '5️⃣ '
          }
          for (let i = 0; i < trueSkin.levels.length - randomLevel; i++) {
            res += '◾ '
          }
          return res
        }
        const chromaText = () => {
          let res = ""
          for (let i = 1; i <= trueSkin.chromas.length; i++) {
            res += randomChroma === i ? '💠 ' : '◾ '
          }
          return res
        }

        // Build the final embed
        let finalEmbed;
        if (succeeded) {
          finalEmbed = new EmbedBuilder()
              .setTitle(`L'amélioration a réussi ! 🎉`)
              .setFields([
                { name: '', value: `${updatedSkin.displayName} | ${chromaName()}`, inline: false },
                { name: '', value: `**Lvl** | ${lvlText()}`, inline: true },
                { name: '', value: `**Chroma** | ${chromaText()}`, inline: true },
                { name: '', value: `**Prix** | ${updatedSkin.currentPrice} <:vp:1362964205808128122>`, inline: true },
              ])
              .setDescription(updatedSkin.tierText)
              .setImage(imageUrl())
              .setColor(0x00FF00);
        }
        else {
          finalEmbed = new EmbedBuilder()
              .setTitle(`L'amélioration a râté... ❌`)
              .setFields([
                { name: '', value: `${updatedSkin.displayName} | ${chromaName()}`, inline: false },
              ])
              .setDescription(updatedSkin.tierText)
              .setImage(imageUrl())
              .setColor(0xFF0000);
        }


        // Prepare components if video exists
        const video = videoUrl();
        const components = [];

        if (!succeeded) {
          components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                  .setLabel('Réessayer 🔄️')
                  .setStyle(ButtonStyle.Primary)
                  .setCustomId(`upgrade_${activeInventories[invId].reqBodyId}`)
          ))
        } else if (video) {
          components.push(
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setLabel('🎬 Aperçu vidéo')
                      .setStyle(ButtonStyle.Link)
                      .setURL(video)
              )
          );
        }

        // Edit the original message
        try {
          await DiscordRequest(
              `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
              {
                method: 'PATCH',
                body: {
                  embeds: [finalEmbed],
                  components: components
                }
              }
          );
        } catch (err) {
          console.error('Error editing message:', err);
        }
      }, 500);
    }
    else if (componentId.startsWith('prev_search_page')) {
      let searchId = componentId.replace('prev_search_page_', '');
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      const guild = await client.guilds.fetch(req.body.guild_id);
      if (!activeSearchs[searchId]) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Oups, cet affichage n'est plus actif.\nRelance la commande pour avoir un nouvel élément intéractif`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const chromaText = (skin) => {
        let res = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          res += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return res
      }
      const chromaName = (skin) => {
        if (skin.currentChroma >= 2) {
          const name = skins.find((s) => s.uuid === skin.uuid).chromas[skin.currentChroma-1].displayName.replace(/[\r\n]+/g, '').replace(skin.displayName, '')
          const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
          const result = match ? match[2] : null;
          if (match) {
            return match[1].trim()
          } else {
            return name
          }
        }
        if (skin.currentChroma === 1) {
          return 'Base'
        }
        return ''
      };

      if (activeSearchs[searchId] && activeSearchs[searchId].userId === req.body.member.user.id) {
        if (activeSearchs[searchId].page === 0) {
          activeSearchs[searchId].page = activeSearchs[searchId].amount-1
        } else {
          activeSearchs[searchId].page--
        }
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'est pas à l'origine de cette commande /search`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const trueSkin = skins.find((s) => s.uuid === activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].uuid);
      const imageUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].displayIcon) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].displayIcon
        } else if (trueSkin.levels[trueSkin.levels.length-1].displayIcon) {
          res = trueSkin.levels[trueSkin.levels.length-1].displayIcon
        } else {
          res = trueSkin.displayIcon
        }
        return res
      };

      const videoUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo
        } else if (trueSkin.levels[trueSkin.levels.length-1].streamedVideo) {
          res = trueSkin.levels[trueSkin.levels.length-1].streamedVideo
        } else {
          res = null
        }
        return res
      };

      const owner = await guild.members.fetch(activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].user_id)
      let fields = [
        {
          name: `**${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].displayName}** | ${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].tierText}`,
          value: `${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].maxPrice}€ ${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].user_id ? '| **@'+ owner.user.username +'** ✅' : ''}`,
          inline: false,
        }
      ]

      try {
        const originalComponents = req.body.message.components || [];

        await DiscordRequest(
            activeSearchs[searchId].endpoint,
            {
              method: 'PATCH',
              body: {
                embeds: [
                  {
                    title: `Résultat de recherche`,
                    description: `🔎 ${activeSearchs[searchId].searchValue}`,
                    fields: fields,
                    color: parseInt(activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].tierColor, 16),
                    image: { url: imageUrl() },
                    footer: { text: `${activeSearchs[searchId].page+1}/${activeSearchs[searchId].resultSkins.length} résultat(s)` },
                  },
                ],
                components: originalComponents,
              },
            }
        );
      } catch (err) {
        console.log('Pas trouvé : ', err)
      }
      return res.send({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
    }
    else if (componentId.startsWith('next_search_page')) {
      let searchId = componentId.replace('next_search_page_', '');
      const context = req.body.context;
      // User ID is in user field for (G)DMs, and member for servers
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      const guild = await client.guilds.fetch(req.body.guild_id);
      if (!activeSearchs[searchId]) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Oups, cet affichage n'est plus actif.\nRelance la commande pour avoir un nouvel élément intéractif`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const chromaText = (skin) => {
        let res = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          res += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return res
      }
      const chromaName = (skin) => {
        if (skin.currentChroma >= 2) {
          const name = skins.find((s) => s.uuid === skin.uuid).chromas[skin.currentChroma-1].displayName.replace(/[\r\n]+/g, '').replace(skin.displayName, '')
          const match = name.match(/variante\s+[1-4]\s+([^)]+)/)
          const result = match ? match[2] : null;
          if (match) {
            return match[1].trim()
          } else {
            return name
          }
        }
        if (skin.currentChroma === 1) {
          return 'Base'
        }
        return ''
      };

      if (activeSearchs[searchId] && activeSearchs[searchId].userId === req.body.member.user.id) {
        if (activeSearchs[searchId].page === activeSearchs[searchId].amount-1) {
          activeSearchs[searchId].page = 0
        } else {
          activeSearchs[searchId].page++
        }
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Tu n'est pas à l'origine de cette commande /search`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const trueSkin = skins.find((s) => s.uuid === activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].uuid);
      const imageUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].displayIcon) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].displayIcon
        } else if (trueSkin.levels[trueSkin.levels.length-1].displayIcon) {
          res = trueSkin.levels[trueSkin.levels.length-1].displayIcon
        } else {
          res = trueSkin.displayIcon
        }
        return res
      };

      const videoUrl = () => {
        let res;
        if (trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo) {
          res = trueSkin.chromas[trueSkin.chromas.length-1].streamedVideo
        } else if (trueSkin.levels[trueSkin.levels.length-1].streamedVideo) {
          res = trueSkin.levels[trueSkin.levels.length-1].streamedVideo
        } else {
          res = null
        }
        return res
      };

      const owner = await guild.members.fetch(activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].user_id)
      let fields = [
        {
          name: `**${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].displayName}** | ${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].tierText}`,
          value: `${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].maxPrice}€ ${activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].user_id ? '| **@'+ owner.user.username +'** ✅' : ''}`,
          inline: false,
        }
      ]

      try {
        const originalComponents = req.body.message.components || [];

        await DiscordRequest(
            activeSearchs[searchId].endpoint,
            {
              method: 'PATCH',
              body: {
                embeds: [
                  {
                    title: `Résultat de recherche`,
                    description: `🔎 ${activeSearchs[searchId].searchValue}`,
                    fields: fields,
                    color: parseInt(activeSearchs[searchId].resultSkins[activeSearchs[searchId].page].tierColor, 16),
                    image: { url: imageUrl() },
                    footer: { text: `${activeSearchs[searchId].page+1}/${activeSearchs[searchId].resultSkins.length} résultat(s)` },
                  },
                ],
                components: originalComponents,
              },
            }
        );
      } catch (err) {
        console.log('Pas trouvé : ', err)
      }
      return res.send({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
    }
    return;
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.get('/users', (req, res) => {
  const users = getAllUsers.all();
  res.json(users);
});

app.post('/send-message', (req, res) => {
  const { channelId, message } = req.body;
  const channel = client.channels.cache.get(channelId);

  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  channel.send(message)
      .then(() => res.json({ success: true }))
      .catch(err => res.status(500).json({ error: err.message }));
});

import http from 'http';
import { Server } from 'socket.io';
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    Origin: process.env.BASE_URL,
    methods: ['GET', 'POST', 'PUT'],
  }
});

io.on('connection', (socket) => {
  console.log('FlopoSite connected via WebSocket');
});

server.listen(PORT, () => {
  console.log(`Express+Socket.IO listening on port ${PORT}`);
});

