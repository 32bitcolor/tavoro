-- CreateTable
CREATE TABLE "CardCourse" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "linkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardCourse_cardId_key" ON "CardCourse"("cardId");

-- CreateIndex
CREATE INDEX "CardCourse_appId_courseId_idx" ON "CardCourse"("appId", "courseId");

-- AddForeignKey
ALTER TABLE "CardCourse" ADD CONSTRAINT "CardCourse_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCourse" ADD CONSTRAINT "CardCourse_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ConnectedApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

