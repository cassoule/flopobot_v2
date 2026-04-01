-- CreateTable
CREATE TABLE "sudoku_otd" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "puzzle" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "difficulty" TEXT
);

-- CreateTable
CREATE TABLE "sudoku_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "time" INTEGER,
    CONSTRAINT "sudoku_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
