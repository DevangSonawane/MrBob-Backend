const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

// Regression test for a real bug: Express 5 made req.query a getter-only
// property, so validate.js's old `req.query = parsed` silently no-op'd and
// every paginated/filtered list endpoint ignored query params (or crashed
// with "Argument `skip` is missing" when none were given at all).

const email = `pagination-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const password = 'SuperSecret123';
let accessToken;

beforeAll(async () => {
  const signupRes = await request(app).post('/api/v1/auth/signup').send({ name: 'Admin Tester', email, password });
  await prisma.user.update({ where: { id: signupRes.body.data.user.id }, data: { role: 'ADMIN' } });

  const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password });
  accessToken = loginRes.body.data.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe('Query validation (pagination/filters actually apply)', () => {
  it('applies default page/limit when no query params are given', async () => {
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(20);
  });

  it('coerces explicit page/limit query params to numbers and applies them', async () => {
    const res = await request(app)
      .get('/api/v1/users?page=1&limit=1')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(1);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
  });

  it('applies a role filter from the query string', async () => {
    const res = await request(app)
      .get('/api/v1/users?role=ADMIN')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.every((u) => u.role === 'ADMIN')).toBe(true);
  });
});
