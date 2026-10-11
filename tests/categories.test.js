const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { issueTokenPair } = require('../src/modules/auth/token.util');

const API = '/api/v1';
const run = Date.now().toString(36);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('Service categories', () => {
  let auth;
  let admin;
  const created = [];

  beforeAll(async () => {
    admin = await prisma.user.create({ data: { name: 'Category Admin', email: `cat-admin-${run}@example.com`, role: 'ADMIN' } });
    auth = { Authorization: `Bearer ${issueTokenPair(admin).accessToken}` };
  });

  afterAll(async () => {
    await prisma.serviceCategory.deleteMany({ where: { id: { in: created } } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it('creates a category, with a picture sent in the same call', async () => {
    const res = await request(app)
      .post(`${API}/categories`)
      .set(auth)
      .field('name', `Carpentry ${run}`)
      .field('tier', 'REPAIR')
      .field('basePrice', '449')
      .attach('image', PNG, { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    expect(res.body.data.image).toMatch(new RegExp(`^/categories/${res.body.data.id}/image`));
    expect(res.body.data).not.toHaveProperty('imageKey');

    // The picture is public.
    const image = await request(app).get(`${API}${res.body.data.image}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');

    const listed = (await request(app).get(`${API}/categories`)).body.data.find((item) => item.id === res.body.data.id);
    expect(listed.image).toBe(res.body.data.image);
  });

  it('refuses a duplicate name, whatever the case', async () => {
    const res = await request(app).post(`${API}/categories`).set(auth).send({ name: `carpentry ${run}`, tier: 'REPAIR', basePrice: 100 });
    expect(res.status).toBe(409);
  });

  it('adds, replaces and removes a picture on an existing category', async () => {
    const plain = await request(app).post(`${API}/categories`).set(auth).send({ name: `Painting ${run}`, tier: 'RENOVATION', basePrice: 999 });
    expect(plain.status).toBe(201);
    expect(plain.body.data.image).toBeNull();
    const { id } = plain.body.data;
    created.push(id);
    expect((await request(app).get(`${API}/categories/${id}/image`)).status).toBe(404);

    const notAnImage = await request(app).put(`${API}/categories/${id}/image`).set(auth).attach('image', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' });
    expect(notAnImage.status).toBe(400);
    expect((await request(app).put(`${API}/categories/${id}/image`).attach('image', PNG, 'c.png')).status).toBe(401);

    const added = await request(app).put(`${API}/categories/${id}/image`).set(auth).attach('image', PNG, { filename: 'c.png', contentType: 'image/png' });
    expect(added.status).toBe(200);
    expect(added.body.data.image).toContain(`/categories/${id}/image`);

    const removed = await request(app).delete(`${API}/categories/${id}/image`).set(auth);
    expect(removed.body.data.image).toBeNull();
  });
});
