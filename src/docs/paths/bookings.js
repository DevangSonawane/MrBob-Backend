const { ref, arrayOf, ok, paginated, fileResponse, jsonBody, multipartBody, pathParam, queryParam, dateParam, sortParams, pageParams, op } = require('../helpers');
const { examples } = require('../components');

const CATEGORIES = 'Service categories';
const FLOW = 'Booking flow';
const ADMIN = 'Bookings (admin)';
const SUPER_ADMIN = 'Super admin panel';
const DISPATCH = 'Dispatch';
const bookingId = pathParam('id', 'Booking id');

const booking = ref('BookingDetail');
const scheduledAt = { type: 'string', format: 'date-time', example: '2026-10-09T10:00:00+05:30', description: 'ISO date-time with a timezone offset' };
const reasonBody = (description, example) =>
  jsonBody({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 5, maxLength: 500, description } } }, { reason: example });

module.exports = {
  tags: [
    { name: CATEGORIES, description: 'The service catalogue (Electrician, Plumber, AC Repair…). Step one of a booking is picking one of these.' },
    {
      name: FLOW,
      description:
        'How a customer books a service. The app walks through **service → date & time → problem description → payment** on its own ' +
        'screens, then sends everything in **one** request. Online payment is confirmed with one more call; pay-after-service needs nothing more.',
    },
    {
      name: ADMIN,
      description:
        'Everything the operations team needs to watch and manage bookings: the full list with filters, headline counts, the detail with its ' +
        'timeline, and the actions (move along, cancel, reschedule, record a payment or a refund). Assigning a professional is under **Dispatch**.',
    },
    { name: DISPATCH, description: 'Matching a booking to a verified professional.' },
  ],
  paths: {
    '/categories': {
      get: op({
        tag: [CATEGORIES, FLOW],
        summary: 'List services to choose from',
        description: 'Active service categories with their price. The first screen of the booking flow.',
        access: 'public',
        responses: { 200: ok('Active categories, by name', arrayOf(ref('ServiceCategory'))) },
      }),
      post: op({
        tag: CATEGORIES,
        summary: 'Create a service category',
        description:
          'Returns **409** if a category with the same name (ignoring case) already exists.\n\n' +
          'To add a picture in the same call, send `multipart/form-data` instead of JSON with the same fields plus the file in `image` ' +
          '(JPEG, PNG or WebP, up to 5 MB). A picture can also be added or changed later with `PUT /categories/{id}/image`.',
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
        errors: [409],
      }),
    },

    '/categories/{id}': {
      delete: op({
        tag: CATEGORIES,
        summary: 'Remove a service category',
        description:
          'Takes the category out of the catalogue: it no longer appears in `GET /categories` and cannot be booked. Past bookings keep it. ' +
          'Creating a category with the same name later brings it back.',
        access: 'ADMIN',
        params: [pathParam('id', 'Category id')],
        responses: { 200: ok('Removed', { type: 'object', properties: { deleted: { type: 'boolean', example: true }, name: { type: 'string' } } }) },
        errors: [404],
      }),
    },

    '/categories/{id}/image': {
      get: op({
        tag: CATEGORIES,
        summary: 'Download a category picture',
        description: 'The path in a category\'s `image` field points here. Cached for a day; the `v` query value changes when the picture does.',
        access: 'public',
        params: [pathParam('id', 'Category id')],
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [404],
      }),
      put: op({
        tag: CATEGORIES,
        summary: 'Upload or replace a category picture',
        description: 'Send as `multipart/form-data` with the file in `image`. JPEG, PNG or WebP, up to 5 MB.',
        access: 'ADMIN',
        params: [pathParam('id', 'Category id')],
        body: multipartBody({ type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } }),
        responses: { 200: ok('Updated category', ref('ServiceCategory')) },
        errors: [404, 503],
      }),
      delete: op({
        tag: CATEGORIES,
        summary: 'Remove a category picture',
        access: 'ADMIN',
        params: [pathParam('id', 'Category id')],
        responses: { 200: ok('Updated category', ref('ServiceCategory')) },
        errors: [404],
      }),
    },

    '/bookings': {
      post: op({
        tag: FLOW,
        summary: 'Create a booking (the whole flow in one request)',
        description:
          'Send what the customer chose on each screen:\n\n' +
          '| Screen | Field |\n|---|---|\n' +
          '| Service | `categoryId` |\n' +
          '| Date & time | `scheduledAt` — at least 60 minutes from now, at most 60 days ahead |\n' +
          '| Problem description | `description` — 10 to 1000 characters |\n' +
          '| Address | `addressId` — one of the customer\'s saved addresses; their default if left out |\n' +
          '| Payment | `paymentMode` — `ONLINE` or `PAY_AFTER_SERVICE` |\n\n' +
          'The price is the service\'s base price. The address is copied onto the booking, so editing or deleting the saved address later ' +
          'does not change where a booked job takes place.\n\n' +
          '**What comes back**\n' +
          '- `PAY_AFTER_SERVICE`: the booking is `PENDING` (confirmed) straight away. Nothing more to do.\n' +
          '- `ONLINE`: the booking is `AWAITING_PAYMENT` and `checkout` holds the gateway order. Open Razorpay Checkout with it, then call ' +
          '**Confirm online payment**. The booking is not sent to professionals until it is paid.\n\n' +
          'Returns **400** if the customer has no saved address, the service is inactive, or the time is out of range; **503** if online ' +
          'payment is chosen but the server has no payment gateway configured.',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            required: ['categoryId', 'scheduledAt', 'description', 'paymentMode'],
            properties: {
              categoryId: { type: 'string', format: 'uuid', description: 'From GET /categories' },
              scheduledAt,
              description: { type: 'string', minLength: 10, maxLength: 1000 },
              addressId: { type: 'string', format: 'uuid', description: 'From GET /users/me/addresses. Defaults to the default address.' },
              paymentMode: { type: 'string', enum: ['ONLINE', 'PAY_AFTER_SERVICE'] },
              partnerId: { type: 'string', format: 'uuid', description: 'Only when the booking comes through a builder / RWA partner' },
            },
          },
          {
            categoryId: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d',
            scheduledAt: '2026-10-09T10:00:00+05:30',
            description: 'The kitchen switchboard sparks when the mixer is plugged in.',
            addressId: examples.address.id,
            paymentMode: 'ONLINE',
          },
        ),
        responses: { 201: ok('Booking created', booking, examples.booking('awaitingPayment')) },
        errors: [503],
      }),
      get: op({
        tag: [FLOW, ADMIN, SUPER_ADMIN],
        summary: 'List bookings',
        description:
          '**Customers** get their own bookings, **professionals** the jobs assigned to them, **admins** every booking.\n\n' +
          'Everyone can use `status`, `scope`, sorting and paging. The remaining filters are for admins and are ignored for other callers. ' +
          'All filters combine (AND).\n\n' +
          '**Admin examples**\n' +
          '- Needs a professional: `status=PENDING,MATCHING`\n' +
          '- Today\'s jobs: `scheduledFrom=2026-10-07&scheduledTo=2026-10-07&sortBy=scheduledAt&sortOrder=asc`\n' +
          '- Refunds to issue: `paymentStatus=REFUND_PENDING`\n' +
          '- One customer\'s history: `customerId=…`\n' +
          '- Find by reference: `search=BK-000123`',
        params: [
          queryParam('status', 'One status, or several separated by commas. One of: AWAITING_PAYMENT, PENDING, MATCHING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED', { type: 'string', example: 'PENDING,MATCHING' }),
          queryParam('scope', '`upcoming` = not finished yet, `past` = completed or cancelled. Ignored when `status` is given.', { type: 'string', enum: ['upcoming', 'past'] }),
          queryParam('search', 'Admin: a booking reference (`BK-000123` matches that booking only), or customer name / phone / email, or part of the address'),
          queryParam('paymentStatus', 'Admin: `UNPAID` means no payment recorded yet', { type: 'string', enum: ['UNPAID', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED'] }),
          queryParam('paymentMode', 'Admin', { type: 'string', enum: ['ONLINE', 'PAY_AFTER_SERVICE'] }),
          queryParam('categoryId', 'Admin: only this service', { type: 'string', format: 'uuid' }),
          queryParam('cityId', 'Admin: only jobs in this city', { type: 'string', format: 'uuid' }),
          queryParam('zoneId', 'Admin: only jobs in this zone', { type: 'string', format: 'uuid' }),
          queryParam('customerId', 'Admin: only this customer\'s bookings', { type: 'string', format: 'uuid' }),
          queryParam('professionalId', 'Admin: only this professional\'s jobs', { type: 'string', format: 'uuid' }),
          queryParam('unassigned', 'Admin: `true` for bookings with no professional yet', { type: 'string', enum: ['true'] }),
          dateParam('scheduledFrom', 'Admin: scheduled on or after this date'),
          dateParam('scheduledTo', 'Admin: scheduled on or before this date'),
          dateParam('createdFrom', 'Admin: booked on or after this date'),
          dateParam('createdTo', 'Admin: booked on or before this date'),
          ...sortParams(['createdAt', 'scheduledAt', 'price'], 'createdAt', 'desc'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of bookings', ref('Booking')) },
      }),
    },

    '/bookings/admin': {
      post: op({
        tag: [ADMIN, SUPER_ADMIN],
        summary: 'Book a service for a customer (web dashboard)',
        description:
          'For a customer who called or walked in. Send **either** `customerId` (an existing customer) **or** `newCustomer` — a phone number that ' +
          'already belongs to a customer reuses that account; otherwise a new customer account is created, which they can later sign in to with ' +
          'that number. Send **either** `addressId` (one of that customer\'s addresses) **or** `address` (saved to their addresses).\n\n' +
          'The booking is `PENDING` and paid after the service. `price` defaults to the service\'s base price. With `professionalId` an approved ' +
          'vendor offering the service is assigned straight away (the booking is `ASSIGNED` and the customer sees the start code). Any time in ' +
          'the future, up to 60 days ahead. The customer is notified.',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['categoryId', 'scheduledAt', 'description'],
            properties: {
              customerId: { type: 'string', format: 'uuid', description: 'An existing customer' },
              newCustomer: { type: 'object', description: 'Instead of customerId', properties: { name: { type: 'string' }, phone: { type: 'string', example: '+919812345678' }, email: { type: 'string', format: 'email' } } },
              addressId: { type: 'string', format: 'uuid', description: "One of the customer's saved addresses" },
              address: {
                type: 'object',
                description: 'Instead of addressId; required for a new customer',
                properties: {
                  label: { type: 'string', enum: ['HOME', 'WORK', 'OTHER'] },
                  line1: { type: 'string' },
                  line2: { type: 'string' },
                  landmark: { type: 'string' },
                  cityId: { type: 'string', format: 'uuid' },
                  zoneId: { type: 'string', format: 'uuid' },
                  state: { type: 'string' },
                  pincode: { type: 'string' },
                  contactName: { type: 'string' },
                  contactPhone: { type: 'string' },
                },
              },
              categoryId: { type: 'string', format: 'uuid' },
              scheduledAt,
              description: { type: 'string', minLength: 3, maxLength: 1000 },
              price: { type: 'number', description: "Defaults to the service's base price" },
              professionalId: { type: 'string', format: 'uuid', description: 'Assign this approved vendor straight away' },
              note: { type: 'string', maxLength: 500, description: 'Added to the timeline, e.g. "Booked over the phone"' },
            },
          },
          {
            newCustomer: { name: 'Neha Sharma', phone: '+919812300000' },
            address: { line1: '22, Hill Road', cityId: examples.address.city.id, zoneId: examples.address.zone.id, state: 'Maharashtra', pincode: '400050' },
            categoryId: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d',
            scheduledAt: '2026-10-19T11:00:00+05:30',
            description: 'Kitchen tap is leaking',
            note: 'Booked over the phone',
          },
        ),
        responses: { 201: ok('Booking created', booking, { ...examples.booking('payLater', 'admin') }) },
        errors: [409],
      }),
    },

    '/bookings/summary': {
      get: op({
        tag: [ADMIN, SUPER_ADMIN],
        summary: 'Booking counts and totals',
        description: 'Headline numbers for the bookings dashboard: how many are in each status, what needs attention, and money collected.',
        access: 'ADMIN',
        responses: {
          200: ok('Summary', ref('BookingSummary'), {
            total: 964,
            byStatus: { AWAITING_PAYMENT: 6, PENDING: 84, MATCHING: 31, ASSIGNED: 76, IN_PROGRESS: 42, COMPLETED: 681, CANCELLED: 44 },
            scheduledToday: 37,
            waitingForProfessional: 115,
            awaitingPayment: 6,
            refundsPending: 3,
            completedUnpaid: 4,
            amountCollected: 248730,
          }),
        },
      }),
    },

    '/bookings/{id}': {
      get: op({
        tag: [FLOW, ADMIN, SUPER_ADMIN],
        summary: 'Get a booking',
        description:
          'The booking with its full timeline. Available to its customer, its assigned professional, and admins (otherwise **403**). ' +
          'Professionals and admins also get the `customer`. While an online booking is unpaid, the customer gets `checkout` again here, ' +
          'so an interrupted payment can be resumed.',
        params: [bookingId],
        responses: { 200: ok('The booking', booking, examples.booking('assigned', 'admin')) },
        errors: [403, 404],
      }),
      delete: op({
        tag: [ADMIN, SUPER_ADMIN],
        summary: 'Delete a booking',
        description:
          'Permanently removes the booking, in any status, with its timeline, payment record, review and work photos. If the vendor was ' +
          'already credited for it, that wallet earning is kept so the money owed is not lost.',
        access: 'SUPER_ADMIN',
        params: [bookingId],
        responses: { 200: ok('Deleted', { type: 'object', properties: { deleted: { type: 'boolean', example: true }, bookingNumber: { type: 'string', example: 'BK-000123' } } }) },
        errors: [404],
      }),
    },

    '/bookings/{id}/completion-images/{imageId}': {
      get: op({
        tag: [FLOW, ADMIN],
        summary: 'Download a photo of the finished work',
        description: 'The `url` of each entry in a booking\'s `completionImages` points here. Available to the booking\'s customer, the vendor on the job, and admins.',
        params: [bookingId, pathParam('imageId', 'Photo id')],
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [403, 404],
      }),
    },

    '/bookings/{id}/payment/confirm': {
      post: op({
        tag: FLOW,
        summary: 'Confirm online payment',
        description:
          'Call this with the three values Razorpay Checkout returns on success. The server verifies the signature, marks the payment ' +
          'successful and moves the booking from `AWAITING_PAYMENT` to `PENDING`.\n\n' +
          'Safe to call twice. If the app never gets to call it (closed mid-payment), the gateway\'s webhook confirms the payment instead, ' +
          'so check the booking\'s status before asking the customer to pay again.\n\n' +
          '**Without gateway keys (development):** `checkout.isTest` is true and any values are accepted as long as `razorpayOrderId` ' +
          'matches `checkout.orderId`.\n\n' +
          'Returns **400** if the signature is wrong or the order does not belong to this booking, **409** if the booking was cancelled.',
        access: 'CUSTOMER',
        params: [bookingId],
        body: jsonBody(
          {
            type: 'object',
            required: ['razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature'],
            properties: { razorpayOrderId: { type: 'string' }, razorpayPaymentId: { type: 'string' }, razorpaySignature: { type: 'string' } },
          },
          { razorpayOrderId: 'order_Pq1x2y3z4A5b6C', razorpayPaymentId: 'pay_Pq9z8y7x6W5v4U', razorpaySignature: '9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d' },
        ),
        responses: { 200: ok('Paid — the booking is now confirmed', booking, examples.booking('pending')) },
        errors: [403, 404, 409],
      }),
    },

    '/bookings/{id}/cancel': {
      post: op({
        tag: [FLOW, ADMIN],
        summary: 'Cancel a booking',
        description:
          'A **customer** can cancel their own booking until work starts (`AWAITING_PAYMENT`, `PENDING`, `MATCHING`, `ASSIGNED`). ' +
          'An **admin** can cancel any booking that is not already completed or cancelled. Otherwise **409**.\n\n' +
          'If the booking was paid online, its payment becomes `REFUND_PENDING` for the team to refund.',
        access: ['CUSTOMER', 'ADMIN'],
        params: [bookingId],
        body: reasonBody('Why it is being cancelled', 'Plans changed, will rebook next week'),
        responses: { 200: ok('Cancelled booking', booking, examples.booking('cancelled')) },
        errors: [404, 409],
      }),
    },

    '/bookings/{id}/reschedule': {
      post: op({
        tag: [FLOW, ADMIN],
        summary: 'Change the date and time',
        description:
          'Allowed until work starts, by the customer or an admin. The same limits as booking apply (60 minutes to 60 days ahead). ' +
          'An assigned professional stays assigned and is notified.',
        access: ['CUSTOMER', 'ADMIN'],
        params: [bookingId],
        body: jsonBody({ type: 'object', required: ['scheduledAt'], properties: { scheduledAt } }, { scheduledAt: '2026-10-10T16:30:00+05:30' }),
        responses: { 200: ok('Rescheduled booking', booking, { ...examples.booking('pending'), scheduledAt: '2026-10-10T11:00:00.000Z' }) },
        errors: [404, 409],
      }),
    },

    '/bookings/{id}/status': {
      patch: op({
        tag: ADMIN,
        summary: 'Move a booking along',
        description:
          'The team\'s override: an admin can set `MATCHING`, `IN_PROGRESS` or `COMPLETED` by hand. Vendors do not use this — they start and ' +
          'finish a job with the customer\'s codes (see **Vendor app — jobs**). Completing a booking here also credits the vendor\'s wallet.\n\n' +
          'Allowed moves: `PENDING → MATCHING`, `ASSIGNED → IN_PROGRESS`, `IN_PROGRESS → COMPLETED`; anything else is **400**. ' +
          'Assigning a professional is done through **Dispatch**, cancelling through **Cancel a booking**, and payment through its own endpoints.',
        access: 'ADMIN',
        params: [bookingId],
        body: jsonBody(
          {
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string', enum: ['MATCHING', 'IN_PROGRESS', 'COMPLETED'] }, note: { type: 'string', maxLength: 500, description: 'Optional note for the timeline' } },
          },
          { status: 'IN_PROGRESS' },
        ),
        responses: { 200: ok('Updated booking', booking, { ...examples.booking('assigned', 'admin'), status: 'IN_PROGRESS', startedAt: '2026-10-09T04:35:00.000Z' }) },
        errors: [404, 409],
      }),
    },

    '/bookings/{id}/payment/collect': {
      post: op({
        tag: ADMIN,
        summary: 'Record payment collected in person',
        description:
          'For `PAY_AFTER_SERVICE` bookings, once the job is `IN_PROGRESS` or `COMPLETED`: records that the professional took the money. ' +
          'By the assigned professional or an admin. Returns **409** if it was already collected or the job has not started.',
        access: ['PROFESSIONAL', 'ADMIN'],
        params: [bookingId],
        body: jsonBody({ type: 'object', required: ['method'], properties: { method: { type: 'string', enum: ['CASH', 'UPI', 'CARD'] } } }, { method: 'UPI' }),
        responses: { 200: ok('Updated booking', booking) },
        errors: [404, 409],
      }),
    },

    '/bookings/{id}/payment/refund': {
      post: op({
        tag: ADMIN,
        summary: 'Mark a refund as issued',
        description:
          'For a cancelled booking whose payment is `REFUND_PENDING`. **This records the refund; it does not send money** — issue the refund ' +
          'in the payment gateway first, then record its reference here. Otherwise **409**.',
        access: 'ADMIN',
        params: [bookingId],
        body: jsonBody(
          { type: 'object', required: ['reference'], properties: { reference: { type: 'string', minLength: 3, maxLength: 200, description: 'Gateway refund id, or a note on how it was refunded' } } },
          { reference: 'rfnd_Pr4s5t6u7V8w9X' },
        ),
        responses: { 200: ok('Updated booking', booking) },
        errors: [404, 409],
      }),
    },
    '/dispatch/bookings/{id}/candidates': {
      get: op({
        tag: DISPATCH,
        summary: 'Find professionals for a booking',
        description:
          'Up to 10 verified, active professionals who serve the booking\'s category, best rated first. A `PENDING` booking becomes `MATCHING`. ' +
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
        responses: { 200: ok('Booking, now `ASSIGNED`', booking, examples.booking('assigned', 'admin')) },
        errors: [404],
      }),
    },
  },
};
