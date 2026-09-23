const { PrismaClient } = require('@prisma/client');
const env = require('./env');

// Reuse a single instance across hot reloads in dev to avoid exhausting
// Postgres connections.
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
