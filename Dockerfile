# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:25-bookworm-slim AS build
WORKDIR /app

# Build tools are only needed if a native dependency has no prebuilt binary for
# the target architecture. They never end up in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# ── Production dependencies ──────────────────────────────────────────────────
FROM node:25-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:25-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/dist/public

WORKDIR /app

# The official Node image already provides an unprivileged "node" user (uid 1000).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Customisable copy and branding; mount a replacement over it or set SITE_CONFIG.
COPY --chown=node:node site.json ./

RUN mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8099

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8099/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
