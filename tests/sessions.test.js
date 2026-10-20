const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');
const { signRefreshToken } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = Date.now().toString(36);

// Sign-in sessions: refresh tokens that slide, survive concurrent refreshes, and can be revoked.
describe('Sessions and refresh tokens', () => {
  let user;
  let admin;
  const password = 'correct-horse-battery';
  const bcrypt = require('bcryptjs');

  beforeAll(async () => {
    user = await prisma.user.create({ data: { name: `Session User ${run}`, email: `session-${run}@example.com`, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 4) } });
    admin = await prisma.user.create({ data: { name: `Session Super ${run}`, email: `session-super-${run}@example.com`, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 4) } });
  });
  afterAll(() => prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } }));

  const login = (email) => request(app).post(`${API}/auth/login`).send({ email, password });
  const refresh = (refreshToken) => request(app).post(`${API}/auth/refresh`).send({ refreshToken });
  const me = (accessToken) => request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${accessToken}`);

  it('signs in with a session and tells the app when the access token expires', async () => {
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f-]{36}\.[\w-]+$/);
    expect(res.body.data.accessTokenExpiresIn).toBeGreaterThan(0);
    expect(jwt.decode(res.body.data.accessToken).sid).toBe(res.body.data.refreshToken.split('.')[0]);
  });

  it('says why a token was refused', async () => {
    expect((await request(app).get(`${API}/auth/me`)).body.details).toEqual({ code: 'TOKEN_MISSING' });
    expect((await me('not-a-token')).body.details).toEqual({ code: 'TOKEN_INVALID' });
    const stale = jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, { expiresIn: -10 });
    const expired = await me(stale);
    expect(expired.status).toBe(401);
    expect(expired.body.details).toEqual({ code: 'TOKEN_EXPIRED' });
  });

  it('refreshes repeatedly, even twice at once, and slides the expiry', async () => {
    const { refreshToken } = (await login(user.email)).body.data;
    const sessionId = refreshToken.split('.')[0];
    const before = (await prisma.authSession.findUnique({ where: { id: sessionId } })).expiresAt;

    const [a, b] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.refreshToken).toBe(refreshToken);
    expect((await me(a.body.data.accessToken)).status).toBe(200);
    expect((await refresh(refreshToken)).status).toBe(200);
    expect((await prisma.authSession.findUnique({ where: { id: sessionId } })).expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime());

    expect((await refresh(`${sessionId}.wrong-secret`)).body.details).toEqual({ code: 'SESSION_EXPIRED' });
  });

  it('signs a device out, and a deactivated account everywhere', async () => {
    const first = (await login(user.email)).body.data.refreshToken;
    const second = (await login(user.email)).body.data.refreshToken;

    expect((await request(app).post(`${API}/auth/logout`).send({ refreshToken: first })).body.data).toEqual({ signedOut: true });
    expect((await refresh(first)).status).toBe(401);
    expect((await refresh(second)).status).toBe(200);

    const superAuth = { Authorization: `Bearer ${(await login(admin.email)).body.data.accessToken}` };
    await request(app).patch(`${API}/users/${user.id}/active`).set(superAuth).send({ isActive: false });
    expect((await refresh(second)).body.details).toEqual({ code: 'SESSION_EXPIRED' });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  });

  it('still accepts a refresh token from before sessions, once, and moves it onto a session', async () => {
    const legacy = signRefreshToken(user);
    const res = await refresh(legacy);
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f-]{36}\./);
  });
});
