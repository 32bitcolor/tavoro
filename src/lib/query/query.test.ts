import { describe, expect, it } from "vitest";
import { parseQuery, QueryError } from "./parse";
import { compileQuery, type QueryCtx } from "./compile";

const ctx: QueryCtx = {
  me: "u-me",
  now: new Date("2026-11-09T15:00:00Z"),
  statuses: [{ id: "s-todo", name: "To do", category: "todo" }, { id: "s-prog", name: "In progress", category: "active" }, { id: "s-done", name: "Done", category: "done" }],
  labels: [{ id: "l-qa", name: "qa" }, { id: "l-vid", name: "Video" }],
  members: [{ id: "u-maya", name: "Maya Okafor", email: "maya@x.test" }, { id: "u-p1", name: "Priya Nair", email: "p1@x.test" }, { id: "u-p2", name: "Priya Nair", email: "p2@x.test" }],
  sprints: [{ id: "sp-42", name: "Sprint 42", status: "active" }, { id: "sp-43", name: "Sprint 43", status: "planned" }],
  boards: [{ id: "b-sec", name: "Security course", prefix: "SEC" }],
  projects: [{ id: "p-1", name: "Onboarding" }],
  epics: [{ id: "e-1", title: "Website refresh", key: "SEC-1" }],
  cardIdsForKeys: async (keys) => new Map(keys.filter((k) => k === "SEC-12").map((k) => [k, "c-12"])),
  blockedIds: async () => ["c-blocked"],
};
const where = async (q: string) => (await compileQuery(q, ctx)).where;
const err = async (q: string) => {
  try {
    await compileQuery(q, ctx);
  } catch (e) {
    if (e instanceof QueryError) return { message: e.message, pos: e.pos };
    throw e;
  }
  throw new Error("expected an error");
};

describe("parseQuery", () => {
  it("parses precedence, NOT, lists, empty and order", () => {
    const q = parseQuery('status = "In progress" AND (assignee = me OR NOT labels in (qa, video)) AND epic is empty ORDER BY priority DESC, rank');
    expect(q.order.map((o) => [o.field, o.desc])).toEqual([["priority", true], ["rank", false]]);
    expect(q.where?.kind).toBe("and");
  });
  it("accepts an empty query and order-only queries", () => {
    expect(parseQuery("")).toEqual({ where: null, order: [] });
    expect(parseQuery("order by created desc").order[0]).toMatchObject({ field: "created", desc: true });
  });
  it("points at what's wrong", () => {
    expect(() => parseQuery('title ~ "open')).toThrow(/closing quote/);
    expect(() => parseQuery("status = done assignee = me")).toThrow(/Join conditions/);
    try {
      parseQuery("status done");
    } catch (e) {
      expect((e as QueryError).pos).toBe(7);
    }
    expect(() => parseQuery("labels in qa")).toThrow(/brackets/);
    expect(() => parseQuery("assignee is maya")).toThrow(/followed by empty/);
  });
});

describe("compileQuery", () => {
  it("resolves names to ids", async () => {
    expect(await where('status = "in progress"')).toEqual({ statusId: { in: ["s-prog"] } });
    expect(await where("assignee = me")).toEqual({ assignees: { some: { userId: { in: ["u-me"] } } } });
    expect(await where("assignee = maya@x.test")).toEqual({ assignees: { some: { userId: { in: ["u-maya"] } } } });
    expect(await where("labels not in (qa, video)")).toEqual({ labels: { none: { labelId: { in: ["l-qa", "l-vid"] } } } });
    expect(await where("epic = SEC-1")).toEqual({ epicId: { in: ["e-1"] } });
    expect(await where("sprint = active")).toEqual({ sprintId: { in: ["sp-42"] } });
    expect(await where("board = sec")).toEqual({ column: { boardId: { in: ["b-sec"] } } });
    expect(await where("key = SEC-12")).toEqual({ id: { in: ["c-12"] } });
  });
  it("handles empty, != and NOT", async () => {
    expect(await where("assignee is empty")).toEqual({ assignees: { none: {} } });
    expect(await where("sprint is not empty")).toEqual({ NOT: { sprintId: null } });
    expect(await where("status != Done")).toEqual({ AND: [{ NOT: { statusId: null } }, { NOT: { statusId: { in: ["s-done"] } } }] });
    expect(await where("not type = bug")).toEqual({ NOT: { type: { in: ["bug"] } } });
  });
  it("orders priorities like Jira (> is more urgent)", async () => {
    expect(await where("priority >= high")).toEqual({ priority: { in: ["highest", "high"] } });
    expect(await where("priority < medium")).toEqual({ priority: { in: ["low", "lowest"] } });
  });
  it("understands dates", async () => {
    expect(await where("due < 7d")).toEqual({ dueDate: { lt: new Date("2026-11-16T00:00:00Z") } });
    expect(await where("created = today")).toEqual({ createdAt: { gte: new Date("2026-11-09T00:00:00Z"), lt: new Date("2026-11-10T00:00:00Z") } });
    expect(await where("updated >= -2w")).toEqual({ updatedAt: { gte: new Date("2026-10-26T00:00:00Z") } });
    expect(await where("due is empty")).toEqual({ dueDate: null });
  });
  it("computed fields", async () => {
    expect(await where("blocked = true")).toEqual({ id: { in: ["c-blocked"] } });
    expect(await where("done = false")).toEqual({ NOT: { status: { category: "done" } } });
    expect(await where('text ~ "quiz"')).toEqual({ OR: [{ title: { contains: "quiz", mode: "insensitive" } }, { description: { contains: "quiz", mode: "insensitive" } }] });
  });
  it("explains mistakes, at the right place", async () => {
    expect(await err("colour = red")).toMatchObject({ message: expect.stringMatching(/no field called colour/), pos: 0 });
    expect(await err("status = Blocked")).toMatchObject({ message: expect.stringMatching(/No status “Blocked”. Try: To do, In progress, Done/), pos: 9 });
    expect(await err("assignee = 'Priya Nair'")).toMatchObject({ message: expect.stringMatching(/Two members/) });
    expect(await err("assignee = nobody")).toMatchObject({ message: expect.stringMatching(/No member/) });
    expect(parseQuery(`assignee = "O'Brien"`).where).toMatchObject({ value: { v: "O'Brien" } });
    expect(await err('assignee = "Priya Nair"')).toMatchObject({ message: expect.stringMatching(/Two members/) });
    expect(await err("type ~ bug")).toMatchObject({ message: expect.stringMatching(/can’t use “~”/) });
    expect(await err("due < soon")).toMatchObject({ message: expect.stringMatching(/isn’t a date/) });
    expect(await err("order by colour")).toMatchObject({ message: expect.stringMatching(/Can’t sort by colour/) });
  });
});

import { suggest } from "./suggest";
describe("suggest", () => {
  const d = {
    statuses: [{ name: "To do" }, { name: "In progress" }],
    labels: [{ name: "qa" }, { name: "video" }],
    members: [{ name: "Maya Okafor", email: "maya@x.test" }],
    sprints: [{ name: "Sprint 42", status: "active" }],
    boards: [{ name: "Security", prefix: "SEC" }],
    projects: [],
    epics: [{ title: "Website", key: "SEC-1" }],
  };
  const at = (t: string) => suggest(t, t.length, d);
  it("offers fields first, filtered by what's typed", () => {
    expect(at("").items.map((s) => s.label)).toContain("status");
    expect(at("sta").items.map((s) => s.label)).toEqual(["status", "start"]);
    expect(at("sta").from).toBe(0);
  });
  it("offers operators after a field, values after an operator", () => {
    expect(at("priority ").items.map((s) => s.label)).toContain(">=");
    expect(at("status = ").items.map((s) => s.insert)).toEqual(['"To do"', '"In progress"']);
    expect(at('status = "in').items.map((s) => s.label)).toEqual(["In progress"]);
    expect(at("assignee = ").items[0]).toMatchObject({ label: "me" });
    expect(at("labels in (qa, ").items.map((s) => s.label)).toEqual(["qa", "video"]);
    expect(at("epic is ").items.map((s) => s.label)).toEqual(["EMPTY", "NOT EMPTY"]);
  });
  it("offers keywords after a condition, and sort fields after ORDER BY", () => {
    expect(at("status = done ").items.map((s) => s.label)).toEqual(["AND", "OR", "ORDER BY"]);
    expect(at("status = done and ").items.map((s) => s.label)).toContain("assignee");
    expect(at("order by pri").items.map((s) => s.label)).toEqual(["priority"]);
    expect(at("order by priority ").items.map((s) => s.label)).toEqual(["DESC", "ASC", ","]);
  });
});

describe("custom fields in queries", () => {
  const cctx = {
    ...ctx,
    customFields: [
      { id: "f-aud", name: "Audience", type: "select", options: [{ id: "o-mgr", label: "Managers" }, { id: "o-new", label: "New hires" }] },
      { id: "f-min", name: "Seat time", type: "number", options: [] },
      { id: "f-code", name: "Course code", type: "text", options: [] },
    ],
  };
  const w = async (q: string) => (await compileQuery(q, cctx)).where;
  it("matches by name, case-insensitively, quoted when it has spaces", async () => {
    expect(await w("audience = managers")).toEqual({ fieldValues: { some: { fieldId: "f-aud", optionIds: { hasSome: ["o-mgr"] } } } });
    expect(await w('"Seat time" >= 30')).toEqual({ fieldValues: { some: { fieldId: "f-min", number: { gte: 30 } } } });
    expect(await w('"course code" ~ SEC')).toEqual({ fieldValues: { some: { fieldId: "f-code", text: { contains: "SEC", mode: "insensitive" } } } });
  });
  it("handles empty and != like the built-in fields", async () => {
    expect(await w("audience is empty")).toEqual({ NOT: { fieldValues: { some: { fieldId: "f-aud", NOT: { optionIds: { isEmpty: true } } } } } });
    expect(await w('audience != "New hires"')).toEqual({
      AND: [{ fieldValues: { some: { fieldId: "f-aud", NOT: { optionIds: { isEmpty: true } } } } }, { NOT: { fieldValues: { some: { fieldId: "f-aud", optionIds: { hasSome: ["o-new"] } } } } }],
    });
  });
  it("explains unknown options and operators", async () => {
    await expect(compileQuery("audience = Execs", cctx)).rejects.toThrow(/No option of “Audience” “Execs”. Try: Managers, New hires/);
    await expect(compileQuery('"seat time" ~ 3', cctx)).rejects.toThrow(/can’t use “~”/);
  });
  it("suggests custom fields and their options", () => {
    const d = { statuses: [], labels: [], members: [], sprints: [], boards: [], projects: [], epics: [], customFields: cctx.customFields };
    expect(suggest("", 0, d).items.map((s) => s.insert)).toContain('"Seat time"');
    expect(suggest('"Audience" = ', 13, d).items.map((s) => s.insert)).toEqual(["Managers", '"New hires"']);
  });
});
