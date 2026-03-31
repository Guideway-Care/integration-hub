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
COPY lib/db lib/db
COPY lib/api-zod lib/api-zod
COPY lib/api-spec lib/api-spec
COPY artifacts/api-server/ artifacts/api-server/
RUN npx tsc --build lib/db lib/api-zod
RUN pnpm --filter @workspace/api-server run build

FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
RUN pnpm install --no-frozen-lockfile --prod

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=prod-deps /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=prod-deps /app/package.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
WORKDIR /app/artifacts/api-server
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
