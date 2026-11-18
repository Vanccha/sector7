# syntax=docker/dockerfile:1
# SECTOR7 — çok aşamalı imaj. glibc gerekir (@node-rs/argon2), alpine kullanma.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# NOT: Windows'ta üretilen package-lock.json, argon2'nin wasm yedeğinin bağımlılıklarını
# (@emnapi/*) atlayabiliyor ve `npm ci` düşüyor. Bağımlılık değiştirince kilit dosyasını Linux'ta yenile:
#   docker run --rm -v "${PWD}:/w" -w /w node:24-bookworm-slim npm install --package-lock-only --ignore-scripts
RUN npm ci --no-audit --no-fund

FROM deps AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Build sırasında veritabanı yoktur; DATABASE_URL bilinçli olarak tanımsız.
RUN mkdir -p public && npm run build

# Göç / seed / admin oluşturma imajı: tam node_modules + kaynak.
#   docker compose -f docker-compose.prod.yml run migrate npx tsx src/db/seed.ts
#   docker compose -f docker-compose.prod.yml run migrate npx tsx scripts/create-admin.ts --username ... --name ... --email ...
FROM deps AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY . .
USER node
CMD ["npx", "tsx", "src/db/migrate.ts"]

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown node:node /app /app/uploads
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
