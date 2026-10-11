// These tests pin down the full onboarding rules, so they run with validation on
// (the server default is off while the apps are being built — see onboardingRelaxed.test.js).
process.env.ONBOARDING_VALIDATION = 'strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Uploaded test photos go to a throwaway folder, not ./uploads.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-test-'));
process.env.UPLOAD_DIR = uploadDir;

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');
const notifications = require('../src/modules/notifications/notifications.service');
const { examples, schemas } = require('../src/docs/components');

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const newPhone = () => `+9196${randomDigits(8)}`;
const keysOf = (value) => Object.keys(value).sort();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not-a-real-image')]);

const created = { userIds: [], phones: [], cityIds: [], zoneIds: [], categoryIds: [] };
const sentOtps = new Map(); // phone (or phone-change key) -> last code sent
let sendOtp;
let city, otherCity, zone, otherZone, category;
let admin, superAdmin, vendorUser;

const phone = newPhone();
let session; // the main customer's sign-in
let auth;

const makeUser = async (role, label, extra = {}) => {
  const user = await prisma.user.create({
    data: { name: `${label} ${run}`, role, phone: newPhone(), email: `${label}-${run}@example.com`, ...extra },
  });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

// Signs a customer in through the real OTP endpoints.
const signIn = async (number) => {
  created.phones.push(number);
  await request(app).post(`${API}/customer-onboarding/otp/request`).send({ phone: number });
  const res = await request(app).post(`${API}/customer-onboarding/otp/verify`).send({ phone: number, otp: sentOtps.get(number) });
  return res;
};

const address = (overrides = {}) => ({
  label: 'HOME',
  line1: '12, 4th Cross, 5th Block',
  line2: 'Koramangala',
  cityId: city.id,
  zoneId: zone.id,
  state: 'Karnataka',
  pincode: '560034',
  latitude: 12.9352,
  longitude: 77.6245,
  ...overrides,
});

beforeAll(async () => {
  sendOtp = jest.spyOn(notifications, 'sendOtp').mockImplementation(async (to, otp) => {
    sentOtps.set(to, otp);
  });

  city = await prisma.city.create({ data: { name: `Customer City ${run}`, tier: 'TIER_1' } });
  otherCity = await prisma.city.create({ data: { name: `Second City ${run}`, tier: 'TIER_2' } });
  created.cityIds.push(city.id, otherCity.id);
  zone = await prisma.zone.create({ data: { cityId: city.id, name: 'Central' } });
  otherZone = await prisma.zone.create({ data: { cityId: otherCity.id, name: 'Elsewhere' } });
  created.zoneIds.push(zone.id, otherZone.id);
  category = await prisma.serviceCategory.create({ data: { name: `Plumber ${run}`, tier: 'REPAIR', basePrice: 349 } });
  created.categoryIds.push(category.id);

  admin = await makeUser('ADMIN', 'c-admin');
  superAdmin = await makeUser('SUPER_ADMIN', 'c-superadmin');
  vendorUser = await makeUser('PROFESSIONAL', 'c-vendor');
});

afterAll(async () => {
  sendOtp.mockRestore();
  const users = await prisma.user.findMany({ where: { OR: [{ id: { in: created.userIds } }, { phone: { in: created.phones } }] }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((user) => user.id)])];
  await prisma.booking.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.zone.deleteMany({ where: { id: { in: created.zoneIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('Steps 1 & 2: phone number and OTP', () => {
  it('sends a 4-digit OTP', async () => {
    const invalid = await request(app).post(`${API}/customer-onboarding/otp/request`).send({ phone: '98123' });
    expect(invalid.status).toBe(400);

    created.phones.push(phone);
    const res = await request(app).post(`${API}/customer-onboarding/otp/request`).send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 300 });
    expect(sentOtps.get(phone)).toMatch(/^\d{4}$/);
  });

  it('rejects a wrong OTP without creating an account', async () => {
    const wrong = sentOtps.get(phone) === '0000' ? '1111' : '0000';
    const res = await request(app).post(`${API}/customer-onboarding/otp/verify`).send({ phone, otp: wrong });
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();

    const sixDigits = await request(app).post(`${API}/customer-onboarding/otp/verify`).send({ phone, otp: '123456' });
    expect(sixDigits.status).toBe(400);
  });

  it('verifies the OTP: creates the customer and points the app at step 3', async () => {
    const res = await request(app).post(`${API}/customer-onboarding/otp/verify`).send({ phone, otp: sentOtps.get(phone) });
    expect(res.status).toBe(200);
    session = res.body.data;
    auth = { Authorization: `Bearer ${session.accessToken}` };
    created.userIds.push(session.user.id);

    expect(session.isNewUser).toBe(true);
    expect(session.refreshToken).toBeDefined();
    expect(session.user).toMatchObject({ phone, role: 'CUSTOMER', isOnboarded: false, gender: null });
    expect(session.user.lastLoginAt).not.toBeNull();
    expect(session.user.passwordHash).toBeUndefined();
    expect(session.nextStep).toBe('profile');
    expect(session.flow).toMatchObject({ currentStep: 3, isComplete: false });
    expect(session.flow.steps.map((step) => step.status)).toEqual(['COMPLETE', 'COMPLETE', 'CURRENT', 'PENDING']);
    expect(session.defaultAddress).toBeNull();

    // Same fields as the documented example.
    const documented = { isNewUser: true, ...examples.tokens, ...examples.customerOnboarding('new') };
    expect(keysOf(session)).toEqual(keysOf(documented));
    expect(keysOf(session.user)).toEqual(keysOf(documented.user));
    expect(keysOf(session.flow)).toEqual(keysOf(documented.flow));
  });

  it('refuses numbers registered as a vendor or an admin', async () => {
    const asVendor = await request(app).post(`${API}/customer-onboarding/otp/request`).send({ phone: vendorUser.phone });
    expect(asVendor.status).toBe(403);
    const asAdmin = await request(app).post(`${API}/customer-onboarding/otp/request`).send({ phone: admin.phone });
    expect(asAdmin.status).toBe(403);
    const vendorToken = await request(app).get(`${API}/customer-onboarding`).set(vendorUser.auth);
    expect(vendorToken.status).toBe(403);
  });
});

describe('Step 3: name and gender', () => {
  it('requires both name and gender', async () => {
    const noGender = await request(app).put(`${API}/customer-onboarding/profile`).set(auth).send({ name: 'Aarav Mehta' });
    expect(noGender.status).toBe(400);
    const badGender = await request(app).put(`${API}/customer-onboarding/profile`).set(auth).send({ name: 'Aarav Mehta', gender: 'UNKNOWN' });
    expect(badGender.status).toBe(400);
    const anonymous = await request(app).put(`${API}/customer-onboarding/profile`).send({ name: 'Aarav Mehta', gender: 'MALE' });
    expect(anonymous.status).toBe(401);
  });

  it('saves them and moves to the address step', async () => {
    const res = await request(app).put(`${API}/customer-onboarding/profile`).set(auth).send({ name: `Aarav Mehta ${run}`, gender: 'MALE', email: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: `Aarav Mehta ${run}`, gender: 'MALE', email: null, isOnboarded: false });
    expect(res.body.data.nextStep).toBe('address');
    expect(res.body.data.flow.currentStep).toBe(4);
    expect(res.body.data.flow.steps.map((step) => step.status)).toEqual(['COMPLETE', 'COMPLETE', 'COMPLETE', 'CURRENT']);
  });
});

describe('Step 4: address', () => {
  const save = (body) => request(app).put(`${API}/customer-onboarding/address`).set(auth).send(body);

  it('validates the address', async () => {
    expect((await save(address({ pincode: '12' }))).status).toBe(400);
    expect((await save(address({ line1: 'x' }))).status).toBe(400);
    expect((await save(address({ cityId: '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e' }))).status).toBe(400);
    expect((await save(address({ zoneId: otherZone.id }))).status).toBe(400);
    expect((await save(address({ longitude: undefined }))).status).toBe(400);
    expect((await save(address({ latitude: 120 }))).status).toBe(400);
  });

  it('saves the default address and completes onboarding', async () => {
    const res = await save(address());
    expect(res.status).toBe(200);
    const { user, flow, nextStep, defaultAddress } = res.body.data;
    expect(nextStep).toBeNull();
    expect(flow).toMatchObject({ currentStep: null, isComplete: true });
    expect(user).toMatchObject({ isOnboarded: true, cityId: city.id, city: { id: city.id } });
    expect(user.address).toBe(`12, 4th Cross, 5th Block, Koramangala, ${city.name}, Karnataka 560034`);
    expect(defaultAddress).toMatchObject({ label: 'HOME', isDefault: true, latitude: 12.9352, longitude: 77.6245, city: { id: city.id }, zone: { id: zone.id } });
    expect(keysOf(defaultAddress)).toEqual(keysOf(examples.address));
    expect(keysOf(defaultAddress)).toEqual(keysOf(schemas.Address.properties));
  });

  it('updates that same address when the step is repeated', async () => {
    const res = await save(address({ landmark: 'Near Forum Mall' }));
    expect(res.body.data.defaultAddress.landmark).toBe('Near Forum Mall');
    expect(await prisma.address.count({ where: { userId: session.user.id } })).toBe(1);
  });

  it('takes a returning customer straight past onboarding', async () => {
    const res = await signIn(phone);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isNewUser: false, nextStep: null, flow: { isComplete: true } });
    expect(res.body.data.user.id).toBe(session.user.id);

    const state = await request(app).get(`${API}/customer-onboarding`).set(auth);
    expect(state.body.data.flow.isComplete).toBe(true);
  });
});

describe('My account: profile', () => {
  it('returns the profile with addresses', async () => {
    const res = await request(app).get(`${API}/users/me`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: session.user.id, phone, gender: 'MALE', professional: null, city: { id: city.id } });
    expect(res.body.data.addresses).toHaveLength(1);
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.profilePhotoKey).toBeUndefined();
    expect(keysOf(res.body.data)).toEqual(keysOf(examples.me()));
  });

  it('edits name, gender, email and date of birth', async () => {
    const email = `aarav-${run}@example.com`;
    const res = await request(app).patch(`${API}/users/me`).set(auth).send({ name: `Aarav M ${run}`, gender: 'OTHER', email, dateOfBirth: '1994-03-21' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: `Aarav M ${run}`, gender: 'OTHER', email, dateOfBirth: '1994-03-21' });

    const cleared = await request(app).patch(`${API}/users/me`).set(auth).send({ dateOfBirth: null });
    expect(cleared.body.data.dateOfBirth).toBeNull();
    expect(cleared.body.data.name).toBe(`Aarav M ${run}`);
  });

  it('rejects empty, invalid and conflicting edits', async () => {
    expect((await request(app).patch(`${API}/users/me`).set(auth).send({})).status).toBe(400);
    expect((await request(app).patch(`${API}/users/me`).set(auth).send({ dateOfBirth: '2999-01-01' })).status).toBe(400);
    expect((await request(app).patch(`${API}/users/me`).set(auth).send({ email: admin.email })).status).toBe(409);
    // Role and active state are not self-service.
    await request(app).patch(`${API}/users/me`).set(auth).send({ name: `Aarav M ${run}`, role: 'ADMIN', isActive: false });
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    expect(user).toMatchObject({ role: 'CUSTOMER', isActive: true });
  });

  it('uploads, serves and removes the profile photo', async () => {
    const pdf = await request(app).put(`${API}/users/me/photo`).set(auth).attach('photo', Buffer.from('%PDF-1.7'), { filename: 'me.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);

    const uploaded = await request(app).put(`${API}/users/me/photo`).set(auth).attach('photo', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.profilePhoto).toBe(`/users/${session.user.id}/photo`);

    const mine = await request(app).get(`${API}${uploaded.body.data.profilePhoto}`).set(auth);
    expect(mine.status).toBe(200);
    expect(Buffer.compare(mine.body, PNG)).toBe(0);
    expect((await request(app).get(`${API}/users/${session.user.id}/photo`).set(admin.auth)).status).toBe(200);
    expect((await request(app).get(`${API}/users/${session.user.id}/photo`).set(vendorUser.auth)).status).toBe(403);

    const removed = await request(app).delete(`${API}/users/me/photo`).set(auth);
    expect(removed.body.data.profilePhoto).toBeNull();
    expect((await request(app).get(`${API}/users/${session.user.id}/photo`).set(auth)).status).toBe(404);
  });

  it('changes the phone number only after an OTP sent to the new number', async () => {
    const taken = await request(app).post(`${API}/users/me/phone/request`).set(auth).send({ phone: admin.phone });
    expect(taken.status).toBe(409);
    const same = await request(app).post(`${API}/users/me/phone/request`).set(auth).send({ phone });
    expect(same.status).toBe(400);

    const next = newPhone();
    created.phones.push(next);
    const requested = await request(app).post(`${API}/users/me/phone/request`).set(auth).send({ phone: next });
    expect(requested.status).toBe(200);
    const code = sentOtps.get(next);

    const wrong = await request(app).post(`${API}/users/me/phone/verify`).set(auth).send({ phone: next, otp: code === '0000' ? '1111' : '0000' });
    expect(wrong.status).toBe(400);
    // Another signed-in user cannot use this code to take the number.
    const hijack = await request(app).post(`${API}/users/me/phone/verify`).set(vendorUser.auth).send({ phone: next, otp: code });
    expect(hijack.status).toBe(400);

    const confirmed = await request(app).post(`${API}/users/me/phone/verify`).set(auth).send({ phone: next, otp: code });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.phone).toBe(next);

    // The new number signs in to the same account.
    const again = await signIn(next);
    expect(again.body.data).toMatchObject({ isNewUser: false, user: { id: session.user.id } });
  });
});

describe('My account: addresses', () => {
  let workId;
  let homeId;

  it('adds a second address without changing the default', async () => {
    const res = await request(app).post(`${API}/users/me/addresses`).set(auth).send(address({ label: 'WORK', line1: '4th Floor, Tech Park', cityId: otherCity.id, zoneId: otherZone.id }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ label: 'WORK', isDefault: false, city: { id: otherCity.id } });
    workId = res.body.data.id;

    const list = await request(app).get(`${API}/users/me/addresses`).set(auth);
    expect(list.body.data.map((item) => [item.label, item.isDefault])).toEqual([['HOME', true], ['WORK', false]]);
    homeId = list.body.data[0].id;
  });

  it('edits an address, clearing the zone when the city changes', async () => {
    const res = await request(app).patch(`${API}/users/me/addresses/${workId}`).set(auth).send({ line2: 'Phase 2', pincode: '411057' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ line1: '4th Floor, Tech Park', line2: 'Phase 2', pincode: '411057', zone: { id: otherZone.id } });

    const moved = await request(app).patch(`${API}/users/me/addresses/${workId}`).set(auth).send({ cityId: city.id });
    expect(moved.body.data).toMatchObject({ city: { id: city.id }, zone: null });
    const back = await request(app).patch(`${API}/users/me/addresses/${workId}`).set(auth).send({ cityId: otherCity.id, zoneId: otherZone.id });
    expect(back.body.data.zone.id).toBe(otherZone.id);

    expect((await request(app).patch(`${API}/users/me/addresses/${workId}`).set(auth).send({})).status).toBe(400);
    expect((await request(app).patch(`${API}/users/me/addresses/${workId}`).set(auth).send({ zoneId: zone.id })).status).toBe(400);
  });

  it('switches the default, and the profile follows it', async () => {
    const res = await request(app).post(`${API}/users/me/addresses/${workId}/default`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(true);

    const me = await request(app).get(`${API}/users/me`).set(auth);
    expect(me.body.data.cityId).toBe(otherCity.id);
    expect(me.body.data.address).toContain('4th Floor, Tech Park');
    expect(me.body.data.addresses.filter((item) => item.isDefault)).toHaveLength(1);
  });

  it('promotes another address when the default is deleted', async () => {
    const res = await request(app).delete(`${API}/users/me/addresses/${workId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => [item.id, item.isDefault])).toEqual([[homeId, true]]);

    const me = await request(app).get(`${API}/users/me`).set(auth);
    expect(me.body.data.cityId).toBe(city.id);
  });

  it('keeps addresses private to their owner', async () => {
    expect((await request(app).patch(`${API}/users/me/addresses/${homeId}`).set(vendorUser.auth).send({ line2: 'x' })).status).toBe(404);
    expect((await request(app).delete(`${API}/users/me/addresses/${homeId}`).set(vendorUser.auth)).status).toBe(404);
    expect((await request(app).delete(`${API}/users/me/addresses/${workId}`).set(auth)).status).toBe(404);
  });

  it('caps the number of saved addresses', async () => {
    const other = (await signIn(newPhone())).body.data;
    created.userIds.push(other.user.id);
    const otherAuth = { Authorization: `Bearer ${other.accessToken}` };
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post(`${API}/users/me/addresses`).set(otherAuth).send(address({ label: 'OTHER', line1: `Flat ${i + 1}, Test Tower` }));
      expect(res.status).toBe(201);
    }
    const eleventh = await request(app).post(`${API}/users/me/addresses`).set(otherAuth).send(address());
    expect(eleventh.status).toBe(400);
  });
});

describe('Super admin: all users — list, edit, delete', () => {
  const users = (query) => request(app).get(`${API}/users`).query({ search: run, ...query }).set(superAdmin.auth);

  it('lists customers with filters and shows one in full', async () => {
    const customers = await users({ role: 'CUSTOMER' });
    expect(customers.status).toBe(200);
    expect(customers.body.items.map((item) => item.id)).toEqual([session.user.id]);
    expect(customers.body.items[0]).toMatchObject({ gender: 'OTHER', city: { id: city.id }, professional: null, deletedAt: null });

    expect((await users({ gender: 'OTHER' })).body.items.map((item) => item.id)).toEqual([session.user.id]);
    expect((await users({ gender: 'FEMALE' })).body.items).toEqual([]);

    const detail = await request(app).get(`${API}/users/${session.user.id}`).set(superAdmin.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.addresses).toHaveLength(1);
    expect(detail.body.data.counts).toEqual({ bookings: 0, reviews: 0, amcSubscriptions: 0 });
  });

  it('lets only a super admin edit a user', async () => {
    const byAdmin = await request(app).patch(`${API}/users/${session.user.id}`).set(admin.auth).send({ name: 'Nope' });
    expect(byAdmin.status).toBe(403);
    const byCustomer = await request(app).patch(`${API}/users/${admin.id}`).set(auth).send({ name: 'Nope' });
    expect(byCustomer.status).toBe(403);

    const res = await request(app).patch(`${API}/users/${session.user.id}`).set(superAdmin.auth).send({ name: `Aarav Edited ${run}`, gender: 'MALE', dateOfBirth: '1990-01-15' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: `Aarav Edited ${run}`, gender: 'MALE', dateOfBirth: '1990-01-15' });
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('guards uniqueness, roles and self-edits', async () => {
    const patch = (id, body) => request(app).patch(`${API}/users/${id}`).set(superAdmin.auth).send(body);
    expect((await patch(session.user.id, { email: admin.email })).status).toBe(409);
    expect((await patch(session.user.id, { phone: admin.phone })).status).toBe(409);
    expect((await patch(session.user.id, {})).status).toBe(400);
    // PROFESSIONAL is owned by vendor onboarding.
    expect((await patch(session.user.id, { role: 'PROFESSIONAL' })).status).toBe(400);
    expect((await patch(vendorUser.id, { role: 'CUSTOMER' })).status).toBe(400);
    expect((await patch(superAdmin.id, { role: 'ADMIN' })).status).toBe(400);
    expect((await patch(superAdmin.id, { isActive: false })).status).toBe(400);

    const promoted = await patch(admin.id, { role: 'SUPER_ADMIN' });
    expect(promoted.body.data.role).toBe('SUPER_ADMIN');
    const demoted = await patch(admin.id, { role: 'ADMIN' });
    expect(demoted.body.data.role).toBe('ADMIN');

    const deactivated = await patch(session.user.id, { isActive: false });
    expect(deactivated.body.data.isActive).toBe(false);
    await patch(session.user.id, { isActive: true });
  });

  it('deletes a vendor, wiping their documents', async () => {
    const target = await makeUser('PROFESSIONAL', 'c-vendor-del');
    const professional = await prisma.professional.create({
      data: {
        userId: target.id, categories: [category.id], kycStatus: 'VERIFIED', onboardingStatus: 'APPROVED', addressLine1: '1 Test Road', pincode: '560001',
        documents: { create: { type: 'PAN', numberEncrypted: 'v1:x:y:z', numberHash: `hash-${run}`, numberLast4: '234F', frontFileKey: `kyc/none-${run}.png`, frontFileMime: 'image/png' } },
      },
    });

    expect((await request(app).delete(`${API}/users/${target.id}`).set(admin.auth)).status).toBe(403);
    expect((await request(app).delete(`${API}/users/${superAdmin.id}`).set(superAdmin.auth)).status).toBe(400);

    const res = await request(app).delete(`${API}/users/${target.id}`).set(superAdmin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });

    const after = await prisma.professional.findUnique({ where: { id: professional.id }, include: { documents: true, user: true } });
    expect(after).toMatchObject({ kycStatus: 'REJECTED', onboardingStatus: 'REJECTED', categories: [], addressLine1: null, pincode: null });
    expect(after.documents).toEqual([]);
    expect(after.user).toMatchObject({ name: 'Deleted user', phone: null, email: null, isActive: false });

    expect((await request(app).delete(`${API}/users/${target.id}`).set(superAdmin.auth)).status).toBe(404);
    expect((await request(app).patch(`${API}/users/${target.id}`).set(superAdmin.auth).send({ name: 'Back' })).status).toBe(404);
  });
});

describe('Deleting an account', () => {
  it('is blocked while a booking is assigned, and for admin accounts', async () => {
    const booking = await prisma.booking.create({ data: { customerId: session.user.id, categoryId: category.id, address: 'Test', status: 'ASSIGNED' } });
    const blocked = await request(app).delete(`${API}/users/me`).set(auth);
    expect(blocked.status).toBe(409);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED' } });

    const adminSelf = await request(app).delete(`${API}/users/me`).set(admin.auth);
    expect(adminSelf.status).toBe(403);
  });

  it('wipes personal details, cancels open requests and keeps history', async () => {
    const current = await prisma.user.findUnique({ where: { id: session.user.id } });
    const open = await prisma.booking.create({ data: { customerId: session.user.id, categoryId: category.id, address: 'Test', status: 'PENDING' } });

    const res = await request(app).delete(`${API}/users/me`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });

    const after = await prisma.user.findUnique({ where: { id: session.user.id }, include: { addresses: true, bookings: true } });
    expect(after).toMatchObject({ name: 'Deleted user', phone: null, email: null, address: null, cityId: null, gender: null, dateOfBirth: null, isActive: false });
    expect(after.deletedAt).not.toBeNull();
    expect(after.addresses).toEqual([]);
    expect(after.bookings).toHaveLength(2);
    expect(after.bookings.find((item) => item.id === open.id).status).toBe('CANCELLED');

    // The old session is dead...
    expect((await request(app).get(`${API}/users/me`).set(auth)).status).toBe(404);
    expect((await request(app).get(`${API}/customer-onboarding`).set(auth)).status).toBe(404);
    expect((await request(app).post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken })).status).toBe(401);
    expect((await request(app).delete(`${API}/users/me`).set(auth)).status).toBe(404);

    // ...and the number can start again as a brand-new account.
    const fresh = await signIn(current.phone);
    expect(fresh.body.data).toMatchObject({ isNewUser: true, nextStep: 'profile' });
    expect(fresh.body.data.user.id).not.toBe(session.user.id);
    created.userIds.push(fresh.body.data.user.id);
  });

  it('hides deleted accounts from the user list unless asked, and counts them', async () => {
    const list = (query) => request(app).get(`${API}/users`).query(query).set(superAdmin.auth);
    const visible = await list({ limit: 100, createdFrom: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
    expect(visible.body.items.map((item) => item.id)).not.toContain(session.user.id);

    const deleted = await list({ deleted: 'true', limit: 100 });
    expect(deleted.body.items.map((item) => item.id)).toContain(session.user.id);
    expect(deleted.body.items.every((item) => item.deletedAt !== null && item.name === 'Deleted user')).toBe(true);

    const detail = await request(app).get(`${API}/users/${session.user.id}`).set(superAdmin.auth);
    expect(detail.body.data).toMatchObject({ name: 'Deleted user', phone: null, addresses: [] });

    const summary = await request(app).get(`${API}/users/summary`).set(superAdmin.auth);
    expect(keysOf(summary.body.data)).toEqual(keysOf(schemas.UserSummary.properties));
    expect(summary.body.data.deleted).toBeGreaterThanOrEqual(2);
    expect(summary.body.data.total).toBe(summary.body.data.active + summary.body.data.inactive);
  });
});
