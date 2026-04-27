/*
  Warnings:

  - A unique constraint covering the columns `[user_id,loadout_slot]` on the table `cs_skins` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "cs_skins" ADD COLUMN "loadout_price_updated_at" DATETIME;
ALTER TABLE "cs_skins" ADD COLUMN "loadout_slot" TEXT;

-- CreateTable
CREATE TABLE "user_featured_skins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "cs_skin_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "user_featured_skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_featured_skins_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_featured_skins_cs_skin_id_key" ON "user_featured_skins"("cs_skin_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_featured_skins_user_id_position_key" ON "user_featured_skins"("user_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "cs_skins_user_id_loadout_slot_key" ON "cs_skins"("user_id", "loadout_slot");
