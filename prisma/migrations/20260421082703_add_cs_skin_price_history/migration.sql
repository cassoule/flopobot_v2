-- CreateTable
CREATE TABLE "cs_skin_price_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cs_skin_id" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cs_skin_price_history_cs_skin_id_fkey" FOREIGN KEY ("cs_skin_id") REFERENCES "cs_skins" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "cs_skin_price_history_cs_skin_id_created_at_idx" ON "cs_skin_price_history"("cs_skin_id", "created_at");

-- CreateIndex
CREATE INDEX "cs_skin_price_history_created_at_idx" ON "cs_skin_price_history"("created_at");
