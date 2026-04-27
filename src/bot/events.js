import { handleMessageCreate } from "./handlers/messageCreate.js";
import { getAkhys, refreshLoadoutSkinPrices, migrateLegacyLoadouts, backfillCsSkinVersions } from "../utils/index.js";
import { fetchSuggestedPrices, fetchSkinsData } from "../api/cs.js";
import { buildPriceIndex, buildVersionMap, buildWeaponRarityPriceMap, csSkinsPrices } from "../utils/cs.state.js";
import * as csPriceService from "../services/csPrice.service.js";
import { buildCaseRegistry } from "../utils/cs.cases.js";

/**
 * Initializes and attaches all necessary event listeners to the Discord client.
 * This function should be called once the client is ready.
 *
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance for real-time communication.
 */
export function initializeEvents(client, io) {
	// --- on 'clientReady' ---
	// This event fires once the bot has successfully logged in and is ready to operate.
	// It's a good place for setup tasks that require the bot to be online.
	client.once("clientReady", async () => {
		console.log(`Bot is ready and logged in as ${client.user.tag}!`);
		console.log("[Startup] Bot is ready, performing initial data sync...");
		await getAkhys(client);
		console.log("[Startup] Setting up scheduled tasks...");
		//setupCronJobs(client, io);
		const cached = await csPriceService.getLatestSnapshotsMap();
		Object.assign(csSkinsPrices, cached);
		console.log(`[Startup] Preloaded ${Object.keys(cached).length} Skinport prices from DB.`);
		const items = await fetchSuggestedPrices();
		if (items) {
			const inserted = await csPriceService.insertSnapshots(items);
			console.log(`[Startup] Inserted ${inserted} Skinport snapshots from live fetch.`);
		}
		await fetchSkinsData();
		buildPriceIndex();
		buildWeaponRarityPriceMap();
		buildVersionMap();
		try {
			await migrateLegacyLoadouts();
		} catch (e) {
			console.error("[Startup] Error migrating legacy loadouts:", e);
		}
		try {
			await backfillCsSkinVersions();
		} catch (e) {
			console.error("[Startup] Error backfilling CsSkin versions:", e);
		}
		try {
			const { updatedCount, total, historyCount } = await refreshLoadoutSkinPrices();
			console.log(
				`[Startup] Loadout refresh: ${updatedCount}/${total} prices changed, ${historyCount} history entries.`,
			);
		} catch (e) {
			console.error("[Startup] Error refreshing loadout skin prices:", e);
		}
		buildCaseRegistry();
		console.log("--- FlopoBOT is fully operational ---");
	});

	// --- on 'messageCreate' ---
	// This event fires every time a message is sent in a channel the bot can see.
	// The logic is delegated to its own dedicated handler for cleanliness.
	client.on("messageCreate", async (message) => {
		// We pass the client and io instances to the handler so it has access to them
		// without needing to import them, preventing potential circular dependencies.
		await handleMessageCreate(message, client, io);
	});
}
