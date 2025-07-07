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
  postAPOBuy,
  initialShuffledCards,
  getFirstActivePlayerAfterDealer,
  getNextActivePlayer, checkEndOfBettingRound, initialCards, checkRoomWinners, pruneOldLogs
} from './utils.js';
import {
  channelPointsHandler,
  eloHandler,
  pokerEloHandler,
  randomSkinPrice,
  slowmodesHandler
} from './game.js';
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
  insertLog, stmtLogs,
  getLogs, getUserLogs, getUserElo, getUserGames, getUsersByElo, resetDailyReward, queryDailyReward,
} from './init_database.js';
import { getValorantSkins, getSkinTiers } from './valo.js';
import {sleep} from "openai/core";
import { v4 as uuidv4 } from 'uuid';
import { uniqueNamesGenerator, adjectives, languages, animals } from 'unique-names-generator';
import pkg from 'pokersolver';
const { Hand } = pkg;
import axios from 'axios';

// Create an express app
const app = express();
// Get port, or default to 25578
const PORT = process.env.PORT || 25578;
const FLAPI_URL = process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FLAPI_URL);
  res.header('Access-Control-Allow-Headers', 'Content-type, X-API-Key, ngrok-skip-browser-warning');
  next();
});
// To keep track of our active games
const activeGames = {};
const activePolls = {};
const activeInventories = {};
const activeSearchs = {};
const activeSlowmodes = {};
const activePredis = {};
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
export const skins = []

async function getAkhys() {
  try {
    stmtUsers.run();
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch(); // Fetch all members

    const akhys = members.filter(m => !m.user.bot && m.roles.cache.has(process.env.AKHY_ROLE_ID));

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
  try {
    stmtLogs.run()
  } catch (e) {
    console.log('Logs table init error')
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
client.login(process.env.BOT_TOKEN).then(r => console.log(''));

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

  // coins mechanic and slowmodes check
  if (message.guildId === process.env.GUILD_ID) {
    channelPointsHandler(message)
    io.emit('data-updated', { table: 'users', action: 'update' });
    const deletedSlowmode = await slowmodesHandler(message, activeSlowmodes)
    if (deletedSlowmode) io.emit('new-slowmode', { action: 'deleted slowmode' });
  }

  if (message.content.toLowerCase().startsWith(`<@${process.env.APP_ID}>`) || message.mentions.repliedUser?.id === process.env.APP_ID) {
    let startTime = Date.now()
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

      const requestMessage = message.content.replace(`<@${process.env.APP_ID}>`, '')

      // Map to OpenAI/Gemini format
      console.log('AI fetch', process.env.MODEL)
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
            content: `Voici une liste de quelques emojis que tu peux utiliser sur le serveur: <:CAUGHT:1323810730155446322> quand tu te fais prendre la main dans le sac ou que tu a un avis divergent ou risqué, <:hinhinhin:1072510144933531758> pour le rire ou quand tu es moqueur, <:o7:1290773422451986533> pour payer respect ou remercier ou dire au revoir, <:zhok:1115221772623683686> pour quand quelquechose manque de sens, <:nice:1154049521110765759> pour quelquechose de bien, <:nerd:1087658195603951666> pour une explication technique ou une attitude nerd, <:peepSelfie:1072508131839594597> pour à peu près n\'importe quelle situation quand tu es blazé`
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
    else if (message.content.toLowerCase().startsWith('?sv')) {
      const amount = parseInt(message.content.replace('?sv ', ''))
      let sum = 0
      let start_at = Date.now()
      for (let i = 0; i < amount; i++) {
        sum += parseFloat(randomSkinPrice(i+1))
        if (i%10 === 0 || i === amount-1) console.log(`Avg Skin Cost : ~${(sum/i+1).toFixed(2)}€ (~${sum.toFixed(2)}/${i+1}) - ${(Date.now() - start_at)}ms elapsed`)
      }
      console.log(`Result for ${amount} skins`)
    }
    else if (message.author.id === process.env.DEV_ID) {
      const prefix = process.env.DEV_SITE === 'true' ? 'dev' : 'flopo'
      if (message.content === prefix + ':add-coins-to-users') {
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
      else if (message.content === prefix + ':users') {
        const allAkhys = getAllUsers.all()
        console.log(allAkhys)
      }
      else if (message.content === prefix + ':cancel') {
        await message.delete()
      }
      else if (message.content.startsWith(prefix + ':reset-user-coins')) {
        const userId = message.content.replace(prefix + ':reset-user-coins ', '')
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
      else if (message.content.startsWith(prefix + ':send-message')) {
        const msg = message.content.replace(prefix + ':send-message ', '')
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
      else if (message.content.startsWith(prefix + ':sql')) {
        let sqlCommand = message.content.replace(prefix + ':sql ', '')
        console.log(sqlCommand)
        try {
          if (sqlCommand.startsWith('SELECT')) {
            const stmt = flopoDB.prepare(`${sqlCommand}`).all();
            console.log(stmt)
          } else {
            const stmt = flopoDB.prepare(`${sqlCommand}`).run();
            console.log(stmt)
          }
        } catch (e) {
          console.log(e)
        }
      }
      else if (message.content.startsWith(prefix + ':poker')) {
        console.log('poker')
      }
      else if (message.content.startsWith(prefix + ':elo-test')) {
        const numbers = message.content.match(/\d+/g);

        const score1 = parseInt(numbers[0]);
        const score2 = parseInt(numbers[1]);

        const prob1 = 1 / (1 + Math.pow(10, (score2 - score1)/400))
        const prob2 = 1 / (1 + Math.pow(10, (score1 - score2)/400))

        const res1 = Math.floor(score1 + 10 * (1 - prob1))
        const res2 = Math.floor(score2 + 10 * (0 - prob2))

        console.log(res1, res2)
      }
    }
  }
});

// Once bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`[Connected with ${FLAPI_URL}]`)
  const randomMinute = Math.floor(Math.random() * 60);
  const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
  todaysHydrateCron = `${randomMinute} ${randomHour} * * *`
  console.log(todaysHydrateCron)
  await getAkhys();
  console.log('FlopoBOT marked as ready')

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
        console.log(`Removing expired search : ${id}`);
        delete activeSearchs[id];
      }
    }
    for (const id in activePredis) {
      const predi = activePredis[id];
      if (predi.closed) {
        if (predi.paidTime && Date.now() >= predi.paidTime + (24 * 60 * 60 * 1000)) {
          console.log(`Removing expired paid predi : ${id}`);
          delete activePredis[id];
        } else if (Date.now() >= predi.cancelledTime + (24 * 60 * 60 * 1000)) {
          console.log(`Removing expired cancelled predi : ${id}`);
          delete activePredis[id];
        }
      }
    }
    for (const roomId in Object.keys(pokerRooms)) {
      const room = pokerRooms[roomId];
      if (Object.keys(room.players)?.length === 0) {
        delete pokerRooms[roomId];
        console.log(`Removing empty poker room : ${roomId}`);
        io.emit('new-poker-room')
      }
    }
  });

  // ─── 💀 Midnight Chaos Timer ──────────────────────
  cron.schedule(process.env.CRON_EXPR, async () => {
    const randomMinute = Math.floor(Math.random() * 60);
    const randomHour = Math.floor(Math.random() * (18 - 8 + 1)) + 8;
    todaysHydrateCron = `${randomMinute} ${randomHour} * * *`
    console.log(todaysHydrateCron)

    try {
      const akhys = getAllUsers.all()
      akhys.forEach((akhy) => {
        resetDailyReward.run(akhy.id);
      })
    } catch (e) {
      console.log(e)
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
        voters: [],
        channelId: req.body.channel_id,  // Capture channel for follow-up notification
        endpoint: `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`,
      };

      const guildId = req.body.guild_id;
      const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
      const onlineEligibleUsers = await getOnlineUsersWithRole(guildId, roleId);
      const requiredMajority = Math.max(parseInt(process.env.MIN_VOTES), Math.floor(onlineEligibleUsers.size / (time >= 21600 ? 2 : 3)) + 1);
      const votesNeeded = Math.max(0, requiredMajority - activePolls[id].for);

      activePolls[id].endTime = Date.now() + process.env.POLL_TIME * 1000;
      activePolls[id].requiredMajority = requiredMajority;

// Set an interval to update the countdown every 10 seconds (or more often if you want)
      const countdownInterval = setInterval(async () => {
        const poll = activePolls[id];

        if (!poll) {
          clearInterval(countdownInterval);
          io.emit('new-poll', { action: 'timeout cleared' });
          return;
        }

        const remaining = Math.max(0, Math.floor((poll?.endTime - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const countdownText = `**${minutes}m ${seconds}s** restantes`;
        const votesNeeded = Math.max(0, activePolls[id].requiredMajority - activePolls[id].for);

        if (!poll || remaining === 0) {
          try {
            let forText = ''
            poll.voters.forEach((voter) => {
              const user = getUser.get(voter);
              forText += `- ${user.globalName}\n`
            })
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
                                value: '✅ ' + poll.for + '\n' + forText,
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
          io.emit('new-poll', { action: 'timeout cleared' });
          return;
        }

        try {
          let forText = ''
          poll.voters.forEach((voter) => {
            const user = getUser.get(voter);
            forText += `- ${user.globalName}\n`
          })
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
                              value: '✅ ' + poll.for + '\n' + forText,
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

      // web site update
      io.emit('new-poll', { action: 'timeout command' });

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
        let result = ""
        for (let i = 1; i <= skins.find((s) => s.uuid === skin.uuid).chromas.length; i++) {
          result += skin.currentChroma === i ? '💠 ' : '◾ '
        }
        return result
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
        let result;
        if (invSkins[0].currentLvl === trueSkin.levels.length) {
          if (invSkins[0].currentChroma === 1) {
            result = trueSkin.chromas[0].displayIcon

          } else {
            result = trueSkin.chromas[invSkins[0].currentChroma-1].fullRender ?? trueSkin.chromas[invSkins[0].currentChroma-1].displayIcon
          }
        } else if (invSkins[0].currentLvl === 1) {
          result = trueSkin.levels[0].displayIcon ?? trueSkin.chromas[0].fullRender
        } else if (invSkins[0].currentLvl === 2 || invSkins[0].currentLvl === 3) {
          result = trueSkin.displayIcon
        }
        if (result) return result;
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

      // Set timeout for the reveal
      setTimeout(async () => {
        // Prepare the final embed
        const selectedLevel = randomSkin.levels[randomLevel - 1];
        const selectedChroma = randomSkin.chromas[randomChroma - 1];

        // Helper functions (unchanged from your original code)
        const videoUrl = () => {
          let result;
          if (randomLevel === randomSkin.levels.length) {
            if (randomChroma === 1) {
              result = randomSkin.levels[randomSkin.levels.length - 1].streamedVideo ?? randomSkin.chromas[0].streamedVideo
            } else {
              result = randomSkin.chromas[randomChroma-1].streamedVideo
            }
          } else {
            result = randomSkin.levels[randomLevel-1].streamedVideo
          }
          return result;
        };
        const imageUrl = () => {
          let result;
          if (randomLevel === randomSkin.levels.length) {
            if (randomChroma === 1) {
              result = randomSkin.chromas[0].displayIcon

            } else {
              result = randomSkin.chromas[randomChroma-1].fullRender ?? randomSkin.chromas[randomChroma-1].displayIcon
            }
          } else if (randomLevel === 1) {
            result = randomSkin.levels[0].displayIcon ?? randomSkin.chromas[0].fullRender
          } else if (randomLevel === 2 || randomLevel === 3) {
            result = randomSkin.displayIcon
          }
          if (result) return result;
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
          let result = ""
          if (randomLevel >= 1) {
            result += '1️⃣ '
          }
          if (randomLevel >= 2) {
            result += '2️⃣ '
          }
          if (randomLevel >= 3) {
            result += '3️⃣ '
          }
          if (randomLevel >= 4) {
            result += '4️⃣ '
          }
          if (randomLevel >= 5) {
            result += '5️⃣ '
          }
          for (let i = 0; i < randomSkin.levels.length - randomLevel; i++) {
            result += '◾ '
          }
          return result
        }
        const chromaText = () => {
          let result = ""
          for (let i = 1; i <= randomSkin.chromas.length; i++) {
            result += randomChroma === i ? '💠 ' : '◾ '
          }
          return result
        }
        const price = () => {
          let result = dbSkins[randomIndex].basePrice;

          result *= (1 + (randomLevel / Math.max(randomSkin.levels.length, 2)))
          result *= (1 + (randomChroma / 4))

          return result.toFixed(2);
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

    if (name === 'floposite') {
      const originalComponents = [
        {
          type: MessageComponentTypes.BUTTON,
          label: 'Aller sur FlopoSite',
          style: ButtonStyleTypes.LINK,
          url: 'https://floposite.netlify.app',
        },
      ];

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: 'FlopoSite',
              description: 'L\'officiel et très goatesque site de FlopoBot.',
              color: 0x6571F3,
            }
          ],
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: originalComponents,
            },
          ],
        }
      })
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
        poll.voters = poll.voters || [];
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
        if (poll.voters.find(u => u === voterId)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "Tu as déjà voté oui!",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        // Record the vote
        if (isVotingFor) {
          poll.voters.push(voterId);
          poll.for++;
        } else {
          poll.against++;
        }

        io.emit('new-poll', { action: 'new vote' });

        // Retrieve online eligible users (ensure your bot has the necessary intents)
        const guildId = req.body.guild_id;
        const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
        const onlineEligibleUsers = await getOnlineUsersWithRole(guildId, roleId);
        const votesNeeded = Math.max(0, poll.requiredMajority - poll.for);

        // Check if the majority is reached
        if (poll.for >= poll.requiredMajority) {
          try {
            // Build the updated poll message content
            let forText = ''
            poll.voters.forEach((voter) => {
              const user = getUser.get(voter);
              forText += `- ${user.globalName}\n`
            })
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
                                value: '✅ ' + poll.for + '\n' + forText,
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
            let forText = ''
            poll.voters.forEach((voter) => {
              const user = getUser.get(voter);
              forText += `- ${user.globalName}\n`
            })
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
                                value: '✅ ' + poll.for + '\n' + forText,
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
    else if (componentId.startsWith('option_')) {
      const optionId = parseInt(componentId.replace('option_', '')[0]);
      const prediId = componentId.replace(`option_${optionId}_`, '');
      let intAmount = 10;

      const commandUserId = req.body.member.user.id
      const commandUser = getUser.get(commandUserId);
      if (!commandUser) return res.status(403).send({ message: 'Oups, je ne te connais pas'})
      if (commandUser.coins < intAmount) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Tu n\'as pas assez de FlopoCoins',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const prediObject = activePredis[prediId]
      if (!prediObject) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Prédiction introuvable',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      if (prediObject.endTime < Date.now()) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Les votes de cette prédiction sont clos',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const otherOption = optionId === 0 ? 1 : 0;
      if (prediObject.options[otherOption].votes.find(v => v.id === commandUserId) && commandUserId !== process.env.DEV_ID) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Tu ne peux pas voter pour les 2 deux options',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      let stopMaxCoins = false
      if (prediObject.options[optionId].votes.find(v => v.id === commandUserId)) {
        activePredis[prediId].options[optionId].votes.forEach(v => {
          if (v.id === commandUserId) {
            if (v.amount >= 250000) {
              stopMaxCoins = true
              return
            }
            if (v.amount + intAmount > 250000) {
              intAmount = 250000-v.amount
            }
            v.amount += intAmount
          }
        })
      } else {
        activePredis[prediId].options[optionId].votes.push({
          id: commandUserId,
          amount: intAmount,
        })
      }

      if (stopMaxCoins) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Tu as déjà parié le max (250K)',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      activePredis[prediId].options[optionId].total += intAmount

      activePredis[prediId].options[optionId].percent = (activePredis[prediId].options[optionId].total / (activePredis[prediId].options[otherOption].total + activePredis[prediId].options[optionId].total)) * 100
      activePredis[prediId].options[otherOption].percent = 100 - activePredis[prediId].options[optionId].percent

      io.emit('new-predi', { action: 'new vote' });

      updateUserCoins.run({
        id: commandUserId,
        coins: commandUser.coins - intAmount,
      })
      insertLog.run({
        id: commandUserId + '-' + Date.now(),
        user_id: commandUserId,
        action: 'PREDI_VOTE',
        target_user_id: null,
        coins_amount: -intAmount,
        user_new_amount: commandUser.coins - intAmount,
      })
      io.emit('data-updated', { table: 'users', action: 'update' });

      try {
        const totalAmount = activePredis[prediId].options[optionId].votes.find(v => v.id === commandUserId)?.amount;
        const optionLabel = activePredis[prediId].options[optionId].label;
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Vote enregistré, **${intAmount}** Flopocoins sur **"${optionLabel}"** (**${totalAmount}** au total)`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      } catch (err) {
        console.log('Pas trouvé : ', err)
        return res.send({
          type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
        });
      }
    }
    return;
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.use(express.json());

// Check flAPI
app.get('/check', (req, res) => {
  res.status(200).json({ check: true, status: 'OK' });
});

// Get all users ordered by coins
app.get('/users', (req, res) => {
  const users = getAllUsers.all();
  res.json(users);
});

app.get('/users/by-elo', (req, res) => {
  const users = getUsersByElo.all()
  res.json(users);
})

app.get('/logs', async (req, res) => {
  // purge old logs
  await pruneOldLogs()

  return res.status(200).json(getLogs.all())
})

app.post('/timedout', async (req, res) => {
  const { userId } = req.body
  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (e) {
    return res.status(404).send({ message: 'Unknown member' })
  }

  return res.status(200).json({ isTimedOut: member?.communicationDisabledUntilTimestamp > Date.now()})
})

// Get user's avatar
app.get('/user/:id/avatar', async (req, res) => {
  try {
    const userId = req.params.id; // Get the ID from route parameters
    const user = await client.users.fetch(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const avatarUrl = user.displayAvatarURL({ format: 'png', size: 256 });
    res.json({ avatarUrl });

  } catch (error) {
    console.error('Error fetching user avatar');
    res.status(500).json({ error: 'Failed to fetch avatar' });
  }
})

app.get('/user/:id/sparkline', async (req, res) => {
  try {
    const userId = req.params.id

    const user = getUser.get(userId)

    if (!user) return res.status(404).send({ message: 'Utilisateur introuvable'})

    return res.status(200).json({ sparkline: getUserLogs.all({user_id: userId}) })
  } catch (e) {
    return res.status(500).send({ message: 'erreur'})
  }
})

app.get('/user/:id/elo', async (req, res) => {
  try {
    const userId = req.params.id

    const user = getUser.get(userId)

    if (!user) return res.status(404).send({ message: 'Utilisateur introuvable'})

    const userElo = getUserElo.get({ id: userId })

    if (!userElo) return res.status(200).json({ elo: null })

    return res.status(200).json({ elo: userElo.elo })
  } catch (e) {
    return res.status(500).send({ message: 'erreur'})
  }
})

app.get('/user/:id/elo-graph', async (req, res) => {
  try {
    const userId = req.params.id

    const user = getUser.get(userId)

    if (!user) return res.status(404).send({ message: 'Utilisateur introuvable'})


    const games = getUserGames.all({ user_id: userId });

    if (!games) return res.status(404).send({ message: 'Aucune partie'})

    let array = []
    games.forEach((game, index) => {
      if (game.p1 === userId) {
        array.push(game.p1_elo)
        if (index === games.length - 1) array.push(game.p1_new_elo)
      } else if (game.p2 === userId) {
        array.push(game.p2_elo)
        if (index === games.length - 1) array.push(game.p2_new_elo)
      }
    })

    return res.status(200).json({ elo_graph: array })
  } catch (e) {
    return res.status(500).send({ message: 'erreur'})
  }
})

// Get user's inventory
app.get('/user/:id/inventory', async (req, res) => {
  try {
    const userId = req.params.id; // Get the ID from route parameters
    const user = await client.users.fetch(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const inventory = getUserInventory.all({user_id: userId});
    res.json({ inventory });

  } catch (error) {
    console.error('Error fetching user avatar');
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
})

app.get('/user/:id/daily', async (req, res) => {
  const userId = req.params.id

  const akhy = getUser.get(userId)

  if (!akhy) return res.status(404).send({ message: 'Utilisateur introuvable'})

  if (akhy.dailyQueried) return res.status(403).send({ message: 'Récompense déjà récupérée'})

  const amount = 200
  const coins = akhy.coins

  queryDailyReward.run(userId)
  updateUserCoins.run({
    id: userId,
    coins: coins + amount,
  })
  insertLog.run({
    id: userId + '-' + Date.now(),
    user_id: userId,
    action: 'DAILY_REWARD',
    target_user_id: null,
    coins_amount: amount,
    user_new_amount: coins + amount,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  return res.status(200).send({ message: 'Récompense récupérée !' })
})

// Get active polls
app.get('/polls', async (req, res) => {
  try {
    res.json({ activePolls });

  } catch (error) {
    console.error('Error fetching active polls');
    res.status(500).json({ error: 'Failed to fetch active polls' });
  }
})

// Send a custom message in the admin command channel
app.post('/send-message', (req, res) => {
  const { userId, channelId, message } = req.body;
  const channel = client.channels.cache.get(channelId);

  const user = getUser.get(userId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  if (user.coins < 10) return res.status(403).json({ error: 'Pas assez de coins' });

  updateUserCoins.run({
    id: userId,
    coins: user.coins - 10,
  })
  insertLog.run({
    id: userId + '-' + Date.now(),
    user_id: userId,
    action: 'SEND_MESSAGE',
    target_user_id: null,
    coins_amount: -10,
    user_new_amount: user.coins - 10,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  channel.send(message)
      .then(() => res.json({ success: true }))
      .catch(err => res.status(500).json({ error: err.message }));
});

// Change user's server specific username
app.post('/change-nickname', async (req, res) => {
  const { userId, nickname, commandUserId } = req.body;

  const commandUser = getUser.get(commandUserId);

  if (!commandUser) return res.status(404).json({ message: 'Oups petit soucis' });

  if (commandUser.coins < 1000) return res.status(403).json({ message: 'Pas assez de coins' });

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.setNickname(nickname);
    let message = nickname ? `Le pseudo de '${member.user.tag}' a été changé en '${nickname}'` : `Le pseudo de '${member.user.tag}' a été remis par défaut`
    res.status(200).json({ message : message });
    updateUserCoins.run({
      id: commandUserId,
      coins: commandUser.coins - 1000,
    })
    insertLog.run({
      id: commandUserId + '-' + Date.now(),
      user_id: commandUserId,
      action: 'CHANGE_NICKNAME',
      target_user_id: userId,
      coins_amount: -1000,
      user_new_amount: commandUser.coins - 1000,
    })
    io.emit('data-updated', { table: 'users', action: 'update' });
  } catch (error) {
    res.status(500).json({ message : `J'ai pas réussi à changer le pseudo` });
  }
})

app.post('/spam-ping', async (req, res) => {
  const { userId, commandUserId } = req.body;

  const user = getUser.get(userId);
  const commandUser = getUser.get(commandUserId);

  if (!commandUser || !user) return res.status(404).json({ message: 'Oups petit soucis' });

  if (commandUser.coins < 10000) return res.status(403).json({ message: 'Pas assez de coins' });

  try {
    const discordUser = await client.users.fetch(userId);

    await discordUser.send(`<@${userId}>`)

    res.status(200).json({ message : 'C\'est parti ehehe' });

    updateUserCoins.run({
      id: commandUserId,
      coins: commandUser.coins - 10000,
    })
    insertLog.run({
      id: commandUserId + '-' + Date.now(),
      user_id: commandUserId,
      action: 'SPAM_PING',
      target_user_id: userId,
      coins_amount: -10000,
      user_new_amount: commandUser.coins - 10000,
    })
    io.emit('data-updated', { table: 'users', action: 'update' });

    for (let i = 0; i < 29; i++) {
      await discordUser.send(`<@${userId}>`)
      await sleep(1000);
    }
  } catch (err) {
    console.log(err)
    res.status(500).json({ message : "Oups ça n'a pas marché" });
  }
})

app.post('/timeout/vote', async (req, res) => {
  const { commandUserId, voteKey, voteFor } = req.body;

  const commandUser = getUser.get(commandUserId);
  const poll = activePolls[voteKey];
  const isVotingFor = voteFor;

  if (!commandUser) return res.status(404).json({ message: 'Oups petit soucis' });
  if (!poll) return res.status(404).json({ message: 'Vote de timeout introuvable' });

  if (activePolls[voteKey]) {
    const poll = activePolls[voteKey];
    poll.voters = poll.voters || [];
    const voterId = commandUserId;

    const guild = await client.guilds.fetch(process.env.GUILD_ID)
    const commandMember = await guild.members.fetch(commandUserId);
    // Check if the voter has the required voting role
    const voterRoles = commandMember.roles.cache.map(role => role.id) || [];
    if (!voterRoles.includes(process.env.VOTING_ROLE_ID)) {
      return res.status(403).json({ message: 'Tu n\'as pas le rôle requis pour voter'})
    }

    // Enforce one vote per eligible user
    if (poll.voters.find(u => u === voterId)) {
      return res.status(403).json({ message: 'Tu as déjà voté'})
    }

    // Record the vote
    poll.voters.push(voterId);
    if (isVotingFor) {
      poll.for++;
    } else {
      poll.against++;
    }

    io.emit('new-poll', { action: 'new vote' });

    // Retrieve online eligible users (ensure your bot has the necessary intents)
    const guildId = process.env.GUILD_ID;
    const roleId = process.env.VOTING_ROLE_ID; // Set this in your .env file
    const onlineEligibleUsers = await getOnlineUsersWithRole(guildId, roleId);
    const votesNeeded = Math.max(0, poll.requiredMajority - poll.for);

    // Check if the majority is reached
    if (poll.for >= poll.requiredMajority) {
      try {
        // Build the updated poll message content
        let forText = ''
        poll.voters.forEach((voter) => {
          const user = getUser.get(voter);
          forText += `- ${user.globalName}\n`
        })
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
                        value: '✅ ' + poll.for + '\n' + forText,
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
      delete activePolls[voteKey];

      // **Actual Timeout Action**
      try {
        // Calculate the ISO8601 timestamp to disable communications until now + poll.time seconds
        const timeoutUntil = new Date(Date.now() + poll.time * 1000).toISOString();
        const endpointTimeout = `guilds/${process.env.GUILD_ID}/members/${poll.toUserId}`;
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
        let forText = ''
        poll.voters.forEach((voter) => {
          const user = getUser.get(voter);
          forText += `- ${user.globalName}\n`
        })
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
                        value: '✅ ' + poll.for + '\n' + forText,
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

    return res.status(200).json({ message: 'Vote enregistré !'})
  }
})

app.post('/slowmode', async (req, res) => {
  let { userId, commandUserId} = req.body

  const user = getUser.get(userId)
  const commandUser = getUser.get(commandUserId);

  if (!commandUser || !user) return res.status(404).json({ message: 'Oups petit soucis' });

  if (commandUser.coins < 10000) return res.status(403).json({ message: 'Pas assez de coins' });

  if (!user) return res.status(403).send({ message: 'Oups petit problème'})

  if (activeSlowmodes[userId]) {
    if (userId === commandUserId) {
      delete activeSlowmodes[userId];
      return res.status(200).json({ message: 'Slowmode retiré'})
    } else {
      let timeLeft = (activeSlowmodes[userId].endAt - Date.now())/1000
      timeLeft = timeLeft > 60 ? (timeLeft/60).toFixed().toString() + 'min' : timeLeft.toFixed().toString() + 'sec'
      return res.status(403).json({ message: `${user.globalName} est déjà en slowmode (${timeLeft})`})
    }
  } else if (userId === commandUserId) {
    return res.status(403).json({ message: 'Impossible de te mettre toi-même en slowmode'})
  }

  activeSlowmodes[userId] = {
    userId: userId,
    endAt: Date.now() + 60 * 60 * 1000, // 1 heure
    lastMessage: null,
  };
  io.emit('new-slowmode', { action: 'new slowmode' });

  updateUserCoins.run({
    id: commandUserId,
    coins: commandUser.coins - 10000,
  })
  insertLog.run({
    id: commandUserId + '-' + Date.now(),
    user_id: commandUserId,
    action: 'SLOWMODE',
    target_user_id: userId,
    coins_amount: -10000,
    user_new_amount: commandUser.coins - 10000,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  return res.status(200).json({ message: `${user.globalName} est maintenant en slowmode pour 1h`})
})

app.get('/slowmodes', async (req, res) => {
  res.status(200).json({ slowmodes: activeSlowmodes });
})

app.post('/start-predi', async (req, res) => {
  let { commandUserId, label, options, closingTime, payoutTime } = req.body

  const commandUser = getUser.get(commandUserId)

  if (!commandUser) return res.status(403).send({ message: 'Oups petit problème'})
  if (commandUser.coins < 100) return res.status(403).send({ message: 'Tu n\'as pas assez de FlopoCoins'})

  if (Object.values(activePredis).find(p => p.creatorId === commandUserId && (p.endTime > Date.now() && !p.closed))) {
    return res.status(403).json({ message: `Tu ne peux pas lancer plus d'une prédi à la fois !`})
  }

  const startTime = Date.now()
  const newPrediId = commandUserId.toString() + '-' + startTime.toString()

  let msgId;
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const generalChannel = guild.channels.cache.find(
        ch => ch.name === 'général' || ch.name === 'general'
    );
    const embed = new EmbedBuilder()
        .setTitle(`Prédiction de ${commandUser.username}`)
        .setDescription(`**${label}**`)
        .addFields(
            { name: `${options[0]}`, value: ``, inline: true },
            { name: ``, value: `ou`, inline: true },
            { name: `${options[1]}`, value: ``, inline: true }
        )
        .setFooter({ text: `${formatTime(closingTime).replaceAll('*', '')} pour voter` })
        .setColor('#5865f2')
        .setTimestamp(new Date());

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`option_0_${newPrediId}`)
                .setLabel(`+10 sur '${options[0]}'`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`option_1_${newPrediId}`)
                .setLabel(`+10 sur '${options[1]}'`)
                .setStyle(ButtonStyle.Primary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Voter sur FlopoSite')
                .setURL(`${process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
                .setStyle(ButtonStyle.Link)
        )

    const msg = await generalChannel.send({ embeds: [embed], components: [row, row2] });
    msgId = msg.id;
  } catch (e) {
    return res.status(500).send({ message: 'Erreur lors de l\'envoi du message'})
  }

  const formattedOptions = [
    { label: options[0], votes: [], total: 0, percent: 0, },
    { label: options[1], votes: [], total: 0, percent: 0, },
  ]
  activePredis[newPrediId] = {
    creatorId: commandUserId,
    label: label,
    options: formattedOptions,
    startTime: startTime,
    closingTime: startTime + (closingTime * 1000),
    endTime: startTime + (closingTime * 1000) + (payoutTime * 1000),
    closed: false,
    winning: null,
    cancelledTime: null,
    paidTime: null,
    msgId: msgId,
  };
  io.emit('new-predi', { action: 'new predi' });

  updateUserCoins.run({
    id: commandUserId,
    coins: commandUser.coins - 100,
  })
  insertLog.run({
    id: commandUserId + '-' + Date.now(),
    user_id: commandUserId,
    action: 'START_PREDI',
    target_user_id: null,
    coins_amount: -100,
    user_new_amount: commandUser.coins - 100,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  return res.status(200).json({ message: `Ta prédi '${label}' a commencée !`})
})

app.get('/predis', async (req, res) => {
  const reversedPredis = Object.entries(activePredis).reverse();

  const openEntries = [];
  const closedEntries = [];

  for (const [key, value] of reversedPredis) {
    if (value.closed === true) {
      closedEntries.push([key, value]);
    } else {
      openEntries.push([key, value]);
    }
  }

  const reorderedPredis = Object.fromEntries([...openEntries, ...closedEntries]);

  res.status(200).json({ predis: reorderedPredis });
});

app.post('/vote-predi', async (req, res) => {
  const { commandUserId, predi, amount, option } = req.body

  let warning = false;

  let intAmount = parseInt(amount)
  if (intAmount < 10 || intAmount > 250000) return res.status(403).send({ message: 'Montant invalide'})

  const commandUser = getUser.get(commandUserId)
  if (!commandUser) return res.status(403).send({ message: 'Oups, je ne te connais pas'})
  if (commandUser.coins < intAmount) return res.status(403).send({ message: 'Tu n\'as pas assez de FlopoCoins'})

  const prediObject = activePredis[predi]
  if (!prediObject) return res.status(403).send({ message: 'Prédiction introuvable'})

  if (prediObject.endTime < Date.now()) return res.status(403).send({ message: 'Les votes de cette prédiction sont clos'})

  const otherOption = option === 0 ? 1 : 0;
  if (prediObject.options[otherOption].votes.find(v => v.id === commandUserId) && commandUserId !== process.env.DEV_ID) return res.status(403).send({ message: 'Tu ne peux pas voter pour les 2 deux options'})

  if (prediObject.options[option].votes.find(v => v.id === commandUserId)) {
    activePredis[predi].options[option].votes.forEach(v => {
      if (v.id === commandUserId) {
        if (v.amount === 250000) {
          return res.status(403).send({ message: 'Tu as déjà parié le max (250K)'})
        }
        if (v.amount + intAmount > 250000) {
          intAmount = 250000-v.amount
          warning = true
        }
        v.amount += intAmount
      }
    })
  } else {
    activePredis[predi].options[option].votes.push({
      id: commandUserId,
      amount: intAmount,
    })
  }
  activePredis[predi].options[option].total += intAmount

  activePredis[predi].options[option].percent = (activePredis[predi].options[option].total / (activePredis[predi].options[otherOption].total + activePredis[predi].options[option].total)) * 100
  activePredis[predi].options[otherOption].percent = 100 - activePredis[predi].options[option].percent

  io.emit('new-predi', { action: 'new vote' });

  updateUserCoins.run({
    id: commandUserId,
    coins: commandUser.coins - intAmount,
  })
  insertLog.run({
    id: commandUserId + '-' + Date.now(),
    user_id: commandUserId,
    action: 'PREDI_VOTE',
    target_user_id: null,
    coins_amount: -intAmount,
    user_new_amount: commandUser.coins - intAmount,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  return res.status(200).send({ message : `Vote enregistré!` });
})

app.post('/end-predi', async (req, res) => {
  const { commandUserId, predi, confirm, winningOption } = req.body

  const commandUser = getUser.get(commandUserId)
  if (!commandUser) return res.status(403).send({ message: 'Oups, je ne te connais pas'})
  if (commandUserId !== process.env.DEV_ID) return res.status(403).send({ message: 'Tu n\'as pas les permissions requises' })

  const prediObject = activePredis[predi]
  if (!prediObject) return res.status(403).send({ message: 'Prédiction introuvable'})
  if (prediObject.closed) return res.status(403).send({ message: 'Prédiction déjà close'})

  if (!confirm) {
    activePredis[predi].cancelledTime = new Date();
    activePredis[predi].options[0].votes.forEach((v) => {
      const tempUser = getUser.get(v.id)
      try {
        updateUserCoins.run({
          id: v.id,
          coins: tempUser.coins + v.amount
        })
        insertLog.run({
          id: v.id + '-' + Date.now(),
          user_id: v.id,
          action: 'PREDI_REFUND',
          target_user_id: v.id,
          coins_amount: v.amount,
          user_new_amount: tempUser.coins + v.amount,
        })
      } catch (e) {
        console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`)
      }
    })
    activePredis[predi].options[1].votes.forEach((v) => {
      const tempUser = getUser.get(v.id)
      try {
        updateUserCoins.run({
          id: v.id,
          coins: tempUser.coins + v.amount
        })
        insertLog.run({
          id: v.id + '-' + Date.now(),
          user_id: v.id,
          action: 'PREDI_REFUND',
          target_user_id: v.id,
          coins_amount: v.amount,
          user_new_amount: tempUser.coins + v.amount,
        })
      } catch (e) {
        console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`)
      }
    })
    activePredis[predi].closed = true;
  }
  else {
    const losingOption = winningOption === 0 ? 1 : 0;
    activePredis[predi].options[winningOption].votes.forEach((v) => {
      const tempUser = getUser.get(v.id)
      const ratio = activePredis[predi].options[winningOption].total === 0 ? 0 : activePredis[predi].options[losingOption].total / activePredis[predi].options[winningOption].total
      try {
        updateUserCoins.run({
          id: v.id,
          coins: tempUser.coins + (v.amount * (1 + ratio))
        })
        insertLog.run({
          id: v.id + '-' + Date.now(),
          user_id: v.id,
          action: 'PREDI_RESULT',
          target_user_id: v.id,
          coins_amount: v.amount * (1 + ratio),
          user_new_amount: tempUser.coins + (v.amount * (1 + ratio)),
        })
      } catch (e) {
        console.log(`Impossible de créditer ${v.id} (${v.amount} coins pariés, *${1 + ratio})`)
      }
    })
    activePredis[predi].paidTime = new Date();
    activePredis[predi].closed = true;
    activePredis[predi].winning = winningOption;
  }

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const generalChannel = guild.channels.cache.find(
        ch => ch.name === 'général' || ch.name === 'general'
    );
    const message = await generalChannel.messages.fetch(activePredis[predi].msgId)
    const updatedEmbed = new EmbedBuilder()
        .setTitle(`Prédiction de ${commandUser.username}`)
        .setDescription(`**${activePredis[predi].label}**`)
        .setFields({ name: `${activePredis[predi].options[0].label}`, value: ``, inline: true },
            { name: ``, value: `ou`, inline: true },
            { name: `${activePredis[predi].options[1].label}`, value: ``, inline: true },
        )
        .setFooter({ text: `${activePredis[predi].cancelledTime !== null ? 'Prédi annulée' : 'Prédi confirmée !' }` })
        .setTimestamp(new Date());
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Voir')
                .setURL(`${process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
                .setStyle(ButtonStyle.Link)
        )
    await message.edit({ embeds: [updatedEmbed], components: [row] });
  } catch (err) {
    console.error('Error updating prédi message:', err);
  }

  io.emit('new-predi', { action: 'closed predi' });
  io.emit('data-updated', { table: 'users', action: 'fin predi' });

  return res.status(200).json({ message: 'Prédi close' });
})

// ADMIN Add coins
app.post('/add-coins', (req, res) => {
  const { commandUserId } = req.body;

  const commandUser = getUser.get(commandUserId);

  if (!commandUser) return res.status(404).json({ error: 'User not found' });
  if (commandUserId !== process.env.DEV_ID) return res.status(404).json({ error: 'Not admin' });

  updateUserCoins.run({
    id: commandUserId,
    coins: commandUser.coins + 1000,
  })
  insertLog.run({
    id: commandUserId + '-' + Date.now(),
    user_id: commandUserId,
    action: 'ADD_COINS',
    target_user_id: commandUserId,
    coins_amount: 1000,
    user_new_amount: commandUser.coins + 1000,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  res.status(200).json({ message : `+1000` });
});

app.post('/buy-coins', (req, res) => {
  const { commandUserId, coins } = req.body;

  const commandUser = getUser.get(commandUserId);

  if (!commandUser) return res.status(404).json({ error: 'User not found' });

  updateUserCoins.run({
    id: commandUserId,
    coins: commandUser.coins + coins,
  })
  insertLog.run({
    id: commandUserId + '-' + Date.now(),
    user_id: commandUserId,
    action: 'ADD_COINS',
    target_user_id: commandUserId,
    coins_amount: coins,
    user_new_amount: commandUser.coins + coins,
  })
  io.emit('data-updated', { table: 'users', action: 'update' });

  res.status(200).json({ message : `+${coins}` });
});

const pokerRooms = {}
app.post('/create-poker-room', async (req, res) => {
  const { creatorId } = req.body
  const id = uuidv4()
  const t12names = [
      'cassoule',
      'passoule',
      'kiwiko',
      'piwiko',
      'wata',
      'pata',
      'apologize',
      'apologay',
      'daspoon',
      'esteban',
      'edorima',
      'momozhok',
      'popozhok',
      'dodozhok',
      'flopozhok',
      'thomas',
      'poma'
  ]
  const name = uniqueNamesGenerator({ dictionaries: [adjectives, t12names], separator: ' ', style: 'capital' });

  const creator = await client.users.fetch(creatorId)

  if (!creator) {
    return res.status(404).send({message: 'Utilisateur introuvable'})
  }
  if (Object.values(pokerRooms).find(room => room.host_id === creatorId)) {
    return res.status(403).send({message: 'Tu ne peux créer qu\'une seule table à la fois'})
  }

  const alreadyInARoom = Object.values(pokerRooms).find((room) => {
    return Object.keys(room.players).includes(creatorId)
  })

  if (alreadyInARoom) return res.status(403).send({ message: 'Tu es déjà assis à une table' })

  pokerRooms[id] = {
    id: id,
    host_id: creatorId,
    host_name: creator.globalName,
    name: name,
    created_at: Date.now(),
    last_move_at: Date.now(),
    players: {},
    queue: {},
    afk: {},
    pioche: initialShuffledCards(),
    tapis: [],
    dealer: null,
    sb: null,
    bb: null,
    highest_bet: null,
    current_player: null,
    current_turn: null,
    playing: false,
    winners: [],
    waiting_for_restart: false,
    fakeMoney: false,
  }

  res.status(200).send({ roomId: id })

  try {
    const url = (process.env.DEV_SITE === 'true' ? process.env.API_URL_DEV : process.env.API_URL) + '/poker-room/join'
    const response = await axios.post(url, { userId: creatorId, roomId: id })
  } catch (e) {
    console.log(e)
  }

  io.emit('new-poker-room')
});

app.get('/poker-rooms', (req, res) => {
  return res.status(200).send({ rooms: pokerRooms })
})

app.get('/poker-rooms/:id', (req, res) => {
  return res.status(200).send({ room: pokerRooms[req.params.id] })
})

app.post('/poker-room/join', async (req, res) => {
  const { userId, roomId } = req.body

  const user = await client.users.fetch(userId)

  const alreadyInARoom = Object.values(pokerRooms).find((room) => {
    return Object.keys(room.players).includes(userId)
  })

  if (alreadyInARoom) return res.status(403).send({ message: 'Déjà assis à une table' })

  let amount = getUser.get(userId)?.coins
  let fakeMoney = false

  if (!amount || amount < 1000) {
    amount = 1000
    fakeMoney = true
  }

  const player = {
    id: user.id,
    globalName: user.globalName,
    hand: [],
    bank: amount,
    bet: null,
    solve: null,
    folded: false,
    allin: false,
    last_played_turn: null,
    is_last_raiser: false,
  }

  try {
    if (pokerRooms[roomId].playing) {
      pokerRooms[roomId].queue[userId] = player
    } else {
      pokerRooms[roomId].players[userId] = player
    }
    if (pokerRooms[roomId].afk[userId]) {
      delete pokerRooms[roomId].afk[userId]
    }
    if (fakeMoney) pokerRooms[roomId].fakeMoney = true
  } catch (e) {
    //
  }

  io.emit('new-poker-room')
  return res.status(200)
});

app.post('/poker-room/accept', async (req, res) => {
  const { userId, roomId } = req.body

  const player = pokerRooms[roomId].queue[userId]

  if (!player) return res.status(404).send({ message: 'Joueur introuvable dans le file d\'attente'});

  try {
      pokerRooms[roomId].players[userId] = player
      delete pokerRooms[roomId].queue[userId]
      if (pokerRooms[roomId].afk[userId]) {
        delete pokerRooms[roomId].afk[userId]
      }
  } catch (e) {
    //
  }

  io.emit('new-poker-room')
  return res.status(200)
})

app.post('/poker-room/kick', async (req, res) => {
  //TODO
})

app.post('/poker-room/leave', async (req, res) => {
  const { userId, roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  if (!pokerRooms[roomId].players[userId]) return res.status(404).send({ message: 'Joueur introuvable' })

  if (pokerRooms[roomId].playing && (pokerRooms[roomId].current_turn !== null && pokerRooms[roomId].current_turn !== 4)) {
    pokerRooms[roomId].afk[userId] = pokerRooms[roomId].players[userId]

    try {
      pokerRooms[roomId].players[userId].folded = true
      pokerRooms[roomId].players[userId].last_played_turn = pokerRooms[roomId].current_turn
    } catch(e) {
      console.log(e)
    }

    io.emit('new-poker-room')

    return res.status(200)
  }

  try {
    delete pokerRooms[roomId].players[userId]

    if (userId === pokerRooms[roomId].host_id) {
      const newHostId = Object.keys(pokerRooms[roomId].players).find(id => id !== userId)
      if (!newHostId) {
        delete pokerRooms[roomId]
      } else {
        pokerRooms[roomId].host_id = newHostId
      }
    }
  } catch (e) {
    //
  }

  io.emit('new-poker-room')
  return res.status(200)
});

app.post('/poker-room/start', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  // preflop
  try {
    for (const playerId in pokerRooms[roomId].players) {
      const player = pokerRooms[roomId].players[playerId]
      for (let i = 0; i < 2; i++) {
        if (pokerRooms[roomId].pioche.length > 0) {
          player.hand.push(pokerRooms[roomId].pioche[0])
          pokerRooms[roomId].pioche.shift()
        }
      }
    }
    for (const playerId in pokerRooms[roomId].players) {
      try {
        const player = pokerRooms[roomId].players[playerId]
        let fullHand = pokerRooms[roomId].tapis
        player.solve = Hand.solve(fullHand.concat(player.hand), 'standard', false)?.descr
      } catch (e) {
        console.log('erreur lors du hand solver')
      }
    }
  } catch (e) {
    console.log(e)
  }

  pokerRooms[roomId].dealer = Object.keys(pokerRooms[roomId].players)[0]
  pokerRooms[roomId].sb = Object.keys(pokerRooms[roomId].players)[1]
  pokerRooms[roomId].bb = Object.keys(pokerRooms[roomId].players)[2 % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[1]].bet = 10 //SB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[1]].bank -= 10 //SB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[2 % Object.keys(pokerRooms[roomId].players).length]].bet = 20 //BB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[2 % Object.keys(pokerRooms[roomId].players).length]].bank -= 20 //BB
  pokerRooms[roomId].highest_bet = 20
  pokerRooms[roomId].current_player = Object.keys(pokerRooms[roomId].players)[3 % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].current_turn = 0;

  pokerRooms[roomId].players[pokerRooms[roomId].bb].last_played_turn = pokerRooms[roomId].current_turn

  if (!pokerRooms[roomId].fakeMoney) {
    const DB_SBplayer = await getUser.get(Object.keys(pokerRooms[roomId].players)[1])
    const DB_BBplayer = await getUser.get(Object.keys(pokerRooms[roomId].players)[2 % Object.keys(pokerRooms[roomId].players).length])
    if (DB_SBplayer) {
      updateUserCoins.run({
        id: DB_SBplayer.id,
        coins: pokerRooms[roomId].players[DB_SBplayer.id].bank,
      })
      insertLog.run({
        id: DB_SBplayer.id + '-' + Date.now(),
        user_id: DB_SBplayer.id,
        action: 'POKER_SMALL_BLIND',
        target_user_id: DB_SBplayer.id,
        coins_amount: -10,
        user_new_amount: DB_SBplayer.coins - 10,
      })
    }
    if (DB_BBplayer) {
      updateUserCoins.run({
        id: DB_BBplayer.id,
        coins: pokerRooms[roomId].players[DB_BBplayer.id].bank,
      })
      insertLog.run({
        id: DB_BBplayer.id + '-' + Date.now(),
        user_id: DB_BBplayer.id,
        action: 'POKER_BIG_BLIND',
        target_user_id: DB_BBplayer.id,
        coins_amount: -20,
        user_new_amount: DB_BBplayer.coins - 20,
      })
    }
    io.emit('data-updated', {table: 'users', action: 'update'});
  }

  pokerRooms[roomId].playing = true
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return res.status(200)
})

async function handleRoomStart(roomId, dealerId = 0) {
  if (!pokerRooms[roomId]) return false

  // preflop
  try {
    for (const playerId in pokerRooms[roomId].players) {
      const player = pokerRooms[roomId].players[playerId]
      for (let i = 0; i < 2; i++) {
        if (pokerRooms[roomId].pioche.length > 0) {
          player.hand.push(pokerRooms[roomId].pioche[0])
          pokerRooms[roomId].pioche.shift()
        }
      }
    }
    for (const playerId in pokerRooms[roomId].players) {
      try {
        const player = pokerRooms[roomId].players[playerId]
        let fullHand = pokerRooms[roomId].tapis
        player.solve = Hand.solve(fullHand.concat(player.hand), 'standard', false)?.descr
      } catch(e) {
        console.log('erreur lors du hand solver')
      }
    }
  } catch (e) {
    console.log(e)
  }

  pokerRooms[roomId].dealer = Object.keys(pokerRooms[roomId].players)[(dealerId + 1) % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].sb = Object.keys(pokerRooms[roomId].players)[(dealerId + 2) % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].bb = Object.keys(pokerRooms[roomId].players)[(dealerId + 3) % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[(dealerId + 2) % Object.keys(pokerRooms[roomId].players).length]].bet = 10 //SB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[(dealerId + 2) % Object.keys(pokerRooms[roomId].players).length]].bank -= 10 //SB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[(dealerId + 3) % Object.keys(pokerRooms[roomId].players).length]].bet = 20 //BB
  pokerRooms[roomId].players[Object.keys(pokerRooms[roomId].players)[(dealerId + 3) % Object.keys(pokerRooms[roomId].players).length]].bank -= 20 //BB
  pokerRooms[roomId].highest_bet = 20
  pokerRooms[roomId].current_player = Object.keys(pokerRooms[roomId].players)[(dealerId + 4) % Object.keys(pokerRooms[roomId].players).length]
  pokerRooms[roomId].current_turn = 0;

  pokerRooms[roomId].players[pokerRooms[roomId].bb].last_played_turn = pokerRooms[roomId].current_turn

  if (!pokerRooms[roomId].fakeMoney) {
    const DB_SBplayer = await getUser.get(Object.keys(pokerRooms[roomId].players)[(dealerId + 2) % Object.keys(pokerRooms[roomId].players).length])
    const DB_BBplayer = await getUser.get(Object.keys(pokerRooms[roomId].players)[(dealerId + 3) % Object.keys(pokerRooms[roomId].players).length])
    if (DB_SBplayer) {
      updateUserCoins.run({
        id: DB_SBplayer.id,
        coins: pokerRooms[roomId].players[DB_SBplayer.id].bank,
      })
      insertLog.run({
        id: DB_SBplayer.id + '-' + Date.now(),
        user_id: DB_SBplayer.id,
        action: 'POKER_SMALL_BLIND',
        target_user_id: DB_SBplayer.id,
        coins_amount: -10,
        user_new_amount: DB_SBplayer.coins - 10,
      })
    }
    if (DB_BBplayer) {
      updateUserCoins.run({
        id: DB_BBplayer.id,
        coins: pokerRooms[roomId].players[DB_BBplayer.id].bank,
      })
      insertLog.run({
        id: DB_BBplayer.id + '-' + Date.now(),
        user_id: DB_BBplayer.id,
        action: 'POKER_BIG_BLIND',
        target_user_id: DB_BBplayer.id,
        coins_amount: -20,
        user_new_amount: DB_BBplayer.coins - 20,
      })
    }
    io.emit('data-updated', {table: 'users', action: 'update'});
  }

  pokerRooms[roomId].playing = true
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/flop', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  //flop
  pokerRooms[roomId].current_turn = 1
  try {
    for (let i = 0; i < 3; i++) {
      if (pokerRooms[roomId].pioche.length > 0) {
        pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
        pokerRooms[roomId].pioche.shift()
      }
    }
    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return res.status(200)
});

async function handleFlop(roomId) {
  if (!pokerRooms[roomId]) return false

  //flop
  pokerRooms[roomId].current_turn = 1
  try {
    for (let i = 0; i < 3; i++) {
      if (pokerRooms[roomId].pioche.length > 0) {
        pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
        pokerRooms[roomId].pioche.shift()
      }
    }
    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/turn', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  //turn
  pokerRooms[roomId].current_turn = 2
  try {
    if (pokerRooms[roomId].pioche.length > 0) {
      pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
      pokerRooms[roomId].pioche.shift()
    }

    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return res.status(200)
});

async function handleTurn(roomId) {
  if (!pokerRooms[roomId]) return false

  //turn
  pokerRooms[roomId].current_turn = 2
  try {
    if (pokerRooms[roomId].pioche.length > 0) {
      pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
      pokerRooms[roomId].pioche.shift()
    }

    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/river', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  //river
  pokerRooms[roomId].current_turn = 3
  try {
    if (pokerRooms[roomId].pioche.length > 0) {
      pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
      pokerRooms[roomId].pioche.shift()
    }

    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return res.status(200)
});

async function handleRiver(roomId) {
  if (!pokerRooms[roomId]) return false

  //river
  pokerRooms[roomId].current_turn = 3
  try {
    if (pokerRooms[roomId].pioche.length > 0) {
      pokerRooms[roomId].tapis.push(pokerRooms[roomId].pioche[0])
      pokerRooms[roomId].pioche.shift()
    }

    await updatePokerPlayersSolve(roomId)
  } catch(e) {
    console.log(e)
  }

  pokerRooms[roomId].current_player = getFirstActivePlayerAfterDealer(pokerRooms[roomId])
  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/showdown', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  //showdown
  pokerRooms[roomId].current_turn = 4
  pokerRooms[roomId].current_player = null

  await updatePokerPlayersSolve(roomId)

  pokerRooms[roomId].winners = checkRoomWinners(pokerRooms[roomId])

  try {
    const url = (process.env.DEV_SITE === 'true' ? process.env.API_URL_DEV : process.env.API_URL) + '/poker-room/winner'
    const response = await axios.post(url, { roomId: roomId, winnerIds: pokerRooms[roomId].winners })
  } catch (e) {
    console.log(e)
  }

  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return res.status(200)
})

async function handleShowdown(roomId) {
  if (!pokerRooms[roomId]) return false

  //showdown
  pokerRooms[roomId].current_turn = 4
  pokerRooms[roomId].current_player = null

  await updatePokerPlayersSolve(roomId)

  pokerRooms[roomId].winners = checkRoomWinners(pokerRooms[roomId])

  try {
    await handleWinner(roomId, pokerRooms[roomId].winners)
  } catch (e) {
    console.log(e)
  }

  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/progressive-showdown', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  while(pokerRooms[roomId].current_turn < 4) {
    let allGood = true
    switch (pokerRooms[roomId].current_turn) {
      case 0:
        allGood = await handleFlop(roomId)
        break;
      case 1:
        allGood = await handleTurn(roomId)
        break;
      case 2:
        allGood = await handleRiver(roomId)
        break;
      case 3:
        allGood = await handleShowdown(roomId)
        break;
      default:
        allGood = false
        break;
    }

    if (!allGood) console.log('error in progressive showdown')

    await sleep(1000)
  }

  return res.status(200)
})

app.post('/poker-room/winner', async (req, res) => {
  const { roomId, winnerIds } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  //if (!pokerRooms[roomId].players[winnerIds]) return res.status(404).send({ message: 'Joueur introuvable' })

  pokerRooms[roomId].current_player = null
  pokerRooms[roomId].current_turn = 4

  let pool = 0;
  for (const playerId in pokerRooms[roomId].players) {
    const player = pokerRooms[roomId].players[playerId]
    pool += player?.bet ?? 0
    player.bet = 0
    if (player.bank === 0 && !pokerRooms[roomId].winners.includes(player.id)) {
      try {
        delete pokerRooms[roomId].players[player.id]

        if (player.id === pokerRooms[roomId].host_id) {
          const newHostId = Object.keys(pokerRooms[roomId].players).find(id => id !== player.id)
          if (!newHostId) {
            delete pokerRooms[roomId]
          } else {
            pokerRooms[roomId].host_id = newHostId
          }
        }
      } catch (e) {
        //
      }
    }
  }

  pokerRooms[roomId].winners.forEach((winner) => {
    pokerRooms[roomId].players[winner].bank += Math.floor(pool / winnerIds.length)
    if (!pokerRooms[roomId].fakeMoney) {
      const DBplayer = getUser.get(winner)
      if (DBplayer) {
        updateUserCoins.run({
          id: winner,
          coins: pokerRooms[roomId].players[winner].bank,
        })
        insertLog.run({
          id: winner + '-' + Date.now(),
          user_id: winner,
          action: 'POKER_WIN',
          target_user_id: winner,
          coins_amount: Math.floor(pool / winnerIds.length),
          user_new_amount: pokerRooms[roomId].players[winner].bank,
        })
      }
      io.emit('data-updated', {table: 'users', action: 'update'});
    }
  });

  pokerRooms[roomId].waiting_for_restart = true

  io.emit('player-winner', { roomId: roomId, playerIds: winnerIds, amount: Math.floor(pool / winnerIds.length) })

  await pokerEloHandler(pokerRooms[roomId])

  io.emit('new-poker-room')
  return res.status(200)
})

async function handleWinner(roomId, winnerIds) {
  if (!pokerRooms[roomId]) return false

  pokerRooms[roomId].current_player = null
  pokerRooms[roomId].current_turn = 4

  let pool = 0;
  for (const playerId in pokerRooms[roomId].players) {
    const player = pokerRooms[roomId].players[playerId]
    pool += player?.bet ?? 0
    player.bet = 0
    if (player.bank === 0 && !pokerRooms[roomId].winners.includes(player.id)) {
      try {
        delete pokerRooms[roomId].players[player.id]
      } catch (e) {
        //
      }
    }
  }

  pokerRooms[roomId].winners = checkRoomWinners(pokerRooms[roomId])

  pokerRooms[roomId]?.winners.forEach((winner) => {
    pokerRooms[roomId].players[winner].bank += Math.floor(pool / winnerIds.length)
  });

  pokerRooms[roomId].waiting_for_restart = true

  io.emit('player-winner', { roomId: roomId, playerIds: pokerRooms[roomId].winners, amount: Math.floor(pool / winnerIds.length) })

  await pokerEloHandler(pokerRooms[roomId])

  io.emit('new-poker-room')
  return true
}

app.post('/poker-room/next-round', async (req, res) => {
  const { roomId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })

  const dealerId = Object.keys(pokerRooms[roomId].players).findIndex(p => p === pokerRooms[roomId].dealer)
  console.log('dealer id', dealerId)

  pokerRooms[roomId].waiting_for_restart = false
  pokerRooms[roomId].winners = []
  pokerRooms[roomId].pioche = initialShuffledCards()
  pokerRooms[roomId].tapis = []
  pokerRooms[roomId].dealer = null
  pokerRooms[roomId].sb = null
  pokerRooms[roomId].bb = null
  pokerRooms[roomId].highest_bet = null
  pokerRooms[roomId].current_player = null
  pokerRooms[roomId].current_turn = null

  for (const playerId in pokerRooms[roomId].afk) {
    try {
      delete pokerRooms[roomId].players[playerId]
    } catch (e) { console.log(e) }
    try {
      delete pokerRooms[roomId].afk[playerId]
    } catch (e) { console.log(e) }
  }

  for (const playerId in pokerRooms[roomId].players) {
    const player = pokerRooms[roomId].players[playerId]
    player.hand = []
    player.bet = null
    player.solve = null
    player.folded = false
    player.allin = false
    player.last_played_turn = null
    player.is_last_raiser = false
  }

  try {
    await handleRoomStart(roomId, dealerId)
  } catch (e) {
    console.log(e)
  }

  io.emit('new-poker-room')
  return res.status(200)
})

app.post('/poker-room/action/fold', async (req, res) => {
  const { roomId, playerId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  if (!pokerRooms[roomId].players[playerId]) return res.status(404).send({ message: 'Joueur introuvable' })

  if (pokerRooms[roomId].current_player !== playerId) return res.status(403).send({ message: 'Ce n\'est pas ton tour' });

  try {
    pokerRooms[roomId].players[playerId].folded = true
    pokerRooms[roomId].players[playerId].last_played_turn = pokerRooms[roomId].current_turn

    io.emit('player-fold', { roomId: roomId, playerId: playerId, playerName: pokerRooms[roomId].players[playerId].globalName })

    await checksAfterPokerAction(roomId)

    io.emit('new-poker-room')
  } catch(e) {
    console.log(e)
    return res.status(500).send({ message: e})
  }

  return res.status(200)
});

app.post('/poker-room/action/check', async (req, res) => {
  const { roomId, playerId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  if (!pokerRooms[roomId].players[playerId]) return res.status(404).send({ message: 'Joueur introuvable' })

  if (pokerRooms[roomId].current_player !== playerId) return res.status(403).send({ message: 'Ce n\'est pas ton tour' });

  try {
    pokerRooms[roomId].players[playerId].last_played_turn = pokerRooms[roomId].current_turn

    io.emit('player-check', { roomId: roomId, playerId: playerId, playerName: pokerRooms[roomId].players[playerId].globalName })

    await checksAfterPokerAction(roomId)

    io.emit('new-poker-room')
  } catch(e) {
    console.log(e)
    return res.status(500).send({ message: e})
  }

  return res.status(200)
});

app.post('/poker-room/action/call', async (req, res) => {
  const { roomId, playerId } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  if (!pokerRooms[roomId].players[playerId]) return res.status(404).send({ message: 'Joueur introuvable' })

  if (pokerRooms[roomId].current_player !== playerId) return res.status(403).send({ message: 'Ce n\'est pas ton tour' });

  try {
    let diff = pokerRooms[roomId].highest_bet - pokerRooms[roomId].players[playerId].bet
    if (diff > pokerRooms[roomId].players[playerId].bank) {
      diff = pokerRooms[roomId].players[playerId].bank
      pokerRooms[roomId].players[playerId].allin = true
    }
    pokerRooms[roomId].players[playerId].bet += diff
    pokerRooms[roomId].players[playerId].bank -= diff
    pokerRooms[roomId].players[playerId].last_played_turn = pokerRooms[roomId].current_turn

    if (Object.values(pokerRooms[roomId].players).find(p => p.allin)) pokerRooms[roomId].players[playerId].allin = true
    if (!pokerRooms[roomId].fakeMoney) {
      const DBplayer = await getUser.get(playerId)
      if (DBplayer) {
        updateUserCoins.run({
          id: playerId,
          coins: pokerRooms[roomId].players[playerId].bank,
        })
        insertLog.run({
          id: playerId + '-' + Date.now(),
          user_id: playerId,
          action: 'POKER_CALL',
          target_user_id: playerId,
          coins_amount: -diff,
          user_new_amount: pokerRooms[roomId].players[playerId].bank,
        })
      }
      io.emit('data-updated', { table: 'users', action: 'update' });
    }

    io.emit('player-call', { roomId: roomId, playerId: playerId, playerName: pokerRooms[roomId].players[playerId].globalName })

    await checksAfterPokerAction(roomId)

    io.emit('new-poker-room')
  } catch(e) {
    console.log(e)
    return res.status(500).send({ message: e})
  }

  return res.status(200)
});

app.post('/poker-room/action/raise', async (req, res) => {
  const { roomId, playerId, amount } = req.body

  if (!pokerRooms[roomId]) return res.status(404).send({ message: 'Table introuvable' })
  if (!pokerRooms[roomId].players[playerId]) return res.status(404).send({ message: 'Joueur introuvable' })

  if (pokerRooms[roomId].current_player !== playerId) return res.status(403).send({ message: 'Ce n\'est pas ton tour' });
  if (amount > pokerRooms[roomId].players[playerId].bank) return res.status(403).send({ message: 'Tu n\as pas assez'});

  try {
    if (amount === pokerRooms[roomId].players[playerId].bank) {
      pokerRooms[roomId].players[playerId].allin = true
    }
    pokerRooms[roomId].players[playerId].bet += amount
    pokerRooms[roomId].players[playerId].bank -= amount
    pokerRooms[roomId].players[playerId].last_played_turn = pokerRooms[roomId].current_turn
    for (let id in pokerRooms[roomId].players) {
      pokerRooms[roomId].players[id].is_last_raiser = false
    }
    pokerRooms[roomId].players[playerId].is_last_raiser = true
    pokerRooms[roomId].highest_bet = pokerRooms[roomId].players[playerId].bet

    if (!pokerRooms[roomId].fakeMoney) {
      const DBplayer = await getUser.get(playerId)
      if (DBplayer) {
        updateUserCoins.run({
          id: playerId,
          coins: DBplayer.coins - amount,
        })
        insertLog.run({
          id: playerId + '-' + Date.now(),
          user_id: playerId,
          action: 'POKER_RAISE',
          target_user_id: playerId,
          coins_amount: -amount,
          user_new_amount: DBplayer.coins - amount,
        })
      }
      io.emit('data-updated', { table: 'users', action: 'update' });
    }

    io.emit('player-raise', { roomId: roomId, playerId: playerId, amount: amount, playerName: pokerRooms[roomId].players[playerId].globalName })

    await checksAfterPokerAction(roomId)

    io.emit('new-poker-room')
  } catch(e) {
    console.log(e)
    return res.status(500).send({ message: e})
  }

  return res.status(200)
});

async function checksAfterPokerAction(roomId) {
  const data = checkEndOfBettingRound(pokerRooms[roomId])

  if (data.winner !== null) {
    try {
      pokerRooms[roomId].winners = [data.winner]
      const url = (process.env.DEV_SITE === 'true' ? process.env.API_URL_DEV : process.env.API_URL) + '/poker-room/winner'
      const response = await axios.post(url, { roomId: roomId, winnerIds: [data.winner] })
    } catch (e) {
      console.log(e)
    }
  } else if (data.endRound) {
    try {
      const url = (process.env.DEV_SITE === 'true' ? process.env.API_URL_DEV : process.env.API_URL) + '/poker-room/' + data.nextPhase
      const response = await axios.post(url, { roomId: roomId})
    } catch (e) {
      console.log(e)
    }
  } else {
    pokerRooms[roomId].current_player = getNextActivePlayer(pokerRooms[roomId])
  }

  pokerRooms[roomId].last_move_at = Date.now()

  io.emit('new-poker-room')
}

async function updatePokerPlayersSolve(roomId) {
  for (const playerId in pokerRooms[roomId].players) {
    const player = pokerRooms[roomId].players[playerId]
    let fullHand = pokerRooms[roomId].tapis
    player.solve = Hand.solve(fullHand.concat(player.hand), 'standard', false)?.descr
  }
}

import http from 'http';
import { Server } from 'socket.io';
import * as test from "node:test";
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    Origin: FLAPI_URL,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  }
});

let queue = []
let playingArray = []

io.on('connection', (socket) => {

  socket.on('user-connected', async (user) => {
    const username = getUser.get(user)

    queue = queue.filter(obj => obj !== user)
    let names = [];
    for (const n of queue) {
      let name = await client.users.fetch(n)
      names.push(name?.username)
    }
    io.emit('tictactoequeue', { allPlayers: playingArray, queue: names })
  })

  socket.on('tictactoeconnection', async (e) => {
    queue = queue.filter(obj => obj !== e.id)
    let names = [];
    for (const n of queue) {
      let name = await client.users.fetch(n)
      names.push(name?.username)
    }
    io.emit('tictactoequeue', { allPlayers: playingArray, queue: names })
  })

  socket.on('tictactoequeue', async (e) => {
    console.log(`${e.playerId} in tic tac toe queue`);

    let msgId;

    if (!queue.find(obj => obj === e.playerId)) {
      queue.push(e.playerId)

      if (queue.length === 1) {
        try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          const generalChannel = guild.channels.cache.find(
              ch => ch.name === 'général' || ch.name === 'general'
          );
          const user = await client.users.fetch(e.playerId)

          const embed = new EmbedBuilder()
              .setTitle(`Tic Tac Toe`)
              .setDescription(`**${user.username}** est dans la file d'attente`)
              .setColor('#5865f2')
              .setTimestamp(new Date());

          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setLabel(`Jouer contre ${user.username}`)
                      .setURL(`${process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/tic-tac-toe`)
                      .setStyle(ButtonStyle.Link)
              )

          await generalChannel.send({ embeds: [embed], components: [row] });
        } catch (e) {
          console.log(e)
        }
      }
    }

    if (queue.length >= 2) {
      let p1 = await client.users.fetch(queue[0])
      let p2 = await client.users.fetch(queue[1])

      let msgId
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const generalChannel = guild.channels.cache.find(
            ch => ch.name === 'général' || ch.name === 'general'
        );

        const embed = new EmbedBuilder()
            .setTitle(`Tic Tac Toe`)
            .setDescription(`### **❌ ${p1.globalName}** vs **${p2.globalName} ⭕**\n` +
                `🟦🟦🟦\n` +
                `🟦🟦🟦\n` +
                `🟦🟦🟦\n`)
            .setColor('#5865f2')
            .setTimestamp(new Date());

        const msg = await generalChannel.send({ embeds: [embed] });
        msgId = msg.id
      } catch (e) {
        console.log(e)
      }

      let p1obj = {
        id: queue[0],
        name: p1.globalName,
        val: 'X',
        move: "",
      }
      let p2obj = {
        id: queue[1],
        name: p2.globalName,
        val: 'O',
        move: "",
      }

      let lobby = {
        p1: p1obj,
        p2: p2obj,
        sum: 1,
        xs: [],
        os: [],
        lastmove: Date.now(),
        msgId: msgId,
      }

      playingArray.push(lobby)

      queue.splice(0, 2)
    }

    let names = [];
    for (const n of queue) {
      let name = await client.users.fetch(n)
      names.push(name?.globalName)
    }

    io.emit('tictactoequeue', { allPlayers: playingArray, queue: names })
  })

  socket.on('tictactoeplaying', async (e) => {
    console.log('playing', e.value)
    let lobbyToChange;
    if (e.value === 'X') {
      lobbyToChange = playingArray.find(obj => obj.p1.id === e.playerId)

      if (lobbyToChange.sum%2 === 1) {
        console.log('yeah', e.value)
        lobbyToChange.p2.move = ''
        lobbyToChange.p1.move = e.boxId
        lobbyToChange.sum++
        lobbyToChange.xs.push(e.boxId)
        lobbyToChange.lastmove = Date.now()
      }
    }
    else if (e.value === 'O') {
      lobbyToChange = playingArray.find(obj => obj.p2.id === e.playerId)

      if (lobbyToChange.sum%2 === 0) {
        console.log('yeah', e.value)
        lobbyToChange.p1.move = ''
        lobbyToChange.p2.move = e.boxId
        lobbyToChange.sum++
        lobbyToChange.os.push(e.boxId)
        lobbyToChange.lastmove = Date.now()
      }
    }

    let gridText = ''
    for (let i = 1; i <= 9; i++) {
      if (lobbyToChange.os.includes(i)) {
        gridText += '⭕'
      } else if (lobbyToChange.xs.includes(i)) {
        gridText += '❌'
      } else {
        gridText += '🟦'
      }
      if (i%3 === 0) {
        gridText += '\n'
      }
    }

    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const generalChannel = await guild.channels.cache.find(
          ch => ch.name === 'général' || ch.name === 'general'
      );

      const message = await generalChannel.messages.fetch(lobbyToChange.msgId)

      const embed = new EmbedBuilder()
          .setTitle(`Tic Tac Toe`)
          .setDescription(`### **❌ ${lobbyToChange.p1.name}** vs **${lobbyToChange.p2.name} ⭕**\n` + gridText)
          .setColor('#5865f2')
          .setTimestamp(new Date());

      await message.edit({ embeds: [embed] });
    } catch (e) {
      console.log(e)
    }

    io.emit('tictactoeplaying', { allPlayers: playingArray })
  })

  socket.on('tictactoegameOver', async (e) => {
    const winner = e.winner
    const game = playingArray.find(obj => obj.p1.id === e.playerId)

    if (game && game.sum < 100) {
      game.sum = 100
      let gridText = ''
      for (let i = 1; i <= 9; i++) {
        if (game.os.includes(i)) {
          gridText += '⭕'
        } else if (game.xs.includes(i)) {
          gridText += '❌'
        } else {
          gridText += '🟦'
        }
        if (i%3 === 0) {
          gridText += '\n'
        }
      }

      if (winner === null) {
        await eloHandler(game.p1.id, game.p2.id, 0.5, 0.5, 'TICTACTOE')

        try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          const generalChannel = await guild.channels.cache.find(
              ch => ch.name === 'général' || ch.name === 'general'
          );

          const message = await generalChannel.messages.fetch(game.msgId)

          const embed = new EmbedBuilder()
              .setTitle(`Tic Tac Toe`)
              .setDescription(`### **❌ ${game.p1.name}** vs **${game.p2.name} ⭕**\n` + gridText + `\n### Égalité`)
              .setColor('#5865f2')
              .setTimestamp(new Date());

          await message.edit({ embeds: [embed] });
        } catch (e) {
          console.log(e)
        }
      } else {
        await eloHandler(game.p1.id, game.p2.id, game.p1.id === winner ? 1 : 0, game.p2.id === winner ? 1 : 0, 'TICTACTOE')

        try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          const generalChannel = await guild.channels.cache.find(
              ch => ch.name === 'général' || ch.name === 'general'
          );

          const message = await generalChannel.messages.fetch(game.msgId)

          const embed = new EmbedBuilder()
              .setTitle(`Tic Tac Toe`)
              .setDescription(`### **❌ ${game.p1.name}** vs **${game.p2.name} ⭕**\n` + gridText + `\n### Victoire de ${game.p1.id === winner ? game.p1.name : game.p2.name}`)
              .setColor('#5865f2')
              .setTimestamp(new Date());

          await message.edit({ embeds: [embed] });
        } catch (e) {
          console.log(e)
        }

      }
    }

    playingArray = playingArray.filter(obj => obj.p1.id !== e.playerId)
  })
});

server.listen(PORT, () => {
  console.log(`Express+Socket.IO listening on port ${PORT}`);
});

