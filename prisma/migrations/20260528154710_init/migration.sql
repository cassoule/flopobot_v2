-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "global_name" TEXT,
    "warned" INTEGER NOT NULL DEFAULT 0,
    "warns" INTEGER NOT NULL DEFAULT 0,
    "allTimeWarns" INTEGER NOT NULL DEFAULT 0,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "dailyQueried" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    "isAkhy" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skins" (
    "uuid" TEXT NOT NULL,
    "display_name" TEXT,
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

    CONSTRAINT "skins_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "cs_skins" (
    "id" TEXT NOT NULL,
    "market_hash_name" TEXT NOT NULL,
    "display_name" TEXT,
    "image_url" TEXT,
    "rarity" TEXT,
    "rarity_color" TEXT,
    "weapon_type" TEXT,
    "float" DOUBLE PRECISION,
    "wear_state" TEXT,
    "is_stattrak" BOOLEAN NOT NULL DEFAULT false,
    "is_souvenir" BOOLEAN NOT NULL DEFAULT false,
    "price" INTEGER,
    "user_id" TEXT,
    "loadout_slot" TEXT,
    "loadout_price_updated_at" TIMESTAMP(3),
    "loadout_equipped_at" TIMESTAMP(3),
    "loadout_equipped_price" INTEGER,
    "version" TEXT,

    CONSTRAINT "cs_skins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cs_skin_price_history" (
    "id" SERIAL NOT NULL,
    "cs_skin_id" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cs_skin_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_offers" (
    "id" TEXT NOT NULL,
    "skin_uuid" TEXT,
    "cs_skin_id" TEXT,
    "seller_id" TEXT NOT NULL,
    "starting_price" INTEGER NOT NULL,
    "buyout_price" INTEGER,
    "final_price" INTEGER,
    "status" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "opening_at" TIMESTAMP(3) NOT NULL,
    "closing_at" TIMESTAMP(3) NOT NULL,
    "buyer_id" TEXT,

    CONSTRAINT "market_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "bidder_id" TEXT NOT NULL,
    "market_offer_id" TEXT NOT NULL,
    "offer_amount" INTEGER NOT NULL,
    "offered_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT,
    "target_user_id" TEXT,
    "coins_amount" INTEGER,
    "user_new_amount" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "p1" TEXT NOT NULL,
    "p2" TEXT,
    "p1_score" INTEGER,
    "p2_score" INTEGER,
    "p1_elo" INTEGER,
    "p2_elo" INTEGER,
    "p1_new_elo" INTEGER,
    "p2_new_elo" INTEGER,
    "p1_rd" DOUBLE PRECISION,
    "p2_rd" DOUBLE PRECISION,
    "p1_new_rd" DOUBLE PRECISION,
    "p2_new_rd" DOUBLE PRECISION,
    "type" TEXT,
    "timestamp" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elos" (
    "id" TEXT NOT NULL,
    "elo" INTEGER NOT NULL,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350.0,
    "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "games_played" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "elos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sotd" (
    "id" INTEGER NOT NULL,
    "tableauPiles" TEXT,
    "foundationPiles" TEXT,
    "stockPile" TEXT,
    "wastePile" TEXT,
    "isDone" INTEGER NOT NULL DEFAULT 0,
    "seed" TEXT,

    CONSTRAINT "sotd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sotd_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "time" INTEGER,
    "moves" INTEGER,
    "score" INTEGER,

    CONSTRAINT "sotd_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sudoku_otd" (
    "id" INTEGER NOT NULL,
    "puzzle" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "difficulty" TEXT,

    CONSTRAINT "sudoku_otd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sudoku_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "time" INTEGER,

    CONSTRAINT "sudoku_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_featured_skins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cs_skin_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "user_featured_skins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cs_price_snapshots" (
    "id" SERIAL NOT NULL,
    "market_hash_name" TEXT NOT NULL,
    "version" TEXT,
    "suggested_price" DOUBLE PRECISION,
    "min_price" DOUBLE PRECISION,
    "max_price" DOUBLE PRECISION,
    "mean_price" DOUBLE PRECISION,
    "median_price" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cs_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "coins_amount" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "customer_email" TEXT,
    "customer_name" TEXT,
    "payment_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cs_skins_user_id_loadout_slot_key" ON "cs_skins"("user_id", "loadout_slot");

-- CreateIndex
CREATE INDEX "cs_skin_price_history_cs_skin_id_created_at_idx" ON "cs_skin_price_history"("cs_skin_id", "created_at");

-- CreateIndex
CREATE INDEX "cs_skin_price_history_created_at_idx" ON "cs_skin_price_history"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_featured_skins_cs_skin_id_key" ON "user_featured_skins"("cs_skin_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_featured_skins_user_id_position_key" ON "user_featured_skins"("user_id", "position");

-- CreateIndex
CREATE INDEX "cs_price_snapshots_market_hash_name_version_created_at_idx" ON "cs_price_snapshots"("market_hash_name", "version", "created_at");

-- CreateIndex
CREATE INDEX "cs_price_snapshots_created_at_idx" ON "cs_price_snapshots"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_session_id_key" ON "transactions"("session_id");

-- AddForeignKey
ALTER TABLE "skins" ADD CONSTRAINT "skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_skins" ADD CONSTRAINT "cs_skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_skin_price_history" ADD CONSTRAINT "cs_skin_price_history_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_skin_uuid_fkey" FOREIGN KEY ("skin_uuid") REFERENCES "skins"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_market_offer_id_fkey" FOREIGN KEY ("market_offer_id") REFERENCES "market_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_p1_fkey" FOREIGN KEY ("p1") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_p2_fkey" FOREIGN KEY ("p2") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elos" ADD CONSTRAINT "elos_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sotd_stats" ADD CONSTRAINT "sotd_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sudoku_stats" ADD CONSTRAINT "sudoku_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_featured_skins" ADD CONSTRAINT "user_featured_skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_featured_skins" ADD CONSTRAINT "user_featured_skins_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
