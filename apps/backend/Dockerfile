FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS base
WORKDIR /app
RUN apk upgrade --no-cache libcrypto3 libssl3

# Install dependencies
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/
# Omit peers: @trpc/server peer-depends on typescript, which is build-time only.
RUN bun install --production --omit=peer --frozen-lockfile --filter backend

# Copy source
COPY apps/backend/ ./apps/backend/
COPY packages/shared/ ./packages/shared/

WORKDIR /app/apps/backend
USER bun
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
