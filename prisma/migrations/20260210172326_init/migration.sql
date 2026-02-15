-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "warned" INTEGER NOT NULL DEFAULT 0,
    "warns" INTEGER NOT NULL DEFAULT 0,
    "allTimeWarns" INTEGER NOT NULL DEFAULT 0,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "dailyQueried" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    "isAkhy" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "skins" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "contentTierUuid" TEXT,
    "displayIcon" TEXT,
    "user_id" TEXT,
    "tierRank" TEXT,
    "tierColor" TEXT,
    "tierText" TEXT,
    "basePrice" TEXT,
    "currentLvl" INTEGER,
    "currentChroma" INTEGER,
    "currentPrice" INTEGER,
    "maxPrice" INTEGER,
    CONSTRAINT "skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "market_offers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skin_uuid" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "starting_price" INTEGER NOT NULL,
    "buyout_price" INTEGER,
    "final_price" INTEGER,
    "status" TEXT NOT NULL,
    "posted_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "opening_at" DATETIME NOT NULL,
    "closing_at" DATETIME NOT NULL,
    "buyer_id" TEXT,
    CONSTRAINT "market_offers_skin_uuid_fkey" FOREIGN KEY ("skin_uuid") REFERENCES "skins" ("uuid") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidder_id" TEXT NOT NULL,
    "market_offer_id" TEXT NOT NULL,
    "offer_amount" INTEGER NOT NULL,
    "offered_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bids_market_offer_id_fkey" FOREIGN KEY ("market_offer_id") REFERENCES "market_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "action" TEXT,
    "target_user_id" TEXT,
    "coins_amount" INTEGER,
    "user_new_amount" INTEGER,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "p1" TEXT NOT NULL,
    "p2" TEXT,
    "p1_score" INTEGER,
    "p2_score" INTEGER,
    "p1_elo" INTEGER,
    "p2_elo" INTEGER,
    "p1_new_elo" INTEGER,
    "p2_new_elo" INTEGER,
    "type" TEXT,
    "timestamp" DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "games_p1_fkey" FOREIGN KEY ("p1") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "games_p2_fkey" FOREIGN KEY ("p2") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "elos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "elo" INTEGER NOT NULL,
    CONSTRAINT "elos_id_fkey" FOREIGN KEY ("id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sotd" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableauPiles" TEXT,
    "foundationPiles" TEXT,
    "stockPile" TEXT,
    "wastePile" TEXT,
    "isDone" INTEGER NOT NULL DEFAULT 0,
    "seed" TEXT
);

-- CreateTable
CREATE TABLE "sotd_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "time" INTEGER,
    "moves" INTEGER,
    "score" INTEGER,
    CONSTRAINT "sotd_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "coins_amount" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "customer_email" TEXT,
    "customer_name" TEXT,
    "payment_status" TEXT NOT NULL,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_session_id_key" ON "transactions"("session_id");
