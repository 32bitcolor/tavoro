import { strToU8, zipSync } from "fflate";
import type { ExportComment, ExportDoc } from "@/lib/review-export";
import { textBlocks, type Block, type Run } from "@/lib/rich-text";

// A Word (.docx) writer for lib/review-export.ts documents. Just enough WordprocessingML
// for headings, styled text, lists, tables and boxed comments: no template, no
// numbering part (list markers are literal text), no images. Opens in Word, Google
// Docs, Pages and LibreOffice.

const ACCENT = "1F8A84";
const MUTED = "5B6670";
const BOX = "F3F6F8";

/** Escape for XML, dropping control characters XML 1.0 can't carry. */
function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type RunStyle = { bold?: boolean; italic?: boolean; color?: string; size?: number };

// Word rejects a file whose property elements are out of schema order, so runs and
// paragraphs build theirs through these two helpers, which emit them in order.
function run(r: Run, extra: RunStyle = {}): string {
  if (r.br) return "<w:r><w:br/></w:r>";
  const props = [
    r.code && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>',
    (r.bold || extra.bold) ? "<w:b/>" : extra.bold === false && '<w:b w:val="0"/>',
    (r.italic || extra.italic) && "<w:i/>",
    r.strike && "<w:strike/>",
    extra.color && `<w:color w:val="${extra.color}"/>`,
    extra.size && `<w:sz w:val="${extra.size}"/>`,
    r.underline && '<w:u w:val="single"/>',
  ]
    .filter(Boolean)
    .join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

const text = (t: string, style?: RunStyle) => run({ text: t }, style);

type P = {
  style?: string;
  /** Inside a comment box (left rule + shading). */
  box?: boolean;
  fill?: string;
  tab?: number;
  spacing?: { before: number; after: number };
  ind?: { left: number; hanging?: number; right?: number };
};

function para(runs: string, p: P = {}): string {
  const fill = p.fill ?? (p.box ? BOX : undefined);
  const spacing = p.spacing ?? (p.box ? { before: 0, after: 60 } : undefined);
  const pPr = [
    p.style && `<w:pStyle w:val="${p.style}"/>`,
    p.box && `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${ACCENT}"/></w:pBdr>`,
    fill && `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`,
    p.tab != null && `<w:tabs><w:tab w:val="left" w:pos="${p.tab}"/></w:tabs>`,
    spacing && `<w:spacing w:before="${spacing.before}" w:after="${spacing.after}"/>`,
    p.ind &&
      `<w:ind w:left="${p.ind.left}"${p.ind.hanging ? ` w:hanging="${p.ind.hanging}"` : ""}${p.ind.right ? ` w:right="${p.ind.right}"` : ""}/>`,
  ]
    .filter(Boolean)
    .join("");
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
}

/** Blocks of rich text. In a comment box, `indent` is the box's left edge. */
function blocks(list: Block[], box = false, indent = 0): string {
  const ind = (extra = 0, hanging?: number) =>
    box || indent || extra ? { left: indent + extra, hanging, right: box ? 120 : undefined } : undefined;
  return list
    .map((b) => {
      const runs = b.runs.map((r) => run(r, b.kind === "h" ? { bold: true } : {})).join("");
      if (b.kind === "li") {
        const left = 360 * ((b.level ?? 0) + 1);
        const marker = b.number != null ? `${b.number}.` : "•";
        return para(text(marker) + "<w:r><w:tab/></w:r>" + runs, { box, tab: indent + left, ind: ind(left, 280) });
      }
      if (b.kind === "quote") {
        return para(b.runs.map((r) => run(r, { italic: true, color: MUTED })).join(""), { box, ind: ind(box ? 0 : 360) });
      }
      if (b.kind === "code") return para(runs, { box, fill: "EEEEEE", ind: ind() });
      return para(runs, { box, ind: ind() });
    })
    .join("");
}

const STATUS: Record<ExportComment["status"], string> = { open: "Open", resolved: "Resolved", wont_fix: "Won't fix" };

function comment(c: ExportComment, indent: number): string {
  const box: P = { box: true, ind: { left: indent, right: 120 } };
  const meta = { color: MUTED, size: 18 };
  let out = para(
    text(c.author, { bold: true }) +
      text(`  ·  ${c.date}`, meta) +
      (c.place ? text(`  ·  ${c.place}`, meta) : "") +
      text(`  ·  ${STATUS[c.status]}`, { ...meta, bold: c.status !== "open", color: c.status === "resolved" ? ACCENT : MUTED }),
    box,
  );
  if (c.quote) out += para(text(`“${c.quote}”`, { italic: true, color: MUTED }), box);
  out += c.body.length ? blocks(c.body, true, indent) : para("", box);
  for (const r of c.replies) {
    out += para(text(`↳ ${r.author}`, { bold: true }) + text(`  ·  ${r.date}`, meta), { box: true, ind: { left: indent + 360, right: 120 } });
    out += blocks(r.body, true, indent + 360);
  }
  if (c.resolution) out += para(text(c.resolution, { ...meta, italic: true }), box);
  // A plain spacer, so the next comment starts a new box.
  return out + para("", { spacing: { before: 0, after: 60 } });
}

function table(widths: number[], rows: string[][], header: boolean): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D0D5DA"/>`;
  const tr = rows
    .map(
      (cells, i) =>
        `<w:tr>${header && i === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells
          .map(
            (cell, j) =>
              `<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/>${header && i === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="${BOX}"/>` : ""}</w:tcPr>${cell || para("")}</w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${tr}</w:tbl>` +
    para("")
  );
}

function body(doc: ExportDoc): string {
  let out = para(text(doc.title), { style: "Title" }) + para(text(doc.subtitle), { style: "Subtitle" });
  out += table(
    [2400, 7680],
    doc.meta.map(([k, v]) => [para(text(k, { bold: true })), para(text(v))]),
    false,
  );

  if (doc.reviewers.length) {
    out += para(text("Reviewers"), { style: "Heading1" });
    out += table(
      [2800, 2400, 4880],
      [
        [para(text("Reviewer", { bold: true })), para(text("Decision", { bold: true })), para(text("Summary", { bold: true }))],
        ...doc.reviewers.map((r) => [para(text(r.name)), para(text(r.decision)), blocks(textBlocks(r.summary)) || para("")]),
      ],
      true,
    );
  }

  for (const s of doc.sections) {
    out += para(text(s.heading) + s.tags.map((t) => text(`   ${t}`, { color: MUTED, size: 20, bold: false })).join(""), {
      style: "Heading1",
    });
    if (s.note) out += para(text(s.note, { italic: true, color: MUTED }));
    for (const f of s.fields) {
      out += para(text(f.label), { style: "Heading3" });
      out += f.body.length ? blocks(f.body) : para(text("(empty)", { italic: true, color: MUTED }));
      for (const c of f.comments) out += comment(c, 240);
    }
    for (const c of s.comments) out += comment(c, 0);
    if (!s.fields.length && !s.comments.length && !s.note) out += para(text("No content on this screen.", { italic: true, color: MUTED }));
  }
  return out;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="1B2733"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="28"/><w:color w:val="${ACCENT}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D0D5DA"/></w:pBdr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="1B2733"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="17"/><w:color w:val="${MUTED}"/></w:rPr></w:style>
</w:styles>`;

/** Build the .docx bytes. */
export function renderDocx(doc: ExportDoc): Uint8Array {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body(doc)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(STYLES),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(`${doc.title} — ${doc.subtitle}`)}</dc:title><dc:creator>Tavoro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
  });
}

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
