-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "needsReviewAt" TIMESTAMP(3),
ADD COLUMN     "needsReviewReason" TEXT;

-- CreateTable
CREATE TABLE "ContentDependency" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "externalSource" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDependency_sourceId_idx" ON "ContentDependency"("sourceId");

-- CreateIndex
CREATE INDEX "ContentDependency_targetId_idx" ON "ContentDependency"("targetId");

-- CreateIndex
CREATE INDEX "ContentDependency_workspaceId_externalSource_idx" ON "ContentDependency"("workspaceId", "externalSource");

-- AddForeignKey
ALTER TABLE "ContentDependency" ADD CONSTRAINT "ContentDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDependency" ADD CONSTRAINT "ContentDependency_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDependency" ADD CONSTRAINT "ContentDependency_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDependency" ADD CONSTRAINT "ContentDependency_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- An edge points at exactly one thing: another content item, or a named outside source.
ALTER TABLE "ContentDependency" ADD CONSTRAINT "ContentDependency_one_target_check"
  CHECK (("targetId" IS NULL) <> ("externalSource" IS NULL));
