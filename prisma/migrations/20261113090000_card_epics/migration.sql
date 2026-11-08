-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "epicId" TEXT;

-- CreateIndex
CREATE INDEX "Card_epicId_idx" ON "Card"("epicId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A card can't be its own epic. (That the target is an epic, in the same workspace,
-- and that the card is top-level and not itself an epic is checked by the app.)
ALTER TABLE "Card" ADD CONSTRAINT "Card_epic_not_self" CHECK ("epicId" IS NULL OR "epicId" <> "id");
