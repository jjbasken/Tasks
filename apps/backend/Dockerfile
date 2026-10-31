FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS base
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
