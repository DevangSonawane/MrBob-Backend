const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

// The endpoints behind the dashboard's Subscriptions, Payments, Partners,
// Best sellers and Add client screens.

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const created = { userIds: [], cityIds: [], categoryIds: [] };
let admin, customer, city, plumber, painter;

const makeUser = async (role, label, extra = {}) => {
  const user = await prisma.user.create({ data: { name: `${label} ${run}`, role, phone: `+9198${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true, ...extra } });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

const makeBooking = (category, status, createdAt, paid) =>
  prisma.booking.create({
    data: {
      customerId: customer.id,
      categoryId: category.id,
      status,
      price: category.basePrice,
      address: '12, Test Road',
      cityId: city.id,
      createdAt,
      ...(paid && { payment: { create: { amount: category.basePrice, ...paid } } }),
    },
  });

beforeAll(async () => {
  city = await prisma.city.create({ data: { name: `Screens City ${run}`, tier: 'TIER_1' } });
  created.cityIds.push(city.id);
  plumber = await prisma.serviceCategory.create({ data: { name: `Plumber ${run}`, tier: 'REPAIR', basePrice: 300 } });
  painter = await prisma.serviceCategory.create({ data: { name: `Painter ${run}`, tier: 'RENOVATION', basePrice: 2000 } });
  created.categoryIds.push(plumber.id, painter.id);
  admin = await makeUser('ADMIN', 'screens-admin');
  customer = await makeUser('CUSTOMER', 'screens-customer');
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { OR: [{ booking: { customerId: { in: created.userIds } } }, { subscription: { customerId: { in: created.userIds } } }] } });
  await prisma.booking.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.aMCSubscription.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.partner.deleteMany({ where: { cityId: { in: created.cityIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
});

describe('Subscriptions', () => {
  beforeAll(async () => {
    await prisma.aMCSubscription.createMany({
      data: [
        { customerId: customer.id, plan: `Complete Care ${run}`, startDate: daysAgo(330), renewalDate: daysAgo(-35), status: 'ACTIVE' },
        { customerId: customer.id, plan: `AC Care ${run}`, startDate: daysAgo(400), renewalDate: daysAgo(35), status: 'EXPIRED' },
      ],
    });
  });

  it('lets the team search by plan or customer', async () => {
    const byPlan = await request(app).get(`${API}/amc`).query({ search: `complete care ${run}` }).set(admin.auth);
    expect(byPlan.status).toBe(200);
    expect(byPlan.body.items.map((item) => item.plan)).toEqual([`Complete Care ${run}`]);
    expect(byPlan.body.items[0].customer).toMatchObject({ id: customer.id, name: customer.name });

    const byCustomer = await request(app).get(`${API}/amc`).query({ search: customer.phone }).set(admin.auth);
    expect(byCustomer.body.meta.total).toBe(2);
  });

  it('gives the team totals, and nobody else', async () => {
    const res = await request(app).get(`${API}/amc/summary`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ renewalWindowDays: 60 });
    expect(res.body.data.byStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(res.body.data.renewingSoon).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`${API}/amc/summary`).set(customer.auth)).status).toBe(403);
  });
});

describe('Payments', () => {
  let paidBooking;

  beforeAll(async () => {
    paidBooking = await makeBooking(plumber, 'COMPLETED', daysAgo(2), { status: 'SUCCESS', method: 'CASH', paidAt: new Date() });
    await makeBooking(plumber, 'CANCELLED', daysAgo(3), { status: 'REFUND_PENDING', method: 'ONLINE', gatewayRef: `order_${run}` });
  });

  it('lists every payment with what it paid for and who paid', async () => {
    const res = await request(app).get(`${API}/payments`).query({ search: customer.phone }).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    const cash = res.body.items.find((item) => item.method === 'CASH');
    expect(cash).toMatchObject({ amount: 300, status: 'SUCCESS', kind: 'BOOKING', customer: { id: customer.id }, booking: { id: paidBooking.id, service: { name: plumber.name } } });
    expect(cash.booking.bookingNumber).toMatch(/^BK-\d{6}$/);
  });

  it('filters by status, method and booking reference', async () => {
    const refunds = await request(app).get(`${API}/payments`).query({ search: customer.phone, status: 'REFUND_PENDING,REFUNDED' }).set(admin.auth);
    expect(refunds.body.items.map((item) => item.status)).toEqual(['REFUND_PENDING']);
    const online = await request(app).get(`${API}/payments`).query({ search: `order_${run}`, method: 'ONLINE' }).set(admin.auth);
    expect(online.body.meta.total).toBe(1);
    const byReference = await request(app).get(`${API}/payments`).query({ search: `BK-${String(paidBooking.sequence).padStart(6, '0')}` }).set(admin.auth);
    expect(byReference.body.items.map((item) => item.booking.id)).toEqual([paidBooking.id]);
    expect((await request(app).get(`${API}/payments`).query({ status: 'NOPE' }).set(admin.auth)).status).toBe(400);
  });

  it('totals are for the team only', async () => {
    const res = await request(app).get(`${API}/payments/summary`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.collected.amount).toBeGreaterThanOrEqual(300);
    expect(res.body.data.refundPending.count).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`${API}/payments`).set(customer.auth)).status).toBe(403);
  });
});

describe('Partners', () => {
  it('adds a partner, refusing a duplicate or an unknown city', async () => {
    const res = await request(app).post(`${API}/partners`).set(admin.auth).send({ type: 'RWA', name: ` Lake View RWA ${run} `, cityId: city.id, contact: '+919000011111' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: `Lake View RWA ${run}`, city: { id: city.id, name: city.name }, bookings: 0 });

    expect((await request(app).post(`${API}/partners`).set(admin.auth).send({ type: 'RWA', name: `lake view rwa ${run}`, cityId: city.id })).status).toBe(409);
    expect((await request(app).post(`${API}/partners`).set(admin.auth).send({ type: 'RWA', name: 'Nowhere RWA', cityId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('searches, and counts each type for the tabs', async () => {
    await request(app).post(`${API}/partners`).set(admin.auth).send({ type: 'BUILDER', name: `Prestige ${run}`, cityId: city.id });
    const res = await request(app).get(`${API}/partners`).query({ cityId: city.id, type: 'BUILDER' }).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.name)).toEqual([`Prestige ${run}`]);
    expect(res.body.counts).toEqual({ BUILDER: 1, RWA: 1 });
    const searched = await request(app).get(`${API}/partners`).query({ search: `lake view rwa ${run}` }).set(admin.auth);
    expect(searched.body.meta.total).toBe(1);
  });
});

describe('Best sellers', () => {
  beforeAll(async () => {
    await makeBooking(painter, 'COMPLETED', daysAgo(5));
    await makeBooking(painter, 'PENDING', daysAgo(5));
    await makeBooking(painter, 'CANCELLED', daysAgo(5));
    await makeBooking(painter, 'COMPLETED', daysAgo(120)); // outside 90 days
  });

  it('ranks services by bookings in the period; revenue counts completed jobs', async () => {
    const res = await request(app).get(`${API}/dashboard/best-sellers`).query({ days: 90 }).set(admin.auth);
    expect(res.status).toBe(200);
    const painting = res.body.data.items.find((item) => item.id === painter.id);
    const plumbing = res.body.data.items.find((item) => item.id === plumber.id);
    // Painter: 2 (the cancelled one and the old one left out). Plumber: 1 (its cancelled one left out).
    expect(painting).toMatchObject({ bookings: 2, completed: 1, revenue: 2000, tier: 'RENOVATION' });
    expect(plumbing).toMatchObject({ bookings: 1, completed: 1, revenue: 300 });
    expect(painting.rank).toBeLessThan(plumbing.rank);

    const longer = await request(app).get(`${API}/dashboard/best-sellers`).query({ days: 180 }).set(admin.auth);
    expect(longer.body.data.items.find((item) => item.id === painter.id).bookings).toBe(3);
    expect((await request(app).get(`${API}/dashboard/best-sellers`).query({ days: 7 }).set(admin.auth)).status).toBe(400);
  });
});

describe('Adding a customer from the dashboard', () => {
  const phone = `+9199${randomDigits(8)}`;

  it('saves the phone number to sign in with, and the address', async () => {
    const res = await request(app)
      .post(`${API}/users/customers`)
      .set(admin.auth)
      .send({ name: `Aarav ${run}`, phone, email: '', address: { line1: '12, 4th Cross, 5th Block', cityId: city.id, state: 'Karnataka', pincode: '560034' } });
    expect(res.status).toBe(201);
    created.userIds.push(res.body.data.id);
    expect(res.body.data).toMatchObject({ phone, email: null, role: 'CUSTOMER', isOnboarded: true, city: { id: city.id } });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.body.data.addresses).toHaveLength(1);
    expect(res.body.data.addresses[0]).toMatchObject({ isDefault: true, pincode: '560034' });
  });

  it('refuses a phone number already in use, and saves nothing for a bad city', async () => {
    const taken = await request(app).post(`${API}/users/customers`).set(admin.auth).send({ name: 'Someone Else', phone });
    expect(taken.status).toBe(409);

    const otherPhone = `+9199${randomDigits(8)}`;
    const badCity = await request(app)
      .post(`${API}/users/customers`)
      .set(admin.auth)
      .send({ name: 'Nowhere Person', phone: otherPhone, address: { line1: '1, Nowhere Street', cityId: '00000000-0000-4000-8000-000000000000', state: 'Karnataka', pincode: '560034' } });
    expect(badCity.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { phone: otherPhone } })).toBeNull();
  });

  it('is for the team only', async () => {
    expect((await request(app).post(`${API}/users/customers`).set(customer.auth).send({ name: 'Me Again', phone: `+9199${randomDigits(8)}` })).status).toBe(403);
  });
});
