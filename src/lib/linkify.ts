// Bare web addresses in text → links. Text people type or paste ("see
// https://example.com/spec") should open where it points, whether it lives in a
// TipTap document (cards, comments, storyboard fields) or a plain-text field
// (intake requests, conversations).

/** http(s):// or www. up to the next space; trailing punctuation is trimmed below. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Only these schemes are ever made clickable. */
export const SAFE_HREF = /^(https?:|mailto:)/i;

/** Drop sentence punctuation the address picked up, keeping a ")" it opened itself
 *  (https://en.wikipedia.org/wiki/Foo_(bar) keeps its paren; "(see https://x.io)" loses it). */
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (last && ".,;:!?'\"*_".includes(last)) u = u.slice(0, -1);
    else if (last === ")" && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
    else if (last === "]" && !u.includes("[")) u = u.slice(0, -1);
    else return u;
  }
}

export type LinkPart = { text: string; href?: string };

/** Split text into plain and link parts. Text without addresses comes back as one part. */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (url.length <= "www.".length || url.endsWith("://")) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    last = m.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}

type Mark = { type?: string; attrs?: Record<string, unknown> };
type Node = { type?: string; text?: string; marks?: Mark[]; content?: Node[]; [k: string]: unknown };

/** Give bare addresses in a TipTap document a link mark. Text that is already a link,
 *  inline code or inside a code block is left alone. Returns a new document. */
export function linkifyDoc<T>(doc: T): T {
  const walk = (node: Node): Node => {
    if (node.type === "codeBlock" || !node.content) return node;
    const content: Node[] = [];
    for (const child of node.content) {
      const skip = child.marks?.some((m) => m.type === "link" || m.type === "code");
      if (child.type !== "text" || typeof child.text !== "string" || skip) {
        content.push(walk(child));
        continue;
      }
      for (const part of splitLinks(child.text)) {
        const marks = part.href ? [...(child.marks ?? []), { type: "link", attrs: { href: part.href, target: "_blank", rel: "noopener noreferrer nofollow" } }] : child.marks;
        content.push(marks?.length ? { ...child, text: part.text, marks } : { type: "text", text: part.text });
      }
    }
    return { ...node, content };
  };
  return doc && typeof doc === "object" ? (walk(doc as Node) as T) : doc;
}
