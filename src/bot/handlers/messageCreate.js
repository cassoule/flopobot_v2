import { sleep } from "openai/core";
import {
	buildAiMessages,
	buildParticipantsMap,
	buildTranscript,
	CONTEXT_LIMIT,
	gork,
	INCLUDE_ATTACHMENT_URLS,
	MAX_ATTS_PER_MESSAGE,
	stripMentionsOfBot,
} from "../../utils/ai.js";
import { calculateBasePrice, calculateMaxPrice, formatTime, getAkhys } from "../../utils/index.js";
import { channelPointsHandler, initTodaysSOTD, randomSkinPrice, slowmodesHandler } from "../../game/points.js";
import { activePolls, activeSlowmodes, requestTimestamps, skins } from "../../game/state.js";
import {
	flopoDB,
	getAllSkins,
	getAllUsers,
	getUser,
	hardUpdateSkin,
	insertLog,
	updateManyUsers,
	updateSkin,
	updateUserAvatar,
	updateUserCoins,
} from "../../database/index.js";
import { client } from "../client.js";
import { drawCaseContent, drawCaseSkin, getDummySkinUpgradeProbs } from "../../utils/caseOpening.js";

// Constants for the AI rate limiter
const MAX_REQUESTS_PER_INTERVAL = parseInt(process.env.MAX_REQUESTS || "5");
const SPAM_INTERVAL = parseInt(process.env.SPAM_INTERVAL || "60000"); // 60 seconds default

/**
 * Handles all logic for when a message is created.
 * @param {object} message - The Discord.js message object.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 */
export async function handleMessageCreate(message, client, io) {
	// Ignore all messages from bots to prevent loops
	if (message.author.bot) return;

	// --- Specific User Gags ---
	if (message.author.id === process.env.PATA_ID) {
		if (message.content.toLowerCase().startsWith("feur") || message.content.toLowerCase().startsWith("rati")) {
			await sleep(1000);
			await message.delete().catch(console.error);
		}
	}

	// --- Main Guild Features (Points & Slowmode) ---
	if (message.guildId === process.env.GUILD_ID) {
		// Award points for activity
		const pointsAwarded = channelPointsHandler(message);
		if (pointsAwarded) {
			io.emit("data-updated", { table: "users", action: "update" });
		}

		// Enforce active slowmodes
		const wasSlowmoded = await slowmodesHandler(message, activeSlowmodes);
		if (wasSlowmoded.deleted) {
			io.emit("slowmode-update");
		}
	}

	// --- AI Mention Handler ---
	if (message.mentions.has(client.user) || message.mentions.repliedUser?.id === client.user.id) {
		await handleAiMention(message, client, io);
		return; // Stop further processing after AI interaction
	}

	// --- "Quoi/Feur" Gag ---
	if (message.content.toLowerCase().includes("quoi")) {
		const prob = Math.random();
		if (prob < (parseFloat(process.env.FEUR_PROB) || 0.05)) {
			message.channel.send("feur").catch(console.error);
		}
		return;
	}

	// --- Admin/Dev Guild Commands ---
	if (message.guildId === process.env.DEV_GUILD_ID && message.author.id === process.env.DEV_ID) {
		await handleAdminCommands(message);
	}
}

// --- Sub-handler for AI Logic ---
async function handleAiMention(message, client, io) {
	const authorId = message.author.id;
	let authorDB = getUser.get(authorId);
	if (!authorDB) return; // Should not happen if user is in DB, but good practice

	// --- Rate Limiting ---
	const now = Date.now();
	const timestamps = (requestTimestamps.get(authorId) || []).filter((ts) => now - ts < SPAM_INTERVAL);

	if (timestamps.length >= MAX_REQUESTS_PER_INTERVAL) {
		console.log(`[${Date.now()}] Rate limit exceeded for ${authorDB.username}`);
		if (!authorDB.warned) {
			await message.reply(`T'abuses fréro, attends un peu ⏳`).catch(console.error);
		}
		// Update user's warn status
		authorDB.warned = 1;
		authorDB.warns += 1;
		authorDB.allTimeWarns += 1;
		updateManyUsers([authorDB]);

		// Apply timeout if warn count is too high
		if (authorDB.warns > (parseInt(process.env.MAX_WARNS) || 10)) {
			try {
				const member = await message.guild.members.fetch(authorId);
				const time = parseInt(process.env.SPAM_TIMEOUT_TIME);
				await member.timeout(time, "Spam excessif du bot AI.");
				message.channel
					.send(
						`Ce bouffon de <@${authorId}> a été timeout pendant ${formatTime(time / 1000)}, il me cassait les couilles 🤫`,
					)
					.catch(console.error);
			} catch (e) {
				console.error("Failed to apply timeout for AI spam:", e);
				message.channel
					.send(`<@${authorId}>, tu as de la chance que je ne puisse pas te timeout...`)
					.catch(console.error);
			}
		}
		return;
	}

	timestamps.push(now);
	requestTimestamps.set(authorId, timestamps);

	// Reset warns if user is behaving, and increment their request count
	authorDB.warned = 0;
	authorDB.warns = 0;
	authorDB.totalRequests += 1;
	updateManyUsers([authorDB]);

	// --- AI Processing ---
	try {
		await message.channel.sendTyping();

		// 1) Récup contexte
		const fetched = await message.channel.messages.fetch({
			limit: Math.min(CONTEXT_LIMIT, 100),
		});
		const messagesArray = Array.from(fetched.values()).reverse(); // oldest -> newest

		const requestText = stripMentionsOfBot(message.content, client.user.id);
		const invokerId = message.author.id;
		const invokerName = message.member?.nickname || message.author.globalName || message.author.username;
		const repliedUserId = message.mentions?.repliedUser?.id || null;

		// 2) Compact transcript & participants
		const participants = buildParticipantsMap(messagesArray);
		const transcript = buildTranscript(messagesArray, client.user.id);

		const invokerAttachments = Array.from(message.attachments?.values?.() || [])
			.slice(0, MAX_ATTS_PER_MESSAGE)
			.map((a) => ({
				id: a.id,
				name: a.name,
				type: a.contentType || "application/octet-stream",
				size: a.size,
				isImage: !!(a.contentType && a.contentType.startsWith("image/")),
				url: INCLUDE_ATTACHMENT_URLS ? a.url : undefined,
			}));

		// 3) Construire prompts
		const messageHistory = buildAiMessages({
			botId: client.user.id,
			botName: "FlopoBot",
			invokerId,
			invokerName,
			requestText,
			transcript,
			participants,
			repliedUserId,
			invokerAttachments,
		});

		// 4) Appel modèle
		const reply = await gork(messageHistory);

		// 5) Réponse
		await message.reply(reply);
	} catch (err) {
		console.error("Error processing AI mention:", err);
		await message.reply("Oups, mon cerveau a grillé. Réessaie plus tard.").catch(console.error);
	}
}

// --- Sub-handler for Admin Commands ---
async function handleAdminCommands(message) {
	const prefix = process.env.DEV_SITE === "true" ? "dev" : "flopo";
	const [command, ...args] = message.content.split(" ");

	switch (command) {
		case "?sp":
			let msgText = ""
			for (let skinTierRank = 1; skinTierRank <= 4; skinTierRank++) {
				msgText += `\n--- Tier Rank: ${skinTierRank} ---\n`;
				let skinMaxLevels = 4;
				let skinMaxChromas = 4;
				for (let skinLevel = 1; skinLevel < skinMaxLevels; skinLevel++) {
					msgText += (`Levels: ${skinLevel}/${skinMaxLevels}, MaxChromas: ${1}/${skinMaxChromas} - `);
					msgText += (`${getDummySkinUpgradeProbs(skinLevel, 1, skinTierRank, skinMaxLevels, skinMaxChromas, 15).successProb.toFixed(4)}, `);
					msgText += (`${getDummySkinUpgradeProbs(skinLevel, 1, skinTierRank, skinMaxLevels, skinMaxChromas, 15).destructionProb.toFixed(4)}, `);
					msgText += (`${getDummySkinUpgradeProbs(skinLevel, 1, skinTierRank, skinMaxLevels, skinMaxChromas, 15).upgradePrice}\n`);
				}
				for (let skinChroma = 1; skinChroma < skinMaxChromas; skinChroma++) {
					msgText += (`Levels: ${skinMaxLevels}/${skinMaxLevels}, MaxChromas: ${skinChroma}/${skinMaxChromas} - `);
					msgText += (`${getDummySkinUpgradeProbs(skinMaxLevels, skinChroma, skinTierRank, skinMaxLevels, skinMaxChromas, 15).successProb.toFixed(4)}, `);
					msgText += (`${getDummySkinUpgradeProbs(skinMaxLevels, skinChroma, skinTierRank, skinMaxLevels, skinMaxChromas, 15).destructionProb.toFixed(4)}, `);
					msgText += (`${getDummySkinUpgradeProbs(skinMaxLevels, skinChroma, skinTierRank, skinMaxLevels, skinMaxChromas, 15).upgradePrice}\n`);
				}
				message.reply(msgText);
				msgText = "";
			}
			break;
		case "?v":
			console.log("Active Polls:", activePolls);
			break;
		case "?sv":
			const amount = parseInt(args[0], 10);
			if (isNaN(amount)) return message.reply("Invalid amount.");
			let sum = 0;
			const start_at = Date.now();
			for (let i = 0; i < amount; i++) {
				sum += parseFloat(randomSkinPrice());
			}
			console.log(
				`Result for ${amount} skins: Avg: ~${(sum / amount).toFixed(0)} Flopos | Total: ${sum.toFixed(0)} Flopos | Elapsed: ${Date.now() - start_at}ms`,
			);
			break;
		case `${prefix}:sotd`:
			initTodaysSOTD();
			message.reply("New Solitaire of the Day initialized.");
			break;
		case `${prefix}:users`:
			console.log(getAllUsers.all());
			break;
		case `${prefix}:sql`:
			const sqlCommand = args.join(" ");
			try {
				const stmt = flopoDB.prepare(sqlCommand);
				const result = sqlCommand.trim().toUpperCase().startsWith("SELECT") ? stmt.all() : stmt.run();
				console.log(result);
				message.reply("```json\n" + JSON.stringify(result, null, 2).substring(0, 1900) + "\n```");
			} catch (e) {
				console.error(e);
				message.reply(`SQL Error: ${e.message}`);
			}
			break;
		case `${prefix}:fetch-data`:
			await getAkhys(client);
			break;
		case `${prefix}:avatars`:
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const members = await guild.members.fetch();
			const akhys = members.filter((m) => !m.user.bot && m.roles.cache.has(process.env.AKHY_ROLE_ID));

			const usersToUpdate = akhys.map((akhy) => ({
				id: akhy.user.id,
				avatarUrl: akhy.user.displayAvatarURL({ dynamic: true, size: 256 }),
			}));

			usersToUpdate.forEach((user) => {
				try {
					updateUserAvatar.run(user);
				} catch (err) {}
			});
			break;
		case `${prefix}:rework-skins`:
			console.log("Reworking all skin prices...");
			const dbSkins = getAllSkins.all();
			dbSkins.forEach((skin) => {
				const fetchedSkin = skins.find((s) => s.uuid === skin.uuid);
				const basePrice = calculateBasePrice(fetchedSkin, skin.tierRank)?.toFixed(0);
				const calculatePrice = () => {
					if (!skin.basePrice) return null;
					let result = parseFloat(basePrice);
					result *= 1 + skin.currentLvl / Math.max(fetchedSkin.levels.length, 2);
					result *= 1 + skin.currentChroma / 4;
					return parseFloat(result.toFixed(0));
				};
				const maxPrice = calculateMaxPrice(basePrice, fetchedSkin).toFixed(0);
				hardUpdateSkin.run({
					uuid: skin.uuid,
					displayName: skin.displayName,
					contentTierUuid: skin.contentTierUuid,
					displayIcon: skin.displayIcon,
					user_id: skin.user_id,
					tierRank: skin.tierRank,
					tierColor: skin.tierColor,
					tierText: skin.tierText,
					basePrice: basePrice,
					currentLvl: skin.currentLvl || null,
					currentChroma: skin.currentChroma || null,
					currentPrice: skin.currentPrice ? calculatePrice() : null,
					maxPrice: maxPrice,
				});
			});
			console.log("Reworked", dbSkins.length, "skins.");
			break;
		case `${prefix}:cases-test`:
			try {
				const caseType = args[0] ?? "standard";
				const caseCount = args[1] ?? 1;

				let totalResValue = 0;
				let highestSkinPrice = 0;
				let priceTiers = {
					0: 0,
					100: 0,
					200: 0,
					300: 0,
					400: 0,
					500: 0,
					600: 0,
					700: 0,
					800: 0,
					900: 0,
					1000: 0,
				};

				for (let i = 0; i < caseCount; i++) {
					const skins = await drawCaseContent(caseType);
					const result = drawCaseSkin(skins);
					totalResValue += result.finalPrice;
					if (result.finalPrice > highestSkinPrice) highestSkinPrice = result.finalPrice;
					if (result.finalPrice > 0 && result.finalPrice < 100) priceTiers["0"] += 1;
					if (result.finalPrice >= 100 && result.finalPrice < 200) priceTiers["100"] += 1;
					if (result.finalPrice >= 200 && result.finalPrice < 300) priceTiers["200"] += 1;
					if (result.finalPrice >= 300 && result.finalPrice < 400) priceTiers["300"] += 1;
					if (result.finalPrice >= 400 && result.finalPrice < 500) priceTiers["400"] += 1;
					if (result.finalPrice >= 500 && result.finalPrice < 600) priceTiers["500"] += 1;
					if (result.finalPrice >= 600 && result.finalPrice < 700) priceTiers["600"] += 1;
					if (result.finalPrice >= 700 && result.finalPrice < 800) priceTiers["700"] += 1;
					if (result.finalPrice >= 800 && result.finalPrice < 900) priceTiers["800"] += 1;
					if (result.finalPrice >= 900 && result.finalPrice < 1000) priceTiers["900"] += 1;
					if (result.finalPrice >= 1000) priceTiers["1000"] += 1;
					console.log(
						`Case ${i + 1}: Won a skin worth ${result.finalPrice} Flopos, ${caseType}, ${result.updatedSkin.tierRank}`,
					);
				}

				console.log(totalResValue / caseCount);
				message.reply(
					`${totalResValue / caseCount} average skin price over ${caseCount} ${caseType} cases.\nHighest skin price: ${highestSkinPrice}\nPrice tier distribution: ${JSON.stringify(priceTiers)}`,
				);
			} catch (e) {
				console.log(e);
				message.reply(`Error during case test: ${e.message}`);
			}
			break;
		case `${prefix}:refund-skins`:
			try {
				const DBskins = getAllSkins.all();
				for (const skin of DBskins) {
					const owner = getUser.get(skin.user_id);
					if (owner) {
						updateUserCoins.run({
							id: owner.id,
							coins: owner.coins + skin.currentPrice,
						});
						insertLog.run({
							id: `${skin.uuid}-skin-refund-${Date.now()}`,
							user_id: owner.id,
							target_user_id: null,
							action: "SKIN_REFUND",
							coins_amount: skin.currentPrice,
							user_new_amount: owner.coins + skin.currentPrice,
						});
					}
					updateSkin.run({
						uuid: skin.uuid,
						user_id: null,
						currentPrice: null,
						currentLvl: null,
						currentChroma: null,
					});
				}
				message.reply("All skins refunded.");
			} catch (e) {
				console.log(e);
				message.reply(`Error during refund skins ${e.message}`);
			}

			break;
	}
}
