import express from "express";
import axios from "axios";
import { signToken } from "../middleware/auth.js";
import * as userService from "../../services/user.service.js";

const router = express.Router();

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_CLIENT_ID = process.env.APP_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const API_URL = process.env.DEV_SITE === "true" ? process.env.API_URL_DEV : process.env.API_URL;
const FLAPI_URL = process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL;
const REDIRECT_URI = `${API_URL}/api/auth/discord/callback`;

/**
 * GET /api/auth/discord
 * Redirects the user to Discord's OAuth2 authorization page.
 */
router.get("/discord", (req, res) => {
	const params = new URLSearchParams({
		client_id: DISCORD_CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: "identify",
	});

	res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
});

/**
 * GET /api/auth/discord/callback
 * Handles the OAuth2 callback from Discord.
 * Exchanges the authorization code for tokens, fetches user info,
 * creates a JWT, and redirects the user back to the frontend.
 */
router.get("/discord/callback", async (req, res) => {
	const { code } = req.query;
	if (!code) {
		return res.status(400).json({ error: "Missing authorization code." });
	}

	try {
		// Exchange the authorization code for an access token
		const tokenResponse = await axios.post(
			`${DISCORD_API}/oauth2/token`,
			new URLSearchParams({
				client_id: DISCORD_CLIENT_ID,
				client_secret: DISCORD_CLIENT_SECRET,
				grant_type: "authorization_code",
				code,
				redirect_uri: REDIRECT_URI,
			}),
			{ headers: { "Content-Type": "application/x-www-form-urlencoded" } },
		);

		const { access_token } = tokenResponse.data;

		// Fetch the user's Discord profile
		const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
			headers: { Authorization: `Bearer ${access_token}` },
		});

		const discordUser = userResponse.data;

		// Ensure the user exists in our database
		const existingUser = await userService.getUser(discordUser.id);
		if (existingUser) {
			// Update avatar if it changed
			const avatarUrl = discordUser.avatar
				? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=256`
				: null;
			if (avatarUrl) {
				await userService.updateUserAvatar(discordUser.id, avatarUrl);
			}
		}

		// Sign a JWT with the verified Discord ID
		const token = signToken(discordUser.id);

		// Redirect back to the frontend with the token
		res.redirect(`${FLAPI_URL}/auth/callback?token=${token}&discordId=${discordUser.id}`);
	} catch (error) {
		console.error("Discord OAuth2 error:", error.response?.data || error.message);
		console.log("Status:", error.response?.status);
		console.log("Headers:", JSON.stringify(error.response?.headers));
		res.redirect(`${FLAPI_URL}/auth/callback?error=auth_failed`);
	}
});

/**
 * GET /api/auth/me
 * Returns the authenticated user's info. Requires a valid JWT.
 */
router.get("/me", async (req, res) => {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Authentication required." });
	}

	const token = authHeader.split("Bearer ")[1];
	const { verifyToken } = await import("../middleware/auth.js");
	const payload = verifyToken(token);
	if (!payload) {
		return res.status(401).json({ error: "Invalid or expired token." });
	}

	const user = await userService.getUser(payload.discordId);
	if (!user) {
		console.warn("User not found for Discord ID in token:", payload.discordId);
		return res.json({ discordId: payload.discordId });
	}

	res.json({ user, discordId: user.id });
});

export function authRoutes() {
	return router;
}
