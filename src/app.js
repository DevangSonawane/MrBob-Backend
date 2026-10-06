const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const logger = require('./config/logger');
const swaggerSpec = require('./config/swagger');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// CORS_ORIGIN is a comma-separated list so multiple frontend apps (admin
// dashboard, customer/professional web) can each run on their own local
// port and still hit this API. '*' allows any origin — since credentials
// are enabled, that has to be done by reflecting the request's actual
// Origin header rather than the literal string "*" (the CORS spec forbids
// combining a wildcard origin with credentialed requests).
const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
const allowAnyOrigin = allowedOrigins.includes('*');

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(pinoHttp({ logger }));

// Payments webhook needs the raw request body for signature verification,
// so it's excluded from the global JSON parser (it applies its own
// express.raw() middleware in payments.routes.js).
app.use((req, res, next) => {
  if (req.originalUrl === `${env.API_BASE_PATH}/payments/webhook`) return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use(env.API_BASE_PATH, apiLimiter);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() });
});

// Section descriptions go on their own line under the section title, so
// they stay readable on narrow screens instead of being squeezed beside it.
const swaggerCss = `
  .swagger-ui .opblock-tag { flex-wrap: wrap; }
  .swagger-ui .opblock-tag small { flex: 1 1 100%; order: 3; padding: 6px 0 0; }
`;
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { customCss: swaggerCss, customSiteTitle: 'Home Services API', swaggerOptions: { persistAuthorization: true } }),
);
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.use(env.API_BASE_PATH, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
