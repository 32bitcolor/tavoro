import { z } from "zod";
import { authenticateApp } from "@/lib/connected-apps";
import { oauthError } from "@/lib/oauth";
import { prisma } from "@/lib/db";
import { syncReview } from "@/lib/suite-reviews";

// A CourseForge review link and its comments (docs/SUITE.md, step 4). Server to server,
// client secret. CourseForge sends the review's whole state on every change.
const Payload = z.object({
  review: z.object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    course: z.object({ id: z.string().min(1).max(100), title: z.string().max(300), url: z.string().max(500) }),
    createdBy: z.string().max(100).nullish(),
    createdByName: z.string().max(200).nullish(),
    expiresAt: z.string().max(40).nullish(),
    comments: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          author: z.string().max(200),
          text: z.string().max(5000),
          where: z.string().max(400).optional(),
          url: z.string().max(500).optional(),
          resolved: z.boolean(),
          createdAt: z.string().max(40).optional(),
          resolvedAt: z.string().max(40).nullish(),
          replies: z
            .array(z.object({ id: z.string().min(1).max(100), author: z.string().max(200), text: z.string().max(5000), createdAt: z.string().max(40).optional() }))
            .max(100)
            .optional(),
        }),
      )
      .max(500),
  }),
});

export async function POST(req: Request) {
  const auth = await authenticateApp(req);
  if (!auth) return oauthError("invalid_client", "Client authentication failed.", 401);
  const parsed = Payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  try {
    const result = await syncReview(auth.app, parsed.data.review, req);
    await prisma.connectedApp.update({ where: { id: auth.app.id }, data: { lastUsedAt: new Date() } });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[suite] review sync:", e instanceof Error ? e.message : e);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
