/*
  Warnings:

  - Added the required column `slots` to the `mots_fleches_otd` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mots_fleches_otd" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "cols" INTEGER NOT NULL,
    "grid" TEXT NOT NULL,
    "slots" TEXT NOT NULL,
    "def_cells" TEXT NOT NULL,
    "definitions" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "seed_string" TEXT,
    "generation_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_mots_fleches_otd" ("cols", "created_at", "date", "def_cells", "definitions", "generation_ms", "grid", "id", "rows", "seed_string", "word_count") SELECT "cols", "created_at", "date", "def_cells", "definitions", "generation_ms", "grid", "id", "rows", "seed_string", "word_count" FROM "mots_fleches_otd";
DROP TABLE "mots_fleches_otd";
ALTER TABLE "new_mots_fleches_otd" RENAME TO "mots_fleches_otd";
CREATE UNIQUE INDEX "mots_fleches_otd_date_key" ON "mots_fleches_otd"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
