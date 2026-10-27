-- Completion timestamps for reporting (Reports → Delivery).
--
-- Card.completedAt / Project.completedAt are maintained by the triggers below, not
-- by app code: a card's status is written from a dozen places (drag, drawer, sprint
-- board, move-to-board, review feedback, MCP, restore…) and a missed one would make
-- throughput silently wrong. Prisma doesn't model triggers, so they live only here.

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Card_completedAt_idx" ON "Card"("completedAt");

-- A card is complete while its status is in the "done" category. Entering done
-- stamps now(); moving between two done statuses keeps the first stamp; leaving
-- done clears it. On insert (create, or restoring a backup) an existing value is
-- kept, else a done card is stamped with its createdAt — so restoring an old
-- backup doesn't pile every finished card onto the restore date.
CREATE FUNCTION card_completed_at() RETURNS trigger AS $$
DECLARE
  is_done boolean;
BEGIN
  SELECT category = 'done' INTO is_done FROM "WorkspaceStatus" WHERE id = NEW."statusId";
  is_done := COALESCE(is_done, false);
  IF TG_OP = 'INSERT' THEN
    NEW."completedAt" := CASE WHEN is_done THEN COALESCE(NEW."completedAt", NEW."createdAt", now()) END;
  ELSIF NEW."statusId" IS DISTINCT FROM OLD."statusId" THEN
    NEW."completedAt" := CASE WHEN is_done THEN COALESCE(OLD."completedAt", now()) END;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER card_completed_at BEFORE INSERT OR UPDATE OF "statusId" ON "Card"
  FOR EACH ROW EXECUTE FUNCTION card_completed_at();

-- Re-categorising a status (Settings → Statuses) completes or reopens its cards.
CREATE FUNCTION status_category_completed_at() RETURNS trigger AS $$
BEGIN
  IF NEW.category = 'done' AND OLD.category <> 'done' THEN
    UPDATE "Card" SET "completedAt" = now() WHERE "statusId" = NEW.id AND "completedAt" IS NULL;
  ELSIF NEW.category <> 'done' AND OLD.category = 'done' THEN
    UPDATE "Card" SET "completedAt" = NULL WHERE "statusId" = NEW.id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER status_category_completed_at AFTER UPDATE OF category ON "WorkspaceStatus"
  FOR EACH ROW EXECUTE FUNCTION status_category_completed_at();

-- Same rule for projects, keyed on status = 'completed'.
CREATE FUNCTION project_completed_at() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."completedAt" := CASE WHEN NEW.status = 'completed' THEN COALESCE(NEW."completedAt", NEW."createdAt", now()) END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW."completedAt" := CASE WHEN NEW.status = 'completed' THEN COALESCE(OLD."completedAt", now()) END;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_completed_at BEFORE INSERT OR UPDATE OF status ON "Project"
  FOR EACH ROW EXECUTE FUNCTION project_completed_at();

-- Backfill: nothing recorded when existing work finished, so its last edit is the
-- best estimate. Reports flag dates before this migration as estimated.
UPDATE "Card" c SET "completedAt" = c."updatedAt"
  FROM "WorkspaceStatus" s WHERE s.id = c."statusId" AND s.category = 'done';
UPDATE "Project" SET "completedAt" = "updatedAt" WHERE status = 'completed';
