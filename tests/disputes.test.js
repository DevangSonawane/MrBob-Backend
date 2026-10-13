const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

jest.mock('../src/modules/notifications/notifications.service', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined),
  sendOtp: jest.fn().mockResolvedValue(undefined),
}));
const notifications = require('../src/modules/notifications/notifications.service');

const API = '/api/v1';
const run = Date.now().toString(36);

describe('Help & disputes', () => {
  const made = { users: [], categories: [] };
  let customer;
  let other;
  let vendor;
  let admin;
  let booking;
  let disputeId;
  let vendorDisputeId;

  const make = async (role, label) => {
    const user = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@example.com`, role } });
    made.users.push(user.id);
    return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
  };
  const call = (who, method, path, body) => request(app)[method](`${API}${path}`).set(who.auth).send(body);
  const raise = { category: 'REFUND', subject: 'Refund not received', description: 'I cancelled and paid online but the refund has not arrived.' };

  beforeAll(async () => {
    customer = await make('CUSTOMER', 'dsp-customer');
    other = await make('CUSTOMER', 'dsp-other');
    vendor = await make('PROFESSIONAL', 'dsp-vendor');
    admin = await make('ADMIN', 'dsp-admin');
    const profile = await prisma.professional.create({ data: { userId: vendor.id, categories: [] } });
    const category = await prisma.serviceCategory.create({ data: { name: `Dispute Service ${run}`, tier: 'REPAIR', basePrice: 300 } });
    made.categories.push(category.id);
    booking = await prisma.booking.create({ data: { customerId: customer.id, professionalId: profile.id, categoryId: category.id, status: 'COMPLETED', address: '1 Dispute Road', price: 300, description: 'Switch board repair' } });
  });

  afterAll(async () => {
    await prisma.dispute.deleteMany({ where: { raisedById: { in: made.users } } });
    await prisma.booking.deleteMany({ where: { categoryId: { in: made.categories } } });
    await prisma.professional.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: made.categories } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  });

  it('offers each side its own categories', async () => {
    const keys = async (who, prefix) => (await call(who, 'get', `${prefix}/disputes/categories`)).body.data.map((item) => item.key);
    const forCustomer = await keys(customer, '/customer');
    const forVendor = await keys(vendor, '/vendor');
    expect(forCustomer).toEqual(expect.arrayContaining(['REFUND', 'SERVICE_QUALITY', 'PROFESSIONAL_BEHAVIOUR']));
    expect(forCustomer).not.toContain('PAYOUT');
    expect(forVendor).toEqual(expect.arrayContaining(['PAYOUT', 'CUSTOMER_BEHAVIOUR']));
    expect(forVendor).not.toContain('REFUND');
    expect((await call(vendor, 'get', '/customer/disputes')).status).toBe(403);
  });

  it('lets a customer raise a dispute about their own booking', async () => {
    expect((await call(customer, 'post', '/customer/disputes', { ...raise, description: 'short' })).status).toBe(400);
    expect((await call(customer, 'post', '/customer/disputes', { ...raise, category: 'PAYOUT' })).status).toBe(400);
    expect((await call(other, 'post', '/customer/disputes', { ...raise, bookingId: booking.id })).status).toBe(400);

    const res = await call(customer, 'post', '/customer/disputes', { ...raise, bookingId: booking.id });
    expect(res.status).toBe(201);
    disputeId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      type: 'DISPUTE',
      category: 'REFUND',
      categoryLabel: 'A refund',
      status: 'OPEN',
      booking: { id: booking.id },
      messages: [],
      actions: { canReply: true, canClose: true, canResolve: false },
    });
    expect(res.body.data.reference).toMatch(/^DSP-\d{6}$/);
    expect(res.body.data).not.toHaveProperty('priority');
  });

  it('lets a vendor raise one about a job of theirs, or with no booking at all', async () => {
    const about = await call(vendor, 'post', '/vendor/disputes', { category: 'PAYOUT', subject: 'Not paid for a job', description: 'I completed this job and have not been paid.', bookingId: booking.id });
    expect(about.status).toBe(201);
    vendorDisputeId = about.body.data.id;
    const help = await call(vendor, 'post', '/vendor/disputes', { type: 'HELP', category: 'APP_ISSUE', subject: 'App keeps logging out', description: 'The app signs me out every few minutes.' });
    expect(help.body.data).toMatchObject({ type: 'HELP', booking: null });
  });

  it('shows each person only what they raised', async () => {
    const mine = await call(customer, 'get', '/customer/disputes');
    expect(mine.body.items.map((item) => item.id)).toEqual([disputeId]);
    expect((await call(vendor, 'get', '/vendor/disputes?type=HELP')).body.meta.total).toBe(1);
    expect((await call(vendor, 'get', '/vendor/disputes')).body.meta.total).toBe(2);
    expect((await call(other, 'get', `/customer/disputes/${disputeId}`)).status).toBe(404);
    expect((await call(customer, 'get', `/customer/disputes/${vendorDisputeId}`)).status).toBe(404);
  });

  it('gives the support team everything, with filters and counts', async () => {
    expect((await call(customer, 'get', '/disputes')).status).toBe(403);
    const ids = async (query) => (await call(admin, 'get', `/disputes?userId=${query}`)).body.items.map((item) => item.id);
    expect(await ids(`${customer.id}`)).toEqual([disputeId]);
    expect(await ids(`${vendor.id}&type=DISPUTE`)).toEqual([vendorDisputeId]);

    const byRef = await call(admin, 'get', `/disputes?search=${(await call(admin, 'get', `/disputes/${disputeId}`)).body.data.reference}`);
    expect(byRef.body.items.map((item) => item.id)).toEqual([disputeId]);
    expect(byRef.body.items[0]).toMatchObject({ priority: 'NORMAL', assignedTo: null, raisedBy: { id: customer.id, role: 'CUSTOMER' } });

    const summary = await call(admin, 'get', '/disputes/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data.byStatus.OPEN).toBeGreaterThanOrEqual(3);
    expect(summary.body.data.unassigned).toBeGreaterThanOrEqual(3);
  });

  it('runs the conversation: support replies, the customer answers', async () => {
    expect((await call(admin, 'patch', `/disputes/${disputeId}`, { assignedToId: customer.id })).status).toBe(400);
    const triaged = await call(admin, 'patch', `/disputes/${disputeId}`, { priority: 'HIGH', assignedToId: admin.id });
    expect(triaged.body.data).toMatchObject({ priority: 'HIGH', assignedTo: { id: admin.id }, status: 'OPEN' });

    const replied = await call(admin, 'post', `/disputes/${disputeId}/messages`, { message: 'We are checking with the payments team.' });
    expect(replied.status).toBe(201);
    expect(replied.body.data.status).toBe('IN_PROGRESS');
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(customer.id, expect.objectContaining({ title: 'Support replied' }));

    const answered = await call(customer, 'post', `/customer/disputes/${disputeId}/messages`, { message: 'Thank you, please let me know.' });
    expect(answered.body.data.messages).toMatchObject([
      { authorRole: 'ADMIN', authorName: 'Support', mine: false },
      { authorRole: 'CUSTOMER', mine: true },
    ]);
  });

  it('is resolved by support, reopened by a reply, and finally closed by the customer', async () => {
    expect((await call(admin, 'post', `/disputes/${disputeId}/resolve`, { resolution: 'ok' })).status).toBe(400);
    const resolved = await call(admin, 'post', `/disputes/${disputeId}/resolve`, { resolution: 'The refund was sent on 13 October.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'The refund was sent on 13 October.', actions: { canResolve: false } });
    expect(resolved.body.data.resolvedAt).not.toBeNull();
    expect((await call(admin, 'post', `/disputes/${disputeId}/resolve`, { resolution: 'Again, resolved.' })).status).toBe(409);

    const reopened = await call(customer, 'post', `/customer/disputes/${disputeId}/messages`, { message: 'It still has not arrived.' });
    expect(reopened.body.data).toMatchObject({ status: 'OPEN', resolvedAt: null });

    const closed = await call(customer, 'post', `/customer/disputes/${disputeId}/close`);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', actions: { canReply: false, canClose: false } });
    expect((await call(customer, 'post', `/customer/disputes/${disputeId}/messages`, { message: 'One more thing' })).status).toBe(409);
    expect((await call(customer, 'post', `/customer/disputes/${disputeId}/close`)).status).toBe(409);
  });

  it('keeps a dispute when its booking is deleted', async () => {
    await prisma.booking.delete({ where: { id: booking.id } });
    const detail = await call(vendor, 'get', `/vendor/disputes/${vendorDisputeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.booking).toBeNull();
  });
});
