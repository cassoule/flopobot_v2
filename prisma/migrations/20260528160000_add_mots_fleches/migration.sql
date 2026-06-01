-- CreateTable
CREATE TABLE "mots_fleches_otd" (
    "id" SERIAL NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mots_fleches_otd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mots_fleches_stats" (
    "id" TEXT NOT NULL,
    "otd_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "time" INTEGER,
    "clues_solved" INTEGER,
    "score" INTEGER,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mots_fleches_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mots_fleches_otd_date_key" ON "mots_fleches_otd"("date");

-- CreateIndex
CREATE UNIQUE INDEX "mots_fleches_stats_otd_id_user_id_key" ON "mots_fleches_stats"("otd_id", "user_id");

-- AddForeignKey
ALTER TABLE "mots_fleches_stats" ADD CONSTRAINT "mots_fleches_stats_otd_id_fkey" FOREIGN KEY ("otd_id") REFERENCES "mots_fleches_otd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mots_fleches_stats" ADD CONSTRAINT "mots_fleches_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
