import "dotenv/config";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Prisma } from "../src/generated/prisma/client";
import { positionsAfter } from "../src/lib/ordering";
import { buildSnapshot, type StoryboardSnapshot } from "../src/lib/review-snapshot";
import { guestExpiry, guestLinkPath, newGuestNonce } from "../src/lib/review-guest-token";
import { parseAnchor, type ScreenField } from "../src/lib/review-anchor";
import { cardDescriptionForComment, describePlace, excerpt } from "../src/lib/review-feedback";

// QA demo seed: fills the admin's workspace with a lived-in L&D team — 10 people, six projects at
// different stages, boards, sprints, storyboards, reviews, intake, whiteboards and attachments —
// so UX review and screenshots run against realistic content instead of empty states.
//
// DESTRUCTIVE + RESETTABLE: wipes every board/project/storyboard/whiteboard/label/group/sprint/
// intake request in the target workspace (and demo users, all @example.com) before rebuilding.
// Refuses to run unless DEMO_SEED_CONFIRM matches the workspace name.
//
//   DATABASE_URL=… DEMO_SEED_CONFIRM="Tavoro Test" npx tsx prisma/qa-demo-seed.ts
//
// Optional: S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET to upload card attachments
// (skipped without them). Every demo user's password is DEMO_PASSWORD (default below).

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });

const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? "admin@tavoro.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-pass-2026";
const DEMO_DOMAIN = "@example.com"; // reserved, undeliverable — UI actions during QA can't email real people
const SECOND_WS_SLUG = "partner-enablement-demo";

// ── time ───────────────────────────────────────────────────────────────────────
const NOW = new Date();
/** n days from today at 17:00 UTC (negative = past). */
function day(n: number, hour = 17): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

// ── TipTap documents (stored as JSON strings) ─────────────────────────────────
type Node = Record<string, unknown>;
type Inline = string | Node;
let users: Record<string, { id: string; name: string }> = {};

const m = (key: string): Node => ({ type: "mention", attrs: { id: users[key].id, label: users[key].name } });
const b = (text: string): Node => ({ type: "text", text, marks: [{ type: "bold" }] });
const i = (text: string): Node => ({ type: "text", text, marks: [{ type: "italic" }] });
function inl(parts: Inline[]): Node[] {
  return parts.filter((x) => x !== "").map((x) => (typeof x === "string" ? { type: "text", text: x } : x));
}
const p = (...parts: Inline[]): Node => ({ type: "paragraph", content: inl(parts) });
const h = (level: number, text: string): Node => ({ type: "heading", attrs: { level }, content: inl([text]) });
const ul = (...items: Inline[][]): Node => ({
  type: "bulletList",
  content: items.map((it) => ({ type: "listItem", content: [p(...it)] })),
});
const ol = (...items: Inline[][]): Node => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: items.map((it) => ({ type: "listItem", content: [p(...it)] })),
});
const doc = (...blocks: Node[]): string => JSON.stringify({ type: "doc", content: blocks });
/** Shorthand: each string is a paragraph. */
const paras = (...texts: string[]): string => doc(...texts.map((t) => p(t)));

// ── attachments (generated, no binary fixtures in the repo) ───────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A simple "mockup" PNG: gradient background, header bar, content blocks. */
function mockupPng(w: number, h: number, hue: [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const t = (x + y) / (w + h);
      let r = Math.round(hue[0] * (0.55 + 0.45 * t));
      let g = Math.round(hue[1] * (0.55 + 0.45 * t));
      let bl = Math.round(hue[2] * (0.55 + 0.45 * t));
      const header = y < h * 0.14;
      const card1 = y > h * 0.24 && y < h * 0.62 && x > w * 0.06 && x < w * 0.46;
      const card2 = y > h * 0.24 && y < h * 0.62 && x > w * 0.54 && x < w * 0.94;
      const line = y > h * 0.7 && y < h * 0.9 && x > w * 0.06 && x < w * 0.94 && Math.floor((y - h * 0.7) / 8) % 2 === 0;
      if (header) [r, g, bl] = [20, 32, 58];
      else if (card1 || card2) [r, g, bl] = [248, 250, 252];
      else if (line) [r, g, bl] = [226, 232, 240];
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = bl;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
/** A minimal valid single-page PDF with a few lines of text. */
function simplePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const stream =
    "BT /F1 18 Tf 56 760 Td (" + esc(lines[0]) + ") Tj /F1 11 Tf " +
    lines.slice(1).map((l) => "0 -22 Td (" + esc(l) + ") Tj").join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, n) => {
    offsets.push(out.length);
    out += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A landscape, slide-per-page PDF that looks like a Storyline "Publish → Print"
 *  export: a navy title bar, body copy, and a button. For file-review rounds. */
function slidesPdf(slides: { title: string; body: string[]; button?: string }[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c);
  const objs: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // pages, filled in below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  const kids: number[] = [];
  slides.forEach((sl, i) => {
    const ops = [
      "0.97 0.97 0.98 rg 0 0 792 612 re f",
      "0.078 0.125 0.227 rg 0 540 792 72 re f",
      `BT /F2 26 Tf 1 1 1 rg 40 566 Td (${esc(sl.title)}) Tj ET`,
      `BT /F1 9 Tf 0.6 0.65 0.75 rg 700 566 Td (${i + 1} / ${slides.length}) Tj ET`,
      "BT /F1 16 Tf 0.12 0.14 0.2 rg 56 480 Td " + sl.body.map((l, k) => (k ? "0 -30 Td " : "") + `(${esc(l)}) Tj`).join(" ") + " ET",
      ...(sl.button
        ? [
            "0.0 0.47 0.45 rg 560 64 180 44 re f",
            `BT /F2 14 Tf 1 1 1 rg 584 80 Td (${esc(sl.button)}) Tj ET`,
          ]
        : []),
    ].join("\n");
    objs.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    const content = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
    kids.push(objs.length);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, n) => {
    offsets.push(out.length);
    out += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const FILES: Record<string, { name: string; mime: string; body: () => Buffer }> = {
  mockHome: { name: "phish-sim-landing-mockup.png", mime: "image/png", body: () => mockupPng(960, 600, [37, 99, 235]) },
  mockQuiz: { name: "knowledge-check-layout-v2.png", mime: "image/png", body: () => mockupPng(960, 600, [13, 148, 136]) },
  mockMgr: { name: "1on1-scenario-branch-mock.png", mime: "image/png", body: () => mockupPng(960, 600, [124, 58, 237]) },
  styleGuide: {
    name: "LXD-visual-style-guide-2027.pdf",
    mime: "application/pdf",
    body: () =>
      simplePdf([
        "L&D Visual Style Guide 2027",
        "Typography: Mulish 16/24 body, 28/36 headings.",
        "Color: navy #14203A primary, teal #0D9488 accent, 4.5:1 minimum contrast.",
        "Imagery: real people, real workspaces. No stock handshakes.",
        "Motion: under 300 ms, respects reduced-motion.",
      ]),
  },
  smeNotes: {
    name: "SME-interview-notes-Bell.pdf",
    mime: "application/pdf",
    body: () =>
      simplePdf([
        "SME interview - Marcus Bell, Security Operations",
        "Top three incident types this year: credential phishing, MFA fatigue, QR-code lures.",
        "Learners report too late because they fear blame. Message: report fast, no shame.",
        "Use the real Report Phish button UI in screenshots.",
      ]),
  },
  captions: {
    name: "social-engineering-ep1.vtt",
    mime: "text/vtt",
    body: () =>
      Buffer.from(
        "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nIt's 4:52 on a Friday, and the CFO needs that wire sent now.\n\n00:00:04.500 --> 00:00:08.000\nOr does she?\n",
      ),
  },
  audit: {
    name: "course-catalog-audit.csv",
    mime: "text/csv",
    body: () =>
      Buffer.from(
        "course,owner,last_updated,status\nSecurity Awareness 2025,Priya Nair,2025-09-12,needs refresh\nHIPAA Privacy,Elena Petrova,2026-03-01,current\nNew Manager Essentials (legacy),Diego Ramirez,2023-02-20,retire\n",
      ),
  },
  vo: {
    name: "VO-script-module-2-draft.txt",
    mime: "text/plain",
    body: () =>
      Buffer.from(
        "MODULE 2 - VO DRAFT\n\nScreen 2.1: Attackers don't hack in. They log in.\nScreen 2.2: Here's how one convincing email turned into a forty-thousand-dollar loss.\n",
      ),
  },
};

const s3 =
  process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
      })
    : null;
const BUCKET = process.env.S3_BUCKET ?? "tavoro";

// ── Excalidraw scenes ─────────────────────────────────────────────────────────
let seedN = 1000;
function el(type: string, x: number, y: number, w: number, hgt: number, extra: Record<string, unknown> = {}) {
  seedN += 7;
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 20),
    type, x, y, width: w, height: hgt, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: type === "rectangle" ? { type: 3 } : null,
    seed: seedN, version: 1, versionNonce: seedN * 3, isDeleted: false,
    boundElements: null, updated: NOW.getTime(), link: null, locked: false,
    ...extra,
  };
}
function text(x: number, y: number, s: string, size = 20, color = "#1e1e1e") {
  const lines = s.split("\n");
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.55;
  return el("text", x, y, w, lines.length * size * 1.25, {
    text: s, originalText: s, fontSize: size, fontFamily: 1, textAlign: "left",
    verticalAlign: "top", containerId: null, autoResize: true, lineHeight: 1.25, strokeColor: color,
  });
}
function box(x: number, y: number, w: number, hgt: number, label: string, fill: string) {
  return [el("rectangle", x, y, w, hgt, { backgroundColor: fill }), text(x + 16, y + 14, label, 18)];
}
function arrow(x1: number, y1: number, x2: number, y2: number) {
  return el("arrow", x1, y1, x2 - x1, y2 - y1, {
    points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false,
  });
}
const scene = (elements: unknown[]) =>
  JSON.stringify({ type: "excalidraw", version: 2, source: "tavoro-demo-seed", elements, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} });

// ── wipe ──────────────────────────────────────────────────────────────────────
async function wipe(workspaceId: string) {
  await prisma.savedView.deleteMany({ where: { workspaceId } });
  await prisma.contentItem.deleteMany({ where: { workspaceId } });
  await prisma.whiteboard.deleteMany({ where: { workspaceId } });
  await prisma.storyboard.deleteMany({ where: { workspaceId } });
  await prisma.intakeRequest.deleteMany({ where: { workspaceId } });
  await prisma.board.deleteMany({ where: { workspaceId } }); // columns → cards → comments/attachments cascade
  await prisma.project.deleteMany({ where: { workspaceId } });
  await prisma.sprint.deleteMany({ where: { workspaceId } });
  await prisma.label.deleteMany({ where: { workspaceId } });
  await prisma.group.deleteMany({ where: { workspaceId } });
  await prisma.workspace.deleteMany({ where: { slug: SECOND_WS_SLUG } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  if (s3) {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `workspace/${workspaceId}/` })).catch(() => null);
    const keys = (list?.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
  }
}

// ── builders ──────────────────────────────────────────────────────────────────
type ColSpec = { name: string; status: string };
type CardSpec = {
  title: string;
  col: string;
  desc?: string;
  due?: number;
  labels?: string[];
  who?: string[];
  smes?: string[];
  sprint?: string;
  subtasks?: [string, boolean][];
  comments?: [string, string, number][]; // [authorKey, TipTap doc, daysAgo]
  files?: string[];
  age?: number; // created N days ago
  ref?: string; // remember the card under this key
};

let ws = { id: "" };
let statusIds: Record<string, string> = {};
let labelIds: Record<string, string> = {};
let sprintIds: Record<string, string> = {};
const cardRefs: Record<string, string> = {};

async function makeBoard(opts: {
  name: string;
  prefix?: string;
  projectId?: string;
  columns?: ColSpec[];
  cards: CardSpec[];
  groups?: string[];
  workspaceId?: string;
}) {
  const workspaceId = opts.workspaceId ?? ws.id;
  const cols = opts.columns ?? [
    { name: "Backlog", status: "Backlog" },
    { name: "To do", status: "To do" },
    { name: "In progress", status: "In progress" },
    { name: "In review", status: "In review" },
    { name: "Done", status: "Done" },
  ];
  const colPos = positionsAfter(null, cols.length);
  const board = await prisma.board.create({
    data: {
      workspaceId,
      projectId: opts.projectId ?? null,
      name: opts.name,
      cardKeyPrefix: opts.prefix ?? null,
      columns: { create: cols.map((c, n) => ({ name: c.name, position: colPos[n], statusId: statusIds[c.status] ?? null })) },
    },
    include: { columns: true },
  });
  if (opts.groups?.length) {
    await prisma.boardGroup.createMany({ data: opts.groups.map((g) => ({ boardId: board.id, groupId: groupIds[g] })) });
  }
  const colByName = Object.fromEntries(board.columns.map((c) => [c.name, c]));
  const perCol: Record<string, string[]> = {};
  let seq = 0;
  for (const c of opts.cards) {
    const col = colByName[c.col];
    if (!col) throw new Error(`no column ${c.col} on ${opts.name}`);
    perCol[c.col] ??= positionsAfter(null, opts.cards.filter((x) => x.col === c.col).length);
    const position = perCol[c.col].shift()!;
    const created = day(-(c.age ?? 10), 14);
    const card = await prisma.card.create({
      data: {
        columnId: col.id,
        title: c.title,
        description: c.desc ?? null,
        dueDate: c.due === undefined ? null : day(c.due),
        keySeq: opts.prefix ? ++seq : null,
        statusId: col.statusId,
        sprintId: c.sprint ? sprintIds[c.sprint] : null,
        position,
        createdAt: created,
        labels: c.labels ? { create: c.labels.map((l) => ({ labelId: labelIds[l] })) } : undefined,
        assignees: c.who ? { create: c.who.map((u) => ({ userId: users[u].id })) } : undefined,
        smes: c.smes ? { create: c.smes.map((u) => ({ userId: users[u].id })) } : undefined,
      },
    });
    if (c.ref) cardRefs[c.ref] = card.id;
    if (c.subtasks) {
      const subPos = positionsAfter(null, c.subtasks.length);
      for (const [n, [title, done]] of c.subtasks.entries()) {
        await prisma.card.create({
          data: { parentCardId: card.id, title, done, position: subPos[n], keySeq: opts.prefix ? ++seq : null, createdAt: created },
        });
      }
    }
    for (const [author, body, ago] of c.comments ?? []) {
      await prisma.comment.create({ data: { cardId: card.id, authorId: users[author].id, body, createdAt: day(-ago, 15) } });
    }
    for (const f of c.files ?? []) {
      if (!s3) continue;
      const spec = FILES[f];
      const bytes = spec.body();
      const key = `workspace/${workspaceId}/card/${card.id}/${randomUUID()}-${spec.name}`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: spec.mime }));
      await prisma.attachment.create({
        data: {
          cardId: card.id, workspaceId, fileName: spec.name, mimeType: spec.mime, sizeBytes: bytes.length,
          storageKey: key, uploadedById: users[(c.who ?? ["admin"])[0]].id, createdAt: day(-(c.age ?? 10) + 1, 16),
        },
      });
    }
  }
  if (opts.prefix) await prisma.board.update({ where: { id: board.id }, data: { cardKeySeq: seq } });
  return board;
}

type ScreenSpec = {
  title: string;
  type: string;
  text?: string;
  vo?: string;
  visual?: string;
  interaction?: string;
  dev?: string;
  teaches?: number[]; // objective indexes
};
async function makeStoryboard(opts: {
  title: string;
  description: string;
  status: string;
  deliverableId?: string;
  screens: ScreenSpec[];
  objectiveIds?: string[];
  groups?: string[];
}) {
  const pos = positionsAfter(null, opts.screens.length);
  const sb = await prisma.storyboard.create({
    data: {
      workspaceId: ws.id,
      deliverableId: opts.deliverableId ?? null,
      title: opts.title,
      description: opts.description,
      status: opts.status,
    },
  });
  for (const [n, s] of opts.screens.entries()) {
    await prisma.screen.create({
      data: {
        storyboardId: sb.id,
        title: s.title,
        screenType: s.type,
        position: pos[n],
        onScreenText: s.text ?? null,
        narration: s.vo ?? null,
        visualNotes: s.visual ?? null,
        interactionNotes: s.interaction ?? null,
        developerNotes: s.dev ?? null,
        objectives: s.teaches && opts.objectiveIds ? { create: s.teaches.map((o) => ({ objectiveId: opts.objectiveIds![o] })) } : undefined,
      },
    });
  }
  if (opts.groups?.length) {
    await prisma.storyboardGroup.createMany({ data: opts.groups.map((g) => ({ storyboardId: sb.id, groupId: groupIds[g] })) });
  }
  return sb;
}

type PhaseSpec = [name: string, status: string, start: number | null, end: number | null];
async function makeProject(opts: {
  name: string;
  description: string;
  methodology: "ADDIE" | "SAM" | "CUSTOM";
  status?: string;
  sprints?: boolean;
  phases: PhaseSpec[];
  groups?: string[];
  age?: number;
}) {
  const pos = positionsAfter(null, opts.phases.length);
  const project = await prisma.project.create({
    data: {
      workspaceId: ws.id,
      name: opts.name,
      description: opts.description,
      methodology: opts.methodology,
      status: opts.status ?? "active",
      sprintsEnabled: opts.sprints ?? false,
      createdAt: day(-(opts.age ?? 60), 13),
      phases: {
        create: opts.phases.map(([name, status, s, e], n) => ({
          name, status, position: pos[n],
          startDate: s === null ? null : day(s, 13), endDate: e === null ? null : day(e),
        })),
      },
    },
    include: { phases: true },
  });
  if (opts.groups?.length) {
    await prisma.projectGroup.createMany({ data: opts.groups.map((g) => ({ projectId: project.id, groupId: groupIds[g] })) });
  }
  const phaseId = Object.fromEntries(project.phases.map((ph) => [ph.name, ph.id]));
  return { project, phaseId };
}

async function deliverables(
  projectId: string,
  phaseId: Record<string, string>,
  list: { key: string; name: string; type: string; status: string; phase?: string; card?: string }[],
) {
  const pos = positionsAfter(null, list.length);
  const out: Record<string, string> = {};
  for (const [n, d] of list.entries()) {
    const row = await prisma.deliverable.create({
      data: {
        projectId, name: d.name, type: d.type, status: d.status, position: pos[n],
        phaseId: d.phase ? phaseId[d.phase] : null, cardId: d.card ? cardRefs[d.card] : null,
        createdAt: day(-40, 12),
      },
    });
    out[d.key] = row.id;
  }
  return out;
}

async function objectives(projectId: string, list: [text: string, bloom: string][]) {
  const pos = positionsAfter(null, list.length);
  const ids: string[] = [];
  for (const [n, [text, bloomLevel]] of list.entries()) {
    ids.push((await prisma.learningObjective.create({ data: { projectId, text, bloomLevel, position: pos[n] } })).id);
  }
  return ids;
}

async function assessments(projectId: string, objectiveIds: string[], list: [prompt: string, type: string, assesses: number[]][]) {
  const pos = positionsAfter(null, list.length);
  for (const [n, [prompt, itemType, assesses]] of list.entries()) {
    await prisma.assessmentItem.create({
      data: {
        projectId, prompt, itemType, position: pos[n],
        objectives: { create: assesses.map((o) => ({ objectiveId: objectiveIds[o] })) },
      },
    });
  }
}

async function milestones(projectId: string, list: [name: string, due: number, done: boolean][]) {
  const pos = positionsAfter(null, list.length);
  for (const [n, [name, due, done]] of list.entries()) {
    await prisma.milestone.create({
      data: { projectId, name, dueDate: day(due), completedAt: done ? day(due - 1, 15) : null, position: pos[n] },
    });
  }
}

/** One review round with one reviewer. If the deliverable has a storyboard the round
 *  freezes it (like the app does); `stage` can rewrite that snapshot to stage what the
 *  storyboard looked like back then, so round-to-round diffs have something to show. */
async function review(
  deliverableId: string,
  reviewer: string,
  requester: string,
  round: number,
  status: string,
  due: number | null,
  feedback: string | null,
  age: number,
  stage?: (snap: StoryboardSnapshot) => StoryboardSnapshot,
  file?: { name: string; mime: string; bytes: Buffer } | { reuse: string },
) {
  // A file round reviews an uploaded PDF/image (phase 3) instead of the storyboard.
  let fileId: string | null = null;
  if (file && "reuse" in file) fileId = file.reuse;
  else if (file && s3) {
    const d = await prisma.deliverable.findUniqueOrThrow({ where: { id: deliverableId }, select: { project: { select: { workspaceId: true } } } });
    const wsId = d.project.workspaceId;
    const key = `workspace/${wsId}/review/${deliverableId}/${randomUUID()}-${file.name}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: file.bytes, ContentType: file.mime }));
    const rf = await prisma.reviewFile.create({
      data: {
        workspaceId: wsId, deliverableId, fileName: file.name, mimeType: file.mime, sizeBytes: file.bytes.length,
        storageKey: key, uploadedById: users[requester].id, createdAt: day(-age, 9),
      },
    });
    fileId = rf.id;
  }
  const sb = fileId ? null : await prisma.storyboard.findUnique({
    where: { deliverableId },
    select: {
      id: true, title: true,
      screens: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, screenType: true, onScreenText: true, narration: true, visualNotes: true, interactionNotes: true, developerNotes: true },
      },
    },
  });
  let snapshot = sb ? buildSnapshot(sb) : null;
  if (snapshot && stage) snapshot = stage(snapshot);
  const decided = status === "approved" || status === "approved_with_changes" || status === "changes_requested";
  const decidedAt = decided ? day(-Math.max(age - 3, 0), 11) : null;
  return prisma.reviewRound.create({
    data: {
      deliverableId, number: round, targetKind: fileId ? "file" : snapshot ? "storyboard" : "none",
      snapshot: snapshot ?? Prisma.JsonNull, fileId, dueDate: due === null ? null : day(due),
      createdById: users[requester].id, createdAt: day(-age, 10),
      outcome: status === "approved" || status === "approved_with_changes" ? "passed" : status === "changes_requested" ? "changes_requested" : null,
      closedAt: decidedAt,
      assignments: {
        create: {
          deliverableId, reviewerId: users[reviewer].id, requestedById: users[requester].id, round, status,
          dueDate: due === null ? null : day(due), feedback, decidedAt,
          createdAt: day(-age, 10), updatedAt: day(-Math.max(age - 3, 0), 11),
        },
      },
    },
    select: { id: true, snapshot: true, fileId: true },
  });
}

/** Add an outside (guest) reviewer to an existing round — a ReviewGuest with its own
 *  assignment, exactly as the app creates them. Returns the guest id for comments. */
const seedGuests: Record<string, string> = {};
async function guestReviewer(
  key: string,
  round: { id: string },
  g: { name: string; email: string; status: string; feedback?: string; seenHoursAgo?: number },
) {
  const r = await prisma.reviewRound.findUniqueOrThrow({
    where: { id: round.id },
    select: { number: true, deliverableId: true, dueDate: true, createdById: true, createdAt: true },
  });
  const guest = await prisma.reviewGuest.create({
    data: {
      name: g.name,
      email: g.email,
      nonce: newGuestNonce(),
      expiresAt: guestExpiry(r.dueDate),
      lastSeenAt: g.seenHoursAgo == null ? null : new Date(Date.now() - g.seenHoursAgo * 3_600_000),
      assignment: {
        create: {
          deliverableId: r.deliverableId, roundId: round.id, requestedById: r.createdById, round: r.number, status: g.status,
          dueDate: r.dueDate, feedback: g.feedback ?? null, createdAt: r.createdAt,
        },
      },
    },
    select: { id: true, nonce: true },
  });
  seedGuests[key] = guest.id;
  if (process.env.SESSION_SECRET) console.log(`  guest link for ${g.name}: ${guestLinkPath(guest)}`);
  return guest.id;
}

/** "guest:<key>" in a thread's `by` means a guest reviewer added with guestReviewer(). */
function authorOf(by: string) {
  return by.startsWith("guest:") ? { guestId: seedGuests[by.slice(6)] } : { authorId: users[by].id };
}

type SeedThread = {
  by: string;
  ago: number;
  body: string;
  anchor?: { screen: string; field: ScreenField; quote?: string };
  /** On a file round: a pin (x, y) or an area (+ w, h), as fractions of the page. */
  pin?: { page: number; x: number; y: number; w?: number; h?: number; quote?: string };
  status?: "open" | "resolved" | "wont_fix";
  resolvedBy?: string;
  note?: string;
  replies?: { by: string; ago: number; body: string }[];
};

/** Seed comment threads on a round; screens are found by title in the round's snapshot. */
async function reviewComments(round: { id: string; snapshot: unknown }, threads: SeedThread[]) {
  const snap = round.snapshot as StoryboardSnapshot | null;
  for (const t of threads) {
    let anchor: object = { kind: "general" };
    if (t.pin) {
      const { page, x, y, w, h, quote } = t.pin;
      anchor = w != null && h != null
        ? { kind: "file_region", page, x, y, w, h, ...(quote ? { quote: { exact: quote } } : {}) }
        : { kind: "file_point", page, x, y };
    } else if (t.anchor) {
      const screen = snap?.screens.find((x) => x.title === t.anchor!.screen);
      if (!screen) throw new Error(`no screen "${t.anchor.screen}" in round snapshot`);
      anchor = { kind: "storyboard_field", screenId: screen.id, field: t.anchor.field, ...(t.anchor.quote ? { quote: { exact: t.anchor.quote } } : {}) };
    }
    const closed = t.status && t.status !== "open";
    const parent = await prisma.reviewComment.create({
      data: {
        roundId: round.id, ...authorOf(t.by), body: paras(t.body), anchor, createdAt: day(-t.ago, 14),
        status: t.status ?? "open",
        resolvedById: closed ? users[t.resolvedBy ?? "priya"].id : null,
        resolvedAt: closed ? day(-Math.max(t.ago - 2, 0), 16) : null,
        resolvedNote: closed ? t.note ?? null : null,
      },
    });
    for (const r of t.replies ?? []) {
      await prisma.reviewComment.create({
        data: { roundId: round.id, parentId: parent.id, ...authorOf(r.by), body: paras(r.body), anchor, createdAt: day(-r.ago, 15) },
      });
    }
  }
}

async function time(projectId: string, list: [who: string, minutes: number, daysAgo: number, note: string, deliverableId?: string][]) {
  await prisma.timeEntry.createMany({
    data: list.map(([who, minutes, ago, note, deliverableId]) => ({
      projectId, userId: users[who].id, minutes, loggedFor: day(-ago, 12), note, deliverableId: deliverableId ?? null,
    })),
  });
}

let groupIds: Record<string, string> = {};

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Target the workspace NAMED by DEMO_SEED_CONFIRM — never "the admin's first one",
  // which is unordered and flipped to the seeded second workspace on a re-run.
  const confirm = process.env.DEMO_SEED_CONFIRM;
  const admin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    include: { memberships: { where: { role: "ADMIN" }, include: { workspace: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!admin || admin.memberships.length === 0) throw new Error(`${ADMIN_EMAIL} isn't an ADMIN of any workspace — run the normal seed first.`);
  const target = admin.memberships.find((m) => m.workspace.name === confirm && m.workspace.slug !== SECOND_WS_SLUG)?.workspace;
  if (!target) {
    const names = admin.memberships.filter((m) => m.workspace.slug !== SECOND_WS_SLUG).map((m) => `"${m.workspace.name}"`);
    throw new Error(`Set DEMO_SEED_CONFIRM to the workspace to wipe and rebuild — one of: ${names.join(", ")}.`);
  }
  ws = { id: target.id };
  console.log(`[demo-seed] wiping + rebuilding "${target.name}"${s3 ? "" : " (no S3 env — skipping attachments)"}`);
  await wipe(ws.id);

  statusIds = Object.fromEntries(
    (await prisma.workspaceStatus.findMany({ where: { workspaceId: ws.id } })).map((s) => [s.name, s.id]),
  );
  for (const required of ["Backlog", "To do", "In progress", "In review", "Done"]) {
    if (!statusIds[required]) throw new Error(`workspace is missing the "${required}" status`);
  }

  // People ----------------------------------------------------------------------
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 });
  const PEOPLE: [key: string, name: string, email: string, role: "ADMIN" | "MANAGER" | "MEMBER"][] = [
    ["maya", "Maya Okafor", "maya.okafor", "MANAGER"],
    ["diego", "Diego Ramirez", "diego.ramirez", "MEMBER"],
    ["priya", "Priya Nair", "priya.nair", "MEMBER"],
    ["sam", "Sam Whitfield", "sam.whitfield", "MEMBER"],
    ["hannah", "Hannah Cho", "hannah.cho", "MEMBER"],
    ["jordan", "Jordan Lee", "jordan.lee", "MEMBER"],
    ["marcus", "Marcus Bell", "marcus.bell", "MEMBER"],
    ["elena", "Dr. Elena Petrova", "elena.petrova", "MEMBER"],
    ["tom", "Tom Alvarez", "tom.alvarez", "MEMBER"],
  ];
  users = { admin: { id: admin.id, name: admin.name ?? "Admin" } };
  for (const [key, name, local, role] of PEOPLE) {
    const u = await prisma.user.create({
      data: {
        email: local + DEMO_DOMAIN, name, passwordHash, createdAt: day(-120, 9),
        memberships: { create: { workspaceId: ws.id, role, createdAt: day(-120, 9) } },
      },
    });
    users[key] = { id: u.id, name };
  }

  // Groups ----------------------------------------------------------------------
  const GROUPS: [name: string, description: string, members: string[]][] = [
    ["Design Team", "Instructional designers, LXD, and eLearning developers.", ["maya", "diego", "priya", "sam", "hannah", "jordan"]],
    ["Subject-Matter Experts", "SMEs who review content for accuracy.", ["marcus", "elena", "tom"]],
    ["Compliance Working Group", "Owns regulated training: HIPAA, SOC 2, and privacy.", ["maya", "priya", "elena"]],
  ];
  groupIds = {};
  for (const [name, description, members] of GROUPS) {
    const g = await prisma.group.create({
      data: { workspaceId: ws.id, name, description, members: { create: members.map((k) => ({ userId: users[k].id })) } },
    });
    groupIds[name] = g.id;
  }

  // Labels ----------------------------------------------------------------------
  const LABELS: [string, string][] = [
    ["High priority", "#ef4444"],
    ["Compliance", "#f97316"],
    ["Localization", "#f59e0b"],
    ["Quick win", "#22c55e"],
    ["Video", "#3b82f6"],
    ["Accessibility", "#8b5cf6"],
    ["SME input needed", "#ec4899"],
    ["Blocked", "#6b7280"],
  ];
  labelIds = {};
  for (const [name, color] of LABELS) {
    labelIds[name] = (await prisma.label.create({ data: { workspaceId: ws.id, name, color } })).id;
  }

  // Sprints ---------------------------------------------------------------------
  const SPRINTS: [key: string, name: string, goal: string, status: string, start: number, end: number][] = [
    ["s40", "Sprint 40", "Close out HIPAA annual refresh and hand off to the LMS team.", "completed", -31, -18],
    ["s41", "Sprint 41", "Security Awareness storyboard to SME review; New Manager prototype 1.", "completed", -17, -4],
    ["s42", "Sprint 42", "Address round-1 SME feedback, start Module 2 build, and finish the video shoot.", "active", -3, 10],
    ["s43", "Sprint 43", "Alpha build of Security Awareness; New Manager pilot prep.", "planned", 11, 24],
  ];
  sprintIds = {};
  for (const [key, name, goal, status, s, e] of SPRINTS) {
    sprintIds[key] = (await prisma.sprint.create({ data: { workspaceId: ws.id, name, goal, status, startDate: day(s, 13), endDate: day(e) } })).id;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Project 1 — Security Awareness 2027 Refresh (ADDIE, mid-Develop, the "hero" project)
  // ════════════════════════════════════════════════════════════════════════════
  const sec = await makeProject({
    name: "Security Awareness 2027 Refresh",
    description:
      "Annual security awareness program, rebuilt around how people actually get compromised: MFA fatigue, QR-code phishing, and deepfake voice. Replaces the 2025 slide-deck course with a scenario-driven module and a 2-minute micro-video series.",
    methodology: "ADDIE",
    sprints: true,
    age: 74,
    phases: [
      ["Analyze", "done", -74, -55],
      ["Design", "done", -54, -20],
      ["Develop", "in_progress", -19, 18],
      ["Implement", "not_started", 19, 33],
      ["Evaluate", "not_started", 34, 90],
    ],
  });
  await makeBoard({
    name: "Security Awareness 2027",
    prefix: "SEC",
    projectId: sec.project.id,
    cards: [
      {
        title: "Audit 2025 course analytics and help-desk phishing tickets",
        col: "Done", age: 72, who: ["priya"], labels: ["Compliance"], sprint: "s40", files: ["audit"],
        desc: doc(p("Pull completion, quiz-item difficulty, and the last 12 months of phishing-report tickets. We want the ", b("gap between what people pass and what they actually do"), ".")),
        comments: [["priya", doc(p("Item 7 (\"spot the fake URL\") had a 94% pass rate, but 31% of real-world reports were for exactly that pattern. The quiz is too easy.")), 60]],
      },
      {
        title: "SME interview: Security Operations incident trends",
        col: "Done", age: 66, who: ["priya"], smes: ["marcus"], sprint: "s40", files: ["smeNotes"],
        comments: [["marcus", doc(p("Biggest shift this year is MFA-fatigue push spam. Please make that its own scenario, not a footnote.")), 62]],
      },
      {
        title: "Write learning objectives and get Security sign-off",
        col: "Done", age: 58, who: ["priya"], smes: ["marcus"], sprint: "s41",
        subtasks: [["Draft 6 objectives against Bloom levels", true], ["Map objectives to incident data", true], ["Security sign-off", true]],
      },
      {
        title: "Storyboard: Module 1 – Why attackers log in instead of breaking in",
        col: "In review", ref: "sb-card", age: 40, due: 1, who: ["priya"], smes: ["marcus"], sprint: "s42", labels: ["High priority", "SME input needed"],
        desc: doc(
          p("Full storyboard is linked as a project deliverable. Round 1 came back with ", b("changes requested"), " — mostly technical accuracy on the MFA push flow."),
          ul(["Tighten screen 6 narration (MFA fatigue) per Marcus"], ["Replace the generic login screenshot with our real SSO page"], ["Add the QR-code lure as its own knowledge check"]),
        ),
        comments: [
          ["marcus", doc(p("Screen 6 narration implies MFA push is unsafe in general. It isn't, ", i("unexpected"), " pushes are. Small wording fix, big difference.")), 6],
          ["priya", doc(p(m("marcus"), " fixed in round 2. Can you look again before Thursday? I also added a screen on number matching.")), 2],
          ["maya", doc(p("Nice catch on number matching. ", m("hannah"), " this will need a new visual for screen 7.")), 1],
        ],
      },
      {
        title: "Visual design: scenario character set + office environments",
        col: "In progress", age: 21, due: 4, who: ["hannah"], sprint: "s42", labels: ["Accessibility"], files: ["mockHome", "styleGuide"],
        desc: doc(p("Four characters, three environments (open office, home office, airport lounge). Must hit ", b("4.5:1 contrast"), " for any text over imagery.")),
        subtasks: [["Character turnarounds", true], ["Environment backgrounds", true], ["Alt-text pass for every illustration", false], ["Dark-mode variants", false]],
        comments: [["hannah", doc(p("Landing mockup attached. Moving the Report button to the top right so it matches the real mail client.")), 3]],
      },
      {
        title: "Phishing simulation interaction: inbox triage (Storyline)",
        col: "In progress", ref: "sim-card", age: 18, due: 7, who: ["sam"], smes: ["marcus"], sprint: "s42", labels: ["High priority"], files: ["mockQuiz"],
        desc: doc(
          p("Learner gets a simulated inbox with 8 messages and must report, delete, or trust each one. Branching feedback per choice."),
          ol(["Build inbox shell + message variables"], ["Wire feedback layers"], ["Hook score to the module quiz"]),
        ),
        subtasks: [["Inbox shell", true], ["8 message variants", true], ["Feedback layers", false], ["Keyboard-only pass", false]],
        comments: [
          ["sam", doc(p("Inbox shell is done. Branching sketch is on the linked whiteboard.")), 4],
          ["diego", doc(p(m("sam"), " please make sure the feedback layers can be reached by keyboard. Last year's sim trapped focus on layer close.")), 3],
        ],
      },
      {
        title: "Micro-video series: script 3 social-engineering episodes",
        col: "In progress", age: 25, due: 2, who: ["jordan"], sprint: "s42", labels: ["Video"], files: ["vo", "captions"],
        subtasks: [["Ep 1: Friday wire transfer", true], ["Ep 2: The helpful IT caller", true], ["Ep 3: Deepfake voicemail", false]],
      },
      {
        title: "Knowledge checks: rewrite 8 items to scenario format",
        col: "To do", age: 14, due: 9, who: ["priya"], sprint: "s42",
        desc: doc(p("Every item should present a realistic message and ask what you'd ", i("do"), ", not what a term means.")),
      },
      {
        title: "Captioning and transcript for all video episodes",
        col: "To do", age: 12, due: 15, who: ["jordan"], sprint: "s43", labels: ["Accessibility", "Video"],
      },
      {
        title: "Translate learner-facing text: Spanish, Portuguese (BR), Japanese",
        col: "Backlog", age: 30, labels: ["Localization"], who: ["diego"],
        comments: [["diego", doc(p("Waiting on final text freeze. Vendor needs 10 business days.")), 9]],
      },
      {
        title: "Accessibility audit (WCAG 2.2 AA) before alpha",
        col: "Backlog", age: 28, labels: ["Accessibility"], who: ["sam"], sprint: "s43",
      },
      {
        title: "LMS: confirm SCORM 2004 completion rules with LMS admin",
        col: "Backlog", age: 9, labels: ["Blocked"], who: ["diego"],
        desc: doc(p("Blocked: LMS admin is out until next week. We need to know whether completion is \"passed\" or \"completed + passed\".")),
      },
      {
        title: "Pilot group recruitment (40 learners across 3 regions)",
        col: "Backlog", age: 7, who: ["maya"], due: 20,
      },
    ],
  });
  const secObj = await objectives(sec.project.id, [
    ["Identify the five indicators of a credential-phishing email in a realistic inbox.", "understand"],
    ["Report a suspected phishing message using the Report Phish button within 5 minutes of noticing it.", "apply"],
    ["Differentiate an expected MFA push from an MFA-fatigue attack, and respond correctly to each.", "analyze"],
    ["Evaluate a QR code in an email or a physical poster for signs of a lure before scanning it.", "evaluate"],
    ["Apply the call-back verification procedure to any payment or credential request received by phone.", "apply"],
    ["Explain why reporting quickly matters more than being certain.", "understand"],
  ]);
  const secDel = await deliverables(sec.project.id, sec.phaseId, [
    { key: "sb", name: "Module 1 storyboard", type: "storyboard", status: "in_review", phase: "Design", card: "sb-card" },
    { key: "sim", name: "Inbox triage simulation (Storyline)", type: "other", status: "in_progress", phase: "Develop", card: "sim-card" },
    { key: "quiz", name: "Scenario-based knowledge checks", type: "assessment", status: "in_progress", phase: "Develop" },
    { key: "video", name: "Social engineering micro-videos (3 eps)", type: "video", status: "in_progress", phase: "Develop" },
    { key: "aid", name: "Report Phish quick-reference card", type: "job_aid", status: "complete", phase: "Design" },
    { key: "plan", name: "Evaluation plan (Kirkpatrick L1–L3)", type: "document", status: "not_started", phase: "Evaluate" },
  ]);
  await makeStoryboard({
    title: "Security Awareness 2027 – Module 1",
    description: "Why attackers log in instead of breaking in. A scenario-driven module following one realistic week of attacks against a fictional employee.",
    status: "in_review",
    deliverableId: secDel.sb,
    objectiveIds: secObj,
    screens: [
      {
        title: "Welcome: one week, five attacks", type: "intro", teaches: [5],
        text: doc(h(2, "One week. Five attacks. You're the target."), p("Follow Alex through an ordinary week, and decide what you'd do at each moment.")),
        vo: paras("Most breaches don't start with hacking. They start with someone being helpful, rushed, or tired. This week, that someone is Alex. Let's see how Alex does — and how you'd do."),
        visual: paras("Alex at a standing desk, coffee, Monday light. Subtle calendar overlay showing Mon–Fri with five red dots."),
        dev: paras("Use the title-card template from the 2027 style guide. Auto-advance disabled; Start button only."),
      },
      {
        title: "Attackers log in, they don't break in", type: "content", teaches: [0, 5],
        text: doc(p(b("80%"), " of last year's incidents started with a valid username and password."), ul(["Phishing for credentials"], ["Reused passwords"], ["Approving a push you didn't start"])),
        vo: paras("Movies show hackers typing furiously. Real attackers just sign in — with credentials someone handed them. So the question isn't whether our walls are strong. It's whether you'll hand over a key."),
        visual: paras("Split screen: Hollywood hacker (desaturated, crossed out) vs. a calm login page with a green check."),
      },
      {
        title: "Monday: the shared-document email", type: "interaction", teaches: [0],
        text: doc(p("Alex receives: ", i("\"Q3 bonus structure – review before Friday.\""), " Click everything that looks suspicious.")),
        vo: paras("Monday, 9:14 a.m. A document share from someone in Finance. Take a close look — what's off?"),
        interaction: doc(p("Hotspot interaction on the email. Five hotspots:"), ol(["Sender domain (finance-portal-docs.co)"], ["Urgency in subject"], ["Generic greeting"], ["Link text vs. hover URL mismatch"], ["Login page requesting password again"]), p("Feedback per hotspot; learner can't continue until 3 of 5 are found.")),
        dev: paras("Storyline hotspot layer. Hover URL must render as a tooltip for keyboard users too (focus, not only mouse hover)."),
      },
      {
        title: "Five tells of a credential phish", type: "content", teaches: [0],
        text: doc(ol(["The sender's domain is close, but not ours"], ["It's urgent or emotional"], ["The link text and the real URL differ"], ["It asks you to sign in again"], ["It came out of nowhere"])),
        vo: paras("You don't need to spot all five. Two is enough to stop and report."),
      },
      {
        title: "Tuesday: 14 push notifications at 11 p.m.", type: "video", teaches: [2],
        text: doc(p("Watch: what happens when Alex just wants the buzzing to stop.")),
        vo: paras("Tuesday night. Alex's phone buzzes. And buzzes. Fourteen sign-in requests. Alex didn't start any of them."),
        visual: paras("Embedded micro-video, episode 2 (45 s). Phone on a nightstand lighting up repeatedly. Captions on by default."),
        dev: paras("Video player: captions default ON, transcript link under the player, no autoplay."),
      },
      {
        title: "Expected push vs. MFA fatigue", type: "content", teaches: [2],
        text: doc(p(b("Expected:"), " you just signed in, and the number on screen matches the app."), p(b("Attack:"), " you didn't sign in, it repeats, or there's no number to match.")),
        vo: paras("A push you started is fine to approve. A push you didn't start is an attacker standing at the door with your password. Deny it, and report it — even at 11 p.m."),
        visual: paras("Two phone mockups side by side. Left: number match 47 shown on laptop and phone (green). Right: repeated prompts, no number (red)."),
        interaction: paras("Round 2 change per Marcus: emphasize 'unexpected' rather than implying MFA is unsafe."),
      },
      {
        title: "Number matching, explained", type: "content", teaches: [2],
        text: doc(p("When you sign in, your screen shows a number. Type that number into the app. ", b("No number? Don't approve."))),
        vo: paras("Number matching is how you know the request is yours. If you can't see a number on your own screen, it isn't your sign-in."),
        visual: paras("NEW in round 2 — Hannah to design. Laptop + phone, matching number highlighted."),
      },
      {
        title: "Knowledge check: the 11 p.m. push", type: "knowledge_check", teaches: [2],
        text: doc(p("It's late. You get a sign-in request you didn't start. What do you do?")),
        interaction: doc(ul(["Approve it so it stops (incorrect: feedback explains the attacker now has access)"], ["Ignore it (partial: the attacker keeps trying)"], [b("Deny it and report it"), " (correct)"])),
      },
      {
        title: "Wednesday: the QR code in the break room", type: "interaction", teaches: [3],
        text: doc(p("A poster: ", i("\"New parking policy — scan to register your plate by Friday.\""))),
        vo: paras("QR codes hide where they go. That's what makes them useful to attackers — and what makes them worth a second look."),
        interaction: paras("Drag-and-drop: sort 6 QR scenarios into Scan / Verify first / Report. Includes an email-embedded QR and a sticker placed over a legitimate one."),
        dev: paras("Drag-and-drop needs a keyboard alternative: a select menu per item."),
      },
      {
        title: "Thursday: the helpful IT caller", type: "video", teaches: [4],
        vo: paras("Thursday. Someone from IT calls: there's a problem with Alex's account, and they need the code that just arrived by text."),
        visual: paras("Micro-video episode 2. Split-screen phone call. The caller's background noise sounds like a real help desk."),
      },
      {
        title: "The call-back rule", type: "content", teaches: [4],
        text: doc(p(b("Never act on an inbound request for money, codes, or access."), " Hang up and call back using a number you already trust.")),
        vo: paras("Real IT never needs your code. Real finance can wait three minutes for you to call back. Attackers can't."),
      },
      {
        title: "Friday 4:52 p.m.: the CFO's urgent wire", type: "interaction", teaches: [4, 5],
        text: doc(p("A voicemail that sounds exactly like the CFO asks Alex to wire $40,000 before the bank closes.")),
        interaction: paras("Branching scenario, 3 decision points. Paths: comply → loss; delay and verify → saved; report → saved + praised. Each branch shows the consequence."),
        dev: paras("Deepfake audio clip is synthetic; clearly labeled as a simulation in the transcript."),
      },
      {
        title: "Report fast, not perfectly", type: "content", teaches: [1, 5],
        text: doc(p("The Report Phish button is at the top right of your mail client. ", b("Reporting a real email you weren't sure about is a win, not a mistake."))),
        vo: paras("Security would rather get ten false alarms than miss one real attack. Reporting takes two clicks. Being right can wait."),
        visual: paras("Annotated screenshot of the real mail client with the Report button circled. Use the production UI per Marcus."),
      },
      {
        title: "Practice: triage Alex's inbox", type: "assessment", teaches: [0, 1],
        text: doc(p("Eight messages. Report, delete, or trust each one.")),
        interaction: paras("The Storyline inbox simulation (see the linked board card). Score carries into the module quiz."),
      },
      {
        title: "Summary + your three habits", type: "summary", teaches: [1, 5],
        text: doc(ol(["Slow down when it's urgent"], ["No number, no approval"], ["When in doubt, report it"])),
        vo: paras("Three habits. That's all. Alex had a rough week — but by Friday, Alex was the one who stopped the wire."),
      },
    ],
  });
  await assessments(sec.project.id, secObj, [
    ["An email from 'IT-Helpdesk@yourcompany-support.com' asks you to re-verify your password. Which TWO details are the strongest warning signs?", "multiple_choice", [0]],
    ["You reported an email that turned out to be legitimate. Was that the right call?", "true_false", [5]],
    ["At 11 p.m. you receive an MFA push you didn't start. What do you do?", "scenario", [2]],
    ["A coworker forwards a QR code to register for the new parking app. What do you check first?", "multiple_choice", [3]],
    ["Your 'CFO' leaves an urgent voicemail asking for a wire transfer. Describe your next two actions.", "short_answer", [4]],
    ["Which button reports a suspicious email, and where is it?", "multiple_choice", [1]],
    ["Number matching shows 47 on your laptop and 47 in the app. Approve or deny?", "scenario", [2]],
  ]);
  await milestones(sec.project.id, [
    ["Analysis report signed off", -55, true],
    ["Objectives approved by Security", -40, true],
    ["Storyboard round 1 sent to SME", -10, true],
    ["Storyboard sign-off", 3, false],
    ["Alpha build", 18, false],
    ["Pilot (40 learners)", 26, false],
    ["Go-live to all staff", 33, false],
  ]);
  const OLD_MFA_VO = "MFA push notifications can be abused by attackers. To be safe, deny push requests whenever you're unsure, and call IT before approving anything.";
  const secR1 = await review(secDel.sb, "marcus", "priya", 1, "changes_requested", -7,
    "Mostly solid. Screen 6 makes MFA sound unsafe overall; please reframe around unexpected prompts. Use our real SSO page in screenshots, and add number matching. QR section is great.", 12,
    // Round 1 predates the fixes: no number-matching screen, and the old MFA narration.
    (snap) => ({
      ...snap,
      screens: snap.screens
        .filter((x) => x.title !== "Number matching, explained")
        .map((x) => (x.title === "Expected push vs. MFA fatigue" ? { ...x, fields: { ...x.fields, narration: paras(OLD_MFA_VO) } } : x)),
    }));
  await reviewComments(secR1, [
    {
      by: "marcus", ago: 9, anchor: { screen: "Expected push vs. MFA fatigue", field: "narration", quote: "MFA push notifications can be abused by attackers" },
      body: "This makes MFA sound unsafe in general — it isn't. Unexpected prompts are the problem. People will start ignoring push entirely if we teach this.",
      status: "resolved", resolvedBy: "priya", note: "Reframed around unexpected prompts in round 2.",
      replies: [{ by: "priya", ago: 8, body: "Agreed — rewriting around 'a push you didn't start'." }],
    },
    {
      by: "marcus", ago: 9, anchor: { screen: "Report fast, not perfectly", field: "visualNotes" },
      body: "Use a screenshot of our real mail client with the Report button. A mock will confuse people when they go looking for it.",
      status: "resolved", resolvedBy: "priya", note: "Swapped to the production UI.",
    },
    {
      by: "marcus", ago: 9, body: "Please add number matching. It's the fix we rolled out in June and it's the single best defense against push fatigue.",
      status: "resolved", resolvedBy: "priya", note: "Added as screen 7.",
    },
    {
      by: "marcus", ago: 9, anchor: { screen: "Wednesday: the QR code in the break room", field: "interactionNotes" },
      body: "Love the sticker-over-a-real-QR scenario. Keep it.",
      status: "wont_fix", resolvedBy: "priya", note: "Nothing to change — keeping as is.",
    },
  ]);
  const secR2 = await review(secDel.sb, "marcus", "priya", 2, "in_review", 1, null, 2);
  await reviewComments(secR2, [
    {
      by: "marcus", ago: 1, anchor: { screen: "Number matching, explained", field: "narration", quote: "If you can't see a number on your own screen" },
      body: "Good addition. Maybe say \"two-digit number\" so people know exactly what to look for.",
      replies: [{ by: "priya", ago: 1, body: "Will do — small tweak, I'll update it before sign-off." }],
    },
    {
      by: "hannah", ago: 1, anchor: { screen: "Number matching, explained", field: "visualNotes" },
      body: "The laptop + phone mock for this screen is in progress — I'll swap it in before sign-off.",
    },
    {
      by: "maya", ago: 0, body: "Marcus — can we get round 2 back by Thursday? Pilot recruiting starts next week.",
    },
  ]);
  // Round 2 also went to outside counsel, who has no Tavoro account: a guest link.
  await guestReviewer("dana", secR2, {
    name: "Dana Whitfield", email: "dana.whitfield@example.com", status: "in_review", seenHoursAgo: 5,
  });
  await reviewComments(secR2, [
    {
      by: "guest:dana", ago: 0, anchor: { screen: "Expected push vs. MFA fatigue", field: "narration", quote: "Deny it, and report it — even at 11 p.m." },
      body: "Good. Please also say that nobody gets in trouble for reporting a prompt they approved by mistake. Policy wants early reports, not hidden ones.",
      replies: [{ by: "priya", ago: 0, body: "Thanks Dana, adding a line to this screen. Would \"You won't be in trouble for reporting it\" work?" }],
    },
    {
      by: "guest:dana", ago: 0, body: "Overall this reads well and matches the acceptable-use policy. One wording note pinned above.",
    },
  ]);
  await review(secDel.aid, "elena", "priya", 1, "approved", -20, "Approved. Clear and accurate. Love that it fits on one card.", 24);

  // The Storyline simulation is reviewed as a published PDF (phase 3 file review):
  // round 1 found problems, round 2 is a new export, out with Marcus and the admin.
  const SIM_SLIDES = (v: 1 | 2) => [
    { title: "Inbox triage: a Tuesday morning", body: ["Twelve messages arrived overnight.", "Some are real. Some are not.", "Triage them the way you would at work."], button: "Start" },
    { title: "Message 1 of 12", body: ["From: IT Service Desk <it-support@c0ntoso-help.com>", "Subject: Password expires in 2 hours", v === 1 ? "Click here to keep your password." : "Keep your password: sign in at the link below."], button: "Report phish" },
    { title: "Message 4 of 12", body: ["From: Dana (Legal) <dana@contoso.com>", "Subject: Updated NDA, please countersign", "Attachment: NDA_v3.pdf"], button: "Looks fine" },
    { title: v === 1 ? "You got 9 of 12" : "Nice work: 9 of 12", body: ["You reported 4 of 5 phishing messages.", v === 1 ? "You missed: the fake invoice." : "The one you missed: the fake invoice. Here's the tell:", v === 1 ? "" : "the sender's domain is one letter off."], button: "Review answers" },
  ];
  const simR1 = await review(secDel.sim, "marcus", "priya", 1, "changes_requested", -9,
    "The lookalike domain is too obvious on message 1, and the results screen should teach, not just score.", 14, undefined,
    { name: "inbox-triage-sim-v1.pdf", mime: "application/pdf", bytes: slidesPdf(SIM_SLIDES(1)) });
  await reviewComments(simR1, [
    {
      by: "marcus", ago: 12, pin: { page: 2, x: 0.07, y: 0.17, w: 0.62, h: 0.06 },
      body: "'c0ntoso' with a zero is too easy. Real ones swap a letter, e.g. contoso-hep.com.",
      status: "resolved", resolvedBy: "priya", note: "Swapped to contoso-helpdesk.co in v2.",
    },
    {
      by: "marcus", ago: 12, pin: { page: 4, x: 0.3, y: 0.32 },
      body: "Don't just score them. Show the tell for whatever they missed.",
      status: "resolved", resolvedBy: "priya", note: "Results now explain the missed message.",
    },
  ]);
  const simFile2 = { name: "inbox-triage-sim-v2.pdf", mime: "application/pdf", bytes: slidesPdf(SIM_SLIDES(2)) };
  const simR2 = await review(secDel.sim, "marcus", "priya", 2, "in_review", 3, null, 3, undefined, simFile2);
  await prisma.reviewCycle.create({
    data: {
      deliverableId: secDel.sim, roundId: simR2.id, reviewerId: users.admin.id, requestedById: users.priya.id,
      round: 2, status: "requested", dueDate: day(3), createdAt: day(-3, 10),
    },
  });
  await reviewComments(simR2, [
    {
      by: "marcus", ago: 1, pin: { page: 4, x: 0.07, y: 0.12, w: 0.55, h: 0.2 },
      body: "Much better. Can the 'tell' line be bold? It's the most important sentence in the module.",
    },
    { by: "marcus", ago: 1, pin: { page: 1, x: 0, y: 0, w: 1, h: 1 }, body: "Title slide works. No notes." },
    {
      by: "marcus", ago: 0, pin: { page: 2, x: 0.065, y: 0.285, w: 0.5, h: 0.045, quote: "Keep your password: sign in at the link below." },
      body: "Real phish rarely says \"sign in at the link\" this plainly. Try \"Action required: verify your account to avoid interruption.\"",
    },
  ]);
  await review(secDel.quiz, "admin", "priya", 1, "requested", 6, null, 1);
  await time(sec.project.id, [
    ["priya", 240, 70, "Analytics + ticket audit"], ["priya", 90, 66, "SME interview w/ Marcus"], ["priya", 180, 58, "Objectives drafting"],
    ["priya", 360, 30, "Storyboard draft, screens 1–8", secDel.sb], ["priya", 300, 26, "Storyboard draft, screens 9–15", secDel.sb],
    ["priya", 120, 5, "Round-1 revisions", secDel.sb], ["hannah", 420, 20, "Character set"], ["hannah", 300, 8, "Environments + mockups"],
    ["sam", 480, 15, "Inbox shell", secDel.sim], ["sam", 360, 4, "Message variants", secDel.sim], ["jordan", 240, 22, "Episode scripts", secDel.video],
    ["jordan", 300, 6, "Ep 1–2 shoot", secDel.video], ["diego", 60, 9, "Localization vendor scoping"], ["maya", 90, 3, "Pilot planning"],
  ]);

  // ════════════════════════════════════════════════════════════════════════════
  // Project 2 — New Manager Essentials (SAM, iterative design)
  // ════════════════════════════════════════════════════════════════════════════
  const nme = await makeProject({
    name: "New Manager Essentials",
    description:
      "A six-week blended program for first-time people managers: microlearning, practice conversations, and a peer cohort. Built iteratively with a pilot cohort from Customer Success.",
    methodology: "SAM",
    sprints: true,
    age: 45,
    phases: [
      ["Preparation", "done", -45, -30],
      ["Iterative Design", "in_progress", -29, 7],
      ["Iterative Development", "not_started", 8, 50],
    ],
  });
  await makeBoard({
    name: "New Manager Essentials",
    prefix: "NME",
    projectId: nme.project.id,
    cards: [
      { title: "Savvy start workshop with 6 new managers", col: "Done", age: 40, who: ["diego"], sprint: "s41", smes: ["tom"] },
      {
        title: "Prototype 1: the first 1:1 conversation (branching)", col: "In review", age: 20, due: 3, who: ["diego"], smes: ["tom"], sprint: "s42", files: ["mockMgr"],
        comments: [
          ["tom", doc(p("Branch 2 feels preachy. Real managers would just say 'tell me more'. Can we model that?")), 5],
          ["diego", doc(p(m("tom"), " yes. Rewriting branch 2 to model curiosity first and advice later.")), 4],
        ],
      },
      { title: "Prototype 2: giving feedback that lands (SBI model)", col: "In progress", age: 10, due: 8, who: ["diego", "hannah"], sprint: "s42", subtasks: [["Script", true], ["Visual comps", false], ["Practice rubric", false]] },
      { title: "Cohort calendar + facilitator guide outline", col: "To do", age: 8, due: 12, who: ["maya"], sprint: "s43" },
      { title: "Peer-coaching circle format", col: "Backlog", age: 6, who: ["diego"], labels: ["Quick win"] },
      { title: "Decide: live practice vs. AI role-play partner", col: "Backlog", age: 5, labels: ["Blocked", "SME input needed"], desc: doc(p("Need a decision from HR leadership. Blocked until the HR policy on recording practice sessions is published.")) },
    ],
  });
  const nmeObj = await objectives(nme.project.id, [
    ["Plan a first 1:1 with a new direct report using the 5-question agenda.", "apply"],
    ["Deliver situation–behavior–impact (SBI) feedback in a practice conversation.", "apply"],
    ["Diagnose whether a performance gap is a skill, will, or environment issue.", "analyze"],
    ["Design a 30-day onboarding plan for a new team member.", "create"],
    ["Recognize the signs of burnout in a direct report.", "understand"],
  ]);
  const nmeDel = await deliverables(nme.project.id, nme.phaseId, [
    { key: "sb", name: "Prototype storyboards", type: "storyboard", status: "in_progress", phase: "Iterative Design" },
    { key: "guide", name: "Facilitator guide", type: "document", status: "not_started", phase: "Iterative Development" },
    { key: "aid", name: "1:1 agenda job aid", type: "job_aid", status: "in_review", phase: "Iterative Design" },
  ]);
  await makeStoryboard({
    title: "New Manager Essentials – Prototypes",
    description: "Rapid prototypes for SAM iteration 2. Low-fidelity on purpose.",
    status: "draft",
    deliverableId: nmeDel.sb,
    objectiveIds: nmeObj,
    screens: [
      { title: "You're a manager now. Now what?", type: "intro", teaches: [0], text: doc(p("Your first week as a manager, in six conversations.")), vo: paras("Nobody hands you a manual. So we wrote one — in the shape of the conversations you're about to have.") },
      { title: "The first 1:1", type: "interaction", teaches: [0], text: doc(p("Jamie joined your team on Monday. It's your first 1:1. Choose your opener.")), interaction: paras("Branching: 3 openers × 2 follow-ups. Model curiosity first (per Tom's feedback).") },
      { title: "The 5-question agenda", type: "content", teaches: [0], text: doc(ol(["What's on your mind?"], ["What's going well?"], ["Where are you stuck?"], ["How can I help?"], ["What should we talk about next time?"])) },
      { title: "SBI: feedback that lands", type: "content", teaches: [1], text: doc(p(b("Situation"), " – ", b("Behavior"), " – ", b("Impact"), ". Specific, observable, and about the work, not the person.")) },
      { title: "Practice: rewrite vague feedback", type: "knowledge_check", teaches: [1], interaction: paras("Learner rewrites 'You need to be more proactive' using SBI. Model answer revealed after submit.") },
      { title: "Skill, will, or environment?", type: "interaction", teaches: [2], interaction: paras("Sort 6 short scenarios. Feedback explains why training only fixes one of the three.") },
      { title: "Spotting burnout early", type: "video", vo: paras("Burnout rarely announces itself. It shows up as small changes — camera off, shorter replies, missed standups.") },
      { title: "Wrap-up + your first-90-days plan", type: "summary", teaches: [3], text: doc(p("Download the 30-60-90 template and draft your first plan with your own manager.")) },
    ],
  });
  await assessments(nme.project.id, nmeObj, [
    ["Rewrite this feedback using SBI: 'Your reports are sloppy.'", "short_answer", [1]],
    ["A strong performer suddenly misses deadlines. Is it skill, will, or environment? Explain.", "scenario", [2]],
    ["Which is NOT one of the five 1:1 agenda questions?", "multiple_choice", [0]],
  ]);
  await milestones(nme.project.id, [
    ["Savvy start complete", -38, true],
    ["Prototype 1 reviewed", -2, true],
    ["Prototype 2 reviewed", 9, false],
    ["Pilot cohort kickoff", 35, false],
  ]);
  await review(nmeDel.aid, "tom", "diego", 1, "in_review", 2, null, 3);
  await time(nme.project.id, [
    ["diego", 300, 40, "Savvy start prep + facilitation"], ["diego", 420, 18, "Prototype 1"], ["diego", 240, 6, "Prototype 1 revisions"],
    ["hannah", 180, 7, "Prototype 2 visual comps"], ["maya", 60, 2, "Cohort logistics"],
  ]);

  // ════════════════════════════════════════════════════════════════════════════
  // Project 3 — HIPAA Privacy Annual Compliance (completed, restricted to Compliance WG)
  // ════════════════════════════════════════════════════════════════════════════
  const hipaa = await makeProject({
    name: "HIPAA Privacy & Security – Annual Training 2026",
    description: "Annual required training for all staff with access to PHI. Content owned by the Compliance Working Group; restricted visibility.",
    methodology: "ADDIE",
    status: "completed",
    age: 140,
    groups: ["Compliance Working Group"],
    phases: [
      ["Analyze", "done", -140, -128],
      ["Design", "done", -127, -100],
      ["Develop", "done", -99, -60],
      ["Implement", "done", -59, -30],
      ["Evaluate", "done", -29, -10],
    ],
  });
  const hipObj = await objectives(hipaa.project.id, [
    ["Identify the 18 HIPAA identifiers in a sample record.", "remember"],
    ["Apply the minimum-necessary standard when sharing PHI.", "apply"],
    ["Report a suspected privacy incident within one business day.", "apply"],
  ]);
  const hipDel = await deliverables(hipaa.project.id, hipaa.phaseId, [
    { key: "sb", name: "Course storyboard", type: "storyboard", status: "complete", phase: "Design" },
    { key: "quiz", name: "Final assessment (80% to pass)", type: "assessment", status: "complete", phase: "Develop" },
    { key: "report", name: "Completion + evaluation report", type: "document", status: "complete", phase: "Evaluate" },
  ]);
  await makeStoryboard({
    title: "HIPAA Privacy & Security 2026",
    description: "Approved by Compliance on schedule. Locked for the annual cycle.",
    status: "approved",
    deliverableId: hipDel.sb,
    objectiveIds: hipObj,
    groups: ["Compliance Working Group"],
    screens: [
      { title: "Why privacy is personal", type: "intro", teaches: [1], vo: paras("Every record is a person. Let's start there.") },
      { title: "The 18 identifiers", type: "content", teaches: [0], text: doc(p("Names, dates, phone numbers, emails, SSNs, record numbers… and 12 more.")) },
      { title: "Minimum necessary", type: "interaction", teaches: [1], interaction: paras("Three requests; learner chooses what to share.") },
      { title: "When something goes wrong", type: "content", teaches: [2], text: doc(p("Report to the Privacy Office within one business day. No blame for good-faith reports.")) },
      { title: "Final assessment", type: "assessment", teaches: [0, 1, 2] },
    ],
  });
  await assessments(hipaa.project.id, hipObj, [
    ["Which of these is a HIPAA identifier? (select all)", "multiple_choice", [0]],
    ["A colleague asks for a patient's full chart to confirm an appointment time. What do you share?", "scenario", [1]],
    ["How soon must you report a suspected privacy incident?", "multiple_choice", [2]],
  ]);
  await milestones(hipaa.project.id, [["Compliance sign-off", -100, true], ["Launch", -59, true], ["95% completion", -31, true], ["Evaluation report", -10, true]]);
  await review(hipDel.sb, "elena", "priya", 1, "changes_requested", -112, "Identifier list must match the current regulation text exactly.", 116);
  await review(hipDel.sb, "elena", "priya", 2, "approved", -104, "Approved.", 108);
  await review(hipDel.report, "maya", "priya", 1, "approved", -11, "Great outcome: 97.2% completion, average score 91%.", 13);
  await time(hipaa.project.id, [["priya", 600, 120, "Design + storyboard"], ["sam", 720, 80, "Build"], ["elena", 180, 110, "SME review"], ["priya", 240, 12, "Evaluation report"]]);

  // ════════════════════════════════════════════════════════════════════════════
  // Project 4 — Customer Academy: Device Management (CUSTOM, on hold)
  // ════════════════════════════════════════════════════════════════════════════
  const dev = await makeProject({
    name: "Customer Academy: Device Management Fundamentals",
    description: "External customer course for IT admins. On hold until the product's new policy engine ships — screenshots would be outdated on launch day.",
    methodology: "CUSTOM",
    status: "on_hold",
    age: 50,
    phases: [
      ["Discovery", "done", -50, -36],
      ["Content build", "in_progress", -35, null],
      ["Beta with 5 customers", "not_started", null, null],
      ["Launch", "not_started", null, null],
    ],
  });
  await makeBoard({
    name: "Device Management course",
    prefix: "DMC",
    projectId: dev.project.id,
    cards: [
      { title: "Discovery calls with 5 customer admins", col: "Done", age: 46, who: ["diego"], smes: ["tom"] },
      { title: "Module outline: enrollment, policies, patching, reporting", col: "Done", age: 38, who: ["diego"] },
      {
        title: "Record product walkthroughs", col: "In progress", age: 30, who: ["jordan"], labels: ["Blocked", "Video"],
        desc: doc(p("On hold: the policy engine UI is changing in the next release. Recording now means re-recording in 6 weeks.")),
        comments: [["tom", doc(p("Release is slipping about 2 weeks. I'll ping here when the UI is frozen.")), 11]],
      },
      { title: "Hands-on lab environment (sandbox tenants)", col: "Backlog", age: 25, labels: ["SME input needed"] },
    ],
  });
  const devDel = await deliverables(dev.project.id, dev.phaseId, [
    { key: "sb", name: "Course storyboard", type: "storyboard", status: "in_progress", phase: "Content build" },
    { key: "lab", name: "Sandbox lab guide", type: "job_aid", status: "not_started", phase: "Content build" },
  ]);
  await makeStoryboard({
    title: "Device Management Fundamentals",
    description: "Draft. Paused at screen 4 pending the policy-engine UI freeze.",
    status: "draft",
    deliverableId: devDel.sb,
    screens: [
      { title: "Welcome, admins", type: "intro" },
      { title: "Enrolling your first device", type: "video", vo: paras("Let's enroll a Mac and a Windows laptop side by side.") },
      { title: "Policies: the building blocks", type: "content" },
      { title: "Patch management", type: "content", dev: paras("PAUSED — UI changing in the next release.") },
    ],
  });
  await milestones(dev.project.id, [["Discovery readout", -36, true], ["Beta start", 45, false]]);

  // ════════════════════════════════════════════════════════════════════════════
  // Intake → Projects 5 & 6 (converted from requests)
  // ════════════════════════════════════════════════════════════════════════════
  const incl = await makeProject({
    name: "Inclusive Leadership Microlearning Series",
    description: "Eight 5-minute lessons on inclusive meeting habits, decision-making, and feedback. Requested by People team via intake.",
    methodology: "SAM",
    age: 12,
    phases: [
      ["Preparation", "in_progress", -10, 6],
      ["Iterative Design", "not_started", 7, 30],
      ["Iterative Development", "not_started", 31, 70],
    ],
  });
  await objectives(incl.project.id, [
    ["Apply round-robin and silent-start techniques to run a meeting where every voice is heard.", "apply"],
    ["Evaluate a team decision for affinity bias using the 3-question check.", "evaluate"],
  ]);
  await milestones(incl.project.id, [["Kickoff with People team", -9, true], ["Content outline approved", 6, false]]);
  await deliverables(incl.project.id, incl.phaseId, [{ key: "outline", name: "Series outline + lesson map", type: "document", status: "in_progress", phase: "Preparation" }]);

  const skp = await makeProject({
    name: "Sales Kickoff 2027: Product Certification",
    description: "Certification path for 220 sellers ahead of SKO. Converted from intake; analysis just starting.",
    methodology: "ADDIE",
    age: 4,
    phases: [
      ["Analyze", "in_progress", -3, 10],
      ["Design", "not_started", 11, 30],
      ["Develop", "not_started", 31, 60],
      ["Implement", "not_started", 61, 75],
      ["Evaluate", "not_started", 76, 120],
    ],
  });
  await milestones(skp.project.id, [["Stakeholder kickoff", 2, false], ["Certification blueprint", 10, false], ["SKO", 75, false]]);

  const INTAKE: {
    title: string; desc: string; requester: [string, string]; audience?: string; target?: number; status: string;
    impact?: number; effort?: number; assignee?: string; reason?: string; project?: string; age: number; byMember?: string; question?: string;
  }[] = [
    {
      title: "Training on the new expense policy", desc: "Finance is rolling out new expense rules on the 1st. Can we get something short in front of everyone before then?",
      requester: ["Rachel Kim", "rachel.kim@example.com"], audience: "All employees", target: 21, status: "submitted", age: 1,
    },
    {
      title: "Onboarding refresh for Support engineers", desc: "New hires take 9 weeks to hit full productivity. We think better onboarding could cut that to 6.",
      requester: ["Ben Adeyemi", "ben.adeyemi@example.com"], audience: "Support engineers (new hires, ~30/quarter)", target: 60, status: "submitted", age: 2,
    },
    {
      title: "AI tools acceptable-use course", desc: "Legal wants every employee to complete an acceptable-use module for generative AI tools within the quarter.",
      requester: ["Sofia Marchetti", "sofia.marchetti@example.com"], audience: "All employees", target: 45, status: "triaging", impact: 5, effort: 3, assignee: "priya", age: 6,
    },
    {
      title: "Presentation skills workshop for engineering leads", desc: "Several eng leads asked for help presenting to execs.",
      requester: ["Kenji Watanabe", "kenji.watanabe@example.com"], audience: "Engineering leads (~25)", status: "triaging", impact: 2, effort: 2, assignee: "diego", age: 8,
    },
    {
      title: "Product certification for SKO", desc: "Sellers need a certification path before Sales Kickoff. 220 sellers, must be done by SKO.",
      requester: ["Tom Alvarez", "tom.alvarez@example.com"], audience: "Sales (220)", target: 75, status: "converted", impact: 5, effort: 4, assignee: "maya", project: skp.project.id, age: 9, byMember: "tom",
    },
    {
      title: "Inclusive leadership microlearning", desc: "People team wants bite-sized inclusive leadership content for all managers, to support the new engagement survey actions.",
      requester: ["Amara Osei", "amara.osei@example.com"], audience: "People managers (~180)", target: 70, status: "converted", impact: 4, effort: 3, assignee: "maya", project: incl.project.id, age: 16,
    },
    {
      title: "Video series on our company values", desc: "Marketing wants a polished video per value for the careers page.",
      requester: ["Lena Fischer", "lena.fischer@example.com"], audience: "External candidates", status: "rejected", impact: 2, effort: 4, assignee: "maya",
      reason: "This is employer-brand marketing rather than a learning need. Redirected to the Brand team, who own careers-page video.", age: 20,
    },
    {
      title: "Excel for analysts: pivot tables & lookups", desc: "Analysts keep asking the same Excel questions. A short self-paced path would save the BI team hours each week.",
      requester: ["Omar Haddad", "omar.haddad@example.com"], audience: "Business analysts (~60)", target: 40, status: "needs_info", impact: 3, effort: 1, assignee: "sam", age: 11,
      question: "Which Excel version do the analysts use (Microsoft 365 or 2019)? And would a 30-minute live session work, or does it need to be self-paced?",
    },
  ];
  for (const [n, r] of INTAKE.entries()) {
    await prisma.intakeRequest.create({
      data: {
        workspaceId: ws.id, number: n + 1, requesterName: r.requester[0], requesterEmail: r.requester[1],
        requestedById: r.byMember ? users[r.byMember].id : null, title: r.title, description: r.desc,
        targetAudience: r.audience ?? null, targetDate: r.target === undefined ? null : day(r.target),
        impactScore: r.impact ?? null, effortScore: r.effort ?? null, status: r.status,
        assignedToId: r.assignee ? users[r.assignee].id : null, rejectionReason: r.reason ?? null,
        convertedProjectId: r.project ?? null, createdAt: day(-r.age, 10), updatedAt: day(-Math.max(r.age - 2, 0), 11),
        // A question to the requester starts the conversation.
        ...(r.question
          ? { messages: { create: { kind: "reply", authorId: users[r.assignee ?? "maya"].id, body: r.question, createdAt: day(-Math.max(r.age - 3, 0), 9) } } }
          : {}),
        ...(r.status === "converted" || r.status === "rejected" ? { decidedById: users.maya.id, decidedAt: day(-Math.max(r.age - 2, 0), 11) } : {}),
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Standalone boards
  // ════════════════════════════════════════════════════════════════════════════
  await makeBoard({
    name: "L&D Operations",
    prefix: "OPS",
    cards: [
      { title: "Renew authoring-tool licenses (Storyline ×6, Rise ×10)", col: "To do", due: 12, who: ["maya"], labels: ["High priority"], age: 15 },
      { title: "Quarterly course-catalog audit", col: "In progress", due: 5, who: ["priya"], age: 10, files: ["audit"], subtasks: [["Flag courses older than 2 years", true], ["Confirm owners", false], ["Retire list to Maya", false]] },
      { title: "Publish the 2027 visual style guide", col: "In review", who: ["hannah"], age: 18, files: ["styleGuide"], comments: [["maya", doc(p("Looks great. One ask: add a section on chart colors.")), 2]] },
      { title: "Set up the Spanish & Japanese translation vendor", col: "Backlog", who: ["diego"], labels: ["Localization"], age: 20 },
      { title: "Accessibility checklist for every deliverable", col: "Backlog", labels: ["Accessibility", "Quick win"], age: 9 },
      { title: "Team retro: Sprint 41", col: "Done", who: ["maya"], sprint: "s41", age: 4 },
      { title: "Overdue: archive the 2024 SharePoint training site", col: "To do", due: -6, who: ["sam"], age: 30, labels: ["Quick win"] },
    ],
  });
  await makeBoard({
    name: "Video Production Pipeline",
    prefix: "VID",
    columns: [
      { name: "Ideas", status: "Backlog" },
      { name: "Scripting", status: "To do" },
      { name: "Shooting", status: "In progress" },
      { name: "Editing", status: "In progress" },
      { name: "Captioning & QA", status: "In review" },
      { name: "Published", status: "Done" },
    ],
    cards: [
      { title: "SEC ep 1: The Friday wire transfer", col: "Editing", who: ["jordan"], labels: ["Video"], sprint: "s42", due: 3, age: 20, files: ["captions"] },
      { title: "SEC ep 2: The helpful IT caller", col: "Shooting", who: ["jordan"], labels: ["Video"], sprint: "s42", due: 6, age: 20 },
      { title: "SEC ep 3: Deepfake voicemail", col: "Scripting", who: ["jordan"], labels: ["Video"], sprint: "s43", age: 20, smes: ["marcus"] },
      { title: "Customer Academy: enrolling a device", col: "Ideas", labels: ["Blocked"], age: 30 },
      { title: "CEO welcome for new-hire onboarding", col: "Published", who: ["jordan"], age: 60 },
      { title: "HIPAA 2026 intro video", col: "Published", who: ["jordan"], labels: ["Compliance"], age: 110 },
      { title: "New Manager: burnout-signs vignette", col: "Captioning & QA", who: ["jordan"], labels: ["Accessibility", "Video"], due: 4, age: 14 },
    ],
  });
  await makeBoard({
    name: "Leadership Offsite Planning",
    groups: ["Design Team"],
    cards: [
      { title: "Book the venue for the Q1 leadership offsite", col: "In progress", who: ["maya"], due: 14, age: 7 },
      { title: "Pre-work reading list", col: "To do", who: ["diego"], age: 5 },
      { title: "Facilitation run-of-show", col: "Backlog", age: 3 },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Whiteboards
  // ════════════════════════════════════════════════════════════════════════════
  const secSb = await prisma.storyboard.findFirstOrThrow({ where: { deliverableId: secDel.sb } });
  const nmeSb = await prisma.storyboard.findFirstOrThrow({ where: { deliverableId: nmeDel.sb } });
  const days = ["Mon\nShared doc", "Tue\nMFA push", "Wed\nQR poster", "Thu\nIT caller", "Fri\nCFO wire"];
  await prisma.whiteboard.create({
    data: {
      workspaceId: ws.id, storyboardId: secSb.id, createdById: users.priya.id, title: "Module 1 – learner journey",
      scene: scene([
        text(40, 20, "Alex's week — one attack per day", 28),
        ...days.flatMap((d, n) => box(40 + n * 230, 100, 190, 90, d, ["#dbeafe", "#fce7f3", "#dcfce7", "#fef9c3", "#fee2e2"][n])),
        ...[0, 1, 2, 3].map((n) => arrow(230 + n * 230, 145, 270 + n * 230, 145)),
        text(40, 240, "Every day ends with the same habit: when in doubt, REPORT.", 20, "#0d9488"),
        ...box(40, 300, 1110, 70, "Practice inbox (assessment) → Summary: 3 habits", "#e0e7ff"),
      ]),
      createdAt: day(-35, 14),
    },
  });
  await prisma.whiteboard.create({
    data: {
      workspaceId: ws.id, cardId: cardRefs["sim-card"], createdById: users.sam.id, title: "Inbox simulation – branching",
      scene: scene([
        text(40, 20, "Inbox triage: per-message branching", 28),
        ...box(40, 100, 220, 80, "Message N", "#f1f5f9"),
        arrow(260, 140, 360, 60), arrow(260, 140, 360, 140), arrow(260, 140, 360, 220),
        ...box(360, 30, 200, 60, "Report", "#dcfce7"),
        ...box(360, 110, 200, 60, "Delete", "#fef9c3"),
        ...box(360, 190, 200, 60, "Trust", "#fee2e2"),
        text(600, 45, "+10, reinforce habit", 18), text(600, 125, "+5, explain why reporting is better", 18), text(600, 205, "if phish: −10, show consequence", 18),
      ]),
      createdAt: day(-12, 14),
    },
  });
  await prisma.whiteboard.create({
    data: {
      workspaceId: ws.id, storyboardId: nmeSb.id, createdById: users.diego.id, title: "New Manager – program architecture",
      scene: scene([
        text(40, 20, "6 weeks · blended", 28),
        ...["Wk 1: 1:1s", "Wk 2: Feedback", "Wk 3: Performance", "Wk 4: Delegation", "Wk 5: Wellbeing", "Wk 6: Your plan"].flatMap((w, n) =>
          box(40 + (n % 3) * 260, 100 + Math.floor(n / 3) * 130, 220, 90, w, n % 2 ? "#ede9fe" : "#e0f2fe"),
        ),
        text(40, 380, "Each week = 2 microlessons + 1 practice conversation + peer circle", 18, "#7c3aed"),
      ]),
      createdAt: day(-30, 14),
    },
  });
  await prisma.whiteboard.create({
    data: {
      workspaceId: ws.id, createdById: users.maya.id, title: "Sprint 41 retro",
      scene: scene([
        text(40, 20, "Sprint 41 retro", 28),
        ...box(40, 90, 300, 260, "Went well\n\n• SME turnaround < 3 days\n• Storyboard template", "#dcfce7"),
        ...box(370, 90, 300, 260, "To improve\n\n• Review feedback is\n  scattered in email\n• Late visual changes", "#fee2e2"),
        ...box(700, 90, 300, 260, "Actions\n\n• Try in-app reviews\n• Freeze visuals at\n  storyboard sign-off", "#dbeafe"),
      ]),
      createdAt: day(-4, 16),
    },
  });

  // Content inventory (lifecycle: one of each state, so the tiles and filters have
  // something to show). Calendar dates, so UTC midnight. --------------------------
  const cday = (n: number) => day(n, 0);
  const CONTENT: {
    title: string; type: string; owner?: string; status?: string; published?: number; review?: number; every?: number;
    expiry?: number; url?: string; labels?: string[]; deliverableId?: string; projectId?: string; notes?: string;
  }[] = [
    { title: "HIPAA Privacy & Security 2026", type: "course", owner: "priya", published: -59, review: 12, every: 12, expiry: 300, url: "https://lms.example.com/courses/hipaa-2026", labels: ["Compliance"], deliverableId: hipDel.sb, projectId: hipaa.project.id, notes: "Annual required training. Regulation text checked against HHS guidance at each review." },
    { title: "HIPAA final assessment", type: "assessment", owner: "priya", published: -59, review: -5, every: 12, labels: ["Compliance"], deliverableId: hipDel.quiz, projectId: hipaa.project.id },
    { title: "Fire safety refresher (video)", type: "video", owner: "jordan", published: -340, expiry: 20, url: "https://video.example.com/fire-safety", labels: ["Video", "Compliance"], notes: "Narrator has left the company; a re-record is needed before expiry." },
    { title: "Code of Conduct 2025", type: "course", owner: "maya", published: -400, expiry: -10, labels: ["Compliance", "High priority"], notes: "Superseded by the 2026 policy; replacement in planning." },
    { title: "New manager essentials – job aid", type: "job_aid", owner: "hannah", published: -60, review: 120, every: 6, url: "https://docs.example.com/new-manager-essentials" },
    { title: "Reporting a phishing email – quick guide", type: "job_aid", owner: "sam", status: "needs_review", published: -200, review: 165, every: 12, notes: "The Report button moved in the new mail client; screenshots are out of date." },
    { title: "Onboarding welcome video", type: "video", published: -170, review: 6, every: 6, labels: ["Video"] },
    { title: "Accessibility checklist for course builds", type: "document", owner: "diego", published: -30, labels: ["Accessibility"] },
    { title: "Lotus Notes basics (legacy)", type: "course", owner: "tom", status: "retired", published: -2200, notes: "Retired when the company moved off Notes." },
  ];
  for (const c of CONTENT) {
    await prisma.contentItem.create({
      data: {
        workspaceId: ws.id,
        title: c.title,
        contentType: c.type,
        status: c.status ?? "published",
        ownerId: c.owner ? users[c.owner].id : null,
        externalUrl: c.url ?? null,
        description: c.notes ?? null,
        publishedAt: c.published != null ? cday(c.published) : null,
        reviewDate: c.review != null ? cday(c.review) : null,
        reviewIntervalMonths: c.every ?? null,
        expiryDate: c.expiry != null ? cday(c.expiry) : null,
        deliverableId: c.deliverableId ?? null,
        projectId: c.projectId ?? null,
        createdById: admin.id,
        labels: c.labels ? { create: c.labels.map((l) => ({ labelId: labelIds[l] })) } : undefined,
      },
    });
  }

  // Saved views (personal to admin) ------------------------------------------------
  const secBoard = await prisma.board.findFirstOrThrow({ where: { workspaceId: ws.id, cardKeyPrefix: "SEC" } });

  // One round-2 comment already sent to the board (review links, phase 4) ------------
  {
    const c = await prisma.reviewComment.findFirstOrThrow({
      where: { body: { contains: "two-digit number" }, round: { deliverable: { project: { workspaceId: ws.id } } } },
      select: { id: true, roundId: true, body: true, anchor: true, round: { select: { number: true, snapshot: true, deliverable: { select: { name: true } } } } },
    });
    const anchor = parseAnchor(c.anchor);
    const toDo = await prisma.column.findFirstOrThrow({ where: { boardId: secBoard.id, name: "To do" } });
    const { cardKeySeq } = await prisma.board.update({ where: { id: secBoard.id }, data: { cardKeySeq: { increment: 1 } } });
    const card = await prisma.card.create({
      data: {
        columnId: toDo.id,
        title: excerpt(c.body, 120),
        description: cardDescriptionForComment(
          {
            id: c.id, roundId: c.roundId, roundNumber: c.round.number, body: c.body, anchor, author: "Marcus Bell",
            place: describePlace(anchor, { snapshot: c.round.snapshot as StoryboardSnapshot, isPdf: false }),
          },
          c.round.deliverable.name,
        ),
        keySeq: cardKeySeq,
        statusId: toDo.statusId,
        position: "a0V",
        createdAt: day(0, 9),
        assignees: { create: [{ userId: users.priya.id }] },
      },
    });
    await prisma.reviewComment.update({ where: { id: c.id }, data: { cardId: card.id } });
  }
  await prisma.savedView.createMany({
    data: [
      { workspaceId: ws.id, userId: admin.id, name: "Accessibility work", scope: "board", boardId: secBoard.id, filters: { labels: [labelIds["Accessibility"]], assignees: [], due: "any", search: "" } },
      { workspaceId: ws.id, userId: admin.id, name: "Due this week", scope: "board", boardId: secBoard.id, filters: { labels: [], assignees: [], due: "week", search: "" } },
      { workspaceId: ws.id, userId: admin.id, name: "Security Awareness only", scope: "sprint", boardId: null, filters: { project: sec.project.id, assignee: "", label: "" } },
      { workspaceId: ws.id, userId: admin.id, name: "Jordan's video work", scope: "sprint", boardId: null, filters: { project: "", assignee: users.jordan.id, label: labelIds["Video"] } },
    ],
  });

  // Second workspace (exercises the workspace switcher) -----------------------------
  const ws2 = await prisma.workspace.create({
    data: {
      name: "Partner Enablement", slug: SECOND_WS_SLUG,
      members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: users.maya.id, role: "MEMBER" }] },
      statuses: {
        create: [
          { name: "Backlog", category: "todo", position: "a0" }, { name: "To do", category: "todo", position: "a1" },
          { name: "In progress", category: "active", position: "a2" }, { name: "In review", category: "active", position: "a3" },
          { name: "Done", category: "done", position: "a4" },
        ],
      },
    },
    include: { statuses: true },
  });
  const ws1Status = statusIds;
  statusIds = Object.fromEntries(ws2.statuses.map((s) => [s.name, s.id]));
  await makeBoard({
    name: "Partner certification launch", workspaceId: ws2.id,
    cards: [
      { title: "Partner portal course shells", col: "In progress", age: 5 },
      { title: "Reseller pricing explainer", col: "To do", age: 3 },
      { title: "Kickoff deck", col: "Done", age: 8 },
    ],
  });
  statusIds = ws1Status;

  const counts = await Promise.all([
    prisma.user.count({ where: { memberships: { some: { workspaceId: ws.id } } } }),
    prisma.project.count({ where: { workspaceId: ws.id } }),
    prisma.board.count({ where: { workspaceId: ws.id } }),
    prisma.card.count({ where: { OR: [{ column: { board: { workspaceId: ws.id } } }, { parentCard: { column: { board: { workspaceId: ws.id } } } }] } }),
    prisma.screen.count({ where: { storyboard: { workspaceId: ws.id } } }),
    prisma.reviewCycle.count({ where: { deliverable: { project: { workspaceId: ws.id } } } }),
    prisma.intakeRequest.count({ where: { workspaceId: ws.id } }),
    prisma.attachment.count({ where: { workspaceId: ws.id } }),
  ]);
  console.log(
    `[demo-seed] done: ${counts[0]} people, ${counts[1]} projects, ${counts[2]} boards, ${counts[3]} cards (incl. subtasks), ` +
      `${counts[4]} storyboard screens, ${counts[5]} reviews, ${counts[6]} intake requests, ${counts[7]} attachments. ` +
      `Demo logins: <name>${DEMO_DOMAIN} / ${DEMO_PASSWORD}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[demo-seed] failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
