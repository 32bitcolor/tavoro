import type { ExportComment, ExportDoc } from "@/lib/review-export";
import { textBlocks, type Block } from "@/lib/rich-text";
import { SAFE_HREF } from "@/lib/linkify";
import { cn } from "@/lib/utils";

// The print view of a lib/review-export.ts document — the browser's "Save as PDF" is
// the PDF export. It's styled as paper (dark ink on white) whatever the app theme,
// because that's what it prints as.

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        const runs = b.runs.map((r, j) =>
          r.br ? (
            <br key={j} />
          ) : (
            <span
              key={j}
              className={cn(
                r.bold && "font-semibold",
                r.italic && "italic",
                r.underline && "underline",
                r.strike && "line-through",
                r.code && "font-mono text-[0.92em]",
              )}
            >
              {r.href && SAFE_HREF.test(r.href) ? (
                <a href={r.href} className="text-[#1f6f6a] underline underline-offset-2">
                  {r.text}
                </a>
              ) : (
                r.text
              )}
            </span>
          ),
        );
        if (b.kind === "li") {
          return (
            <p key={i} className="flex gap-2" style={{ paddingLeft: `${(b.level ?? 0) * 1.25 + 0.25}rem` }}>
              <span className="w-4 shrink-0 text-right">{b.number != null ? `${b.number}.` : "•"}</span>
              <span>{runs}</span>
            </p>
          );
        }
        if (b.kind === "quote") return <p key={i} className="border-l-2 border-[#c9d1d8] pl-3 italic text-[#5b6670]">{runs}</p>;
        if (b.kind === "h") return <p key={i} className="font-semibold">{runs}</p>;
        if (b.kind === "code") return <pre key={i} className="whitespace-pre-wrap rounded bg-[#eef1f4] px-2 py-1 font-mono text-[0.85em]">{runs}</pre>;
        return <p key={i} className="min-h-[1em]">{runs}</p>;
      })}
    </>
  );
}

const STATUS: Record<ExportComment["status"], string> = { open: "Open", resolved: "Resolved", wont_fix: "Won't fix" };

function Comment({ c }: { c: ExportComment }) {
  return (
    <div className="mt-2 break-inside-avoid rounded-r border-l-[3px] border-[#1f8a84] bg-[#f3f6f8] px-3 py-2 text-[13px]">
      <p className="text-[12px] text-[#5b6670]">
        <span className="font-semibold text-[#1b2733]">{c.author}</span> · {c.date}
        {c.place && <> · {c.place}</>} ·{" "}
        <span className={cn(c.status === "resolved" && "font-semibold text-[#1f7a75]", c.status === "wont_fix" && "font-semibold")}>
          {STATUS[c.status]}
        </span>
      </p>
      {c.quote && <p className="mt-1 italic text-[#5b6670]">“{c.quote}”</p>}
      <div className="mt-1 flex flex-col gap-1"><Blocks blocks={c.body} /></div>
      {c.replies.map((r, i) => (
        <div key={i} className="mt-2 border-l-2 border-[#c9d1d8] pl-3">
          <p className="text-[12px] text-[#5b6670]">
            <span className="font-semibold text-[#1b2733]">{r.author}</span> · {r.date}
          </p>
          <div className="flex flex-col gap-1"><Blocks blocks={r.body} /></div>
        </div>
      ))}
      {c.resolution && <p className="mt-1.5 text-[12px] italic text-[#5b6670]">{c.resolution}</p>}
    </div>
  );
}

export function ExportDocument({ doc }: { doc: ExportDoc }) {
  return (
    <article className="mx-auto w-full max-w-[52rem] bg-white px-10 py-10 text-[14px] leading-relaxed text-[#1b2733] shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="text-lg text-[#1f8a84]">{doc.subtitle}</p>
      <dl className="mt-5 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 border-y border-[#d0d5da] py-3 text-[13px]">
        {doc.meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {doc.reviewers.length > 0 && (
        <section className="mt-8">
          <h2 className="border-b border-[#d0d5da] pb-1 text-xl font-bold">Reviewers</h2>
          <table className="mt-3 w-full table-fixed border-collapse text-left text-[13px]">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[24%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="bg-[#f3f6f8]">
                <th className="border border-[#d0d5da] px-2 py-1 font-semibold">Reviewer</th>
                <th className="border border-[#d0d5da] px-2 py-1 font-semibold">Decision</th>
                <th className="border border-[#d0d5da] px-2 py-1 font-semibold">Summary</th>
              </tr>
            </thead>
            <tbody>
              {doc.reviewers.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className="border border-[#d0d5da] px-2 py-1">{r.name}</td>
                  <td className="border border-[#d0d5da] px-2 py-1">{r.decision}</td>
                  <td className="border border-[#d0d5da] px-2 py-1"><Blocks blocks={textBlocks(r.summary)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {doc.sections.map((s, i) => (
        <section key={i} className="mt-8">
          <h2 className="break-after-avoid border-b border-[#d0d5da] pb-1 text-xl font-bold">
            {s.heading}
            {s.tags.map((t) => (
              <span key={t} className="ml-3 text-sm font-normal text-[#5b6670]">{t}</span>
            ))}
          </h2>
          {s.note && <p className="mt-2 italic text-[#5b6670]">{s.note}</p>}
          {s.fields.map((f) => (
            <div key={f.label} className="mt-4">
              <h3 className="break-after-avoid text-[11px] font-bold uppercase tracking-wider text-[#5b6670]">{f.label}</h3>
              <div className="mt-1 flex flex-col gap-1.5">
                {f.body.length ? <Blocks blocks={f.body} /> : <p className="italic text-[#5b6670]">(empty)</p>}
              </div>
              {f.comments.length > 0 && <div className="ml-4">{f.comments.map((c, j) => <Comment key={j} c={c} />)}</div>}
            </div>
          ))}
          {s.comments.map((c, j) => <Comment key={j} c={c} />)}
          {!s.fields.length && !s.comments.length && !s.note && (
            <p className="mt-2 italic text-[#5b6670]">No content on this screen.</p>
          )}
        </section>
      ))}
    </article>
  );
}
