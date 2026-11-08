import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getContentItemForUser } from "@/lib/authz";
import { createContentItem, markContentReviewed, setContentLabels, trackDeliverable, updateContentItem, type ContentFields } from "@/app/actions/content";
import { attentionReason, CONTENT_SELECT, listContent, type ContentRow } from "@/lib/content-inventory";
import { CONTENT_STATUSES, CONTENT_TYPES, dayValue, lifecycleOf, REVIEW_INTERVALS } from "@/lib/content";
import { check, iso, link, principal, tool, ToolError } from "@/lib/mcp/util";

// The content inventory (docs/CONTENT-LIFECYCLE-REUSE.md): what the team has shipped,
// with review and expiry dates. Writes go through the same server actions as the app.

const contentRef = z.string().min(1).describe("Content item id (from list_content)");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("A date, YYYY-MM-DD");

const LIFECYCLES = ["attention", "expired", "review_overdue", "expiring", "review_due", "needs_review", "current", "undated", "retired"] as const;

function summary(r: ContentRow) {
  return {
    id: r.id,
    title: r.title,
    type: r.contentType,
    status: r.status,
    lifecycle: r.lifecycle,
    why: attentionReason(r),
    owner: r.owner ? { name: r.owner.name, email: r.owner.email } : null,
    reviewDate: dayValue(r.reviewDate) || null,
    expiryDate: dayValue(r.expiryDate) || null,
    labels: r.labels.map((l) => l.name),
    url: link(`/content/${r.id}`),
  };
}

export async function loadContent(id: string) {
  if (!(await getContentItemForUser(id))) throw new ToolError("Content not found, or it's in another workspace.");
  const r = await prisma.contentItem.findUniqueOrThrow({ where: { id }, select: CONTENT_SELECT });
  const lifecycle = lifecycleOf(r);
  return {
    ...summary({ ...r, labels: r.labels.map((l) => l.label), lifecycle, nextDate: null }),
    description: r.description,
    externalUrl: r.externalUrl,
    publishedAt: dayValue(r.publishedAt) || null,
    reviewEveryMonths: r.reviewIntervalMonths,
    lastReviewedAt: iso(r.lastReviewedAt),
    project: r.project ? { id: r.project.id, name: r.project.name, url: link(`/projects/${r.project.id}`) } : null,
    deliverable: r.deliverable,
    assets: (
      await prisma.contentItemAsset.findMany({ where: { contentItemId: id }, select: { asset: { select: { id: true, name: true, assetType: true } } } })
    ).map((x) => ({ id: x.asset.id, name: x.asset.name, type: x.asset.assetType, url: link(`/assets/${x.asset.id}`) })),
    updatedAt: iso(r.updatedAt),
  };
}

/** A member of the token's workspace, by email. */
async function memberId(email: string): Promise<string> {
  const m = await prisma.membership.findFirst({
    where: { workspaceId: principal().workspaceId, suspendedAt: null, user: { email: email.trim().toLowerCase() } },
    select: { userId: true },
  });
  if (!m) throw new ToolError(`No active member with the email ${email} in this workspace.`);
  return m.userId;
}

/** Label names → ids in this workspace; unknown names are an error, so nothing is silently dropped. */
async function labelIds(names: string[]): Promise<string[]> {
  const labels = await prisma.label.findMany({ where: { workspaceId: principal().workspaceId }, select: { id: true, name: true } });
  return names.map((n) => {
    const hit = labels.find((l) => l.name.toLowerCase() === n.trim().toLowerCase());
    if (!hit) throw new ToolError(`There's no label called "${n}". Existing labels: ${labels.map((l) => l.name).join(", ") || "none"}.`);
    return hit.id;
  });
}

const fields = {
  type: z.enum(CONTENT_TYPES).optional(),
  status: z.enum(CONTENT_STATUSES).optional().describe("retired = no longer in use (kept, hidden from the default list)"),
  description: z.string().max(5000).nullable().optional().describe("Notes, as plain text"),
  ownerEmail: z.string().nullable().optional().describe("Email of the member who owns it after launch; reminders go to them. null clears it"),
  externalUrl: z.string().nullable().optional().describe("Where it lives: the LMS course, share link or file (https://)"),
  publishedAt: day.nullable().optional(),
  reviewDate: day.nullable().optional().describe("Next scheduled review"),
  reviewEveryMonths: z
    .number()
    .int()
    .refine((n) => (REVIEW_INTERVALS as readonly number[]).includes(n))
    .nullable()
    .optional()
    .describe(`Review cadence in months (${REVIEW_INTERVALS.join(", ")}); mark_content_reviewed moves the review date this far ahead`),
  expiryDate: day.nullable().optional().describe("Must not be in use after this date"),
  labels: z.array(z.string()).max(50).optional().describe("Workspace label names; replaces the item's labels"),
};

type FieldArgs = { [K in keyof typeof fields]?: z.infer<(typeof fields)[K]> };

async function toPatch(a: FieldArgs): Promise<Partial<ContentFields>> {
  return {
    ...(a.type !== undefined ? { contentType: a.type } : {}),
    ...(a.status !== undefined ? { status: a.status } : {}),
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(a.ownerEmail !== undefined ? { ownerId: a.ownerEmail ? await memberId(a.ownerEmail) : null } : {}),
    ...(a.externalUrl !== undefined ? { externalUrl: a.externalUrl } : {}),
    ...(a.publishedAt !== undefined ? { publishedAt: a.publishedAt } : {}),
    ...(a.reviewDate !== undefined ? { reviewDate: a.reviewDate } : {}),
    ...(a.reviewEveryMonths !== undefined ? { reviewIntervalMonths: a.reviewEveryMonths } : {}),
    ...(a.expiryDate !== undefined ? { expiryDate: a.expiryDate } : {}),
  };
}

export function registerContentTools(server: McpServer) {
  tool(
    server,
    "list_content",
    {
      title: "List content",
      description:
        "The content inventory: courses, job aids, videos and documents the team has shipped, most urgent first, each with its lifecycle (expired, review_overdue, expiring, review_due, needs_review, current, undated, retired) and why. Retired items are left out unless you ask for them.",
      kind: "read",
      input: {
        lifecycle: z.enum(LIFECYCLES).optional().describe("attention = anything expired, expiring, overdue or due for review"),
        type: z.enum(CONTENT_TYPES).optional(),
        query: z.string().optional().describe("Only titles or notes containing this"),
        ownerEmail: z.string().optional(),
      },
    },
    async ({ lifecycle, type, query, ownerEmail }) => {
      const rows = await listContent(principal().workspaceId, {
        q: query,
        type,
        lifecycle: lifecycle === "retired" ? undefined : lifecycle,
        status: lifecycle === "retired" ? "retired" : undefined,
        ownerId: ownerEmail ? await memberId(ownerEmail) : undefined,
      });
      return { items: rows.slice(0, 200).map(summary), total: rows.length };
    },
  );

  tool(
    server,
    "get_content",
    { title: "Get content", description: "One content item in full: dates, cadence, owner, where it lives, labels, and the project it came from.", kind: "read", input: { content: contentRef } },
    async ({ content }) => loadContent(content),
  );

  tool(
    server,
    "create_content",
    {
      title: "Add content to the inventory",
      description: "Track a piece of shipped content. To track a project deliverable, use track_deliverable instead so it keeps the link.",
      kind: "write",
      input: { title: z.string().min(1).max(200), ...fields },
    },
    async ({ title, labels, ...rest }) => {
      // Resolve labels (and the owner) first, so a bad name fails before anything is created.
      const ids = labels ? await labelIds(labels) : null;
      const res = check(await createContentItem({ title, ...(await toPatch(rest)) }));
      if (ids) check(await setContentLabels(res.id, ids));
      return loadContent(res.id);
    },
  );

  tool(
    server,
    "update_content",
    {
      title: "Update content",
      description: "Change a content item. Only the fields you pass change; pass null to clear one. Moving a date restarts its reminders.",
      kind: "write",
      idempotent: true,
      input: { content: contentRef, title: z.string().min(1).max(200).optional(), ...fields },
    },
    async ({ content, title, labels, ...rest }) => {
      if (!(await getContentItemForUser(content))) throw new ToolError("Content not found, or it's in another workspace.");
      const ids = labels ? await labelIds(labels) : null;
      const patch = { ...(await toPatch(rest)), ...(title ? { title } : {}) };
      if (Object.keys(patch).length) check(await updateContentItem(content, patch));
      if (ids) check(await setContentLabels(content, ids));
      return loadContent(content);
    },
  );

  tool(
    server,
    "mark_content_reviewed",
    {
      title: "Mark content reviewed",
      description: "Record that someone reviewed it and it's still right: sets the next review one cadence from today (12 months if none), and clears needs_review.",
      kind: "write",
      input: { content: contentRef },
    },
    async ({ content }) => {
      check(await markContentReviewed(content));
      return loadContent(content);
    },
  );

  tool(
    server,
    "track_deliverable",
    {
      title: "Track a deliverable in the inventory",
      description: "Add a project deliverable to the content inventory, prefilled from it and linked back to its project. Returns the existing item if it's already tracked.",
      kind: "write",
      input: { deliverable: z.string().min(1).describe("Deliverable id (from get_project)") },
    },
    async ({ deliverable }) => {
      const res = check(await trackDeliverable(deliverable));
      return { ...(await loadContent(res.id)), alreadyTracked: res.existing };
    },
  );
}
