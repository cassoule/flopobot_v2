import 'dotenv/config';
import OpenAI from "openai";

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
export function getRandomEmoji() {
  const emojiList = ['😭','😄','😌','🤓','😎','😤','🤖','😶‍🌫️','🌏','📸','💿','👋','🌊','✨'];
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

export async function gork(messageHistory) {
  const openai = new OpenAI();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: messageHistory,
  });

  return completion.choices[0].message.content;
}