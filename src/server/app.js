import "dotenv/config";
import express from "express";
import { verifyKeyMiddleware } from "discord-interactions";
import { handleInteraction } from "../bot/handlers/interactionCreate.js";
import { client } from "../bot/client.js";

// Import route handlers
import { apiRoutes } from "./routes/api.js";
import { pokerRoutes } from "./routes/poker.js";
import { solitaireRoutes } from "./routes/solitaire.js";
import { sudokuRoutes } from "./routes/sudoku.js";
import { getSocketIo } from "./socket.js";
import { blackjackRoutes } from "./routes/blackjack.js";
import { marketRoutes } from "./routes/market.js";
import { monkeRoutes } from "./routes/monke.js";
import { authRoutes } from "./routes/auth.js";
import { maintenance } from "../game/state.js";

// --- EXPRESS APP INITIALIZATION ---
const app = express();
const io = getSocketIo();
const FLAPI_URL = process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL;

// --- GLOBAL MIDDLEWARE ---

// CORS Middleware
app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", FLAPI_URL);
	res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
	res.header(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-API-Key, ngrok-skip-browser-warning, Cache-Control, Pragma, Expires",
	);
	if (req.method === "OPTIONS") return res.sendStatus(204);
	next();
});

// --- PRIMARY DISCORD INTERACTION ENDPOINT ---
// This endpoint handles all interactions sent from Discord (slash commands, buttons, etc.)
app.post("/interactions", verifyKeyMiddleware(process.env.PUBLIC_KEY), async (req, res) => {
	// The actual logic is delegated to a dedicated handler for better organization
	await handleInteraction(req, res, client);
});

// Stripe webhook endpoint needs raw body for signature verification
app.use("/api/buy-coins", express.raw({ type: "application/json" }));

// JSON Body Parser Middleware
app.use(express.json());

// --- STATIC ASSETS ---
app.use("/public", express.static("public"));

// --- HEALTH CHECK (before maintenance gate) ---
app.get("/api/check", (req, res) => {
	if (maintenance.active) {
		return res.status(503).json({
			error: "maintenance",
			message: "L'API est en maintenance.",
			estimatedEnd: maintenance.scheduledEnd || null,
		});
	}
	if (maintenance.scheduledStart) {
		return res.status(200).json({
			status: "OK",
			scheduledMaintenance: {
				startsAt: maintenance.scheduledStart,
				estimatedEnd: maintenance.scheduledEnd,
			},
		});
	}
	res.status(200).json({ status: "OK", message: "FlopoBot API is running." });
});

// --- MAINTENANCE MODE MIDDLEWARE ---
app.use("/api", (req, res, next) => {
	if (maintenance.active) {
		return res.status(503).json({
			error: "maintenance",
			message: "L'API est en maintenance.",
			estimatedEnd: maintenance.scheduledEnd || null,
		});
	}
	next();
});

// --- API ROUTES ---

// Auth routes (Discord OAuth2, no client/io needed)
app.use("/api/auth", authRoutes());

// General API routes (users, polls, etc.)
app.use("/api", apiRoutes(client, io));

// Poker-specific routes
app.use("/api/poker", pokerRoutes(client, io));

// Solitaire-specific routes
app.use("/api/solitaire", solitaireRoutes(client, io));

// Sudoku-specific routes
app.use("/api/sudoku", sudokuRoutes(client, io));

// Blackjack-specific routes
app.use("/api/blackjack", blackjackRoutes(client, io));

// Market-specific routes
app.use("/api/market-place", marketRoutes(client, io));

// erinyes-specific routes
// app.use("/api/erinyes", erinyesRoutes(client, io));

// monke-specific routes
app.use("/api/monke-game", monkeRoutes(client, io));

export { app };
