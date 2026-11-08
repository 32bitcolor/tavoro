-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "intakeFields" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "IntakeRequest" ADD COLUMN     "answers" JSONB;

