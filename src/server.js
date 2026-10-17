const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./config/prisma');

const wallet = require('./modules/wallet/wallet.service');

// Automatic vendor payouts: every 10 minutes, pay whoever is due (when the
// setting is on and it is a payout day) and check payouts still processing.
// On a host that sleeps when idle, this only runs while the server is awake.
const PAYOUT_INTERVAL_MS = 10 * 60 * 1000;
const payoutTick = async () => {
  try {
    await wallet.refreshProcessing();
    await wallet.runAutomaticPayouts();
  } catch (err) {
    logger.error({ err: err.message }, 'Automatic payout run failed');
  }
};
const payoutTimer = globalThis.setInterval(payoutTick, PAYOUT_INTERVAL_MS);
globalThis.setTimeout(payoutTick, 30 * 1000).unref();
payoutTimer.unref();

const server = app.listen(env.PORT, () => {
  logger.info(`Home Services backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  logger.info(`Swagger docs: http://localhost:${env.PORT}/api-docs`);
});

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
