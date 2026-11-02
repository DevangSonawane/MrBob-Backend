const { ref, ok, paginated, jsonBody, pathParam, queryParam, dateParam, pageParams, op } = require('../helpers');

const money = (count, amount) => ({ type: 'object', properties: { count: { type: 'integer', example: count }, amount: { type: 'number', example: amount } } });
const customerRef = { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, phone: { type: 'string', nullable: true }, email: { type: 'string', nullable: true } } };
const paymentListItem = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    amount: { type: 'number', example: 499 },
    status: { type: 'string', enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED'] },
    method: { type: 'string', nullable: true, description: '`ONLINE` (gateway), or how it was collected after the service: `CASH`, `UPI`, `CARD`' },
    gatewayRef: { type: 'string', nullable: true, description: 'Razorpay order id' },
    gatewayPaymentId: { type: 'string', nullable: true },
    refundReference: { type: 'string', nullable: true },
    paidAt: { type: 'string', format: 'date-time', nullable: true },
    refundedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    kind: { type: 'string', enum: ['BOOKING', 'SUBSCRIPTION'] },
    booking: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, bookingNumber: { type: 'string', example: 'BK-000123' }, paymentMode: { type: 'string', enum: ['ONLINE', 'PAY_AFTER_SERVICE'] }, service: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } } },
    subscription: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, plan: { type: 'string' } } },
    customer: customerRef,
  },
};

const PAYMENTS = 'Payments';
const AMC = 'AMC subscriptions';
const REVIEWS = 'Reviews';
const ratingStats = { type: 'object', properties: { average: { type: 'number', nullable: true }, count: { type: 'integer' }, distribution: { type: 'object', description: 'How many of each star rating, 5 to 1', additionalProperties: { type: 'integer' } } } };
const subscriptionId = pathParam('id', 'Subscription id');

module.exports = {
  tags: [
    { name: PAYMENTS, description: 'Payment records and the gateway webhook. Paying for a booking is part of the **Booking flow**.' },
    { name: AMC, description: 'Annual maintenance contracts.' },
    { name: REVIEWS, description: 'Customer ratings of completed bookings. A professional\'s rating is the average of their reviews.' },
  ],
  paths: {
    '/payments': {
      get: op({
        tag: PAYMENTS,
        summary: 'List all payments (team)',
        description:
          'Every payment: online booking payments, money collected after the service, refunds and AMC payments, newest first, each with what it ' +
          'paid for and who paid. `search` takes a booking reference (`BK-000123`), a Razorpay order or payment id, or the customer\'s name, phone or email.',
        access: 'ADMIN',
        params: [
          queryParam('status', 'One status, or several separated by commas', { type: 'string', example: 'SUCCESS,REFUND_PENDING' }),
          queryParam('kind', 'What it paid for', { type: 'string', enum: ['BOOKING', 'SUBSCRIPTION'] }),
          queryParam('method', 'How it was paid', { type: 'string', enum: ['ONLINE', 'CASH', 'UPI', 'CARD'] }),
          dateParam('createdFrom', 'Created on or after this date'),
          dateParam('createdTo', 'Created on or before this date'),
          queryParam('search', 'Booking reference, gateway id, or customer name / phone / email'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of payments', paymentListItem) },
      }),
    },
    '/payments/summary': {
      get: op({
        tag: PAYMENTS,
        summary: 'Payment totals (team)',
        description: 'Count and amount (INR) of payments collected (all, and online only), refunds due, refunded, and failed.',
        access: 'ADMIN',
        responses: {
          200: ok(
            'Totals',
            { type: 'object', properties: { collected: money(412, 148900), collectedOnline: money(160, 70210), refundPending: money(3, 1497), refunded: money(9, 4191), failed: money(14, 6986) } },
            { collected: { count: 412, amount: 148900 }, collectedOnline: { count: 160, amount: 70210 }, refundPending: { count: 3, amount: 1497 }, refunded: { count: 9, amount: 4191 }, failed: { count: 14, amount: 6986 } },
          ),
        },
      }),
    },
    '/payments/{id}': {
      get: op({
        tag: PAYMENTS,
        summary: 'Get a payment',
        description: 'Available to admins and to the customer whose booking or subscription it pays for (otherwise **403**).',
        params: [pathParam('id', 'Payment id')],
        responses: { 200: ok('The payment', ref('Payment')) },
        errors: [403, 404],
      }),
    },
    '/payments/webhook': {
      post: op({
        tag: PAYMENTS,
        summary: 'Razorpay webhook',
        description:
          'Called by Razorpay, not by client apps. The raw body is verified against the `X-Razorpay-Signature` header (HMAC-SHA256 with the ' +
          'Razorpay key secret); an invalid signature returns **401**.\n\n`payment.captured` marks the payment `SUCCESS` and releases its booking to `PENDING` (the backup for the app\'s own ' +
          'confirmation call); `payment.failed` marks it `FAILED`, and the customer can try again on the same order.',
        access: 'public',
        params: [{ in: 'header', name: 'X-Razorpay-Signature', required: true, description: 'Signature of the raw request body', schema: { type: 'string' } }],
        body: jsonBody(
          { type: 'object', description: 'Razorpay event payload', additionalProperties: true },
          { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Pq9z8y7x6W5v4U', order_id: 'order_Pq1x2y3z4A5b6C', status: 'captured' } } } },
        ),
        responses: {
          200: { description: 'Acknowledged', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } } },
        },
        errors: [401],
      }),
    },
    '/amc': {
      post: op({
        tag: AMC,
        summary: 'Start a subscription',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            required: ['plan', 'startDate', 'renewalDate'],
            properties: { plan: { type: 'string', minLength: 2 }, startDate: { type: 'string', format: 'date-time' }, renewalDate: { type: 'string', format: 'date-time' } },
          },
          { plan: 'Complete Care', startDate: '2026-10-06T00:00:00.000Z', renewalDate: '2027-10-06T00:00:00.000Z' },
        ),
        responses: { 201: ok('Subscription created', ref('AMCSubscription')) },
      }),
      get: op({
        tag: AMC,
        summary: 'List subscriptions',
        description: 'Customers see their own. Admins see all, each with a `customer` summary, and can `search`.',
        access: ['CUSTOMER', 'ADMIN'],
        params: [
          queryParam('status', 'Only subscriptions in this status', { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] }),
          queryParam('search', 'Admins only: the plan, or the customer\'s name, phone or email'),
          ...pageParams,
        ],
        responses: {
          200: paginated('A page of subscriptions, newest first', {
            allOf: [
              ref('AMCSubscription'),
              {
                type: 'object',
                properties: {
                  customer: {
                    type: 'object',
                    description: 'Admins only',
                    properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, phone: { type: 'string', nullable: true }, email: { type: 'string', nullable: true } },
                  },
                },
              },
            ],
          }),
        },
      }),
    },
    '/amc/summary': {
      get: op({
        tag: AMC,
        summary: 'Subscription totals (team)',
        description: 'How many subscriptions there are in each status, and how many active ones renew within `renewalWindowDays` (60).',
        access: 'ADMIN',
        responses: {
          200: ok(
            'Totals',
            { type: 'object', properties: { total: { type: 'integer' }, byStatus: { type: 'object', additionalProperties: { type: 'integer' } }, renewingSoon: { type: 'integer' }, renewalWindowDays: { type: 'integer' } } },
            { total: 58, byStatus: { ACTIVE: 41, EXPIRED: 12, CANCELLED: 5 }, renewingSoon: 7, renewalWindowDays: 60 },
          ),
        },
      }),
    },
    '/amc/{id}': {
      patch: op({
        tag: AMC,
        summary: 'Edit a subscription (team)',
        description: 'Correct the plan name or dates, or change the status (e.g. mark it expired). **400** if the renewal date is not after the start date.',
        access: 'ADMIN',
        params: [subscriptionId],
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              plan: { type: 'string', minLength: 2 },
              startDate: { type: 'string', format: 'date-time' },
              renewalDate: { type: 'string', format: 'date-time' },
              status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
            },
          },
          { renewalDate: '2027-11-03T00:00:00.000Z' },
        ),
        responses: { 200: ok('The updated subscription, with its customer', ref('AMCSubscription')) },
        errors: [404],
      }),
      get: op({
        tag: AMC,
        summary: 'Get a subscription',
        description: 'The subscription\'s customer or an admin (otherwise **403**).',
        params: [subscriptionId],
        responses: { 200: ok('The subscription', ref('AMCSubscription')) },
        errors: [403, 404],
      }),
    },
    '/amc/{id}/cancel': {
      post: op({
        tag: AMC,
        summary: 'Cancel a subscription',
        description: 'The subscription\'s customer or an admin (otherwise **403**).',
        params: [subscriptionId],
        responses: { 200: ok('Subscription, now `CANCELLED`', ref('AMCSubscription')) },
        errors: [403, 404],
      }),
    },
    '/reviews': {
      post: op({
        tag: REVIEWS,
        summary: 'Review a completed booking (older endpoint)',
        description: 'Kept for older app builds; the customer app should use `POST /customer/bookings/{id}/rating`. Rates the vendor of one of the customer\'s completed bookings; sending again changes the rating. **404** for someone else\'s booking, **409** before it is completed.',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            required: ['bookingId', 'rating'],
            properties: { bookingId: { type: 'string', format: 'uuid' }, rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 } },
          },
          { bookingId: '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e', rating: 5, comment: 'Very professional and punctual.' },
        ),
        responses: { 201: ok('The rating', ref('Review')) },
        errors: [404, 409],
      }),
      get: op({
        tag: REVIEWS,
        summary: 'List ratings',
        description:
          'Both directions: `authorRole=CUSTOMER` for customers rating vendors, `authorRole=PROFESSIONAL` for vendors rating customers. ' +
          '`summary` gives the average, count and 1-5 spread for the same filters (e.g. one vendor\'s or one customer\'s average).',
        access: 'ADMIN',
        params: [
          queryParam('authorRole', 'Who gave the rating', { type: 'string', enum: ['CUSTOMER', 'PROFESSIONAL'] }),
          queryParam('rating', 'Exactly this many stars', { type: 'integer', minimum: 1, maximum: 5 }),
          queryParam('maxRating', 'At most this many stars (e.g. 2 for poor ratings)', { type: 'integer', minimum: 1, maximum: 5 }),
          queryParam('professionalId', 'Ratings on this vendor\'s bookings', { type: 'string', format: 'uuid' }),
          queryParam('customerId', 'Ratings on this customer\'s bookings', { type: 'string', format: 'uuid' }),
          queryParam('search', 'A booking number (BK-000123), or a customer or vendor name / phone'),
          queryParam('createdFrom', 'Rated on or after (YYYY-MM-DD)', { type: 'string', format: 'date' }),
          queryParam('createdTo', 'Rated on or before (YYYY-MM-DD)', { type: 'string', format: 'date' }),
          queryParam('sortBy', 'Sort field', { type: 'string', enum: ['createdAt', 'rating'], default: 'createdAt' }),
          queryParam('sortOrder', 'Sort direction', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }),
          ...pageParams,
        ],
        responses: {
          200: (() => {
            const party = { type: 'object', properties: { type: { type: 'string', enum: ['CUSTOMER', 'VENDOR'] }, id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, phone: { type: 'string', nullable: true } } };
            const response = paginated('A page of ratings', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                authorRole: { type: 'string', enum: ['CUSTOMER', 'PROFESSIONAL'] },
                rating: { type: 'integer' },
                comment: { type: 'string', nullable: true },
                from: party,
                about: party,
                booking: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, bookingNumber: { type: 'string' }, service: { type: 'object' }, completedAt: { type: 'string', format: 'date-time', nullable: true } } },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            });
            response.content['application/json'].schema.properties.summary = ratingStats;
            return response;
          })(),
        },
      }),
    },
    '/reviews/summary': {
      get: op({
        tag: REVIEWS,
        summary: 'Rating headlines',
        description: 'How vendors are rated by customers, how customers are rated by vendors, and how many completed bookings each side has not rated yet.',
        access: 'ADMIN',
        responses: {
          200: ok(
            'The summary',
            { type: 'object', properties: { vendorRatings: ratingStats, customerRatings: ratingStats, completedBookings: { type: 'integer' }, awaitingCustomerRating: { type: 'integer' }, awaitingVendorRating: { type: 'integer' } } },
            { vendorRatings: { average: 4.6, count: 120, distribution: { 5: 90, 4: 20, 3: 6, 2: 3, 1: 1 } }, customerRatings: { average: 4.8, count: 98, distribution: { 5: 85, 4: 10, 3: 2, 2: 1, 1: 0 } }, completedBookings: 140, awaitingCustomerRating: 20, awaitingVendorRating: 42 },
          ),
        },
      }),
    },
    '/reviews/professional/{professionalId}': {
      get: op({
        tag: REVIEWS,
        summary: 'List a professional\'s reviews',
        description: 'What customers said about this vendor (ratings vendors gave customers are not included).',
        access: 'public',
        params: [pathParam('professionalId', 'Professional id'), ...pageParams],
        responses: {
          200: paginated('A page of reviews, newest first', {
            allOf: [ref('Review'), { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } } }],
          }),
        },
      }),
    },
  },
};
