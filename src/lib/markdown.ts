import { linkifyDoc } from "@/lib/linkify";
import { toBlocks, type Block, type Run } from "@/lib/rich-text";

// Markdown ⇄ the TipTap JSON the app stores (docs/MCP.md). AI clients read and write
// Markdown; cards, comments and storyboard fields are TipTap documents. Covers what
// the editors produce: paragraphs, headings, bullet/numbered lists (nested), quotes,
// code blocks, bold, italic, strike, inline code, links and line breaks.

// ── TipTap → Markdown ────────────────────────────────────────────────────────

function runsToMd(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.br) return "  \n";
      let t = r.code ? "`" + r.text + "`" : r.text;
      if (!r.code && t.trim()) {
        if (r.bold) t = `**${t}**`;
        if (r.italic) t = `*${t}*`;
        if (r.strike) t = `~~${t}~~`;
      }
      // A bare address reads back as itself, not [https://x](https://x).
      if (r.href && !r.code && (r.href === r.text || r.href === `https://${r.text}`)) return t;
      return r.href ? `[${t}](${r.href})` : t;
    })
    .join("");
}

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let prev: Block | null = null;
  for (const b of blocks) {
    const text = runsToMd(b.runs);
    // Lists and quotes stay tight; everything else gets a blank line between blocks.
    const sameList =
      prev?.kind === "li" && b.kind === "li" && ((b.level ?? 0) > 0 || (prev.level ?? 0) > 0 || (prev.number == null) === (b.number == null));
    const tight = sameList || (prev?.kind === "quote" && b.kind === "quote");
    if (prev && !tight) out.push("");
    if (b.kind === "h") out.push(`${"#".repeat(Math.min(Math.max(b.level ?? 2, 1), 6))} ${text}`);
    else if (b.kind === "li") out.push(`${"  ".repeat(b.level ?? 0)}${b.number != null ? `${b.number}.` : "-"} ${text}`);
    else if (b.kind === "quote") out.push(`> ${text}`);
    else if (b.kind === "code") out.push("```\n" + b.runs.map((r) => r.text).join("") + "\n```");
    else out.push(text);
    prev = b;
  }
  return out.join("\n").trim();
}

/** A stored document (TipTap JSON, or legacy plain text) as Markdown. */
export function toMarkdown(doc: string | null | undefined): string {
  return blocksToMarkdown(toBlocks(doc));
}

// ── Markdown → TipTap ────────────────────────────────────────────────────────

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; text?: string; marks?: Mark[]; attrs?: Record<string, unknown>; content?: Node[] };

/** Inline Markdown → TipTap text nodes. */
function inline(src: string, marks: Mark[] = []): Node[] {
  const out: Node[] = [];
  const push = (text: string, m: Mark[]) => {
    if (text) out.push(m.length ? { type: "text", text, marks: m } : { type: "text", text });
  };
  // Order matters: code first (its contents are literal), then links, then emphasis.
  const re = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*|__([^_]+)__)|(~~([^~]+)~~)|(\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)|( {2,}\n|\\\n)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push(src.slice(last, m.index), marks);
    if (m[1]) push(m[1].slice(1, -1), [...marks, { type: "code" }]);
    else if (m[2]) out.push(...inline(m[3], [...marks, { type: "link", attrs: { href: m[4], target: "_blank", rel: "noopener noreferrer nofollow" } }]));
    else if (m[5]) out.push(...inline(m[6] ?? m[7], [...marks, { type: "bold" }]));
    else if (m[8]) out.push(...inline(m[9], [...marks, { type: "strike" }]));
    else if (m[10]) out.push(...inline(m[11] ?? m[12], [...marks, { type: "italic" }]));
    else if (m[13]) out.push({ type: "hardBreak" });
    last = m.index + m[0].length;
  }
  push(src.slice(last), marks);
  return out;
}

/** A paragraph: single newlines are soft wraps (a space); "  \n" or "\\\n" is a hard break. */
const para = (text: string): Node => {
  const content = inline(text.replace(/(?<! {2}|\\)\n/g, " ").trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

type ListItem = { indent: number; ordered: boolean; start: number; text: string };

/** Build nested lists from flat items with indentation. */
function buildList(items: ListItem[], from: number, indent: number): { node: Node; next: number } {
  const ordered = items[from].ordered;
  const list: Node = { type: ordered ? "orderedList" : "bulletList", content: [] };
  if (ordered && items[from].start !== 1) list.attrs = { start: items[from].start };
  let i = from;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      // A deeper item with no parent at this level: attach to the previous item.
      const { node, next } = buildList(items, i, items[i].indent);
      const lastItem = list.content![list.content!.length - 1];
      if (lastItem) lastItem.content!.push(node);
      else list.content!.push({ type: "listItem", content: [{ type: "paragraph" }, node] });
      i = next;
      continue;
    }
    if (items[i].ordered !== ordered) break;
    list.content!.push({ type: "listItem", content: [para(items[i].text)] });
    i++;
  }
  return { node: list, next: i };
}

export function markdownToDoc(md: string): { type: "doc"; content: Node[] } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const content: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      content.push({ type: "codeBlock", content: body.length ? [{ type: "text", text: body.join("\n") }] : [] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      content.push({ type: "heading", attrs: { level: Math.min(h[1].length, 3) }, content: inline(h[2].trim()) });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      content.push({ type: "blockquote", content: markdownToDoc(body.join("\n")).content });
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push({ indent: Math.floor(m[1].replace(/\t/g, "  ").length / 2), ordered: !!m[3], start: Number(m[3] ?? 1), text: m[4] });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += " " + lines[i++].trim(); // a wrapped item line
        } else break;
      }
      let k = 0;
      while (k < items.length) {
        const { node, next } = buildList(items, k, items[k].indent);
        content.push(node);
        k = next;
      }
      continue;
    }
    // A paragraph runs until a blank line or the start of another block.
    const body: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) body.push(lines[i++]);
    content.push(para(body.join("\n")));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Markdown → the JSON string the app stores, or null for empty input. */
export function fromMarkdown(md: string | null | undefined): string | null {
  if (!md || !md.trim()) return null;
  return JSON.stringify(linkifyDoc(markdownToDoc(md)));
}
