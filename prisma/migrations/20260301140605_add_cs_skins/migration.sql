-- CreateTable
CREATE TABLE "cs_skins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "market_hash_name" TEXT NOT NULL,
    "displayName" TEXT,
    "image_url" TEXT,
    "rarity" TEXT,
    "rarity_color" TEXT,
    "weapon_type" TEXT,
    "float" REAL,
    "wear_state" TEXT,
    "is_stattrak" BOOLEAN NOT NULL DEFAULT false,
    "is_souvenir" BOOLEAN NOT NULL DEFAULT false,
    "price" INTEGER,
    "user_id" TEXT,
    CONSTRAINT "cs_skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_market_offers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skin_uuid" TEXT,
    "cs_skin_id" TEXT,
    "seller_id" TEXT NOT NULL,
    "starting_price" INTEGER NOT NULL,
    "buyout_price" INTEGER,
    "final_price" INTEGER,
    "status" TEXT NOT NULL,
    "posted_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "opening_at" DATETIME NOT NULL,
    "closing_at" DATETIME NOT NULL,
    "buyer_id" TEXT,
    CONSTRAINT "market_offers_skin_uuid_fkey" FOREIGN KEY ("skin_uuid") REFERENCES "skins" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "market_offers_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "market_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_market_offers" ("buyer_id", "buyout_price", "closing_at", "final_price", "id", "opening_at", "posted_at", "seller_id", "skin_uuid", "starting_price", "status") SELECT "buyer_id", "buyout_price", "closing_at", "final_price", "id", "opening_at", "posted_at", "seller_id", "skin_uuid", "starting_price", "status" FROM "market_offers";
DROP TABLE "market_offers";
ALTER TABLE "new_market_offers" RENAME TO "market_offers";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
