/*
  Warnings:

  - You are about to drop the column `searchVector` on the `documents` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "documents_search_idx";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "searchVector";
