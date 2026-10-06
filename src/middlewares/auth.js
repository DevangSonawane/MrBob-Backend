const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { isSuperAdmin } = require('../utils/roles');

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing bearer token'));
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
};

// Usage: authorize('ADMIN'), authorize('ADMIN', 'PROFESSIONAL')
// A SUPER_ADMIN passes any check that admits ADMIN; authorize('SUPER_ADMIN')
// admits super admins only.
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized());
  }
  const { role } = req.user;
  const allowed = roles.includes(role) || (isSuperAdmin(role) && roles.includes('ADMIN'));
  if (roles.length && !allowed) {
    return next(ApiError.forbidden('You do not have access to this resource'));
  }
  next();
};

module.exports = { authenticate, authorize };
