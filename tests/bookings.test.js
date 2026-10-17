const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');
const payments = require('../src/modules/payments/payments.service');
const { examples, schemas } = require('../src/docs/components');

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const keysOf = (value) => Object.keys(value).sort();
const inHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const day = (offset) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const created = { userIds: [], cityIds: [], zoneIds: [], categoryIds: [] };
let city, zone, category, inactiveCategory;
let customer, otherCustomer, newcomer, admin, pro, otherPro;
let homeAddress;

const makeUser = async (role, label) => {
  const user = await prisma.user.create({
    data: { name: `${label} ${run}`, role, phone: `+9195${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true },
  });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

const makeAddress = (userId, overrides = {}) =>
  prisma.address.create({
    data: { userId, line1: '12, 4th Cross, 5th Block', line2: 'Koramangala', cityId: city.id, zoneId: zone.id, state: 'Karnataka', pincode: '560034', latitude: 12.9352, longitude: 77.6245, isDefault: true, ...overrides },
  });

const makePro = async (label) => {
  const user = await makeUser('PROFESSIONAL', label);
  const professional = await prisma.professional.create({
    data: { userId: user.id, categories: [category.id], kycStatus: 'VERIFIED', onboardingStatus: 'APPROVED', rating: 4.8, homeZoneId: zone.id },
  });
  return { ...user, professionalId: professional.id };
};

const book = (user, overrides = {}) =>
  request(app)
    .post(`${API}/bookings`)
    .set(user.auth)
    .send({
      categoryId: category.id,
      scheduledAt: inHours(26),
      description: 'The kitchen switchboard sparks when the mixer is plugged in.',
      paymentMode: 'PAY_AFTER_SERVICE',
      ...overrides,
    });

const get = (user, id) => request(app).get(`${API}/bookings/${id}`).set(user.auth);
const post = (user, id, action, body) => request(app).post(`${API}/bookings/${id}/${action}`).set(user.auth).send(body);
const setStatus = (user, id, status) => request(app).patch(`${API}/bookings/${id}/status`).set(user.auth).send({ status });
const timelineTypes = (res) => res.body.data.timeline.map((item) => item.type);

beforeAll(async () => {
  city = await prisma.city.create({ data: { name: `Booking City ${run}`, tier: 'TIER_1' } });
  created.cityIds.push(city.id);
  zone = await prisma.zone.create({ data: { cityId: city.id, name: 'Central' } });
  created.zoneIds.push(zone.id);
  category = await prisma.serviceCategory.create({ data: { name: `Electrician ${run}`, tier: 'REPAIR', basePrice: 299 } });
  inactiveCategory = await prisma.serviceCategory.create({ data: { name: `Retired ${run}`, tier: 'REPAIR', basePrice: 1, isActive: false } });
  created.categoryIds.push(category.id, inactiveCategory.id);

  customer = await makeUser('CUSTOMER', 'b-customer');
  otherCustomer = await makeUser('CUSTOMER', 'b-customer2');
  newcomer = await makeUser('CUSTOMER', 'b-newcomer'); // has no saved address
  admin = await makeUser('ADMIN', 'b-admin');
  homeAddress = await makeAddress(customer.id);
  await makeAddress(otherCustomer.id);
  pro = await makePro('b-pro');
  otherPro = await makePro('b-pro2');
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.zone.deleteMany({ where: { id: { in: created.zoneIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
});

describe('Creating a booking in one request', () => {
  it('validates every part of the flow', async () => {
    expect((await book(customer, { categoryId: inactiveCategory.id })).status).toBe(400);
    expect((await book(customer, { scheduledAt: inHours(-2) })).status).toBe(400);
    expect((await book(customer, { scheduledAt: inHours(0.5) })).status).toBe(400);
    expect((await book(customer, { scheduledAt: inHours(24 * 61) })).status).toBe(400);
    expect((await book(customer, { scheduledAt: '2026-10-09 10:00' })).status).toBe(400);
    expect((await book(customer, { description: 'Broken' })).status).toBe(400);
    expect((await book(customer, { description: undefined })).status).toBe(400);
    expect((await book(customer, { paymentMode: 'CRYPTO' })).status).toBe(400);
    expect((await book(customer, { paymentMode: undefined })).status).toBe(400);
  });

  it('needs one of the customer\'s own saved addresses', async () => {
    const none = await book(newcomer);
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/address/i);

    const someoneElses = await book(otherCustomer, { addressId: homeAddress.id });
    expect(someoneElses.status).toBe(400);
  });

  it('is for customers only', async () => {
    expect((await book(pro)).status).toBe(403);
    expect((await book(admin)).status).toBe(403);
    expect((await request(app).post(`${API}/bookings`).send({})).status).toBe(401);
  });
});

describe('Pay after service: confirmed straight away, through to completion', () => {
  let id;

  it('creates a confirmed booking with the address copied onto it', async () => {
    const scheduledAt = inHours(26);
    const res = await book(customer, { scheduledAt });
    expect(res.status).toBe(201);
    const booking = res.body.data;
    id = booking.id;

    expect(booking.bookingNumber).toMatch(/^BK-\d{6}$/);
    expect(booking).toMatchObject({
      status: 'PENDING',
      service: { id: category.id, name: category.name, tier: 'REPAIR' },
      scheduledAt,
      description: 'The kitchen switchboard sparks when the mixer is plugged in.',
      price: 299,
      payment: { mode: 'PAY_AFTER_SERVICE', status: 'UNPAID', amount: 299, method: null, paidAt: null },
      checkout: null,
      professional: null,
      cancellation: null,
      actions: { canPay: false, canCancel: true, canReschedule: true, canCollectPayment: false },
    });
    expect(booking.address).toEqual({
      line: `12, 4th Cross, 5th Block, Koramangala, ${city.name}, Karnataka 560034`,
      city: { id: city.id, name: city.name },
      zone: { id: zone.id, name: 'Central' },
      pincode: '560034',
      latitude: 12.9352,
      longitude: 77.6245,
      contactName: null,
      contactPhone: null,
    });
    expect(timelineTypes(res)).toEqual(['CREATED']);
    // A customer is not sent their own details back; everything else matches the documented example.
    expect(booking.customer).toBeUndefined();
    expect(keysOf(booking)).toEqual(keysOf(examples.booking('payLater')));
  });

  it('is found by dispatch and assigned to a professional', async () => {
    const candidates = await request(app).get(`${API}/dispatch/bookings/${id}/candidates`).set(admin.auth);
    expect(candidates.status).toBe(200);
    expect(candidates.body.data.map((item) => item.id)).toEqual(expect.arrayContaining([pro.professionalId, otherPro.professionalId]));

    const assigned = await request(app).post(`${API}/dispatch/bookings/${id}/assign`).set(admin.auth).send({ professionalId: pro.professionalId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data).toMatchObject({
      status: 'ASSIGNED',
      professional: { id: pro.professionalId, name: pro.name, rating: 4.8 },
      customer: { id: customer.id, name: customer.name },
    });
    expect(assigned.body.data.assignedAt).not.toBeNull();
    expect(timelineTypes(assigned)).toEqual(['CREATED', 'STATUS_CHANGED', 'ASSIGNED']);
    expect(keysOf(assigned.body.data)).toEqual(keysOf(examples.booking('assigned', 'admin')));
    // Every field the docs promise is there, and nothing undocumented.
    expect(keysOf(assigned.body.data).filter((key) => key !== 'timeline')).toEqual(keysOf(schemas.Booking.properties));
  });

  it('lets only the people involved see it', async () => {
    expect((await get(customer, id)).status).toBe(200);
    expect((await get(pro, id)).body.data.customer.id).toBe(customer.id);
    expect((await get(admin, id)).status).toBe(200);
    expect((await get(otherCustomer, id)).status).toBe(403);
    expect((await get(otherPro, id)).status).toBe(403);
  });

  it('can be moved along by the team, but not by a vendor or customer without the OTP flow', async () => {
    expect((await setStatus(pro, id, 'IN_PROGRESS')).status).toBe(403);
    expect((await setStatus(otherPro, id, 'IN_PROGRESS')).status).toBe(403);
    expect((await setStatus(customer, id, 'IN_PROGRESS')).status).toBe(403);
    expect((await setStatus(admin, id, 'COMPLETED')).status).toBe(400); // can't skip "in progress"
    expect((await post(pro, id, 'payment/collect', { method: 'CASH' })).status).toBe(409); // not started yet

    const started = await setStatus(admin, id, 'IN_PROGRESS');
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');
    expect(started.body.data.startedAt).not.toBeNull();
    expect(started.body.data.actions).toMatchObject({ canCollectPayment: true });

    // Once work has started the customer can no longer cancel or reschedule.
    expect((await post(customer, id, 'cancel', { reason: 'Changed my mind' })).status).toBe(409);
    expect((await post(customer, id, 'reschedule', { scheduledAt: inHours(50) })).status).toBe(409);
  });

  it('records the payment collected in person, once', async () => {
    expect((await post(customer, id, 'payment/collect', { method: 'UPI' })).status).toBe(403);
    expect((await post(otherPro, id, 'payment/collect', { method: 'UPI' })).status).toBe(403);
    expect((await post(pro, id, 'payment/collect', { method: 'BARTER' })).status).toBe(400);

    const collected = await post(pro, id, 'payment/collect', { method: 'UPI' });
    expect(collected.status).toBe(200);
    expect(collected.body.data.payment).toMatchObject({ status: 'SUCCESS', method: 'UPI', amount: 299 });
    expect(collected.body.data.payment.paidAt).not.toBeNull();
    expect((await post(pro, id, 'payment/collect', { method: 'UPI' })).status).toBe(409);

    const done = await setStatus(admin, id, 'COMPLETED');
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.completedAt).not.toBeNull();
    expect(timelineTypes(done)).toEqual(['CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'STATUS_CHANGED', 'PAYMENT_COLLECTED', 'STATUS_CHANGED']);
    expect((await post(admin, id, 'cancel', { reason: 'Too late to cancel' })).status).toBe(409);
  });
});

describe('Online payment: held until paid, then cancelled and refunded', () => {
  let id;
  let checkout;

  it('creates a booking that waits for payment', async () => {
    const res = await book(customer, { paymentMode: 'ONLINE', addressId: homeAddress.id });
    expect(res.status).toBe(201);
    id = res.body.data.id;
    checkout = res.body.data.checkout;

    expect(res.body.data).toMatchObject({ status: 'AWAITING_PAYMENT', payment: { mode: 'ONLINE', status: 'CREATED', amount: 299 }, actions: { canPay: true } });
    expect(checkout).toMatchObject({ provider: 'razorpay', amount: 29900, currency: 'INR', isTest: true });
    expect(checkout.orderId).toBeTruthy();
    expect(keysOf(res.body.data)).toEqual(keysOf(examples.booking('awaitingPayment')));
    expect(keysOf(checkout)).toEqual(keysOf(examples.booking('awaitingPayment').checkout));
  });

  it('is not offered to professionals, and hides checkout from everyone but the customer', async () => {
    const candidates = await request(app).get(`${API}/dispatch/bookings/${id}/candidates`).set(admin.auth);
    expect(candidates.status).toBe(400);
    expect((await setStatus(admin, id, 'MATCHING')).status).toBe(400);

    expect((await get(admin, id)).body.data.checkout).toBeNull();
    // The customer gets it again, to resume an interrupted payment.
    expect((await get(customer, id)).body.data.checkout.orderId).toBe(checkout.orderId);
  });

  it('confirms the payment and releases the booking', async () => {
    const proof = { razorpayOrderId: checkout.orderId, razorpayPaymentId: 'pay_test_123', razorpaySignature: 'test-signature' };
    expect((await post(customer, id, 'payment/confirm', { ...proof, razorpayOrderId: 'order_someone_elses' })).status).toBe(400);
    expect((await post(customer, id, 'payment/confirm', { razorpayOrderId: checkout.orderId })).status).toBe(400);
    expect((await post(otherCustomer, id, 'payment/confirm', proof)).status).toBe(403);

    const paid = await post(customer, id, 'payment/confirm', proof);
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'PENDING', checkout: null, payment: { status: 'SUCCESS', method: 'ONLINE' }, actions: { canPay: false } });
    expect(timelineTypes(paid)).toEqual(['CREATED', 'PAYMENT_RECEIVED']);
    expect(keysOf(paid.body.data)).toEqual(keysOf(examples.booking('pending')));

    // Confirming again changes nothing.
    const again = await post(customer, id, 'payment/confirm', proof);
    expect(again.status).toBe(200);
    expect(timelineTypes(again)).toEqual(['CREATED', 'PAYMENT_RECEIVED']);
  });

  it('keeps its address when the saved address is edited or deleted', async () => {
    const before = (await get(customer, id)).body.data.address;
    await request(app).patch(`${API}/users/me/addresses/${homeAddress.id}`).set(customer.auth).send({ line1: '99, Somewhere Else Road', pincode: '560001' });
    expect((await get(customer, id)).body.data.address).toEqual(before);

    await makeAddress(customer.id, { line1: '7, Second Home Lane', isDefault: false });
    const removed = await request(app).delete(`${API}/users/me/addresses/${homeAddress.id}`).set(customer.auth);
    expect(removed.status).toBe(200);
    expect((await get(customer, id)).body.data.address).toEqual(before);
  });

  it('can be rescheduled until work starts', async () => {
    const scheduledAt = inHours(72);
    expect((await post(customer, id, 'reschedule', { scheduledAt: inHours(-1) })).status).toBe(400);
    expect((await post(otherCustomer, id, 'reschedule', { scheduledAt })).status).toBe(403);
    expect((await post(pro, id, 'reschedule', { scheduledAt })).status).toBe(403);

    const res = await post(customer, id, 'reschedule', { scheduledAt });
    expect(res.status).toBe(200);
    expect(res.body.data.scheduledAt).toBe(scheduledAt);
    expect(timelineTypes(res)).toEqual(['CREATED', 'PAYMENT_RECEIVED', 'RESCHEDULED']);

    const byAdmin = await post(admin, id, 'reschedule', { scheduledAt: inHours(80) });
    expect(byAdmin.status).toBe(200);
  });

  it('is cancelled by the customer, leaving a refund for the team to issue', async () => {
    expect((await post(customer, id, 'cancel', {})).status).toBe(400);
    expect((await post(otherCustomer, id, 'cancel', { reason: 'Not mine to cancel' })).status).toBe(403);

    const res = await post(customer, id, 'cancel', { reason: 'Plans changed, will rebook next week' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'REFUND_PENDING' },
      cancellation: { by: 'CUSTOMER', reason: 'Plans changed, will rebook next week' },
      actions: { canCancel: false, canReschedule: false },
    });
    expect(keysOf(res.body.data)).toEqual(keysOf(examples.booking('cancelled')));
    expect((await post(customer, id, 'cancel', { reason: 'Cancel it again' })).status).toBe(409);
  });

  it('has its refund recorded by an admin, once', async () => {
    expect((await post(customer, id, 'payment/refund', { reference: 'rfnd_123' })).status).toBe(403);
    const res = await post(admin, id, 'payment/refund', { reference: 'rfnd_Pr4s5t6u7V8w9X' });
    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('REFUNDED');
    expect(res.body.data.payment.refundedAt).not.toBeNull();
    expect(timelineTypes(res).at(-1)).toBe('REFUNDED');
    expect((await post(admin, id, 'payment/refund', { reference: 'rfnd_again' })).status).toBe(409);
  });
});

describe('Payment confirmed by the gateway instead of the app', () => {
  let id;
  let orderId;

  it('releases the booking when the webhook reports the payment', async () => {
    const res = await book(otherCustomer, { paymentMode: 'ONLINE', scheduledAt: inHours(30) });
    id = res.body.data.id;
    orderId = res.body.data.checkout.orderId;

    await payments.handleGatewayEvent({ event: 'payment.failed', orderId, paymentId: 'pay_failed_1' });
    expect((await get(otherCustomer, id)).body.data).toMatchObject({ status: 'AWAITING_PAYMENT', payment: { status: 'FAILED' } });

    await payments.handleGatewayEvent({ event: 'payment.captured', orderId, paymentId: 'pay_captured_1' });
    const after = await get(otherCustomer, id);
    expect(after.body.data).toMatchObject({ status: 'PENDING', payment: { status: 'SUCCESS' } });
    expect(after.body.data.timeline.at(-1)).toMatchObject({ type: 'PAYMENT_RECEIVED', actorRole: 'SYSTEM', actor: null });

    // A repeat of the same event, or the app confirming late, changes nothing.
    await payments.handleGatewayEvent({ event: 'payment.captured', orderId, paymentId: 'pay_captured_1' });
    const late = await post(otherCustomer, id, 'payment/confirm', { razorpayOrderId: orderId, razorpayPaymentId: 'pay_captured_1', razorpaySignature: 'x' });
    expect(late.status).toBe(200);
    expect(timelineTypes(late)).toEqual(['CREATED', 'PAYMENT_RECEIVED']);
  });

  it('rejects webhook calls without a valid signature', async () => {
    const res = await request(app).post(`${API}/payments/webhook`).set('Content-Type', 'application/json').send(JSON.stringify({ event: 'payment.captured' }));
    expect(res.status).toBe(401);
  });

  it('shows a payment only to its customer and admins', async () => {
    const payment = await prisma.payment.findFirst({ where: { bookingId: id } });
    expect((await request(app).get(`${API}/payments/${payment.id}`).set(otherCustomer.auth)).status).toBe(200);
    expect((await request(app).get(`${API}/payments/${payment.id}`).set(admin.auth)).status).toBe(200);
    expect((await request(app).get(`${API}/payments/${payment.id}`).set(customer.auth)).status).toBe(403);
  });
});

describe('Listing bookings', () => {
  const list = (user, query = {}) => request(app).get(`${API}/bookings`).query(query).set(user.auth);
  const mine = (query) => list(admin, { customerId: customer.id, ...query });

  it('gives each customer only their own, split into upcoming and past', async () => {
    const all = await list(customer);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.items.every((item) => item.customer === undefined && item.timeline === undefined)).toBe(true);

    expect((await list(customer, { scope: 'upcoming' })).body.items).toEqual([]);
    expect((await list(customer, { scope: 'past' })).body.meta.total).toBe(2);
    expect((await list(otherCustomer, { scope: 'upcoming' })).body.meta.total).toBe(1);
    expect((await list(customer, { status: 'COMPLETED' })).body.items.map((item) => item.status)).toEqual(['COMPLETED']);

    // Admin-only filters cannot be used to look at someone else's bookings.
    const peek = await list(otherCustomer, { customerId: customer.id });
    expect(peek.body.meta.total).toBe(1);
    expect(peek.body.items[0].status).toBe('PENDING');
  });

  it('gives a professional the jobs assigned to them', async () => {
    const jobs = await list(pro);
    expect(jobs.body.meta.total).toBe(1);
    expect(jobs.body.items[0]).toMatchObject({ status: 'COMPLETED', customer: { id: customer.id } });
    expect((await list(otherPro)).body.items).toEqual([]);
  });

  it('gives admins everything, with filters', async () => {
    expect((await mine()).body.meta.total).toBe(2);
    expect((await mine({ status: 'COMPLETED,CANCELLED' })).body.meta.total).toBe(2);
    expect((await mine({ status: 'PENDING' })).body.items).toEqual([]);
    expect((await mine({ paymentMode: 'ONLINE' })).body.items.map((item) => item.status)).toEqual(['CANCELLED']);
    expect((await mine({ paymentStatus: 'REFUNDED' })).body.items.map((item) => item.status)).toEqual(['CANCELLED']);
    expect((await mine({ paymentStatus: 'SUCCESS' })).body.items.map((item) => item.status)).toEqual(['COMPLETED']);
    expect((await mine({ professionalId: pro.professionalId })).body.meta.total).toBe(1);
    expect((await mine({ unassigned: 'true' })).body.items.map((item) => item.status)).toEqual(['CANCELLED']);
    // The cancelled booking was rescheduled to 80 hours out; the completed one was for 26 hours out.
    expect((await mine({ scheduledFrom: day(3) })).body.items.map((item) => item.status)).toEqual(['CANCELLED']);
    expect((await mine({ createdFrom: day(1) })).body.items).toEqual([]);

    const byCategory = await list(admin, { categoryId: category.id, cityId: city.id, zoneId: zone.id });
    expect(byCategory.body.meta.total).toBe(3);
    expect((await list(admin, { categoryId: inactiveCategory.id })).body.items).toEqual([]);

    const waiting = await list(admin, { categoryId: category.id, status: 'PENDING,MATCHING' });
    expect(waiting.body.items.map((item) => item.customer.id)).toEqual([otherCustomer.id]);

    expect((await list(admin, { status: 'DONE' })).status).toBe(400);
  });

  it('finds a booking by its reference number or its customer', async () => {
    const target = (await mine({ status: 'COMPLETED' })).body.items[0];
    const byNumber = await list(admin, { search: target.bookingNumber });
    expect(byNumber.body.items.map((item) => item.id)).toEqual([target.id]);
    expect((await list(admin, { search: target.bookingNumber.replace('-', '').toLowerCase() })).body.items.map((item) => item.id)).toEqual([target.id]);
    expect((await list(admin, { search: 'BK-999999999' })).body.items).toEqual([]);
    // Bare digits are looser: the booking number, or part of a phone number or address.
    const byDigits = await list(admin, { search: String(Number(target.bookingNumber.slice(3))), categoryId: category.id });
    expect(byDigits.body.items.map((item) => item.id)).toContain(target.id);

    const byName = await list(admin, { search: `b-customer2 ${run}` });
    expect(byName.body.items.map((item) => item.customer.id)).toEqual([otherCustomer.id]);
  });

  it('sorts by schedule or price', async () => {
    const soonest = await list(admin, { categoryId: category.id, sortBy: 'scheduledAt', sortOrder: 'asc' });
    const times = soonest.body.items.map((item) => item.scheduledAt);
    expect(times).toEqual([...times].sort());
    expect((await list(admin, { categoryId: category.id, sortBy: 'price', limit: 2 })).body.meta).toMatchObject({ total: 3, totalPages: 2 });
  });

  it('summarises bookings for admins only', async () => {
    const res = await request(app).get(`${API}/bookings/summary`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(keysOf(res.body.data)).toEqual(keysOf(schemas.BookingSummary.properties));
    expect(res.body.data.total).toBe(Object.values(res.body.data.byStatus).reduce((sum, count) => sum + count, 0));
    expect(res.body.data.byStatus.COMPLETED).toBeGreaterThanOrEqual(1);
    expect(res.body.data.waitingForProfessional).toBeGreaterThanOrEqual(1);
    expect(res.body.data.amountCollected).toBeGreaterThanOrEqual(299);

    expect((await request(app).get(`${API}/bookings/summary`).set(customer.auth)).status).toBe(403);
    expect((await request(app).get(`${API}/bookings/summary`).set(pro.auth)).status).toBe(403);
  });

  it('lets an admin cancel a booking the customer no longer can', async () => {
    const res = await book(otherCustomer, { scheduledAt: inHours(40) });
    const id = res.body.data.id;
    await request(app).post(`${API}/dispatch/bookings/${id}/assign`).set(admin.auth).send({ professionalId: otherPro.professionalId });
    await setStatus(admin, id, 'IN_PROGRESS');
    expect((await post(otherCustomer, id, 'cancel', { reason: 'Too slow, cancel it' })).status).toBe(409);

    const cancelled = await post(admin, id, 'cancel', { reason: 'Professional could not complete the job' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancellation: { by: 'ADMIN' }, payment: { status: 'UNPAID' } });
  });

  it('lets only a super admin delete a booking, in any status', async () => {
    const superAdmin = { Authorization: `Bearer ${issueTokenPair({ ...admin, role: 'SUPER_ADMIN' }).accessToken}` };
    const remove = (auth, id) => request(app).delete(`${API}/bookings/${id}`).set(auth);
    const res = await book(otherCustomer, { scheduledAt: inHours(50) });
    const id = res.body.data.id;
    expect((await remove(admin.auth, id)).status).toBe(403);

    // Even with a vendor on the job.
    await request(app).post(`${API}/dispatch/bookings/${id}/assign`).set(admin.auth).send({ professionalId: otherPro.professionalId });

    const deleted = await remove(superAdmin, id);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ deleted: true, bookingNumber: res.body.data.bookingNumber });
    expect((await request(app).get(`${API}/bookings/${id}`).set(admin.auth)).status).toBe(404);
  });
});
