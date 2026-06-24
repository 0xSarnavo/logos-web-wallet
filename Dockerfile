# ─────────────────────────────────────────────────────────────────────────────
# Logos Wallet UI — self-host image (the Next.js app only).
#
# This image contains the WALLET UI + its API routes. It does NOT contain the
# Logos node, the LEZ sequencer, or the `wallet` CLI — those are external and
# provided by the self-hoster (see docker-compose.yml). Bundling the full
# RISC Zero proving toolchain into an image is impractical, so:
#   • Read features (balances, chain status) work with just a reachable NODE_API.
#   • Write features (create/transfer/faucet) need a `wallet` binary reachable by
#     the container — mounted in (Linux hosts) or run as a sidecar. See README.
# ─────────────────────────────────────────────────────────────────────────────

# 1) Install deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) Build the standalone server bundle
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 3) Minimal runtime
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3344
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output: server + only the needed node_modules
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3344
CMD ["node", "server.js"]
