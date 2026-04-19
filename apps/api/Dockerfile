# Build stage — monorepo root context
FROM oven/bun:1.1.34-alpine AS base
WORKDIR /app

# Copy manifests for workspace install
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install deps (use production-safe flags)
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

ENV NODE_ENV=production
EXPOSE 3000

WORKDIR /app/apps/api
CMD ["bun", "src/index.ts"]
