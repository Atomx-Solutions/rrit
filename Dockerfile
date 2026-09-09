# syntax=docker/dockerfile:1.7
FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY .nvmrc .nvmrc
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts && npm cache clean --force

FROM dependencies AS quality
COPY scripts/check-toolchain.mjs scripts/check-toolchain.mjs
COPY apps/web apps/web
RUN npm run postinstall --workspace apps/web \
  && npm run check

FROM quality AS build
RUN npm run build --workspace apps/web

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM dependencies AS migrations
ENV NODE_ENV=production
COPY apps/web/scripts/migrate.mjs apps/web/scripts/migrate.mjs
COPY apps/web/database/migrations apps/web/database/migrations
CMD ["node", "apps/web/scripts/migrate.mjs"]

FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PROCESS_ROLE=web
RUN addgroup -S rrit && adduser -S -G rrit -u 10001 rrit
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build --chown=rrit:rrit /app/apps/web/.output ./
USER rrit
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health/live || exit 1
CMD ["node", "server/index.mjs"]
