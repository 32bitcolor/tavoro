-- AlterTable
ALTER TABLE "AssessmentItem" ADD COLUMN     "sourceBankItemId" TEXT;

-- CreateTable
CREATE TABLE "BankItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'question',
    "prompt" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'multiple_choice',
    "bloomLevel" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankItemLabel" (
    "bankItemId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "BankItemLabel_pkey" PRIMARY KEY ("bankItemId","labelId")
);

-- CreateIndex
CREATE INDEX "BankItem_workspaceId_kind_idx" ON "BankItem"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "BankItem_workspaceId_archivedAt_idx" ON "BankItem"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "BankItemLabel_labelId_idx" ON "BankItemLabel"("labelId");

-- CreateIndex
CREATE INDEX "AssessmentItem_sourceBankItemId_idx" ON "AssessmentItem"("sourceBankItemId");

-- AddForeignKey
ALTER TABLE "AssessmentItem" ADD CONSTRAINT "AssessmentItem_sourceBankItemId_fkey" FOREIGN KEY ("sourceBankItemId") REFERENCES "BankItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankItem" ADD CONSTRAINT "BankItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankItem" ADD CONSTRAINT "BankItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankItemLabel" ADD CONSTRAINT "BankItemLabel_bankItemId_fkey" FOREIGN KEY ("bankItemId") REFERENCES "BankItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankItemLabel" ADD CONSTRAINT "BankItemLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

