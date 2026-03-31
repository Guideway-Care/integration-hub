FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/lib/db/node_modules ./lib/db/node_modules
COPY --from=deps /app/lib/api-zod/node_modules ./lib/api-zod/node_modules
COPY --from=deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/api-server/node_modules ./node_modules
COPY --from=build /app/artifacts/api-server/package.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
