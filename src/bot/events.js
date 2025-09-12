import { handleMessageCreate } from './handlers/messageCreate.js';
import { getAkhys, setupCronJobs } from '../utils/index.js';

/**
 * Initializes and attaches all necessary event listeners to the Discord client.
 * This function should be called once the client is ready.
 *
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance for real-time communication.
 */
export function initializeEvents(client, io) {
    // --- on 'ready' ---
    // This event fires once the bot has successfully logged in and is ready to operate.
    // It's a good place for setup tasks that require the bot to be online.
    client.once('clientReady', async () => {
        console.log(`Bot is ready and logged in as ${client.user.tag}!`);
        console.log('[Startup] Bot is ready, performing initial data sync...');
        await getAkhys(client);
        console.log('[Startup] Setting up scheduled tasks...');
        setupCronJobs(client, io);
        console.log('--- FlopoBOT is fully operational ---');
    });

    // --- on 'messageCreate' ---
    // This event fires every time a message is sent in a channel the bot can see.
    // The logic is delegated to its own dedicated handler for cleanliness.
    client.on('messageCreate', async (message) => {
        // We pass the client and io instances to the handler so it has access to them
        // without needing to import them, preventing potential circular dependencies.
        await handleMessageCreate(message, client, io);
    });

    // --- on 'interactionCreate' (Alternative Method) ---
    // While we handle interactions via the Express endpoint for scalability and statelessness,
    // you could also listen for them via the gateway like this.
    // It's commented out because our current architecture uses the webhook approach.
    /*
    client.on('interactionCreate', async (interaction) => {
      // Logic to handle interactions would go here if not using a webhook endpoint.
    });
    */

    // You can add more event listeners here as your bot's functionality grows.
    // For example, listening for new members joining the server:
    // client.on('guildMemberAdd', (member) => {
    //   console.log(`Welcome to the server, ${member.user.tag}!`);
    //   const welcomeChannel = member.guild.channels.cache.get('YOUR_WELCOME_CHANNEL_ID');
    //   if (welcomeChannel) {
    //     welcomeChannel.send(`Please welcome <@${member.id}> to the server!`);
    //   }
    // });
}