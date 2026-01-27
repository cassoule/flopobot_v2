import express from "express";
import { sleep } from "openai/core";

// --- Database Imports ---
import {
	getAllAkhys,
	getAllUsers,
	getLogs,
	getMarketOffersBySkin,
	getOfferBids,
	getSkin,
	getUser,
	getUserElo,
	getUserGames,
	getUserInventory,
	getUserLogs,
	getUsersByElo,
	insertLog,
	insertUser,
	pruneOldLogs,
	queryDailyReward,
	updateSkin,
	updateUserCoins,
} from "../../database/index.js";

// --- Game State Imports ---
import { activePolls, activePredis, activeSlowmodes, skins } from "../../game/state.js";

// --- Utility and API Imports ---
import { formatTime, isMeleeSkin, isVCTSkin, isChampionsSkin, getVCTRegion } from "../../utils/index.js";
import { DiscordRequest } from "../../api/discord.js";

// --- Discord.js Builder Imports ---
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { emitDataUpdated, socketEmit } from "../socket.js";
import { handleCaseOpening } from "../../utils/marketNotifs.js";
import { drawCaseContent, drawCaseSkin, getSkinUpgradeProbs } from "../../utils/caseOpening.js";

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

	router.get("/check", (req, res) => {
		res.status(200).json({ status: "OK", message: "FlopoBot API is running." });
	});

	router.get("/users", (req, res) => {
		try {
			const users = getAllUsers.all();
			res.json(users);
		} catch (error) {
			console.error("Error fetching users:", error);
			res.status(500).json({ error: "Failed to fetch users." });
		}
	});

	router.get("/akhys", (req, res) => {
		try {
			const akhys = getAllAkhys.all();
			res.json(akhys);
		} catch (error) {
			console.error("Error fetching akhys:", error);
			res.status(500).json({ error: "Failed to fetch akhys" });
		}
	});

	router.post("/register-user", async (req, res) => {
		const { discordUserId } = req.body;
		const discordUser = await client.users.fetch(discordUserId);

		try {
			insertUser.run({
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

			updateUserCoins.run({ id: discordUser.id, coins: 5000 });
			insertLog.run({
				id: `${discordUser.id}-welcome-${Date.now()}`,
				user_id: discordUser.id,
				action: "WELCOME_BONUS",
				target_user_id: null,
				coins_amount: 5000,
				user_new_amount: 5000,
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

	router.post("/open-case", async (req, res) => {
		const { userId, caseType } = req.body;

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
		const commandUser = getUser.get(userId);
		if (!commandUser) return res.status(404).json({ error: "User not found." });
		const valoPrice = caseTypeVal;
		if (commandUser.coins < valoPrice) return res.status(403).json({ error: "Not enough FlopoCoins." });

		try {
			const selectedSkins = await drawCaseContent(caseType);

			const result = drawCaseSkin(selectedSkins);

			// --- Update Database ---
			insertLog.run({
				id: `${userId}-${Date.now()}`,
				user_id: userId,
				action: "VALO_CASE_OPEN",
				target_user_id: null,
				coins_amount: -valoPrice,
				user_new_amount: commandUser.coins - valoPrice,
			});
			updateUserCoins.run({
				id: userId,
				coins: commandUser.coins - valoPrice,
			});
			updateSkin.run({
				uuid: result.randomSkinData.uuid,
				user_id: userId,
				currentLvl: result.randomLevel,
				currentChroma: result.randomChroma,
				currentPrice: result.finalPrice,
			});

			console.log(
				`${commandUser.username} opened a ${caseType} Valorant case and received skin ${result.randomSelectedSkinUuid}`,
			);
			const updatedSkin = getSkin.get(result.randomSkinData.uuid);
			await handleCaseOpening(caseType, userId, result.randomSelectedSkinUuid, client);
			
			const contentSkins = selectedSkins.map((item) => { 
				return {
					...item,
					isMelee: isMeleeSkin(item.displayName),
					isVCT: isVCTSkin(item.displayName),
					isChampions: isChampionsSkin(item.displayName),
					vctRegion: getVCTRegion(item.displayName),
				}
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

	router.get("/case-content/:type", async (req, res) => {
		const { type } = req.params;
		try {
			const selectedSkins = await drawCaseContent(type, -1);
			selectedSkins.forEach((item) => {
				item.isMelee = isMeleeSkin(item.displayName);
				item.isVCT = isVCTSkin(item.displayName);
				item.isChampions = isChampionsSkin(item.displayName);
				item.vctRegion = getVCTRegion(item.displayName);
				item.basePrice = getSkin.get(item.uuid).basePrice;
				item.maxPrice = getSkin.get(item.uuid).maxPrice;
			});
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

	router.post("/skin/:uuid/instant-sell", (req, res) => {
		const { userId } = req.body;
		try {
			const skin = getSkin.get(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			if (
				!skinData
			) {
				return res.status(403).json({ error: "Invalid skin." });
			}
			if (skin.user_id !== userId) {
				return res.status(403).json({ error: "User does not own this skin." });
			}

			const marketOffers = getMarketOffersBySkin.all(skin.uuid);
			const activeOffers = marketOffers.filter((offer) => offer.status === "pending" || offer.status === "open");
			if (activeOffers.length > 0) {
				return res.status(403).json({ error: "Impossible de vendre ce skin, une offre FlopoMarket est déjà en cours." });
			}

			const commandUser = getUser.get(userId);
			if (!commandUser) {
				return res.status(404).json({ error: "User not found." });
			}
			const sellPrice = skin.currentPrice;

			insertLog.run({
				id: `${userId}-${Date.now()}`,
				user_id: userId,
				action: "VALO_SKIN_INSTANT_SELL",
				target_user_id: null,
				coins_amount: sellPrice,
				user_new_amount: commandUser.coins + sellPrice,
			});
			updateUserCoins.run({
				id: userId,
				coins: commandUser.coins + sellPrice,
			});
			updateSkin.run({
				uuid: skin.uuid,
				user_id: null,
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

	router.get("/skin-upgrade/:uuid/fetch", (req, res) => {
		try {
			const skin = getSkin.get(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			const { successProb, destructionProb, upgradePrice } = getSkinUpgradeProbs(skin, skinData);

			const segments = [
				{ id: 'SUCCEEDED',   color: '5865f2', percent: successProb, label: 'Réussie' },
				{ id: 'DESTRUCTED', color: 'f26558', percent: destructionProb, label: 'Détruit' },
				{ id: 'NONE',   color: '18181818', percent: 1 - successProb - destructionProb, label: 'Échec' },
			]
			
			res.json({ segments, upgradePrice });
		} catch (error) {
			console.log(error)
			res.status(500).json({ error: "Failed to fetch skin upgrade." });
		}
	});

	router.post("/skin-upgrade/:uuid", async (req, res) => {
		const { userId } = req.body;
		try {
			const skin = getSkin.get(req.params.uuid);
			const skinData = skins.find((s) => s.uuid === skin.uuid);
			if (
				!skinData ||
				(skin.currentLvl >= skinData.levels.length && skin.currentChroma >= skinData.chromas.length)
			) {
				return res.status(403).json({ error: "Skin is already maxed out or invalid skin." });
			}
			if (skin.user_id !== userId) {
				return res.status(403).json({ error: "User does not own this skin." });
			}
			const marketOffers = getMarketOffersBySkin.all(skin.uuid);
			const activeOffers = marketOffers.filter((offer) => offer.status === "pending" || offer.status === "open");
			if (activeOffers.length > 0) {
				return res.status(403).json({ error: "Impossible d'améliorer ce skin, une offre FlopoMarket est en cours." });
			}
			const { successProb, destructionProb, upgradePrice } = getSkinUpgradeProbs(skin, skinData);

			const commandUser = getUser.get(userId);
			if (!commandUser) {
				return res.status(404).json({ error: "User not found." });
			}
			if (commandUser.coins < upgradePrice) {
				return res.status(403).json({ error: `Pas assez de FlopoCoins (${upgradePrice} requis).` });
			}
		
			insertLog.run({
				id: `${userId}-${Date.now()}`,
				user_id: userId,
				action: "VALO_SKIN_UPGRADE",
				target_user_id: null,
				coins_amount: -upgradePrice,
				user_new_amount: commandUser.coins - upgradePrice,
			});
			updateUserCoins.run({
				id: userId,
				coins: commandUser.coins - upgradePrice,
			});

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
		
				updateSkin.run({
					uuid: skin.uuid,
					user_id: skin.user_id,
					currentLvl: skin.currentLvl,
					currentChroma: skin.currentChroma,
					currentPrice: skin.currentPrice,
				});
			} else if (destructed) {
				updateSkin.run({
					uuid: skin.uuid,
					user_id: null,
					currentLvl: null,
					currentChroma: null,
					currentPrice: null,
				});
			}
			
			console.log(`${commandUser.username} attempted to upgrade skin ${skin.uuid} - ${succeeded ? "SUCCEEDED" : destructed ? "DESTRUCTED" : "FAILED"}`);
			res.json({ wonId: succeeded ? "SUCCEEDED" : destructed ? "DESTRUCTED" : "NONE" });
		} catch (error) {
			console.error("Error fetching skin upgrade:", error);
			res.status(500).json({ error: "Failed to fetch skin upgrade." });
		}
	});

	router.get("/users/by-elo", (req, res) => {
		try {
			const users = getUsersByElo.all();
			res.json(users);
		} catch (error) {
			console.error("Error fetching users by Elo:", error);
			res.status(500).json({ error: "Failed to fetch users by Elo." });
		}
	});

	router.get("/logs", async (req, res) => {
		try {
			await pruneOldLogs();
			const logs = getLogs.all();
			res.status(200).json(logs);
		} catch (error) {
			console.error("Error fetching logs:", error);
			res.status(500).json({ error: "Failed to fetch logs." });
		}
	});

	// --- User-Specific Routes ---
	router.get("/user/:id", async (req, res) => {
		try {
			const user = getUser.get(req.params.id);
			res.json({ user });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/avatar", async (req, res) => {
		try {
			const user = await client.users.fetch(req.params.id);
			const avatarUrl = user.displayAvatarURL({ format: "png", size: 256 });
			res.json({ avatarUrl });
		} catch (error) {
			res.status(404).json({ error: "User not found or failed to fetch avatar." });
		}
	});

	router.get("/user/:id/username", async (req, res) => {
		try {
			const user = await client.users.fetch(req.params.id);
			res.json({ user });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/coins", async (req, res) => {
		try {
			const user = getUser.get(req.params.id);
			res.json({ coins: user.coins });
		} catch (error) {
			res.status(404).json({ error: "User not found." });
		}
	});

	router.get("/user/:id/sparkline", (req, res) => {
		try {
			const logs = getUserLogs.all({ user_id: req.params.id });
			res.json({ sparkline: logs });
		} catch (error) {
			res.status(500).json({ error: "Failed to fetch logs for sparkline." });
		}
	});

	router.get("/user/:id/elo", (req, res) => {
		try {
			const eloData = getUserElo.get({ id: req.params.id });
			res.json({ elo: eloData?.elo || null });
		} catch (e) {
			res.status(500).json({ error: "Failed to fetch Elo data." });
		}
	});

	router.get("/user/:id/elo-graph", (req, res) => {
		try {
			const games = getUserGames.all({ user_id: req.params.id });
			const eloHistory = games
				.filter((g) => g.type !== 'POKER_ROUND' && g.type !== 'SOTD')
				.filter((game) => game.p2 !== null)
				.map((game) => (game.p1 === req.params.id ? game.p1_new_elo : game.p2_new_elo));
			eloHistory.splice(0, 0, 1000);
			res.json({ elo_graph: eloHistory });
		} catch (e) {
			res.status(500).json({ error: "Failed to generate Elo graph." });
		}
	});

	router.get("/user/:id/inventory", (req, res) => {
		try {
			const inventory = getUserInventory.all({ user_id: req.params.id });
			inventory.forEach((skin) => {
				const marketOffers = getMarketOffersBySkin.all(skin.uuid);
				marketOffers.forEach((offer) => {
					offer.skin = getSkin.get(offer.skin_uuid);
					offer.seller = getUser.get(offer.seller_id);
					offer.buyer = getUser.get(offer.buyer_id) || null;
					offer.bids = getOfferBids.all(offer.id) || {};
					offer.bids.forEach((bid) => {
						bid.bidder = getUser.get(bid.bidder_id);
					});
				});
				skin.offers = marketOffers || {};
				skin.isMelee = isMeleeSkin(skin.displayName);
				skin.isVCT = isVCTSkin(skin.displayName);
				skin.isChampions = isChampionsSkin(skin.displayName);
				skin.vctRegion = getVCTRegion(skin.displayName);
			});
			res.json({ inventory });
		} catch (error) {
			res.status(500).json({ error: "Failed to fetch inventory." });
		}
	});

	router.get("/user/:id/games-history", async (req, res) => {
		try {
			const games = getUserGames.all({ user_id: req.params.id }).filter((g) => g.type !== 'POKER_ROUND' && g.type !== 'SOTD').reverse().slice(0, 50);
			res.json({ games });
		} catch (err) {
			res.status(500).json({ error: "Failed to fetch games history." });
		}
	});

	router.get("/user/:id/daily", async (req, res) => {
		const { id } = req.params;
		try {
			const akhy = getUser.get(id);
			if (!akhy) return res.status(404).json({ message: "Utilisateur introuvable" });
			if (akhy.dailyQueried) return res.status(403).json({ message: "Récompense journalière déjà récupérée." });

			const amount = 500;
			const newCoins = akhy.coins + amount;
			queryDailyReward.run(id);
			updateUserCoins.run({ id, coins: newCoins });
			insertLog.run({
				id: `${id}-daily-${Date.now()}`,
				user_id: id,
				action: "DAILY_REWARD",
				target_user_id: null,
				coins_amount: amount,
				user_new_amount: newCoins,
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

	router.post("/timedout", async (req, res) => {
		try {
			const { userId } = req.body;
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const member = await guild.members.fetch(userId);
			res.status(200).json({ isTimedOut: member?.isCommunicationDisabled() || false });
		} catch (e) {
			res.status(404).send({ message: "Member not found or guild unavailable." });
		}
	});

	// --- Shop & Interaction Routes ---

	router.post("/change-nickname", async (req, res) => {
		const { userId, nickname, commandUserId } = req.body;
		const commandUser = getUser.get(commandUserId);
		if (!commandUser) return res.status(404).json({ message: "Command user not found." });
		if (commandUser.coins < 1000) return res.status(403).json({ message: "Pas assez de FlopoCoins (1000 requis)." });

		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const member = await guild.members.fetch(userId);
			const old_nickname = member.nickname;
			await member.setNickname(nickname);

			const newCoins = commandUser.coins - 1000;
			updateUserCoins.run({ id: commandUserId, coins: newCoins });
			insertLog.run({
				id: `${commandUserId}-changenick-${Date.now()}`,
				user_id: commandUserId,
				action: "CHANGE_NICKNAME",
				target_user_id: userId,
				coins_amount: -1000,
				user_new_amount: newCoins,
			});

			console.log(`${commandUserId} change nickname of ${userId}: ${old_nickname} -> ${nickname}`);

			try {
				const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

	router.post("/spam-ping", async (req, res) => {
		const { userId, commandUserId } = req.body;

		const user = getUser.get(userId);
		const commandUser = getUser.get(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 5000) return res.status(403).json({ message: "Pas assez de coins" });

		try {
			const discordUser = await client.users.fetch(userId);

			await discordUser.send(`<@${userId}>`);

			res.status(200).json({ message: "C'est parti ehehe" });

			updateUserCoins.run({
				id: commandUserId,
				coins: commandUser.coins - 5000,
			});
			insertLog.run({
				id: commandUserId + "-" + Date.now(),
				user_id: commandUserId,
				action: "SPAM_PING",
				target_user_id: userId,
				coins_amount: -5000,
				user_new_amount: commandUser.coins - 5000,
			});
			await emitDataUpdated({ table: "users", action: "update" });

			try {
				const guild = await client.guilds.fetch(process.env.GUILD_ID);
				const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

	router.post("/slowmode", async (req, res) => {
		let { userId, commandUserId } = req.body;

		const user = getUser.get(userId);
		const commandUser = getUser.get(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 10000) return res.status(403).json({ message: "Pas assez de coins" });

		if (!user) return res.status(403).send({ message: "Oups petit problème" });

		if (activeSlowmodes[userId]) {
			if (userId === commandUserId) {
				delete activeSlowmodes[userId];
				await socketEmit("new-slowmode", { action: "new slowmode" });

				updateUserCoins.run({
					id: commandUserId,
					coins: commandUser.coins - 10000,
				});
				insertLog.run({
					id: commandUserId + "-" + Date.now(),
					user_id: commandUserId,
					action: "SLOWMODE",
					target_user_id: userId,
					coins_amount: -10000,
					user_new_amount: commandUser.coins - 10000,
				});

				try {
					const guild = await client.guilds.fetch(process.env.GUILD_ID);
					const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

		updateUserCoins.run({
			id: commandUserId,
			coins: commandUser.coins - 10000,
		});
		insertLog.run({
			id: commandUserId + "-" + Date.now(),
			user_id: commandUserId,
			action: "SLOWMODE",
			target_user_id: userId,
			coins_amount: -10000,
			user_new_amount: commandUser.coins - 10000,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

	router.post("/timeout", async (req, res) => {
		let { userId, commandUserId } = req.body;

		const user = getUser.get(userId);
		const commandUser = getUser.get(commandUserId);

		if (!commandUser || !user) return res.status(404).json({ message: "Oups petit soucis" });

		if (commandUser.coins < 100000) return res.status(403).json({ message: "Pas assez de coins" });

		if (!user) return res.status(403).send({ message: "Oups petit problème" });

		const guild = await client.guilds.fetch(process.env.GUILD_ID);
		const member = await guild.members.fetch(userId);

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

			updateUserCoins.run({
				id: commandUserId,
				coins: commandUser.coins - 10000,
			});
			insertLog.run({
				id: commandUserId + "-" + Date.now(),
				user_id: commandUserId,
				action: "TIMEOUT",
				target_user_id: userId,
				coins_amount: -10000,
				user_new_amount: commandUser.coins - 10000,
			});

			try {
				const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

		updateUserCoins.run({
			id: commandUserId,
			coins: commandUser.coins - 100000,
		});
		insertLog.run({
			id: commandUserId + "-" + Date.now(),
			user_id: commandUserId,
			action: "TIMEOUT",
			target_user_id: userId,
			coins_amount: -100000,
			user_new_amount: commandUser.coins - 100000,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		try {
			const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

	router.post("/start-predi", async (req, res) => {
		let { commandUserId, label, options, closingTime, payoutTime } = req.body;

		const commandUser = getUser.get(commandUserId);

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
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

		updateUserCoins.run({
			id: commandUserId,
			coins: commandUser.coins - 100,
		});
		insertLog.run({
			id: commandUserId + "-" + Date.now(),
			user_id: commandUserId,
			action: "START_PREDI",
			target_user_id: null,
			coins_amount: -100,
			user_new_amount: commandUser.coins - 100,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		return res.status(200).json({ message: `Ta prédi '${label}' a commencée !` });
	});

	router.post("/vote-predi", async (req, res) => {
		const { commandUserId, predi, amount, option } = req.body;

		let warning = false;

		let intAmount = parseInt(amount);
		if (intAmount < 10 || intAmount > 250000) return res.status(403).send({ message: "Montant invalide" });

		const commandUser = getUser.get(commandUserId);
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

		updateUserCoins.run({
			id: commandUserId,
			coins: commandUser.coins - intAmount,
		});
		insertLog.run({
			id: commandUserId + "-" + Date.now(),
			user_id: commandUserId,
			action: "PREDI_VOTE",
			target_user_id: null,
			coins_amount: -intAmount,
			user_new_amount: commandUser.coins - intAmount,
		});
		await emitDataUpdated({ table: "users", action: "update" });

		return res.status(200).send({ message: `Vote enregistré!` });
	});

	router.post("/end-predi", async (req, res) => {
		const { commandUserId, predi, confirm, winningOption } = req.body;

		const commandUser = getUser.get(commandUserId);
		if (!commandUser) return res.status(403).send({ message: "Oups, je ne te connais pas" });
		if (commandUserId !== process.env.DEV_ID)
			return res.status(403).send({ message: "Tu n'as pas les permissions requises" });

		const prediObject = activePredis[predi];
		if (!prediObject) return res.status(403).send({ message: "Prédiction introuvable" });
		if (prediObject.closed) return res.status(403).send({ message: "Prédiction déjà close" });

		if (!confirm) {
			activePredis[predi].cancelledTime = new Date();
			activePredis[predi].options[0].votes.forEach((v) => {
				const tempUser = getUser.get(v.id);
				try {
					updateUserCoins.run({
						id: v.id,
						coins: tempUser.coins + v.amount,
					});
					insertLog.run({
						id: v.id + "-" + Date.now(),
						user_id: v.id,
						action: "PREDI_REFUND",
						target_user_id: v.id,
						coins_amount: v.amount,
						user_new_amount: tempUser.coins + v.amount,
					});
				} catch (e) {
					console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`);
				}
			});
			activePredis[predi].options[1].votes.forEach((v) => {
				const tempUser = getUser.get(v.id);
				try {
					updateUserCoins.run({
						id: v.id,
						coins: tempUser.coins + v.amount,
					});
					insertLog.run({
						id: v.id + "-" + Date.now(),
						user_id: v.id,
						action: "PREDI_REFUND",
						target_user_id: v.id,
						coins_amount: v.amount,
						user_new_amount: tempUser.coins + v.amount,
					});
				} catch (e) {
					console.log(`Impossible de rembourser ${v.id} (${v.amount} coins)`);
				}
			});
			activePredis[predi].closed = true;
		} else {
			const losingOption = winningOption === 0 ? 1 : 0;
			activePredis[predi].options[winningOption].votes.forEach((v) => {
				const tempUser = getUser.get(v.id);
				const ratio =
					activePredis[predi].options[winningOption].total === 0
						? 0
						: activePredis[predi].options[losingOption].total / activePredis[predi].options[winningOption].total;
				try {
					updateUserCoins.run({
						id: v.id,
						coins: tempUser.coins + v.amount * (1 + ratio),
					});
					insertLog.run({
						id: v.id + "-" + Date.now(),
						user_id: v.id,
						action: "PREDI_RESULT",
						target_user_id: v.id,
						coins_amount: v.amount * (1 + ratio),
						user_new_amount: tempUser.coins + v.amount * (1 + ratio),
					});
				} catch (e) {
					console.log(`Impossible de créditer ${v.id} (${v.amount} coins pariés, *${1 + ratio})`);
				}
			});
			activePredis[predi].paidTime = new Date();
			activePredis[predi].closed = true;
			activePredis[predi].winning = winningOption;
		}

		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.GENERAL_CHANNEL_ID);
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

	// --- Admin Routes ---

	router.post("/buy-coins", (req, res) => {
		const { commandUserId, coins } = req.body;
		const user = getUser.get(commandUserId);
		if (!user) return res.status(404).json({ error: "User not found" });

		const newCoins = user.coins + coins;
		updateUserCoins.run({ id: commandUserId, coins: newCoins });
		insertLog.run({
			id: `${commandUserId}-buycoins-${Date.now()}`,
			user_id: commandUserId,
			action: "BUY_COINS_ADMIN",
			coins_amount: coins,
			user_new_amount: newCoins,
		});

		res.status(200).json({ message: `Added ${coins} coins.` });
	});

	return router;
}
