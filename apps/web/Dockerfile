# Build stage — builds the SPA bundle
FROM oven/bun:1.1.34-alpine AS builder
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build-time configuration — API_ORIGIN lets the SPA know where to proxy /api calls.
ARG API_ORIGIN
ENV VITE_API_ORIGIN=${API_ORIGIN:-http://localhost:3000}

WORKDIR /app/apps/web
RUN bun run build

# Runtime stage — minimal static server via Bun
FROM oven/bun:1.1.34-alpine AS runtime
WORKDIR /app

COPY --from=builder /app/apps/web/dist ./dist
COPY apps/web/serve.ts ./serve.ts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "serve.ts"]
