const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const password = 'SuperSecret123';

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe('Email signup + login', () => {
  it('signs up a new user and never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Test User', email, password });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.isOnboarded).toBe(false);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate signup with the same email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Dup', email, password });

    expect(res.status).toBe(409);
  });

  it('logs in with the correct password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects an incorrect password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('rejects a login for an email that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password });

    expect(res.status).toBe(401);
  });

  it('reaches /auth/me with the issued access token', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password });
    const { accessToken } = loginRes.body.data;

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.passwordHash).toBeUndefined();
  });
});
