const { ok, paginated, fileResponse, pathParam, queryParam, dateParam, pageParams, op } = require('../helpers');

const CUSTOMER = 'Customer app — invoices';
const ADMIN = 'Invoices (admin)';

const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
const amount = { type: 'number', example: 349 };
const text = { type: 'string', nullable: true };

const invoice = {
  type: 'object',
  properties: {
    id: uuid,
    invoiceNumber: { type: 'string', example: 'INV-000042' },
    issuedAt: dateTime,
    status: { type: 'string', enum: ['PAID', 'UNPAID', 'REFUND_PENDING', 'REFUNDED'], description: 'Whether the customer has paid for the booking' },
    currency: { type: 'string', example: 'INR' },
    business: { type: 'object', properties: { name: { type: 'string' }, address: text, email: text, phone: text } },
    billedTo: { type: 'object', properties: { id: uuid, name: { type: 'string' }, phone: text, email: text, address: { type: 'string' } } },
    booking: { type: 'object', properties: { id: uuid, bookingNumber: { type: 'string' }, service: { type: 'object' }, scheduledAt: { ...dateTime, nullable: true }, completedAt: { ...dateTime, nullable: true }, city: text } },
    vendor: { type: 'object', nullable: true, properties: { id: uuid, name: { type: 'string' } } },
    items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, details: text, quantity: { type: 'integer' }, unitPrice: amount, amount } } },
    subtotal: amount,
    tax: { type: 'number', example: 0, description: 'No tax is charged for now' },
    total: amount,
    payment: { type: 'object', properties: { mode: { type: 'string', enum: ['ONLINE', 'PAY_AFTER_SERVICE'] }, method: text, paidAt: { ...dateTime, nullable: true }, amountPaid: amount } },
    pdf: { type: 'string', description: 'API path of the PDF; fetch with the caller\'s token' },
  },
};
const example = (pdf) => ({
  id: 'b7c6d5e4-1111-4a2b-9c3d-4e5f6a7b8c9d',
  invoiceNumber: 'INV-000042',
  issuedAt: '2026-10-19T07:45:00.000Z',
  status: 'PAID',
  currency: 'INR',
  business: { name: 'Mr Bob Home Services', address: null, email: null, phone: null },
  billedTo: { id: 'd4c3b2a1-9999-4f8e-8d7c-6b5a4f3e2d1c', name: 'Aarav Mehta', phone: '+919898989898', email: 'aarav@example.com', address: '22, Hill Road, Bandra West, Mumbai, Maharashtra 400050' },
  booking: { id: '5e4d3c2b-4444-4a1b-8c9d-0e1f2a3b4c5d', bookingNumber: 'BK-000123', service: { id: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', name: 'Plumber' }, scheduledAt: '2026-10-19T05:30:00.000Z', completedAt: '2026-10-19T07:45:00.000Z', city: 'Mumbai' },
  vendor: { id: 'a1b2c3d4-0000-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ravi Kumar' },
  items: [{ description: 'Plumber', details: 'Kitchen tap is leaking', quantity: 1, unitPrice: 349, amount: 349 }],
  subtotal: 349,
  tax: 0,
  total: 349,
  payment: { mode: 'PAY_AFTER_SERVICE', method: 'UPI', paidAt: '2026-10-19T07:50:00.000Z', amountPaid: 349 },
  pdf,
});
const bookingId = pathParam('id', 'Booking id');
const invoiceId = pathParam('id', 'Invoice id');
const pdf = (description) => ({ 200: { ...fileResponse(description, ['application/pdf']) } });

module.exports = {
  tags: [
    { name: CUSTOMER, description: 'The customer\'s invoice for a completed booking: as data for an invoice screen, and as a PDF to download or share. Issued when the job is completed; no tax is charged for now.' },
    { name: ADMIN, description: 'Every customer invoice, for the team: list with totals, one invoice, and its PDF.' },
  ],
  paths: {
    '/customer/bookings/{id}/invoice': {
      get: op({
        tag: CUSTOMER,
        summary: 'Get the invoice for a completed booking',
        description: 'Returns **404** for someone else\'s booking, and while the booking is not completed yet (the invoice is issued when the job is completed).',
        access: 'CUSTOMER',
        params: [bookingId],
        responses: { 200: ok('The invoice', invoice, example('/customer/bookings/5e4d3c2b-4444-4a1b-8c9d-0e1f2a3b4c5d/invoice/pdf')) },
        errors: [404],
      }),
    },
    '/customer/bookings/{id}/invoice/pdf': {
      get: op({
        tag: CUSTOMER,
        summary: 'Download the invoice as a PDF',
        description: 'The same invoice as a one-page PDF named after the invoice number.',
        access: 'CUSTOMER',
        params: [bookingId],
        responses: pdf('The invoice PDF'),
        errors: [404],
      }),
    },
    '/invoices': {
      get: op({
        tag: ADMIN,
        summary: 'List invoices',
        description: 'Newest first, with `totals` for the filters: number of invoices, amount invoiced, paid and unpaid.',
        access: 'ADMIN',
        params: [
          queryParam('search', 'An invoice number (`INV-000042`) or booking number (`BK-000123`), or the customer\'s name / phone / email'),
          queryParam('status', 'Paid or not yet paid', { type: 'string', enum: ['PAID', 'UNPAID'] }),
          dateParam('issuedFrom', 'Issued on or after this date'),
          dateParam('issuedTo', 'Issued on or before this date'),
          ...pageParams,
        ],
        responses: {
          200: (() => {
            const response = paginated('A page of invoices', invoice);
            response.content['application/json'].schema.properties.totals = { type: 'object', properties: { invoices: { type: 'integer' }, amount, paid: amount, paidInvoices: { type: 'integer' }, unpaid: amount } };
            return response;
          })(),
        },
      }),
    },
    '/invoices/{id}': {
      get: op({ tag: ADMIN, summary: 'Get an invoice', access: 'ADMIN', params: [invoiceId], responses: { 200: ok('The invoice', invoice, example('/invoices/b7c6d5e4-1111-4a2b-9c3d-4e5f6a7b8c9d/pdf')) }, errors: [404] }),
    },
    '/invoices/{id}/pdf': {
      get: op({ tag: ADMIN, summary: 'Download an invoice as a PDF', access: 'ADMIN', params: [invoiceId], responses: pdf('The invoice PDF'), errors: [404] }),
    },
  },
};
