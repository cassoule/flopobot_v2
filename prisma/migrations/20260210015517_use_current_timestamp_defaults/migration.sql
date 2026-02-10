-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bids" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidder_id" TEXT NOT NULL,
    "market_offer_id" TEXT NOT NULL,
    "offer_amount" INTEGER NOT NULL,
    "offered_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bids_market_offer_id_fkey" FOREIGN KEY ("market_offer_id") REFERENCES "market_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_bids" ("bidder_id", "id", "market_offer_id", "offer_amount", "offered_at") SELECT "bidder_id", "id", "market_offer_id", "offer_amount", "offered_at" FROM "bids";
DROP TABLE "bids";
ALTER TABLE "new_bids" RENAME TO "bids";
CREATE TABLE "new_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "action" TEXT,
    "target_user_id" TEXT,
    "coins_amount" INTEGER,
    "user_new_amount" INTEGER,
    "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_logs" ("action", "coins_amount", "created_at", "id", "target_user_id", "user_id", "user_new_amount") SELECT "action", "coins_amount", "created_at", "id", "target_user_id", "user_id", "user_new_amount" FROM "logs";
DROP TABLE "logs";
ALTER TABLE "new_logs" RENAME TO "logs";
CREATE TABLE "new_market_offers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skin_uuid" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "starting_price" INTEGER NOT NULL,
    "buyout_price" INTEGER,
    "final_price" INTEGER,
    "status" TEXT NOT NULL,
    "posted_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    "opening_at" TEXT NOT NULL,
    "closing_at" TEXT NOT NULL,
    "buyer_id" TEXT,
    CONSTRAINT "market_offers_skin_uuid_fkey" FOREIGN KEY ("skin_uuid") REFERENCES "skins" ("uuid") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_market_offers" ("buyer_id", "buyout_price", "closing_at", "final_price", "id", "opening_at", "posted_at", "seller_id", "skin_uuid", "starting_price", "status") SELECT "buyer_id", "buyout_price", "closing_at", "final_price", "id", "opening_at", "posted_at", "seller_id", "skin_uuid", "starting_price", "status" FROM "market_offers";
DROP TABLE "market_offers";
ALTER TABLE "new_market_offers" RENAME TO "market_offers";
CREATE TABLE "new_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "coins_amount" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "customer_email" TEXT,
    "customer_name" TEXT,
    "payment_status" TEXT NOT NULL,
    "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("amount_cents", "coins_amount", "created_at", "currency", "customer_email", "customer_name", "id", "payment_status", "session_id", "user_id") SELECT "amount_cents", "coins_amount", "created_at", "currency", "customer_email", "customer_name", "id", "payment_status", "session_id", "user_id" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
CREATE UNIQUE INDEX "transactions_session_id_key" ON "transactions"("session_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
