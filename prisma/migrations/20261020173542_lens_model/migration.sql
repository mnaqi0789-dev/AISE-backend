/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `lenses` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `mode` on the `lenses` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "LensMode" AS ENUM ('predefined', 'custom');

-- CreateEnum
CREATE TYPE "IndexState" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');

-- DropForeignKey
ALTER TABLE "lenses" DROP CONSTRAINT "lenses_owner_fkey";

-- AlterTable
ALTER TABLE "lenses" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "indexState" "IndexState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastIndexedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "mode",
ADD COLUMN     "mode" "LensMode" NOT NULL;

-- CreateTable
CREATE TABLE "lens_seeds" (
    "id" TEXT NOT NULL,
    "lensId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "maxDepth" INTEGER NOT NULL DEFAULT 2,
    "maxPages" INTEGER NOT NULL DEFAULT 200,

    CONSTRAINT "lens_seeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lens_seeds_lensId_url_key" ON "lens_seeds"("lensId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "lenses_slug_key" ON "lenses"("slug");

-- CreateIndex
CREATE INDEX "lenses_owner_idx" ON "lenses"("owner");

-- AddForeignKey
ALTER TABLE "lenses" ADD CONSTRAINT "lenses_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lens_seeds" ADD CONSTRAINT "lens_seeds_lensId_fkey" FOREIGN KEY ("lensId") REFERENCES "lenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
