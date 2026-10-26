// TipTap JSON (how cards, comments and storyboard fields are stored) flattened into a
// small block list that an exporter can write out: paragraphs, headings, list items
// and quotes made of styled runs. Used by the Word and print exports, so both show
// the same words in the same shape. Anything unknown degrades to its text.

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** A link's target. */
  href?: string;
  /** A line break inside the block (Shift+Enter in the editor). */
  br?: boolean;
};

export type Block = {
  kind: "p" | "h" | "li" | "quote" | "code";
  /** Heading level, or list nesting depth (0 = top level). */
  level?: number;
  /** Ordered-list number; undefined for a bullet. */
  number?: number;
  runs: Run[];
};

import { splitLinks } from "@/lib/linkify";

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: Node[];
};

function inline(nodes: Node[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "text" && typeof n.text === "string") {
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      const link = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      const style = {
        bold: marks.has("bold") || undefined,
        italic: marks.has("italic") || undefined,
        underline: marks.has("underline") || undefined,
        strike: marks.has("strike") || undefined,
        code: marks.has("code") || undefined,
      };
      if (typeof link === "string") runs.push({ href: link, text: n.text, ...style });
      // Bare addresses typed as plain text still become links.
      else if (style.code) runs.push({ text: n.text, ...style });
      else for (const p of splitLinks(n.text)) runs.push({ href: p.href, text: p.text, ...style });
    } else if (n.type === "mention") {
      runs.push({ text: `@${String(n.attrs?.label ?? "someone")}`, bold: true });
    } else if (n.type === "hardBreak") {
      runs.push({ text: "", br: true });
    } else if (n.content) {
      runs.push(...inline(n.content));
    }
  }
  return runs;
}

function blocks(nodes: Node[] | undefined, out: Block[], depth: number, inQuote: boolean) {
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph":
        out.push({ kind: inQuote ? "quote" : "p", runs: inline(n.content) });
        break;
      case "heading":
        out.push({ kind: "h", level: Number(n.attrs?.level ?? 2), runs: inline(n.content) });
        break;
      case "codeBlock":
        out.push({ kind: "code", runs: [{ text: (n.content ?? []).map((c) => c.text ?? "").join(""), code: true }] });
        break;
      case "blockquote":
        blocks(n.content, out, depth, true);
        break;
      case "bulletList":
      case "orderedList": {
        const ordered = n.type === "orderedList";
        let i = Number(n.attrs?.start ?? 1);
        for (const item of n.content ?? []) {
          // A list item's first paragraph is the item; anything after it (nested lists,
          // further paragraphs) follows one level deeper.
          const [first, ...rest] = item.content ?? [];
          out.push({
            kind: "li",
            level: depth,
            number: ordered ? i++ : undefined,
            runs: first?.type === "paragraph" ? inline(first.content) : [],
          });
          blocks(first?.type === "paragraph" ? rest : item.content, out, depth + 1, inQuote);
        }
        break;
      }
      case "horizontalRule":
        break;
      default:
        if (n.content) blocks(n.content, out, depth, inQuote);
        else if (n.text) out.push({ kind: "p", runs: [{ text: n.text }] });
    }
  }
}

/** Parse a stored TipTap document. Legacy plain text becomes one paragraph per line. */
export function toBlocks(doc: string | null | undefined): Block[] {
  if (!doc || !doc.trim()) return [];
  try {
    const parsed = JSON.parse(doc) as Node;
    if (parsed && typeof parsed === "object" && parsed.type === "doc") {
      const out: Block[] = [];
      blocks(parsed.content, out, 0, false);
      // Drop trailing empty paragraphs the editor leaves behind.
      while (out.length && out[out.length - 1].runs.every((r) => !r.text && !r.br)) out.pop();
      return out;
    }
  } catch {
    /* plain text */
  }
  return doc.split(/\r?\n/).map((line) => ({ kind: "p", runs: [{ text: line }] }));
}

/** Plain text as blocks, for notes and summaries stored without formatting. */
export function textBlocks(text: string | null | undefined): Block[] {
  if (!text?.trim()) return [];
  return text.trim().split(/\r?\n/).map((line) => ({ kind: "p", runs: [{ text: line }] }));
}
