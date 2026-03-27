FROM oven/bun:1 AS base
WORKDIR /app

RUN curl -fsSL https://get.pnpm.io/install.sh | bash
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

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
