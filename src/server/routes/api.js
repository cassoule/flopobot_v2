import express from "express";
import { sleep } from "openai/core";
import Stripe from "stripe";

// --- Service Imports ---
import * as userService from "../../services/user.service.js";
import * as gameService from "../../services/game.service.js";
import * as skinService from "../../services/skin.service.js";
import * as logService from "../../services/log.service.js";
import * as transactionService from "../../services/transaction.service.js";
import * as marketService from "../../services/market.service.js";
import * as csSkinService from "../../services/csSkin.service.js";

// --- Game State Imports ---
import { activePolls, activePredis, activeSlowmodes, skins, activeSnakeGames } from "../../game/state.js";

// --- Utility and API Imports ---
import {
	formatTime,
	isMeleeSkin,
	isVCTSkin,
	isChampionsSkin,
	getVCTRegion,
	resolveUser,
	resolveMember,
} from "../../utils/index.js";
import { DiscordRequest } from "../../api/discord.js";

// --- Discord.js Builder Imports ---
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { emitDataUpdated, socketEmit, onGameOver } from "../socket.js";
import { handleCaseOpening } from "../../utils/marketNotifs.js";
import { drawCaseContent, drawCaseSkin, getSkinUpgradeProbs } from "../../utils/caseOpening.js";
import { requireAuth } from "../middleware/auth.js";
import { getRandomSkinWithRandomSpecs, RarityToColor, TRADE_UP_MAP } from "../../utils/cs.utils.js";

// Create a new router instance
const router = express.Router();

/**
 * Factory function to create and configure the main API routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function apiRoutes(client, io) {
	// --- Server Health & Basic Data ---

	router.get("/download-db", (req, res) => {
		res.download("/db/flopobot.db");
	});

	router.get("/users", async (req, res) => {
		try {
			const users = await userService.getAllUsers();
			res.json(users);
		} catch (error) {
			console.error("Error fetching users:", error);
			res.status(500).json({ error: "Failed to fetch users." });
		}
	});

	router.get("/akhys", async (req, res) => {
		try {
			const akhys = await userService.getAllAkhys();
			res.json(akhys);
		} catch (error) {
			console.error("Error fetching akhys:", error);
			res.status(500).json({ error: "Failed to fetch akhys" });
		}
	});

	router.post("/register-user", requireAuth, async (req, res) => {
		const discordUserId = req.userId;
		const discordUser = await resolveUser(client, discordUserId);

		try {
			await userService.insertUser({
				id: discordUser.id,
				username: discordUser.username,
				globalName: discordUser.globalName,
				warned: 0,
				warns: 0,
				allTimeWarns: 0,
				totalRequests: 0,
				avatarUrl: discordUser.displayAvatarURL({ dynamic: true, size: 256 }),
				isAkhy: 0,
			});

			await userService.updateUserCoins(discordUser.id, 5000);
			await logService.insertLog({
				id: `${discordUser.id}-welcome-${Date.now()}`,
				userId: discordUser.id,
				action: "WELCOME_BONUS",
				targetUserId: null,
				coinsAmount: 5000,
				userNewAmount: 5000,
			});

			console.log(`New registered user: ${discordUser.username} (${discordUser.id})`);

			res.status(200).json({ message: `Bienvenue ${discordUser.username} !` });
		} catch (e) {
			console.log(`Failed to register user ${discordUser.username} (${discordUser.id})`, e);
			res.status(500).json({ error: "Erreur lors de la création du nouvel utilisateur." });
		}
	});

	router.get("/skins", (req, res) => {
		try {
			res.json(skins);
		} catch (error) {
			console.error("Error fetching skins:", error);
			res.status(500).json({ error: "Failed to fetch skins." });
		}
	});

	router.post("/open-case", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { caseType } = req.body;

		let caseTypeVal;
		switch (caseType) {
			case "standard":
				caseTypeVal = 500;
				break;
			case "premium":
				caseTypeVal = 750;
				break;
			case "ultra":
				caseTypeVal = 1500;
				break;
			case "esport":
				caseTypeVal = 100;
				break;
			default:
				return res.status(400).json({ error: "Invalid case type." });
		}
		const commandUser = await userService.getUser(userId);
		if (!commandUser) return res.status(404).json({ error: "User not found." });
		const valoPrice = caseTypeVal;
		if (commandUser.coins < valoPrice) return res.status(403).json({ error: "Not enough FlopoCoins." });

		try {
			const selectedSkins = await drawCaseContent(caseType);

			const result = await drawCaseSkin(selectedSkins);

			// --- Update Database ---
			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "VALO_CASE_OPEN",
				targetUserId: null,
				coinsAmount: -valoPrice,
				userNewAmount: commandUser.coins - valoPrice,
			});
			await userService.updateUserCoins(userId, commandUser.coins - valoPrice);
			await skinService.updateSkin({
				uuid: result.randomSkinData.uuid,
				userId: userId,
				currentLvl: result.randomLevel,
				currentChroma: result.randomChroma,
				currentPrice: result.finalPrice,
			});

			console.log(
				`${commandUser.username} opened a ${caseType} Valorant case and received skin ${result.randomSelectedSkinUuid}`,
			);
			const updatedSkin = await skinService.getSkin(result.randomSkinData.uuid);
			await handleCaseOpening(caseType, userId, result.randomSelectedSkinUuid, client);

			const contentSkins = selectedSkins.map((item) => {
				return {
					...item,
					isMelee: isMeleeSkin(item.displayName),
					isVCT: isVCTSkin(item.displayName),
					isChampions: isChampionsSkin(item.displayName),
					vctRegion: getVCTRegion(item.displayName),
				};
			});
			res.json({
				selectedSkins: contentSkins,
				randomSelectedSkinUuid: result.randomSelectedSkinUuid,
				randomSelectedSkinIndex: result.randomSelectedSkinIndex,
				updatedSkin,
			});
		} catch (error) {
			console.error("Error fetching skins:", error);
			res.status(500).json({ error: "Failed to fetch skins." });
		}
	});

	router.post("/open-cs-case", requireAuth, async (req, res) => {
		const userId = req.userId;
		const casePrice = parseInt(process.env.CS_CASE_PRICE) || 250;

		const commandUser = await userService.getUser(userId);
		if (!commandUser) return res.status(404).json({ error: "User not found." });
		if (commandUser.coins < casePrice) return res.status(403).json({ error: "Not enough FlopoCoins." });

		try {
			const randomSkin = await getRandomSkinWithRandomSpecs();

			const created = await csSkinService.insertCsSkin({
				marketHashName: randomSkin.name,
				displayName: randomSkin.data.name || randomSkin.name,
				imageUrl: randomSkin.data.image || null,
				rarity: randomSkin.data.rarity.name,
				rarityColor: RarityToColor[randomSkin.data.rarity.name]?.toString(16) || null,
				weaponType: randomSkin.data.weapon?.name || null,
				float: randomSkin.float,
				wearState: randomSkin.wearState,
				isStattrak: randomSkin.isStattrak,
				isSouvenir: randomSkin.isSouvenir,
				price: parseInt(randomSkin.price),
				userId: userId,
			});

			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "CS_CASE_OPEN",
				targetUserId: null,
				coinsAmount: -casePrice,
				userNewAmount: commandUser.coins - casePrice,
			});
			await userService.updateUserCoins(userId, commandUser.coins - casePrice);

			// Generate roulette decoy skins for the animation
			const ROULETTE_SIZE = 50;
			const resultIndex = 12 + Math.floor(Math.random() * 5); // Place result around index 12-16
			const rouletteSkins = [];
			for (let i = 0; i < ROULETTE_SIZE; i++) {
				if (i === resultIndex) {
					rouletteSkins.push({
						displayName: created.displayName,
						imageUrl: created.imageUrl,
						rarity: created.rarity,
						rarityColor: created.rarityColor,
					});
				} else {
					const decoy = await getRandomSkinWithRandomSpecs();
					rouletteSkins.push({
						displayName: decoy.data.name || decoy.name,
						imageUrl: decoy.data.image || null,
						rarity: decoy.data.rarity.name,
						rarityColor: RarityToColor[decoy.data.rarity.name]?.toString(16) || null,
					});
				}
			}

			res.json({ skin: created, rouletteSkins, resultIndex });
		} catch (error) {
			console.error("Error opening CS case:", error);
			res.status(500).json({ error: "Failed to open CS case." });
		}
	});

	router.post("/trade-up", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { skinIds } = req.body;

		if (!Array.isArray(skinIds) || skinIds.length !== 10) {
			return res.status(400).json({ error: "You must provide exactly 10 skin IDs." });
		}

		try {
			const skins = await Promise.all(skinIds.map((id) => csSkinService.getCsSkin(id)));

			// Validate all skins exist and are owned by the user
			for (const skin of skins) {
				if (!skin) return res.status(404).json({ error: "One or more skins not found." });
				if (skin.userId !== userId) return res.status(403).json({ error: "You don't own all of these skins." });
			}

			// Validate all skins are the same rarity
			const rarity = skins[0].rarity;
			if (!skins.every((s) => s.rarity === rarity)) {
				return res.status(400).json({ error: "All 10 skins must be the same rarity." });
			}

			// Validate rarity can be traded up
			const nextRarity = TRADE_UP_MAP[rarity];
			if (!nextRarity) {
				return res.status(400).json({ error: `${rarity} skins cannot be used in trade-up contracts.` });
			}

			// Delete the 10 input skins
			await csSkinService.deleteManyCsSkins(skinIds);

			// Generate a new skin at the next rarity tier
			const newSkin = await getRandomSkinWithRandomSpecs(null, nextRarity);
			const created = await csSkinService.insertCsSkin({
				marketHashName: newSkin.name,
				displayName: newSkin.data.name || newSkin.name,
				imageUrl: newSkin.data.image || null,
				rarity: newSkin.data.rarity.name,
				rarityColor: RarityToColor[newSkin.data.rarity.name]?.toString(16) || null,
				weaponType: newSkin.data.weapon?.name || null,
				float: newSkin.float,
				wearState: newSkin.wearState,
				isStattrak: newSkin.isStattrak,
				isSouvenir: newSkin.isSouvenir,
				price: parseInt(newSkin.price),
				userId: userId,
			});

			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "CS_TRADE_UP",
				targetUserId: null,
				coinsAmount: 0,
				userNewAmount: (await userService.getUser(userId)).coins,
			});

			res.json({ skin: created, consumedRarity: rarity, resultRarity: nextRarity });
		} catch (error) {
			console.error("Error during trade-up:", error);
			res.status(500).json({ error: "Failed to complete trade-up contract." });
		}
	});

	router.get("/case-content/:type", async (req, res) => {
		const { type } = req.params;
		try {
			const selectedSkins = await drawCaseContent(type, -1);
			for (const item of selectedSkins) {
				item.isMelee = isMeleeSkin(item.displayName);
				item.isVCT = isVCTSkin(item.displayName);
				item.isChampions = isChampionsSkin(item.displayName);
				item.vctRegion = getVCTRegion(item.displayName);
				const skinData = await skinService.getSkin(item.uuid);
				item.basePrice = skinData.basePrice;
				item.maxPrice = skinData.maxPrice;
			}
			res.json({ skins: selectedSkins.sort((a, b) => b.maxPrice - a.maxPrice) });
		} catch (error) {
			console.error("Error fetching case content:", error);
			res.status(500).json({ error: "Failed to fetch case content." });
		}
	});

	router.get("/skin/:id", (req, res) => {
		try {
			const skinData = skins.find((s) => s.uuid === req.params.id);
			res.json(skinData);
		} catch (error) {
			console.error("Error fetching skin:", error);
			res.status(500).json({ error: "Failed to fetch skin." });
		}
	});

	router.post("/skin/:id", (req, res) => {
		const { level, chroma } = req.body;
		try {
			const skinData = skins.find((s) => s.uuid === req.params.id);
			if (!skinData) res.status(404).json({ error: "Invalid skin." });

			const levelData = skinData.levels[level - 1] || {};
			const chromaData = skinData.chromas[chroma - 1] || {};

			let videoUrl = null;
			if (level === skinData.levels.length) {
				videoUrl = chromaData.streamedVideo;
			}
			videoUrl = videoUrl || levelData.streamedVideo;

			res.json({ url: videoUrl });
		} catch (error) {
			console.error("Error fetching skins:", error);
			res.status(500).json({ error: "Failed to fetch skins." });
		}
	});

	router.post("/skin/:uuid/instant-sell", requireAuth, async (req, res) => {
		const userId = req.userId;
		try {
			const skin = await skinService.getSkin(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			if (!skinData) {
				return res.status(403).json({ error: "Invalid skin." });
			}
			if (skin.userId !== userId) {
				return res.status(403).json({ error: "User does not own this skin." });
			}

			const marketOffers = await marketService.getMarketOffersBySkin(skin.uuid);
			const activeOffers = marketOffers.filter((offer) => offer.status === "pending" || offer.status === "open");
			if (activeOffers.length > 0) {
				return res
					.status(403)
					.json({ error: "Impossible de vendre ce skin, une offre FlopoMarket est déjà en cours." });
			}

			const commandUser = await userService.getUser(userId);
			if (!commandUser) {
				return res.status(404).json({ error: "User not found." });
			}
			const sellPrice = skin.currentPrice;

			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "VALO_SKIN_INSTANT_SELL",
				targetUserId: null,
				coinsAmount: sellPrice,
				userNewAmount: commandUser.coins + sellPrice,
			});
			await userService.updateUserCoins(userId, commandUser.coins + sellPrice);
			await skinService.updateSkin({
				uuid: skin.uuid,
				userId: null,
				currentLvl: null,
				currentChroma: null,
				currentPrice: null,
			});
			console.log(`${commandUser.username} instantly sold skin ${skin.uuid} for ${sellPrice} FlopoCoins`);
			res.status(200).json({ sellPrice });
		} catch (error) {
			console.error("Error fetching skin upgrade:", error);
			res.status(500).json({ error: "Failed to fetch skin upgrade." });
		}
	});

	router.post("/cs-skin/:id/instant-sell", requireAuth, async (req, res) => {
		const userId = req.userId;
		try {
			const skin = await csSkinService.getCsSkin(req.params.id);
			if (!skin) return res.status(404).json({ error: "CS skin not found." });
			if (skin.userId !== userId) return res.status(403).json({ error: "User does not own this skin." });

			const marketOffers = await marketService.getMarketOffersByCsSkin(skin.id);
			const activeOffers = marketOffers.filter((offer) => offer.status === "pending" || offer.status === "open");
			if (activeOffers.length > 0) {
				return res
					.status(403)
					.json({ error: "Impossible de vendre ce skin, une offre FlopoMarket est déjà en cours." });
			}

			const commandUser = await userService.getUser(userId);
			if (!commandUser) return res.status(404).json({ error: "User not found." });

			const sellPrice = skin.price;
			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "CS_SKIN_INSTANT_SELL",
				targetUserId: null,
				coinsAmount: sellPrice,
				userNewAmount: commandUser.coins + sellPrice,
			});
			await userService.updateUserCoins(userId, commandUser.coins + sellPrice);
			await csSkinService.deleteCsSkin(skin.id);

			console.log(`${commandUser.username} instantly sold CS skin ${skin.displayName} for ${sellPrice} FlopoCoins`);
			res.status(200).json({ sellPrice });
		} catch (error) {
			console.error("Error selling CS skin:", error);
			res.status(500).json({ error: "Failed to sell CS skin." });
		}
	});

	router.get("/skin-upgrade/:uuid/fetch", async (req, res) => {
		try {
			const skin = await skinService.getSkin(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			const { successProb, destructionProb, upgradePrice } = getSkinUpgradeProbs(skin, skinData);

			const segments = [
				{ id: "SUCCEEDED", color: "5865f2", percent: successProb, label: "Réussie" },
				{ id: "DESTRUCTED", color: "f26558", percent: destructionProb, label: "Détruit" },
				{ id: "NONE", color: "18181818", percent: 1 - successProb - destructionProb, label: "Échec" },
			];

			res.json({ segments, upgradePrice });
		} catch (error) {
			console.log(error);
			res.status(500).json({ error: "Failed to fetch skin upgrade." });
		}
	});

	router.post("/skin-upgrade/:uuid", requireAuth, async (req, res) => {
		const userId = req.userId;
		try {
			const skin = await skinService.getSkin(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			if (!skinData || (skin.currentLvl >= skinData.levels.length && skin.currentChroma >= skinData.chromas.length)) {
				return res.status(403).json({ error: "Skin is already maxed out or invalid skin." });
			}
			if (skin.userId !== userId) {
				return res.status(403).json({ error: "User does not own this skin." });
			}
			const marketOffers = await marketService.getMarketOffersBySkin(skin.uuid);
			const activeOffers = marketOffers.filter((offer) => offer.status === "pending" || offer.status === "open");
			if (activeOffers.length > 0) {
				return res.status(403).json({ error: "Impossible d'améliorer ce skin, une offre FlopoMarket est en cours." });
			}
			const { successProb, destructionProb, upgradePrice } = getSkinUpgradeProbs(skin, skinData);

			const commandUser = await userService.getUser(userId);
			if (!commandUser) {
				return res.status(404).json({ error: "User not found." });
			}
			if (commandUser.coins < upgradePrice) {
				return res.status(403).json({ error: `Pas assez de FlopoCoins (${upgradePrice} requis).` });
			}

			await logService.insertLog({
				id: `${userId}-${Date.now()}`,
				userId: userId,
				action: "VALO_SKIN_UPGRADE",
				targetUserId: null,
				coinsAmount: -upgradePrice,
				userNewAmount: commandUser.coins - upgradePrice,
			});
			await userService.updateUserCoins(userId, commandUser.coins - upgradePrice);

			let succeeded = false;
			let destructed = false;

			const roll = Math.random();
			if (roll < destructionProb) {
				destructed = true;
			} else if (roll < successProb + destructionProb) {
				succeeded = true;
			}

			if (succeeded) {
				const isLevelUpgrade = skin.currentLvl < skinData.levels.length;
				if (isLevelUpgrade) {
					skin.currentLvl++;
				} else {
					skin.currentChroma++;
				}
				const calculatePrice = () => {
					let result = parseFloat(skin.basePrice);
					result *= 1 + skin.currentLvl / Math.max(skinData.levels.length, 2);
					result *= 1 + skin.currentChroma / 4;
					return parseFloat(result.toFixed(0));
				};
				skin.currentPrice = calculatePrice();

				await skinService.updateSkin({
					uuid: skin.uuid,
					userId: skin.userId,
					currentLvl: skin.currentLvl,
					currentChroma: skin.currentChroma,
					currentPrice: skin.currentPrice,
				});
			} else if (destructed) {
				await skinService.updateSkin({
					uuid: skin.uuid,
					userId: null,
					currentLvl: null,
					currentChroma: null,
					currentPrice: null,
				});
			}

			console.log(
				`${commandUser.username} attempted to upgrade skin ${skin.uuid} - ${succeeded ? "SUCCEEDED" : destructed ? "DESTRUCTED" : "FAILED"}`,
			);
			res.json({ wonId: succeeded ? "SUCCEEDED" : destructed ? "DESTRUCTED" : "NONE" });
		} catch (error) {
			console.error("Error fetching skin upgrade:", error);
			res.status(500).json({ error: "Failed to fetch skin upgrade." });
		}
	});

	router.get("/users/by-elo", async (req, res) => {
		try {
			const users = await gameService.getUsersByElo();
			res.json(users);
		} catch (error) {
			console.error("Error fetching users by Elo:", error);
			res.status(500).json({ error: "Failed to fetch users by Elo." });
		}
	});

	router.get("/logs", async (req, res) => {
		try {
			await logService.pruneOldLogs();
			const logs = await logService.getLogs();
			res.status(200).json(logs);
		} catch (error) {
			console.error("Error fetching logs:", error);
			res.status(500).json({ error: "Failed to fetch logs." });
		}
	});

	// --- User-Specific Routes ---
	router.get("/user/:id", async (req, res) => {
		try {
			const user = await userService.getUser(req.params.id);
			res.json({ user });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/avatar", async (req, res) => {
		try {
			const user = await resolveUser(client, req.params.id);
			const avatarUrl = user.displayAvatarURL({ format: "png", size: 256 });
			res.json({ avatarUrl });
		} catch (error) {
			res.status(404).json({ error: "User not found or failed to fetch avatar." });
		}
	});

	router.get("/users/avatars", async (req, res) => {
		try {
			const avatarUrls = {};
			const users = await userService.getAllUsers();
			await Promise.all(
				users.map(async (user) => {
					try {
						const discordUser = await resolveUser(client, user.id);
						avatarUrls[user.id] = discordUser.displayAvatarURL({ format: "png", size: 256 });
					} catch (error) {
						avatarUrls[user.id] = null;
					}
				}),
			);
			res.json({ avatars: avatarUrls });
		} catch (error) {
			res.status(404).json({ error: "One or more users not found or failed to fetch avatars." });
		}
	});

	router.get("/user/:id/username", async (req, res) => {
		try {
			const user = await resolveUser(client, req.params.id);
			res.json({ user });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/coins", async (req, res) => {
		try {
			const user = await userService.getUser(req.params.id);
			res.json({ coins: user.coins });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/sparkline", async (req, res) => {
		try {
			const logs = await logService.getUserLogs(req.params.id);
			res.json({ sparkline: logs });
		} catch (error) {
			res.status(500).json({ error: "Failed to fetch logs for sparkline." });
		}
	});

	router.get("/users/sparklines", async (req, res) => {
		try {
			const sparklines = {};
			const users = await userService.getAllUsers();
			await Promise.all(
				users.map(async (user) => {
					try {
						sparklines[user.id] = await logService.getUserLogs(user.id);
					} catch (error) {
						sparklines[user.id] = [];
					}
				}),
			);
			res.json({ sparklines });
		} catch (error) {
			res.status(404).json({ error: "One or more users not found or failed to fetch sparklines." });
		}
	});

	router.get("/user/:id/elo", async (req, res) => {
		try {
			const eloData = await gameService.getUserElo(req.params.id);
			res.json({
				elo: eloData?.elo || null,
				rd: eloData?.rd || null,
				gamesPlayed: eloData?.gamesPlayed ?? 0,
				isPlacement: (eloData?.gamesPlayed ?? 0) < 5,
			});
		} catch (e) {
			res.status(500).json({ error: "Failed to fetch Elo data." });
		}
	});

	router.get("/users/elos", async (req, res) => {
		try {
			const elos = {};
			const users = await userService.getAllUsers();
			await Promise.all(
				users.map(async (user) => {
					try {
						const eloData = await gameService.getUserElo(user.id);
						elos[user.id] = {
							elo: eloData?.elo || null,
							rd: eloData?.rd || null,
							gamesPlayed: eloData?.gamesPlayed ?? 0,
							isPlacement: (eloData?.gamesPlayed ?? 0) < 5,
						};
					} catch (error) {
						elos[user.id] = null;
					}
				}),
			);
			res.json({ elos });
		} catch (error) {
			res.status(404).json({ error: "One or more users not found or failed to fetch elos." });
		}
	});

	router.get("/user/:id/elo-graph", async (req, res) => {
		try {
			const games = await gameService.getUserGames(req.params.id);
			const eloHistory = games
				.filter((g) => g.type !== "POKER_ROUND" && g.type !== "SOTD")
				.filter((game) => game.p2 !== null)
				.map((game) => (game.p1 === req.params.id ? game.p1NewElo : game.p2NewElo));
			eloHistory.splice(0, 0, 1500);
			res.json({ eloGraph: eloHistory });
		} catch (e) {
			res.status(500).json({ error: "Failed to generate Elo graph." });
		}
	});

	router.get("/users/elo-graphs", async (req, res) => {
		try {
			const eloGraphs = {};
			const users = await userService.getAllUsers();
			await Promise.all(
				users.map(async (user) => {
					try {
						const games = await gameService.getUserGames(user.id);
						const eloHistory = games
							.filter((g) => g.type !== "POKER_ROUND" && g.type !== "SOTD")
							.filter((game) => game.p2 !== null)
							.map((game) => (game.p1 === user.id ? game.p1NewElo : game.p2NewElo));
						eloHistory.splice(0, 0, 1500);
						eloGraphs[user.id] = eloHistory;
					} catch (error) {
						eloGraphs[user.id] = [];
					}
				}),
			);
			res.json({ eloGraphs });
		} catch (error) {
			res.status(404).json({ error: "One or more users not found or failed to fetch elo graphs." });
		}
	});

	router.get("/user/:id/inventory", async (req, res) => {
		try {
			const inventory = await skinService.getUserInventory(req.params.id);
			for (const skin of inventory) {
				const marketOffers = await marketService.getMarketOffersBySkin(skin.uuid);
				for (const offer of marketOffers) {
					offer.skin = await skinService.getSkin(offer.skinUuid);
					offer.seller = await userService.getUser(offer.sellerId);
					offer.buyer = offer.buyerId ? await userService.getUser(offer.buyerId) : null;
					offer.bids = (await marketService.getOfferBids(offer.id)) || {};
					for (const bid of offer.bids) {
						bid.bidder = await userService.getUser(bid.bidderId);
					}
				}
				skin.offers = marketOffers || {};
				skin.isMelee = isMeleeSkin(skin.displayName);
				skin.isVCT = isVCTSkin(skin.displayName);
				skin.isChampions = isChampionsSkin(skin.displayName);
				skin.vctRegion = getVCTRegion(skin.displayName);
			}

			const csInventory = await csSkinService.getUserCsInventory(req.params.id);
			res.json({ inventory, csInventory });
		} catch (error) {
			console.log(error);
			res.status(500).json({ error: "Failed to fetch inventory." });
		}
	});

	router.get("/user/:id/games-history", async (req, res) => {
		try {
			const games = (await gameService.getUserGames(req.params.id))
				.filter((g) => g.type !== "POKER_ROUND" && g.type !== "SOTD")
				.reverse()
				.slice(0, 50);
			res.json({ games });
		} catch (err) {
			res.status(500).json({ error: "Failed to fetch games history." });
		}
	});

	router.get("/user/:id/daily", requireAuth, async (req, res) => {
		const id = req.userId;
		try {
			const akhy = await userService.getUser(id);
			if (!akhy) return res.status(404).json({ message: "Utilisateur introuvable" });
			if (akhy.dailyQueried) return res.status(403).json({ message: "Récompense journalière déjà récupérée." });

			const amount = 500;
			const newCoins = akhy.coins + amount;
			await userService.queryDailyReward(id);
			await userService.updateUserCoins(id, newCoins);
			await logService.insertLog({
				id: `${id}-daily-${Date.now()}`,
				userId: id,
				action: "DAILY_REWARD",
				targetUserId: null,
				coinsAmount: amount,
				userNewAmount: newCoins,
			});

			await socketEmit("daily-queried", { userId: id });
			res.status(200).json({ message: `+${amount} FlopoCoins! Récompense récupérée !` });
		} catch (error) {
			res.status(500).json({ error: "Failed to process daily reward." });
		}
	});

	// --- Poll & Timeout Routes ---

	router.get("/polls", (req, res) => {
		res.json({ activePolls });
	});

	router.post("/timedout", requireAuth, async (req, res) => {
		try {
			const userId = req.userId;
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const member = await resolveMember(guild, userId);
			res.status(200).json({ isTimedOut: member?.isCommunicationDisabled() || false });
		} catch (e) {
			res.status(404).send({ message: "Member not found or guild unavailable." });
		}
	});

	// --- Shop & Interaction Routes ---

	router.post("/change-nickname", requireAuth, async (req, res) => {
		const { userId, nickname } = req.body;
		const commandUserId = req.userId;
		const commandUser = await userService.getUser(commandUserId);
		if (!commandUser) return res.status(404).json({ message: "Command user not found." });
		if (commandUser.coins < 1000) return res.status(403).json({ message: "Pas assez de FlopoCoins (1000 requis)." });

		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const member = await resolveMember(guild, userId);
			const old_nickname = member.nickname;
			await member.setNickname(nickname);

			const newCoins = commandUser.coins - 1000;
			await userService.updateUserCoins(commandUserId, newCoins);
			await logService.insertLog({
				id: `${commandUserId}-changenick-${Date.now()}`,
				userId: commandUserId,
				action: "CHANGE_NICKNAME",
				targetUserId: userId,
				coinsAmount: -1000,
				userNewAmount: newCoins,
			});

			console.log(`${commandUserId} change nickname of ${userId}: ${old_nickname} -> ${nickname}`);

			try {
				const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
				const embed = new EmbedBuilder()
					.setDescription(`<@${commandUserId}> a modifié le pseudo de <@${userId}>`)
					.addFields(
						{ name: `${old_nickname}`, value: ``, inline: true },
						{ name: `➡️`, value: ``, inline: true },
						{ name: `${nickname}`, value: ``, inline: true },
					)
					.setColor("#5865f2")
					.setTimestamp(new Date());

				await generalChannel.send({ embeds: [embed] });
			} catch (e) {
				console.log(`[${Date.now()}]`, e);
			}

			res.status(200).json({
				message: `Le pseudo de ${member.user.username} a été changé.`,
			});
		} catch (error) {
			res.status(500).json({ message: `Erreur: Impossible de changer le pseudo.` });
		}
	});

	router.post("/spam-ping", requireAuth, async (req, res) => {
		const { userId } = req.body;
		const commandUserId = req.userId;

		const user = await userService.getUser(userId);
		const commandUser = await userService.getUser(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 5000) return res.status(403).json({ message: "Pas assez de coins" });

		try {
			const discordUser = await resolveUser(client, userId);

			await discordUser.send(`<@${userId}>`);

			res.status(200).json({ message: "C'est parti ehehe" });

			await userService.updateUserCoins(commandUserId, commandUser.coins - 5000);
			await logService.insertLog({
				id: commandUserId + "-" + Date.now(),
				userId: commandUserId,
				action: "SPAM_PING",
				targetUserId: userId,
				coinsAmount: -5000,
				userNewAmount: commandUser.coins - 5000,
			});
			await emitDataUpdated({ table: "users", action: "update" });

			try {
				const guild = client.guilds.cache.get(process.env.GUILD_ID);
				const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
				const embed = new EmbedBuilder()
					.setDescription(`<@${commandUserId}> a envoyé un spam ping à <@${userId}>`)
					.setColor("#5865f2")
					.setTimestamp(new Date());

				await generalChannel.send({ embeds: [embed] });
			} catch (e) {
				console.log(`[${Date.now()}]`, e);
			}

			for (let i = 1; i < 120; i++) {
				await discordUser.send(`<@${userId}>`);
				await sleep(250);
			}
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
			res.status(500).json({ message: "Oups ça n'a pas marché" });
		}
	});

	// --- Slowmode Routes ---

	router.get("/slowmodes", (req, res) => {
		res.status(200).json({ slowmodes: activeSlowmodes });
	});

	router.post("/slowmode", requireAuth, async (req, res) => {
		let { userId } = req.body;
		const commandUserId = req.userId;

		const user = await userService.getUser(userId);
		const commandUser = await userService.getUser(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 10000) return res.status(403).json({ message: "Pas assez de coins" });

		if (!user) return res.status(403).send({ message: "Oups petit problème" });

		if (activeSlowmodes[userId]) {
			if (userId === commandUserId) {
				delete activeSlowmodes[userId];
				await socketEmit("new-slowmode", { action: "new slowmode" });

				await userService.updateUserCoins(commandUserId, commandUser.coins - 10000);
				await logService.insertLog({
					id: commandUserId + "-" + Date.now(),
					userId: commandUserId,
					action: "SLOWMODE",
					targetUserId: userId,
					coinsAmount: -10000,
					userNewAmount: commandUser.coins - 10000,
				});

				try {
					const guild = client.guilds.cache.get(process.env.GUILD_ID);
					const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
					const embed = new EmbedBuilder()
						.setDescription(`<@${commandUserId}> a retiré son slowmode`)
						.setColor("#5865f2")
						.setTimestamp(new Date());

					await generalChannel.send({ embeds: [embed] });
				} catch (e) {
					console.log(`[${Date.now()}]`, e);
				}
				return res.status(200).json({ message: "Slowmode retiré" });
			} else {
				let timeLeft = (activeSlowmodes[userId].endAt - Date.now()) / 1000;
				timeLeft =
					timeLeft > 60 ? (timeLeft / 60).toFixed()?.toString() + "min" : timeLeft.toFixed()?.toString() + "sec";
				return res.status(403).json({
					message: `${user.globalName} est déjà en slowmode (${timeLeft})`,
				});
			}
		} else if (userId === commandUserId) {
			return res.status(403).json({ message: "Impossible de te mettre toi-même en slowmode" });
		}

		activeSlowmodes[userId] = {
			userId: userId,
			endAt: Date.now() + 60 * 60 * 1000, // 1 heure
			lastMessage: null,
		};
		await socketEmit("new-slowmode", { action: "new slowmode" });

		await userService.updateUserCoins(commandUserId, commandUser.coins - 10000);
		await logService.insertLog({
			id: commandUserId + "-" + Date.now(),
			userId: commandUserId,
			action: "SLOWMODE",
			targetUserId: userId,
			coinsAmount: -10000,
			userNewAmount: commandUser.coins - 10000,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
			const embed = new EmbedBuilder()
				.setDescription(`<@${commandUserId}> a mis <@${userId}> en slowmode pendant 1h`)
				.setColor("#5865f2")
				.setTimestamp(new Date());

			await generalChannel.send({ embeds: [embed] });
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
		}

		return res.status(200).json({
			message: `${user.globalName} est maintenant en slowmode pour 1h`,
		});
	});

	// --- Time-Out Route ---

	router.post("/timeout", requireAuth, async (req, res) => {
		let { userId } = req.body;
		const commandUserId = req.userId;

		const user = await userService.getUser(userId);
		const commandUser = await userService.getUser(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 100000) return res.status(403).json({ message: "Pas assez de coins" });

		if (!user) return res.status(403).send({ message: "Oups petit problème" });

		const guild = client.guilds.cache.get(process.env.GUILD_ID);
		const member = await resolveMember(guild, userId);

		if (userId === commandUserId) {
			if (
				member &&
				(!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp < Date.now())
			) {
				return res.status(403).json({ message: `Impossible de t'auto time-out` });
			}
			await socketEmit("new-timeout", { action: "new slowmode" });

			try {
				const endpointTimeout = `guilds/${process.env.GUILD_ID}/members/${userId}`;
				await DiscordRequest(endpointTimeout, {
					method: "PATCH",
					body: {
						communication_disabled_until: new Date(Date.now()).toISOString(),
					},
				});
			} catch (e) {
				console.log(`[${Date.now()}]`, e);
				return res.status(403).send({ message: `Impossible de time-out ${user.globalName}` });
			}

			await userService.updateUserCoins(commandUserId, commandUser.coins - 10000);
			await logService.insertLog({
				id: commandUserId + "-" + Date.now(),
				userId: commandUserId,
				action: "TIMEOUT",
				targetUserId: userId,
				coinsAmount: -10000,
				userNewAmount: commandUser.coins - 10000,
			});

			try {
				const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
				const embed = new EmbedBuilder()
					.setDescription(`<@${commandUserId}> a retiré son time-out`)
					.setColor("#5865f2")
					.setTimestamp(new Date());

				await generalChannel.send({ embeds: [embed] });
			} catch (e) {
				console.log(`[${Date.now()}]`, e);
			}
			return res.status(200).json({ message: "Time-out retiré" });
		}

		if (
			member &&
			member.communicationDisabledUntilTimestamp &&
			member.communicationDisabledUntilTimestamp > Date.now()
		) {
			return res.status(403).json({ message: `${user.globalName} est déjà time-out` });
		}

		try {
			const timeoutUntil = new Date(Date.now() + 43200 * 1000).toISOString();
			const endpointTimeout = `guilds/${process.env.GUILD_ID}/members/${userId}`;
			await DiscordRequest(endpointTimeout, {
				method: "PATCH",
				body: { communication_disabled_until: timeoutUntil },
			});
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
			return res.status(403).send({ message: `Impossible de time-out ${user.globalName}` });
		}

		await socketEmit("new-timeout", { action: "new timeout" });

		await userService.updateUserCoins(commandUserId, commandUser.coins - 100000);
		await logService.insertLog({
			id: commandUserId + "-" + Date.now(),
			userId: commandUserId,
			action: "TIMEOUT",
			targetUserId: userId,
			coinsAmount: -100000,
			userNewAmount: commandUser.coins - 100000,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		try {
			const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
			const embed = new EmbedBuilder()
				.setDescription(`<@${commandUserId}> a time-out <@${userId}> pour 12h`)
				.setColor("#5865f2")
				.setTimestamp(new Date());

			await generalChannel.send({ embeds: [embed] });
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
		}

		return res.status(200).json({ message: `${user.globalName} est maintenant time-out pour 12h` });
	});

	// --- Prediction Routes ---

	router.get("/predis", (req, res) => {
		const reversedPredis = Object.fromEntries(Object.entries(activePredis).reverse());
		res.status(200).json({ predis: reversedPredis });
	});

	router.post("/start-predi", requireAuth, async (req, res) => {
		let { label, options, closingTime, payoutTime } = req.body;
		const commandUserId = req.userId;

		const commandUser = await userService.getUser(commandUserId);

		if (!commandUser) return res.status(403).send({ message: "Oups petit problème" });
		if (commandUser.coins < 100) return res.status(403).send({ message: "Tu n'as pas assez de FlopoCoins" });

		if (Object.values(activePredis).find((p) => p.creatorId === commandUserId && p.endTime > Date.now() && !p.closed)) {
			return res.status(403).json({
				message: `Tu ne peux pas lancer plus d'une prédi à la fois !`,
			});
		}

		const startTime = Date.now();
		const newPrediId = commandUserId?.toString() + "-" + startTime?.toString();

		let msgId;
		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
			const embed = new EmbedBuilder()
				.setTitle(`Prédiction de ${commandUser.username}`)
				.setDescription(`**${label}**`)
				.addFields(
					{ name: `${options[0]}`, value: ``, inline: true },
					{ name: ``, value: `ou`, inline: true },
					{ name: `${options[1]}`, value: ``, inline: true },
				)
				.setFooter({
					text: `${formatTime(closingTime).replaceAll("*", "")} pour voter`,
				})
				.setColor("#5865f2")
				.setTimestamp(new Date());

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`option_0_${newPrediId}`)
					.setLabel(`+10 sur '${options[0]}'`)
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId(`option_1_${newPrediId}`)
					.setLabel(`+10 sur '${options[1]}'`)
					.setStyle(ButtonStyle.Primary),
			);

			const row2 = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setLabel("Voter sur FlopoSite")
					.setURL(`${process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
					.setStyle(ButtonStyle.Link),
			);

			const msg = await generalChannel.send({
				embeds: [embed],
				components: [/*row,*/ row2],
			});
			msgId = msg.id;
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
			return res.status(500).send({ message: "Erreur lors de l'envoi du message" });
		}

		const formattedOptions = [
			{ label: options[0], votes: [], total: 0, percent: 0 },
			{ label: options[1], votes: [], total: 0, percent: 0 },
		];
		activePredis[newPrediId] = {
			creatorId: commandUserId,
			label: label,
			options: formattedOptions,
			startTime: startTime,
			closingTime: startTime + closingTime * 1000,
			endTime: startTime + closingTime * 1000 + payoutTime * 1000,
			closed: false,
			winning: null,
			cancelledTime: null,
			paidTime: null,
			msgId: msgId,
		};
		await socketEmit("new-predi", { action: "new predi" });

		await userService.updateUserCoins(commandUserId, commandUser.coins - 100);
		await logService.insertLog({
			id: commandUserId + "-" + Date.now(),
			userId: commandUserId,
			action: "START_PREDI",
			targetUserId: null,
			coinsAmount: -100,
			userNewAmount: commandUser.coins - 100,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		return res.status(200).json({ message: `Ta prédi '${label}' a commencée !` });
	});

	router.post("/vote-predi", requireAuth, async (req, res) => {
		const { predi, amount, option } = req.body;
		const commandUserId = req.userId;

		let warning = false;

		let intAmount = parseInt(amount);
		if (intAmount < 10 || intAmount > 250000) return res.status(403).send({ message: "Montant invalide" });

		const commandUser = await userService.getUser(commandUserId);
		if (!commandUser) return res.status(403).send({ message: "Oups, je ne te connais pas" });
		if (commandUser.coins < intAmount) return res.status(403).send({ message: "Tu n'as pas assez de FlopoCoins" });

		const prediObject = activePredis[predi];
		if (!prediObject) return res.status(403).send({ message: "Prédiction introuvable" });

		if (prediObject.endTime < Date.now())
			return res.status(403).send({ message: "Les votes de cette prédiction sont clos" });

		const otherOption = option === 0 ? 1 : 0;
		if (
			prediObject.options[otherOption].votes.find((v) => v.id === commandUserId) &&
			commandUserId !== process.env.DEV_ID
		)
			return res.status(403).send({ message: "Tu ne peux pas voter pour les 2 deux options" });

		if (prediObject.options[option].votes.find((v) => v.id === commandUserId)) {
			activePredis[predi].options[option].votes.forEach((v) => {
				if (v.id === commandUserId) {
					if (v.amount === 250000) {
						return res.status(403).send({ message: "Tu as déjà parié le max (250K)" });
					}
					if (v.amount + intAmount > 250000) {
						intAmount = 250000 - v.amount;
						warning = true;
					}
					v.amount += intAmount;
				}
			});
		} else {
			activePredis[predi].options[option].votes.push({
				id: commandUserId,
				amount: intAmount,
			});
		}
		activePredis[predi].options[option].total += intAmount;

		activePredis[predi].options[option].percent =
			(activePredis[predi].options[option].total /
				(activePredis[predi].options[otherOption].total + activePredis[predi].options[option].total)) *
			100;
		activePredis[predi].options[otherOption].percent = 100 - activePredis[predi].options[option].percent;

		await socketEmit("new-predi", { action: "new vote" });

		await userService.updateUserCoins(commandUserId, commandUser.coins - intAmount);
		await logService.insertLog({
			id: commandUserId + "-" + Date.now(),
			userId: commandUserId,
			action: "PREDI_VOTE",
			targetUserId: null,
			coinsAmount: -intAmount,
			userNewAmount: commandUser.coins - intAmount,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		return res.status(200).send({ message: `Vote enregistré!` });
	});

	router.post("/end-predi", requireAuth, async (req, res) => {
		const { predi, confirm, winningOption } = req.body;
		const commandUserId = req.userId;

		const commandUser = await userService.getUser(commandUserId);
		if (!commandUser) return res.status(403).send({ message: "Oups, je ne te connais pas" });
		if (commandUserId !== process.env.DEV_ID)
			return res.status(403).send({ message: "Tu n'as pas les permissions requises" });

		const prediObject = activePredis[predi];
		if (!prediObject) return res.status(403).send({ message: "Prédiction introuvable" });
		if (prediObject.closed) return res.status(403).send({ message: "Prédiction déjà close" });

		if (!confirm) {
			activePredis[predi].cancelledTime = new Date();
			for (const v of activePredis[predi].options[0].votes) {
				const tempUser = await userService.getUser(v.id);
				try {
					await userService.updateUserCoins(v.id, tempUser.coins + v.amount);
					await logService.insertLog({
						id: v.id + "-" + Date.now(),
						userId: v.id,
						action: "PREDI_REFUND",
						targetUserId: v.id,
						coinsAmount: v.amount,
						userNewAmount: tempUser.coins + v.amount,
					});
				} catch (e) {
					console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`);
				}
			}
			for (const v of activePredis[predi].options[1].votes) {
				const tempUser = await userService.getUser(v.id);
				try {
					await userService.updateUserCoins(v.id, tempUser.coins + v.amount);
					await logService.insertLog({
						id: v.id + "-" + Date.now(),
						userId: v.id,
						action: "PREDI_REFUND",
						targetUserId: v.id,
						coinsAmount: v.amount,
						userNewAmount: tempUser.coins + v.amount,
					});
				} catch (e) {
					console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`);
				}
			}
			activePredis[predi].closed = true;
		} else {
			const losingOption = winningOption === 0 ? 1 : 0;
			for (const v of activePredis[predi].options[winningOption].votes) {
				const tempUser = await userService.getUser(v.id);
				const ratio =
					activePredis[predi].options[winningOption].total === 0
						? 0
						: activePredis[predi].options[losingOption].total / activePredis[predi].options[winningOption].total;
				try {
					await userService.updateUserCoins(v.id, tempUser.coins + v.amount * (1 + ratio));
					await logService.insertLog({
						id: v.id + "-" + Date.now(),
						userId: v.id,
						action: "PREDI_RESULT",
						targetUserId: v.id,
						coinsAmount: v.amount * (1 + ratio),
						userNewAmount: tempUser.coins + v.amount * (1 + ratio),
					});
				} catch (e) {
					console.log(`Impossible de créditer ${v.id} (${v.amount} coins pariés, *${1 + ratio})`);
				}
			}
			activePredis[predi].paidTime = new Date();
			activePredis[predi].closed = true;
			activePredis[predi].winning = winningOption;
		}

		try {
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const generalChannel = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
			const message = await generalChannel.messages.fetch(activePredis[predi].msgId);
			const updatedEmbed = new EmbedBuilder()
				.setTitle(`Prédiction de ${commandUser.username}`)
				.setDescription(`**${activePredis[predi].label}**`)
				.setFields(
					{
						name: `${activePredis[predi].options[0].label}`,
						value: ``,
						inline: true,
					},
					{ name: ``, value: `ou`, inline: true },
					{
						name: `${activePredis[predi].options[1].label}`,
						value: ``,
						inline: true,
					},
				)
				.setFooter({
					text: `${activePredis[predi].cancelledTime !== null ? "Prédi annulée" : "Prédi confirmée !"}`,
				})
				.setTimestamp(new Date());
			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setLabel("Voir")
					.setURL(`${process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}/dashboard`)
					.setStyle(ButtonStyle.Link),
			);
			await message.edit({ embeds: [updatedEmbed], components: [row] });
		} catch (err) {
			console.error("Error updating prédi message:", err);
		}

		await socketEmit("new-predi", { action: "closed predi" });
		await emitDataUpdated({ table: "users", action: "fin predi" });

		return res.status(200).json({ message: "Prédi close" });
	});

	router.post("/snake/reward", requireAuth, async (req, res) => {
		const discordId = req.userId;
		const { score, isWin } = req.body;
		try {
			const user = await userService.getUser(discordId);
			if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
			const reward = isWin ? score * 2 : score;
			const newCoins = user.coins + reward;
			await userService.updateUserCoins(discordId, newCoins);
			await logService.insertLog({
				id: `${discordId}-snake-reward-${Date.now()}`,
				userId: discordId,
				action: "SNAKE_GAME_REWARD",
				coinsAmount: reward,
				userNewAmount: newCoins,
				targetUserId: null,
			});
			await emitDataUpdated({ table: "users", action: "update" });
			return res.status(200).json({ message: `Récompense de ${reward} FlopoCoins attribuée !` });
		} catch (e) {
			console.error("Error rewarding snake game:", e);
			return res.status(500).json({ message: "Erreur lors de l'attribution de la récompense" });
		}
	});

	router.post("/queue/leave", requireAuth, async (req, res) => {
		const discordId = req.userId;
		const { game, reason } = req.body;
		if (game === "snake" && (reason === "beforeunload" || reason === "route-leave")) {
			const lobby = Object.values(activeSnakeGames).find(
				(l) => (l.p1.id === discordId || l.p2.id === discordId) && !l.gameOver,
			);
			if (!lobby) return;

			const player = lobby.p1.id === discordId ? lobby.p1 : lobby.p2;
			const otherPlayer = lobby.p1.id === discordId ? lobby.p2 : lobby.p1;
			if (player.gameOver === true) return res.status(200).json({ message: "Déjà quitté" });
			player.gameOver = true;
			otherPlayer.win = true;

			lobby.lastmove = Date.now();

			// Broadcast the updated state to both players
			await socketEmit("snakegamestate", {
				lobby: {
					p1: lobby.p1,
					p2: lobby.p2,
				},
			});

			// Check if game should end
			if (lobby.p1.gameOver && lobby.p2.gameOver) {
				// Both players finished - determine winner
				let winnerId = null;
				if (lobby.p1.win && !lobby.p2.win) {
					winnerId = lobby.p1.id;
				} else if (lobby.p2.win && !lobby.p1.win) {
					winnerId = lobby.p2.id;
				} else if (lobby.p1.score > lobby.p2.score) {
					winnerId = lobby.p1.id;
				} else if (lobby.p2.score > lobby.p1.score) {
					winnerId = lobby.p2.id;
				}
				// If scores are equal, winnerId remains null (draw)
				await onGameOver(client, "snake", discordId, winnerId, "", { p1: lobby.p1.score, p2: lobby.p2.score });
			} else if (lobby.p1.win || lobby.p2.win) {
				// One player won by filling the grid
				const winnerId = lobby.p1.win ? lobby.p1.id : lobby.p2.id;
				await onGameOver(client, "snake", discordId, winnerId, "", { p1: lobby.p1.score, p2: lobby.p2.score });
			}
		}
	});

	// Fixed coin offers - server-side source of truth
	const COIN_OFFERS = [
		{ id: "offer_5000", coins: 5000, amount_cents: 99, label: "5 000 FlopoCoins" },
		{ id: "offer_20000", coins: 20000, amount_cents: 299, label: "20 000 FlopoCoins" },
		{ id: "offer_40000", coins: 40000, amount_cents: 499, label: "40 000 FlopoCoins" },
		{ id: "offer_100000", coins: 100000, amount_cents: 999, label: "100 000 FlopoCoins" },
	];

	router.get("/coin-offers", (req, res) => {
		res.json({ offers: COIN_OFFERS });
	});

	router.post("/create-checkout-session", requireAuth, async (req, res) => {
		const userId = req.userId;
		const { offerId } = req.body;

		if (!offerId) {
			return res.status(400).json({ error: "Missing required field: offerId" });
		}

		const offer = COIN_OFFERS.find((o) => o.id === offerId);
		if (!offer) {
			return res.status(400).json({ error: "Invalid offer" });
		}

		const user = await userService.getUser(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		try {
			const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
			const FLAPI_URL = process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL;

			const session = await stripe.checkout.sessions.create({
				payment_method_types: ["card"],
				line_items: [
					{
						price_data: {
							currency: "eur",
							product_data: {
								name: offer.label,
								description: `Achat de ${offer.label} pour FlopoBot`,
							},
							unit_amount: offer.amount_cents,
						},
						quantity: 1,
					},
				],
				mode: "payment",
				success_url: `${FLAPI_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
				cancel_url: `${FLAPI_URL}/dashboard`,
				metadata: {
					userId: userId,
					coins: offer.coins.toString(),
				},
			});

			res.json({ sessionId: session.id, url: session.url });
		} catch (error) {
			console.error("Error creating checkout session:", error);
			res.status(500).json({ error: "Failed to create checkout session" });
		}
	});

	router.post("/buy-coins", async (req, res) => {
		const sig = req.headers["stripe-signature"];
		const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

		if (!endpointSecret) {
			console.error("STRIPE_WEBHOOK_SECRET not configured");
			return res.status(500).json({ error: "Webhook not configured" });
		}

		let event;

		try {
			// Verify webhook signature - requires raw body
			// Note: You need to configure Express to preserve raw body for this route
			const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
			event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
		} catch (err) {
			console.error(`Webhook signature verification failed: ${err.message}`);
			return res.status(400).json({ error: `Webhook Error: ${err.message}` });
		}

		// Handle the event
		if (event.type === "checkout.session.completed") {
			const session = event.data.object;

			// Extract metadata from the checkout session
			const commandUserId = session.metadata?.userId;
			const expectedCoins = parseInt(session.metadata?.coins);
			const amountPaid = session.amount_total; // in cents
			const currency = session.currency;
			const customerEmail = session.customer_details?.email;
			const customerName = session.customer_details?.name;

			// Validate metadata exists
			if (!commandUserId || !expectedCoins) {
				console.error("Missing userId or coins in session metadata");
				return res.status(400).json({ error: "Invalid session metadata" });
			}

			// Verify payment was successful
			if (session.payment_status !== "paid") {
				console.error(`Payment not completed for session ${session.id}`);
				return res.status(400).json({ error: "Payment not completed" });
			}

			// Check for duplicate processing (idempotency)
			const existingTransaction = await transactionService.getTransactionBySessionId(session.id);
			if (existingTransaction) {
				console.log(`Payment already processed: ${session.id}`);
				return res.status(200).json({ message: "Already processed" });
			}

			// Get user
			const user = await userService.getUser(commandUserId);
			if (!user) {
				console.error(`User not found: ${commandUserId}`);
				return res.status(404).json({ error: "User not found" });
			}

			// Update coins
			const newCoins = user.coins + expectedCoins;
			await userService.updateUserCoins(commandUserId, newCoins);

			// Insert transaction record
			const transactionId = `${commandUserId}-transaction-${Date.now()}`;
			await transactionService.insertTransaction({
				id: transactionId,
				sessionId: session.id,
				userId: commandUserId,
				coinsAmount: expectedCoins,
				amountCents: amountPaid,
				currency: currency,
				customerEmail: customerEmail,
				customerName: customerName,
				paymentStatus: session.payment_status,
			});

			// Insert log entry
			await logService.insertLog({
				id: `${commandUserId}-buycoins-${Date.now()}`,
				userId: commandUserId,
				action: "BUY_COINS",
				targetUserId: null,
				coinsAmount: expectedCoins,
				userNewAmount: newCoins,
			});

			console.log(
				`Payment processed: ${commandUserId} purchased ${expectedCoins} coins for ${amountPaid / 100} ${currency}`,
			);

			// Notify user via Discord if possible
			try {
				const discordUser = await resolveUser(client, commandUserId);
				await discordUser.send(
					`✅ Votre achat de ${expectedCoins} FlopoCoins a été confirmé ! Merci pour votre soutien !`,
				);
			} catch (e) {
				console.log(`Could not DM user ${commandUserId}:`, e.message);
			}

			return res.status(200).json({ message: `Added ${expectedCoins} coins.` });
		}

		// Return 200 for unhandled event types (Stripe requires this)
		res.status(200).json({ received: true });
	});

	return router;
}
