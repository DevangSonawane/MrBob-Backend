const { ref, ok, paginated, jsonBody, pathParam, queryParam, pageParams, op } = require('../helpers');

const PAYMENTS = 'Payments';
const AMC = 'AMC subscriptions';
const REVIEWS = 'Reviews';
const subscriptionId = pathParam('id', 'Subscription id');

module.exports = {
  tags: [
    { name: PAYMENTS, description: 'Razorpay orders for bookings. Without Razorpay keys the server returns a mock order so the flow can be built end to end.' },
    { name: AMC, description: 'Annual maintenance contracts.' },
    { name: REVIEWS, description: 'Customer ratings of completed bookings. A professional\'s rating is the average of their reviews.' },
  ],
  paths: {
    '/payments/bookings/{bookingId}/order': {
      post: op({
        tag: PAYMENTS,
        summary: 'Create a payment order for a booking',
        description: 'Creates a Razorpay order for the booking\'s price and a `CREATED` payment record. Returns **409** if the booking already has a payment and **400** if it has no price.',
        params: [pathParam('bookingId', 'Booking id')],
        responses: { 201: ok('Order created', { type: 'object', properties: { payment: ref('Payment'), order: ref('RazorpayOrder') } }) },
        errors: [404, 409],
      }),
    },
    '/payments/{id}': {
      get: op({ tag: PAYMENTS, summary: 'Get a payment', params: [pathParam('id', 'Payment id')], responses: { 200: ok('The payment', ref('Payment')) }, errors: [404] }),
    },
    '/payments/webhook': {
      post: op({
        tag: PAYMENTS,
        summary: 'Razorpay webhook',
        description:
          'Called by Razorpay, not by client apps. The raw body is verified against the `X-Razorpay-Signature` header (HMAC-SHA256 with the ' +
          'Razorpay key secret); an invalid signature returns **401**.\n\n`payment.captured` marks the payment `SUCCESS`, `payment.failed` marks it `FAILED`.',
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
        description: 'Customers see their own. Admins see all, each with a `customer` summary.',
        access: ['CUSTOMER', 'ADMIN'],
        params: [queryParam('status', 'Only subscriptions in this status', { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] }), ...pageParams],
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
    '/amc/{id}': {
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
        summary: 'Review a completed booking',
        description: 'Only the booking\'s customer (otherwise **403**), only once per booking (**409**), and only when it is `COMPLETED` (**400**).',
        access: 'CUSTOMER',
        body: jsonBody(
          {
            type: 'object',
            required: ['bookingId', 'rating'],
            properties: { bookingId: { type: 'string', format: 'uuid' }, rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 } },
          },
          { bookingId: '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e', rating: 5, comment: 'Very professional and punctual.' },
        ),
        responses: { 201: ok('Review created', ref('Review')) },
        errors: [404, 409],
      }),
      get: op({
        tag: REVIEWS,
        summary: 'List all reviews',
        access: 'ADMIN',
        params: [queryParam('minRating', 'Only reviews with at least this rating', { type: 'integer', minimum: 1, maximum: 5 }), ...pageParams],
        responses: {
          200: paginated('A page of reviews, newest first', {
            allOf: [
              ref('Review'),
              {
                type: 'object',
                properties: {
                  user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
                  booking: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      professional: {
                        type: 'object',
                        nullable: true,
                        properties: { id: { type: 'string', format: 'uuid' }, user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } },
                      },
                    },
                  },
                },
              },
            ],
          }),
        },
      }),
    },
    '/reviews/professional/{professionalId}': {
      get: op({
        tag: REVIEWS,
        summary: 'List a professional\'s reviews',
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
