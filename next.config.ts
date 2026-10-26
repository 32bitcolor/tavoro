import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal, self-contained server bundle for the Docker image.
  output: "standalone",
  // Native / driver-adapter packages that must not be bundled by the compiler.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/adapter-pg"],
  // Set at build time to the git commit being deployed (see Dockerfile +
  // deploy/update-agent.sh). Lets Next.js detect when a client's JS bundle is
  // talking to a server from a different deploy (e.g. after a self-update) and
  // force a full page reload instead of a broken client-side navigation.
  deploymentId: process.env.DEPLOYMENT_ID,
  poweredByHeader: false,
  // Baseline security headers on every response. Production traffic reaches the app
  // through the Cloudflare tunnel, not Caddy, so they're set here. Framing is limited
  // to the app itself (review files open in an in-app frame); routes that serve
  // uploaded files add their own sandboxing CSP on top.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
  // OAuth discovery for MCP clients (docs/MCP.md). App Router can't route a folder
  // that starts with a dot, so the well-known documents are rewritten to API routes.
  // Clients may append the resource path (…/oauth-protected-resource/api/mcp).
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata" },
    ];
  },
};

export default nextConfig;
