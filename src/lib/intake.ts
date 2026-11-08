import { answersAsText, readAnswers } from "@/lib/intake-fields";
export const INTAKE_STATUSES = ["submitted", "triaging", "needs_info", "rejected", "converted"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  submitted: "Submitted",
  triaging: "Triaging",
  needs_info: "Needs info",
  rejected: "Rejected",
  converted: "Converted",
};

/** Still being worked on: the queue's Open tab. */
export const OPEN_STATUSES: readonly IntakeStatus[] = ["submitted", "triaging", "needs_info"];
/** Decided: approved (into a project) or rejected. */
export const isResolved = (status: string) => status === "converted" || status === "rejected";

export function intakeStatusTone(status: string): "success" | "danger" | "info" | "warning" | "neutral" {
  if (status === "converted") return "success";
  if (status === "rejected") return "danger";
  if (status === "triaging") return "info";
  if (status === "needs_info") return "warning";
  return "neutral";
}

/** Where a request goes when triage resumes (after "Ask for info", or a reopen):
 *  back to Triaging once it has both scores, otherwise Submitted. */
export function triageStatusFor(r: { impactScore: number | null; effortScore: number | null }): IntakeStatus {
  return r.impactScore != null && r.effortScore != null ? "triaging" : "submitted";
}

// Who may do what (enforced in app/actions/intake.ts, mirrored in the UI):
//   decide — approve, reject, reopen, assign: admins and managers.
//   work   — score, ask the requester for info, mark info received: admins, managers,
//            and the member the request is assigned to.
// Every member can see the queue; only admins and managers see requester emails.
export function canDecideIntake(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}
export function canWorkIntake(role: string | null | undefined, userId: string, assignedToId: string | null): boolean {
  return canDecideIntake(role) || (assignedToId !== null && assignedToId === userId);
}

export const SCORE_VALUES = [1, 2, 3, 4, 5] as const;
export type ScoreValue = (typeof SCORE_VALUES)[number];

// Weighting impact 2:1 over effort is a deliberate, simple call — rewards
// high-impact work without letting effort alone veto it. Range: -4..9.
export function priorityScore(impact: number, effort: number): number {
  return impact * 2 - effort;
}

// A classic impact/effort quadrant, derived from the same two scores — no extra
// state to store or keep in sync.
export function quadrantLabel(impact: number | null, effort: number | null): string | null {
  if (impact == null || effort == null) return null;
  if (impact >= 4 && effort <= 2) return "Quick win";
  if (impact >= 4 && effort >= 4) return "Big bet";
  if (impact <= 2 && effort <= 2) return "Fill-in";
  if (impact <= 2 && effort >= 4) return "Reconsider";
  return "Balanced";
}

export function ticketLabel(number: number): string {
  return `REQ-${number}`;
}

/** The project description an approved request starts with: what was asked for, and
 *  where it came from. Plain text, like every project description. */
export function projectDescriptionFrom(r: {
  number: number;
  description: string;
  targetAudience: string | null;
  targetDate: Date | null;
  requesterName: string;
  answers?: unknown;
}): string {
  const lines = [r.description.trim(), ""];
  const answers = readAnswers(r.answers);
  if (answers.length) lines.push(answersAsText(answers), "");
  if (r.targetAudience) lines.push(`Audience: ${r.targetAudience}`);
  if (r.targetDate) {
    lines.push(`Needed by: ${r.targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`);
  }
  lines.push(`Requested by ${r.requesterName} (${ticketLabel(r.number)})`);
  return lines.join("\n").slice(0, 5000);
}
