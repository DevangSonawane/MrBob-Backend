const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');
const { issueTokenPair } = require('../src/modules/auth/token.util');

// Editing what the team manages: services, cities, zones, partners,
// subscriptions and bookings.

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const originalGeofence = env.PINCODE_GEOFENCE;

const created = { userIds: [], cityIds: [], categoryIds: [] };
let admin, customer, vendor, city, zone, otherZone, category, homeAddress, officeAddress;

const makeUser = async (role, label) => {
  const user = await prisma.user.create({ data: { name: `${label} ${run}`, role, phone: `+9196${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true } });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

const patch = (path, body, user = admin) => request(app).patch(`${API}${path}`).set(user.auth).send(body);

const makeBooking = (overrides = {}) =>
  prisma.booking.create({
    data: {
      customerId: customer.id,
      categoryId: category.id,
      status: 'PENDING',
      price: 349,
      address: '12, Old Road, Bengaluru',
      addressId: homeAddress.id,
      cityId: city.id,
      pincode: homeAddress.pincode,
      latitude: 12.9352,
      longitude: 77.6245,
      scheduledAt: new Date(Date.now() + 26 * 60 * 60 * 1000),
      ...overrides,
    },
  });

beforeAll(async () => {
  city = await prisma.city.create({ data: { name: `Edit City ${run}`, tier: 'TIER_2' } });
  created.cityIds.push(city.id);
  zone = await prisma.zone.create({ data: { cityId: city.id, name: 'North' } });
  otherZone = await prisma.zone.create({ data: { cityId: city.id, name: 'South' } });
  category = await prisma.serviceCategory.create({ data: { name: `Plumber ${run}`, tier: 'REPAIR', basePrice: 349 } });
  created.categoryIds.push(category.id);
  admin = await makeUser('ADMIN', 'edit-admin');
  customer = await makeUser('CUSTOMER', 'edit-customer');
  const vendorUser = await makeUser('PROFESSIONAL', 'edit-vendor');
  vendor = await prisma.professional.create({ data: { userId: vendorUser.id, categories: [category.id], kycStatus: 'VERIFIED', onboardingStatus: 'APPROVED' } });
  homeAddress = await prisma.address.create({ data: { userId: customer.id, line1: '12, Old Road', cityId: city.id, state: 'Karnataka', pincode: '560034', isDefault: true, latitude: 12.9352, longitude: 77.6245 } });
  officeAddress = await prisma.address.create({ data: { userId: customer.id, label: 'WORK', line1: '5, Office Park', cityId: city.id, zoneId: zone.id, state: 'Karnataka', pincode: '560095', contactName: 'Reception', contactPhone: '+919811111111', latitude: 12.94, longitude: 77.62 } });
});

afterEach(() => {
  env.PINCODE_GEOFENCE = originalGeofence;
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.aMCSubscription.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.partner.deleteMany({ where: { cityId: { in: created.cityIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.zone.deleteMany({ where: { cityId: { in: created.cityIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
});

describe('Services', () => {
  it('changes the price and name, keeping bookings already made', async () => {
    const booking = await makeBooking();
    const res = await patch(`/categories/${category.id}`, { name: `Plumbing ${run}`, basePrice: 399 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: `Plumbing ${run}`, basePrice: '399' });
    expect(Number((await prisma.booking.findUnique({ where: { id: booking.id } })).price)).toBe(349);
  });

  it('refuses a name another service has, an empty change, and non-staff', async () => {
    const other = await prisma.serviceCategory.create({ data: { name: `Electrician ${run}`, tier: 'REPAIR', basePrice: 299 } });
    created.categoryIds.push(other.id);
    expect((await patch(`/categories/${category.id}`, { name: `electrician ${run}` })).status).toBe(409);
    expect((await patch(`/categories/${category.id}`, {})).status).toBe(400);
    expect((await patch(`/categories/${category.id}`, { basePrice: 1 }, customer)).status).toBe(403);
  });
});

describe('Cities and zones', () => {
  it('renames a city and changes its tier', async () => {
    const res = await patch(`/zones/cities/${city.id}`, { name: `Edited City ${run}`, tier: 'TIER_1' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: `Edited City ${run}`, tier: 'TIER_1' });
  });

  it('renames a zone, refusing a name already used in that city', async () => {
    expect((await patch(`/zones/${otherZone.id}`, { name: 'north' })).status).toBe(409);
    const res = await patch(`/zones/${otherZone.id}`, { name: 'South East' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('South East');
    expect((await patch('/zones/00000000-0000-4000-8000-000000000000', { name: 'Nowhere' })).status).toBe(404);
  });
});

describe('Partners', () => {
  it('edits a partner and clears its contact', async () => {
    const partner = await prisma.partner.create({ data: { type: 'RWA', name: `Lake View ${run}`, cityId: city.id, contact: '+919000011111' } });
    const res = await patch(`/partners/${partner.id}`, { type: 'BUILDER', name: `Lake View Homes ${run}`, contact: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: 'BUILDER', name: `Lake View Homes ${run}`, contact: null, city: { id: city.id } });
  });

  it('refuses a duplicate name in the city', async () => {
    const a = await prisma.partner.create({ data: { type: 'RWA', name: `Palm Grove ${run}`, cityId: city.id } });
    await prisma.partner.create({ data: { type: 'RWA', name: `Oak Grove ${run}`, cityId: city.id } });
    expect((await patch(`/partners/${a.id}`, { name: `oak grove ${run}` })).status).toBe(409);
  });
});

describe('Subscriptions', () => {
  it('changes the dates and status, keeping the renewal after the start', async () => {
    const subscription = await prisma.aMCSubscription.create({ data: { customerId: customer.id, plan: 'Care', startDate: new Date('2026-01-01'), renewalDate: new Date('2027-01-01') } });
    const res = await patch(`/amc/${subscription.id}`, { plan: 'Complete Care', renewalDate: '2027-02-01', status: 'EXPIRED' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plan: 'Complete Care', status: 'EXPIRED', customer: { id: customer.id } });
    expect((await patch(`/amc/${subscription.id}`, { renewalDate: '2025-12-01' })).status).toBe(400);
    expect((await patch(`/amc/${subscription.id}`, { status: 'ACTIVE' }, customer)).status).toBe(403);
  });
});

describe('Bookings', () => {
  it('changes the price, contact and description, and notes it on the timeline', async () => {
    const booking = await makeBooking();
    const res = await patch(`/bookings/${booking.id}`, { price: 449, contactName: 'Meera', contactPhone: '+919812345670', description: 'Two taps leaking now', note: 'Customer called' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: 449, description: 'Two taps leaking now', address: { contactName: 'Meera', contactPhone: '+919812345670' } });
    const edited = res.body.data.timeline.find((item) => item.type === 'EDITED');
    expect(edited.note).toMatch(/Price: ₹349 → ₹449/);
    expect(edited.note).toMatch(/Customer called/);
  });

  it('moves a booking that is looking for a vendor, and starts matching again from the new place', async () => {
    const booking = await makeBooking({ status: 'MATCHING', h3Cell: '8861892ad5fffff', dispatchWave: 2 });
    await prisma.jobOffer.create({ data: { bookingId: booking.id, professionalId: vendor.id, wave: 1, status: 'OFFERED', expiresAt: new Date(Date.now() + 60000) } });

    const res = await patch(`/bookings/${booking.id}`, { addressId: officeAddress.id });
    expect(res.status).toBe(200);
    expect(res.body.data.address).toMatchObject({ pincode: '560095', zone: { id: zone.id }, contactName: 'Reception' });
    expect(res.body.data.address.line).toMatch(/^5, Office Park/);

    const saved = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(saved).toMatchObject({ addressId: officeAddress.id, dispatchWave: expect.any(Number) });
    // The offer for the old place is gone.
    expect(await prisma.jobOffer.count({ where: { bookingId: booking.id, status: 'OFFERED', wave: 1 } })).toBe(0);
    const edited = res.body.data.timeline.find((item) => item.type === 'EDITED');
    expect(edited).toMatchObject({ fromStatus: 'MATCHING', toStatus: 'PENDING' });
  });

  it('saves a new address to the customer when the booking moves there', async () => {
    const booking = await makeBooking();
    const res = await patch(`/bookings/${booking.id}`, { address: { line1: '9, Lake Road', cityId: city.id, state: 'Karnataka', pincode: '560102' }, contactName: 'Guard' });
    expect(res.status).toBe(200);
    expect(res.body.data.address).toMatchObject({ pincode: '560102', contactName: 'Guard' });
    expect(await prisma.address.count({ where: { userId: customer.id, line1: '9, Lake Road' } })).toBe(1);
  });

  it('refuses an address outside the area while the geofence is on', async () => {
    env.PINCODE_GEOFENCE = 'strict';
    const booking = await makeBooking();
    const res = await patch(`/bookings/${booking.id}`, { address: { line1: '1, Far Away Road', cityId: city.id, state: 'Karnataka', pincode: `9${randomDigits(5)}` } });
    expect(res.status).toBe(400);
    expect(res.body.details.code).toBe('PINCODE_NOT_SERVICEABLE');
  });

  it('keeps the rules: no move once work started, no price change when paid online, nothing once closed', async () => {
    const started = await makeBooking({ status: 'IN_PROGRESS', professionalId: vendor.id });
    expect((await patch(`/bookings/${started.id}`, { addressId: officeAddress.id })).status).toBe(409);
    // The person on site can still change while the job is under way.
    expect((await patch(`/bookings/${started.id}`, { contactName: 'Neighbour' })).status).toBe(200);

    const online = await makeBooking({ paymentMode: 'ONLINE', status: 'AWAITING_PAYMENT' });
    expect((await patch(`/bookings/${online.id}`, { price: 999 })).status).toBe(409);

    const done = await makeBooking({ status: 'COMPLETED' });
    expect((await patch(`/bookings/${done.id}`, { description: 'Too late now' })).status).toBe(409);

    const other = await makeBooking();
    expect((await patch(`/bookings/${other.id}`, { addressId: officeAddress.id, address: { line1: '1, Road', cityId: city.id, state: 'KA', pincode: '560001' } })).status).toBe(400);
    expect((await patch(`/bookings/${other.id}`, { note: 'only a note' })).status).toBe(400);
    expect((await patch(`/bookings/${other.id}`, { price: 500 }, customer)).status).toBe(403);
  });

  it('refuses an address from another customer', async () => {
    const stranger = await makeUser('CUSTOMER', 'edit-stranger');
    const strangerAddress = await prisma.address.create({ data: { userId: stranger.id, line1: '1, Elsewhere', cityId: city.id, state: 'Karnataka', pincode: '560001', isDefault: true } });
    const booking = await makeBooking();
    expect((await patch(`/bookings/${booking.id}`, { addressId: strangerAddress.id })).status).toBe(400);
  });
});
