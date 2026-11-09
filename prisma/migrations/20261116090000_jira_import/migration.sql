-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "importedAuthor" TEXT;

-- CreateTable
CREATE TABLE "JiraImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "site" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cloudId" TEXT,
    "tokenCipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "projects" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB,
    "scan" JSONB,
    "progress" JSONB,
    "report" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedCard" (
    "cardId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedCard_pkey" PRIMARY KEY ("cardId")
);

-- CreateIndex
CREATE INDEX "JiraImport_workspaceId_createdAt_idx" ON "JiraImport"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedCard_workspaceId_externalKey_idx" ON "ImportedCard"("workspaceId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedCard_workspaceId_externalRef_key" ON "ImportedCard"("workspaceId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_workspaceId_externalRef_key" ON "Sprint"("workspaceId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Board_workspaceId_externalRef_key" ON "Board"("workspaceId", "externalRef");

-- AddForeignKey
ALTER TABLE "JiraImport" ADD CONSTRAINT "JiraImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraImport" ADD CONSTRAINT "JiraImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedCard" ADD CONSTRAINT "ImportedCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

