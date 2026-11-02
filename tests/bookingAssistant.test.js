const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const claude = require('../src/modules/assistant/claude.client');
const { issueTokenPair } = require('../src/modules/auth/token.util');

// The booking assistant, with a stand-in for Claude: what we send it, and how
// each kind of answer becomes a draft.

const API = '/api/v1';
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const randomDigits = (length) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const userIds = [];
const categoryIds = [];
let customer, vendor, plumber, electrician, retired;

const makeUser = async (role, label) => {
  const user = await prisma.user.create({ data: { name: `${label} ${run}`, role, phone: `+9195${randomDigits(8)}`, email: `${label}-${run}@example.com`, isOnboarded: true } });
  userIds.push(user.id);
  return { ...user, auth: { Authorization: `Bearer ${issueTokenPair(user).accessToken}` } };
};

// Claude stand-in: answers with `reply` (a draft, or a function of the request) and records each request.
const fakeClaude = (reply) => {
  const calls = [];
  claude.useForTests({
    beta: {
      messages: {
        parse: jest.fn(async (params) => {
          calls.push(params);
          const output = typeof reply === 'function' ? reply(params) : reply;
          if (output instanceof Error) throw output;
          return { stop_reason: output.stop_reason ?? 'end_turn', parsed_output: output.stop_reason ? null : output, usage: { input_tokens: 900, output_tokens: 120 } };
        }),
      },
    },
  });
  return calls;
};

const draftOf = (overrides = {}) => ({
  status: 'READY',
  serviceId: plumber.id,
  alternativeServiceIds: [],
  summary: 'Pipe under the kitchen sink leaking since this morning.',
  urgency: 'SOON',
  preferredTime: null,
  questions: [],
  safetyAdvice: null,
  ...overrides,
});

const ask = (body, user = customer) => request(app).post(`${API}/bookings/draft`).set(user.auth).send(body);

beforeAll(async () => {
  plumber = await prisma.serviceCategory.create({ data: { name: `Plumber ${run}`, tier: 'REPAIR', basePrice: 349 } });
  electrician = await prisma.serviceCategory.create({ data: { name: `Electrician ${run}`, tier: 'REPAIR', basePrice: 299 } });
  retired = await prisma.serviceCategory.create({ data: { name: `Retired ${run}`, tier: 'REPAIR', basePrice: 1, isActive: false } });
  categoryIds.push(plumber.id, electrician.id, retired.id);
  customer = await makeUser('CUSTOMER', 'assist-customer');
  vendor = await makeUser('PROFESSIONAL', 'assist-vendor');
});

afterEach(() => claude.useForTests(null));

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.$disconnect();
});

describe('Drafting a booking from the customer\'s own words', () => {
  it('asks Claude with the catalogue and the message, and returns a ready draft', async () => {
    const calls = fakeClaude(draftOf());
    const res = await ask({ message: 'the pipe under my kitchen sink is leaking since morning', source: 'VOICE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'READY',
      service: { id: plumber.id, name: plumber.name, basePrice: 349 },
      alternatives: [],
      description: 'Pipe under the kitchen sink leaking since this morning.',
      urgency: 'SOON',
      suggestedScheduledAt: null,
      questions: [],
      price: 349,
    });

    const [params] = calls;
    expect(params).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' }, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(params.output_config.format).toBeDefined();
    // Only active services are offered, in the cached system prompt.
    const system = params.system[0].text;
    expect(system).toContain(`${plumber.id} | ${plumber.name} | REPAIR`);
    expect(system).not.toContain(retired.id);
    // The customer's words go in the user message, marked as such, with the time and how they said it.
    const content = params.messages[0].content;
    expect(content).toContain('<customer_message>\nthe pipe under my kitchen sink is leaking since morning\n</customer_message>');
    expect(content).toMatch(/spoken \(transcribed by their phone\)/);
    expect(content).toMatch(/Current time in India: /);
  });

  it('sends the answers to earlier questions back with the message', async () => {
    const calls = fakeClaude(draftOf());
    await ask({ message: 'no power in the kitchen', answers: [{ question: 'Is it the whole house or one room?', answer: 'Only the kitchen' }] });
    expect(calls[0].messages[0].content).toContain('Q: Is it the whole house or one room?\nA: Only the kitchen');
  });

  it('keeps a requested time only when it can be booked', async () => {
    const tomorrowEvening = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
    fakeClaude(draftOf({ preferredTime: tomorrowEvening }));
    expect((await ask({ message: 'tap leaking, come tomorrow evening' })).body.data.suggestedScheduledAt).toBe(tomorrowEvening);

    fakeClaude(draftOf({ preferredTime: new Date(Date.now() + 10 * 60 * 1000).toISOString() }));
    expect((await ask({ message: 'tap leaking, come in ten minutes' })).body.data.suggestedScheduledAt).toBeNull();
  });

  it('gives an emergency the earliest slot, with safety advice', async () => {
    fakeClaude(draftOf({ serviceId: electrician.id, urgency: 'EMERGENCY', safetyAdvice: 'Switch off the mains until the electrician arrives.' }));
    const res = await ask({ message: 'sparks coming from the switchboard and burning smell' });
    expect(res.body.data).toMatchObject({ urgency: 'EMERGENCY', service: { id: electrician.id }, safetyAdvice: 'Switch off the mains until the electrician arrives.' });
    const slot = new Date(res.body.data.suggestedScheduledAt).getTime();
    expect(slot).toBeGreaterThanOrEqual(Date.now() + 60 * 60 * 1000 - 5000);
    expect(slot).toBeLessThan(Date.now() + 80 * 60 * 1000);
  });

  it('asks the customer to choose when it isn\'t sure, and never offers unknown or retired services', async () => {
    fakeClaude(draftOf({ status: 'NEEDS_INFO', serviceId: plumber.id, alternativeServiceIds: [electrician.id, retired.id, 'made-up-id', plumber.id], questions: ['Is water coming out, or has the motor stopped?', ' ', 'Is it a submersible pump?', 'One too many?'] }));
    const res = await ask({ message: 'my water pump is not working' });
    expect(res.body.data.status).toBe('NEEDS_INFO');
    expect(res.body.data.alternatives.map((item) => item.id)).toEqual([electrician.id]);
    // Blank ones dropped, at most two kept.
    expect(res.body.data.questions).toEqual(['Is water coming out, or has the motor stopped?', 'Is it a submersible pump?']);
  });

  it('turns a service id that isn\'t in the catalogue into a question', async () => {
    fakeClaude(draftOf({ serviceId: retired.id }));
    const res = await ask({ message: 'fix my thing' });
    expect(res.body.data).toMatchObject({ status: 'NEEDS_INFO', service: null, price: null });
  });

  it('says when nothing we offer fits', async () => {
    fakeClaude(draftOf({ status: 'NOT_OFFERED', serviceId: null, summary: 'Wants a car washed.' }));
    expect((await ask({ message: 'please wash my car' })).body.data).toMatchObject({ status: 'NOT_OFFERED', service: null });
  });
});

describe('When the assistant can\'t help', () => {
  it('is switched off without an API key (503), so the app shows the service picker', async () => {
    const res = await ask({ message: 'kitchen tap leaking' });
    expect(res.status).toBe(503);
    expect(res.body.details).toEqual({ code: 'ASSISTANT_UNAVAILABLE' });
  });

  it('answers 422 when the model declines or the reply can\'t be read', async () => {
    fakeClaude({ stop_reason: 'refusal' });
    const declined = await ask({ message: 'something odd' });
    expect(declined.status).toBe(422);
    expect(declined.body.details.code).toBe('ASSISTANT_NO_DRAFT');

    fakeClaude(new claude.Anthropic.AnthropicError('Failed to parse structured output'));
    expect((await ask({ message: 'something odder' })).status).toBe(422);
  });

  it('answers 503 when Claude is busy or down', async () => {
    fakeClaude(new claude.Anthropic.RateLimitError(429, { error: { message: 'busy' } }, 'busy', new globalThis.Headers()));
    const busy = await ask({ message: 'kitchen tap leaking' });
    expect(busy.status).toBe(503);
    expect(busy.body.details.code).toBe('ASSISTANT_UNAVAILABLE');

    fakeClaude(new claude.Anthropic.InternalServerError(500, { error: { message: 'down' } }, 'down', new globalThis.Headers()));
    expect((await ask({ message: 'kitchen tap leaking' })).status).toBe(503);
  });

  it('checks the message, and is for customers and the team only', async () => {
    fakeClaude(draftOf());
    expect((await ask({ message: 'hi' })).status).toBe(400);
    expect((await ask({ message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await ask({ message: 'kitchen tap leaking', source: 'VIDEO' })).status).toBe(400);
    expect((await ask({ message: 'kitchen tap leaking' }, vendor)).status).toBe(403);
    expect((await request(app).post(`${API}/bookings/draft`).send({ message: 'kitchen tap leaking' })).status).toBe(401);
  });
});
