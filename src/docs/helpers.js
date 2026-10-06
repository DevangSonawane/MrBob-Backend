// Small builders for the OpenAPI spec, so every endpoint documents its
// request and responses the same way without repeating the boilerplate.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items) => ({ type: 'array', items });

const SUCCESS = { type: 'boolean', example: true };

// Every successful JSON response is { success: true, data: ... }.
const envelope = (data) => ({ type: 'object', required: ['success', 'data'], properties: { success: SUCCESS, data } });

const jsonContent = (schema, example) => ({ 'application/json': { schema, ...(example !== undefined && { example }) } });

// Responses
const ok = (description, data, example) => ({
  description,
  content: jsonContent(envelope(data), example !== undefined ? { success: true, data: example } : undefined),
});

// List endpoints return { success, items, meta } rather than { success, data }.
const paginated = (description, item) => ({
  description,
  content: jsonContent({
    type: 'object',
    required: ['success', 'items', 'meta'],
    properties: { success: SUCCESS, items: arrayOf(item), meta: ref('PaginationMeta') },
  }),
});

const fileResponse = (description, types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) => ({
  description,
  content: Object.fromEntries(types.map((type) => [type, { schema: { type: 'string', format: 'binary' } }])),
});

// Request bodies
const jsonBody = (schema, example) => ({ required: true, content: jsonContent(schema, example) });
const multipartBody = (schema) => ({ required: true, content: { 'multipart/form-data': { schema } } });

// Parameters
const UUID = { type: 'string', format: 'uuid' };
const pathParam = (name, description, schema = UUID) => ({ in: 'path', name, required: true, description, schema });
const queryParam = (name, description, schema = { type: 'string' }) => ({ in: 'query', name, required: false, description, schema });
const dateParam = (name, description) => queryParam(name, `${description} (YYYY-MM-DD, inclusive)`, { type: 'string', format: 'date' });
const sortParams = (fields, defaultField, defaultOrder) => [
  queryParam('sortBy', `Field to sort by${defaultField ? '' : '. Omit for the default order described above'}`, {
    type: 'string',
    enum: fields,
    ...(defaultField && { default: defaultField }),
  }),
  queryParam('sortOrder', 'Sort direction', { type: 'string', enum: ['asc', 'desc'], default: defaultOrder }),
];
const pageParams = [
  queryParam('page', 'Page number, starting at 1', { type: 'integer', minimum: 1, default: 1 }),
  queryParam('limit', 'Items per page', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
];

const ERROR_RESPONSES = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict', 503: 'ServiceUnavailable' };
const ACCESS_LABEL = {
  public: 'Public — no token needed.',
  user: 'Any signed-in user.',
  CUSTOMER: 'Customers only.',
  PROFESSIONAL: 'Professionals (vendors) only.',
  ADMIN: 'Admins and super admins.',
  SUPER_ADMIN: 'Super admins only.',
};

// Builds one operation.
//   tag:    a tag name, or several — the operation is listed under each
//   access: 'public' | 'user' | a role | an array of roles
//   errors: extra status codes beyond the ones implied by `access` and the
//           presence of a body / parameters (401, 403 and 400 are automatic)
const op = ({ tag, summary, description = '', access = 'user', params = [], body, responses, errors = [] }) => {
  const roles = Array.isArray(access) ? access : [access];
  const isPublic = access === 'public';
  const isRoleGated = !isPublic && access !== 'user';
  const accessLine = roles.map((role) => ACCESS_LABEL[role]).join(' ');

  const codes = new Set(errors);
  if (!isPublic) codes.add(401);
  if (isRoleGated) codes.add(403);
  if (body || params.length) codes.add(400);

  return {
    tags: [tag].flat(),
    summary,
    description: `${description ? `${description}\n\n` : ''}**Access:** ${accessLine}`,
    security: isPublic ? [] : [{ bearerAuth: [] }],
    ...(params.length && { parameters: params }),
    ...(body && { requestBody: body }),
    responses: {
      ...responses,
      ...Object.fromEntries([...codes].sort().map((code) => [code, { $ref: `#/components/responses/${ERROR_RESPONSES[code]}` }])),
    },
  };
};

module.exports = { ref, arrayOf, envelope, ok, paginated, fileResponse, jsonBody, multipartBody, pathParam, queryParam, dateParam, sortParams, pageParams, op, UUID };
