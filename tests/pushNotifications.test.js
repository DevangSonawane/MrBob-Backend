const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');
const sessions = require('../src/modules/auth/session.service');
const fcm = require('../src/modules/notifications/fcm.client');
const notifications = require('../src/modules/notifications/notifications.service');

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const fcmToken = (label) => `fcm-${label}-${run}-${'x'.repeat(40)}`;

// A throwaway service account key, so the Firebase sign-in is really signed.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const FIREBASE_KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const original = Object.fromEntries(FIREBASE_KEYS.map((key) => [key, env[key]]));
const originalFetch = globalThis.fetch;

const userIds = [];
let customer, admin;

// Signs a user in for real, so the access token carries a session.
const signIn = async (role, label) => {
  const user = await prisma.user.create({ data: { name: `${label} ${run}`, role, phone: `+9197${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true } });
  userIds.push(user.id);
  const tokens = await sessions.start(user);
  return { ...user, ...tokens, auth: { Authorization: `Bearer ${tokens.accessToken}` } };
};

const register = (user, token, platform = 'ANDROID') => request(app).post(`${API}/users/me/devices`).set(user.auth).send({ token, platform });
const devicesOf = (userId) => prisma.pushDevice.findMany({ where: { userId }, orderBy: { token: 'asc' } });

// Firebase stand-in: answers the OAuth token call and each send, recording what was asked.
const fakeFirebase = ({ deadTokens = [] } = {}) => {
  const calls = [];
  globalThis.fetch = jest.fn(async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') return { ok: true, status: 200, json: async () => ({ access_token: 'firebase-access-token', expires_in: 3600 }) };
    const { message } = JSON.parse(options.body);
    if (deadTokens.includes(message.token)) {
      return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ name: 'projects/p/messages/1' }) };
  });
  return calls;
};

const useFirebase = () => {
  Object.assign(env, { FIREBASE_PROJECT_ID: 'zingit-test', FIREBASE_CLIENT_EMAIL: 'push@zingit-test.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') });
  fcm.resetForTests();
};

beforeAll(async () => {
  customer = await signIn('CUSTOMER', 'push-customer');
  admin = await signIn('ADMIN', 'push-admin');
});

afterEach(() => {
  Object.assign(env, original);
  globalThis.fetch = originalFetch;
  fcm.resetForTests();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('Registering a device', () => {
  it('registers, and registering again just refreshes it', async () => {
    const res = await register(customer, fcmToken('phone'));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ platform: 'ANDROID' });
    expect(res.body.data).not.toHaveProperty('token');
    expect((await register(customer, fcmToken('phone'), 'IOS')).status).toBe(201);
    const devices = await devicesOf(customer.id);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ platform: 'IOS', sessionId: expect.any(String) });
  });

  it('moves a token to whoever signs in on that phone next', async () => {
    const other = await signIn('CUSTOMER', 'push-other');
    await register(other, fcmToken('shared'));
    await register(customer, fcmToken('shared'));
    expect(await devicesOf(other.id)).toHaveLength(0);
    expect((await devicesOf(customer.id)).map((device) => device.token)).toContain(fcmToken('shared'));
  });

  it('needs a token and a known platform, and a signed-in user', async () => {
    expect((await request(app).post(`${API}/users/me/devices`).set(customer.auth).send({ token: 'short', platform: 'ANDROID' })).status).toBe(400);
    expect((await request(app).post(`${API}/users/me/devices`).set(customer.auth).send({ token: fcmToken('x'), platform: 'NOKIA' })).status).toBe(400);
    expect((await request(app).post(`${API}/users/me/devices`).send({ token: fcmToken('x'), platform: 'ANDROID' })).status).toBe(401);
  });

  it('removes a device on request, only for its owner', async () => {
    await register(customer, fcmToken('remove-me'));
    const path = `${API}/users/me/devices/${encodeURIComponent(fcmToken('remove-me'))}`;
    expect((await request(app).delete(path).set(admin.auth)).status).toBe(404);
    expect((await request(app).delete(path).set(customer.auth)).status).toBe(200);
    expect((await request(app).delete(path).set(customer.auth)).status).toBe(404);
  });
});

describe('Sending', () => {
  it('only logs while Firebase is not configured', async () => {
    globalThis.fetch = jest.fn();
    const result = await notifications.sendPushNotification(customer.id, { title: 'Hi', body: 'There' });
    expect(result).toMatchObject({ dev: true, sent: 0 });
    expect(result.devices).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('signs in to Firebase with the service account and sends to every device', async () => {
    useFirebase();
    const calls = fakeFirebase();
    const devices = await devicesOf(customer.id);
    const result = await notifications.sendPushNotification(customer.id, { title: 'Professional assigned', body: 'Ravi will do your job.', data: { type: 'BOOKING', bookingId: 'b-1', attempt: 2, missing: null } });
    expect(result).toEqual({ sent: devices.length, devices: devices.length, removed: 0, failed: 0 });

    // One sign-in: a JWT signed with the service account key, for the messaging scope.
    const signInCalls = calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token');
    expect(signInCalls).toHaveLength(1);
    const assertion = new globalThis.URLSearchParams(signInCalls[0].options.body.toString()).get('assertion');
    expect(jwt.verify(assertion, publicKey, { algorithms: ['RS256'] })).toMatchObject({
      iss: 'push@zingit-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const sends = calls.filter((call) => call.url.startsWith('https://fcm.googleapis.com/'));
    expect(sends[0].url).toBe('https://fcm.googleapis.com/v1/projects/zingit-test/messages:send');
    expect(sends[0].options.headers.Authorization).toBe('Bearer firebase-access-token');
    const { message } = JSON.parse(sends[0].options.body);
    expect(message.notification).toEqual({ title: 'Professional assigned', body: 'Ravi will do your job.' });
    // Data values are strings, and empty ones are left out.
    expect(message.data).toEqual({ type: 'BOOKING', bookingId: 'b-1', attempt: '2' });
    expect(message.android.priority).toBe('HIGH');
    expect(sends.map((call) => JSON.parse(call.options.body).message.token).sort()).toEqual(devices.map((device) => device.token).sort());

    // The access token is reused for the next notification.
    await notifications.sendPushNotification(customer.id, { title: 'Again', body: 'Hello' });
    expect(calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });

  it('forgets a token Firebase says is gone', async () => {
    useFirebase();
    await register(customer, fcmToken('uninstalled'));
    fakeFirebase({ deadTokens: [fcmToken('uninstalled')] });
    const result = await notifications.sendPushNotification(customer.id, { title: 'Hi', body: 'There' });
    expect(result.removed).toBe(1);
    expect((await devicesOf(customer.id)).map((device) => device.token)).not.toContain(fcmToken('uninstalled'));
  });

  it('does not throw when Firebase is unreachable', async () => {
    useFirebase();
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    const result = await notifications.sendPushNotification(customer.id, { title: 'Hi', body: 'There' });
    expect(result.sent).toBe(0);
    expect(result.failed).toBeGreaterThan(0);
  });
});

describe('Signing out stops notifications', () => {
  it('logging out removes that sign-in\'s devices, not the others', async () => {
    const user = await signIn('CUSTOMER', 'push-logout');
    const secondSession = await sessions.start(user);
    await register(user, fcmToken('logout-a'));
    await register({ auth: { Authorization: `Bearer ${secondSession.accessToken}` } }, fcmToken('logout-b'));

    expect((await request(app).post(`${API}/auth/logout`).send({ refreshToken: user.refreshToken })).status).toBe(200);
    expect((await devicesOf(user.id)).map((device) => device.token)).toEqual([fcmToken('logout-b')]);
  });

  it('a deactivated account loses all its devices', async () => {
    const user = await signIn('CUSTOMER', 'push-deactivated');
    await register(user, fcmToken('deactivated'));
    const res = await request(app).patch(`${API}/users/${user.id}/active`).set(admin.auth).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(await devicesOf(user.id)).toHaveLength(0);
  });

  it('a deleted account loses all its devices', async () => {
    const user = await signIn('CUSTOMER', 'push-deleted');
    await register(user, fcmToken('deleted'));
    expect((await request(app).delete(`${API}/users/me`).set(user.auth)).status).toBe(200);
    expect(await devicesOf(user.id)).toHaveLength(0);
  });
});
