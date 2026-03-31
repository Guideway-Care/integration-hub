FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-spec/package.json lib/api-spec/
COPY scripts/package.json scripts/
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/lib/db/node_modules ./lib/db/node_modules
COPY --from=deps /app/lib/api-zod/node_modules ./lib/api-zod/node_modules
COPY --from=deps /app/scripts/node_modules ./scripts/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY lib/db lib/db
COPY lib/api-zod lib/api-zod
COPY lib/api-spec lib/api-spec
COPY scripts/ scripts/
RUN pnpm --filter @workspace/db run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-zod run build 2>/dev/null || true

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/scripts/node_modules ./scripts/node_modules
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
CMD ["node", "scripts/src/extract.js"]
