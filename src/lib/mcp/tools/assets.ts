import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getAssetForUser, getContentItemForUser } from "@/lib/authz";
import { attachAsset, createAssetLink, detachAsset, setAssetArchived, setAssetLabels, updateAsset, type AssetFields } from "@/app/actions/assets";
import { ASSET_SELECT, listAssets, toAssetRow, type AssetRow } from "@/lib/assets";
import { ASSET_TYPES } from "@/lib/asset-types";
import { check, iso, link, principal, tool, ToolError } from "@/lib/mcp/util";

// The asset library (docs/CONTENT-LIFECYCLE-REUSE.md, phase 2): reusable files and
// links, and which content uses them. Files are uploaded in the app; over MCP you can
// find, describe, label, link and archive them.

const assetRef = z.string().min(1).describe("Asset id (from list_assets)");
const contentRef = z.string().min(1).describe("Content item id (from list_content)");

function summary(a: AssetRow) {
  return {
    id: a.id,
    name: a.name,
    type: a.assetType,
    kind: a.fileUrl ? "file" : "link",
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    archived: !!a.archivedAt,
    usedIn: a.usedIn,
    labels: a.labels.map((l) => l.name),
    url: link(`/assets/${a.id}`),
  };
}

async function inWorkspace(id: string) {
  const a = await getAssetForUser(id);
  if (!a || a.workspaceId !== principal().workspaceId) throw new ToolError("Asset not found, or it's in another workspace.");
  return a;
}

export async function loadAsset(id: string) {
  await inWorkspace(id);
  const [row, uses] = await Promise.all([
    prisma.asset.findUniqueOrThrow({ where: { id }, select: ASSET_SELECT }),
    prisma.contentItemAsset.findMany({ where: { assetId: id }, select: { contentItem: { select: { id: true, title: true, status: true } } } }),
  ]);
  const a = toAssetRow(row);
  return {
    ...summary(a),
    description: a.description,
    mimeType: a.mimeType,
    externalUrl: a.externalUrl,
    fileUrl: a.fileUrl ? link(a.fileUrl) : null,
    addedBy: a.uploadedBy ? { name: a.uploadedBy.name, email: a.uploadedBy.email } : null,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
    usedInContent: uses.map((u) => ({ id: u.contentItem.id, title: u.contentItem.title, status: u.contentItem.status, url: link(`/content/${u.contentItem.id}`) })),
  };
}

async function labelIds(names: string[]): Promise<string[]> {
  const labels = await prisma.label.findMany({ where: { workspaceId: principal().workspaceId }, select: { id: true, name: true } });
  return names.map((n) => {
    const hit = labels.find((l) => l.name.toLowerCase() === n.trim().toLowerCase());
    if (!hit) throw new ToolError(`There's no label called "${n}". Existing labels: ${labels.map((l) => l.name).join(", ") || "none"}.`);
    return hit.id;
  });
}

const fields = {
  type: z.enum(ASSET_TYPES).optional(),
  description: z.string().max(5000).nullable().optional().describe("What it is, where it came from, licence or usage terms; for images, also the alt text"),
  labels: z.array(z.string()).max(50).optional().describe("Workspace label names; replaces the asset's labels"),
};

export function registerAssetTools(server: McpServer) {
  tool(
    server,
    "list_assets",
    {
      title: "List assets",
      description:
        "The asset library: reusable images, video, audio, documents and source files (uploaded, or links to where they live), newest first, with how many content items use each. Archived assets are left out unless you ask for them.",
      kind: "read",
      input: {
        query: z.string().optional().describe("Only names, file names or descriptions containing this"),
        type: z.enum(ASSET_TYPES).optional(),
        label: z.string().optional().describe("Only assets with this label (name)"),
        unused: z.boolean().optional().describe("Only assets no content item uses"),
        archived: z.boolean().optional().describe("Archived assets instead of the live library"),
      },
    },
    async ({ query, type, label, unused, archived }) => {
      const labelId = label ? (await labelIds([label]))[0] : undefined;
      const rows = await listAssets(principal().workspaceId, { q: query, type, labelId, unused: unused ? "1" : undefined, archived: archived ? "1" : undefined });
      return { assets: rows.slice(0, 200).map(summary), total: rows.length };
    },
  );

  tool(
    server,
    "get_asset",
    { title: "Get asset", description: "One asset in full: description, file details or link, labels, and the content items that use it.", kind: "read", input: { asset: assetRef } },
    async ({ asset }) => loadAsset(asset),
  );

  tool(
    server,
    "add_asset_link",
    {
      title: "Add a link to the asset library",
      description: "Add an asset that lives somewhere else (a Drive folder, Figma file, stock photo page) as a link. Files themselves are uploaded in the app.",
      kind: "write",
      input: { name: z.string().min(1).max(200), url: z.string().describe("https:// link to where it lives"), ...fields },
    },
    async ({ name, url, type, description, labels }) => {
      // Resolve labels first, so an unknown label fails before anything is created.
      const ids = labels ? await labelIds(labels) : null;
      const res = check(await createAssetLink({ name, externalUrl: url, ...(type ? { assetType: type } : {}), ...(description !== undefined ? { description } : {}) }));
      if (ids) check(await setAssetLabels(res.id, ids));
      return loadAsset(res.id);
    },
  );

  tool(
    server,
    "update_asset",
    {
      title: "Update asset",
      description: "Rename, describe, retype, relabel, archive or restore an asset. Only the fields you pass change. url only applies to link assets.",
      kind: "write",
      idempotent: true,
      input: {
        asset: assetRef,
        name: z.string().min(1).max(200).optional(),
        url: z.string().optional().describe("New link, for a link asset"),
        archived: z.boolean().optional().describe("true takes it off the shelf (kept); false restores it"),
        ...fields,
      },
    },
    async ({ asset, name, url, archived, type, description, labels }) => {
      await inWorkspace(asset);
      const ids = labels ? await labelIds(labels) : null;
      const patch: Partial<AssetFields> = {
        ...(name ? { name } : {}),
        ...(type ? { assetType: type } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(url !== undefined ? { externalUrl: url } : {}),
      };
      if (Object.keys(patch).length) check(await updateAsset(asset, patch));
      if (ids) check(await setAssetLabels(asset, ids));
      if (archived !== undefined) check(await setAssetArchived(asset, archived));
      return loadAsset(asset);
    },
  );

  tool(
    server,
    "attach_asset",
    {
      title: "Record that content uses an asset",
      description: "Link a library asset to a content item that uses it, so the library can say where each asset is used. Safe to repeat.",
      kind: "write",
      idempotent: true,
      input: { content: contentRef, asset: assetRef },
    },
    async ({ content, asset }) => {
      await inWorkspace(asset);
      if (!(await getContentItemForUser(content))) throw new ToolError("Content not found, or it's in another workspace.");
      check(await attachAsset(content, asset));
      return loadAsset(asset);
    },
  );

  tool(
    server,
    "detach_asset",
    {
      title: "Remove an asset from content",
      description: "Stop recording that a content item uses an asset. The asset stays in the library.",
      kind: "write",
      idempotent: true,
      input: { content: contentRef, asset: assetRef },
    },
    async ({ content, asset }) => {
      await inWorkspace(asset);
      check(await detachAsset(content, asset));
      return loadAsset(asset);
    },
  );
}
