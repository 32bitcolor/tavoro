-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "courseAppId" TEXT,
ADD COLUMN     "courseAt" TIMESTAMP(3),
ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "courseTitle" TEXT;

-- AddForeignKey
ALTER TABLE "Storyboard" ADD CONSTRAINT "Storyboard_courseAppId_fkey" FOREIGN KEY ("courseAppId") REFERENCES "ConnectedApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

