FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src

EXPOSE 4000
# The seed is idempotent. It runs on start only when dashboard credentials are
# configured, so setting SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD on the
# host is enough to create (or change) the super admin login — no shell needed.
CMD ["sh", "-c", "npx prisma migrate deploy && { [ -z \"$SEED_SUPER_ADMIN_EMAIL\" ] || node src/db/seed/index.js || echo 'Seed failed; starting anyway'; } && node src/server.js"]
