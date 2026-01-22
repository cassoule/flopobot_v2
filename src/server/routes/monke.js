import express from "express";
import { v4 as uuidv4 } from "uuid";
import { monkePaths } from "../../game/state.js";
import { socketEmit } from "../socket.js";
import { getUser, updateUserCoins, insertLog } from "../../database/index.js";
import { init } from "openai/_shims/index.mjs";

const router = express.Router();

/**
 * Factory function to create and configure the monke API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function monkeRoutes(client, io) {
	// --- Router Management Endpoints

	router.get("/:userId", (req, res) => {
		const { userId } = req.params;

		if (!userId) return res.status(400).json({ error: "User ID is required" });
		const user = getUser.get(userId);
		if (!user) return res.status(404).json({ error: "User not found" });
		const userGamePath = monkePaths[userId] || null;
		if (!userGamePath) return res.status(404).json({ error: "No active game found for this user" });

		return res.status(200).json({ userGamePath });
	});

	router.post("/:userId/start", (req, res) => {
		const { userId } = req.params;
		const { initialBet } = req.body;

		if (!userId) return res.status(400).json({ error: "User ID is required" });
		const user = getUser.get(userId);
		if (!user) return res.status(404).json({ error: "User not found" });
		if (!initialBet) return res.status(400).json({ error: "Initial bet is required" });

		try {
			const newCoins = user.coins - initialBet;
			updateUserCoins.run({
				id: userId,
				coins: newCoins,
			});
			insertLog.run({
				id: `${userId}-monke-bet-${Date.now()}`,
				user_id: userId,
				target_user_id: null,
				action: "MONKE_BET",
				coins_amount: -initialBet,
				user_new_amount: newCoins,
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to update user coins" });
		}

		monkePaths[userId] = [{ round: 0, choice: null, result: null, bet: initialBet, extractValue: null, timestamp: Date.now() }];

		return res.status(200).json({ message: "Monke game started", userGamePath: monkePaths[userId] });
	});

	router.post("/:userId/play", (req, res) => {
		const { userId } = req.params;
		const { choice, step } = req.body;

		if (!userId) return res.status(400).json({ error: "User ID is required" });
		const user = getUser.get(userId);
		if (!user) return res.status(404).json({ error: "User not found" });
		if (!monkePaths[userId]) return res.status(400).json({ error: "No active game found for this user" });

		const currentRound = monkePaths[userId].length - 1;
		if (step !== currentRound) return res.status(400).json({ error: "Invalid step for the current round" });
		if (monkePaths[userId][currentRound].choice !== null) return res.status(400).json({ error: "This round has already been played" });
		const randomLoseChoice = Math.floor(Math.random() * 3); // 0, 1, or 2

		if (choice !== randomLoseChoice) {
			monkePaths[userId][currentRound].choice = choice;
			monkePaths[userId][currentRound].result = randomLoseChoice;
			monkePaths[userId][currentRound].extractValue = Math.round(monkePaths[userId][currentRound].bet * 1.33);
			monkePaths[userId][currentRound].timestamp = Date.now();

			monkePaths[userId].push({ round: currentRound + 1, choice: null, result: null, bet: monkePaths[userId][currentRound].extractValue, extractValue: null, timestamp: Date.now() });

			return res.status(200).json({ message: "Round won", userGamePath: monkePaths[userId], lost: false });
		} else {
			monkePaths[userId][currentRound].choice = choice;
			monkePaths[userId][currentRound].result = randomLoseChoice;
			monkePaths[userId][currentRound].extractValue = 0;
			monkePaths[userId][currentRound].timestamp = Date.now();

			const userGamePath = monkePaths[userId];
			delete monkePaths[userId];

			return res.status(200).json({ message: "Round lost", userGamePath, lost: true });
		}
	});

	router.post("/:userId/stop", (req, res) => {
		const { userId } = req.params;
		if (!userId) return res.status(400).json({ error: "User ID is required" });
		const user = getUser.get(userId);
		if (!user) return res.status(404).json({ error: "User not found" });
		if (!monkePaths[userId]) return res.status(400).json({ error: "No active game found for this user" });
		const userGamePath = monkePaths[userId];
		delete monkePaths[userId];

		const extractValue = userGamePath[userGamePath.length - 1].bet;
		const coins = user.coins || 0;

		const newCoins = coins + extractValue;

		try {
			updateUserCoins.run({
				id: userId,
				coins: newCoins,
			});
			insertLog.run({
				id: `${userId}-monke-withdraw-${Date.now()}`,
				user_id: userId,
				target_user_id: null,
				action: "MONKE_WITHDRAW",
				coins_amount: extractValue,
				user_new_amount: newCoins,
			});

			return res.status(200).json({ message: "Game stopped", userGamePath });
		} catch (error) {
			return res.status(500).json({ error: "Failed to update user coins" });
		}
	});

	return router;
}
