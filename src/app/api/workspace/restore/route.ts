import { NextResponse } from "next/server";
import { getCurrentUser, getActiveMembership } from "@/lib/dal";
import { importWorkspace, BACKUP_FORMAT, type WorkspaceExport } from "@/lib/workspace-backup";
import { createSession } from "@/lib/session";
import { unzipSync, strFromU8 } from "fflate";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const membership = await getActiveMembership();
  if (!membership || membership.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "Not a valid backup archive." }, { status: 400 });
  }

  const jsonBytes = files["backup.json"];
  if (!jsonBytes) return NextResponse.json({ error: "Archive is missing backup.json." }, { status: 400 });

  let exp: WorkspaceExport;
  try {
    exp = JSON.parse(strFromU8(jsonBytes));
  } catch {
    return NextResponse.json({ error: "Corrupt backup.json." }, { status: 400 });
  }
  if (typeof exp.format !== "number" || exp.format > BACKUP_FORMAT) {
    return NextResponse.json({ error: "This backup was made by a newer version of Tavoro." }, { status: 400 });
  }

  const media: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith("media/")) media[path.slice("media/".length)] = bytes;
  }

  try {
    const result = await importWorkspace(exp, media, user.id);
    // Pin the restored workspace as active so the admin lands in it.
    await createSession(user.id, result.workspaceId);
    return NextResponse.json({ ok: true, workspaceId: result.workspaceId, name: result.name });
  } catch (err) {
    console.error("[restore]", err);
    return NextResponse.json({ error: "Restore failed: the backup couldn't be imported. Nothing was changed." }, { status: 500 });
  }
}
