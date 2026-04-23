import prisma from "../prisma/client.js";

export async function insertSnapshots(items) {
	const rows = items
		.filter((s) => s.market_hash_name)
		.map((s) => ({
			marketHashName: s.market_hash_name,
			version: s.version || null,
			suggestedPrice: s.suggested_price,
			minPrice: s.min_price,
			maxPrice: s.max_price,
			meanPrice: s.mean_price,
			medianPrice: s.median_price,
		}));
	if (rows.length === 0) return 0;
	const result = await prisma.csPriceSnapshot.createMany({ data: rows });
	return result.count;
}

// Returns a nested map: marketHashName → { [version || ""]: priceData }.
// Grouping on (market_hash_name, version) preserves phased/gem variants that share a hash.
// Uses SQLite's NULL-safe `IS` operator so the (market_hash_name, version, created_at) index
// can be used directly — COALESCE(version, '') would wrap the column and defeat the index,
// causing the query to hang on large snapshot tables.
export async function getLatestSnapshotsMap() {
	let rows;
	try {
		rows = await prisma.$queryRaw`
			SELECT s.market_hash_name, s.version, s.suggested_price, s.min_price,
			       s.max_price, s.mean_price, s.median_price
			FROM cs_price_snapshots s
			INNER JOIN (
				SELECT market_hash_name, version, MAX(created_at) AS max_created
				FROM cs_price_snapshots
				GROUP BY market_hash_name, version
			) latest
				ON s.market_hash_name = latest.market_hash_name
				AND s.version IS latest.version
				AND s.created_at = latest.max_created
		`;
	} catch (e) {
		console.error("Error fetching latest snapshots from DB:", e);
		return {};
	}
	console.log(rows.length, "latest snapshots loaded from DB");
	const map = {};
	for (const r of rows) {
		if (!map[r.market_hash_name]) map[r.market_hash_name] = {};
		map[r.market_hash_name][r.version || ""] = {
			suggested_price: r.suggested_price,
			min_price: r.min_price,
			max_price: r.max_price,
			mean_price: r.mean_price,
			median_price: r.median_price,
		};
	}
	return map;
}

export async function pruneOldSnapshots(days = 30) {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const result = await prisma.csPriceSnapshot.deleteMany({
		where: { createdAt: { lt: cutoff } },
	});
	return result.count;
}
