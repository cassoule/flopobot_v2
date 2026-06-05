-- CreateTable
CREATE TABLE "patch_notes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT,
    "content" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patch_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patch_note_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "patch_note_id" TEXT NOT NULL,

    CONSTRAINT "patch_note_images_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "patch_notes" ADD CONSTRAINT "patch_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patch_note_images" ADD CONSTRAINT "patch_note_images_patch_note_id_fkey" FOREIGN KEY ("patch_note_id") REFERENCES "patch_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
