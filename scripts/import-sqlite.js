import "dotenv/config";
import Database from "better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

const SQLITE_PATH = "/db/flopobot.db";
const CHUNK = 1000;

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const toBool = (v) => (v === null || v === undefined ? null : !!v);
const toDate = (v) => (v === null || v === undefined ? null : new Date(v));

// Each entry: { table: SQLite table, model: Prisma delegate name, map: row transformer }
// The map function takes a SQLite row and returns a Prisma-shaped object.
const TABLES = [
	{
		table: "users",
		model: "user",
		map: (r) => ({
			id: r.id,
			username: r.username,
			globalName: r.globalName,
			warned: r.warned,
			warns: r.warns,
			allTimeWarns: r.allTimeWarns,
			totalRequests: r.totalRequests,
			coins: r.coins,
			dailyQueried: r.dailyQueried,
			avatarUrl: r.avatarUrl,
			isAkhy: r.isAkhy,
		}),
	},
	{
		table: "elos",
		model: "elo",
		map: (r) => ({
			id: r.id,
			elo: r.elo,
			rd: r.rd,
			volatility: r.volatility,
			gamesPlayed: r.games_played,
		}),
	},
	{
		table: "skins",
		model: "skin",
		map: (r) => ({
			uuid: r.uuid,
			displayName: r.displayName,
			contentTierUuid: r.contentTierUuid,
			displayIcon: r.displayIcon,
			userId: r.user_id,
			tierRank: r.tierRank,
			tierColor: r.tierColor,
			tierText: r.tierText,
			basePrice: r.basePrice,
			currentLvl: r.currentLvl,
			currentChroma: r.currentChroma,
			currentPrice: r.currentPrice,
			maxPrice: r.maxPrice,
		}),
	},
	{
		table: "cs_skins",
		model: "csSkin",
		map: (r) => ({
			id: r.id,
			marketHashName: r.market_hash_name,
			displayName: r.displayName,
			imageUrl: r.image_url,
			rarity: r.rarity,
			rarityColor: r.rarity_color,
			weaponType: r.weapon_type,
			float: r.float,
			wearState: r.wear_state,
			isStattrak: toBool(r.is_stattrak),
			isSouvenir: toBool(r.is_souvenir),
			price: r.price,
			userId: r.user_id,
			loadoutSlot: r.loadout_slot,
			loadoutPriceUpdatedAt: toDate(r.loadout_price_updated_at),
			loadoutEquippedAt: toDate(r.loadout_equipped_at),
			loadoutEquippedPrice: r.loadout_equipped_price,
			version: r.version,
		}),
	},
	{
		table: "cs_skin_price_history",
		model: "csSkinPriceHistory",
		map: (r) => ({
			id: r.id,
			csSkinId: r.cs_skin_id,
			price: r.price,
			createdAt: toDate(r.created_at),
		}),
	},
	{
		table: "market_offers",
		model: "marketOffer",
		map: (r) => ({
			id: r.id,
			skinUuid: r.skin_uuid,
			csSkinId: r.cs_skin_id,
			sellerId: r.seller_id,
			startingPrice: r.starting_price,
			buyoutPrice: r.buyout_price,
			finalPrice: r.final_price,
			status: r.status,
			postedAt: toDate(r.posted_at),
			openingAt: toDate(r.opening_at),
			closingAt: toDate(r.closing_at),
			buyerId: r.buyer_id,
		}),
	},
	{
		table: "bids",
		model: "bid",
		map: (r) => ({
			id: r.id,
			bidderId: r.bidder_id,
			marketOfferId: r.market_offer_id,
			offerAmount: r.offer_amount,
			offeredAt: toDate(r.offered_at),
		}),
	},
	{
		table: "logs",
		model: "log",
		map: (r) => ({
			id: r.id,
			userId: r.user_id,
			action: r.action,
			targetUserId: r.target_user_id,
			coinsAmount: r.coins_amount,
			userNewAmount: r.user_new_amount,
			createdAt: toDate(r.created_at),
		}),
	},
	{
		table: "games",
		model: "game",
		map: (r) => ({
			id: r.id,
			p1: r.p1,
			p2: r.p2,
			p1Score: r.p1_score,
			p2Score: r.p2_score,
			p1Elo: r.p1_elo,
			p2Elo: r.p2_elo,
			p1NewElo: r.p1_new_elo,
			p2NewElo: r.p2_new_elo,
			p1Rd: r.p1_rd,
			p2Rd: r.p2_rd,
			p1NewRd: r.p1_new_rd,
			p2NewRd: r.p2_new_rd,
			type: r.type,
			timestamp: toDate(r.timestamp),
		}),
	},
	{
		table: "sotd",
		model: "sotd",
		map: (r) => ({
			id: r.id,
			tableauPiles: r.tableauPiles,
			foundationPiles: r.foundationPiles,
			stockPile: r.stockPile,
			wastePile: r.wastePile,
			isDone: r.isDone,
			seed: r.seed,
		}),
	},
	{
		table: "sotd_stats",
		model: "sotdStat",
		map: (r) => ({
			id: r.id,
			userId: r.user_id,
			time: r.time,
			moves: r.moves,
			score: r.score,
		}),
	},
	{
		table: "sudoku_otd",
		model: "sudokuOtd",
		map: (r) => ({
			id: r.id,
			puzzle: r.puzzle,
			solution: r.solution,
			difficulty: r.difficulty,
		}),
	},
	{
		table: "sudoku_stats",
		model: "sudokuStat",
		map: (r) => ({
			id: r.id,
			userId: r.user_id,
			time: r.time,
		}),
	},
	{
		table: "user_featured_skins",
		model: "userFeaturedSkin",
		map: (r) => ({
			id: r.id,
			userId: r.user_id,
			csSkinId: r.cs_skin_id,
			position: r.position,
		}),
	},
	{
		table: "transactions",
		model: "transaction",
		map: (r) => ({
			id: r.id,
			sessionId: r.session_id,
			userId: r.user_id,
			coinsAmount: r.coins_amount,
			amountCents: r.amount_cents,
			currency: r.currency,
			customerEmail: r.customer_email,
			customerName: r.customer_name,
			paymentStatus: r.payment_status,
			createdAt: toDate(r.created_at),
		}),
	},
	{
		table: "cs_price_snapshots",
		model: "csPriceSnapshot",
		map: (r) => ({
			id: r.id,
			marketHashName: r.market_hash_name,
			version: r.version,
			suggestedPrice: r.suggested_price,
			minPrice: r.min_price,
			maxPrice: r.max_price,
			meanPrice: r.mean_price,
			medianPrice: r.median_price,
			createdAt: toDate(r.created_at),
		}),
	},
];

async function importTable({ table, model, map }) {
	const total = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
	if (total === 0) {
		console.log(`  ${table}: 0 rows, skipping`);
		return 0;
	}
	const stmt = sqlite.prepare(`SELECT * FROM ${table}`);
	let buffer = [];
	let written = 0;
	for (const row of stmt.iterate()) {
		buffer.push(map(row));
		if (buffer.length >= CHUNK) {
			const res = await prisma[model].createMany({ data: buffer, skipDuplicates: true });
			written += res.count;
			buffer = [];
			process.stdout.write(`  ${table}: ${written}/${total}\r`);
		}
	}
	if (buffer.length > 0) {
		const res = await prisma[model].createMany({ data: buffer, skipDuplicates: true });
		written += res.count;
	}
	console.log(`  ${table}: ${written}/${total} ✓                    `);
	return written;
}

// Tables with `@id @default(autoincrement())`. After importing rows that preserve
// their SQLite ids, the Postgres sequence still points at 1 — bump it past MAX(id)
// so the next INSERT (without an explicit id) doesn't collide.
const SEQUENCES = [
	{ table: "cs_price_snapshots", sequence: "cs_price_snapshots_id_seq" },
	{ table: "cs_skin_price_history", sequence: "cs_skin_price_history_id_seq" },
];

async function resyncSequences() {
	for (const { table, sequence } of SEQUENCES) {
		const rows = await prisma.$queryRawUnsafe(
			`SELECT setval('${sequence}', COALESCE((SELECT MAX(id) FROM ${table}), 1)) AS val`,
		);
		console.log(`  ${sequence} → ${rows[0].val}`);
	}
}

async function main() {
	console.log(`Importing from ${SQLITE_PATH} → ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
	const start = Date.now();
	for (const t of TABLES) {
		await importTable(t);
	}
	console.log("Resyncing autoincrement sequences:");
	await resyncSequences();
	console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		sqlite.close();
		await prisma.$disconnect();
	});
