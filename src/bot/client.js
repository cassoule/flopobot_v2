import { Client, GatewayIntentBits } from 'discord.js';

/**
 * The single, shared Discord.js Client instance for the entire application.
 * It is configured with all the necessary intents to receive the events it needs.
 */
export const client = new Client({
    // Define the events the bot needs to receive from Discord's gateway.
    intents: [
        // Required for basic guild information and events.
        GatewayIntentBits.Guilds,

        // Required to receive messages in guilds (e.g., in #general).
        GatewayIntentBits.GuildMessages,

        // A PRIVILEGED INTENT, required to read the content of messages.
        // This is necessary for the AI handler, admin commands, and "quoi/feur".
        GatewayIntentBits.MessageContent,

        // Required to receive updates when members join, leave, or are updated.
        // Crucial for fetching member details for commands like /timeout or /info.
        GatewayIntentBits.GuildMembers,

        // Required to receive member presence updates (online, idle, offline).
        // Necessary for features like `getOnlineUsersWithRole`.
        GatewayIntentBits.GuildPresences,
    ],
});