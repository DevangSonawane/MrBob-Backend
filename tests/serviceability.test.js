const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
// Pincodes of our own, so the suite never collides with seeded or real ones.
const base = Number(`8${randomDigits(3)}00`);
const pin = (offset) => String(base + offset);
const inHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const created = { userIds: [], cityIds: [], zoneIds: [], categoryIds: [] };
let city, zone, otherZone, otherCity, category, admin, customer;
const originalMode = env.PINCODE_GEOFENCE;

const makeUser = async (role, label) => {
  const user = await prisma.user.create({
    data: { name: `${label} ${run}`, role, phone: `+9196${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true },
  });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

const addAddress = (pincode, overrides = {}) =>
  request(app)
    .post(`${API}/users/me/addresses`)
    .set(customer.auth)
    .send({ line1: '12, 4th Cross, 5th Block', cityId: city.id, state: 'Karnataka', pincode, ...overrides });

const book = (addressId) =>
  request(app)
    .post(`${API}/bookings`)
    .set(customer.auth)
    .send({ categoryId: category.id, scheduledAt: inHours(26), description: 'The kitchen tap has been leaking for two days.', paymentMode: 'PAY_AFTER_SERVICE', addressId });

const check = (pincode) => request(app).get(`${API}/zones/serviceability`).query({ pincode });

beforeAll(async () => {
  city = await prisma.city.create({ data: { name: `Geofence City ${run}`, tier: 'TIER_1' } });
  otherCity = await prisma.city.create({ data: { name: `Geofence Other ${run}`, tier: 'TIER_2' } });
  created.cityIds.push(city.id, otherCity.id);
  zone = await prisma.zone.create({ data: { cityId: city.id, name: 'North' } });
  otherZone = await prisma.zone.create({ data: { cityId: city.id, name: 'South' } });
  created.zoneIds.push(zone.id, otherZone.id);
  category = await prisma.serviceCategory.create({ data: { name: `Plumber ${run}`, tier: 'REPAIR', basePrice: 349 } });
  created.categoryIds.push(category.id);
  admin = await makeUser('ADMIN', 'geo-admin');
  customer = await makeUser('CUSTOMER', 'geo-customer');
});

afterEach(() => {
  env.PINCODE_GEOFENCE = originalMode;
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { customerId: { in: created.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.serviceablePincode.deleteMany({ where: { cityId: { in: created.cityIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.zone.deleteMany({ where: { id: { in: created.zoneIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
});

describe('Managing the pincode list', () => {
  it('is for the team only', async () => {
    expect((await request(app).get(`${API}/zones/pincodes`)).status).toBe(401);
    expect((await request(app).get(`${API}/zones/pincodes`).set(customer.auth)).status).toBe(403);
    expect((await request(app).post(`${API}/zones/pincodes`).set(customer.auth).send({ cityId: city.id, pincodes: [pin(1)] })).status).toBe(403);
  });

  it('adds a pasted list, and adding it again is safe', async () => {
    const res = await request(app)
      .post(`${API}/zones/pincodes`)
      .set(admin.auth)
      .send({ cityId: city.id, zoneId: zone.id, areaName: 'North End', pincodes: `${pin(1)}, ${pin(2)}\n${pin(3)} ${pin(1)}` });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ added: 3, updated: 0 });
    expect(res.body.data.items.map((item) => item.pincode)).toEqual([pin(1), pin(2), pin(3)]);
    expect(res.body.data.items[0]).toMatchObject({ city: { id: city.id }, zone: { id: zone.id, name: 'North' }, areaName: 'North End', isActive: true, serviceable: true });

    const again = await request(app).post(`${API}/zones/pincodes`).set(admin.auth).send({ cityId: city.id, pincodes: [pin(3), pin(4)] });
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ added: 1, updated: 1 });
    // Moved to the city with no zone, the area name kept.
    expect(again.body.data.items.find((item) => item.pincode === pin(3))).toMatchObject({ zone: null, areaName: 'North End' });
  });

  it('refuses bad pincodes and a zone from another city', async () => {
    const bad = await request(app).post(`${API}/zones/pincodes`).set(admin.auth).send({ cityId: city.id, pincodes: ['12345', '012345'] });
    expect(bad.status).toBe(400);
    const wrongZone = await request(app).post(`${API}/zones/pincodes`).set(admin.auth).send({ cityId: otherCity.id, zoneId: zone.id, pincodes: [pin(9)] });
    expect(wrongZone.status).toBe(400);
  });

  it('lists with filters', async () => {
    const res = await request(app).get(`${API}/zones/pincodes`).query({ cityId: city.id, zoneId: zone.id }).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.pincode)).toEqual([pin(1), pin(2)]);
    const searched = await request(app).get(`${API}/zones/pincodes`).query({ search: pin(4) }).set(admin.auth);
    expect(searched.body.items.map((item) => item.pincode)).toEqual([pin(4)]);
  });
});

describe('Checking a pincode', () => {
  it('says whether a pincode is served, without a token', async () => {
    const served = await check(pin(1));
    expect(served.status).toBe(200);
    expect(served.body.data).toEqual({ pincode: pin(1), serviceable: true, city: { id: city.id, name: city.name }, zone: { id: zone.id, name: 'North' }, areaName: 'North End' });

    expect((await check(pin(50))).body.data).toEqual({ pincode: pin(50), serviceable: false, city: null, zone: null, areaName: null });
    expect((await check('abc')).status).toBe(400);
  });

  it('closes a paused pincode, and reopens it', async () => {
    const row = await prisma.serviceablePincode.findUnique({ where: { pincode: pin(2) } });
    const paused = await request(app).patch(`${API}/zones/pincodes/${row.id}`).set(admin.auth).send({ isActive: false });
    expect(paused.status).toBe(200);
    expect(paused.body.data).toMatchObject({ isActive: false, serviceable: false });
    expect((await check(pin(2))).body.data.serviceable).toBe(false);

    await request(app).patch(`${API}/zones/pincodes/${row.id}`).set(admin.auth).send({ isActive: true });
    expect((await check(pin(2))).body.data.serviceable).toBe(true);
  });

  it('closes the pincodes of a zone taken out of service', async () => {
    await request(app).post(`${API}/zones/pincodes`).set(admin.auth).send({ cityId: city.id, zoneId: otherZone.id, pincodes: [pin(5)] });
    expect((await check(pin(5))).body.data.serviceable).toBe(true);
    expect((await request(app).delete(`${API}/zones/${otherZone.id}`).set(admin.auth)).status).toBe(200);
    expect((await check(pin(5))).body.data.serviceable).toBe(false);
  });
});

describe('Addresses and bookings', () => {
  let inside, outside;

  it('saves an address outside the area, flagged as not serviceable', async () => {
    const res = await addAddress(pin(60));
    expect(res.status).toBe(201);
    expect(res.body.data.serviceable).toBe(false);
    outside = res.body.data;
  });

  it('gives an address saved without a zone the zone of its pincode', async () => {
    const res = await addAddress(pin(1));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ serviceable: true, zone: { id: zone.id } });
    inside = res.body.data;

    // A zone taken out of service (above) can't be chosen, whatever the pincode.
    expect((await addAddress(pin(2), { zoneId: otherZone.id })).status).toBe(400);

    const list = await request(app).get(`${API}/users/me/addresses`).set(customer.auth);
    expect(Object.fromEntries(list.body.data.map((address) => [address.pincode, address.serviceable]))).toEqual({ [pin(1)]: true, [pin(60)]: false });
  });

  it('moves the zone along when the pincode changes', async () => {
    const res = await request(app).patch(`${API}/users/me/addresses/${outside.id}`).set(customer.auth).send({ pincode: pin(2) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ serviceable: true, zone: { id: zone.id } });
    const back = await request(app).patch(`${API}/users/me/addresses/${outside.id}`).set(customer.auth).send({ pincode: pin(60) });
    expect(back.body.data.serviceable).toBe(false);
  });

  it('books anywhere while the geofence is off', async () => {
    env.PINCODE_GEOFENCE = 'off';
    expect((await book(outside.id)).status).toBe(201);
  });

  it('refuses a booking outside the area while it is strict', async () => {
    env.PINCODE_GEOFENCE = 'strict';
    const refused = await book(outside.id);
    expect(refused.status).toBe(400);
    expect(refused.body.details).toEqual({ code: 'PINCODE_NOT_SERVICEABLE', pincode: pin(60) });
    expect((await book(inside.id)).status).toBe(201);
  });

  it('refuses a team booking outside the area before creating the customer', async () => {
    env.PINCODE_GEOFENCE = 'strict';
    const phone = `+9197${randomDigits(8)}`;
    const res = await request(app)
      .post(`${API}/bookings/admin`)
      .set(admin.auth)
      .send({
        categoryId: category.id,
        scheduledAt: inHours(26),
        description: 'Walk-in: bathroom tap leaking.',
        newCustomer: { name: 'Walk In', phone },
        address: { line1: '9, Lake Road', cityId: city.id, state: 'Karnataka', pincode: pin(61) },
      });
    expect(res.status).toBe(400);
    expect(res.body.details.code).toBe('PINCODE_NOT_SERVICEABLE');
    expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();
  });

  it('removes a pincode', async () => {
    const row = await prisma.serviceablePincode.findUnique({ where: { pincode: pin(4) } });
    const res = await request(app).delete(`${API}/zones/pincodes/${row.id}`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true, pincode: pin(4) });
    expect((await request(app).delete(`${API}/zones/pincodes/${row.id}`).set(admin.auth)).status).toBe(404);
  });
});
