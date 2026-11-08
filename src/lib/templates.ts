import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { positionsAfter } from "@/lib/ordering";
import { pickStatusIdForName } from "@/lib/status";
import { ASSESSMENT_ITEM_TYPES, BLOOM_LEVELS, DELIVERABLE_TYPES } from "@/lib/methodology";
import { SCREEN_TYPES } from "@/lib/storyboard";
import type { Prisma } from "@/generated/prisma/client";

// Templates (docs/CONTENT-LIFECYCLE-REUSE.md, phase 3). A template is a snapshot of a
// project's skeleton or of a storyboard, stored as JSON on a Template row and deep-copied
// into fresh rows when used.
//
// What a project template keeps: methodology, description, phases (with their dates as
// offsets), milestones (offsets), deliverables (+ the storyboard of a storyboard
// deliverable), learning objectives, assessment items and their alignment, and the
// project's boards with their columns and cards (title, description, labels, subtasks),
// all placed in the board's first to-do column.
// What it drops, because it's the work of one particular run: statuses (everything
// starts not started), people (assignees, SMEs, owners), comments, review rounds and
// files, time entries, attachments, card due dates, sprints, intake links, group access.
//
// Rows reference each other by local keys ("p0", "o3"), and statuses and labels by
// name, never by database id: a template must survive a backup restore (which issues
// new ids) and a status or label being deleted.

export const TEMPLATE_KINDS = ["project", "storyboard"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

const LIMIT = { phases: 50, milestones: 100, deliverables: 200, objectives: 200, assessments: 500, boards: 20, columns: 30, cards: 1000, subtasks: 50, screens: 500 };
const MAX_BYTES = 4_000_000;

const str = (max: number) => z.string().max(max);
const optText = z.string().max(200_000).nullable().catch(null);
const offset = z.number().int().min(-36500).max(36500).nullable().catch(null);

const ScreenSnap = z.object({
  title: str(200),
  screenType: z.enum(SCREEN_TYPES).catch("content"),
  onScreenText: optText,
  narration: optText,
  visualNotes: optText,
  interactionNotes: optText,
  developerNotes: optText,
  objectives: z.array(z.string()).catch([]),
});

const StoryboardSnap = z.object({
  description: z.string().max(5000).nullable().catch(null),
  screens: z.array(ScreenSnap).max(LIMIT.screens),
});

const ProjectSnap = z.object({
  v: z.literal(1),
  methodology: z.enum(["ADDIE", "SAM", "CUSTOM"]).catch("CUSTOM"),
  description: z.string().max(5000).nullable().catch(null),
  sprintsEnabled: z.boolean().catch(false),
  phases: z.array(z.object({ key: z.string(), name: str(140), start: offset, end: offset })).max(LIMIT.phases),
  milestones: z.array(z.object({ name: str(200), due: offset })).max(LIMIT.milestones),
  deliverables: z
    .array(
      z.object({
        name: str(200),
        type: z.enum(DELIVERABLE_TYPES).catch("other"),
        phase: z.string().nullable().catch(null),
        storyboard: StoryboardSnap.nullable().catch(null),
      }),
    )
    .max(LIMIT.deliverables),
  objectives: z.array(z.object({ key: z.string(), text: str(1000), bloomLevel: z.enum(BLOOM_LEVELS).catch("understand") })).max(LIMIT.objectives),
  assessments: z
    .array(
      z.object({
        prompt: str(5000),
        itemType: z.enum(ASSESSMENT_ITEM_TYPES).catch("other"),
        objectives: z.array(z.string()).catch([]),
        // The question-bank entry it was copied from, kept only if it still exists.
        bankItem: z.string().nullable().catch(null).default(null),
      }),
    )
    .max(LIMIT.assessments),
  boards: z
    .array(
      z.object({
        name: str(140),
        columns: z
          .array(
            z.object({
              name: str(140),
              status: z.string().nullable().catch(null),
              cards: z
                .array(
                  z.object({
                    title: str(500),
                    description: optText,
                    labels: z.array(z.string()).catch([]),
                    subtasks: z.array(str(500)).max(LIMIT.subtasks).catch([]),
                  }),
                )
                .max(LIMIT.cards),
            }),
          )
          .max(LIMIT.columns),
      }),
    )
    .max(LIMIT.boards),
});

const StoryboardTemplateSnap = StoryboardSnap.extend({ v: z.literal(1) });

export type ProjectSnapshot = z.infer<typeof ProjectSnap>;
export type StoryboardSnapshot = z.infer<typeof StoryboardTemplateSnap>;

export function parseSnapshot(kind: "project", data: unknown): ProjectSnapshot | null;
export function parseSnapshot(kind: "storyboard", data: unknown): StoryboardSnapshot | null;
export function parseSnapshot(kind: TemplateKind, data: unknown) {
  const r = (kind === "project" ? ProjectSnap : StoryboardTemplateSnap).safeParse(data);
  return r.success ? r.data : null;
}

/** "5 phases · 12 deliverables · 2 storyboards" — for lists and pickers. */
export function describeSnapshot(kind: string, data: unknown): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (kind === "storyboard") {
    const s = parseSnapshot("storyboard", data);
    return s ? plural(s.screens.length, "screen") : "Unreadable template";
  }
  const p = parseSnapshot("project", data);
  if (!p) return "Unreadable template";
  const storyboards = p.deliverables.filter((d) => d.storyboard).length;
  const cards = p.boards.reduce((n, b) => n + b.columns.reduce((m, c) => m + c.cards.length, 0), 0);
  return [
    plural(p.phases.length, "phase"),
    p.deliverables.length ? plural(p.deliverables.length, "deliverable") : null,
    p.milestones.length ? plural(p.milestones.length, "milestone") : null,
    storyboards ? plural(storyboards, "storyboard") : null,
    p.objectives.length ? plural(p.objectives.length, "objective") : null,
    p.boards.length ? plural(p.boards.length, "board") : null,
    cards ? plural(cards, "card") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function snapshotTooBig(data: unknown) {
  return JSON.stringify(data).length > MAX_BYTES;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const SCREEN_FIELDS_SELECT = {
  title: true,
  screenType: true,
  onScreenText: true,
  narration: true,
  visualNotes: true,
  interactionNotes: true,
  developerNotes: true,
} as const;

type ScreenRow = {
  title: string;
  screenType: string;
  onScreenText: string | null;
  narration: string | null;
  visualNotes: string | null;
  interactionNotes: string | null;
  developerNotes: string | null;
  objectives?: { objectiveId: string }[];
};

function screenSnap(s: ScreenRow, objectiveKey?: Map<string, string>) {
  return {
    title: s.title,
    screenType: (SCREEN_TYPES as readonly string[]).includes(s.screenType) ? (s.screenType as (typeof SCREEN_TYPES)[number]) : "content",
    onScreenText: s.onScreenText,
    narration: s.narration,
    visualNotes: s.visualNotes,
    interactionNotes: s.interactionNotes,
    developerNotes: s.developerNotes,
    objectives: objectiveKey ? (s.objectives ?? []).map((o) => objectiveKey.get(o.objectiveId)).filter((k): k is string => !!k) : [],
  };
}

/** Snapshot a project's skeleton. The caller has already checked access. */
export async function snapshotProject(projectId: string): Promise<ProjectSnapshot> {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      methodology: true,
      description: true,
      sprintsEnabled: true,
      phases: { orderBy: { position: "asc" }, take: LIMIT.phases, select: { id: true, name: true, startDate: true, endDate: true } },
      milestones: { orderBy: { position: "asc" }, take: LIMIT.milestones, select: { name: true, dueDate: true } },
      deliverables: {
        orderBy: { position: "asc" },
        take: LIMIT.deliverables,
        select: {
          name: true,
          type: true,
          phaseId: true,
          storyboard: {
            select: {
              description: true,
              screens: { orderBy: { position: "asc" }, take: LIMIT.screens, select: { ...SCREEN_FIELDS_SELECT, objectives: { select: { objectiveId: true } } } },
            },
          },
        },
      },
      objectives: { orderBy: { position: "asc" }, take: LIMIT.objectives, select: { id: true, text: true, bloomLevel: true } },
      assessmentItems: { orderBy: { position: "asc" }, take: LIMIT.assessments, select: { prompt: true, itemType: true, sourceBankItemId: true, objectives: { select: { objectiveId: true } } } },
      boards: {
        orderBy: { createdAt: "asc" },
        take: LIMIT.boards,
        select: {
          name: true,
          columns: {
            orderBy: { position: "asc" },
            take: LIMIT.columns,
            select: {
              name: true,
              status: { select: { name: true } },
              cards: {
                orderBy: { position: "asc" },
                take: LIMIT.cards,
                select: {
                  title: true,
                  description: true,
                  labels: { select: { label: { select: { name: true } } } },
                  subtasks: { orderBy: { position: "asc" }, take: LIMIT.subtasks, select: { title: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // Dates become day offsets from the earliest one, so "Design starts two weeks in"
  // carries over and lands relative to the new project's start date.
  const dates = [...p.phases.flatMap((ph) => [ph.startDate, ph.endDate]), ...p.milestones.map((m) => m.dueDate)].filter((d): d is Date => !!d);
  const anchor = dates.length ? Math.min(...dates.map(utcDay)) : null;
  const off = (d: Date | null) => (d && anchor !== null ? Math.round((utcDay(d) - anchor) / DAY) : null);

  const phaseKey = new Map(p.phases.map((ph, i) => [ph.id, `p${i}`]));
  const objectiveKey = new Map(p.objectives.map((o, i) => [o.id, `o${i}`]));
  const keysOf = (links: { objectiveId: string }[]) => links.map((l) => objectiveKey.get(l.objectiveId)).filter((k): k is string => !!k);

  return {
    v: 1,
    methodology: p.methodology,
    description: p.description,
    sprintsEnabled: p.sprintsEnabled,
    phases: p.phases.map((ph) => ({ key: phaseKey.get(ph.id)!, name: ph.name, start: off(ph.startDate), end: off(ph.endDate) })),
    milestones: p.milestones.map((m) => ({ name: m.name, due: off(m.dueDate) })),
    deliverables: p.deliverables.map((d) => ({
      name: d.name,
      type: (DELIVERABLE_TYPES as readonly string[]).includes(d.type) ? (d.type as (typeof DELIVERABLE_TYPES)[number]) : "other",
      phase: d.phaseId ? (phaseKey.get(d.phaseId) ?? null) : null,
      storyboard: d.storyboard ? { description: d.storyboard.description, screens: d.storyboard.screens.map((s) => screenSnap(s, objectiveKey)) } : null,
    })),
    objectives: p.objectives.map((o) => ({
      key: objectiveKey.get(o.id)!,
      text: o.text,
      bloomLevel: (BLOOM_LEVELS as readonly string[]).includes(o.bloomLevel) ? (o.bloomLevel as (typeof BLOOM_LEVELS)[number]) : "understand",
    })),
    assessments: p.assessmentItems.map((a) => ({
      prompt: a.prompt,
      itemType: (ASSESSMENT_ITEM_TYPES as readonly string[]).includes(a.itemType) ? (a.itemType as (typeof ASSESSMENT_ITEM_TYPES)[number]) : "other",
      objectives: keysOf(a.objectives),
      bankItem: a.sourceBankItemId,
    })),
    boards: p.boards.map((b) => ({
      name: b.name,
      columns: b.columns.map((c) => ({
        name: c.name,
        status: c.status?.name ?? null,
        cards: c.cards.map((card) => ({
          title: card.title,
          description: card.description,
          labels: card.labels.map((l) => l.label.name),
          subtasks: card.subtasks.map((s) => s.title),
        })),
      })),
    })),
  };
}

/** Snapshot a storyboard's screens. Objective links are dropped: objectives belong to
 *  a project, and a storyboard template can be used anywhere. */
export async function snapshotStoryboard(storyboardId: string): Promise<StoryboardSnapshot> {
  const sb = await prisma.storyboard.findUniqueOrThrow({
    where: { id: storyboardId },
    select: { description: true, screens: { orderBy: { position: "asc" }, take: LIMIT.screens, select: SCREEN_FIELDS_SELECT } },
  });
  return { v: 1, description: sb.description, screens: sb.screens.map((s) => screenSnap(s)) };
}

type Tx = Prisma.TransactionClient;

async function createScreens(tx: Tx, storyboardId: string, screens: StoryboardSnapshot["screens"], objectiveId?: Map<string, string>) {
  const positions = positionsAfter(null, screens.length);
  for (const [i, s] of screens.entries()) {
    const links = objectiveId ? s.objectives.map((k) => objectiveId.get(k)).filter((id): id is string => !!id) : [];
    await tx.screen.create({
      data: {
        storyboardId,
        title: s.title,
        screenType: s.screenType,
        position: positions[i],
        onScreenText: s.onScreenText,
        narration: s.narration,
        visualNotes: s.visualNotes,
        interactionNotes: s.interactionNotes,
        developerNotes: s.developerNotes,
        ...(links.length ? { objectives: { create: [...new Set(links)].map((objectiveId) => ({ objectiveId })) } } : {}),
      },
    });
  }
}

/** Build a new project from a project template. `start` anchors the dates (UTC midnight). */
export async function instantiateProject(workspaceId: string, snap: ProjectSnapshot, name: string, start: Date): Promise<{ id: string }> {
  const at = (n: number | null) => (n === null ? null : new Date(utcDay(start) + n * DAY));
  const [statuses, labels] = await Promise.all([
    prisma.workspaceStatus.findMany({ where: { workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.label.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const labelId = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));

  return prisma.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: { workspaceId, name, methodology: snap.methodology, description: snap.description, sprintsEnabled: snap.sprintsEnabled },
        select: { id: true },
      });
      const projectId = project.id;

      const phaseId = new Map<string, string>();
      const phasePos = positionsAfter(null, snap.phases.length);
      for (const [i, ph] of snap.phases.entries()) {
        const row = await tx.phase.create({ data: { projectId, name: ph.name, position: phasePos[i], startDate: at(ph.start), endDate: at(ph.end) }, select: { id: true } });
        phaseId.set(ph.key, row.id);
      }

      const msPos = positionsAfter(null, snap.milestones.length);
      if (snap.milestones.length) {
        await tx.milestone.createMany({ data: snap.milestones.map((m, i) => ({ projectId, name: m.name, dueDate: at(m.due), position: msPos[i] })) });
      }

      const objectiveId = new Map<string, string>();
      const objPos = positionsAfter(null, snap.objectives.length);
      for (const [i, o] of snap.objectives.entries()) {
        const row = await tx.learningObjective.create({ data: { projectId, text: o.text, bloomLevel: o.bloomLevel, position: objPos[i] }, select: { id: true } });
        objectiveId.set(o.key, row.id);
      }

      const bankIds = [...new Set(snap.assessments.map((a) => a.bankItem).filter((id): id is string => !!id))];
      const liveBank = new Set(
        bankIds.length
          ? (await tx.bankItem.findMany({ where: { id: { in: bankIds }, workspaceId }, select: { id: true } })).map((b) => b.id)
          : [],
      );
      const aPos = positionsAfter(null, snap.assessments.length);
      for (const [i, a] of snap.assessments.entries()) {
        const links = [...new Set(a.objectives.map((k) => objectiveId.get(k)).filter((id): id is string => !!id))];
        await tx.assessmentItem.create({
          data: { projectId, prompt: a.prompt, itemType: a.itemType, position: aPos[i], sourceBankItemId: a.bankItem && liveBank.has(a.bankItem) ? a.bankItem : null, ...(links.length ? { objectives: { create: links.map((objectiveId) => ({ objectiveId })) } } : {}) },
        });
      }

      const dPos = positionsAfter(null, snap.deliverables.length);
      for (const [i, d] of snap.deliverables.entries()) {
        const row = await tx.deliverable.create({
          data: { projectId, name: d.name, type: d.type, position: dPos[i], phaseId: d.phase ? (phaseId.get(d.phase) ?? null) : null },
          select: { id: true },
        });
        if (d.storyboard) {
          const sb = await tx.storyboard.create({ data: { workspaceId, deliverableId: row.id, title: d.name, description: d.storyboard.description }, select: { id: true } });
          await createScreens(tx, sb.id, d.storyboard.screens, objectiveId);
        }
      }

      for (const b of snap.boards) {
        const board = await tx.board.create({ data: { workspaceId, projectId, name: b.name }, select: { id: true } });
        const colPos = positionsAfter(null, b.columns.length);
        const cols: { id: string; statusId: string | null }[] = [];
        for (const [ci, c] of b.columns.entries()) {
          const statusId = pickStatusIdForName(statuses, c.status ?? c.name);
          cols.push(await tx.column.create({ data: { boardId: board.id, name: c.name, position: colPos[ci], statusId }, select: { id: true, statusId: true } }));
        }
        // A new run starts with nothing done: every card lands in the board's first
        // to-do column (or its first column), in the template's order.
        const target = cols.find((c) => statuses.find((s) => s.id === c.statusId)?.category === "todo") ?? cols[0];
        const cards = b.columns.flatMap((c) => c.cards);
        const cardPos = positionsAfter(null, cards.length);
        for (const [k, card] of cards.entries()) {
          if (!target) break;
          const ids = [...new Set(card.labels.map((n) => labelId.get(n.toLowerCase())).filter((id): id is string => !!id))];
          const subPos = positionsAfter(null, card.subtasks.length);
          const created = await tx.card.create({
            data: {
              columnId: target.id,
              title: card.title,
              description: card.description,
              statusId: target.statusId,
              position: cardPos[k],
              ...(ids.length ? { labels: { create: ids.map((labelId) => ({ labelId })) } } : {}),
            },
            select: { id: true },
          });
          if (card.subtasks.length) {
            await tx.card.createMany({ data: card.subtasks.map((title, s) => ({ parentCardId: created.id, title, position: subPos[s] })) });
          }
        }
      }

      return { id: projectId };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Build a new standalone storyboard (or one for a deliverable) from a storyboard template. */
export async function instantiateStoryboard(
  workspaceId: string,
  snap: StoryboardSnapshot,
  title: string,
  deliverableId: string | null = null,
): Promise<{ id: string; title: string }> {
  return prisma.$transaction(
    async (tx) => {
      const sb = await tx.storyboard.create({ data: { workspaceId, title, deliverableId, description: snap.description }, select: { id: true, title: true } });
      await createScreens(tx, sb.id, snap.screens);
      return sb;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
