-- AlterTable
ALTER TABLE "cs_price_snapshots" ADD COLUMN "version" TEXT;

-- DropIndex
DROP INDEX IF EXISTS "cs_price_snapshots_market_hash_name_created_at_idx";

-- CreateIndex
CREATE INDEX "cs_price_snapshots_market_hash_name_version_created_at_idx"
  ON "cs_price_snapshots"("market_hash_name", "version", "created_at");
