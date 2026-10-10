FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

COPY apps/frontend/ ./apps/frontend/
COPY packages/shared/ ./packages/shared/
COPY tsconfig.base.json ./

WORKDIR /app/apps/frontend
RUN bun run vite build

FROM nginxinc/nginx-unprivileged:stable-alpine-slim@sha256:3af0c10d960cc2502427fe1219c52989d309e7d65596869c60a34fd2fa2406f0 AS runner
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/security-headers.conf /etc/nginx/snippets/security-headers.conf
USER nginx
EXPOSE 8080
