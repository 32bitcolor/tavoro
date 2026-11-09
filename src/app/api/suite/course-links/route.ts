import { prisma } from "@/lib/db";
import { baseUrl, oauthError } from "@/lib/oauth";
import { authenticateApp } from "@/lib/connected-apps";

// The cards a course is linked to (docs/SUITE.md, step 2), for CourseForge's
// "Open in Tavoro". Server to server, client secret; only this app's links.
export async function GET(req: Request) {
  const auth = await authenticateApp(req);
  if (!auth) return oauthError("invalid_client", "Client authentication failed.", 401);
  const course = new URL(req.url).searchParams.get("course") ?? "";
  const rows = await prisma.cardCourse.findMany({
    where: { appId: auth.app.id, courseId: course },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      card: {
        select: {
          id: true,
          title: true,
          keySeq: true,
          private: true,
          column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true, project: { select: { name: true } } } } } },
        },
      },
    },
  });
  const base = baseUrl(req);
  const cards = rows.flatMap(({ card }) => {
    const b = card.column?.board;
    if (!b) return [];
    const key = b.cardKeyPrefix && card.keySeq != null ? `${b.cardKeyPrefix}-${card.keySeq}` : "Card";
    // A private card's title stays in Tavoro.
    return [{ key, title: card.private ? "Private card" : card.title, url: `${base}/boards/${b.id}?card=${card.id}`, board: b.name, project: b.project?.name ?? null }];
  });
  return Response.json({ cards }, { headers: { "Cache-Control": "no-store" } });
}
