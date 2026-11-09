-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "report" JSONB;

-- AlterTable
-- Byte order, so fractional-index keys sort the same whatever the server locale.
ALTER TABLE "Card" ADD COLUMN     "rank" TEXT COLLATE "C";

-- CreateIndex
CREATE INDEX "Card_rank_idx" ON "Card"("rank");

