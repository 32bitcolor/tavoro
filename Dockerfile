# syntax=docker/dockerfile:1

# ── base: shared runtime with OS deps Prisma needs ───────────────────────────
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── deps: full dependency install (incl. dev) for building & tooling ─────────
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

# ── build: generate Prisma client + compile Next standalone output ───────────
FROM base AS build
ARG DEPLOYMENT_ID=dev
ENV NODE_ENV=production
ENV DEPLOYMENT_ID=$DEPLOYMENT_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# Placeholder values so `next build` never reads real secrets; runtime overrides these.
ENV SESSION_SECRET=build-time-placeholder
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN npm run build

# ── migrate: one-shot image to run migrations + seed, then exit ──────────────
FROM deps AS migrate
ENV NODE_ENV=production
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

# ── app: minimal standalone runtime (Next server) ────────────────────────────
FROM base AS app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Run as the image's unprivileged `node` user, not root.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ── worker: background job runner (BullMQ) ───────────────────────────────────
FROM build AS worker
ENV NODE_ENV=production
CMD ["npx", "tsx", "worker/index.ts"]
