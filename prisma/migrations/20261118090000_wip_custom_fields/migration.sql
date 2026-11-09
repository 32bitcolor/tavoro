-- AlterTable
ALTER TABLE "Column" ADD COLUMN     "wipLimit" INTEGER;

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "position" TEXT NOT NULL,
    "allBoards" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldBoard" (
    "fieldId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,

    CONSTRAINT "CustomFieldBoard_pkey" PRIMARY KEY ("fieldId","boardId")
);

-- CreateTable
CREATE TABLE "CardFieldValue" (
    "cardId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "text" TEXT,
    "number" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "bool" BOOLEAN,
    "optionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardFieldValue_pkey" PRIMARY KEY ("cardId","fieldId")
);

-- CreateIndex
CREATE INDEX "CustomField_workspaceId_position_idx" ON "CustomField"("workspaceId", "position");

-- CreateIndex
CREATE INDEX "CustomFieldBoard_boardId_idx" ON "CustomFieldBoard"("boardId");

-- CreateIndex
CREATE INDEX "CardFieldValue_fieldId_idx" ON "CardFieldValue"("fieldId");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldBoard" ADD CONSTRAINT "CustomFieldBoard_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldBoard" ADD CONSTRAINT "CustomFieldBoard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFieldValue" ADD CONSTRAINT "CardFieldValue_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFieldValue" ADD CONSTRAINT "CardFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFieldValue" ADD CONSTRAINT "CardFieldValue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: valid field types, and one name per workspace (case-insensitive).
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_type_check" CHECK ("type" IN ('text','number','select','multiselect','date','checkbox','person'));
CREATE UNIQUE INDEX "CustomField_workspaceId_lower_name_key" ON "CustomField"("workspaceId", lower("name"));
ALTER TABLE "Column" ADD CONSTRAINT "Column_wipLimit_check" CHECK ("wipLimit" IS NULL OR "wipLimit" > 0);
