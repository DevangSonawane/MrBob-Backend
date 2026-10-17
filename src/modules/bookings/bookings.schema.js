const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, dateOnly, sortOrder } = require('../../utils/queryFilters');

const STATUSES = ['AWAITING_PAYMENT', 'PENDING', 'MATCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const PAYMENT_STATUSES = ['UNPAID', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED'];
const PAYMENT_MODES = ['ONLINE', 'PAY_AFTER_SERVICE'];

const bookingId = z.object({ id: z.uuid() });
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);

// An ISO date-time with an offset, e.g. 2026-10-08T10:00:00+05:30. How far
// ahead it may be is checked in the service.
const scheduledAt = z.iso.datetime({ offset: true, message: 'Use an ISO date-time with a timezone, e.g. 2026-10-08T10:00:00+05:30' });

// The whole booking in one request: what, when, what's wrong, where, and how
// it will be paid.
const createBooking = {
  body: z.object({
    categoryId: z.uuid(),
    scheduledAt,
    description: z.string().trim().min(10, 'Describe the problem in at least 10 characters').max(1000),
    addressId: z.uuid().optional(), // one of the customer's saved addresses; default address if omitted
    paymentMode: z.enum(PAYMENT_MODES),
    partnerId: z.uuid().optional(),
  }),
};

// A booking made by the team for a customer (web dashboard). Give either an
// existing customer or a new one, and either one of their addresses or a new one.
const adminAddress = z.object({
  label: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
  line1: z.string().trim().min(3, 'Enter the house / street').max(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  cityId: z.uuid(),
  zoneId: z.uuid().nullish(),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Pincode must be 6 digits'),
  contactName: z.string().trim().max(100).nullish(),
  contactPhone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number').nullish(),
});

const createForCustomer = {
  body: z
    .object({
      customerId: z.uuid().optional(),
      newCustomer: z
        .object({
          name: z.string().trim().min(2).max(100),
          phone: z.string().regex(/^\+[1-9]\d{9,14}$/, 'Use the international format, e.g. +919812345678'),
          email: z.email().optional().or(z.literal('')),
        })
        .optional(),
      addressId: z.uuid().optional(),
      address: adminAddress.optional(),
      categoryId: z.uuid(),
      scheduledAt,
      description: z.string().trim().min(3, 'Describe the problem').max(1000),
      // Defaults to the service's base price.
      price: z.coerce.number().positive().max(1000000).optional(),
      professionalId: z.uuid().optional(), // assign a vendor straight away
      note: z.string().trim().max(500).optional(), // for the timeline, e.g. "Booked over the phone"
    })
    .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), { message: 'Give either customerId or newCustomer', path: ['customerId'] })
    .refine((data) => Boolean(data.addressId) !== Boolean(data.address), { message: 'Give either addressId or address', path: ['addressId'] })
    .refine((data) => !(data.newCustomer && data.addressId), { message: 'A new customer has no saved addresses — send address', path: ['addressId'] }),
};

const listBookings = {
  query: paginationQuery.extend({
    status: commaList(STATUSES).optional(),
    // Shortcuts over status: upcoming = not finished yet, past = completed or cancelled.
    scope: z.enum(['upcoming', 'past']).optional(),
    // The rest only apply for admins.
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    categoryId: z.uuid().optional(),
    cityId: z.uuid().optional(),
    zoneId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    professionalId: z.uuid().optional(),
    unassigned: z.enum(['true']).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    scheduledFrom: dateOnly.optional(),
    scheduledTo: dateOnly.optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    sortBy: z.enum(['createdAt', 'scheduledAt', 'price']).default('createdAt'),
    sortOrder: sortOrder.default('desc'),
  }),
};

const getBooking = { params: bookingId };

const confirmPayment = {
  params: bookingId,
  body: z.object({
    razorpayOrderId: z.string().min(1),
    razorpayPaymentId: z.string().min(1),
    razorpaySignature: z.string().min(1),
  }),
};

const cancelBooking = { params: bookingId, body: z.object({ reason }) };

const rescheduleBooking = { params: bookingId, body: z.object({ scheduledAt }) };

const updateStatus = {
  params: bookingId,
  body: z.object({
    status: z.enum(['MATCHING', 'IN_PROGRESS', 'COMPLETED']),
    note: z.string().trim().max(500).optional(),
  }),
};

const collectPayment = {
  params: bookingId,
  body: z.object({ method: z.enum(['CASH', 'UPI', 'CARD']) }),
};

const markRefunded = {
  params: bookingId,
  body: z.object({ reference: z.string().trim().min(3).max(200) }),
};

module.exports = {
  STATUSES,
  createBooking,
  createForCustomer,
  listBookings,
  getBooking,
  confirmPayment,
  cancelBooking,
  rescheduleBooking,
  updateStatus,
  collectPayment,
  markRefunded,
};
