const ApiError = require('./ApiError');

// Validates req.body/query/params against a Zod schema shaped as
// { body?, query?, params? }. On success, replaces the request property
// with the parsed (and coerced/defaulted) value.
const validate = (schema) => (req, res, next) => {
  const toValidate = ['body', 'query', 'params'].filter((key) => schema[key]);

  for (const key of toValidate) {
    const result = schema[key].safeParse(req[key]);
    if (!result.success) {
      return next(ApiError.badRequest('Validation failed', result.error.flatten()));
    }
    req[key] = result.data;
  }

  next();
};

module.exports = validate;
