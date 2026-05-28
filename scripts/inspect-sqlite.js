import Database from "better-sqlite3";

const db = new Database("flopobot.db", { readonly: true });

const tables = db
	.prepare(
		`SELECT name FROM sqlite_master
		 WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'
		 ORDER BY name`,
	)
	.all();

for (const t of tables) {
	const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
	const count = db.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get().c;
	console.log(`\n=== ${t.name} (rows=${count}) ===`);
	for (const c of cols) {
		console.log(`  ${c.name}: ${c.type}${c.notnull ? " NOT NULL" : ""}`);
	}
}

db.close();
