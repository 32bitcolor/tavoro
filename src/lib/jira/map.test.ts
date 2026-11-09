import { describe, expect, it } from "vitest";
import { defaultType, findFields, latestSprint, linkChoice, parseSprints, prefixFrom, priorityOf, sprintStatus, statusCategory, issueNumber, PREFIX_RE } from "./map";
import { normalizeSite } from "./client";

describe("mapping rules", () => {
  it("maps types", () => {
    expect(defaultType("Story", false)).toBe("story");
    expect(defaultType("Bug", false)).toBe("bug");
    expect(defaultType("Epic", false, 1)).toBe("epic");
    expect(defaultType("Initiative", false, 1)).toBe("epic");
    expect(defaultType("Sub-task", true, -1)).toBe("subtask");
    expect(defaultType("Spike", false, 0)).toBe("task");
  });

  it("maps priorities and status categories", () => {
    expect(priorityOf("Highest")).toBe("highest");
    expect(priorityOf("Blocker")).toBe("highest");
    expect(priorityOf("Minor")).toBe("low");
    expect(priorityOf("Whatever")).toBeNull();
    expect(statusCategory("new")).toBe("todo");
    expect(statusCategory("indeterminate")).toBe("active");
    expect(statusCategory("done")).toBe("done");
  });

  it("reads links from the issue's side", () => {
    const type = (name: string) => ({ name, inward: "", outward: "" });
    expect(linkChoice({ id: "1", type: type("Blocks"), outwardIssue: { id: "9", key: "P-9" } })).toEqual({ otherId: "9", choice: "blocks", known: true });
    expect(linkChoice({ id: "1", type: type("Blocks"), inwardIssue: { id: "9", key: "P-9" } })).toEqual({ otherId: "9", choice: "blocked_by", known: true });
    expect(linkChoice({ id: "1", type: type("Cloners"), inwardIssue: { id: "9", key: "P-9" } })?.choice).toBe("cloned_by");
    expect(linkChoice({ id: "1", type: type("Problem/Incident"), outwardIssue: { id: "9", key: "P-9" } })).toEqual({ otherId: "9", choice: "relates", known: false });
  });

  it("parses sprint values in both shapes and picks the latest", () => {
    const s = parseSprints([
      { id: 3, name: "S3", state: "closed" },
      "com.atlassian.greenhopper.service.sprint.Sprint@1[id=5,rapidViewId=1,state=ACTIVE,name=S5,goal=<null>,startDate=2025-01-01T00:00:00.000Z,endDate=<null>]",
    ]);
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ id: 5, name: "S5", state: "active", goal: undefined });
    expect(latestSprint(s)?.id).toBe(5);
    expect(latestSprint([...s, { id: 2, name: "S2", state: "future" }])?.id).toBe(2);
    expect(sprintStatus("future")).toBe("planned");
  });

  it("finds the special fields", () => {
    const f = findFields([
      { id: "customfield_10016", name: "Story point estimate", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points" } },
      { id: "customfield_10020", name: "Sprint", custom: true, schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
      { id: "customfield_10019", name: "Rank", custom: true, schema: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-lexo-rank" } },
    ]);
    expect(f).toEqual({ points: "customfield_10016", sprint: "customfield_10020", epicLink: null, rank: "customfield_10019" });
  });

  it("makes valid board prefixes", () => {
    for (const k of ["PROJ", "A", "LONGPROJKEY", "2FA"]) expect(PREFIX_RE.test(prefixFrom(k))).toBe(true);
    expect(prefixFrom("PROJ")).toBe("PROJ");
    expect(issueNumber("PROJ-123")).toBe(123);
  });
});

describe("normalizeSite", () => {
  it("accepts Jira Cloud sites only", () => {
    expect(normalizeSite("acme")).toEqual({ origin: "https://acme.atlassian.net", host: "acme.atlassian.net" });
    expect(normalizeSite("https://acme.atlassian.net/jira/software/projects")).toMatchObject({ origin: "https://acme.atlassian.net" });
    expect(normalizeSite("http://acme.atlassian.net")).toHaveProperty("error");
    expect(normalizeSite("10.0.0.5")).toHaveProperty("error");
    expect(normalizeSite("evil.com")).toHaveProperty("error");
    expect(normalizeSite("acme.atlassian.net.evil.com")).toHaveProperty("error");
    expect(normalizeSite("https://u:p@acme.atlassian.net")).toHaveProperty("error");
  });

  it("allows an approved host (a test mock)", () => {
    process.env.JIRA_ALLOWED_HOSTS = "localhost:4010";
    expect(normalizeSite("http://localhost:4010")).toEqual({ origin: "http://localhost:4010", host: "localhost:4010" });
    expect(normalizeSite("http://localhost:4011")).toHaveProperty("error");
    delete process.env.JIRA_ALLOWED_HOSTS;
  });
});
