import { z } from "zod";

// Extra questions on a workspace's intake form (beyond name, email, title, description,
// audience and date). Pure, so the public form, settings and server share it.

export const INTAKE_FIELD_TYPES = ["text", "long_text", "choice", "yes_no", "date"] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];
export const INTAKE_FIELD_TYPE_LABEL: Record<IntakeFieldType, string> = {
  text: "Short answer",
  long_text: "Paragraph",
  choice: "Choice",
  yes_no: "Yes / no",
  date: "Date",
};

export const MAX_INTAKE_FIELDS = 15;
export const MAX_CHOICES = 20;

export const IntakeFieldDef = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/),
  label: z.string().trim().min(1, "Every question needs a label.").max(120, "Keep questions under 120 characters."),
  help: z.string().trim().max(200).optional().default(""),
  type: z.enum(INTAKE_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(MAX_CHOICES).optional().default([]),
});
export type IntakeField = z.infer<typeof IntakeFieldDef>;

export const IntakeFieldList = z
  .array(IntakeFieldDef)
  .max(MAX_INTAKE_FIELDS, `Up to ${MAX_INTAKE_FIELDS} questions.`)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    fields.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: "custom", message: "Duplicate question id.", path: [i] });
      ids.add(f.id);
      if (f.type === "choice" && f.options.length < 2) ctx.addIssue({ code: "custom", message: `“${f.label}” needs at least two choices.`, path: [i] });
      if (f.type === "choice" && new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) {
        ctx.addIssue({ code: "custom", message: `“${f.label}” has the same choice twice.`, path: [i] });
      }
    });
  });

/** A workspace's stored questions, tolerating anything malformed (dropped, not thrown). */
export function readIntakeFields(raw: unknown): IntakeField[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) => {
    const p = IntakeFieldDef.safeParse(f);
    return p.success ? [p.data] : [];
  });
}

export type IntakeAnswer = { id: string; label: string; value: string };

export function readAnswers(raw: unknown): IntakeAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) =>
    a && typeof a === "object" && typeof a.label === "string" && typeof a.value === "string" ? [{ id: String(a.id ?? ""), label: a.label, value: a.value }] : [],
  );
}

const MAX_LEN: Record<IntakeFieldType, number> = { text: 280, long_text: 4000, choice: 80, yes_no: 3, date: 10 };

/** Validate submitted values (keyed by field id) against the questions. Unanswered
 *  optional questions are left out. Returns the snapshot to store, or an error. */
export function collectAnswers(fields: IntakeField[], get: (id: string) => string | null): { answers: IntakeAnswer[] } | { error: string } {
  const answers: IntakeAnswer[] = [];
  for (const f of fields) {
    const raw = (get(f.id) ?? "").trim();
    if (!raw) {
      if (f.required) return { error: `Please answer “${f.label}”.` };
      continue;
    }
    if (raw.length > MAX_LEN[f.type]) return { error: `Your answer to “${f.label}” is too long.` };
    let value = raw;
    if (f.type === "choice") {
      const hit = f.options.find((o) => o === raw);
      if (!hit) return { error: `Pick one of the choices for “${f.label}”.` };
    } else if (f.type === "yes_no") {
      if (raw !== "yes" && raw !== "no") return { error: `Answer yes or no to “${f.label}”.` };
      value = raw === "yes" ? "Yes" : "No";
    } else if (f.type === "date") {
      const d = new Date(`${raw}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || !d.toISOString().startsWith(raw)) return { error: `“${f.label}” needs a real date.` };
      value = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    }
    answers.push({ id: f.id, label: f.label, value });
  }
  return { answers };
}

/** "Label: value" lines, for project descriptions, emails and MCP documents. */
export function answersAsText(answers: IntakeAnswer[]): string {
  return answers.map((a) => (a.value.includes("\n") ? `${a.label}:\n${a.value}` : `${a.label}: ${a.value}`)).join("\n");
}

/** A short random id for a new question (stable across renames, so answers can be matched). */
export function newFieldId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
