-- CreateTable
CREATE TABLE "cs_price_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "market_hash_name" TEXT NOT NULL,
    "suggested_price" REAL,
    "min_price" REAL,
    "max_price" REAL,
    "mean_price" REAL,
    "median_price" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "cs_price_snapshots_market_hash_name_created_at_idx" ON "cs_price_snapshots"("market_hash_name", "created_at");

-- CreateIndex
CREATE INDEX "cs_price_snapshots_created_at_idx" ON "cs_price_snapshots"("created_at");
