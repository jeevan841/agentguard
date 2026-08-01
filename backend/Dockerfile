# ─── Stage 1: Builder ────────────────────────────────────────────────────────
# Installs ALL dependencies (including devDeps for prisma generate) and
# generates the Prisma client. Uses npm ci for reproducible, locked installs.
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL required by Prisma engine
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy lock files first so Docker layer caching works correctly:
# node_modules is only rebuilt when package*.json changes.
COPY package*.json ./
RUN npm ci --include=dev

# Generate Prisma client (writes to node_modules/@prisma)
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source (after generating client so we don't re-generate on source changes)
COPY src ./src/

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
# Slim image with only production dependencies — no devDeps, no build tooling.
FROM node:20-slim AS runtime

WORKDIR /app

# Runtime OS deps (Prisma engine + TLS)
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy production node_modules from builder (includes generated Prisma client)
COPY --from=builder /app/node_modules ./node_modules

# Copy application source and Prisma schema
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# ── Security: run as non-root ──────────────────────────────────────────────────
# The official node:slim image already has a `node` user (uid 1000).
# chown ensures the app directory is writable by that user.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# ── Health check ───────────────────────────────────────────────────────────────
# k8s/ECS will also probe /health; this keeps Docker-native orchestration in sync.
# interval: how often to check | timeout: max wait for response
# start-period: grace period for DB/Redis connect on cold start
# retries: failures before container is marked unhealthy
HEALTHCHECK \
  --interval=30s \
  --timeout=5s \
  --start-period=15s \
  --retries=3 \
  CMD node -e "\
    require('http').get('http://localhost:4000/health', (r) => { \
      process.exit(r.statusCode === 200 ? 0 : 1); \
    }).on('error', () => process.exit(1));"

# Production entrypoint — NOT nodemon
CMD ["node", "src/index.js"]
