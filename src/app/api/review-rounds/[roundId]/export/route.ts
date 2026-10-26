import { getReviewRoundForUser } from "@/lib/authz";
import { roundExport } from "@/lib/review-export";
import { DOCX_TYPE, renderDocx } from "@/lib/docx";
import { contentDisposition } from "@/lib/content-disposition";

/** A review round as a Word document: the storyboard snapshot (or the file's pages)
 *  with every comment beside what it's about. Members only. */
export async function GET(_req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  if (!(await getReviewRoundForUser(roundId))) return new Response("Not found", { status: 404 });
  const doc = await roundExport(roundId);
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(renderDocx(doc) as BodyInit, {
    headers: {
      "Content-Type": DOCX_TYPE,
      "Content-Disposition": contentDisposition(`${doc.fileName}.docx`),
      "Cache-Control": "private, no-store",
    },
  });
}
