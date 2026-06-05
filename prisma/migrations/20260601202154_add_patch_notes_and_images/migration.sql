/*
  Warnings:

  - You are about to drop the `patch_note_images` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "patch_note_images" DROP CONSTRAINT "patch_note_images_patch_note_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAdmin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isDev" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "patch_note_images";
