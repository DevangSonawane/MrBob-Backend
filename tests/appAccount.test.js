const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = Date.now().toString(36);

// The customer app's and the vendor app's own endpoints: /customer/… and /vendor/…
describe('Customer and vendor app: profile and bookings', () => {
  const made = { users: [], cities: [], categories: [] };
  let customer;
  let other;
  let vendor;
  let city;
  let zone;
  let category;
  let booking;

  const make = async (role, label, data = {}) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run}`, phone: `+91${String(Date.now()).slice(-6)}${made.users.length}000`.slice(0, 13), role, ...data } });
    made.users.push(user.id);
    return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
  };
  const get = (who, path) => request(app).get(`${API}${path}`).set(who.auth);

  beforeAll(async () => {
    city = await prisma.city.create({ data: { name: `App City ${run}`, tier: 'TIER_1' } });
    made.cities.push(city.id);
    zone = await prisma.zone.create({ data: { cityId: city.id, name: 'Central' } });
    category = await prisma.serviceCategory.create({ data: { name: `App Service ${run}`, tier: 'REPAIR', basePrice: 300 } });
    made.categories.push(category.id);

    customer = await make('CUSTOMER', 'app-customer');
    other = await make('CUSTOMER', 'app-other');
    vendor = await make('PROFESSIONAL', 'app-vendor');
    const profile = await prisma.professional.create({ data: { userId: vendor.id, categories: [], onboardingStatus: 'APPROVED', kycStatus: 'VERIFIED' } });
    vendor.professionalId = profile.id;

    booking = await prisma.booking.create({
      data: { customerId: customer.id, professionalId: profile.id, categoryId: category.id, status: 'ASSIGNED', scheduledAt: new Date(Date.now() + 86400000), address: '1 App Road', price: 300, description: 'Fan is not working' },
    });
    await prisma.booking.create({ data: { customerId: other.id, categoryId: category.id, status: 'PENDING', address: '2 Other Road', price: 300, description: 'Tap is leaking badly' } });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { categoryId: { in: made.categories } } });
    await prisma.professional.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: made.categories } } });
    await prisma.zone.deleteMany({ where: { cityId: { in: made.cities } } });
    await prisma.city.deleteMany({ where: { id: { in: made.cities } } });
  });

  it('keeps each app to its own role', async () => {
    expect((await request(app).get(`${API}/customer/profile`)).status).toBe(401);
    expect((await get(vendor, '/customer/profile')).status).toBe(403);
    expect((await get(customer, '/vendor/profile')).status).toBe(403);
    expect((await get(customer, '/vendor/bookings')).status).toBe(403);
  });

  it('lets a customer view and edit their profile', async () => {
    const profile = await get(customer, '/customer/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ id: customer.id, role: 'CUSTOMER', addresses: [] });
    expect(profile.body.data).not.toHaveProperty('passwordHash');

    const edited = await request(app).patch(`${API}/customer/profile`).set(customer.auth).send({ name: 'Asha Rao', gender: 'FEMALE' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ name: 'Asha Rao', gender: 'FEMALE' });
  });

  it('gives a customer only their own bookings, and the detail of one', async () => {
    const list = await get(customer, '/customer/bookings');
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.id)).toEqual([booking.id]);
    expect(list.body.meta.total).toBe(1);
    expect((await get(customer, '/customer/bookings?scope=past')).body.items).toEqual([]);

    const detail = await get(customer, `/customer/bookings/${booking.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id: booking.id, status: 'ASSIGNED', professional: { id: vendor.professionalId } });
    expect(Array.isArray(detail.body.data.timeline)).toBe(true);
    expect((await get(other, `/customer/bookings/${booking.id}`)).status).toBe(403);
  });

  it('gives a vendor their profile, jobs and job detail', async () => {
    const profile = await get(vendor, '/vendor/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ userId: vendor.id, professionalId: vendor.professionalId, status: 'APPROVED', isVerified: true, jobs: { total: 1, open: 1, completed: 0 } });

    const jobs = await get(vendor, '/vendor/bookings');
    expect(jobs.body.items.map((item) => item.id)).toEqual([booking.id]);
    const job = await get(vendor, `/vendor/bookings/${booking.id}`);
    expect(job.status).toBe(200);
    expect(job.body.data.customer).toMatchObject({ id: customer.id });
  });

  it('lets a vendor edit their profile, even after approval', async () => {
    const patch = (body) => request(app).patch(`${API}/vendor/profile`).set(vendor.auth).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ cityId: city.id, homeZoneId: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b' })).status).toBe(400);
    expect((await patch({ categories: ['3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d'] })).status).toBe(400);

    const saved = await patch({ name: 'Ravi K', addressLine1: '14, 2nd Main Road', pincode: '560034', cityId: city.id, homeZoneId: zone.id, experienceYears: 7, categories: [category.id], dateOfBirth: '1990-05-17' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      status: 'APPROVED',
      personalDetails: { name: 'Ravi K', addressLine1: '14, 2nd Main Road', pincode: '560034', city: { id: city.id }, dateOfBirth: '1990-05-17' },
      services: { experienceYears: 7, homeZone: { id: zone.id }, categories: [{ id: category.id }] },
    });

    // Only what is sent changes; null clears.
    const cleared = await patch({ pincode: null });
    expect(cleared.body.data.personalDetails).toMatchObject({ addressLine1: '14, 2nd Main Road', pincode: null });
  });

  it('issues an invoice when the job is completed, for the customer and the team', async () => {
    const admin = await make('ADMIN', 'inv-admin');
    expect((await get(customer, `/customer/bookings/${booking.id}/invoice`)).status).toBe(404); // not completed yet

    await request(app).patch(`${API}/bookings/${booking.id}/status`).set(admin.auth).send({ status: 'IN_PROGRESS' });
    await request(app).patch(`${API}/bookings/${booking.id}/status`).set(admin.auth).send({ status: 'COMPLETED' });

    const invoice = await get(customer, `/customer/bookings/${booking.id}/invoice`);
    expect(invoice.status).toBe(200);
    expect(invoice.body.data).toMatchObject({ status: 'UNPAID', total: 300, tax: 0, billedTo: { id: customer.id }, items: [{ quantity: 1, amount: 300 }], vendor: { id: vendor.professionalId } });
    expect(invoice.body.data.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect((await get(other, `/customer/bookings/${booking.id}/invoice`)).status).toBe(404);

    // The booking itself now points at its invoice.
    const detail = (await get(customer, `/customer/bookings/${booking.id}`)).body.data;
    expect(detail.invoice).toMatchObject({ id: invoice.body.data.id, invoiceNumber: invoice.body.data.invoiceNumber, pdf: invoice.body.data.pdf });
    expect((await get(vendor, `/vendor/bookings/${booking.id}`)).body.data.invoice).toBeNull();
    expect((await get(admin, `/invoices?customerId=${customer.id}`)).body.items.map((item) => item.id)).toEqual([invoice.body.data.id]);

    const file = await get(customer, invoice.body.data.pdf);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');

    expect((await get(customer, '/invoices')).status).toBe(403);
    const listed = await get(admin, `/invoices?search=${invoice.body.data.invoiceNumber}`);
    expect(listed.body.items.map((item) => item.id)).toEqual([invoice.body.data.id]);
    expect(listed.body.totals).toMatchObject({ invoices: 1, amount: 300, paid: 0, unpaid: 300 });
    expect((await get(admin, `/invoices/${invoice.body.data.id}/pdf`)).headers['content-type']).toBe('application/pdf');
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', completedAt: null } });
  });

  it('lets the customer and the vendor rate each other once the job is completed', async () => {
    const admin = await make('ADMIN', 'rate-admin');
    const rate = (who, prefix, body) => request(app).post(`${API}/${prefix}/bookings/${booking.id}/rating`).set(who.auth).send(body);
    expect((await rate(customer, 'customer', { rating: 5 })).status).toBe(409); // not completed yet

    await request(app).patch(`${API}/bookings/${booking.id}/status`).set(admin.auth).send({ status: 'IN_PROGRESS' });
    await request(app).patch(`${API}/bookings/${booking.id}/status`).set(admin.auth).send({ status: 'COMPLETED' });

    expect((await rate(customer, 'customer', { rating: 6 })).status).toBe(400);
    expect((await rate(other, 'customer', { rating: 5 })).status).toBe(404);
    const byCustomer = await rate(customer, 'customer', { rating: 4, comment: 'Good work' });
    expect(byCustomer.status).toBe(200);
    expect(byCustomer.body.data).toMatchObject({ actions: { canRate: true }, ratings: { byCustomer: { rating: 4, comment: 'Good work' }, byVendor: null } });
    // Changing it updates the vendor's average.
    await rate(customer, 'customer', { rating: 5 });
    expect(Number((await prisma.professional.findUnique({ where: { id: vendor.professionalId } })).rating)).toBe(5);

    const byVendor = await rate(vendor, 'vendor', { rating: 3, comment: 'Late to open the door' });
    expect(byVendor.body.data.ratings).toEqual({ byCustomer: null, byVendor: expect.objectContaining({ rating: 3 }) });
    // Each side sees only its own; the team sees both.
    expect((await get(customer, `/customer/bookings/${booking.id}`)).body.data.ratings.byVendor).toBeNull();
    expect((await get(admin, `/bookings/${booking.id}`)).body.data.ratings).toMatchObject({ byCustomer: { rating: 5 }, byVendor: { rating: 3 } });

    const ofVendors = await get(admin, `/reviews?authorRole=CUSTOMER&professionalId=${vendor.professionalId}`);
    expect(ofVendors.body.items).toHaveLength(1);
    expect(ofVendors.body.items[0]).toMatchObject({ rating: 5, from: { type: 'CUSTOMER', id: customer.id }, about: { type: 'VENDOR', professionalId: vendor.professionalId } });
    expect(ofVendors.body.summary).toMatchObject({ average: 5, count: 1 });
    const ofCustomer = await get(admin, `/reviews?authorRole=PROFESSIONAL&customerId=${customer.id}`);
    expect(ofCustomer.body.items[0]).toMatchObject({ rating: 3, from: { type: 'VENDOR' }, about: { type: 'CUSTOMER', id: customer.id } });
    expect((await get(admin, '/reviews/summary')).body.data).toMatchObject({ vendorRatings: expect.any(Object), customerRatings: expect.any(Object) });
    expect((await get(customer, '/reviews/summary')).status).toBe(403);

    await prisma.review.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', completedAt: null } });
  });

  it('lets a super admin edit everything on a vendor\'s profile', async () => {
    const superAdmin = await make('SUPER_ADMIN', 'app-super');
    const admin = await make('ADMIN', 'app-admin');
    const path = `${API}/vendor-onboarding/applications/${vendor.professionalId}`;
    expect((await request(app).patch(path).set(admin.auth).send({ name: 'Nope' })).status).toBe(403);
    expect((await request(app).patch(path).set(superAdmin.auth).send({ phone: customer.phone })).status).toBe(409);

    const phone = `+9155${String(Date.now()).slice(-8)}`;
    const res = await request(app)
      .patch(path)
      .set(superAdmin.auth)
      .send({ name: 'Ravi K Sharma', phone, alternatePhone: '+919800000001', emergencyContactName: 'Sita', experienceYears: 9, categories: [category.id], cityId: city.id, homeZoneId: zone.id, landmark: '' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      personalDetails: { name: 'Ravi K Sharma', phone, alternatePhone: '+919800000001', emergencyContactName: 'Sita', landmark: null, city: { id: city.id } },
      services: { experienceYears: 9, homeZone: { id: zone.id }, categories: [{ id: category.id }] },
    });
  });

  it('refuses to delete an account with a job in progress, then deletes it', async () => {
    expect((await request(app).delete(`${API}/vendor/profile`).set(vendor.auth)).status).toBe(409);
    expect((await request(app).delete(`${API}/customer/profile`).set(customer.auth)).status).toBe(409);

    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED' } });
    const gone = await request(app).delete(`${API}/customer/profile`).set(customer.auth);
    expect(gone.status).toBe(200);
    expect(gone.body.data).toEqual({ deleted: true });
    expect((await prisma.user.findUnique({ where: { id: customer.id } })).deletedAt).not.toBeNull();

    expect((await request(app).delete(`${API}/vendor/profile`).set(vendor.auth)).body.data).toEqual({ deleted: true });
  });
});
