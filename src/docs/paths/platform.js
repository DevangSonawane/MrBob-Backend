const env = require('../../config/env');
const { ref, arrayOf, ok, paginated, jsonBody, pathParam, queryParam, pageParams, op } = require('../helpers');

const ZONES = 'Cities & zones';
const PARTNERS = 'Partners';
const DASHBOARD = 'Dashboard';
const point = { type: 'object', properties: { id: { type: 'string', nullable: true }, label: { type: 'string' }, month: { type: 'string', description: 'Trend only: YYYY-MM' }, value: { type: 'integer' } } };

module.exports = {
  tags: [
    {
      name: ZONES,
      description:
        'Where the service operates. Cities contain zones; a vendor picks a city and a home zone during onboarding.\n\n' +
        '**Pincode geofence** — the team lists the pincodes it serves (`/zones/pincodes`). The customer app can check a pincode before ' +
        '(or while) adding an address with `GET /zones/serviceability`, and every saved address carries `serviceable`. Saving an address ' +
        'outside the area is allowed; booking there is refused with **400** and `details.code` `PINCODE_NOT_SERVICEABLE` ' +
        `${env.PINCODE_GEOFENCE === 'strict' ? '(**on** on this server)' : '(**switched off on this server**: `PINCODE_GEOFENCE=off`, so bookings are not refused yet)'}.`,
    },
    { name: PARTNERS, description: 'Builders and resident welfare associations that send bookings.' },
    { name: DASHBOARD, description: 'Aggregates for the admin dashboard.' },
  ],
  paths: {
    '/zones/cities': {
      get: op({ tag: ZONES, summary: 'List active cities', access: 'public', responses: { 200: ok('Active cities, by name', arrayOf(ref('City'))) } }),
      post: op({
        tag: ZONES,
        summary: 'Create a city',
        description: 'Returns **409** if a city with the same name (ignoring case) already exists.',
        access: 'ADMIN',
        body: jsonBody(
          { type: 'object', required: ['name', 'tier'], properties: { name: { type: 'string', minLength: 2 }, tier: { type: 'string', enum: ['TIER_1', 'TIER_2'] } } },
          { name: 'Pune', tier: 'TIER_1' },
        ),
        responses: { 201: ok('City created', ref('City')) },
        errors: [409],
      }),
    },
    '/zones/cities/{id}': {
      delete: op({
        tag: ZONES,
        summary: 'Remove a city',
        description:
          'Takes the city and all its zones out of service: they no longer appear in the lists. Existing users, addresses and bookings keep them. ' +
          'Creating a city with the same name later brings it back (its zones are added back one by one).',
        access: 'ADMIN',
        params: [pathParam('id', 'City id')],
        responses: { 200: ok('Removed', { type: 'object', properties: { deleted: { type: 'boolean', example: true }, name: { type: 'string' } } }) },
        errors: [404],
      }),
    },
    '/zones/{id}': {
      delete: op({
        tag: ZONES,
        summary: 'Remove a zone',
        description: 'Takes the zone out of service: it no longer appears in `GET /zones`. Existing addresses and bookings keep it.',
        access: 'ADMIN',
        params: [pathParam('id', 'Zone id')],
        responses: { 200: ok('Removed', { type: 'object', properties: { deleted: { type: 'boolean', example: true }, name: { type: 'string' } } }) },
        errors: [404],
      }),
    },
    '/zones': {
      get: op({
        tag: ZONES,
        summary: 'List active zones',
        access: 'public',
        params: [queryParam('cityId', 'Only zones in this city', { type: 'string', format: 'uuid' })],
        responses: { 200: ok('Active zones, by name', arrayOf(ref('Zone'))) },
      }),
      post: op({
        tag: ZONES,
        summary: 'Create a zone',
        description: 'Returns **404** for an unknown city and **409** if that city already has a zone with the same name (ignoring case).',
        access: 'ADMIN',
        body: jsonBody(
          { type: 'object', required: ['cityId', 'name'], properties: { cityId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 2 } } },
          { cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Indiranagar' },
        ),
        responses: { 201: ok('Zone created', ref('Zone')) },
        errors: [404, 409],
      }),
    },
    '/zones/serviceability': {
      get: op({
        tag: ZONES,
        summary: 'Is this pincode served?',
        description:
          'For the customer app\'s address screen: tells the customer straight away whether we serve their pincode, and which city and zone it is in. ' +
          'Unknown, paused, or in a city or zone taken out of service: `serviceable: false` and the rest null.',
        access: 'public',
        params: [{ ...queryParam('pincode', '6-digit pincode', { type: 'string', pattern: '^[1-9]\\d{5}$' }), required: true }],
        responses: {
          200: ok('Whether the pincode is served', ref('PincodeCheck'), {
            pincode: '560034',
            serviceable: true,
            city: { id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Bengaluru' },
            zone: { id: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', name: 'Koramangala' },
            areaName: 'Koramangala',
          }),
        },
      }),
    },
    '/zones/pincodes': {
      get: op({
        tag: ZONES,
        summary: 'List serviceable pincodes',
        description: 'Every pincode in the geofence, active or paused, by pincode.',
        access: 'ADMIN',
        params: [
          queryParam('cityId', 'Only this city', { type: 'string', format: 'uuid' }),
          queryParam('zoneId', 'Only this zone', { type: 'string', format: 'uuid' }),
          queryParam('isActive', 'true = only active, false = only paused', { type: 'string', enum: ['true', 'false'] }),
          queryParam('search', 'Pincode prefix (e.g. `5600`) or part of the area name'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of pincodes', ref('ServiceablePincode')) },
      }),
      post: op({
        tag: ZONES,
        summary: 'Add pincodes',
        description:
          'Adds one or many pincodes to a city (and optionally a zone). `pincodes` is an array, or a pasted list separated by commas, spaces or ' +
          'new lines (up to 500). A pincode already listed is moved to this city/zone and switched back on, so sending a list twice is safe.\n\n' +
          'Addresses saved later without a zone take the zone of their pincode.',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['cityId', 'pincodes'],
            properties: {
              cityId: { type: 'string', format: 'uuid' },
              zoneId: { type: 'string', format: 'uuid', nullable: true },
              areaName: { type: 'string', maxLength: 120, nullable: true },
              pincodes: { oneOf: [{ type: 'array', items: { type: 'string', pattern: '^[1-9]\\d{5}$' } }, { type: 'string', description: 'Comma, space or newline separated' }] },
            },
          },
          { cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', zoneId: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', areaName: 'Koramangala', pincodes: ['560034', '560095'] },
        ),
        responses: {
          201: ok(
            'Added',
            { type: 'object', properties: { added: { type: 'integer' }, updated: { type: 'integer' }, items: arrayOf(ref('ServiceablePincode')) } },
            { added: 1, updated: 0, items: [{ id: '9c8b7a6d-4444-4f3e-8a2b-1c0d9e8f7a6b', pincode: '560034', cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', zoneId: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', areaName: 'Koramangala', isActive: true, serviceable: true, city: { id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Bengaluru' }, zone: { id: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', name: 'Koramangala' }, createdAt: '2026-10-28T09:30:00.000Z', updatedAt: '2026-10-28T09:30:00.000Z' }] },
          ),
        },
      }),
    },
    '/zones/pincodes/{id}': {
      patch: op({
        tag: ZONES,
        summary: 'Edit or pause a pincode',
        description: '`isActive: false` pauses bookings in the pincode without removing it. Moving it to another city drops its zone unless one is sent.',
        access: 'ADMIN',
        params: [pathParam('id', 'Pincode row id')],
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              cityId: { type: 'string', format: 'uuid' },
              zoneId: { type: 'string', format: 'uuid', nullable: true },
              areaName: { type: 'string', maxLength: 120, nullable: true },
              isActive: { type: 'boolean' },
            },
          },
          { isActive: false },
        ),
        responses: { 200: ok('Updated', ref('ServiceablePincode'), { ...{ id: '9c8b7a6d-4444-4f3e-8a2b-1c0d9e8f7a6b', pincode: '560034', cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', zoneId: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', areaName: 'Koramangala', isActive: true, serviceable: true, city: { id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Bengaluru' }, zone: { id: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', name: 'Koramangala' }, createdAt: '2026-10-28T09:30:00.000Z', updatedAt: '2026-10-28T09:30:00.000Z' }, isActive: false, serviceable: false }) },
        errors: [404],
      }),
      delete: op({
        tag: ZONES,
        summary: 'Remove a pincode',
        description: 'Takes the pincode out of the geofence. Existing bookings there are not affected.',
        access: 'ADMIN',
        params: [pathParam('id', 'Pincode row id')],
        responses: { 200: ok('Removed', { type: 'object', properties: { deleted: { type: 'boolean', example: true }, pincode: { type: 'string' } } }) },
        errors: [404],
      }),
    },
    '/partners': {
      post: op({
        tag: PARTNERS,
        summary: 'Create a partner',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['type', 'name', 'cityId'],
            properties: { type: { type: 'string', enum: ['BUILDER', 'RWA'] }, name: { type: 'string', minLength: 2 }, cityId: { type: 'string', format: 'uuid' }, contact: { type: 'string' } },
          },
          { type: 'BUILDER', name: 'Prestige Group', cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', contact: '+919000011111' },
        ),
        responses: { 201: ok('Partner created', ref('Partner')) },
      }),
      get: op({
        tag: PARTNERS,
        summary: 'List partners',
        access: 'ADMIN',
        params: [
          queryParam('cityId', 'Only partners in this city', { type: 'string', format: 'uuid' }),
          queryParam('type', 'Only partners of this type', { type: 'string', enum: ['BUILDER', 'RWA'] }),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of partners, newest first', ref('Partner')) },
      }),
    },
    '/dashboard/stats': {
      get: op({ tag: DASHBOARD, summary: 'Headline counts', access: 'ADMIN', responses: { 200: ok('Counts across the platform', ref('DashboardStats')) } }),
    },
    '/dashboard/overview': {
      get: op({
        tag: DASHBOARD,
        summary: 'Home page numbers',
        description:
          'Bookings in total and by status, bookings created in the last 30 days with the change against the 30 before, amount collected, the ' +
          'monthly trend (bookings created per month) and bookings by service and by city. The home page\'s lists use `GET /bookings`.',
        access: 'ADMIN',
        params: [queryParam('months', 'Months in the trend', { type: 'integer', enum: [3, 6, 12], default: 6 })],
        responses: {
          200: ok(
            'Overview',
            {
              type: 'object',
              properties: {
                bookings: { type: 'object', properties: { total: { type: 'integer' }, last30Days: { type: 'integer' }, changePercent: { type: 'number' }, active: { type: 'integer' }, waitingForVendor: { type: 'integer' }, completed: { type: 'integer' }, cancelled: { type: 'integer' }, byStatus: { type: 'object', additionalProperties: { type: 'integer' } } } },
                amountCollected: { type: 'number' },
                trend: { type: 'array', items: point },
                byService: { type: 'array', items: point },
                byCity: { type: 'array', items: point },
              },
            },
            {
              bookings: { total: 964, last30Days: 212, changePercent: 12.4, active: 118, waitingForVendor: 31, completed: 681, cancelled: 44, byStatus: { PENDING: 22, MATCHING: 9, ASSIGNED: 76, IN_PROGRESS: 42, COMPLETED: 681, CANCELLED: 44 } },
              amountCollected: 214350,
              trend: [{ label: 'Sep', month: '2026-09', value: 190 }, { label: 'Oct', month: '2026-10', value: 212 }],
              byService: [{ id: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', label: 'Plumber', value: 310 }],
              byCity: [{ id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', label: 'Mumbai', value: 540 }],
            },
          ),
        },
      }),
    },
    '/dashboard/analytics': {
      get: op({
        tag: DASHBOARD,
        summary: 'Analytics for bookings or vendors',
        description:
          '`type=bookings`: bookings created in the period, completed count and value, amount collected, completion rate, average booking value, ' +
          'monthly volume, and bookings by city, service and status.\n\n' +
          '`type=vendors`: vendors who joined in the period, how many are approved, approval rate, average rating, monthly sign-ups, and vendors ' +
          'by city, by service offered and by onboarding status.\n\n' +
          'Both can be narrowed to one city and/or one service.',
        access: 'ADMIN',
        params: [
          queryParam('type', 'What to analyse', { type: 'string', enum: ['bookings', 'vendors'], default: 'bookings' }),
          queryParam('months', 'Period, counting back from this month', { type: 'integer', enum: [3, 6, 12], default: 6 }),
          queryParam('cityId', 'Only this city', { type: 'string', format: 'uuid' }),
          queryParam('categoryId', 'Only this service', { type: 'string', format: 'uuid' }),
        ],
        responses: {
          200: ok(
            'Analytics',
            { type: 'object', properties: { type: { type: 'string' }, months: { type: 'integer' }, totals: { type: 'object' }, trend: { type: 'array', items: point }, byCity: { type: 'array', items: point }, byService: { type: 'array', items: point }, serviceCoverage: { type: 'array', items: point }, byStatus: { type: 'array', items: point } } },
            {
              type: 'bookings',
              months: 6,
              totals: { bookings: 540, completed: 410, completedValue: 152300, amountCollected: 148900, completionRate: 75.9, averageBookingValue: 371.46 },
              trend: [{ label: 'Sep', month: '2026-09', value: 92 }, { label: 'Oct', month: '2026-10', value: 104 }],
              byCity: [{ id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', label: 'Mumbai', value: 330 }],
              byService: [{ id: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', label: 'Plumber', value: 180 }],
              byStatus: [{ id: 'COMPLETED', label: 'COMPLETED', value: 410 }],
            },
          ),
        },
      }),
    },
  },
};
