-- AlterTable
ALTER TABLE "games" ADD COLUMN "p1_new_rd" REAL;
ALTER TABLE "games" ADD COLUMN "p1_rd" REAL;
ALTER TABLE "games" ADD COLUMN "p2_new_rd" REAL;
ALTER TABLE "games" ADD COLUMN "p2_rd" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_elos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "elo" INTEGER NOT NULL,
    "rd" REAL NOT NULL DEFAULT 350.0,
    "volatility" REAL NOT NULL DEFAULT 0.06,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "elos_id_fkey" FOREIGN KEY ("id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_elos" ("elo", "id") SELECT "elo", "id" FROM "elos";
DROP TABLE "elos";
ALTER TABLE "new_elos" RENAME TO "elos";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
