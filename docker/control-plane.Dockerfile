FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY artifacts/control-plane/package.json artifacts/control-plane/
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/lib/db/node_modules ./lib/db/node_modules
COPY --from=deps /app/lib/api-zod/node_modules ./lib/api-zod/node_modules
COPY --from=deps /app/lib/api-client-react/node_modules ./lib/api-client-react/node_modules
COPY --from=deps /app/artifacts/control-plane/node_modules ./artifacts/control-plane/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY lib/ lib/
COPY artifacts/control-plane/ artifacts/control-plane/
RUN npx tsc --build lib/db lib/api-zod lib/api-client-react
RUN pnpm --filter @workspace/control-plane run build

FROM nginx:alpine AS runtime
RUN apk add --no-cache gettext
COPY --from=build /app/artifacts/control-plane/dist/public /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV API_UPSTREAM=http://localhost:8081
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
