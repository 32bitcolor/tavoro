-- CreateTable
CREATE TABLE "CardLink" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardWatcher" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardWatcher_pkey" PRIMARY KEY ("cardId","userId")
);

-- CreateTable
CREATE TABLE "CardActivity" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardLink_toId_idx" ON "CardLink"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "CardLink_fromId_toId_type_key" ON "CardLink"("fromId", "toId", "type");

-- CreateIndex
CREATE INDEX "CardWatcher_userId_idx" ON "CardWatcher"("userId");

-- CreateIndex
CREATE INDEX "CardActivity_cardId_createdAt_idx" ON "CardActivity"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardWatcher" ADD CONSTRAINT "CardWatcher_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardWatcher" ADD CONSTRAINT "CardWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_not_self" CHECK ("fromId" <> "toId");
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_type_check" CHECK ("type" IN ('blocks', 'relates', 'duplicates', 'clones'));
-- "relates" is symmetric: one row per pair, the lower id first.
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_relates_ordered" CHECK ("type" <> 'relates' OR "fromId" < "toId");
