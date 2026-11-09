// Custom card fields (docs/JIRA-PARITY.md, phase 8): their types and how values are
// checked and shown. Pure and client-safe (the card panel and the Cards page use it).
import { z } from "zod";

export const FIELD_TYPES = ["text", "number", "select", "multiselect", "date", "checkbox", "person"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select (one)",
  multiselect: "Select (several)",
  date: "Date",
  checkbox: "Checkbox",
  person: "Person",
};

export type FieldOption = { id: string; label: string };
export type CustomFieldDef = { id: string; name: string; type: FieldType; options: FieldOption[]; allBoards: boolean; boardIds: string[] };

/** A value as the UI and MCP hold it. */
export type FieldValue = string | number | boolean | string[] | null;

/** The typed columns a value is stored in (CardFieldValue). */
export type StoredValue = { text: string | null; number: number | null; date: Date | null; bool: boolean | null; optionIds: string[]; userId: string | null };

export const OptionsSchema = z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1).max(80) })).max(100);
export const FieldName = z.string().trim().min(1, "Give the field a name.").max(60);

export function asFieldType(v: string): FieldType {
  return (FIELD_TYPES as readonly string[]).includes(v) ? (v as FieldType) : "text";
}

export function asOptions(v: unknown): FieldOption[] {
  const r = OptionsSchema.safeParse(v);
  return r.success ? r.data : [];
}

export const EMPTY: StoredValue = { text: null, number: null, date: null, bool: null, optionIds: [], userId: null };

/** Check a value for a field and turn it into stored columns. null = clear. */
export function toStored(f: { type: FieldType; options: FieldOption[] }, v: FieldValue): { ok: StoredValue | null } | { error: string } {
  if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return { ok: null };
  switch (f.type) {
    case "text": {
      const s = String(v).trim().slice(0, 2000);
      return s ? { ok: { ...EMPTY, text: s } } : { ok: null };
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) return { error: "Enter a number." };
      return { ok: { ...EMPTY, number: Math.round(n * 10000) / 10000 } };
    }
    case "date": {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) return { error: "Enter a date (YYYY-MM-DD)." };
      return { ok: { ...EMPTY, date: new Date(`${s}T00:00:00Z`) } };
    }
    case "checkbox":
      if (typeof v === "boolean") return { ok: { ...EMPTY, bool: v } };
      if (["true", "yes"].includes(String(v).toLowerCase())) return { ok: { ...EMPTY, bool: true } };
      if (["false", "no"].includes(String(v).toLowerCase())) return { ok: { ...EMPTY, bool: false } };
      return { error: "Use true or false." };
    case "select":
    case "multiselect": {
      const wanted = (Array.isArray(v) ? v : [String(v)]).map((x) => String(x));
      const ids: string[] = [];
      for (const w of wanted) {
        const o = f.options.find((x) => x.id === w) ?? f.options.find((x) => x.label.toLowerCase() === w.trim().toLowerCase());
        if (!o) return { error: `“${w}” isn’t one of the options: ${f.options.map((x) => x.label).join(", ") || "none yet"}.` };
        if (!ids.includes(o.id)) ids.push(o.id);
      }
      if (f.type === "select" && ids.length > 1) return { error: "Pick one option." };
      return { ok: { ...EMPTY, optionIds: ids } };
    }
    case "person":
      return { ok: { ...EMPTY, userId: String(v) } };
  }
}

/** A stored value back as a FieldValue. */
export function fromStored(f: { type: FieldType }, s: StoredValue | null | undefined): FieldValue {
  if (!s) return null;
  switch (f.type) {
    case "text":
      return s.text;
    case "number":
      return s.number;
    case "date":
      return s.date ? s.date.toISOString().slice(0, 10) : null;
    case "checkbox":
      return s.bool;
    case "select":
      return s.optionIds[0] ?? null;
    case "multiselect":
      return s.optionIds.length ? s.optionIds : null;
    case "person":
      return s.userId;
  }
}

/** How a value reads in History, the Cards table and MCP. */
export function displayValue(f: { type: FieldType; options: FieldOption[] }, v: FieldValue, personName?: (id: string) => string | null): string | null {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return null;
  switch (f.type) {
    case "select":
    case "multiselect":
      return (Array.isArray(v) ? v : [String(v)]).map((id) => f.options.find((o) => o.id === id)?.label ?? "(removed option)").join(", ");
    case "checkbox":
      return v ? "Yes" : "No";
    case "person":
      return personName?.(String(v)) ?? "Someone";
    case "date":
      return new Date(`${String(v)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    default:
      return String(v);
  }
}

/** Does a field show on a board? */
export function fieldOnBoard(f: { allBoards: boolean; boardIds: string[] }, boardId: string) {
  return f.allBoards || f.boardIds.includes(boardId);
}
