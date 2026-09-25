# syntax=docker/dockerfile:1

FROM node:22.14.0-alpine3.21 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# The lockfile is maintained with npm 11; pinning it avoids npm 10's
# incompatible optional-dependency validation while keeping installs reproducible.
RUN npm install --global npm@11.6.2 \
    && npm ci

FROM node:22.14.0-alpine3.21 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.14.0-alpine3.21 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# output:"standalone" traces server code only -- it does not copy public/, so the real-data
# demo files under public/demo/replenishment/ must be copied in explicitly or the auto-load
# demo on /replenishment 404s in this image even though it works fine outside Docker.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3000/api/health',r=>{if(r.statusCode!==200)process.exit(1);r.resume()}).on('error',()=>process.exit(1))"]

CMD ["node", "server.js"]
