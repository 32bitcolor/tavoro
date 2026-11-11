import { describe, expect, it } from "vitest";
import { commentSource, fromCourseForge } from "./comment-source";

describe("commentSource", () => {
  it("tells Jira imports, automation and CourseForge reviewers apart", () => {
    expect(commentSource("Jane Doe", false)).toEqual({ name: "Jane Doe", label: "from Jira" });
    expect(commentSource("Weekly nudge", true)).toEqual({ name: "Weekly nudge", label: "automation" });
    expect(commentSource(fromCourseForge("Maria Lopez"), false)).toEqual({ name: "Maria Lopez", label: "CourseForge reviewer" });
  });
  it("copes with odd names", () => {
    expect(commentSource(fromCourseForge("  "), null).name).toBe("A reviewer");
    expect(commentSource(fromCourseForge("A|B"), undefined).name).toBe("A B");
  });
});
