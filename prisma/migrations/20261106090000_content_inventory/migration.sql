-- Content inventory + lifecycle (docs/CONTENT-LIFECYCLE-REUSE.md, phases 0-1). Additive only.
-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'course',
    "status" TEXT NOT NULL DEFAULT 'published',
    "ownerId" TEXT,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "reviewIntervalMonths" INTEGER,
    "lastReviewedAt" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "reviewRemindedStage" TEXT,
    "expiryRemindedStage" TEXT,
    "deliverableId" TEXT,
    "projectId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItemLabel" (
    "contentItemId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "ContentItemLabel_pkey" PRIMARY KEY ("contentItemId","labelId")
);

-- CreateIndex
CREATE INDEX "ContentItem_workspaceId_status_idx" ON "ContentItem"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_workspaceId_reviewDate_idx" ON "ContentItem"("workspaceId", "reviewDate");

-- CreateIndex
CREATE INDEX "ContentItem_workspaceId_expiryDate_idx" ON "ContentItem"("workspaceId", "expiryDate");

-- CreateIndex
CREATE INDEX "ContentItem_deliverableId_idx" ON "ContentItem"("deliverableId");

-- CreateIndex
CREATE INDEX "ContentItemLabel_labelId_idx" ON "ContentItemLabel"("labelId");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemLabel" ADD CONSTRAINT "ContentItemLabel_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemLabel" ADD CONSTRAINT "ContentItemLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

