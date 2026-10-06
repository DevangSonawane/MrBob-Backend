const fs = require('fs');
const os = require('os');
const path = require('path');

// Uploaded test documents go to a throwaway folder, not ./uploads.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-onboarding-test-'));
process.env.UPLOAD_DIR = uploadDir;

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');
const { verhoeffCheckDigit } = require('../src/utils/indianIds');
const notifications = require('../src/modules/notifications/notifications.service');
const { examples } = require('../src/docs/components');

// Shape check: the documented example and the real response have the same fields.
const keysOf = (value) => Object.keys(value).sort();
const stepStatuses = (flow) => flow.steps.map((step) => step.status);

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// Unique per run, so reruns never collide on the "one account per document" rule.
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const makeAadhaar = () => {
  const base = `${2 + Math.floor(Math.random() * 8)}${randomDigits(10)}`;
  return `${base}${verhoeffCheckDigit(base)}`;
};
const makePan = () => `ABCP${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${randomDigits(4)}Z`;

const makeAccountNumber = () => `${1 + Math.floor(Math.random() * 9)}${randomDigits(11)}`;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not-a-real-image')]);

const created = { userIds: [], cityIds: [], zoneIds: [], categoryIds: [] };
let vendor, otherVendor, admin, superAdmin, customer;
let city, otherCity, zone, otherZone, category, inactiveCategory;
const aadhaar = makeAadhaar();
const pan = makePan();
const accountNumber = makeAccountNumber();

const makeUser = async (role, label) => {
  const user = await prisma.user.create({
    data: { name: `${label} ${run}`, role, phone: `+9198${randomDigits(8)}`, email: `${label}-${run}@example.com` },
  });
  created.userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

const personalDetails = () => ({
  name: `Ravi Kumar ${run}`,
  dateOfBirth: '1990-05-14',
  gender: 'MALE',
  cityId: city.id,
  addressLine1: '12, 4th Cross, 5th Block',
  pincode: '560034',
  state: 'Karnataka',
  emergencyContactName: 'Sita Kumar',
  emergencyContactPhone: '+919812345678',
});

const uploadDocument = (user, type, number, { front = true, back = false } = {}) => {
  const req = request(app).put(`${API}/vendor-onboarding/documents/${type}`).set(user.auth).field('number', number).field('nameOnDocument', 'Ravi Kumar');
  if (front) req.attach('front', PNG, { filename: 'front.png', contentType: 'image/png' });
  if (back) req.attach('back', PNG, { filename: 'back.png', contentType: 'image/png' });
  return req;
};

const uploadPhoto = (user) =>
  request(app).put(`${API}/vendor-onboarding/profile-photo`).set(user.auth).attach('photo', PNG, { filename: 'me.png', contentType: 'image/png' });

const saveBank = (user, number, { proof = true, ...overrides } = {}) => {
  const fields = { accountHolderName: 'Ravi Kumar', accountNumber: number, ifsc: 'hdfc0001234', bankName: 'HDFC Bank', accountType: 'SAVINGS', upiId: 'ravi@hdfcbank', ...overrides };
  const req = request(app).put(`${API}/vendor-onboarding/bank-details`).set(user.auth);
  Object.entries(fields).forEach(([key, value]) => req.field(key, value));
  if (proof) req.attach('proof', PNG, { filename: 'cheque.png', contentType: 'image/png' });
  return req;
};

const getMine = (user) => request(app).get(`${API}/vendor-onboarding`).set(user.auth);
const adminPost = (user, applicationId, action, body) =>
  request(app).post(`${API}/vendor-onboarding/applications/${applicationId}/${action}`).set(user.auth).send(body);

beforeAll(async () => {
  city = await prisma.city.create({ data: { name: `Test City ${run}`, tier: 'TIER_1' } });
  otherCity = await prisma.city.create({ data: { name: `Other City ${run}`, tier: 'TIER_2' } });
  created.cityIds.push(city.id, otherCity.id);
  zone = await prisma.zone.create({ data: { cityId: city.id, name: 'Central' } });
  otherZone = await prisma.zone.create({ data: { cityId: otherCity.id, name: 'Elsewhere' } });
  created.zoneIds.push(zone.id, otherZone.id);
  category = await prisma.serviceCategory.create({ data: { name: `Electrician ${run}`, tier: 'REPAIR', basePrice: 299 } });
  inactiveCategory = await prisma.serviceCategory.create({ data: { name: `Retired ${run}`, tier: 'REPAIR', basePrice: 1, isActive: false } });
  created.categoryIds.push(category.id, inactiveCategory.id);

  vendor = await makeUser('CUSTOMER', 'vendor');
  otherVendor = await makeUser('CUSTOMER', 'vendor2');
  customer = await makeUser('CUSTOMER', 'customer');
  admin = await makeUser('ADMIN', 'admin');
  superAdmin = await makeUser('SUPER_ADMIN', 'superadmin');
});

afterAll(async () => {
  // Professionals (and their documents/events) cascade from users.
  await prisma.vendorOnboardingEvent.deleteMany({ where: { actorId: { in: created.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.zone.deleteMany({ where: { id: { in: created.zoneIds } } });
  await prisma.city.deleteMany({ where: { id: { in: created.cityIds } } });
  await prisma.$disconnect();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('Steps 1 & 2: phone number and OTP', () => {
  const phone = `+9197${randomDigits(8)}`;
  // Captured here rather than read from mock.calls, which jest clears between tests.
  const sentOtps = [];
  let sendOtp;
  let session;

  beforeAll(() => {
    sendOtp = jest.spyOn(notifications, 'sendOtp').mockImplementation(async (_phone, otp) => {
      sentOtps.push(otp);
    });
  });
  afterAll(async () => {
    sendOtp.mockRestore();
    await prisma.user.deleteMany({ where: { phone } });
  });

  const lastOtp = () => sentOtps.at(-1);

  it('sends an OTP to a new phone number', async () => {
    const invalid = await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone: '12345' });
    expect(invalid.status).toBe(400);

    const res = await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 300 });
    expect(lastOtp()).toMatch(/^\d{4}$/);
    expect(JSON.stringify(res.body)).not.toContain(lastOtp());
  });

  it('rejects a wrong OTP without creating an account', async () => {
    const wrong = lastOtp() === '0000' ? '1111' : '0000';
    const res = await request(app).post(`${API}/vendor-onboarding/otp/verify`).send({ phone, otp: wrong });
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();
  });

  it('verifies the OTP: creates the vendor, opens a draft application and returns tokens', async () => {
    const res = await request(app).post(`${API}/vendor-onboarding/otp/verify`).send({ phone, otp: lastOtp() });
    expect(res.status).toBe(200);
    session = res.body.data;
    expect(session.isNewUser).toBe(true);
    expect(session.user).toMatchObject({ phone, role: 'PROFESSIONAL', isOnboarded: false });
    expect(session.accessToken).toBeDefined();
    expect(session.refreshToken).toBeDefined();
    expect(session.application).toMatchObject({ status: 'DRAFT', isEditable: true, nextStep: 'personalDetails', canSubmit: false });
    expect(session.application.flow.currentStep).toBe(3);
    expect(stepStatuses(session.application.flow)).toEqual(['COMPLETE', 'COMPLETE', 'CURRENT', 'PENDING', 'PENDING']);
    // The documented example for this response has exactly these fields.
    expect(keysOf(session.application)).toEqual(keysOf(examples.newApplication));
    expect(keysOf(session.application.personalDetails)).toEqual(keysOf(examples.newApplication.personalDetails));
  });

  it('does not accept the same OTP twice', async () => {
    const res = await request(app).post(`${API}/vendor-onboarding/otp/verify`).send({ phone, otp: lastOtp() });
    expect(res.status).toBe(400);
  });

  it('lets the new vendor use the token straight away', async () => {
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const mine = await request(app).get(`${API}/vendor-onboarding`).set(auth);
    expect(mine.status).toBe(200);
    expect(mine.body.data.id).toBe(session.application.id);

    const status = await request(app).get(`${API}/vendor-onboarding/status`).set(auth);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ id: session.application.id, status: 'DRAFT', reviewNote: null });
    expect(status.body.data.flow.currentStep).toBe(3);
  });

  it('signs a returning vendor back in to the same application', async () => {
    await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone });
    const res = await request(app).post(`${API}/vendor-onboarding/otp/verify`).send({ phone, otp: lastOtp() });
    expect(res.status).toBe(200);
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.application.id).toBe(session.application.id);
  });

  it('refuses admin and deactivated phone numbers', async () => {
    const adminPhone = await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone: admin.phone });
    expect(adminPhone.status).toBe(403);

    await prisma.user.update({ where: { phone }, data: { isActive: false } });
    const deactivated = await request(app).post(`${API}/vendor-onboarding/otp/request`).send({ phone });
    expect(deactivated.status).toBe(403);
  });
});

describe('Step 3: the vendor enters details', () => {
  it('requires authentication', async () => {
    const res = await request(app).get(`${API}/vendor-onboarding`);
    expect(res.status).toBe(401);
  });

  it('reports NOT_STARTED before anything is saved', async () => {
    const res = await getMine(vendor);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('NOT_STARTED');
    expect(res.body.data.nextStep).toBe('personalDetails');
    expect(res.body.data.canSubmit).toBe(false);
    expect(res.body.data.documents.map((doc) => doc.status)).toEqual(['NOT_UPLOADED', 'NOT_UPLOADED']);
    expect(res.body.data.bankDetails).toEqual({ status: 'NOT_UPLOADED' });
    expect(res.body.data.profilePhoto).toBeNull();
    expect(res.body.data.detailSteps.map((step) => step.key)).toEqual(['personalDetails', 'profilePhoto', 'services', 'aadhaar', 'pan', 'bankDetails']);
    expect(res.body.data.flow.currentStep).toBe(3);
  });

  it('refuses to submit an application that was never started', async () => {
    const res = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(res.status).toBe(400);
  });

  it('rejects invalid personal details', async () => {
    const underage = await request(app)
      .put(`${API}/vendor-onboarding/personal-details`)
      .set(vendor.auth)
      .send({ ...personalDetails(), dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` });
    expect(underage.status).toBe(400);

    const badPincode = await request(app)
      .put(`${API}/vendor-onboarding/personal-details`)
      .set(vendor.auth)
      .send({ ...personalDetails(), pincode: '12' });
    expect(badPincode.status).toBe(400);

    const halfContact = await request(app)
      .put(`${API}/vendor-onboarding/personal-details`)
      .set(vendor.auth)
      .send({ ...personalDetails(), emergencyContactPhone: undefined });
    expect(halfContact.status).toBe(400);
  });

  it('saves personal details, creates the draft and makes the account a professional', async () => {
    const res = await request(app).put(`${API}/vendor-onboarding/personal-details`).set(vendor.auth).send(personalDetails());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.personalDetails.dateOfBirth).toBe('1990-05-14');
    expect(res.body.data.personalDetails.city.id).toBe(city.id);
    expect(res.body.data.detailSteps.find((step) => step.key === 'personalDetails').complete).toBe(true);
    expect(res.body.data.nextStep).toBe('profilePhoto');

    const user = await prisma.user.findUnique({ where: { id: vendor.id } });
    expect(user.role).toBe('PROFESSIONAL');
    expect(user.isOnboarded).toBe(false);
  });

  it('does not let the login phone number be changed', async () => {
    const res = await request(app)
      .put(`${API}/vendor-onboarding/personal-details`)
      .set(vendor.auth)
      .send({ ...personalDetails(), phone: '+919000000001' });
    expect(res.status).toBe(400);
  });

  it('takes a profile photo (images only) and serves it back to the vendor', async () => {
    const pdf = await request(app)
      .put(`${API}/vendor-onboarding/profile-photo`)
      .set(vendor.auth)
      .attach('photo', Buffer.from('%PDF-1.7 fake'), { filename: 'me.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);
    const missing = await request(app).put(`${API}/vendor-onboarding/profile-photo`).set(vendor.auth);
    expect(missing.status).toBe(400);

    const res = await uploadPhoto(vendor);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePhoto).toBe('/vendor-onboarding/profile-photo');
    expect(res.body.data.nextStep).toBe('services');

    const mine = await request(app).get(`${API}/vendor-onboarding/profile-photo`).set(vendor.auth);
    expect(mine.status).toBe(200);
    expect(Buffer.compare(mine.body, PNG)).toBe(0);
  });

  it('validates services against the catalogue and the vendor city', async () => {
    const inactive = await request(app)
      .put(`${API}/vendor-onboarding/services`)
      .set(vendor.auth)
      .send({ categories: [inactiveCategory.id], experienceYears: 3 });
    expect(inactive.status).toBe(400);

    const wrongCity = await request(app)
      .put(`${API}/vendor-onboarding/services`)
      .set(vendor.auth)
      .send({ categories: [category.id], experienceYears: 3, homeZoneId: otherZone.id });
    expect(wrongCity.status).toBe(400);

    const res = await request(app)
      .put(`${API}/vendor-onboarding/services`)
      .set(vendor.auth)
      .send({ categories: [category.id, category.id], experienceYears: 6, homeZoneId: zone.id });
    expect(res.status).toBe(200);
    expect(res.body.data.services.categories).toEqual([{ id: category.id, name: category.name, tier: 'REPAIR' }]);
    expect(res.body.data.services.homeZone.id).toBe(zone.id);
    expect(res.body.data.nextStep).toBe('aadhaar');
  });

  it('rejects malformed document numbers and missing or fake files', async () => {
    const badNumber = await uploadDocument(vendor, 'aadhaar', '123456789012', { back: true });
    expect(badNumber.status).toBe(400);

    const noBack = await uploadDocument(vendor, 'aadhaar', aadhaar);
    expect(noBack.status).toBe(400);

    const notAnImage = await request(app)
      .put(`${API}/vendor-onboarding/documents/pan`)
      .set(vendor.auth)
      .field('number', pan)
      .field('nameOnDocument', 'Ravi Kumar')
      .attach('front', Buffer.from('<script>alert(1)</script>'), { filename: 'front.png', contentType: 'image/png' });
    expect(notAnImage.status).toBe(400);

    const badPan = await uploadDocument(vendor, 'pan', 'ABCDE1234F');
    expect(badPan.status).toBe(400);
  });

  it('cannot be submitted while steps are missing', async () => {
    const res = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(res.status).toBe(400);
    expect(res.body.details.missing).toEqual(['aadhaar', 'pan', 'bankDetails']);
  });

  it('stores Aadhaar and PAN encrypted and only ever returns them masked to the vendor', async () => {
    const aadhaarRes = await uploadDocument(vendor, 'aadhaar', `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`, { back: true });
    expect(aadhaarRes.status).toBe(200);
    const panRes = await uploadDocument(vendor, 'pan', pan.toLowerCase());
    expect(panRes.status).toBe(200);

    const [aadhaarDoc, panDoc] = panRes.body.data.documents;
    expect(aadhaarDoc).toMatchObject({ type: 'AADHAAR', status: 'PENDING', maskedNumber: `XXXX XXXX ${aadhaar.slice(-4)}` });
    expect(panDoc).toMatchObject({ type: 'PAN', status: 'PENDING', maskedNumber: `XXXXXX${pan.slice(-4)}` });
    expect(JSON.stringify(panRes.body)).not.toContain(aadhaar);
    expect(JSON.stringify(panRes.body)).not.toContain(pan);
    expect(panRes.body.data.canSubmit).toBe(false);
    expect(panRes.body.data.nextStep).toBe('bankDetails');

    const rows = await prisma.professionalDocument.findMany({ where: { professional: { userId: vendor.id } } });
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row.numberEncrypted).not.toContain(aadhaar);
      expect(row.numberEncrypted).not.toContain(pan);
    });
  });

  it('saves the payout bank account, masked, and validates it', async () => {
    const badIfsc = await saveBank(vendor, accountNumber, { ifsc: 'HDFC1001234' });
    expect(badIfsc.status).toBe(400);
    const badNumber = await saveBank(vendor, '12345');
    expect(badNumber.status).toBe(400);
    const noProof = await saveBank(vendor, accountNumber, { proof: false });
    expect(noProof.status).toBe(400);

    const res = await saveBank(vendor, accountNumber);
    expect(res.status).toBe(200);
    expect(res.body.data.bankDetails).toMatchObject({
      status: 'PENDING',
      accountHolderName: 'Ravi Kumar',
      maskedAccountNumber: `XXXXXX${accountNumber.slice(-4)}`,
      ifsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
      accountType: 'SAVINGS',
      upiId: 'ravi@hdfcbank',
      proofFile: '/vendor-onboarding/documents/bank_account/files/front',
    });
    expect(JSON.stringify(res.body)).not.toContain(accountNumber);
    expect(res.body.data.canSubmit).toBe(true);
    expect(res.body.data.nextStep).toBe('submit');
    // A fully filled-in application matches the documented example field for field.
    const documented = examples.application('DRAFT');
    expect(keysOf(res.body.data)).toEqual(keysOf(documented));
    expect(keysOf(res.body.data.documents[0])).toEqual(keysOf(documented.documents[0]));
    expect(keysOf(res.body.data.bankDetails)).toEqual(keysOf(documented.bankDetails));
    expect(keysOf(res.body.data.services)).toEqual(keysOf(documented.services));

    const proof = await request(app).get(`${API}${res.body.data.bankDetails.proofFile}`).set(vendor.auth);
    expect(proof.status).toBe(200);

    // Details can be corrected without re-uploading the proof.
    const update = await saveBank(vendor, accountNumber, { proof: false, branchName: 'Koramangala' });
    expect(update.status).toBe(200);
    expect(update.body.data.bankDetails.branchName).toBe('Koramangala');

    const sameAccount = await saveBank(otherVendor, accountNumber);
    expect(sameAccount.status).toBe(409);
    // The bank account goes through its own endpoint, not the identity-document one.
    const wrongEndpoint = await uploadDocument(vendor, 'bank_account', accountNumber);
    expect(wrongEndpoint.status).toBe(400);
  });

  it('lets the vendor download their own document but not without a token', async () => {
    const res = await request(app).get(`${API}/vendor-onboarding/documents/aadhaar/files/back`).set(vendor.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body, PNG)).toBe(0);

    const anonymous = await request(app).get(`${API}/vendor-onboarding/documents/aadhaar/files/back`);
    expect(anonymous.status).toBe(401);

    const panBack = await request(app).get(`${API}/vendor-onboarding/documents/pan/files/back`).set(vendor.auth);
    expect(panBack.status).toBe(404);
  });

  it('stops a second account from registering the same Aadhaar number', async () => {
    const res = await uploadDocument(otherVendor, 'aadhaar', aadhaar, { back: true });
    expect(res.status).toBe(409);
  });

  it('blocks admin accounts from onboarding as vendors', async () => {
    const res = await request(app).put(`${API}/vendor-onboarding/personal-details`).set(admin.auth).send(personalDetails());
    expect(res.status).toBe(403);
  });
});

describe('Step 4: verify vendor, then step 5: verified', () => {
  let applicationId;

  it('submits and locks the application', async () => {
    const res = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUBMITTED');
    expect(res.body.data.isEditable).toBe(false);
    expect(res.body.data.flow.currentStep).toBe(4);
    expect(stepStatuses(res.body.data.flow)).toEqual(['COMPLETE', 'COMPLETE', 'COMPLETE', 'CURRENT', 'PENDING']);
    applicationId = res.body.data.id;

    const edit = await request(app).put(`${API}/vendor-onboarding/personal-details`).set(vendor.auth).send(personalDetails());
    expect(edit.status).toBe(409);
    const again = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(again.status).toBe(409);

    const professional = await prisma.professional.findUnique({ where: { id: applicationId } });
    expect(professional.kycStatus).toBe('IN_REVIEW');
  });

  it('keeps the review endpoints away from vendors and customers', async () => {
    const list = await request(app).get(`${API}/vendor-onboarding/applications`).set(vendor.auth);
    expect(list.status).toBe(403);
    const detail = await request(app).get(`${API}/vendor-onboarding/applications/${applicationId}`).set(customer.auth);
    expect(detail.status).toBe(403);
    const file = await request(app).get(`${API}/vendor-onboarding/applications/${applicationId}/documents/aadhaar/files/front`).set(customer.auth);
    expect(file.status).toBe(403);
    const verify = await adminPost(vendor, applicationId, 'documents/aadhaar/verify');
    expect(verify.status).toBe(403);
  });

  it('hides personal details from other users on the public professional endpoint', async () => {
    const res = await request(app).get(`${API}/professionals/${applicationId}`).set(customer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.dateOfBirth).toBeUndefined();
    expect(res.body.data.addressLine1).toBeUndefined();
    expect(res.body.data.user.phone).toBeUndefined();

    const own = await request(app).get(`${API}/professionals/${applicationId}`).set(vendor.auth);
    expect(own.body.data.addressLine1).toBe('12, 4th Cross, 5th Block');
  });

  it('lists the application for admins, filterable by status and search', async () => {
    const res = await request(app).get(`${API}/vendor-onboarding/applications`).query({ status: 'SUBMITTED', search: run }).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.id)).toEqual([applicationId]);
    expect(res.body.items[0].documents).toEqual([
      { type: 'AADHAAR', status: 'PENDING' },
      { type: 'PAN', status: 'PENDING' },
      { type: 'BANK_ACCOUNT', status: 'PENDING' },
    ]);

    const none = await request(app).get(`${API}/vendor-onboarding/applications`).query({ status: 'APPROVED', search: run }).set(admin.auth);
    expect(none.body.items).toEqual([]);

    const summary = await request(app).get(`${API}/vendor-onboarding/applications/summary`).set(admin.auth);
    expect(summary.status).toBe(200);
    expect(summary.body.data.byStatus.SUBMITTED).toBeGreaterThanOrEqual(1);
  });

  it('shows admins the full numbers and the document images', async () => {
    const res = await request(app).get(`${API}/vendor-onboarding/applications/${applicationId}`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.documents[0].number).toBe(aadhaar);
    expect(res.body.data.documents[1].number).toBe(pan);
    expect(res.body.data.bankDetails.accountNumber).toBe(accountNumber);
    expect(res.body.data.events.map((event) => event.action)).toEqual(['SUBMITTED']);
    // The reviewer's view matches its documented example too.
    const documented = examples.adminApplication('SUBMITTED', [examples.event('SUBMITTED', 'DRAFT', 'SUBMITTED', 'Ravi Kumar', 'PROFESSIONAL')]);
    expect(keysOf(res.body.data)).toEqual(keysOf(documented));
    expect(keysOf(res.body.data.documents[0])).toEqual(keysOf(documented.documents[0]));
    expect(keysOf(res.body.data.bankDetails)).toEqual(keysOf(documented.bankDetails));
    expect(keysOf(res.body.data.events[0])).toEqual(keysOf(documented.events[0]));

    const photo = await request(app).get(`${API}${res.body.data.profilePhoto}`).set(admin.auth);
    expect(photo.status).toBe(200);
    // Customers can't see the photo of a vendor who isn't approved yet.
    const early = await request(app).get(`${API}/professionals/${applicationId}/photo`).set(customer.auth);
    expect(early.status).toBe(404);

    const file = await request(app).get(`${API}${res.body.data.documents[0].files.front}`).set(admin.auth);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('cannot be approved before the documents are verified', async () => {
    const res = await adminPost(superAdmin, applicationId, 'approve');
    expect(res.status).toBe(409);
  });

  it('sends the application back when a document is rejected, and accepts a re-upload', async () => {
    const noReason = await adminPost(admin, applicationId, 'documents/pan/reject', {});
    expect(noReason.status).toBe(400);

    const verified = await adminPost(admin, applicationId, 'documents/aadhaar/verify');
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('SUBMITTED');

    const rejected = await adminPost(admin, applicationId, 'documents/pan/reject', { reason: 'Photo is too blurry to read' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('CHANGES_REQUESTED');

    const mine = await getMine(vendor);
    expect(mine.body.data.isEditable).toBe(true);
    expect(mine.body.data.nextStep).toBe('pan');
    expect(mine.body.data.flow.currentStep).toBe(3);
    expect(stepStatuses(mine.body.data.flow)).toEqual(['COMPLETE', 'COMPLETE', 'ACTION_REQUIRED', 'PENDING', 'PENDING']);
    expect(mine.body.data.documents[1]).toMatchObject({ status: 'REJECTED', rejectionReason: 'Photo is too blurry to read' });

    const blocked = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(blocked.status).toBe(400);
    expect(blocked.body.details.missing).toEqual(['pan']);

    // The verified Aadhaar is locked; the rejected PAN can be replaced.
    const replaceVerified = await uploadDocument(vendor, 'aadhaar', aadhaar, { back: true });
    expect(replaceVerified.status).toBe(409);
    const reupload = await uploadDocument(vendor, 'pan', pan);
    expect(reupload.status).toBe(200);
    expect(reupload.body.data.documents[1].status).toBe('PENDING');

    const resubmitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('SUBMITTED');
  });

  it('moves to PENDING_APPROVAL once the documents and bank account are all verified', async () => {
    const panVerified = await adminPost(admin, applicationId, 'documents/pan/verify');
    expect(panVerified.status).toBe(200);
    expect(panVerified.body.data.status).toBe('SUBMITTED');

    const res = await adminPost(admin, applicationId, 'documents/bank_account/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING_APPROVAL');
    expect(res.body.data.documents[1]).toMatchObject({ status: 'VERIFIED', verificationSource: 'MANUAL', verifiedBy: { id: admin.id } });
    expect(res.body.data.bankDetails).toMatchObject({ status: 'VERIFIED', verifiedBy: { id: admin.id } });

    const twice = await adminPost(admin, applicationId, 'documents/pan/verify');
    expect(twice.status).toBe(409);
  });

  it('reserves the final decision for super admins', async () => {
    const approve = await adminPost(admin, applicationId, 'approve');
    expect(approve.status).toBe(403);
    const reject = await adminPost(admin, applicationId, 'reject', { reason: 'Not eligible in this city' });
    expect(reject.status).toBe(403);

    const professional = await prisma.professional.findUnique({ where: { id: applicationId } });
    expect(professional.onboardingStatus).toBe('PENDING_APPROVAL');
  });

  it('lets a super admin request changes, then skips re-verification on resubmit', async () => {
    const res = await adminPost(superAdmin, applicationId, 'request-changes', { reason: 'Please add your full address' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CHANGES_REQUESTED');

    const mine = await getMine(vendor);
    expect(mine.body.data.reviewNote).toBe('Please add your full address');

    const edit = await request(app)
      .put(`${API}/vendor-onboarding/personal-details`)
      .set(vendor.auth)
      .send({ ...personalDetails(), addressLine2: 'Koramangala' });
    expect(edit.status).toBe(200);

    const resubmitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(vendor.auth);
    expect(resubmitted.body.data.status).toBe('PENDING_APPROVAL');
    expect(resubmitted.body.data.reviewNote).toBeNull();
  });

  it('approves: the vendor becomes VERIFIED and onboarded, with a full audit trail', async () => {
    const res = await adminPost(superAdmin, applicationId, 'approve');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.reviewedBy.id).toBe(superAdmin.id);
    expect(res.body.data.events.map((event) => event.action)).toEqual([
      'SUBMITTED',
      'DOCUMENT_VERIFIED',
      'DOCUMENT_REJECTED',
      'RESUBMITTED',
      'DOCUMENT_VERIFIED',
      'DOCUMENT_VERIFIED',
      'CHANGES_REQUESTED',
      'RESUBMITTED',
      'APPROVED',
    ]);

    const professional = await prisma.professional.findUnique({ where: { id: applicationId }, include: { user: true } });
    expect(professional.kycStatus).toBe('VERIFIED');
    expect(professional.user.isOnboarded).toBe(true);

    const status = await request(app).get(`${API}/onboarding/status`).set(vendor.auth);
    expect(status.body.data).toMatchObject({ isOnboarded: true, role: 'PROFESSIONAL', vendorOnboardingStatus: 'APPROVED' });

    // Step 5: the vendor app sees the vendor as verified.
    const verified = await request(app).get(`${API}/vendor-onboarding/status`).set(vendor.auth);
    expect(verified.body.data).toMatchObject({ id: applicationId, status: 'APPROVED' });
    expect(verified.body.data.flow).toMatchObject({ currentStep: 5, isVerified: true });
    expect(stepStatuses(verified.body.data.flow)).toEqual(['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE']);

    // Now that the vendor is approved, customers can see their photo.
    const profile = await request(app).get(`${API}/professionals/${applicationId}`).set(customer.auth);
    expect(profile.body.data.photo).toBe(`/professionals/${applicationId}/photo`);
    const photo = await request(app).get(`${API}${profile.body.data.photo}`).set(customer.auth);
    expect(photo.status).toBe(200);
    expect(Buffer.compare(photo.body, PNG)).toBe(0);

    const twice = await adminPost(superAdmin, applicationId, 'approve');
    expect(twice.status).toBe(409);
    const bank = await saveBank(vendor, makeAccountNumber());
    expect(bank.status).toBe(409);
    const edit = await request(app).put(`${API}/vendor-onboarding/services`).set(vendor.auth).send({ categories: [category.id], experienceYears: 7 });
    expect(edit.status).toBe(409);
  });
});

describe('Super admin rejection and reopening', () => {
  let id;

  it('rejects an application and locks it', async () => {
    const number = makeAadhaar();
    await request(app).put(`${API}/vendor-onboarding/personal-details`).set(otherVendor.auth).send({ ...personalDetails(), name: `Second Vendor ${run}` });
    await uploadPhoto(otherVendor);
    await request(app).put(`${API}/vendor-onboarding/services`).set(otherVendor.auth).send({ categories: [category.id], experienceYears: 1 });
    await uploadDocument(otherVendor, 'aadhaar', number, { back: true });
    await uploadDocument(otherVendor, 'pan', makePan());
    await saveBank(otherVendor, makeAccountNumber(), { upiId: '' });
    const submitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(otherVendor.auth);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.bankDetails.upiId).toBeNull();
    id = submitted.body.data.id;

    const rejected = await adminPost(superAdmin, id, 'reject', { reason: 'Documents do not match the applicant' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const mine = await getMine(otherVendor);
    expect(mine.body.data).toMatchObject({ status: 'REJECTED', isEditable: false, reviewNote: 'Documents do not match the applicant' });
    expect(mine.body.data.flow.currentStep).toBe(4);
    expect(stepStatuses(mine.body.data.flow)).toEqual(['COMPLETE', 'COMPLETE', 'COMPLETE', 'REJECTED', 'PENDING']);

    const professional = await prisma.professional.findUnique({ where: { id }, include: { user: true } });
    expect(professional.kycStatus).toBe('REJECTED');
    expect(professional.user.isOnboarded).toBe(false);

    const edit = await request(app).put(`${API}/vendor-onboarding/services`).set(otherVendor.auth).send({ categories: [category.id], experienceYears: 2 });
    expect(edit.status).toBe(409);
  });

  it('lets only a super admin reopen it, after which the vendor can fix and resubmit', async () => {
    const byAdmin = await adminPost(admin, id, 'reopen', { reason: 'Vendor sent clearer documents' });
    expect(byAdmin.status).toBe(403);
    const noReason = await adminPost(superAdmin, id, 'reopen', {});
    expect(noReason.status).toBe(400);

    const reopened = await adminPost(superAdmin, id, 'reopen', { reason: 'Vendor sent clearer documents' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('CHANGES_REQUESTED');
    expect(reopened.body.data.events.map((event) => event.action)).toEqual(['SUBMITTED', 'REJECTED', 'REOPENED']);

    const professional = await prisma.professional.findUnique({ where: { id } });
    expect(professional).toMatchObject({ kycStatus: 'PENDING', reviewedById: null, reviewedAt: null });

    const twice = await adminPost(superAdmin, id, 'reopen', { reason: 'Vendor sent clearer documents' });
    expect(twice.status).toBe(409);

    const mine = await getMine(otherVendor);
    expect(mine.body.data).toMatchObject({ isEditable: true, canSubmit: true, reviewNote: 'Vendor sent clearer documents' });
    const edit = await request(app).put(`${API}/vendor-onboarding/services`).set(otherVendor.auth).send({ categories: [category.id], experienceYears: 2 });
    expect(edit.status).toBe(200);
    const resubmitted = await request(app).post(`${API}/vendor-onboarding/submit`).set(otherVendor.auth);
    expect(resubmitted.body.data.status).toBe('SUBMITTED');
  });
});

describe('Super admin role', () => {
  it('passes ADMIN-gated routes', async () => {
    const res = await request(app).get(`${API}/users`).query({ limit: 1 }).set(superAdmin.auth);
    expect(res.status).toBe(200);
  });

  it('can only be granted by another super admin', async () => {
    const email = `new-super-${run}@example.com`;
    const byAdmin = await request(app).post(`${API}/users`).set(admin.auth).send({ name: 'New Super', email, role: 'SUPER_ADMIN' });
    expect(byAdmin.status).toBe(403);

    const bySuper = await request(app).post(`${API}/users`).set(superAdmin.auth).send({ name: 'New Super', email, role: 'SUPER_ADMIN' });
    expect(bySuper.status).toBe(201);
    created.userIds.push(bySuper.body.data.user.id);

    const deactivate = await request(app).patch(`${API}/users/${bySuper.body.data.user.id}/active`).set(admin.auth).send({ isActive: false });
    expect(deactivate.status).toBe(403);
  });
});

// By this point: `vendor` is APPROVED (home zone set, 6 years' experience) and
// `otherVendor` was rejected, reopened and resubmitted, so is SUBMITTED.
describe('Super admin panel: vendors by status and all users, with filters', () => {
  const { schemas } = require('../src/docs/components');
  const vendors = (query) => request(app).get(`${API}/vendor-onboarding/applications`).query({ search: run, ...query }).set(superAdmin.auth);
  const users = (query) => request(app).get(`${API}/users`).query({ search: run, ...query }).set(superAdmin.auth);
  const names = (res) => res.body.items.map((item) => item.name);
  const day = (offset) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  it('lists vendors by one status or several', async () => {
    const approved = await vendors({ status: 'APPROVED' });
    expect(approved.status).toBe(200);
    expect(names(approved)).toEqual([`Ravi Kumar ${run}`]);
    expect(approved.body.items[0]).toMatchObject({ status: 'APPROVED', userId: vendor.id, isActive: true, experienceYears: 6, homeZone: { id: zone.id } });
    expect(approved.body.items[0].profilePhoto).toBe(`/vendor-onboarding/applications/${approved.body.items[0].id}/profile-photo`);
    // Same fields as the documented list item.
    expect(keysOf(approved.body.items[0])).toEqual(keysOf(schemas.VendorApplicationListItem.properties));

    const several = await vendors({ status: 'approved, SUBMITTED' });
    expect(names(several).sort()).toEqual([`Ravi Kumar ${run}`, `Second Vendor ${run}`]);
    expect(several.body.meta.total).toBe(2);

    const pending = await vendors({ status: 'PENDING_APPROVAL' });
    expect(pending.body.items).toEqual([]);

    const invalid = await vendors({ status: 'VERIFIED' });
    expect(invalid.status).toBe(400);
  });

  it('filters vendors by service, zone, city and submission date', async () => {
    expect(names(await vendors({ categoryId: category.id })).sort()).toEqual([`Ravi Kumar ${run}`, `Second Vendor ${run}`]);
    expect(names(await vendors({ categoryId: inactiveCategory.id }))).toEqual([]);
    expect(names(await vendors({ zoneId: zone.id }))).toEqual([`Ravi Kumar ${run}`]);
    expect(names(await vendors({ cityId: otherCity.id }))).toEqual([]);
    expect((await vendors({ submittedFrom: day(-1), submittedTo: day(1) })).body.meta.total).toBe(2);
    expect((await vendors({ submittedFrom: day(2) })).body.meta.total).toBe(0);
    expect((await vendors({ submittedFrom: 'yesterday' })).status).toBe(400);
  });

  it('sorts and paginates vendors', async () => {
    expect(names(await vendors({ sortBy: 'name', sortOrder: 'desc' }))).toEqual([`Second Vendor ${run}`, `Ravi Kumar ${run}`]);
    expect(names(await vendors({ sortBy: 'name', sortOrder: 'asc' }))).toEqual([`Ravi Kumar ${run}`, `Second Vendor ${run}`]);

    const page = await vendors({ sortBy: 'name', limit: 1, page: 2 });
    expect(names(page)).toEqual([`Second Vendor ${run}`]);
    expect(page.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('reports how many vendors are waiting at each review stage', async () => {
    const res = await request(app).get(`${API}/vendor-onboarding/applications/summary`).set(superAdmin.auth);
    expect(res.status).toBe(200);
    expect(keysOf(res.body.data)).toEqual(keysOf(schemas.VendorSummary.properties));
    expect(res.body.data.awaitingDocumentVerification).toBe(res.body.data.byStatus.SUBMITTED);
    expect(res.body.data.awaitingFinalApproval).toBe(res.body.data.byStatus.PENDING_APPROVAL);
  });

  it('lists all users with role, status and search filters, never leaking password hashes', async () => {
    const everyone = await users({});
    expect(everyone.status).toBe(200);
    expect(everyone.body.meta.total).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(everyone.body)).not.toContain('passwordHash');

    const vendorUsers = await users({ role: 'PROFESSIONAL' });
    expect(names(vendorUsers).sort()).toEqual([`Ravi Kumar ${run}`, `Second Vendor ${run}`]);
    const ravi = vendorUsers.body.items.find((item) => item.id === vendor.id);
    expect(ravi).toMatchObject({ city: { id: city.id }, professional: { onboardingStatus: 'APPROVED', kycStatus: 'VERIFIED' } });

    const staff = await users({ role: 'ADMIN,SUPER_ADMIN' });
    expect(staff.body.items.map((item) => item.id)).toEqual(expect.arrayContaining([admin.id, superAdmin.id]));
    expect(staff.body.items.every((item) => ['ADMIN', 'SUPER_ADMIN'].includes(item.role) && item.professional === null)).toBe(true);

    expect(names(await users({ vendorStatus: 'APPROVED' }))).toEqual([`Ravi Kumar ${run}`]);
    expect(names(await users({ vendorStatus: 'SUBMITTED,PENDING_APPROVAL' }))).toEqual([`Second Vendor ${run}`]);
    expect(names(await users({ role: 'CUSTOMER' }))).toEqual([`customer ${run}`]);
    expect(names(await users({ search: vendor.phone.slice(-8) }))).toEqual([`Ravi Kumar ${run}`]);
    expect((await users({ role: 'MANAGER' })).status).toBe(400);
  });

  it('filters users by active state, onboarding, city and join date, and sorts them', async () => {
    expect(names(await users({ isOnboarded: 'true', role: 'PROFESSIONAL' }))).toEqual([`Ravi Kumar ${run}`]);
    expect(names(await users({ isOnboarded: 'false', role: 'PROFESSIONAL' }))).toEqual([`Second Vendor ${run}`]);
    expect(names(await users({ cityId: otherCity.id }))).toEqual([]);
    expect((await users({ createdFrom: day(2) })).body.meta.total).toBe(0);
    expect((await users({ createdFrom: day(-1), createdTo: day(1) })).body.meta.total).toBeGreaterThanOrEqual(5);
    expect((await users({ isActive: 'maybe' })).status).toBe(400);

    expect(names(await users({ isActive: 'false' }))).toEqual([]);
    await request(app).patch(`${API}/users/${customer.id}/active`).set(superAdmin.auth).send({ isActive: false });
    expect(names(await users({ isActive: 'false' }))).toEqual([`customer ${run}`]);

    const byName = await users({ role: 'PROFESSIONAL', sortBy: 'name', sortOrder: 'asc' });
    expect(names(byName)).toEqual([`Ravi Kumar ${run}`, `Second Vendor ${run}`]);
  });

  it('shows one user in detail, linked to their vendor application', async () => {
    const res = await request(app).get(`${API}/users/${vendor.id}`).set(superAdmin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: vendor.id,
      role: 'PROFESSIONAL',
      city: { id: city.id },
      professional: { onboardingStatus: 'APPROVED' },
      counts: { bookings: 0, reviews: 0, amcSubscriptions: 0 },
    });
    expect(res.body.data.passwordHash).toBeUndefined();

    const application = await request(app).get(`${API}/vendor-onboarding/applications/${res.body.data.professional.id}`).set(superAdmin.auth);
    expect(application.body.data.personalDetails.phone).toBe(vendor.phone);
  });

  it('summarises users, and keeps all of this away from non-admins', async () => {
    const summary = await request(app).get(`${API}/users/summary`).set(superAdmin.auth);
    expect(summary.status).toBe(200);
    expect(keysOf(summary.body.data)).toEqual(keysOf(schemas.UserSummary.properties));
    expect(summary.body.data.total).toBe(summary.body.data.active + summary.body.data.inactive);
    expect(summary.body.data.byRole.SUPER_ADMIN).toBeGreaterThanOrEqual(1);

    expect((await request(app).get(`${API}/users`).set(vendor.auth)).status).toBe(403);
    expect((await request(app).get(`${API}/users/summary`).set(vendor.auth)).status).toBe(403);
    expect((await request(app).get(`${API}/vendor-onboarding/applications`).set(vendor.auth)).status).toBe(403);
  });
});
