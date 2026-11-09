-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "automation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "boardId" TEXT,
    "trigger" JSONB NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "cardId" TEXT,
    "cardKey" TEXT,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_idx" ON "AutomationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_at_idx" ON "AutomationRun"("ruleId", "at");

-- CreateIndex
CREATE INDEX "AutomationRun_cardId_at_idx" ON "AutomationRun"("cardId", "at");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

