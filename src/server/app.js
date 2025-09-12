import 'dotenv/config';
import express from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from '../bot/handlers/interactionCreate.js';
import { client } from '../bot/client.js';

// Import route handlers
import { apiRoutes } from './routes/api.js';
import { pokerRoutes } from './routes/poker.js';
import { solitaireRoutes } from './routes/solitaire.js';
import {getSocketIo} from "./socket.js";
import {erinyesRoutes} from "./routes/erinyes.js";
import {blackjackRoutes} from "./routes/blackjack.js";

// --- EXPRESS APP INITIALIZATION ---
const app = express();
const io = getSocketIo();
const FLAPI_URL = process.env.DEV_SITE === 'true' ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL;

// --- GLOBAL MIDDLEWARE ---

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', FLAPI_URL);
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, ngrok-skip-browser-warning, Cache-Control, Pragma, Expires');
    next();
});

// --- PRIMARY DISCORD INTERACTION ENDPOINT ---
// This endpoint handles all interactions sent from Discord (slash commands, buttons, etc.)
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async (req, res) => {
    // The actual logic is delegated to a dedicated handler for better organization
    await handleInteraction(req, res, client);
});

// JSON Body Parser Middleware
app.use(express.json());

// --- STATIC ASSETS ---
app.use('/public', express.static('public'));


// --- API ROUTES ---

// General API routes (users, polls, etc.)
app.use('/api', apiRoutes(client, io));

// Poker-specific routes
app.use('/api/poker', pokerRoutes(client, io));

// Solitaire-specific routes
app.use('/api/solitaire', solitaireRoutes(client, io));

app.use('/api/blackjack', blackjackRoutes(client, io));

// erinyes-specific routes
app.use('/api/erinyes', erinyesRoutes(client, io));


export { app };