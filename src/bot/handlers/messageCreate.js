import { sleep } from "openai/core";
import { AttachmentBuilder } from "discord.js";
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
import { calculateBasePrice, calculateMaxPrice, formatTime, getAkhys, resolveMember } from "../../utils/index.js";
import {
	channelPointsHandler,
	initTodaysSOTD,
	randomSkinPrice,
	slowmodesHandler,
	initTodaysSudokuOTD,
} from "../../game/points.js";
import { activePolls, activeSlowmodes, requestTimestamps, skins, maintenance } from "../../game/state.js";
import { activateMaintenance, deactivateMaintenance, startMaintenanceNotifications } from "../../server/socket.js";
import prisma from "../../prisma/client.js";
import * as userService from "../../services/user.service.js";
import * as skinService from "../../services/skin.service.js";
import * as logService from "../../services/log.service.js";
import { client } from "../client.js";
import { drawCaseContent, drawCaseSkin, getDummySkinUpgradeProbs } from "../../utils/caseOpening.js";
import { fetchSuggestedPrices, fetchSkinsData } from "../../api/cs.js";
import { csSkinsData, csSkinsPrices } from "../../utils/cs.state.js";
import { getRandomSkinWithRandomSpecs, RarityToColor } from "../../utils/cs.utils.js";
import {
	findCaseByName,
	findOrphanSkins,
	getAllCases,
	getCaseById,
	getCaseContents,
	openCase,
} from "../../utils/cs.cases.js";
import * as csSkinService from "../../services/csSkin.service.js";

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
		// const pointsAwarded = channelPointsHandler(message);
		// if (pointsAwarded) {
		// 	io.emit("data-updated", { table: "users", action: "update" });
		// }

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
	let authorDB = await userService.getUser(authorId);
	if (!authorDB) return; // Should not happen if user is in DB, but good practice

	// --- Rate Limiting ---
	const now = Date.now();
	const timestamps = (requestTimestamps.get(authorId) || []).filter((ts) => now - ts < SPAM_INTERVAL);

	if (timestamps.length >= MAX_REQUESTS_PER_INTERVAL) {
		console.log(`Rate limit exceeded for ${authorDB.username}`);
		if (!authorDB.warned) {
			await message.reply(`T'abuses fréro, attends un peu ⏳`).catch(console.error);
		}
		// Update user's warn status
		authorDB.warned = 1;
		authorDB.warns += 1;
		authorDB.allTimeWarns += 1;
		await userService.updateManyUsers([authorDB]);

		// Apply timeout if warn count is too high
		if (authorDB.warns > (parseInt(process.env.MAX_WARNS) || 10)) {
			try {
				const member = await resolveMember(message.guild, authorId);
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
	await userService.updateManyUsers([authorDB]);

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
		case `${prefix}:init-solitaire`:
			initTodaysSOTD();
			message.reply("New Solitaire of the Day initialized.");
			break;
		case `${prefix}:init-sudoku`:
			initTodaysSudokuOTD();
			message.reply("New Sudoku of the Day initialized.");
			break;
		case `${prefix}:sql`:
			const sqlCommand = args.join(" ");
			try {
				const result = sqlCommand.trim().toUpperCase().startsWith("SELECT")
					? await prisma.$queryRawUnsafe(sqlCommand)
					: await prisma.$executeRawUnsafe(sqlCommand);
				const jsonString = JSON.stringify(result, null, 2);
				const buffer = Buffer.from(jsonString, "utf-8");
				const attachment = new AttachmentBuilder(buffer, { name: "sql-result.json" });
				message.reply({ content: "SQL query executed successfully:", files: [attachment] });
			} catch (e) {
				message.reply(`SQL Error: ${e.message}`);
			}
			break;
		case `${prefix}:fetch-data`:
			await getAkhys(client);
			break;
		case `${prefix}:avatars`:
			const guild = client.guilds.cache.get(process.env.GUILD_ID);
			const members = await guild.members.fetch();
			const akhys = members.filter((m) => !m.user.bot && m.roles.cache.has(process.env.AKHY_ROLE_ID));

			const usersToUpdate = akhys.map((akhy) => ({
				id: akhy.user.id,
				avatarUrl: akhy.user.displayAvatarURL({ dynamic: true, size: 256 }),
			}));

			for (const user of usersToUpdate) {
				try {
					await userService.updateUserAvatar(user.id, user.avatarUrl);
				} catch (err) {}
			}
			break;
		case `${prefix}:refund-skins`:
			try {
				const allCsSkins = await csSkinService.getAllOwnedCsSkins();
				let refundedCount = 0;
				let totalRefunded = 0;
				for (const skin of allCsSkins) {
					const price = skin.price || 0;
					let owner = null;
					try {
						owner = await userService.getUser(skin.userId);
					} catch {
						//
					}
					if (owner) {
						await userService.updateUserCoins(owner.id, owner.coins + price);
						await logService.insertLog({
							id: `${skin.id}-cs-skin-refund-${Date.now()}`,
							userId: owner.id,
							targetUserId: null,
							action: "CS_SKIN_REFUND",
							coinsAmount: price,
							userNewAmount: owner.coins + price,
						});
						totalRefunded += price;
						refundedCount++;
					}
					await csSkinService.deleteCsSkin(skin.id);
				}
				message.reply(`Refunded ${refundedCount} CS skins (${totalRefunded} FlopoCoins total).`);
			} catch (e) {
				console.log(e);
				message.reply(`Error during refund skins ${e.message}`);
			}

			break;
		case `${prefix}:cs-search`:
			try {
				const searchTerm = args.join(" ");
				if (!searchTerm) {
					message.reply("Please provide a search term.");
					return;
				}
				const filteredData = csSkinsData
					? Object.values(csSkinsData).filter((skin) => {
							const name = skin.market_hash_name.toLowerCase();
							return args.every((word) => name.includes(word.toLowerCase()));
						})
					: [];
				if (filteredData.length === 0) {
					message.reply(`No skins found matching "${searchTerm}".`);
					return;
				} else if (filteredData.length <= 10) {
					const skinList = filteredData
						.map((skin) => {
							const byVersion = csSkinsPrices[skin.market_hash_name];
							if (!byVersion) return `${skin.market_hash_name} - N/A`;
							const lines = Object.entries(byVersion).map(([versionKey, p]) => {
								const label = versionKey ? ` [${versionKey}]` : "";
								return `${skin.market_hash_name}${label} - Sug ${p.suggested_price} | Min ${p.min_price} | Max ${p.max_price} | Avg ${p.mean_price} | Med ${p.median_price}`;
							});
							return lines.join("\n");
						})
						.join("\n");
					message.reply(`Skins matching "${searchTerm}":\n${skinList}`);
				} else {
					message.reply(`Found ${filteredData.length} skins matching "${searchTerm}".`);
				}
			} catch (e) {
				console.log(e);
				message.reply(`Error searching CS:GO skins: ${e.message}`);
			}
			break;
		case `${prefix}:cs-cases`: {
			try {
				const cases = getAllCases();
				if (cases.length === 0) {
					message.reply("No cases registered. Has skin data been fetched yet?");
					return;
				}
				const lines = cases.map(
					(c) =>
						`${c.name.padEnd(16)} (${c.id.padEnd(14)}) — ${String(c.price).padStart(4)} FC, ` +
						`EV ${c.ev.toFixed(0).padStart(4)} FC (${((c.ev / c.price) * 100).toFixed(1)}%), ` +
						`overflow ${Math.round(c.overflow * 100)}%`,
				);
				message.reply(`**${cases.length} curated cases:**\n\`\`\`\n${lines.join("\n")}\n\`\`\``);
			} catch (e) {
				console.log(e);
				message.reply(`Error listing cases: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-case`: {
			try {
				const query = args.join(" ").trim();
				if (!query) {
					message.reply("Usage: `cs-case <case name or id>`");
					return;
				}
				const matched = getCaseById(query) || findCaseByName(query);
				if (!matched) {
					message.reply(`No case found matching "${query}".`);
					return;
				}
				const contents = getCaseContents(matched.id);

				const sections = Object.entries(contents.skinsByRarity)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(
						([rarity, { bands, skins }]) =>
							`=== ${rarity} [bands ${bands.join(",")}] (${skins.length}) ===\n${[...skins].sort().join("\n")}`,
					);
				const totalSkins = Object.values(contents.skinsByRarity).reduce((s, v) => s + v.skins.length, 0);
				const header = [
					`Case: ${contents.name}`,
					`ID: ${contents.id}`,
					`Price: ${contents.price} FC   EV: ${contents.ev.toFixed(1)} FC (${((contents.ev / contents.price) * 100).toFixed(1)}%)`,
					`Overflow: ${Math.round(contents.overflow * 100)}%   Skins: ${totalSkins}`,
				].join("\n");
				const body = `${header}\n\n${sections.join("\n\n")}`;

				const buffer = Buffer.from(body, "utf-8");
				const attachment = new AttachmentBuilder(buffer, { name: `${contents.id}.txt` });
				message.reply({
					content: `**${contents.name}** — ${totalSkins} skins, EV ${contents.ev.toFixed(0)}/${contents.price} FC`,
					files: [attachment],
				});
			} catch (e) {
				console.log(e);
				message.reply(`Error reading case: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-orphans`: {
			try {
				const orphans = findOrphanSkins();
				if (orphans.length === 0) {
					message.reply("No orphan skins — every skin belongs to at least one case.");
					return;
				}
				const byRarity = {};
				for (const o of orphans) {
					byRarity[o.rarity] = (byRarity[o.rarity] || 0) + 1;
				}
				const summary = Object.entries(byRarity)
					.sort(([, a], [, b]) => b - a)
					.map(([r, n]) => `${r}: ${n}`)
					.join("\n");
				const list = orphans.map((o) => `[${o.rarity}] ${o.name}`).join("\n");
				const buffer = Buffer.from(list, "utf-8");
				const attachment = new AttachmentBuilder(buffer, { name: "cs-orphans.txt" });
				message.reply({
					content: `**${orphans.length} skins not in any case.**\n\`\`\`${summary}\`\`\``,
					files: [attachment],
				});
			} catch (e) {
				console.log(e);
				message.reply(`Error finding orphans: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-simulate`: {
			try {
				if (args.length === 0) {
					message.reply("Usage: `cs-simulate <case name or id> [count=1000]`");
					return;
				}
				const lastArg = args[args.length - 1];
				const parsedCount = parseInt(lastArg, 10);
				const hasCount = !isNaN(parsedCount) && String(parsedCount) === lastArg;
				const count = hasCount ? Math.min(Math.max(parsedCount, 1), 100000) : 1000;
				const queryParts = hasCount ? args.slice(0, -1) : args;
				const query = queryParts.join(" ").trim();

				const matched = getCaseById(query) || findCaseByName(query);
				if (!matched) {
					message.reply(`No case found matching "${query}".`);
					return;
				}

				const prices = [];
				const rarityCounts = {};
				let stattrakCount = 0;
				let souvenirCount = 0;
				let overflowCount = 0;
				let best = null;

				for (let i = 0; i < count; i++) {
					const skin = await openCase(matched.id);
					if (!skin) continue;
					const price = parseInt(skin.price, 10) || 0;
					prices.push(price);
					rarityCounts[skin.rarity] = (rarityCounts[skin.rarity] || 0) + 1;
					if (skin.isStattrak) stattrakCount++;
					if (skin.isSouvenir) souvenirCount++;
					if (skin.fromOverflow) overflowCount++;
					if (!best || price > best.price) {
						best = {
							name: skin.name,
							price,
							rarity: skin.rarity,
							wearState: skin.wearState,
							isStattrak: skin.isStattrak,
							isSouvenir: skin.isSouvenir,
						};
					}
				}

				if (prices.length === 0) {
					message.reply("Simulation produced no skins (empty crate?).");
					return;
				}

				const sorted = [...prices].sort((a, b) => a - b);
				const sum = prices.reduce((a, b) => a + b, 0);
				const avg = sum / prices.length;
				const median =
					sorted.length % 2 === 0
						? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
						: sorted[Math.floor(sorted.length / 2)];
				const min = sorted[0];
				const max = sorted[sorted.length - 1];
				const casePrice = matched.price;
				const profit = avg - casePrice;

				const rarityBreakdown = Object.entries(rarityCounts)
					.sort(([, a], [, b]) => b - a)
					.map(([r, n]) => `${r}: ${n} (${((n / prices.length) * 100).toFixed(2)}%)`)
					.join("\n");

				const bestLine = best
					? `${best.isStattrak ? "StatTrak™ " : ""}${best.isSouvenir ? "Souvenir " : ""}${best.name} (${best.wearState}) — ${best.price} FC`
					: "n/a";

				const report = [
					`**Simulation: ${matched.name}** (${prices.length} opens)`,
					"```",
					`Case cost:   ${casePrice} FC`,
					`Analytic EV: ${matched.ev.toFixed(1)} FC (${((matched.ev / casePrice) * 100).toFixed(1)}% of price)`,
					"",
					`Average:  ${avg.toFixed(1)} FC  →  ${profit >= 0 ? "+" : ""}${profit.toFixed(1)} FC/open`,
					`Median:   ${median} FC`,
					`Min:      ${min} FC`,
					`Max:      ${max} FC`,
					`StatTrak: ${stattrakCount} (${((stattrakCount / prices.length) * 100).toFixed(2)}%)`,
					`Souvenir: ${souvenirCount} (${((souvenirCount / prices.length) * 100).toFixed(2)}%)`,
					`Overflow hits: ${overflowCount} (${((overflowCount / prices.length) * 100).toFixed(3)}%)`,
					"",
					"Rarity distribution:",
					rarityBreakdown,
					"",
					`Best drop: ${bestLine}`,
					"```",
				].join("\n");

				message.reply(report);
			} catch (e) {
				console.log(e);
				message.reply(`Error simulating case: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-cases`: {
			try {
				const cases = getAllCases();
				if (cases.length === 0) {
					message.reply("No cases registered. Has skin data been fetched yet?");
					return;
				}
				const lines = cases.map(
					(c) =>
						`${c.name.padEnd(16)} (${c.id.padEnd(14)}) — ${String(c.price).padStart(4)} FC, ` +
						`EV ${c.ev.toFixed(0).padStart(4)} FC (${((c.ev / c.price) * 100).toFixed(1)}%), ` +
						`overflow ${Math.round(c.overflow * 100)}%`,
				);
				message.reply(`**${cases.length} curated cases:**\n\`\`\`\n${lines.join("\n")}\n\`\`\``);
			} catch (e) {
				console.log(e);
				message.reply(`Error listing cases: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-case`: {
			try {
				const query = args.join(" ").trim();
				if (!query) {
					message.reply("Usage: `cs-case <case name or id>`");
					return;
				}
				const matched = getCaseById(query) || findCaseByName(query);
				if (!matched) {
					message.reply(`No case found matching "${query}".`);
					return;
				}
				const contents = getCaseContents(matched.id);

				const sections = Object.entries(contents.skinsByRarity)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(
						([rarity, { band, skins }]) =>
							`=== ${rarity} [${band}] (${skins.length}) ===\n${[...skins].sort().join("\n")}`,
					);
				const totalSkins = Object.values(contents.skinsByRarity).reduce((s, v) => s + v.skins.length, 0);
				const header = [
					`Case: ${contents.name}`,
					`ID: ${contents.id}`,
					`Price: ${contents.price} FC   EV: ${contents.ev.toFixed(1)} FC (${((contents.ev / contents.price) * 100).toFixed(1)}%)`,
					`Overflow: ${Math.round(contents.overflow * 100)}%   Skins: ${totalSkins}`,
				].join("\n");
				const body = `${header}\n\n${sections.join("\n\n")}`;

				const buffer = Buffer.from(body, "utf-8");
				const attachment = new AttachmentBuilder(buffer, { name: `${contents.id}.txt` });
				message.reply({
					content: `**${contents.name}** — ${totalSkins} skins, EV ${contents.ev.toFixed(0)}/${contents.price} FC`,
					files: [attachment],
				});
			} catch (e) {
				console.log(e);
				message.reply(`Error reading case: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-orphans`: {
			try {
				const orphans = findOrphanSkins();
				if (orphans.length === 0) {
					message.reply("No orphan skins — every skin belongs to at least one case.");
					return;
				}
				const byRarity = {};
				for (const o of orphans) {
					byRarity[o.rarity] = (byRarity[o.rarity] || 0) + 1;
				}
				const summary = Object.entries(byRarity)
					.sort(([, a], [, b]) => b - a)
					.map(([r, n]) => `${r}: ${n}`)
					.join("\n");
				const list = orphans.map((o) => `[${o.rarity}] ${o.name}`).join("\n");
				const buffer = Buffer.from(list, "utf-8");
				const attachment = new AttachmentBuilder(buffer, { name: "cs-orphans.txt" });
				message.reply({
					content: `**${orphans.length} skins not in any case.**\n\`\`\`${summary}\`\`\``,
					files: [attachment],
				});
			} catch (e) {
				console.log(e);
				message.reply(`Error finding orphans: ${e.message}`);
			}
			break;
		}
		case `${prefix}:cs-simulate`: {
			try {
				if (args.length === 0) {
					message.reply("Usage: `cs-simulate <case name or id> [count=1000]`");
					return;
				}
				const lastArg = args[args.length - 1];
				const parsedCount = parseInt(lastArg, 10);
				const hasCount = !isNaN(parsedCount) && String(parsedCount) === lastArg;
				const count = hasCount ? Math.min(Math.max(parsedCount, 1), 100000) : 1000;
				const queryParts = hasCount ? args.slice(0, -1) : args;
				const query = queryParts.join(" ").trim();

				const matched = getCaseById(query) || findCaseByName(query);
				if (!matched) {
					message.reply(`No case found matching "${query}".`);
					return;
				}

				const prices = [];
				const rarityCounts = {};
				let stattrakCount = 0;
				let souvenirCount = 0;
				let overflowCount = 0;
				let best = null;

				for (let i = 0; i < count; i++) {
					const skin = await openCase(matched.id);
					if (!skin) continue;
					const price = parseInt(skin.price, 10) || 0;
					prices.push(price);
					rarityCounts[skin.rarity] = (rarityCounts[skin.rarity] || 0) + 1;
					if (skin.isStattrak) stattrakCount++;
					if (skin.isSouvenir) souvenirCount++;
					if (skin.fromOverflow) overflowCount++;
					if (!best || price > best.price) {
						best = {
							name: skin.name,
							price,
							rarity: skin.rarity,
							wearState: skin.wearState,
							isStattrak: skin.isStattrak,
							isSouvenir: skin.isSouvenir,
						};
					}
				}

				if (prices.length === 0) {
					message.reply("Simulation produced no skins (empty crate?).");
					return;
				}

				const sorted = [...prices].sort((a, b) => a - b);
				const sum = prices.reduce((a, b) => a + b, 0);
				const avg = sum / prices.length;
				const median =
					sorted.length % 2 === 0
						? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
						: sorted[Math.floor(sorted.length / 2)];
				const min = sorted[0];
				const max = sorted[sorted.length - 1];
				const casePrice = matched.price;
				const profit = avg - casePrice;

				const rarityBreakdown = Object.entries(rarityCounts)
					.sort(([, a], [, b]) => b - a)
					.map(([r, n]) => `${r}: ${n} (${((n / prices.length) * 100).toFixed(2)}%)`)
					.join("\n");

				const bestLine = best
					? `${best.isStattrak ? "StatTrak™ " : ""}${best.isSouvenir ? "Souvenir " : ""}${best.name} (${best.wearState}) — ${best.price} FC`
					: "n/a";

				const report = [
					`**Simulation: ${matched.name}** (${prices.length} opens)`,
					"```",
					`Case cost:   ${casePrice} FC`,
					`Analytic EV: ${matched.ev.toFixed(1)} FC (${((matched.ev / casePrice) * 100).toFixed(1)}% of price)`,
					"",
					`Average:  ${avg.toFixed(1)} FC  →  ${profit >= 0 ? "+" : ""}${profit.toFixed(1)} FC/open`,
					`Median:   ${median} FC`,
					`Min:      ${min} FC`,
					`Max:      ${max} FC`,
					`StatTrak: ${stattrakCount} (${((stattrakCount / prices.length) * 100).toFixed(2)}%)`,
					`Souvenir: ${souvenirCount} (${((souvenirCount / prices.length) * 100).toFixed(2)}%)`,
					`Overflow hits: ${overflowCount} (${((overflowCount / prices.length) * 100).toFixed(3)}%)`,
					"",
					"Rarity distribution:",
					rarityBreakdown,
					"",
					`Best drop: ${bestLine}`,
					"```",
				].join("\n");

				message.reply(report);
			} catch (e) {
				console.log(e);
				message.reply(`Error simulating case: ${e.message}`);
			}
			break;
		}
		case `${prefix}:maintenance`:
			handleMaintenanceCommand(message, args);
			break;
	}
}

function parseDuration(str) {
	const match = str.match(/^(\d+)(s|m|h|d)$/);
	if (!match) return null;
	const value = parseInt(match[1]);
	const unit = match[2];
	const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
	return value * multipliers[unit];
}

function formatDuration(ms) {
	if (ms >= 86400000) return `${Math.round(ms / 86400000)}d`;
	if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
	if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
	return `${Math.round(ms / 1000)}s`;
}

function handleMaintenanceCommand(message, args) {
	// Status check
	if (args[0] === "status") {
		if (maintenance.active) {
			const endInfo = maintenance.scheduledEnd
				? `\nFin prévue: <t:${Math.floor(maintenance.scheduledEnd / 1000)}:R>`
				: "\nFin: manuelle";
			message.reply(`🔧 Maintenance **active**.${endInfo}`);
		} else if (maintenance.startTimer) {
			const startInfo = `\nDébut prévu: <t:${Math.floor(maintenance.scheduledStart / 1000)}:R>`;
			const endInfo = maintenance.scheduledEnd
				? `\nFin prévue: <t:${Math.floor(maintenance.scheduledEnd / 1000)}:R>`
				: "\nFin: manuelle";
			message.reply(`⏳ Maintenance **programmée**.${startInfo}${endInfo}`);
		} else {
			message.reply("✅ Pas de maintenance en cours.");
		}
		return;
	}

	// Explicit off
	if (args[0] === "off") {
		deactivateMaintenance();
		message.reply("✅ Maintenance désactivée.");
		return;
	}

	// No args: toggle
	if (args.length === 0) {
		if (maintenance.active || maintenance.startTimer) {
			deactivateMaintenance();
			message.reply("✅ Maintenance désactivée.");
		} else {
			activateMaintenance(null);
			message.reply("🔧 Maintenance activée. API et sockets bloqués.\nUtilise `maintenance off` pour désactiver.");
		}
		return;
	}

	// 1 arg: scheduled start, manual end
	if (args.length === 1) {
		const startDelay = parseDuration(args[0]);
		if (!startDelay) {
			message.reply("Format invalide. Utilise: `30s`, `5m`, `2h`, `1d`");
			return;
		}
		const startAt = Date.now() + startDelay;
		maintenance.scheduledStart = startAt;
		maintenance.startTimer = setTimeout(() => {
			activateMaintenance(null);
		}, startDelay);
		startMaintenanceNotifications();
		message.reply(
			`⏳ Maintenance programmée dans **${formatDuration(startDelay)}** (<t:${Math.floor(startAt / 1000)}:R>).\nFin: manuelle.`,
		);
		return;
	}

	// 2 args: scheduled start + scheduled end (duration after start)
	if (args.length >= 2) {
		const startDelay = parseDuration(args[0]);
		const endDuration = parseDuration(args[1]);
		if (!startDelay || !endDuration) {
			message.reply("Format invalide. Utilise: `30s`, `5m`, `2h`, `1d`");
			return;
		}
		const startAt = Date.now() + startDelay;
		const endAt = startAt + endDuration;
		maintenance.scheduledStart = startAt;
		maintenance.scheduledEnd = endAt;
		maintenance.startTimer = setTimeout(() => {
			activateMaintenance(endAt);
			maintenance.endTimer = setTimeout(() => {
				deactivateMaintenance();
			}, endDuration);
		}, startDelay);
		startMaintenanceNotifications();
		message.reply(
			`⏳ Maintenance programmée:\n- Début: dans **${formatDuration(startDelay)}** (<t:${Math.floor(startAt / 1000)}:R>)\n- Fin: après **${formatDuration(endDuration)}** (<t:${Math.floor(endAt / 1000)}:R>)`,
		);
		return;
	}
}
