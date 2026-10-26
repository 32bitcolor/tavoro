import "server-only";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { prisma } from "@/lib/db";
import { isAllowedRedirectUri } from "@/lib/oauth";

// OAuth Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document;
// the MCP spec's preferred registration since 2025-11-25, and what ChatGPT uses first).
// The client_id IS an https URL; the document there names the client and its redirect
// URIs. We fetch it, check it, and keep it as an OAuthClient row (refreshed hourly), so
// codes and tokens hang off a client like any other.
//
// The URL comes from whoever starts a sign-in, so fetching it is a server-side request
// on a stranger's behalf: https only, public addresses only, no redirects, 5 s, 64 KB.

const REFRESH_MS = 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024;

export function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b:")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

type Doc = {
  client_id?: unknown;
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
};

/** DNS lookup for the request's own connection, refusing private addresses. Checking
 *  in a separate lookup first would leave a gap: a rebinding DNS server could answer
 *  with a public address for the check and a private one for the connection. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }).then(
    (addrs) => {
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
        callback(new Error("client_id host is not a public address"), "", 0);
      } else if (options.all) {
        callback(null, addrs);
      } else {
        callback(null, addrs[0].address, addrs[0].family);
      }
    },
    (err) => callback(err, "", 0),
  );
};

function fetchDocument(url: URL): Promise<Doc> {
  return new Promise((resolve, reject) => {
    // No redirects followed (https.get never does): a 3xx is just "not 200".
    const req = https.get(url, { lookup: publicOnlyLookup, timeout: 5000, headers: { accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`client metadata answered ${res.statusCode}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_BYTES) {
          req.destroy();
          return reject(new Error("client metadata is too large"));
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Doc);
        } catch {
          reject(new Error("client metadata isn't JSON"));
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("client metadata timed out")));
    req.on("error", reject);
  });
}

/** The OAuthClient for a CIMD client_id, fetching (or refreshing) its document. */
export async function resolveCimdClient(clientId: string): Promise<{ id: string; name: string; redirectUris: string[] } | { error: string }> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return { error: "client_id is not a valid URL." };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.pathname === "/") {
    return { error: "A client_id URL must be https, with a path, and no credentials or fragment." };
  }
  const known = await prisma.oAuthClient.findUnique({ where: { id: clientId }, select: { id: true, name: true, redirectUris: true, metadataFetchedAt: true } });
  if (known?.metadataFetchedAt && Date.now() - known.metadataFetchedAt.getTime() < REFRESH_MS) return known;

  let doc: Doc;
  try {
    doc = await fetchDocument(url);
  } catch (e) {
    // A document we fetched before is still good enough if the refresh fails.
    if (known) return known;
    return { error: `Couldn't load the client's metadata document: ${e instanceof Error ? e.message : "fetch failed"}.` };
  }
  if (doc.client_id !== clientId) return { error: "The client metadata document's client_id doesn't match its URL." };
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!redirectUris.length || redirectUris.some((u) => !isAllowedRedirectUri(u))) return { error: "The client metadata document lists no usable redirect_uris." };
  // We only take public clients (PKCE): the client must be willing to use "none".
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported)
    ? doc.token_endpoint_auth_methods_supported
    : [doc.token_endpoint_auth_method ?? "none"];
  if (!methods.includes("none")) return { error: "This client needs a token endpoint auth method Tavoro doesn't offer (only PKCE public clients)." };
  const name = typeof doc.client_name === "string" && doc.client_name.trim() ? doc.client_name.trim().slice(0, 120) : url.hostname;

  return prisma.oAuthClient.upsert({
    where: { id: clientId },
    create: { id: clientId, name, redirectUris, authMethod: "none", metadataFetchedAt: new Date() },
    update: { name, redirectUris, metadataFetchedAt: new Date() },
    select: { id: true, name: true, redirectUris: true },
  });
}

export type OAuthClientInfo = { id: string; name: string; redirectUris: string[]; authMethod: string; secretHash: string | null };

/** Any client by its client_id: a metadata-document URL, or one that registered. */
export async function findClient(clientId: string): Promise<OAuthClientInfo | { error: string }> {
  if (!clientId) return { error: "client_id is required." };
  if (isCimdClientId(clientId)) {
    const c = await resolveCimdClient(clientId);
    return "error" in c ? c : { ...c, authMethod: "none", secretHash: null };
  }
  const c = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, redirectUris: true, authMethod: true, secretHash: true },
  });
  return c ?? { error: "Unknown client." };
}
