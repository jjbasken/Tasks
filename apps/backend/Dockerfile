FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS base
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
