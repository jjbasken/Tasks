FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# Copy source
COPY apps/backend/ ./apps/backend/
COPY packages/shared/ ./packages/shared/

WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
