import 'dotenv/config';
import http from 'http';
import { Server } from 'socket.io';

import { app } from './src/server/app.js';
import { client } from './src/bot/client.js';
import { initializeEvents } from './src/bot/events.js';
import { initializeSocket } from './src/server/socket.js';
import { getAkhys, setupCronJobs } from './src/utils/index.js';

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 25578;
const server = http.createServer(app);

// --- SOCKET.IO INITIALIZATION ---
const FLAPI_URL = process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL;
export const io = new Server(server, {
    cors: {
        origin: FLAPI_URL,
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    },
    pingInterval: 5000,
    pingTimeout: 5000,
});
initializeSocket(io, client);


// --- BOT INITIALIZATION ---
initializeEvents(client, io);
client.login(process.env.BOT_TOKEN).then(() => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log('[Discord Bot Events Initialized]');
});


// --- APP STARTUP ---
server.listen(PORT, async () => {
    console.log(`Express+Socket.IO server listening on port ${PORT}`);
    console.log(`[Connected with ${FLAPI_URL}]`);

    // Initial data fetch and setup
    try {
        await getAkhys(client);
    } catch (error) {
        console.log('Initial Fetch Error');
    }

    // Setup scheduled tasks
    //setupCronJobs(client, io);
    console.log('[Cron Jobs Initialized]');

    console.log('--- FlopoBOT is ready ---');
});