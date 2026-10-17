const { ref, arrayOf, ok, paginated, jsonBody, pathParam, queryParam, sortParams, pageParams, op } = require('../helpers');
const { examples } = require('../components');

const CUSTOMER = 'Customer app — profile & bookings';
const VENDOR = 'Vendor app — profile & bookings';

const bookingId = pathParam('id', 'Booking id');
const gender = { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] };
const text = (maxLength, description) => ({ type: 'string', maxLength, nullable: true, ...(description && { description }) });
const deleted = { type: 'object', properties: { deleted: { type: 'boolean' } } };
const place = { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } };

const bookingFilters = [
  queryParam('status', 'One status, or several separated by commas. One of: AWAITING_PAYMENT, PENDING, MATCHING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED', { type: 'string', example: 'ASSIGNED,IN_PROGRESS' }),
  queryParam('scope', '`upcoming` = not finished yet, `past` = completed or cancelled. Ignored when `status` is given.', { type: 'string', enum: ['upcoming', 'past'] }),
  ...sortParams(['createdAt', 'scheduledAt', 'price'], 'createdAt', 'desc'),
  ...pageParams,
];

const application = examples.application('APPROVED');
const vendorProfileExample = {
  userId: '9c8b7a6d-5555-4f4e-8d3c-2b1a0f9e8d7c',
  professionalId: application.id,
  status: 'APPROVED',
  isVerified: true,
  rating: 4.7,
  profilePhoto: application.profilePhoto,
  joinedAt: '2026-10-06T10:42:00.000Z',
  personalDetails: application.personalDetails,
  services: application.services,
  jobs: { total: 48, open: 2, completed: 43, cancelled: 3 },
};

const vendorProfile = {
  type: 'object',
  properties: {
    userId: { type: 'string', format: 'uuid' },
    professionalId: { type: 'string', format: 'uuid', nullable: true, description: 'Null until the vendor has saved anything in onboarding' },
    status: { type: 'string', enum: ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'] },
    isVerified: { type: 'boolean', description: 'True once approved — only then is the vendor sent jobs' },
    rating: { type: 'number', example: 4.7 },
    profilePhoto: { type: 'string', nullable: true, description: 'API path of the photo (needs the token), or null' },
    joinedAt: { type: 'string', format: 'date-time', nullable: true },
    personalDetails: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: text(),
        email: text(),
        dateOfBirth: { type: 'string', format: 'date', nullable: true },
        gender: { ...gender, nullable: true },
        alternatePhone: text(),
        city: place,
        addressLine1: text(),
        addressLine2: text(),
        landmark: text(),
        pincode: text(),
        state: text(),
        emergencyContactName: text(),
        emergencyContactPhone: text(),
      },
    },
    services: {
      type: 'object',
      properties: {
        categories: arrayOf({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, tier: { type: 'string' } } }),
        experienceYears: { type: 'integer', nullable: true },
        homeZone: place,
      },
    },
    jobs: {
      type: 'object',
      description: 'How many bookings have been assigned to this vendor',
      properties: { total: { type: 'integer' }, open: { type: 'integer', description: 'Assigned or in progress' }, completed: { type: 'integer' }, cancelled: { type: 'integer' } },
    },
  },
};

const DELETE_NOTE =
  'Permanent. The account can no longer sign in and its personal details are wiped. Past bookings are kept without them, and the phone ' +
  'number becomes free to register again. Returns **409** while a booking is assigned or in progress.';

module.exports = {
  tags: [
    {
      name: CUSTOMER,
      description:
        'Everything the customer app needs after onboarding, under one prefix: the signed-in customer\'s profile (view, edit, delete) and ' +
        'their bookings (list and detail). Addresses, the photo and changing the phone number are under **My account**; creating a booking ' +
        'is under **Booking flow**.',
    },
    {
      name: VENDOR,
      description:
        'Everything the vendor app needs after onboarding: the signed-in vendor\'s profile (view, edit, delete) and the jobs assigned to ' +
        'them (list and detail). Starting and completing a job is `PATCH /bookings/{id}/status`.',
    },
  ],
  paths: {
    '/customer/profile': {
      get: op({
        tag: CUSTOMER,
        summary: 'Get my profile',
        description: 'The signed-in customer with their city and saved addresses (default first).',
        access: 'CUSTOMER',
        responses: { 200: ok('The profile', ref('UserProfile'), examples.me()) },
        errors: [404],
      }),
      patch: op({
        tag: CUSTOMER,
        summary: 'Edit my profile',
        description: 'Send only the fields that change. Returns **409** if the email belongs to another account.',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              gender,
              email: { type: 'string', format: 'email' },
              dateOfBirth: { type: 'string', format: 'date', nullable: true, description: 'Send null to clear it' },
            },
          },
          { name: 'Aarav Mehta', email: 'aarav@example.com', dateOfBirth: '1994-03-21' },
        ),
        responses: { 200: ok('Updated profile', ref('UserProfile'), examples.me()) },
        errors: [404, 409],
      }),
      delete: op({
        tag: CUSTOMER,
        summary: 'Delete my account',
        description: `${DELETE_NOTE} Open booking requests are cancelled and saved addresses are removed.`,
        access: 'CUSTOMER',
        responses: { 200: ok('Account deleted', deleted, { deleted: true }) },
        errors: [404, 409],
      }),
    },
    '/customer/bookings': {
      get: op({
        tag: CUSTOMER,
        summary: 'List my bookings',
        description: 'The signed-in customer\'s bookings, newest first. Use `scope=upcoming` and `scope=past` for the two tabs of a bookings screen.',
        access: 'CUSTOMER',
        params: bookingFilters,
        responses: { 200: paginated('A page of bookings', ref('Booking')) },
      }),
    },
    '/customer/bookings/{id}': {
      get: op({
        tag: CUSTOMER,
        summary: 'Get one of my bookings',
        description:
          'The booking with its timeline, the assigned professional, the payment, and `actions` saying what the customer may do next ' +
          '(pay, cancel, reschedule). Returns **403** for a booking that belongs to someone else.',
        access: 'CUSTOMER',
        params: [bookingId],
        responses: { 200: ok('The booking', ref('BookingDetail'), examples.booking('assigned')) },
        errors: [403, 404],
      }),
    },

    '/customer/bookings/{id}/rating': {
      post: op({
        tag: CUSTOMER,
        summary: 'Rate the vendor of a completed booking',
        description:
          'Once the booking is `COMPLETED` (otherwise **409**; `actions.canRate` says when). 1 to 5 stars and an optional comment. Sending again ' +
          'changes the rating. Returns the booking with its `ratings`. **404** for a booking that is not the customer\'s.',
        access: 'CUSTOMER',
        params: [bookingId],
        body: jsonBody(
          { type: 'object', required: ['rating'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 } } },
          { rating: 5, comment: 'Very professional and on time' },
        ),
        responses: { 200: ok('The booking, with the rating', ref('BookingDetail')) },
        errors: [404, 409],
      }),
    },

    '/vendor/profile': {
      get: op({
        tag: VENDOR,
        summary: 'Get my profile',
        description:
          'The signed-in vendor: verification status, rating, personal details, the services they offer and how many jobs they have had. ' +
          'Documents and bank details stay under vendor onboarding (`GET /vendor-onboarding`).',
        access: 'PROFESSIONAL',
        responses: { 200: ok('The profile', vendorProfile, vendorProfileExample) },
        errors: [404],
      }),
      patch: op({
        tag: VENDOR,
        summary: 'Edit my profile',
        description:
          'Works at any stage, including after approval. Send only the fields that change; `null` clears a field (name and email can only be ' +
          'replaced). `categories` replaces the whole list of services.\n\n' +
          'Returns **400** for an unknown city, a zone outside the chosen city, or an unknown service; **409** if the email belongs to ' +
          'another account. Changing the city without sending `homeZoneId` clears the zone. The phone number, identity documents and bank ' +
          'details cannot be changed here.',
        access: 'PROFESSIONAL',
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              name: { type: 'string', maxLength: 100 },
              email: { type: 'string', format: 'email' },
              gender: { ...gender, nullable: true },
              dateOfBirth: { type: 'string', format: 'date', nullable: true },
              alternatePhone: text(20),
              addressLine1: text(200),
              addressLine2: text(200),
              landmark: text(200),
              pincode: text(10),
              state: text(60),
              cityId: { type: 'string', format: 'uuid', nullable: true, description: 'From GET /zones/cities' },
              homeZoneId: { type: 'string', format: 'uuid', nullable: true, description: 'From GET /zones?cityId=…' },
              emergencyContactName: text(100),
              emergencyContactPhone: text(20),
              experienceYears: { type: 'integer', minimum: 0, maximum: 60, nullable: true },
              categories: { ...arrayOf({ type: 'string', format: 'uuid' }), maxItems: 20, description: 'Ids from GET /categories' },
            },
          },
          { addressLine1: '14, 2nd Main Road', pincode: '560034', experienceYears: 7 },
        ),
        responses: { 200: ok('Updated profile', vendorProfile, vendorProfileExample) },
        errors: [404, 409],
      }),
      delete: op({
        tag: VENDOR,
        summary: 'Delete my account',
        description: `${DELETE_NOTE} The vendor's documents and bank details are erased as well.`,
        access: 'PROFESSIONAL',
        responses: { 200: ok('Account deleted', deleted, { deleted: true }) },
        errors: [404, 409],
      }),
    },
    '/vendor/bookings': {
      get: op({
        tag: VENDOR,
        summary: 'List my jobs',
        description: 'The bookings assigned to the signed-in vendor, newest first. Use `scope=upcoming` for current jobs and `scope=past` for history.',
        access: 'PROFESSIONAL',
        params: bookingFilters,
        responses: { 200: paginated('A page of bookings', ref('Booking')) },
      }),
    },
    '/vendor/bookings/{id}': {
      get: op({
        tag: VENDOR,
        summary: 'Get one of my jobs',
        description:
          'The booking with its timeline, the customer to visit, the address and the payment. `actions.canCollectPayment` says whether the ' +
          'vendor should take payment on site. Returns **403** for a booking that is not assigned to this vendor.',
        access: 'PROFESSIONAL',
        params: [bookingId],
        responses: { 200: ok('The booking', ref('BookingDetail'), examples.booking('assigned', 'admin')) },
        errors: [403, 404],
      }),
    },
    '/vendor/bookings/{id}/rating': {
      post: op({
        tag: VENDOR,
        summary: 'Rate the customer of a completed job',
        description:
          'Once the booking is `COMPLETED` (otherwise **409**; `actions.canRate` says when). 1 to 5 stars and an optional comment. Sending again ' +
          'changes the rating. Returns the booking with its `ratings`. **404** for a job that is not the vendor\'s.',
        access: 'PROFESSIONAL',
        params: [bookingId],
        body: jsonBody(
          { type: 'object', required: ['rating'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 } } },
          { rating: 5, comment: 'Clear instructions, easy to work with' },
        ),
        responses: { 200: ok('The booking, with the rating', ref('BookingDetail')) },
        errors: [404, 409],
      }),
    },
  },
};
