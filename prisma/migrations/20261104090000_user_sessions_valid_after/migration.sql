-- Sessions issued before this moment are rejected (set on password change/reset).
ALTER TABLE "User" ADD COLUMN "sessionsValidAfter" TIMESTAMP(3);
