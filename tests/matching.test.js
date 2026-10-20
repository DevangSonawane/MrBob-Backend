const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');
const matching = require('../src/modules/matching/matching.service');

const API = '/api/v1';
const run = Date.now().toString(36);
// A point in Bandra, Mumbai, and offsets north of it (0.009° latitude ≈ 1 km).
const HOME = { latitude: 19.06, longitude: 72.83 };
const north = (km) => ({ latitude: HOME.latitude + km * 0.009, longitude: HOME.longitude });

// Nearby (H3) dispatch: offers in widening rings, first to accept wins,
// then open to everyone if nobody nearby takes it.
describe('Nearby dispatch with H3', () => {
  const made = { users: [], categories: [], cities: [] };
  let admin;
  let customer;
  let category;
  let otherCategory;
  let city;
  const vendors = {};

  const make = async (role, label, data = {}) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@example.com`, role, ...data } });
    made.users.push(user.id);
    return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
  };
  const makeVendor = async (label, { approved = true, categories } = {}) => {
    const user = await make('PROFESSIONAL', label);
    const profile = await prisma.professional.create({ data: { userId: user.id, categories: categories ?? [category.id], onboardingStatus: approved ? 'APPROVED' : 'SUBMITTED', kycStatus: approved ? 'VERIFIED' : 'IN_REVIEW' } });
    return { ...user, professionalId: profile.id };
  };
  const goOnline = (vendor, point) => request(app).put(`${API}/vendor/presence`).set(vendor.auth).send({ online: true, ...point });
  const available = async (vendor) => (await request(app).get(`${API}/vendor/jobs/available?limit=100`).set(vendor.auth)).body.items ?? [];
  // Only the jobs offered to this vendor (other suites may leave bookings open to everyone).
  const offered = async (vendor) => (await available(vendor)).filter((job) => job.offer);
  const newBooking = (point = HOME) =>
    prisma.booking.create({ data: { customerId: customer.id, categoryId: category.id, cityId: city.id, status: 'PENDING', address: '1 Hill Road', price: 400, description: 'Tap leaking badly', ...(point && { latitude: point.latitude, longitude: point.longitude }) } });

  beforeAll(async () => {
    city = await prisma.city.create({ data: { name: `H3 City ${run}`, tier: 'TIER_1' } });
    made.cities.push(city.id);
    category = await prisma.serviceCategory.create({ data: { name: `H3 Plumber ${run}`, tier: 'REPAIR', basePrice: 400 } });
    otherCategory = await prisma.serviceCategory.create({ data: { name: `H3 Painter ${run}`, tier: 'RENOVATION', basePrice: 900 } });
    made.categories.push(category.id, otherCategory.id);
    admin = await make('ADMIN', 'h3-admin');
    customer = await make('CUSTOMER', 'h3-customer');
    vendors.near = await makeVendor('h3-near');
    vendors.mid = await makeVendor('h3-mid');
    vendors.far = await makeVendor('h3-far');
    vendors.offline = await makeVendor('h3-offline');
    vendors.unapproved = await makeVendor('h3-unapproved', { approved: false });
    vendors.painter = await makeVendor('h3-painter', { categories: [otherCategory.id] });
  });

  afterAll(async () => {
    const ids = Object.values(vendors).map((vendor) => vendor.professionalId);
    await prisma.booking.deleteMany({ where: { categoryId: { in: made.categories } } });
    await prisma.walletEntry.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: made.categories } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.city.deleteMany({ where: { id: { in: made.cities } } });
  });

  it('lets vendors go online with their position, placed in an H3 hexagon', async () => {
    expect((await request(app).put(`${API}/vendor/presence`).set(vendors.near.auth).send({ online: true })).status).toBe(400); // needs a position
    const res = await goOnline(vendors.near, north(0.4));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ online: true, canReceiveOffers: true, h3Cell: expect.stringMatching(/^88/) });
    await goOnline(vendors.mid, north(4));
    await goOnline(vendors.far, north(20));
    await goOnline(vendors.unapproved, north(0.3));
    await goOnline(vendors.painter, north(0.2));
    expect((await request(app).get(`${API}/vendor/presence`).set(vendors.offline.auth)).body.data.online).toBe(false);
  });

  it('shows the customer how many vendors are around, without exact positions', async () => {
    const res = await request(app).get(`${API}/customer/nearby-vendors`).set(customer.auth).query({ ...HOME, categoryId: category.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ vendorsNearby: 2, radiusKm: 5 }); // near and mid; not far, unapproved or the painter
    expect(res.body.data.nearestKm).toBeLessThan(1);
    expect(res.body.data.etaMinutes).toBeGreaterThan(0);
    expect(res.body.data.areas[0]).toMatchObject({ cell: expect.stringMatching(/^87/), vendors: expect.any(Number) });
  });

  let bookingId;
  it('offers a new booking to the nearest vendors first, widening the ring when they decline', async () => {
    bookingId = (await newBooking()).id;
    expect(await matching.start(bookingId)).toMatchObject({ wave: 1, offered: 1 });
    const nearOffers = await offered(vendors.near);
    expect(nearOffers.map((job) => job.id)).toEqual([bookingId]);
    expect(nearOffers[0]).toMatchObject({ offer: { wave: 1 }, openToAll: false });
    expect(nearOffers[0].distanceKm).toBeLessThan(1);
    expect(await offered(vendors.mid)).toEqual([]);
    expect((await request(app).post(`${API}/vendor/jobs/${bookingId}/accept`).set(vendors.mid.auth)).status).toBe(409); // not offered to them
    expect((await prisma.booking.findUnique({ where: { id: bookingId } })).status).toBe('MATCHING');

    expect((await request(app).post(`${API}/vendor/jobs/${bookingId}/decline`).set(vendors.near.auth)).status).toBe(200);
    // Rings with nobody in them are skipped: the next offer goes to the vendor 4 km away.
    const next = await offered(vendors.mid);
    expect(next.map((job) => job.id)).toEqual([bookingId]);
    expect(next[0].offer.wave).toBeGreaterThan(1);
    expect(await offered(vendors.near)).toEqual([]);
  });

  it('gives the job to the vendor who accepts, and shows the team every offer', async () => {
    const accepted = await request(app).post(`${API}/vendor/jobs/${bookingId}/accept`).set(vendors.mid.auth);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: 'ASSIGNED', professional: { id: vendors.mid.professionalId } });

    const offers = await request(app).get(`${API}/dispatch/bookings/${bookingId}/offers`).set(admin.auth);
    expect(offers.body.data.offers.map((offer) => `${offer.vendor.professionalId === vendors.near.professionalId ? 'near' : 'mid'}:${offer.status}`)).toEqual(['near:DECLINED', 'mid:ACCEPTED']);
  });

  it('moves on when an offer runs out, and opens the job to everyone when nobody nearby takes it', async () => {
    const booking = await newBooking();
    await matching.start(booking.id);
    // The nearest vendor lets the offer run out.
    await prisma.jobOffer.updateMany({ where: { bookingId: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await matching.tick();
    // The mid vendor has an assigned job, but is not on one right now, so still gets the next wave.
    expect((await offered(vendors.mid)).map((job) => job.id)).toContain(booking.id);
    await request(app).post(`${API}/vendor/jobs/${booking.id}/decline`).set(vendors.mid.auth);

    // The far vendor is 20 km away, beyond the widest ring: the job is opened to all approved vendors.
    const open = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(open.openToAllAt).not.toBeNull();
    const forFar = await available(vendors.far);
    expect(forFar.find((job) => job.id === booking.id)).toMatchObject({ openToAll: true, offer: null });
    expect((await request(app).post(`${API}/vendor/jobs/${booking.id}/accept`).set(vendors.far.auth)).status).toBe(200);
  });

  it('opens a booking with no location to everyone straight away', async () => {
    const booking = await newBooking(null);
    expect(await matching.start(booking.id)).toEqual({ openToAll: true });
    expect((await available(vendors.offline)).map((job) => job.id)).toContain(booking.id);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
  });

  it('hands back unanswered offers when a vendor goes offline', async () => {
    const booking = await newBooking();
    await matching.start(booking.id);
    expect((await offered(vendors.near)).map((job) => job.id)).toEqual([booking.id]);
    await request(app).put(`${API}/vendor/presence`).set(vendors.near.auth).send({ online: false });
    expect((await prisma.jobOffer.findFirst({ where: { bookingId: booking.id, professionalId: vendors.near.professionalId } })).status).toBe('WITHDRAWN');
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
  });

  it('draws supply and demand per hexagon for the team', async () => {
    expect((await request(app).get(`${API}/dispatch/map`).set(customer.auth)).status).toBe(403);
    const res = await request(app).get(`${API}/dispatch/map`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.resolution).toBe(7);
    expect(res.body.data.totals.onlineVendors).toBeGreaterThanOrEqual(2);
    expect(res.body.data.cells[0]).toMatchObject({ cell: expect.any(String), boundary: expect.any(Array), center: expect.any(Array) });
  });
});
