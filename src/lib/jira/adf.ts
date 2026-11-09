// Atlassian Document Format (Jira's rich text) → the TipTap JSON Tavoro stores.
// Both are ProseMirror documents, so most nodes map one to one. Tavoro's editor is
// StarterKit + mentions, so what it can't show becomes the closest thing it can:
// panels → quotes, tables → one line per row, task lists → bullets with ☐ / ☑,
// media → "📎 name" (the file comes over as an attachment), unknown nodes → their text.
// Pure (no I/O), so it's unit-tested (adf.test.ts).

type Adf = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Adf[] };
export type TipTapNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: TipTapNode[] };

export type AdfOptions = {
  /** A Jira account mentioned in the text → a Tavoro member, or null (kept as "@Name"). */
  mention?: (accountId: string, text: string) => { id: string; label: string } | null;
  /** How a media node reads, e.g. "📎 screenshot.png". */
  media?: (attrs: Record<string, unknown>) => string;
};

const INLINE = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "status", "date", "mediaInline", "placeholder"]);

const MARKS: Record<string, string> = { strong: "bold", em: "italic", strike: "strike", code: "code", underline: "underline", link: "link" };

function marks(m: Adf["marks"]): TipTapNode["marks"] {
  const out: NonNullable<TipTapNode["marks"]> = [];
  for (const x of m ?? []) {
    const t = MARKS[x.type];
    if (!t) continue;
    if (t === "link") {
      const href = String(x.attrs?.href ?? "");
      if (/^(https?:|mailto:)/i.test(href)) out.push({ type: "link", attrs: { href } });
    } else out.push({ type: t });
  }
  return out.length ? out : undefined;
}

function text(t: string, m?: TipTapNode["marks"]): TipTapNode | null {
  if (!t) return null;
  return m ? { type: "text", text: t, marks: m } : { type: "text", text: t };
}

/** All the text under a node, for things Tavoro can't show structurally. */
export function adfText(input: unknown): string {
  const n = input as Adf | undefined;
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return String(n.attrs?.text ?? "@someone");
  if (n.type === "emoji") return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
  if (n.type === "inlineCard" || n.type === "blockCard" || n.type === "embedCard") return String(n.attrs?.url ?? "");
  if (n.type === "status") return `[${String(n.attrs?.text ?? "").toUpperCase()}]`;
  if (n.type === "date") return dateText(n.attrs?.timestamp);
  const parts = (n.content ?? []).map(adfText);
  const block = n.content?.some((c) => !INLINE.has(c.type));
  return parts.join(block ? "\n" : "");
}

function dateText(ts: unknown): string {
  const d = new Date(Number(ts));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function adfToTipTap(input: unknown, opts: AdfOptions = {}): { type: "doc"; content: TipTapNode[] } {
  const doc = input as Adf | null;
  const content = doc && Array.isArray(doc.content) ? blocks(doc.content, opts) : [];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Plain text in a Jira field (some fields and old comments are strings, not ADF). */
export function plainToTipTap(s: string): { type: "doc"; content: TipTapNode[] } {
  const paras = s.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return {
    type: "doc",
    content: paras.map((p) => {
      const lines = p.split("\n");
      const c: TipTapNode[] = [];
      lines.forEach((l, i) => {
        if (i) c.push({ type: "hardBreak" });
        if (l) c.push({ type: "text", text: l });
      });
      return c.length ? { type: "paragraph", content: c } : { type: "paragraph" };
    }),
  };
}

function inlines(list: Adf[] | undefined, opts: AdfOptions, extra?: TipTapNode["marks"]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const n of list ?? []) {
    const m = [...(marks(n.marks) ?? []), ...(extra ?? [])];
    const mk = m.length ? m : undefined;
    switch (n.type) {
      case "text": {
        const t = text(n.text ?? "", mk);
        if (t) out.push(t);
        break;
      }
      case "hardBreak":
        out.push({ type: "hardBreak" });
        break;
      case "mention": {
        const id = String(n.attrs?.id ?? "");
        const label = String(n.attrs?.text ?? "").replace(/^@/, "");
        const hit = id ? opts.mention?.(id, label) : null;
        if (hit) out.push({ type: "mention", attrs: { id: hit.id, label: hit.label } });
        else {
          const t = text(`@${label || "someone"}`, mk);
          if (t) out.push(t);
        }
        break;
      }
      case "inlineCard": {
        const url = String(n.attrs?.url ?? "");
        const t = text(url, /^https?:/i.test(url) ? [{ type: "link", attrs: { href: url } }] : mk);
        if (t) out.push(t);
        break;
      }
      case "mediaInline": {
        const t = text(opts.media?.(n.attrs ?? {}) ?? "📎 attachment", mk);
        if (t) out.push(t);
        break;
      }
      default: {
        const t = text(adfText(n), mk);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function para(content: TipTapNode[]): TipTapNode {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function blocks(list: Adf[], opts: AdfOptions): TipTapNode[] {
  const out: TipTapNode[] = [];
  let run: Adf[] = []; // stray inline nodes at block level get wrapped in a paragraph
  const flush = () => {
    if (run.length) out.push(para(inlines(run, opts)));
    run = [];
  };
  for (const n of list) {
    if (INLINE.has(n.type)) {
      run.push(n);
      continue;
    }
    flush();
    out.push(...block(n, opts));
  }
  flush();
  return out;
}

function listItems(items: Adf[] | undefined, opts: AdfOptions, prefix?: (i: Adf) => string): TipTapNode[] {
  return (items ?? []).map((li) => {
    let content = blocks(li.content ?? [], opts);
    if (!content.length || content[0].type !== "paragraph") content = [{ type: "paragraph" }, ...content];
    if (prefix) {
      const first = content[0];
      content[0] = { ...first, content: [{ type: "text", text: prefix(li) }, ...(first.content ?? [])] };
    }
    return { type: "listItem", content };
  });
}

function block(n: Adf, opts: AdfOptions): TipTapNode[] {
  switch (n.type) {
    case "paragraph":
      return [para(inlines(n.content, opts))];
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1));
      return [{ type: "heading", attrs: { level }, content: inlines(n.content, opts) }];
    }
    case "bulletList":
      return [{ type: "bulletList", content: listItems(n.content, opts) }];
    case "orderedList": {
      const start = Number(n.attrs?.order) || 1;
      return [{ type: "orderedList", attrs: { start }, content: listItems(n.content, opts) }];
    }
    case "taskList":
      // taskItems hold inline content directly; nested taskLists sit beside them.
      return [
        {
          type: "bulletList",
          content: (n.content ?? []).flatMap((it): TipTapNode[] =>
            it.type === "taskItem"
              ? [{ type: "listItem", content: [para([{ type: "text", text: it.attrs?.state === "DONE" ? "☑ " : "☐ " }, ...inlines(it.content, opts)])] }]
              : [{ type: "listItem", content: [{ type: "paragraph" }, ...block(it, opts)] }],
          ),
        },
      ];
    case "decisionList":
      return [{ type: "bulletList", content: (n.content ?? []).map((it) => ({ type: "listItem", content: [para([{ type: "text", text: "◆ " }, ...inlines(it.content, opts)])] })) }];
    case "codeBlock": {
      const t = adfText(n);
      const language = typeof n.attrs?.language === "string" ? n.attrs.language : null;
      return [{ type: "codeBlock", attrs: { language }, ...(t ? { content: [{ type: "text", text: t }] } : {}) }];
    }
    case "blockquote":
      return [{ type: "blockquote", content: nonEmpty(blocks(n.content ?? [], opts)) }];
    case "panel": {
      const kind = String(n.attrs?.panelType ?? "info");
      const label = { info: "ℹ️ ", note: "📝 ", warning: "⚠️ ", error: "⛔ ", success: "✅ " }[kind] ?? "";
      const inner = blocks(n.content ?? [], opts);
      if (label && inner[0]?.type === "paragraph") inner[0] = { ...inner[0], content: [{ type: "text", text: label }, ...(inner[0].content ?? [])] };
      return [{ type: "blockquote", content: nonEmpty(inner) }];
    }
    case "rule":
      return [{ type: "horizontalRule" }];
    case "expand":
    case "nestedExpand": {
      const title = String(n.attrs?.title ?? "");
      return [...(title ? [para([{ type: "text", text: title, marks: [{ type: "bold" }] }])] : []), ...blocks(n.content ?? [], opts)];
    }
    case "table":
      return (n.content ?? []).map((row) => {
        const header = row.content?.every((c) => c.type === "tableHeader");
        const cells: TipTapNode[] = [];
        (row.content ?? []).forEach((cell, i) => {
          if (i) cells.push({ type: "text", text: " | " });
          cells.push(...inlines(flattenInline(cell), opts, header ? [{ type: "bold" }] : undefined));
        });
        return para(cells);
      });
    case "mediaSingle":
    case "mediaGroup":
      return (n.content ?? []).filter((m) => m.type === "media").map((m) => para([{ type: "text", text: opts.media?.(m.attrs ?? {}) ?? "📎 attachment" }]));
    case "media":
      return [para([{ type: "text", text: opts.media?.(n.attrs ?? {}) ?? "📎 attachment" }])];
    case "blockCard":
    case "embedCard": {
      const url = String(n.attrs?.url ?? "");
      return url ? [para([{ type: "text", text: url, marks: /^https?:/i.test(url) ? [{ type: "link", attrs: { href: url } }] : undefined }].map(clean))] : [];
    }
    case "layoutSection":
      return (n.content ?? []).flatMap((col) => blocks(col.content ?? [], opts));
    case "layoutColumn":
    case "bodiedExtension":
      return blocks(n.content ?? [], opts);
    case "extension":
    case "inlineExtension":
      return [];
    default: {
      if (n.content?.length) return blocks(n.content, opts);
      const t = adfText(n);
      return t ? [para([{ type: "text", text: t }])] : [];
    }
  }
}

function clean(n: TipTapNode): TipTapNode {
  if (n.marks === undefined) delete n.marks;
  return n;
}

function nonEmpty(list: TipTapNode[]): TipTapNode[] {
  return list.length ? list : [{ type: "paragraph" }];
}

/** A table cell's inline content, with its paragraphs joined by spaces. */
function flattenInline(cell: Adf): Adf[] {
  const out: Adf[] = [];
  (cell.content ?? []).forEach((b, i) => {
    if (i) out.push({ type: "text", text: " " });
    if (INLINE.has(b.type)) out.push(b);
    else if (b.content?.every((c) => INLINE.has(c.type))) out.push(...(b.content ?? []));
    else out.push({ type: "text", text: adfText(b).replace(/\n+/g, " ") });
  });
  return out;
}
