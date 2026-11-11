// Who a comment is "from" when it didn't come from a Tavoro member typing it. Stored in the
// existing Comment.importedAuthor text so no migration is needed:
//   "Jane Doe"                  imported from Jira (the original author's name)
//   rule name + automation flag a rule posted it
//   "Priya Shah|courseforge"    a reviewer's reply in CourseForge (docs/SUITE.md, step 4)
const CF = "|courseforge";

export const fromCourseForge = (name: string) => `${name.replace(/\|/g, " ").trim().slice(0, 120) || "A reviewer"}${CF}`;

export function commentSource(importedAuthor: string, automation?: boolean | null): { name: string; label: string } {
  if (automation === true) return { name: importedAuthor, label: "automation" };
  if (importedAuthor.endsWith(CF)) return { name: importedAuthor.slice(0, -CF.length), label: "CourseForge reviewer" };
  return { name: importedAuthor, label: "from Jira" };
}
