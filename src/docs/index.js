const env = require('../config/env');
const { schemas, responses } = require('./components');

// The OpenAPI document served at /api-docs. Each file in ./paths documents
// one area of the API and lists its tags; the order here is the order the
// sections appear in Swagger UI. tests/apiDocs.test.js fails if a route is
// added without being documented here (or the other way round).
const sections = [
  require('./paths/vendorOnboarding'),
  require('./paths/users'), // also defines the "Super admin panel" section
  require('./paths/auth'),
  require('./paths/onboarding'),
  require('./paths/professionals'),
  require('./paths/bookings'),
  require('./paths/commerce'),
  require('./paths/platform'),
];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Home Services Platform API',
    version: '1.0.0',
    description: [
      'Backend API for the customer app, the vendor (professional) app and the admin dashboard.',
      '',
      '**Conventions**',
      '- Successful responses are `{ "success": true, "data": … }`; list endpoints return `{ "success": true, "items": […], "meta": { page, limit, total, totalPages } }`.',
      '- Errors are `{ "success": false, "message": "…", "details": … }` with a matching HTTP status.',
      '- Protected endpoints need `Authorization: Bearer <accessToken>`. Click **Authorize** and paste an access token to try them here.',
      '- Each endpoint states who may call it under **Access**. A super admin may call anything an admin may.',
      '',
      '**Vendor onboarding in five steps** — the first five sections below, in the order the vendor app uses them: ',
      'phone number → verify OTP → enter details → verify vendor → vendor verified.',
      '',
      '**Super admin panel** — the section after those gathers what the super admin dashboard uses: vendors by status, the final decision, and all users.',
    ].join('\n'),
  },
  // Relative, so "Try it out" always calls the server the docs were loaded
  // from — localhost in development, the real host once deployed.
  servers: [{ url: env.API_BASE_PATH, description: 'This server' }],
  tags: sections.flatMap((section) => section.tags),
  paths: Object.assign({}, ...sections.map((section) => section.paths)),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
    responses,
  },
};
