const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;
  const message = isApiError || env.NODE_ENV !== 'production' ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    req.log?.error({ err }, 'Unhandled error');
  } else {
    req.log?.warn({ err: err.message }, 'Request error');
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: isApiError ? err.details : undefined,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = { notFoundHandler, errorHandler };
