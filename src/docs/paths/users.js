const { ref, ok, paginated, jsonBody, pathParam, queryParam, dateParam, sortParams, pageParams, op } = require('../helpers');
const { ROLES, ONBOARDING_STATUSES } = require('../components');

const TAG = 'Users';
const SUPER_ADMIN = 'Super admin panel';
const userId = pathParam('id', 'User id');

const placeRef = { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } };
const text = { type: 'string', nullable: true };
const location = {
  type: 'object',
  properties: {
    userId: { type: 'string', format: 'uuid' },
    isVendor: { type: 'boolean', description: 'True when this is the address on a vendor profile' },
    addressLine1: text,
    addressLine2: text,
    landmark: text,
    state: text,
    pincode: text,
    city: placeRef,
    zone: placeRef,
  },
};
const locationExample = {
  userId: '9c8b7a6d-5555-4f4e-8d3c-2b1a0f9e8d7c',
  isVendor: false,
  addressLine1: '12, 4th Cross, 5th Block',
  addressLine2: 'Koramangala',
  landmark: 'Near Forum Mall',
  state: 'Karnataka',
  pincode: '560034',
  city: { id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Bengaluru' },
  zone: { id: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', name: 'Koramangala' },
};

module.exports = {
  tags: [
    {
      name: SUPER_ADMIN,
      description:
        'Everything the super admin dashboard needs, in one place: vendors by status with filters, the final decision on a vendor ' +
        '(approve / reject / reopen / send back), and all users — list with filters, view, edit and delete. These endpoints are the same ones listed in their own ' +
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
          '- All customers: `role=CUSTOMER`\n' +
          '- Deactivated customers: `role=CUSTOMER&isActive=false`\n' +
          '- Deleted accounts: `deleted=true`\n' +
          '- Sign-ups this month: `createdFrom=2026-10-01`',
        access: 'ADMIN',
        params: [
          queryParam('role', `One role, or several separated by commas. One of: ${ROLES.join(', ')}`, { type: 'string', example: 'PROFESSIONAL' }),
          queryParam('search', 'Matches name, phone or email (case-insensitive, partial)'),
          queryParam('gender', 'Only users of this gender', { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] }),
          queryParam('cityId', 'Only users whose default address is in this city', { type: 'string', format: 'uuid' }),
          queryParam('deleted', '`true` lists deleted accounts only. By default deleted accounts are hidden.', { type: 'boolean' }),
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
        description: 'Totals by role, active vs deactivated, onboarded, and sign-ups in the last 30 days. Deleted accounts are counted separately.',
        access: 'ADMIN',
        responses: {
          200: ok('Counts', ref('UserSummary'), {
            total: 1486,
            byRole: { CUSTOMER: 1284, PROFESSIONAL: 186, ADMIN: 14, SUPER_ADMIN: 2 },
            active: 1460,
            inactive: 26,
            onboarded: 1321,
            newInLast30Days: 96,
            deleted: 7,
          }),
        },
      }),
    },
    '/users/{id}': {
      get: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Get a user',
        description:
          'The user with their city, saved addresses, vendor status (if they are a vendor) and usage counts. For a vendor, `professional.id` is the ' +
          'application id to open in `GET /vendor-onboarding/applications/{id}`.',
        access: 'ADMIN',
        params: [userId],
        responses: { 200: ok('The user', ref('UserDetail')) },
        errors: [404],
      }),
      patch: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Edit a user',
        description:
          'Send only the fields that change. Returns **409** if the email or phone belongs to another account.\n\n' +
          '**Role changes** are limited to `CUSTOMER`, `ADMIN` and `SUPER_ADMIN`: the `PROFESSIONAL` role is granted through vendor ' +
          'onboarding and cannot be set or removed here. You cannot change your own role or deactivate yourself (**400**).',
        access: 'SUPER_ADMIN',
        params: [userId],
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              email: { type: 'string', format: 'email' },
              phone: { type: 'string', example: '+919812345678' },
              gender: { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] },
              dateOfBirth: { type: 'string', format: 'date', nullable: true },
              role: { type: 'string', enum: ROLES },
              isActive: { type: 'boolean' },
            },
          },
          { name: 'Aarav Mehta', email: 'aarav.mehta@example.com' },
        ),
        responses: { 200: ok('Updated user', ref('UserDetail')) },
        errors: [404, 409],
      }),
      delete: op({
        tag: [TAG, SUPER_ADMIN],
        summary: 'Delete a user',
        description:
          'Permanent, and the same as the user deleting their own account: they can no longer sign in and their personal details are wiped ' +
          '(name, phone, email, photo, addresses; for a vendor also the Aadhaar, PAN, bank details and uploaded documents). Open booking ' +
          'requests are cancelled and AMC plans ended. Past bookings and reviews are kept. The row remains, marked with `deletedAt`, and ' +
          'shows up under `GET /users?deleted=true`.\n\n' +
          'Returns **409** while the user has a booking assigned or in progress, and **400** if you try to delete yourself. To block a ' +
          'user without erasing anything, deactivate them instead.',
        access: 'SUPER_ADMIN',
        params: [userId],
        responses: { 200: ok('User deleted', { type: 'object', properties: { deleted: { type: 'boolean' } } }, { deleted: true }) },
        errors: [404, 409],
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
    '/users/{id}/location': {
      get: op({
        tag: [TAG, SUPER_ADMIN],
        summary: "Get a user's address, city and zone",
        description:
          'One address with its city and zone. For a vendor it is the address on their vendor profile and the zone they work from; ' +
          'for anyone else it is their default address.',
        access: 'ADMIN',
        params: [userId],
        responses: { 200: ok('Where the user is based', location, locationExample) },
        errors: [404],
      }),
      put: op({
        tag: [TAG, SUPER_ADMIN],
        summary: "Edit a user's address, city and zone",
        description:
          'Only the fields sent are changed; `null` or an empty string clears one. The city must be active and the zone must belong to it ' +
          '(otherwise **400**). Changing the city without sending a zone clears the zone.',
        access: 'SUPER_ADMIN',
        params: [userId],
        body: jsonBody(
          {
            type: 'object',
            properties: {
              addressLine1: { type: 'string', maxLength: 200, nullable: true },
              addressLine2: { type: 'string', maxLength: 200, nullable: true },
              landmark: { type: 'string', maxLength: 200, nullable: true },
              state: { type: 'string', maxLength: 60, nullable: true },
              pincode: { type: 'string', maxLength: 10, nullable: true },
              cityId: { type: 'string', format: 'uuid', nullable: true, description: 'From GET /zones/cities' },
              zoneId: { type: 'string', format: 'uuid', nullable: true, description: 'From GET /zones?cityId=…' },
            },
          },
          { addressLine1: '12, 4th Cross, 5th Block', cityId: locationExample.city.id, zoneId: locationExample.zone.id, state: 'Karnataka', pincode: '560034' },
        ),
        responses: { 200: ok('The saved location', location, locationExample) },
        errors: [404],
      }),
    },
  },
};
