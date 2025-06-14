import 'dotenv/config';
import OpenAI from "openai";
import {GoogleGenAI} from "@google/genai";
import {Mistral} from '@mistralai/mistralai';
import pkg from 'pokersolver';

const { Hand } = pkg;

export async function DiscordRequest(endpoint, options) {
  // append endpoint to root API URL
  const url = 'https://discord.com/api/v10/' + endpoint;
  // Stringify payloads
  if (options.body) options.body = JSON.stringify(options.body);
  // Use fetch to make requests
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)',
    },
    ...options
  });
  // throw API errors
  if (!res.ok) {
    const data = await res.json();
    console.log(res.status);
    throw new Error(JSON.stringify(data));
  }
  // return original response
  return res;
}

export async function InstallGlobalCommands(appId, commands) {
  // API endpoint to overwrite global commands
  const endpoint = `applications/${appId}/commands`;

  try {
    // This is calling the bulk overwrite endpoint: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
    await DiscordRequest(endpoint, { method: 'PUT', body: commands });
  } catch (err) {
    console.error(err);
  }
}

// Simple method that returns a random emoji from list
export function getRandomEmoji(list=0) {
    let emojiList

    switch (list) {
        case 0:
            emojiList = ['😭','😄','😌','🤓','😎','😤','🤖','😶‍🌫️','🌏','📸','💿','👋','🌊','✨']
            break
        case 1:
            emojiList = [
                '<:CAUGHT:1323810730155446322>',
                '<:hinhinhin:1072510144933531758>',
                '<:o7:1290773422451986533>',
                '<:zhok:1115221772623683686>',
                '<:nice:1154049521110765759>',
                '<:nerd:1087658195603951666>',
                '<:peepSelfie:1072508131839594597>',
            ]
            break
        default:
            emojiList = ['']
            break
    }
  return emojiList[Math.floor(Math.random() * emojiList.length)];
}
export function getRandomHydrateText() {
  const texts = [
      `Hydratez-vous`,
      `Pensez à vous hydratez`,
      `Vous vous êtes hydratez aujourd'hui ?`,
      `Buvez de l'eau la team`,
      `#etsi vous vous hydratiez`,
      `Oubliez pas de vous hydratez`,
      `Hydratez vous la team`,
      `Hydratez vous c'est important`,
      `Hydratez-vous`,
      `Pensez à vous hydratez`,
      `Vous vous êtes hydratez aujourd'hui ?`,
      `Buvez de l'eau la team`,
      `#etsi vous vous hydratiez`,
      `Oubliez pas de vous hydratez`,
      `Hydratez vous la team`,
      `Hydratez vous c'est important`,
      `Hydratez-vous`,
      `Pensez à vous hydratez`,
      `Vous vous êtes hydratez aujourd'hui ?`,
      `Buvez de l'eau la team`,
      `#etsi vous vous hydratiez`,
      `Oubliez pas de vous hydratez`,
      `Hydratez vous la team`,
      `Hydratez vous c'est important`,
      `nsm ojd ça s'hydrate pas`,
  ];
  return texts[Math.floor(Math.random() * texts.length)];
}

export const initialCards = [
    'Ad', '2d', '3d', '4d', '5d', '6d', '7d', '8d', '9d', 'Td', 'Jd', 'Qd', 'Kd',
    'As', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', 'Ts', 'Js', 'Qs', 'Ks',
    'Ac', '2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c', 'Tc', 'Jc', 'Qc', 'Kc',
    'Ah', '2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h', 'Th', 'Jh', 'Qh', 'Kh',
]

export function initialShuffledCards() {
    return initialCards.sort((a, b) => 0.5 - Math.random());
}
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function getOnlineUsersWithRole(guildId, roleId) {
  const endpoint = `/guilds/${guildId}/members?limit=1000`;
  const response = await DiscordRequest(endpoint, { method: 'GET' });

  const members = await response.json();
  return members.filter(
      (m) =>
          m.roles.includes(roleId) &&
          m.presence?.status !== 'offline'
  );
}

export function formatTime(time) {
  const days = Math.floor(time / (24 * 60 * 60));
  const hours = Math.floor((time % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((time % (60 * 60)) / 60);
  const seconds = time % 60;

  const parts = [];

  if (days > 0) parts.push(`**${days}** jour${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`**${hours}** heure${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`**${minutes}** minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`**${seconds}** seconde${seconds > 1 ? 's' : ''}`);

  return parts.join(', ').replace(/,([^,]*)$/, ' et$1');
}

const openai = new OpenAI();
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_KEY})
const leChat = new Mistral({apiKey: process.env.MISTRAL_KEY});

export async function gork(messageHistory) {
  if (process.env.MODEL === 'OpenAI') {
    // OPEN AI
    const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: messageHistory,
      });

    return completion.choices[0].message.content;
  }
  else if (process.env.MODEL === 'Gemini') {
    //GEMINI
    const formattedHistory = messageHistory.map(msg => {
        return `${msg.role}: ${msg.content}`;
      }).join('\n');
    const response = await gemini.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: formattedHistory,
      })
    return response.text
  } else if (process.env.MODEL === 'Mistral') {
    // MISTRAL
    const chatResponse = await leChat.chat.complete({
      model: 'mistral-large-latest',
      messages: messageHistory,
    })

    return chatResponse.choices[0].message.content
  } else {
    return "Pas d'IA"
  }
}

export async function getAPOUsers() {
    const fetchUrl = process.env.APO_BASE_URL + '/users?serverId=' + (process.env.T12_GUILD_ID ?? process.env.GUILD_ID)
    console.log(fetchUrl)
    return await fetch(fetchUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error fetching APO users')
            }
            return response.json()
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });
}

export async function postAPOBuy(userId, amount) {
    const fetchUrl = process.env.APO_BASE_URL + '/buy?serverId=' + (process.env.T12_GUILD_ID ?? process.env.GUILD_ID) + '&userId=' + userId + '&amount=' + amount
    console.log(fetchUrl)
    return await fetch(fetchUrl, {
        method: 'POST',
    })
        .then(response => response)
        .catch(error => console.log('Post error:', error))
}

export function getFirstActivePlayerAfterDealer(room) {
    const players = Object.values(room.players);
    const dealerPosition = players.findIndex((p) => p.id === room.dealer);
    for (let i = 1; i < players.length; i++) {
        const nextPos = (dealerPosition + i) % players.length;
        if (!players[nextPos].folded && !players[nextPos].allin) {
            return players[nextPos].id;
        }
    }
    return null;
}

export function getNextActivePlayer(room) {
    const players = Object.values(room.players);
    const currentPlayerPosition = players.findIndex((p) => p.id === room.current_player);
    for (let i = 1; i < players.length; i++) {
        const nextPos = (currentPlayerPosition + i) % players.length;
        if (!players[nextPos].folded && !players[nextPos].allin) {
            return players[nextPos].id;
        }
    }
    return null;
}

export function checkEndOfBettingRound(room) {
    const players = Object.values(room.players);
    const activePlayers = players.filter((p) => !p.folded);

    if (activePlayers.length === 1) {
        return { endRound: true, winner: activePlayers[0].id, nextPhase: null };
    }

    const allInPlayers = activePlayers.filter(p => p.allin)
    if (allInPlayers.length === activePlayers.length) {
        return { endRound: true, winner: null, nextPhase: 'progressive-showdown' };
    }

    const allActed = activePlayers.every(p => (p.bet === room.highest_bet || p.allin) && p.last_played_turn === room.current_turn);

    if (allActed) {
        let nextPhase;
        switch (room.current_turn) {
            case 0:
                nextPhase = 'flop';
                break;
            case 1:
                nextPhase = 'turn';
                break;
            case 2:
                nextPhase = 'river';
                break;
            case 3:
                nextPhase = 'showdown';
                break;
            default:
                nextPhase = null;
                break;
        }
        return { endRound: true, winner: null, nextPhase: nextPhase };
    }

    return { endRound: false, winner: null, nextPhase: null };
}

export function checkRoomWinners(room) {
    const players = Object.values(room.players);
    const activePlayers = players.filter(p => !p.folded);

    const playerSolutions = activePlayers.map(player => ({
        id: player.id,
        solution: Hand.solve([...room.tapis, ...player.hand], 'standard', false)
    }));

    const solutions = playerSolutions.map(ps => ps.solution);

    const winningIndices = Hand.winners(solutions).map(winningHand =>
        solutions.findIndex(sol => sol === winningHand)
    );

    return winningIndices.map(index => playerSolutions[index].id);
}