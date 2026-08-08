# ALiSiO Multi-Tenant PMS

FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
# better-sqlite3 is a native module and its prebuilt binaries target glibc, not
# musl, so on Alpine it is compiled from source — which needs a toolchain.
# Without these, `npm ci` fails and the image never builds.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# bcryptjs, for the operator's tools rather than for the server.
#
# The standalone build inlines it into the compiled server and leaves nothing
# in node_modules, which is right for the application and wrong for
# scripts/provision-org.mjs and scripts/check-isolation.mjs — both import it
# through src/, both run from this image, and both are the only way to reach a
# database bound to loopback inside the compose network. Creating the first
# customer failed with "Cannot find package 'bcryptjs'".
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs

# The SQLite database and guest uploads live here, mounted as volumes by
# deploy/docker-compose.yml. Created up front and owned by the runtime user so a
# first start does not fail writing into a root-owned directory.
RUN mkdir -p /app/data /app/public/uploads \
 && chown -R nextjs:nodejs /app/data /app/public/uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
