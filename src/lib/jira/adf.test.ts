import { describe, expect, it } from "vitest";
import { adfText, adfToTipTap, plainToTipTap } from "./adf";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("adfToTipTap", () => {
  it("maps paragraphs, headings and marks", () => {
    const out = adfToTipTap(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Goals")] },
        p(t("bold", [{ type: "strong" }]), t(" "), t("site", [{ type: "link", attrs: { href: "https://x.test" } }]), t(" red", [{ type: "textColor", attrs: { color: "#f00" } }])),
      ),
    );
    expect(out.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goals" }] });
    expect(out.content[1].content).toEqual([
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://x.test" } }] },
      { type: "text", text: " red" },
    ]);
  });

  it("drops javascript: links", () => {
    const out = adfToTipTap(doc(p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))));
    expect(out.content[0].content).toEqual([{ type: "text", text: "x" }]);
  });

  it("maps lists, keeping the start number", () => {
    const out = adfToTipTap(doc({ type: "orderedList", attrs: { order: 3 }, content: [{ type: "listItem", content: [p(t("three"))] }] }));
    expect(out.content[0]).toEqual({ type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] });
  });

  it("turns matched mentions into mention nodes and others into text", () => {
    const out = adfToTipTap(doc(p({ type: "mention", attrs: { id: "acc-1", text: "@Jane Doe" } }, t(" and "), { type: "mention", attrs: { id: "acc-2", text: "@Sam" } })), {
      mention: (id) => (id === "acc-1" ? { id: "u1", label: "Jane Doe" } : null),
    });
    expect(out.content[0].content).toEqual([
      { type: "mention", attrs: { id: "u1", label: "Jane Doe" } },
      { type: "text", text: " and " },
      { type: "text", text: "@Sam" },
    ]);
  });

  it("flattens tables into a line per row, header bold", () => {
    const cell = (type: string, s: string) => ({ type, content: [p(t(s))] });
    const out = adfToTipTap(doc({ type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B")] }, { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] }] }));
    expect(out.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "A", marks: [{ type: "bold" }] }, { type: "text", text: " | " }, { type: "text", text: "B", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "1" }, { type: "text", text: " | " }, { type: "text", text: "2" }] },
    ]);
  });

  it("turns panels into quotes and task lists into checkbox bullets", () => {
    const out = adfToTipTap(
      doc(
        { type: "panel", attrs: { panelType: "warning" }, content: [p(t("Careful"))] },
        { type: "taskList", attrs: { localId: "x" }, content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [t("Draft")] }, { type: "taskItem", attrs: { state: "TODO" }, content: [t("Review")] }] },
      ),
    );
    expect(out.content[0]).toEqual({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "⚠️ " }, { type: "text", text: "Careful" }] }] });
    expect(JSON.stringify(out.content[1])).toContain("☑ ");
    expect(JSON.stringify(out.content[1])).toContain("☐ ");
  });

  it("names media and keeps code blocks as text", () => {
    const out = adfToTipTap(
      doc(
        { type: "mediaSingle", content: [{ type: "media", attrs: { id: "m1", type: "file", alt: "shot.png" } }] },
        { type: "codeBlock", attrs: { language: "js" }, content: [t("let a = 1;")] },
      ),
      { media: (a) => `📎 ${a.alt}` },
    );
    expect(out.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "📎 shot.png" }] });
    expect(out.content[1]).toEqual({ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "let a = 1;" }] });
  });

  it("keeps the text of unknown nodes and never returns an empty doc", () => {
    expect(adfToTipTap(doc({ type: "mysteryBlock", content: [p(t("kept"))] })).content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "kept" }] }]);
    expect(adfToTipTap(null)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(adfText(doc(p(t("a")), p({ type: "status", attrs: { text: "done" } })))).toBe("a\n[DONE]");
  });

  it("wraps stray inline nodes at block level in a paragraph", () => {
    expect(adfToTipTap(doc(t("loose"))).content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "loose" }] }]);
  });
});

describe("plainToTipTap", () => {
  it("splits paragraphs and keeps line breaks", () => {
    expect(plainToTipTap("a\nb\n\nc").content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
      { type: "paragraph", content: [{ type: "text", text: "c" }] },
    ]);
  });
});
