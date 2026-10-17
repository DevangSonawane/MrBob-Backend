const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = Date.now().toString(36);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const DAY = 24 * 60 * 60 * 1000;

// The vendor's job flow (accept -> start code -> completion code -> photos ->
// complete) and the wallet it feeds.
describe('Vendor jobs and wallet', () => {
  const made = { users: [], categories: [], cities: [] };
  let customer;
  let vendor;
  let rival;
  let unapproved;
  let admin;
  let superAdmin;
  let category;
  let city;

  const make = async (role, label, data = {}) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@example.com`, role, ...data } });
    made.users.push(user.id);
    return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
  };
  const makeVendor = async (label, approved = true) => {
    const user = await make('PROFESSIONAL', label, { cityId: city.id });
    const profile = await prisma.professional.create({
      data: { userId: user.id, categories: [category.id], onboardingStatus: approved ? 'APPROVED' : 'SUBMITTED', kycStatus: approved ? 'VERIFIED' : 'IN_REVIEW' },
    });
    return { ...user, professionalId: profile.id };
  };
  const newBooking = (data = {}) =>
    prisma.booking.create({
      data: { customerId: customer.id, categoryId: category.id, cityId: city.id, status: 'PENDING', scheduledAt: new Date(Date.now() + DAY), address: '1 Job Road', pincode: '560001', price: 500, description: 'Ceiling fan is not working', ...data },
    });
  const call = (who, method, path, body) => request(app)[method](`${API}${path}`).set(who.auth).send(body);
  const job = (who, id, step, body) => call(who, 'post', `/vendor/jobs/${id}/${step}`, body);
  const otpOf = async (id) => (await call(customer, 'get', `/customer/bookings/${id}`)).body.data.otp;
  const wrong = (code) => (code === '0000' ? '1111' : '0000');
  const upload = (who, id, count = 1) => {
    const req = request(app).post(`${API}/vendor/jobs/${id}/completion-images`).set(who.auth);
    for (let i = 0; i < count; i += 1) req.attach('images', PNG, { filename: `work-${i}.png`, contentType: 'image/png' });
    return req;
  };
  // Takes a booking all the way to completed.
  const doJob = async (who, id) => {
    await job(who, id, 'accept');
    await job(who, id, 'start', { otp: (await otpOf(id)).start });
    await job(who, id, 'completion-otp', { otp: (await otpOf(id)).completion });
    await upload(who, id);
    return job(who, id, 'complete');
  };

  beforeAll(async () => {
    city = await prisma.city.create({ data: { name: `Job City ${run}`, tier: 'TIER_1' } });
    made.cities.push(city.id);
    category = await prisma.serviceCategory.create({ data: { name: `Job Service ${run}`, tier: 'REPAIR', basePrice: 500 } });
    made.categories.push(category.id);
    customer = await make('CUSTOMER', 'job-customer');
    admin = await make('ADMIN', 'job-admin');
    superAdmin = await make('SUPER_ADMIN', 'job-super');
    vendor = await makeVendor('job-vendor');
    rival = await makeVendor('job-rival');
    unapproved = await makeVendor('job-unapproved', false);
  });

  afterAll(async () => {
    const professionals = (await prisma.professional.findMany({ where: { userId: { in: made.users } }, select: { id: true } })).map((row) => row.id);
    await prisma.walletEntry.deleteMany({ where: { professionalId: { in: professionals } } });
    await prisma.vendorPayout.deleteMany({ where: { professionalId: { in: professionals } } });
    await prisma.booking.deleteMany({ where: { categoryId: { in: made.categories } } });
    await prisma.professional.deleteMany({ where: { id: { in: professionals } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: made.categories } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.city.deleteMany({ where: { id: { in: made.cities } } });
  });

  describe('taking and doing a job', () => {
    let id;

    it('shows open jobs to approved vendors only, without the customer\'s details', async () => {
      id = (await newBooking()).id;
      expect((await call(unapproved, 'get', '/vendor/jobs/available')).status).toBe(403);
      expect((await call(customer, 'get', '/vendor/jobs/available')).status).toBe(403);

      const open = await call(vendor, 'get', '/vendor/jobs/available');
      expect(open.status).toBe(200);
      const mine = open.body.items.find((item) => item.id === id);
      expect(mine).toMatchObject({ price: 500, area: { city: { id: city.id }, pincode: '560001' } });
      expect(mine).not.toHaveProperty('customer');
      expect(mine).not.toHaveProperty('address');
      expect((await call(vendor, 'get', `/vendor/jobs/available/${id}`)).body.data.id).toBe(id);
    });

    it('gives the job to the first vendor who accepts', async () => {
      expect((await job(unapproved, id, 'accept')).status).toBe(403);
      const accepted = await job(vendor, id, 'accept');
      expect(accepted.status).toBe(200);
      expect(accepted.body.data).toMatchObject({ status: 'ASSIGNED', professional: { id: vendor.professionalId }, customer: { id: customer.id }, job: { nextStep: 'START' }, otp: null });
      expect((await job(rival, id, 'accept')).status).toBe(409);
      expect((await call(rival, 'get', '/vendor/jobs/available')).body.items.some((item) => item.id === id)).toBe(false);
      expect((await call(vendor, 'get', '/vendor/bookings')).body.items.map((item) => item.id)).toContain(id);
    });

    it('starts only with the start code the customer was given', async () => {
      const { start, completion } = await otpOf(id);
      expect(start).toMatch(/^\d{4}$/);
      expect(completion).toBeNull();

      expect((await job(rival, id, 'start', { otp: start })).status).toBe(403);
      expect((await job(vendor, id, 'start', { otp: '12' })).status).toBe(400);
      const bad = await job(vendor, id, 'start', { otp: wrong(start) });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toContain('4 tries left');
      expect((await job(vendor, id, 'complete')).status).toBe(409); // not started

      const started = await job(vendor, id, 'start', { otp: start });
      expect(started.status).toBe(200);
      expect(started.body.data).toMatchObject({ status: 'IN_PROGRESS', job: { nextStep: 'VERIFY_COMPLETION_OTP', completionOtpVerified: false } });
      expect(started.body.data.startedAt).not.toBeNull();
    });

    it('needs the completion code and a photo before it can be completed', async () => {
      const { start, completion } = await otpOf(id);
      expect(start).toBeNull();
      expect(completion).toMatch(/^\d{4}$/);

      expect((await job(vendor, id, 'complete')).status).toBe(409); // no code yet
      expect((await job(vendor, id, 'completion-otp', { otp: wrong(completion) })).status).toBe(400);
      const verified = await job(vendor, id, 'completion-otp', { otp: completion });
      expect(verified.body.data.job).toEqual({ nextStep: 'UPLOAD_IMAGES', completionOtpVerified: true });
      expect((await otpOf(id)).completion).toBeNull();

      expect((await job(vendor, id, 'complete')).status).toBe(409); // no photo yet
      const notImage = await request(app).post(`${API}/vendor/jobs/${id}/completion-images`).set(vendor.auth).attach('images', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' });
      expect(notImage.status).toBe(400);
      expect((await upload(vendor, id, 6)).status).toBe(400);

      const uploaded = await upload(vendor, id, 2);
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.data.completionImages).toHaveLength(2);
      expect(uploaded.body.data.job.nextStep).toBe('COMPLETE');

      const [first, second] = uploaded.body.data.completionImages;
      expect((await call(customer, 'get', first.url)).headers['content-type']).toBe('image/png');
      expect((await call(rival, 'get', first.url)).status).toBe(403);
      const removed = await call(vendor, 'delete', `/vendor/jobs/${id}/completion-images/${second.id}`);
      expect(removed.body.data.completionImages).toHaveLength(1);
    });

    it('completes the job and credits the wallet, on hold for two days', async () => {
      const done = await job(vendor, id, 'complete');
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({ status: 'COMPLETED', job: { nextStep: null } });
      expect((await job(vendor, id, 'complete')).status).toBe(409);

      const wallet = await call(vendor, 'get', '/vendor/wallet');
      expect(wallet.body.data).toMatchObject({ balance: 500, onHold: 500, readyForPayout: 0, totalPaidOut: 0, totalEarned: 500, holdDays: 2, nextRelease: { amount: 500 } });

      const transactions = await call(vendor, 'get', '/vendor/wallet/transactions');
      expect(transactions.body.items).toHaveLength(1);
      expect(transactions.body.items[0]).toMatchObject({ type: 'EARNING', direction: 'CREDIT', amount: 500, status: 'ON_HOLD', booking: { id } });
      const hold = new Date(transactions.body.items[0].availableAt) - Date.now();
      expect(hold).toBeGreaterThan(1.9 * DAY);
      expect(hold).toBeLessThan(2.1 * DAY);

      const pending = await call(vendor, 'get', '/vendor/wallet/pending');
      expect(pending.body.totals).toEqual({ pending: 500, onHold: 500, readyForPayout: 0 });
      expect((await call(customer, 'get', '/vendor/wallet')).status).toBe(403);
    });

    it('replaces a code after five wrong tries', async () => {
      const other = (await newBooking()).id;
      await job(vendor, other, 'accept');
      const { start } = await otpOf(other);
      for (let i = 0; i < 4; i += 1) expect((await job(vendor, other, 'start', { otp: wrong(start) })).status).toBe(400);
      const locked = await job(vendor, other, 'start', { otp: wrong(start) });
      expect(locked.body.message).toContain('new code');
      // With a fixed test code configured the replacement is the same value; otherwise it must work where the old one would not.
      const fresh = (await otpOf(other)).start;
      expect((await job(vendor, other, 'start', { otp: fresh })).status).toBe(200);
      await prisma.booking.update({ where: { id: other }, data: { status: 'CANCELLED' } });
    });
  });

  describe('getting paid', () => {
    it('does not owe the vendor for a job the customer paid them for in cash', async () => {
      const id = (await newBooking({ price: 300, paymentMode: 'PAY_AFTER_SERVICE' })).id;
      await doJob(vendor, id);
      expect((await call(vendor, 'get', '/vendor/wallet')).body.data.balance).toBe(800);

      expect((await call(vendor, 'post', `/bookings/${id}/payment/collect`, { method: 'CASH' })).status).toBe(200);
      const wallet = (await call(vendor, 'get', '/vendor/wallet')).body.data;
      expect(wallet).toMatchObject({ balance: 500, collectedInCash: 300, totalEarned: 800 });
      const cash = await call(vendor, 'get', '/vendor/wallet/transactions?status=SETTLED_IN_CASH');
      expect(cash.body.items.map((item) => item.booking.id)).toEqual([id]);
    });

    it('lets the team see who is owed, and pay out only what is off hold', async () => {
      expect((await call(vendor, 'get', '/payouts/due')).status).toBe(403);
      const pay = (who) => call(who, 'post', `/payouts/vendors/${vendor.professionalId}`, { reference: 'NEFT-TEST-0001' });
      expect((await pay(admin)).status).toBe(403);
      expect((await pay(superAdmin)).status).toBe(409); // everything is still on hold

      // Two days pass.
      await prisma.walletEntry.updateMany({ where: { professionalId: vendor.professionalId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
      // A job finished just now stays on hold and is not part of this payout.
      await doJob(vendor, (await newBooking({ price: 200 })).id);

      const due = await call(admin, 'get', `/payouts/due?search=${encodeURIComponent(`job-vendor ${run}`)}`);
      expect(due.body.items).toHaveLength(1);
      expect(due.body.items[0]).toMatchObject({ professionalId: vendor.professionalId, balance: 700, readyForPayout: 500, onHold: 200, pendingEarnings: 2 });
      expect((await call(admin, 'get', `/payouts/vendors/${vendor.professionalId}`)).body.data.wallet).toMatchObject({ balance: 700, readyForPayout: 500 });

      const paid = await pay(superAdmin);
      expect(paid.status).toBe(201);
      expect(paid.body.data).toMatchObject({ amount: 500, reference: 'NEFT-TEST-0001', earningsCovered: 1, vendor: { professionalId: vendor.professionalId } });
      expect(paid.body.data.payoutNumber).toMatch(/^PO-\d{6}$/);
      expect((await pay(superAdmin)).status).toBe(409);

      const wallet = (await call(vendor, 'get', '/vendor/wallet')).body.data;
      expect(wallet).toMatchObject({ balance: 200, onHold: 200, readyForPayout: 0, totalPaidOut: 500, collectedInCash: 300, totalEarned: 1000, lastPayout: { amount: 500, reference: 'NEFT-TEST-0001' } });

      const transactions = (await call(vendor, 'get', '/vendor/wallet/transactions')).body.items;
      expect(transactions.map((item) => `${item.type}:${item.status}:${item.amount}`).sort()).toEqual(['EARNING:ON_HOLD:200', 'EARNING:PAID:500', 'EARNING:SETTLED_IN_CASH:300', 'PAYOUT:PAID:500']);
      expect(transactions.find((item) => item.type === 'PAYOUT')).toMatchObject({ direction: 'DEBIT', payout: { reference: 'NEFT-TEST-0001' } });
      expect((await call(vendor, 'get', '/vendor/wallet/pending')).body.totals).toEqual({ pending: 200, onHold: 200, readyForPayout: 0 });

      const history = await call(admin, 'get', `/payouts?professionalId=${vendor.professionalId}`);
      expect(history.body.items.map((item) => item.amount)).toEqual([500]);
      expect((await call(admin, 'get', `/payouts/vendors/${vendor.professionalId}/transactions?type=PAYOUT`)).body.meta.total).toBe(1);
    });

    it('credits the wallet when the team completes a job by hand, exactly once', async () => {
      const id = (await newBooking({ price: 150 })).id;
      await call(admin, 'post', `/dispatch/bookings/${id}/assign`, { professionalId: rival.professionalId });
      expect((await otpOf(id)).start).toMatch(/^\d{4}$/); // assigning by hand still issues the start code
      await call(admin, 'patch', `/bookings/${id}/status`, { status: 'IN_PROGRESS' });
      await call(admin, 'patch', `/bookings/${id}/status`, { status: 'COMPLETED' });
      expect((await call(rival, 'get', '/vendor/wallet')).body.data).toMatchObject({ balance: 150, jobsPaidFor: 1 });
    });
  });
});

describe('Booking for a customer from the dashboard', () => {
  const run2 = `${Date.now().toString(36)}b`;
  const made = { users: [], categories: [], cities: [] };
  let admin;
  let city;
  let zone;
  let category;
  let vendor;
  const phone = `+9190${String(Date.now()).slice(-8)}`;

  const make = async (role, label, data = {}) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run2}`, email: `${label}-${run2}@example.com`, role, ...data } });
    made.users.push(user.id);
    return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
  };
  const book = (who, body) => request(app).post(`${API}/bookings/admin`).set(who.auth).send(body);
  const soon = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

  beforeAll(async () => {
    admin = await make('ADMIN', 'adm-book');
    city = await prisma.city.create({ data: { name: `Admin City ${run2}`, tier: 'TIER_1' } });
    made.cities.push(city.id);
    zone = await prisma.zone.create({ data: { cityId: city.id, name: 'West' } });
    category = await prisma.serviceCategory.create({ data: { name: `Admin Service ${run2}`, tier: 'REPAIR', basePrice: 450 } });
    made.categories.push(category.id);
    vendor = await make('PROFESSIONAL', 'adm-vendor');
    vendor.professionalId = (await prisma.professional.create({ data: { userId: vendor.id, categories: [category.id], onboardingStatus: 'APPROVED', kycStatus: 'VERIFIED' } })).id;
  });

  afterAll(async () => {
    const customers = (await prisma.user.findMany({ where: { phone }, select: { id: true } })).map((row) => row.id);
    await prisma.booking.deleteMany({ where: { categoryId: { in: made.categories } } });
    await prisma.address.deleteMany({ where: { userId: { in: customers } } });
    await prisma.professional.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: [...made.users, ...customers] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: made.categories } } });
    await prisma.zone.deleteMany({ where: { cityId: { in: made.cities } } });
    await prisma.city.deleteMany({ where: { id: { in: made.cities } } });
  });

  it('creates the customer and their address, and books for them', async () => {
    const customer = await make('CUSTOMER', 'adm-cust');
    expect((await book(customer, {})).status).toBe(403);
    const body = {
      newCustomer: { name: 'Neha Sharma', phone },
      address: { line1: '22, Hill Road', cityId: city.id, zoneId: zone.id, state: 'Maharashtra', pincode: '400050' },
      categoryId: category.id,
      scheduledAt: soon(),
      description: 'Kitchen tap is leaking',
      note: 'Booked over the phone',
    };
    expect((await book(admin, { ...body, newCustomer: undefined })).status).toBe(400);
    expect((await book(admin, { ...body, scheduledAt: new Date(Date.now() - 60000).toISOString() })).status).toBe(400);

    const res = await book(admin, body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', price: 450, payment: { mode: 'PAY_AFTER_SERVICE' }, address: { city: { id: city.id }, zone: { id: zone.id } }, customer: { phone } });
    expect(res.body.data.timeline[0]).toMatchObject({ type: 'CREATED', actorRole: 'ADMIN', note: 'Booked by the team: Booked over the phone' });
    const created = await prisma.user.findUnique({ where: { phone }, include: { addresses: true } });
    expect(created).toMatchObject({ role: 'CUSTOMER', name: 'Neha Sharma' });
    expect(created.addresses).toHaveLength(1);

    // The same phone again reuses that customer; their saved address can be picked, and a vendor assigned at once.
    const again = await book(admin, { customerId: created.id, addressId: created.addresses[0].id, categoryId: category.id, scheduledAt: soon(), description: 'Bathroom tap too', price: 600, professionalId: vendor.professionalId });
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ status: 'ASSIGNED', price: 600, professional: { id: vendor.professionalId }, otp: { start: expect.stringMatching(/^\d{4}$/) } });
    const reused = await book(admin, { ...body, newCustomer: { name: 'Someone Else', phone } });
    expect(reused.body.data.customer.id).toBe(created.id);
  });
});

describe('Vendor sign-in for the web dashboard', () => {
  const tag = `${Date.now().toString(36)}c`;
  const vendorPhone = `+9188${String(Date.now()).slice(-8)}`;
  const customerPhone = `+9177${String(Date.now()).slice(-8)}`;
  const strangerPhone = `+9166${String(Date.now()).slice(-8)}`;
  const ids = [];
  // Catches the code the server "sends", whatever its OTP mode is.
  const notifications = require('../src/modules/notifications/notifications.service');
  const sent = {};
  const signIn = async (phone) => {
    const spy = jest.spyOn(notifications, 'sendOtp').mockImplementation(async (to, code) => {
      sent[to] = code;
    });
    await request(app).post(`${API}/auth/otp/request`).send({ phone });
    spy.mockRestore();
    return request(app).post(`${API}/auth/vendor-login`).send({ phone, otp: sent[phone] });
  };

  beforeAll(async () => {
    ids.push((await prisma.user.create({ data: { name: `Login Vendor ${tag}`, phone: vendorPhone, role: 'PROFESSIONAL' } })).id);
    ids.push((await prisma.user.create({ data: { name: `Login Customer ${tag}`, phone: customerPhone, role: 'CUSTOMER' } })).id);
  });
  afterAll(() => prisma.user.deleteMany({ where: { id: { in: ids } } }));

  it('signs in an existing vendor, and nobody else', async () => {
    const ok = await signIn(vendorPhone);
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ role: 'PROFESSIONAL', phone: vendorPhone });
    expect(ok.body.data.accessToken).toBeTruthy();

    expect((await signIn(customerPhone)).status).toBe(403);
    expect((await signIn(strangerPhone)).status).toBe(403);
    expect(await prisma.user.findUnique({ where: { phone: strangerPhone } })).toBeNull();
  });
});
