const { ref, ok, paginated, jsonBody, pathParam, queryParam, dateParam, sortParams, pageParams, op } = require('../helpers');
const { ROLES, ONBOARDING_STATUSES } = require('../components');

const TAG = 'Users';
const SUPER_ADMIN = 'Super admin panel';
const userId = pathParam('id', 'User id');

module.exports = {
  tags: [
    {
      name: SUPER_ADMIN,
      description:
        'Everything the super admin dashboard needs, in one place: vendors by status with filters, the final decision on a vendor ' +
        '(approve / reject / reopen / send back), and all users with filters. These endpoints are the same ones listed in their own ' +
        'sections — nothing is duplicated on the server. Endpoints marked "Admins and super admins" are open to both; the final ' +
        'decision endpoints are super admin only.',
    },
    { name: TAG, description: 'Account administration, plus the signed-in user\'s own profile.' },
  ],
  paths: {
    '/users': {
      get: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'List all users (with filters)',
        description:
          'Customers, vendors and admins in one list. All filters combine (AND). Each user comes with their city and, for vendors, ' +
          'their onboarding status.\n\n' +
          '**Examples**\n' +
          '- All vendors: `role=PROFESSIONAL`\n' +
          '- Vendors waiting for final approval: `vendorStatus=PENDING_APPROVAL`\n' +
          '- Staff accounts: `role=ADMIN,SUPER_ADMIN`\n' +
          '- Deactivated customers: `role=CUSTOMER&isActive=false`\n' +
          '- Sign-ups this month: `createdFrom=2026-10-01`',
        access: 'ADMIN',
        params: [
          queryParam('role', `One role, or several separated by commas. One of: ${ROLES.join(', ')}`, { type: 'string', example: 'PROFESSIONAL' }),
          queryParam('search', 'Matches name, phone or email (case-insensitive, partial)'),
          queryParam('cityId', 'Only users in this city', { type: 'string', format: 'uuid' }),
          queryParam('isActive', '`true` for active accounts, `false` for deactivated ones', { type: 'boolean' }),
          queryParam('isOnboarded', '`true` for users who finished onboarding (for vendors: approved)', { type: 'boolean' }),
          queryParam('vendorStatus', `Only vendors in these onboarding statuses (comma-separated). One of: ${ONBOARDING_STATUSES.join(', ')}`, { type: 'string' }),
          dateParam('createdFrom', 'Joined on or after this date'),
          dateParam('createdTo', 'Joined on or before this date'),
          ...sortParams(['createdAt', 'name'], 'createdAt', 'desc'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of users', ref('UserListItem')) },
      }),
      post: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Create an account (invite)',
        description:
          'There is no public sign-up for admin accounts: an existing admin creates them here. If `password` is omitted a temporary one is ' +
          'generated and returned **once** in `temporaryPassword`.\n\n' +
          'Only a super admin can create a `SUPER_ADMIN` (otherwise **403**). Returns **409** if the email is taken.',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['name', 'email'],
            properties: {
              name: { type: 'string', minLength: 2 },
              email: { type: 'string', format: 'email' },
              role: { type: 'string', enum: ROLES, default: 'ADMIN' },
              password: { type: 'string', minLength: 8, maxLength: 72, description: 'Omit to auto-generate a temporary password' },
            },
          },
          { name: 'Ops Reviewer', email: 'ops.reviewer@homeops.in', role: 'ADMIN' },
        ),
        responses: {
          201: ok('Account created', {
            type: 'object',
            properties: { user: ref('User'), temporaryPassword: { type: 'string', example: 'k3Jx9QpL2aZt', description: 'Only present when no password was supplied' } },
          }),
        },
        errors: [409],
      }),
    },
    '/users/summary': {
      get: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'User counts',
        description: 'Totals by role, active vs deactivated, onboarded, and sign-ups in the last 30 days.',
        access: 'ADMIN',
        responses: {
          200: ok('Counts', ref('UserSummary'), {
            total: 1486,
            byRole: { CUSTOMER: 1284, PROFESSIONAL: 186, ADMIN: 14, SUPER_ADMIN: 2 },
            active: 1460,
            inactive: 26,
            onboarded: 1321,
            newInLast30Days: 96,
          }),
        },
      }),
    },
    '/users/me': {
      patch: op({
        tag: TAG,
        summary: 'Update my profile',
        description: 'Send at least one field.',
        body: jsonBody(
          { type: 'object', properties: { name: { type: 'string', minLength: 2 }, email: { type: 'string', format: 'email' }, cityId: { type: 'string', format: 'uuid' } } },
          { name: 'Aarav Mehta' },
        ),
        responses: { 200: ok('Updated user', ref('User')) },
        errors: [404],
      }),
    },
    '/users/{id}': {
      get: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Get a user',
        description:
          'The user with their city, their vendor status (if they are a vendor) and usage counts. For a vendor, `professional.id` is the ' +
          'application id to open in `GET /vendor-onboarding/applications/{id}`.',
        access: 'ADMIN',
        params: [userId],
        responses: { 200: ok('The user', ref('UserDetail')) },
        errors: [404],
      }),
    },
    '/users/{id}/active': {
      patch: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Activate or deactivate a user',
        description: 'A deactivated user cannot sign in or refresh tokens. Only a super admin can change a super admin (otherwise **403**).',
        access: 'ADMIN',
        params: [userId],
        body: jsonBody({ type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } }, { isActive: false }),
        responses: { 200: ok('Updated user', ref('User')) },
        errors: [404],
      }),
    },
  },
};
