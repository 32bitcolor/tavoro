-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "estimateUnit" TEXT NOT NULL DEFAULT 'points';

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "estimate" DOUBLE PRECISION,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'task';

-- CreateIndex
CREATE INDEX "Card_type_idx" ON "Card"("type");


-- Guard the fixed vocabularies (lib/card-fields.ts).
ALTER TABLE "Card" ADD CONSTRAINT "Card_type_check" CHECK ("type" IN ('task', 'bug', 'story', 'epic'));
ALTER TABLE "Card" ADD CONSTRAINT "Card_priority_check" CHECK ("priority" IS NULL OR "priority" IN ('highest', 'high', 'medium', 'low', 'lowest'));
ALTER TABLE "Card" ADD CONSTRAINT "Card_estimate_check" CHECK ("estimate" IS NULL OR ("estimate" >= 0 AND "estimate" <= 10000));
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_estimateUnit_check" CHECK ("estimateUnit" IN ('points', 'hours'));
