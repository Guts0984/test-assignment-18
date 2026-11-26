# One build for every service; each target runs one of them.
FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm run build

# Only what the Node services need at run time.
FROM build AS prod
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/web/.next apps/web/src \
  && CI=true pnpm install --offline --frozen-lockfile --prod --filter '!@school/web' --filter '!school' \
  && pnpm --filter @school/db exec prisma generate

FROM base AS server
ENV NODE_ENV=production
COPY --from=prod /app /app
USER node

FROM server AS migrate
CMD ["sh", "-c", "cd packages/db && ./node_modules/.bin/prisma migrate deploy && node dist/seed/main.js"]

FROM server AS api
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM server AS worker
CMD ["node", "apps/worker/dist/main.js"]

FROM server AS paystub
EXPOSE 4000
CMD ["node", "apps/paystub/dist/main.js"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
