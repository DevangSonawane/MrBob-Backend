const crypto = require('crypto');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { isAdmin } = require('../../utils/roles');
const { dateRange, personSearch } = require('../../utils/queryFilters');
const razorpay = require('../payments/razorpay.client');
const notifications = require('../notifications/notifications.service');
const logger = require('../../config/logger');
const wallet = require('../wallet/wallet.service');
const invoices = require('../invoices/invoices.service');
const storage = require('../storage/storage.service');

// The booking flow, as the customer app presents it:
//
//   service -> date & time -> problem description -> (address) -> payment
//
// The app collects all of that and sends it in ONE request (create). What
// happens next depends on how the customer chose to pay:
//
//   PAY_AFTER_SERVICE  -> PENDING straight away
//   ONLINE             -> AWAITING_PAYMENT, with a gateway order to pay;
//                         confirmPayment (or the gateway webhook) -> PENDING
//
//   PENDING -> MATCHING -> ASSIGNED -> IN_PROGRESS -> COMPLETED
//                (any of these, and AWAITING_PAYMENT, can be CANCELLED)

const ALLOWED_TRANSITIONS = {
  AWAITING_PAYMENT: ['PENDING', 'CANCELLED'],
  PENDING: ['MATCHING', 'CANCELLED'],
  MATCHING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const OPEN_STATUSES = ['AWAITING_PAYMENT', 'PENDING', 'MATCHING', 'ASSIGNED', 'IN_PROGRESS'];
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'];
// A customer can change their mind until the professional has started work.
const CUSTOMER_CHANGEABLE = ['AWAITING_PAYMENT', 'PENDING', 'MATCHING', 'ASSIGNED'];

const MIN_LEAD_MINUTES = 60;
const MAX_ADVANCE_DAYS = 60;

// A 4-digit code for starting or completing a job. While logins use a fixed
// test code (OTP_STATIC_CODE), these do too, so the apps can be tested alone.
const jobOtp = () => env.OTP_STATIC_CODE ?? String(crypto.randomInt(1000, 10000));

const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;

const bookingInclude = {
  category: { select: { id: true, name: true, tier: true } },
  city: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
  payment: true,
  images: { select: { id: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  invoice: { select: { id: true, sequence: true, issuedAt: true } },
  customer: { select: { id: true, name: true, phone: true, email: true } },
  // Only what a booking screen needs — the professional row also holds
  // personal onboarding details that must not reach customers.
  professional: {
    select: { id: true, userId: true, rating: true, profilePhotoKey: true, user: { select: { id: true, name: true, phone: true } } },
  },
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const roleOf = (user) => (isAdmin(user.role) ? 'ADMIN' : user.role === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'CUSTOMER');

const paymentView = (booking) => {
  const payment = booking.payment;
  return {
    mode: booking.paymentMode,
    status: payment?.status ?? 'UNPAID',
    amount: booking.price === null ? null : Number(booking.price),
    method: payment?.method ?? null,
    paidAt: payment?.paidAt ?? null,
    refundedAt: payment?.refundedAt ?? null,
  };
};

// What the app needs to open the gateway's checkout for an unpaid online booking.
const checkoutView = (booking) => {
  if (booking.status !== 'AWAITING_PAYMENT' || !booking.payment?.gatewayRef) return null;
  return {
    provider: 'razorpay',
    orderId: booking.payment.gatewayRef,
    amount: Math.round(Number(booking.price) * 100), // in paise, as the gateway expects
    currency: 'INR',
    keyId: env.RAZORPAY_KEY_ID ?? null,
    // True when the server has no gateway keys: the order is a stand-in and
    // confirming it needs no real payment (development only).
    isTest: !razorpay.isConfigured,
  };
};

// START (enter the start code) -> VERIFY_COMPLETION_OTP -> UPLOAD_IMAGES -> COMPLETE.
const nextJobStep = (booking) => {
  if (booking.status === 'ASSIGNED') return 'START';
  if (booking.status !== 'IN_PROGRESS') return null;
  if (!booking.completionOtpVerifiedAt) return 'VERIFY_COMPLETION_OTP';
  return booking.images.length === 0 ? 'UPLOAD_IMAGES' : 'COMPLETE';
};

const toView = (booking, viewer) => {
  const role = roleOf(viewer);
  const isCustomer = role === 'CUSTOMER';
  const paid = booking.payment?.status === 'SUCCESS';

  return {
    id: booking.id,
    bookingNumber: bookingNumber(booking.sequence),
    status: booking.status,
    service: booking.category,
    scheduledAt: booking.scheduledAt,
    description: booking.description,
    price: booking.price === null ? null : Number(booking.price),
    address: {
      line: booking.address,
      city: booking.city,
      zone: booking.zone,
      pincode: booking.pincode,
      latitude: booking.latitude === null ? null : Number(booking.latitude),
      longitude: booking.longitude === null ? null : Number(booking.longitude),
      contactName: booking.contactName,
      contactPhone: booking.contactPhone,
    },
    payment: paymentView(booking),
    // Only the customer pays, so only they are handed the checkout details.
    checkout: isCustomer ? checkoutView(booking) : null,
    professional: booking.professional
      ? {
          id: booking.professional.id,
          name: booking.professional.user.name,
          phone: booking.professional.user.phone,
          rating: Number(booking.professional.rating),
          photo: booking.professional.profilePhotoKey ? `/professionals/${booking.professional.id}/photo` : null,
        }
      : null,
    // The codes the customer reads out to the vendor: one to start the job,
    // then one to finish it. Never sent to the vendor.
    otp:
      role === 'PROFESSIONAL'
        ? null
        : {
            start: booking.status === 'ASSIGNED' ? booking.startOtp : null,
            completion: booking.status === 'IN_PROGRESS' && !booking.completionOtpVerifiedAt ? booking.completionOtp : null,
          },
    // Where the vendor is in the job, for the vendor app's next button.
    job: { nextStep: nextJobStep(booking), completionOtpVerified: Boolean(booking.completionOtpVerifiedAt) },
    // Photos of the finished work (each `url` needs the caller's token).
    completionImages: booking.images.map((image) => ({ id: image.id, url: `/bookings/${booking.id}/completion-images/${image.id}`, uploadedAt: image.createdAt })),
    // The customer's invoice, once the job is completed (not shown to the vendor).
    invoice:
      booking.invoice && role !== 'PROFESSIONAL'
        ? {
            id: booking.invoice.id,
            invoiceNumber: `INV-${String(booking.invoice.sequence).padStart(6, '0')}`,
            issuedAt: booking.invoice.issuedAt,
            url: isCustomer ? `/customer/bookings/${booking.id}/invoice` : `/invoices/${booking.invoice.id}`,
            pdf: isCustomer ? `/customer/bookings/${booking.id}/invoice/pdf` : `/invoices/${booking.invoice.id}/pdf`,
          }
        : null,
    // Professionals and admins need to know who the job is for.
    customer: isCustomer ? undefined : booking.customer,
    cancellation: booking.cancelledAt ? { at: booking.cancelledAt, by: booking.cancelledBy, reason: booking.cancellationReason } : null,
    actions: {
      canPay: isCustomer && booking.status === 'AWAITING_PAYMENT',
      canCancel: role === 'ADMIN' ? OPEN_STATUSES.includes(booking.status) : isCustomer && CUSTOMER_CHANGEABLE.includes(booking.status),
      canReschedule: role !== 'PROFESSIONAL' && CUSTOMER_CHANGEABLE.includes(booking.status),
      canCollectPayment:
        role !== 'CUSTOMER' && booking.paymentMode === 'PAY_AFTER_SERVICE' && !paid && ['IN_PROGRESS', 'COMPLETED'].includes(booking.status),
    },
    assignedAt: booking.assignedAt,
    startedAt: booking.startedAt,
    completedAt: booking.completedAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
};

const loadTimeline = async (bookingId) => {
  const events = await prisma.bookingEvent.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, actorRole: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { id: true, name: true } } },
  });
  return events;
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const event = (tx, bookingId, actor, data) =>
  tx.bookingEvent.create({
    data: { bookingId, actorId: actor?.id ?? null, actorRole: actor ? roleOf(actor) : 'SYSTEM', ...data },
  });

const load = async (id) => {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw ApiError.notFound('Booking not found');
  return booking;
};

// Customers see their own bookings, professionals the ones assigned to them, admins all.
const assertCanSee = (booking, user) => {
  const allowed = isAdmin(user.role) || booking.customerId === user.id || booking.professional?.userId === user.id;
  if (!allowed) throw ApiError.forbidden('You do not have access to this booking');
};

const assertSchedulable = (value) => {
  const when = new Date(value);
  const now = Date.now();
  if (when.getTime() < now + MIN_LEAD_MINUTES * 60 * 1000) {
    throw ApiError.badRequest(`Choose a time at least ${MIN_LEAD_MINUTES} minutes from now`);
  }
  if (when.getTime() > now + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000) {
    throw ApiError.badRequest(`Bookings can be made up to ${MAX_ADVANCE_DAYS} days ahead`);
  }
  return when;
};

const notify = (userId, title, body, booking) => {
  notifications
    .sendPushNotification(userId, { title, body, data: { type: 'BOOKING', bookingId: booking.id, status: booking.status } })
    .catch((err) => logger.warn({ err: err.message, userId }, 'Failed to send booking notification'));
};

const detail = async (id, viewer) => {
  const booking = await load(id);
  return { ...toView(booking, viewer), timeline: await loadTimeline(id) };
};

// ---------------------------------------------------------------------------
// Customer: create and pay
// ---------------------------------------------------------------------------

const create = async (customer, { categoryId, scheduledAt, description, addressId, paymentMode, partnerId }) => {
  const when = assertSchedulable(scheduledAt);

  const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw ApiError.badRequest('Unknown or inactive service');

  // The job happens at one of the customer's saved addresses.
  const address = await prisma.address.findFirst({
    where: { userId: customer.id, ...(addressId ? { id: addressId } : { isDefault: true }) },
    include: { city: { select: { name: true } } },
  });
  if (!address) {
    throw ApiError.badRequest(addressId ? 'Address not found — pick one of your saved addresses' : 'Add an address before booking a service');
  }

  if (partnerId && !(await prisma.partner.findUnique({ where: { id: partnerId } }))) throw ApiError.badRequest('Unknown partner');

  const online = paymentMode === 'ONLINE';
  // Without gateway keys a real server cannot take money; only dev/test fall
  // back to a stand-in order so the flow can be built end to end.
  if (online && !razorpay.isConfigured && env.NODE_ENV === 'production') {
    throw new ApiError(503, 'Online payment is not available right now. Choose pay after service.');
  }

  const order = online ? await razorpay.createOrder({ amount: Number(category.basePrice), receipt: `booking_${Date.now()}` }) : null;

  const created = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        customerId: customer.id,
        categoryId,
        partnerId,
        scheduledAt: when,
        description,
        paymentMode,
        price: category.basePrice,
        status: online ? 'AWAITING_PAYMENT' : 'PENDING',
        address: [address.line1, address.line2, address.landmark, address.city?.name, `${address.state} ${address.pincode}`.trim()].filter(Boolean).join(', '),
        addressId: address.id,
        cityId: address.cityId,
        zoneId: address.zoneId,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        ...(online && { payment: { create: { amount: category.basePrice, gatewayRef: order.id, status: 'CREATED' } } }),
      },
    });
    await event(tx, booking.id, customer, { type: 'CREATED', toStatus: booking.status });
    return booking;
  });

  return detail(created.id, customer);
};

// Marks an online booking as paid and releases it to dispatch. Shared by the
// app's confirmation call and the gateway webhook, so it is safe to run twice.
const markPaid = async (bookingId, { gatewayPaymentId, actor = null }) => {
  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
    if (!booking || !booking.payment || booking.payment.status === 'SUCCESS') return;

    await tx.payment.update({
      where: { id: booking.payment.id },
      data: { status: 'SUCCESS', method: 'ONLINE', gatewayPaymentId, paidAt: new Date() },
    });
    // A booking cancelled while the customer was paying stays cancelled; the money is owed back.
    if (booking.status === 'CANCELLED') {
      await tx.payment.update({ where: { id: booking.payment.id }, data: { status: 'REFUND_PENDING' } });
      await event(tx, bookingId, actor, { type: 'PAYMENT_RECEIVED', note: 'Paid after cancellation — refund due' });
      return;
    }
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'PENDING' } });
    await event(tx, bookingId, actor, { type: 'PAYMENT_RECEIVED', fromStatus: booking.status, toStatus: 'PENDING' });
  });
};

const confirmPayment = async (id, customer, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const booking = await load(id);
  if (booking.customerId !== customer.id) throw ApiError.forbidden('You do not have access to this booking');
  if (!booking.payment || booking.paymentMode !== 'ONLINE') throw ApiError.badRequest('This booking is not paid online');
  if (booking.payment.status === 'SUCCESS') return detail(id, customer); // already confirmed (e.g. by the webhook)
  if (booking.status !== 'AWAITING_PAYMENT') throw ApiError.conflict(`This booking is ${booking.status} and can no longer be paid`);
  if (booking.payment.gatewayRef !== razorpayOrderId) throw ApiError.badRequest('This payment does not belong to this booking');

  const genuine = razorpay.isConfigured
    ? razorpay.verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature })
    : env.NODE_ENV !== 'production'; // stand-in orders (no gateway keys) are accepted outside production only
  if (!genuine) throw ApiError.badRequest('Payment could not be verified');

  await markPaid(id, { gatewayPaymentId: razorpayPaymentId, actor: customer });
  return detail(id, customer);
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const list = async (user, query) => {
  const { page, limit, status, scope, sortBy, sortOrder } = query;
  const admin = isAdmin(user.role);

  const where = {
    ...(status ? { status: { in: status } } : scope && { status: { in: scope === 'upcoming' ? OPEN_STATUSES : CLOSED_STATUSES } }),
  };

  if (admin) {
    const { paymentStatus, paymentMode, categoryId, cityId, zoneId, customerId, professionalId, unassigned, search } = query;
    const scheduledAt = dateRange(query.scheduledFrom, query.scheduledTo);
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    // "BK-000123" or "bk123" is a booking reference and matches that booking
    // only; bare digits could also be part of a phone number or an address.
    const isReference = Boolean(search) && /^bk-?\d+$/i.test(search);
    const number = search && /^(bk-?)?\d+$/i.test(search) ? Number(search.replace(/\D/g, '')) : null;
    const bySequence = number !== null && number <= 2147483647 ? [{ sequence: number }] : [];
    Object.assign(where, {
      ...(paymentMode && { paymentMode }),
      ...(paymentStatus && (paymentStatus === 'UNPAID' ? { payment: { is: null } } : { payment: { is: { status: paymentStatus } } })),
      ...(categoryId && { categoryId }),
      ...(cityId && { cityId }),
      ...(zoneId && { zoneId }),
      ...(customerId && { customerId }),
      ...(professionalId && { professionalId }),
      ...(unassigned && { professionalId: null }),
      ...(scheduledAt && { scheduledAt }),
      ...(createdAt && { createdAt }),
      ...(search && {
        OR: isReference ? (bySequence.length ? bySequence : [{ id: '__none__' }]) : [...bySequence, { customer: personSearch(search) }, { address: { contains: search, mode: 'insensitive' } }],
      }),
    });
  } else if (user.role === 'PROFESSIONAL') {
    const professional = await prisma.professional.findUnique({ where: { userId: user.id } });
    where.professionalId = professional?.id ?? '__none__';
  } else {
    where.customerId = user.id;
  }

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      ...toSkipTake({ page, limit }),
      // createdAt is never null; the other sort fields can be, and nulls go last.
      orderBy: sortBy === 'createdAt' ? [{ createdAt: sortOrder }] : [{ [sortBy]: { sort: sortOrder, nulls: 'last' } }, { createdAt: 'desc' }],
      include: bookingInclude,
    }),
    prisma.booking.count({ where }),
  ]);
  return paginatedResponse(rows.map((row) => toView(row, user)), total, { page, limit });
};

const getById = async (id, user) => {
  const booking = await load(id);
  assertCanSee(booking, user);
  return { ...toView(booking, user), timeline: await loadTimeline(id) };
};

// Headline numbers for the admin bookings screen.
// Permanently removes a booking in any status, with its timeline, payment
// record, review and work photos. A vendor's wallet earning for it is kept
// (no longer linked to the booking), so money already owed is not lost.
const remove = async (id) => {
  const booking = await prisma.booking.findUnique({ where: { id }, include: { images: { select: { fileKey: true } } } });
  if (!booking) throw ApiError.notFound('Booking not found');
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { bookingId: id } }),
    prisma.payment.deleteMany({ where: { bookingId: id } }),
    prisma.booking.delete({ where: { id } }),
  ]);
  await Promise.all(booking.images.map((image) => storage.remove(image.fileKey).catch(() => {})));
  return { deleted: true, bookingNumber: bookingNumber(booking.sequence) };
};

const getSummary = async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const [groups, scheduledToday, unassigned, refundsPending, collected, dueAfterService] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.booking.count({ where: { scheduledAt: { gte: startOfDay, lt: endOfDay }, status: { not: 'CANCELLED' } } }),
    prisma.booking.count({ where: { status: { in: ['PENDING', 'MATCHING'] } } }),
    prisma.payment.count({ where: { status: 'REFUND_PENDING', bookingId: { not: null } } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', bookingId: { not: null } }, _sum: { amount: true } }),
    prisma.booking.count({ where: { status: 'COMPLETED', paymentMode: 'PAY_AFTER_SERVICE', OR: [{ payment: { is: null } }, { payment: { is: { status: { not: 'SUCCESS' } } } }] } }),
  ]);

  const byStatus = Object.fromEntries(Object.keys(ALLOWED_TRANSITIONS).map((status) => [status, 0]));
  groups.forEach((group) => {
    byStatus[group.status] = group._count._all;
  });

  return {
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    byStatus,
    scheduledToday,
    waitingForProfessional: unassigned,
    awaitingPayment: byStatus.AWAITING_PAYMENT,
    refundsPending,
    completedUnpaid: dueAfterService,
    amountCollected: Number(collected._sum.amount ?? 0),
  };
};

// ---------------------------------------------------------------------------
// Changing a booking
// ---------------------------------------------------------------------------

// Moves a booking along: admins to MATCHING / IN_PROGRESS / COMPLETED, the
// assigned professional to IN_PROGRESS / COMPLETED. Assigning is done by
// dispatch, cancelling by cancel(), paying by confirmPayment().
const updateStatus = async (id, { status: next, note }, user) => {
  const booking = await load(id);
  assertCanSee(booking, user);
  // Vendors start and finish a job with the customer's codes (see modules/jobs); this is the team's override.
  if (!isAdmin(user.role)) throw ApiError.forbidden('Start and complete a job with the customer\'s OTP');

  if (!ALLOWED_TRANSITIONS[booking.status].includes(next)) {
    throw ApiError.badRequest(`Cannot move a booking from ${booking.status} to ${next}`);
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: booking.status },
      data: {
        status: next,
        // Started by the team: the vendor still finishes with the customer's completion code.
        ...(next === 'IN_PROGRESS' && { startedAt: new Date(), startOtp: null, completionOtp: jobOtp(), completionOtpAttempts: 0 }),
        ...(next === 'COMPLETED' && { completedAt: new Date(), completionOtp: null }),
      },
    });
    if (count === 0) throw ApiError.conflict('This booking was just updated by someone else — reload and try again');
    await event(tx, id, user, { type: 'STATUS_CHANGED', fromStatus: booking.status, toStatus: next, note });
    if (next === 'COMPLETED') {
      await wallet.creditForBooking(tx, booking);
      await invoices.issueForBooking(tx, booking);
    }
  });

  if (next === 'IN_PROGRESS') notify(booking.customerId, 'Work has started', `${booking.professional?.user.name ?? 'Your professional'} has started the job.`, booking);
  if (next === 'COMPLETED') notify(booking.customerId, 'Job completed', 'Your service is complete. Tell us how it went.', booking);
  return detail(id, user);
};

const cancel = async (id, user, reason) => {
  const booking = await load(id);
  assertCanSee(booking, user);
  const role = roleOf(user);
  if (role === 'PROFESSIONAL') throw ApiError.forbidden('Contact support to hand back a job');

  const cancellable = role === 'ADMIN' ? OPEN_STATUSES : CUSTOMER_CHANGEABLE;
  if (!cancellable.includes(booking.status)) {
    throw ApiError.conflict(
      CLOSED_STATUSES.includes(booking.status) ? `This booking is already ${booking.status.toLowerCase()}` : 'Work has already started — contact support to cancel',
    );
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: booking.status },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: role, cancellationReason: reason },
    });
    if (count === 0) throw ApiError.conflict('This booking was just updated by someone else — reload and try again');
    // Money already taken has to go back; an order nobody paid is just closed.
    if (booking.payment?.status === 'SUCCESS') {
      await tx.payment.update({ where: { id: booking.payment.id }, data: { status: 'REFUND_PENDING' } });
    } else if (booking.payment && ['CREATED', 'PENDING'].includes(booking.payment.status)) {
      await tx.payment.update({ where: { id: booking.payment.id }, data: { status: 'FAILED' } });
    }
    await event(tx, id, user, { type: 'CANCELLED', fromStatus: booking.status, toStatus: 'CANCELLED', note: reason });
  });

  if (role === 'ADMIN') notify(booking.customerId, 'Booking cancelled', `Your booking ${bookingNumber(booking.sequence)} was cancelled: ${reason}`, booking);
  if (booking.professional) notify(booking.professional.userId, 'Job cancelled', `Booking ${bookingNumber(booking.sequence)} was cancelled.`, booking);
  return detail(id, user);
};

const reschedule = async (id, user, scheduledAt) => {
  const booking = await load(id);
  assertCanSee(booking, user);
  if (roleOf(user) === 'PROFESSIONAL') throw ApiError.forbidden('Only the customer or an admin can reschedule');
  if (!CUSTOMER_CHANGEABLE.includes(booking.status)) throw ApiError.conflict(`A booking that is ${booking.status} cannot be rescheduled`);

  const when = assertSchedulable(scheduledAt);
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id }, data: { scheduledAt: when } });
    await event(tx, id, user, { type: 'RESCHEDULED', note: `${booking.scheduledAt?.toISOString() ?? 'unscheduled'} -> ${when.toISOString()}` });
  });

  if (booking.professional) notify(booking.professional.userId, 'Job rescheduled', `Booking ${bookingNumber(booking.sequence)} has a new time.`, booking);
  return detail(id, user);
};

// Records money taken in person for a pay-after-service booking.
const collectPayment = async (id, user, method) => {
  const booking = await load(id);
  assertCanSee(booking, user);
  if (booking.paymentMode !== 'PAY_AFTER_SERVICE') throw ApiError.badRequest('This booking is paid online');
  if (!['IN_PROGRESS', 'COMPLETED'].includes(booking.status)) throw ApiError.conflict('Payment is collected once the job has started');
  if (booking.payment?.status === 'SUCCESS') throw ApiError.conflict('Payment has already been collected for this booking');

  await prisma.$transaction(async (tx) => {
    const data = { amount: booking.price, method, status: 'SUCCESS', paidAt: new Date() };
    await tx.payment.upsert({ where: { bookingId: id }, update: data, create: { bookingId: id, ...data } });
    await event(tx, id, user, { type: 'PAYMENT_COLLECTED', note: method });
    // Cash goes straight to the vendor, so their earning for this job needs no payout.
    if (method === 'CASH') await wallet.settleInCash(tx, id);
  });
  return detail(id, user);
};

// The refund itself is made in the payment gateway; this records that it was.
const markRefunded = async (id, user, reference) => {
  const booking = await load(id);
  if (booking.payment?.status !== 'REFUND_PENDING') throw ApiError.conflict('This booking has no refund pending');

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: booking.payment.id }, data: { status: 'REFUNDED', refundedAt: new Date(), refundReference: reference } });
    await event(tx, id, user, { type: 'REFUNDED', note: reference });
  });
  notify(booking.customerId, 'Refund issued', `Your refund for booking ${bookingNumber(booking.sequence)} has been issued.`, booking);
  return detail(id, user);
};

module.exports = {
  ALLOWED_TRANSITIONS,
  bookingNumber,
  jobOtp,
  // For the vendor job flow (modules/jobs), which shares these building blocks.
  internals: { load, detail, event, notify, assertCanSee },
  create,
  confirmPayment,
  markPaid,
  list,
  getById,
  getSummary,
  updateStatus,
  cancel,
  reschedule,
  collectPayment,
  markRefunded,
  remove,
};
