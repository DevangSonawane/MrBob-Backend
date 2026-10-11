const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = Date.now().toString(36);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('Service categories', () => {
  let auth;
  let admin;
  const created = [];

  beforeAll(async () => {
    admin = await prisma.user.create({ data: { name: 'Category Admin', email: `cat-admin-${run}@example.com`, role: 'ADMIN' } });
    auth = { Authorization: `Bearer ${issueTokenPair(admin).accessToken}` };
  });

  afterAll(async () => {
    await prisma.serviceCategory.deleteMany({ where: { id: { in: created } } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it('creates a category, with a picture sent in the same call', async () => {
    const res = await request(app)
      .post(`${API}/categories`)
      .set(auth)
      .field('name', `Carpentry ${run}`)
      .field('tier', 'REPAIR')
      .field('basePrice', '449')
      .attach('image', PNG, { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    expect(res.body.data.image).toMatch(new RegExp(`^/categories/${res.body.data.id}/image`));
    expect(res.body.data).not.toHaveProperty('imageKey');

    // The picture is public.
    const image = await request(app).get(`${API}${res.body.data.image}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');

    const listed = (await request(app).get(`${API}/categories`)).body.data.find((item) => item.id === res.body.data.id);
    expect(listed.image).toBe(res.body.data.image);
  });

  it('refuses a duplicate name, whatever the case', async () => {
    const res = await request(app).post(`${API}/categories`).set(auth).send({ name: `carpentry ${run}`, tier: 'REPAIR', basePrice: 100 });
    expect(res.status).toBe(409);
  });

  it('adds, replaces and removes a picture on an existing category', async () => {
    const plain = await request(app).post(`${API}/categories`).set(auth).send({ name: `Painting ${run}`, tier: 'RENOVATION', basePrice: 999 });
    expect(plain.status).toBe(201);
    expect(plain.body.data.image).toBeNull();
    const { id } = plain.body.data;
    created.push(id);
    expect((await request(app).get(`${API}/categories/${id}/image`)).status).toBe(404);

    const notAnImage = await request(app).put(`${API}/categories/${id}/image`).set(auth).attach('image', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' });
    expect(notAnImage.status).toBe(400);
    expect((await request(app).put(`${API}/categories/${id}/image`).attach('image', PNG, 'c.png')).status).toBe(401);

    const added = await request(app).put(`${API}/categories/${id}/image`).set(auth).attach('image', PNG, { filename: 'c.png', contentType: 'image/png' });
    expect(added.status).toBe(200);
    expect(added.body.data.image).toContain(`/categories/${id}/image`);

    const removed = await request(app).delete(`${API}/categories/${id}/image`).set(auth);
    expect(removed.body.data.image).toBeNull();
  });

  it('removes a category from the catalogue, and brings it back when added again', async () => {
    const id = created[1];
    const listed = async () => (await request(app).get(`${API}/categories`)).body.data.some((item) => item.id === id);
    expect((await request(app).delete(`${API}/categories/${id}`)).status).toBe(401);
    const removed = await request(app).delete(`${API}/categories/${id}`).set(auth);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, name: `Painting ${run}` });
    expect(await listed()).toBe(false);

    const again = await request(app).post(`${API}/categories`).set(auth).send({ name: `painting ${run}`, tier: 'REPAIR', basePrice: 500 });
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ id, tier: 'REPAIR', isActive: true });
    expect(await listed()).toBe(true);
  });
});

describe('Cities and zones', () => {
  let auth;
  let admin;
  let cityId;

  beforeAll(async () => {
    admin = await prisma.user.create({ data: { name: 'Zone Admin', email: `zone-admin-${run}@example.com`, role: 'ADMIN' } });
    auth = { Authorization: `Bearer ${issueTokenPair(admin).accessToken}` };
  });

  afterAll(async () => {
    await prisma.zone.deleteMany({ where: { cityId } });
    await prisma.city.delete({ where: { id: cityId } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it('creates, refuses duplicates, removes and brings back', async () => {
    const city = await request(app).post(`${API}/zones/cities`).set(auth).send({ name: `Testville ${run}`, tier: 'TIER_2' });
    expect(city.status).toBe(201);
    cityId = city.body.data.id;
    expect((await request(app).post(`${API}/zones/cities`).set(auth).send({ name: `testville ${run}`, tier: 'TIER_2' })).status).toBe(409);

    const zone = await request(app).post(`${API}/zones`).set(auth).send({ cityId, name: 'North' });
    expect(zone.status).toBe(201);
    expect((await request(app).post(`${API}/zones`).set(auth).send({ cityId, name: 'north' })).status).toBe(409);

    const zones = async () => (await request(app).get(`${API}/zones`).query({ cityId })).body.data.map((item) => item.name);
    expect((await request(app).delete(`${API}/zones/${zone.body.data.id}`).set(auth)).status).toBe(200);
    expect(await zones()).toEqual([]);
    expect((await request(app).post(`${API}/zones`).set(auth).send({ cityId, name: 'North' })).body.data.id).toBe(zone.body.data.id);
    expect(await zones()).toEqual(['North']);

    // Removing the city takes its zones with it.
    expect((await request(app).delete(`${API}/zones/cities/${cityId}`).set(auth)).status).toBe(200);
    const cities = (await request(app).get(`${API}/zones/cities`)).body.data.map((item) => item.id);
    expect(cities).not.toContain(cityId);
    expect(await zones()).toEqual([]);
    expect((await request(app).post(`${API}/zones`).set(auth).send({ cityId, name: 'South' })).status).toBe(404);
  });
});

describe("Editing a user's address, city and zone", () => {
  const made = { users: [], cities: [] };
  let superAdmin;
  let admin;
  let cityA;
  let cityB;
  let zoneA;
  let zoneB;

  const token = (user) => ({ Authorization: `Bearer ${issueTokenPair(user).accessToken}` });
  const make = async (role, label) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@example.com`, role } });
    made.users.push(user.id);
    return user;
  };
  const put = (id, body, auth = superAdmin) => request(app).put(`${API}/users/${id}/location`).set(auth).send(body);

  beforeAll(async () => {
    superAdmin = token(await make('SUPER_ADMIN', 'loc-super'));
    admin = token(await make('ADMIN', 'loc-admin'));
    cityA = await prisma.city.create({ data: { name: `Loc A ${run}`, tier: 'TIER_1' } });
    cityB = await prisma.city.create({ data: { name: `Loc B ${run}`, tier: 'TIER_1' } });
    made.cities.push(cityA.id, cityB.id);
    zoneA = await prisma.zone.create({ data: { cityId: cityA.id, name: 'A1' } });
    zoneB = await prisma.zone.create({ data: { cityId: cityB.id, name: 'B1' } });
  });

  afterAll(async () => {
    await prisma.professional.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.address.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.zone.deleteMany({ where: { cityId: { in: made.cities } } });
    await prisma.city.deleteMany({ where: { id: { in: made.cities } } });
  });

  it("sets a customer's default address, and keeps the zone in step with the city", async () => {
    const customer = await make('CUSTOMER', 'loc-customer');
    expect((await put(customer.id, { cityId: cityA.id }, admin)).status).toBe(403);
    expect((await put(customer.id, { cityId: cityA.id, zoneId: zoneB.id })).status).toBe(400);

    const saved = await put(customer.id, { addressLine1: '1 Test Road', cityId: cityA.id, zoneId: zoneA.id, state: 'Karnataka', pincode: '560001' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ isVendor: false, addressLine1: '1 Test Road', pincode: '560001', city: { id: cityA.id }, zone: { id: zoneA.id } });
    const address = await prisma.address.findFirst({ where: { userId: customer.id } });
    expect(address).toMatchObject({ isDefault: true, line1: '1 Test Road', cityId: cityA.id, zoneId: zoneA.id });
    expect((await prisma.user.findUnique({ where: { id: customer.id } })).cityId).toBe(cityA.id);

    // Another city without a zone: the old zone no longer applies. Other fields stay.
    const moved = await put(customer.id, { cityId: cityB.id });
    expect(moved.body.data).toMatchObject({ addressLine1: '1 Test Road', city: { id: cityB.id }, zone: null });
    expect((await request(app).get(`${API}/users/${customer.id}/location`).set(admin)).body.data.city.id).toBe(cityB.id);
  });

  it("sets a vendor's profile address and the zone they work from", async () => {
    const vendor = await make('PROFESSIONAL', 'loc-vendor');
    await prisma.professional.create({ data: { userId: vendor.id, categories: [] } });
    const saved = await put(vendor.id, { addressLine1: '9 Vendor Lane', landmark: '', cityId: cityB.id, zoneId: zoneB.id });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ isVendor: true, addressLine1: '9 Vendor Lane', landmark: null, city: { id: cityB.id }, zone: { id: zoneB.id } });
    const profile = await prisma.professional.findUnique({ where: { userId: vendor.id } });
    expect(profile).toMatchObject({ addressLine1: '9 Vendor Lane', homeZoneId: zoneB.id });
    expect(await prisma.address.count({ where: { userId: vendor.id } })).toBe(0);
  });
});
