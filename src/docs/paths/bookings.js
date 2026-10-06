const { ref, arrayOf, ok, paginated, jsonBody, pathParam, queryParam, pageParams, op } = require('../helpers');
const { BOOKING_STATUSES } = require('../components');

const CATEGORIES = 'Service categories';
const BOOKINGS = 'Bookings';
const DISPATCH = 'Dispatch';
const bookingId = pathParam('id', 'Booking id');

const bookingDetail = {
  allOf: [
    ref('Booking'),
    {
      type: 'object',
      properties: {
        category: ref('ServiceCategory'),
        payment: { allOf: [ref('Payment')], nullable: true },
        professional: {
          type: 'object',
          nullable: true,
          description: 'The assigned professional — only the fields a booking screen needs',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            rating: { type: 'string', example: '4.80' },
            user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', example: 'Ravi Kumar' }, phone: { type: 'string', nullable: true, example: '+919812345678' } } },
          },
        },
      },
    },
  ],
};

module.exports = {
  tags: [
    { name: CATEGORIES, description: 'The service catalogue (Electrician, Plumber, AC Repair…).' },
    {
      name: BOOKINGS,
      description: 'A booking moves `PENDING → MATCHING → ASSIGNED → IN_PROGRESS → COMPLETED`, and can be `CANCELLED` from any stage before completion.',
    },
    { name: DISPATCH, description: 'Matching a booking to a verified professional.' },
  ],
  paths: {
    '/categories': {
      get: op({
        tag: CATEGORIES,
        summary: 'List active service categories',
        access: 'public',
        responses: { 200: ok('Active categories, by name', arrayOf(ref('ServiceCategory'))) },
      }),
      post: op({
        tag: CATEGORIES,
        summary: 'Create a service category',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['name', 'tier', 'basePrice'],
            properties: { name: { type: 'string', minLength: 2 }, tier: { type: 'string', enum: ['REPAIR', 'RENOVATION', 'RECURRING'] }, basePrice: { type: 'number', exclusiveMinimum: true, minimum: 0 } },
          },
          { name: 'Carpentry', tier: 'REPAIR', basePrice: 449 },
        ),
        responses: { 201: ok('Category created', ref('ServiceCategory')) },
      }),
    },
    '/bookings': {
      post: op({
        tag: BOOKINGS,
        summary: 'Create a booking',
        description: 'The price is taken from the category\'s base price. Returns **400** for an unknown or inactive category.',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            required: ['categoryId', 'address'],
            properties: {
              categoryId: { type: 'string', format: 'uuid' },
              address: { type: 'string', minLength: 5 },
              scheduledAt: { type: 'string', format: 'date-time' },
              partnerId: { type: 'string', format: 'uuid', description: 'Set when the booking comes through a builder / RWA partner' },
            },
          },
          { categoryId: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', address: '12, 4th Cross, Koramangala, Bengaluru', scheduledAt: '2026-10-08T04:30:00.000Z' },
        ),
        responses: { 201: ok('Booking created', ref('Booking')) },
      }),
      get: op({
        tag: BOOKINGS,
        summary: 'List bookings',
        description: 'Customers see their own bookings, professionals the ones assigned to them, admins all of them.',
        params: [queryParam('status', 'Only bookings in this status', { type: 'string', enum: BOOKING_STATUSES }), ...pageParams],
        responses: {
          200: paginated('A page of bookings, newest first', { allOf: [ref('Booking'), { type: 'object', properties: { category: ref('ServiceCategory') } }] }),
        },
      }),
    },
    '/bookings/{id}': {
      get: op({
        tag: BOOKINGS,
        summary: 'Get a booking',
        description: 'Available to the booking\'s customer, its assigned professional, and admins (otherwise **403**).',
        params: [bookingId],
        responses: { 200: ok('The booking', bookingDetail) },
        errors: [403, 404],
      }),
    },
    '/bookings/{id}/status': {
      patch: op({
        tag: BOOKINGS,
        summary: 'Move a booking to its next status',
        description: 'Returns **400** if the transition is not allowed from the booking\'s current status.',
        access: ['PROFESSIONAL', 'ADMIN'],
        params: [bookingId],
        body: jsonBody(
          { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: BOOKING_STATUSES.filter((status) => status !== 'PENDING') } } },
          { status: 'IN_PROGRESS' },
        ),
        responses: { 200: ok('Updated booking', ref('Booking')) },
        errors: [404],
      }),
    },
    '/dispatch/bookings/{id}/candidates': {
      get: op({
        tag: DISPATCH,
        summary: 'Find professionals for a booking',
        description:
          'Up to 10 verified professionals who serve the booking\'s category, best rated first. A `PENDING` booking becomes `MATCHING`. ' +
          'Returns **400** if the booking is already assigned or finished.',
        access: 'ADMIN',
        params: [bookingId],
        responses: { 200: ok('Candidates', arrayOf(ref('ProfessionalListItem'))) },
        errors: [404],
      }),
    },
    '/dispatch/bookings/{id}/assign': {
      post: op({
        tag: DISPATCH,
        summary: 'Assign a professional to a booking',
        description: 'The professional must be verified and serve the booking\'s category, and the booking must be `PENDING` or `MATCHING` (otherwise **400**).',
        access: 'ADMIN',
        params: [bookingId],
        body: jsonBody({ type: 'object', required: ['professionalId'], properties: { professionalId: { type: 'string', format: 'uuid' } } }, { professionalId: '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' }),
        responses: { 200: ok('Booking, now `ASSIGNED`', ref('Booking')) },
        errors: [404],
      }),
    },
  },
};
