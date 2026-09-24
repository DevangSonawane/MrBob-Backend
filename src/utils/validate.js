const ApiError = require('./ApiError');

// Validates req.body/query/params against a Zod schema shaped as
// { body?, query?, params? }. On success, replaces the request property
// with the parsed (and coerced/defaulted) value.
//
// req.query is a getter-only accessor on Express 5's request prototype (no
// setter), so a plain `req.query = ...` silently no-ops in non-strict mode —
// downstream code would keep reading the original, un-coerced query string
// object. Object.defineProperty shadows it with an own writable property on
// this request instance instead, which takes priority over the inherited
// getter.
const validate = (schema) => (req, res, next) => {
  const toValidate = ['body', 'query', 'params'].filter((key) => schema[key]);

  for (const key of toValidate) {
    const result = schema[key].safeParse(req[key]);
    if (!result.success) {
      return next(ApiError.badRequest('Validation failed', result.error.flatten()));
    }
    Object.defineProperty(req, key, {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  next();
};

module.exports = validate;
