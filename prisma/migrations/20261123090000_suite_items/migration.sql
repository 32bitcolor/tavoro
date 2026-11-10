-- CreateTable
CREATE TABLE "SuiteItem" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "cardId" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuiteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuiteItem_cardId_idx" ON "SuiteItem"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "SuiteItem_appId_kind_externalId_key" ON "SuiteItem"("appId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "SuiteItem" ADD CONSTRAINT "SuiteItem_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ConnectedApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteItem" ADD CONSTRAINT "SuiteItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

