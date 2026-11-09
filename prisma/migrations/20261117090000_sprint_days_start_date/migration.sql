-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SprintDay" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "scopeCards" INTEGER NOT NULL,
    "scopePoints" DOUBLE PRECISION NOT NULL,
    "doneCards" INTEGER NOT NULL,
    "donePoints" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SprintDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SprintDay_sprintId_day_key" ON "SprintDay"("sprintId", "day");

-- AddForeignKey
ALTER TABLE "SprintDay" ADD CONSTRAINT "SprintDay_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

