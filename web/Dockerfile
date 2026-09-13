# syntax=docker/dockerfile:1

# ── dependencies ─────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# Same story as the Go image: on this team's connection the install dies
# partway through with ECONNRESET often enough that one attempt is not a
# build step. npm's own retry settings handle a single flaky request; the
# loop handles the whole install falling over. The registry is an argument
# because which mirror works depends on where you are sitting.
ARG NPM_REGISTRY=https://registry.npmjs.org

COPY package.json package-lock.json ./

# `npm ci` installs exactly the lockfile, which is the point of having one.
# No BuildKit cache mount: this has to build on a plain docker daemon too.
RUN npm config set registry "$NPM_REGISTRY" \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && for attempt in 1 2 3 4 5; do \
           npm ci && break; \
           echo "npm ci failed (attempt $attempt), retrying..."; \
           sleep 5; \
       done; \
    npm ci

# ── build ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The API host is baked into the client bundle at build time — that is what
# NEXT_PUBLIC_ means. Changing it therefore needs a rebuild, not a restart,
# which is why it is a build argument rather than only an environment
# variable on the running container.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
# The account screens have their own client (`lib/platform.ts`) and read this
# variable, not the one above. Nothing set it until now, so it fell through to
# the empty string and the panel always hit the in-process mock handlers — no
# matter where API_BASE_URL pointed. Empty is still the default, but it is now
# a default that was chosen and can be overridden.
ARG NEXT_PUBLIC_PLATFORM_BASE_URL=
ARG NEXT_PUBLIC_ANALYTICS_ENABLED=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_PLATFORM_BASE_URL=$NEXT_PUBLIC_PLATFORM_BASE_URL \
    NEXT_PUBLIC_ANALYTICS_ENABLED=$NEXT_PUBLIC_ANALYTICS_ENABLED \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10001 nodejs && adduser -D -u 10001 -G nodejs nextjs

# `standalone` carries its own minimal node_modules; static/ and public/
# are served by the same server but are not part of that trace, so they are
# copied explicitly. Getting this wrong is the classic "the site loads but
# every stylesheet 404s" deployment.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
