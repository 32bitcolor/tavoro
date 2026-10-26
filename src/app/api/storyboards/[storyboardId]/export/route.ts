import { getStoryboardForUser } from "@/lib/authz";
import { storyboardExport } from "@/lib/review-export";
import { DOCX_TYPE, renderDocx } from "@/lib/docx";
import { contentDisposition } from "@/lib/content-disposition";

/** A storyboard as a Word document, screen by screen. */
export async function GET(_req: Request, { params }: { params: Promise<{ storyboardId: string }> }) {
  const { storyboardId } = await params;
  if (!(await getStoryboardForUser(storyboardId))) return new Response("Not found", { status: 404 });
  const doc = await storyboardExport(storyboardId);
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(renderDocx(doc) as BodyInit, {
    headers: {
      "Content-Type": DOCX_TYPE,
      "Content-Disposition": contentDisposition(`${doc.fileName}.docx`),
      "Cache-Control": "private, no-store",
    },
  });
}
