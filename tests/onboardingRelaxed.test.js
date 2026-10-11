// Onboarding with validation switched off — the server default while the apps
// are being built. The strict rules are covered by vendorOnboarding.test.js
// and customerOnboarding.test.js.
process.env.ONBOARDING_VALIDATION = 'off';

const fs = require('fs');
const os = require('os');
const path = require('path');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-relaxed-test-'));
process.env.UPLOAD_DIR = uploadDir;

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const notifications = require('../src/modules/notifications/notifications.service');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = `${Date.now() % 1e10}${Math.floor(Math.random() * 1000)}`; // short enough to fit in a 20-character phone
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not-a-real-image')]);

const sentOtps = new Map();
const phones = [];
let sendOtp;
let city, superAdmin;

// Any text works as a phone number while validation is off.
const signIn = async (flow, phone) => {
  phones.push(phone);
  await request(app).post(`${API}/${flow}/otp/request`).send({ phone });
  const res = await request(app).post(`${API}/${flow}/otp/verify`).send({ phone, otp: sentOtps.get(phone) });
  return { res, auth: { Authorization: `Bearer ${res.body.data?.accessToken}` } };
};

beforeAll(async () => {
  sendOtp = jest.spyOn(notifications, 'sendOtp').mockImplementation(async (to, otp) => {
    sentOtps.set(to, otp);
  });
  city = await prisma.city.create({ data: { name: `Relaxed City ${run}`, tier: 'TIER_1' } });
  const user = await prisma.user.create({ data: { name: `r-super ${run}`, role: 'SUPER_ADMIN', email: `r-super-${run}@example.com` } });
  superAdmin = { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
});

afterAll(async () => {
  sendOtp.mockRestore();
  await prisma.vendorOnboardingEvent.deleteMany({ where: { actorId: superAdmin.id } });
  await prisma.user.deleteMany({ where: { OR: [{ phone: { in: phones } }, { id: superAdmin.id }] } });
  await prisma.city.deleteMany({ where: { id: city.id } });
  await prisma.$disconnect();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('Vendor onboarding with validation off', () => {
  const put = (auth, part, body) => request(app).put(`${API}/vendor-onboarding/${part}`).set(auth).send(body);
  let vendor;

  it('signs in with any phone text; the OTP must still be 4 digits and correct', async () => {
    const phone = `va-${run}`;
    phones.push(phone);
    await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone });
    const code = sentOtps.get(phone);
    expect(code).toMatch(/^\d{4}$/);

    const verify = (otp) => request(app).post(`${API}/vendor-onboarding/otp/verify`).send({ phone, otp });
    for (const bad of ['123', '12345', '123456', 'abcd', '']) {
      const res = await verify(bad);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed'); // rejected for its shape, before any comparison
    }
    const wrong = await verify(code === '0000' ? '1111' : '0000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('Invalid or expired OTP');

    vendor = await signIn('vendor-onboarding', phone);
    expect(vendor.res.status).toBe(200);
    expect(vendor.res.body.data.application).toMatchObject({ status: 'DRAFT', canSubmit: true });
  });

  it('accepts personal details that would fail every strict rule', async () => {
    const res = await put(vendor.auth, 'personal-details', {
      name: 'X',
      dateOfBirth: `${new Date().getUTCFullYear() - 5}-01-01`, // a five-year-old
      pincode: 'abc',
      alternatePhone: '12',
      emergencyContactName: 'Only a name',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.personalDetails).toMatchObject({ name: 'X', pincode: 'abc', alternatePhone: '12', gender: null, city: null, addressLine1: null });

    // An empty body is fine too, and keeps the name.
    const empty = await put(vendor.auth, 'personal-details', {});
    expect(empty.status).toBe(200);
    expect(empty.body.data.personalDetails.name).toBe('X');
    expect(empty.body.data.personalDetails.pincode).toBeNull();
  });

  it('never refuses a value it cannot store — it just leaves it out', async () => {
    const junk = await put(vendor.auth, 'personal-details', {
      gender: 'robot',
      dateOfBirth: 'not a date',
      cityId: 'no-such-city',
      email: superAdmin.email, // belongs to someone else
    });
    expect(junk.status).toBe(200);
    expect(junk.body.data.personalDetails).toMatchObject({ gender: null, dateOfBirth: null, city: null, email: null });

    const zone = await put(vendor.auth, 'services', { homeZoneId: '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e' });
    expect(zone.status).toBe(200);
    expect(zone.body.data.services.homeZone).toBeNull();

    const ok = await put(vendor.auth, 'personal-details', { gender: 'female', dateOfBirth: '1990-05-14', cityId: city.id });
    expect(ok.body.data.personalDetails).toMatchObject({ gender: 'FEMALE', dateOfBirth: '1990-05-14', city: { id: city.id } });
  });

  it('accepts services with no categories, or made-up ones', async () => {
    const none = await put(vendor.auth, 'services', {});
    expect(none.status).toBe(200);
    expect(none.body.data.services).toMatchObject({ categories: [], experienceYears: null });

    const madeUp = await put(vendor.auth, 'services', { categories: ['plumbing', 'wiring'], experienceYears: '3' });
    expect(madeUp.status).toBe(200);
    expect(madeUp.body.data.services.experienceYears).toBe(3);
  });

  it('accepts documents and bank details with any numbers and no images', async () => {
    const send = (part, fields) => {
      const req = request(app).put(`${API}/vendor-onboarding/${part}`).set(vendor.auth);
      Object.entries(fields).forEach(([key, value]) => req.field(key, value));
      return req;
    };
    const aadhaar = await send('documents/aadhaar', { number: '123' });
    expect(aadhaar.status).toBe(200);
    expect(aadhaar.body.data.documents[0]).toMatchObject({ type: 'AADHAAR', status: 'PENDING', maskedNumber: 'XXXX XXXX 123', files: { front: null, back: null } });

    const pan = await request(app).put(`${API}/vendor-onboarding/documents/pan`).set(vendor.auth).send({});
    expect(pan.status).toBe(200);
    expect(pan.body.data.documents[1]).toMatchObject({ type: 'PAN', status: 'PENDING', maskedNumber: null });

    const bank = await send('bank-details', { accountNumber: '1', ifsc: 'x', accountType: 'savings' });
    expect(bank.status).toBe(200);
    expect(bank.body.data.bankDetails).toMatchObject({ status: 'PENDING', ifsc: 'x', accountType: 'SAVINGS', proofFile: null });
    const oddType = await send('bank-details', { accountNumber: '1', ifsc: 'x', accountType: 'gold' });
    expect(oddType.status).toBe(200);
    expect(oddType.body.data.bankDetails.accountType).toBeNull();

    // An image can be added later, and is served back.
    const withImage = await request(app).put(`${API}/vendor-onboarding/documents/aadhaar`).set(vendor.auth).field('number', '123').attach('front', PNG, { filename: 'f.png', contentType: 'image/png' });
    expect(withImage.body.data.documents[0].files.front).toBe('/vendor-onboarding/documents/aadhaar/files/front');
    expect((await request(app).get(`${API}/vendor-onboarding/documents/aadhaar/files/front`).set(vendor.auth)).status).toBe(200);
    // Any file is accepted, but one that isn't a real image or PDF is only ever handed back as a download.
    const fake = await request(app).put(`${API}/vendor-onboarding/documents/pan`).set(vendor.auth).attach('front', Buffer.from('<html><script>1</script>'), { filename: 'f.png', contentType: 'text/html' });
    expect(fake.status).toBe(200);
    const served = await request(app).get(`${API}/vendor-onboarding/documents/pan/files/front`).set(vendor.auth);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('application/octet-stream');

    // A profile photo call with no file, or with a PDF, is fine too.
    expect((await request(app).put(`${API}/vendor-onboarding/profile-photo`).set(vendor.auth)).status).toBe(200);
    const pdfPhoto = await request(app).put(`${API}/vendor-onboarding/profile-photo`).set(vendor.auth).attach('photo', Buffer.from('%PDF-1.7 x'), { filename: 'me.pdf', contentType: 'application/pdf' });
    expect(pdfPhoto.status).toBe(200);
    expect(pdfPhoto.body.data.profilePhoto).toBe('/vendor-onboarding/profile-photo');
  });

  it('lets the same test numbers be used on another account', async () => {
    const other = await signIn('vendor-onboarding', `vb-${run}`);
    const res = await request(app).put(`${API}/vendor-onboarding/documents/aadhaar`).set(other.auth).send({ number: '123' });
    expect(res.status).toBe(200);
    const bank = await request(app).put(`${API}/vendor-onboarding/bank-details`).set(other.auth).send({ accountNumber: '1', ifsc: 'x' });
    expect(bank.status).toBe(200);

    // ...and that account can submit with steps still missing.
    const submitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(other.auth);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.detailSteps.some((step) => !step.complete)).toBe(true);
  });

  it('submits, locks, and can still be verified and approved', async () => {
    const submitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(submitted.status).toBe(200);
    const id = submitted.body.data.id;
    // The review workflow is unchanged: no edits while under review.
    expect((await put(vendor.auth, 'services', {})).status).toBe(409);

    const review = (action, body) => request(app).post(`${API}/vendor-onboarding/applications/${id}/${action}`).set(superAdmin.auth).send(body);
    expect((await review('approve')).status).toBe(409); // documents first
    await review('documents/aadhaar/verify');
    await review('documents/pan/verify');
    const ready = await review('documents/bank_account/verify');
    expect(ready.body.data.status).toBe('PENDING_APPROVAL');
    const approved = await review('approve');
    expect(approved.body.data.status).toBe('APPROVED');

    const status = await request(app).get(`${API}/vendor-onboarding/status`).set(vendor.auth);
    expect(status.body.data.flow).toMatchObject({ currentStep: 5, isVerified: true });
  });
});

describe('Customer onboarding with validation off', () => {
  let customer;

  it('signs in and completes the profile step with just a name', async () => {
    customer = await signIn('customer-onboarding', `c-${run}`);
    expect(customer.res.status).toBe(200);
    expect(customer.res.body.data.nextStep).toBe('profile');

    const empty = await request(app).put(`${API}/customer-onboarding/profile`).set(customer.auth).send({});
    expect(empty.status).toBe(200);
    expect(empty.body.data.nextStep).toBe('profile'); // nothing given yet

    const named = await request(app).put(`${API}/customer-onboarding/profile`).set(customer.auth).send({ name: 'A' });
    expect(named.status).toBe(200);
    expect(named.body.data).toMatchObject({ nextStep: 'address', user: { name: 'A', gender: null } });

    const junk = await request(app).put(`${API}/customer-onboarding/profile`).set(customer.auth).send({ gender: 'robot', dateOfBirth: 'soon', email: superAdmin.email });
    expect(junk.status).toBe(200);
    expect(junk.body.data.user).toMatchObject({ name: 'A', gender: null, dateOfBirth: null, email: null });
    const withGender = await request(app).put(`${API}/customer-onboarding/profile`).set(customer.auth).send({ gender: 'male', dateOfBirth: '2999-01-01' });
    expect(withGender.body.data.user).toMatchObject({ name: 'A', gender: 'MALE', dateOfBirth: '2999-01-01' });
  });

  it('completes onboarding with an empty address, and fills it in later', async () => {
    const save = (body) => request(app).put(`${API}/customer-onboarding/address`).set(customer.auth).send(body);
    const empty = await save({});
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({ nextStep: null, user: { isOnboarded: true }, defaultAddress: { line1: '', pincode: '', city: null, zone: null } });
    // An id that doesn't exist is left out rather than refused.
    const unknown = await save({ cityId: '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e', zoneId: 'nope', label: 'castle' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.defaultAddress).toMatchObject({ city: null, zone: null, label: 'HOME' });

    const res = await save({ cityId: city.id, pincode: 'x1', latitude: 12.9 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      nextStep: null,
      flow: { isComplete: true },
      user: { isOnboarded: true, cityId: city.id },
      defaultAddress: { label: 'HOME', line1: '', pincode: 'x1', latitude: 12.9, longitude: null, city: { id: city.id } },
    });

    const again = await save({ cityId: city.id, line1: '12 Test Road', label: 'work' });
    expect(again.body.data.defaultAddress).toMatchObject({ label: 'WORK', line1: '12 Test Road' });
  });

  it('leaves account editing (outside onboarding) validated', async () => {
    const res = await request(app).post(`${API}/users/me/addresses`).set(customer.auth).send({ cityId: city.id, pincode: 'x1' });
    expect(res.status).toBe(400);
    expect((await request(app).patch(`${API}/users/me`).set(customer.auth).send({ dateOfBirth: '2999-01-01' })).status).toBe(400);
  });
});
