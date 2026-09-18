# The session host in a container (T-1.5.07).
#
# One process, one region, no orchestration: E-4.9's first slice and nothing
# more. Build from the REPOSITORY ROOT, because the host is a pnpm workspace
# package that imports `@sandline/shared` from source:
#
#   docker build -f packages/server/Dockerfile -t sandline-host .
#   docker run --rm -p 8080:8080 sandline-host
#
# TLS IS NOT IN HERE, ON PURPOSE. The process speaks plain `ws://` on PORT and
# expects to sit behind something that terminates TLS and forwards the socket —
# the platform's edge (fly.toml), a Cloudflare tunnel, a Caddy in front of it.
# Certificates in the process would mean certificates in the image, and a
# playtest host that has to be rebuilt when a certificate rotates is a host
# that is down when the playtest starts. The client is served over https, so
# the public address MUST be `wss://` — the browser will not open `ws://` from
# an https page, and it fails silently in the console (docs/DEPLOYING.md).
#
# It runs from TypeScript source through tsx rather than from a compiled
# bundle. That keeps the image and the `pnpm host` a developer runs identical —
# same files, same loader — at the cost of a larger image than a bundled one.
# Bundling is worth doing when a second host exists; today a single small
# instance does not care.

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The pnpm version comes from package.json's `packageManager`, the single source
# of truth CI already relies on. corepack reads it.
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/bot/package.json packages/bot/
COPY packages/tools/package.json packages/tools/
# Playwright is a root devDependency for the parity job; its browsers are not
# wanted here and would otherwise be fetched on install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/server packages/server

FROM node:22-slim
ENV NODE_ENV=production
ENV PORT=8080
# Rooms per process and how long an emptied room lives (T-1.5.05). Overridable
# at deploy time; the platform config carries the playtest values.
ENV MAX_ROOMS=4
ENV ROOM_GRACE_MS=120000
ENV LOG_LEVEL=info
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
# JSON logs on stdout (T-0.07) — `fly logs`, `docker logs`, or anything that
# reads a container's stdout is the log shipper.
CMD ["node_modules/.bin/tsx", "packages/server/src/main.ts"]
