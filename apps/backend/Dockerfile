FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/pnpm/pnpm/releases/latest/download/pnpm-linux-x64 \
    -o /usr/local/bin/pnpm && chmod +x /usr/local/bin/pnpm

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/backend/ ./apps/backend/
COPY packages/shared/ ./packages/shared/

WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
