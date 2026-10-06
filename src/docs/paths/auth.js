const { ref, ok, jsonBody, op } = require('../helpers');
const { examples } = require('../components');

const TAG = 'Auth';
const phone = { type: 'string', pattern: '^\\+?[1-9]\\d{9,14}$', example: '+919812345678', description: 'E.164 format' };
const session = ref('AuthSession');
const sessionExample = {
  user: { id: 'c7d8e9f0-5555-4a1b-9c2d-3e4f5a6b7c8d', name: 'Aarav Mehta', phone: '+919812345678', email: null, role: 'CUSTOMER', isOnboarded: false },
  ...examples.tokens,
};

module.exports = {
  tags: [
    {
      name: TAG,
      description:
        'Sign-in for the customer app (phone + OTP) and the admin dashboard (email + password). Vendors sign in through ' +
        '**Vendor onboarding · Step 1 & 2** instead. Every sign-in returns an access token (15 min) and a refresh token (30 days).',
    },
  ],
  paths: {
    '/auth/otp/request': {
      post: op({
        tag: TAG,
        summary: 'Send a login OTP',
        description:
          'Generates a 6-digit code valid for 5 minutes. In development without a WhatsApp token, the code is written to the server log. ' +
          'If the server has `OTP_STATIC_CODE` set (no SMS provider yet), the code is always that fixed value.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['phone'], properties: { phone } }, { phone: '+919812345678' }),
        responses: { 200: ok('OTP sent', { type: 'object', properties: { sent: { type: 'boolean' } } }, { sent: true }) },
      }),
    },
    '/auth/otp/verify': {
      post: op({
        tag: TAG,
        summary: 'Verify the OTP and sign in',
        description: 'Creates a `CUSTOMER` account on first login. Returns **400** for a wrong or expired code and **403** for a deactivated account.',
        access: 'public',
        body: jsonBody(
          {
            type: 'object',
            required: ['phone', 'otp'],
            properties: {
              phone,
              otp: { type: 'string', minLength: 6, maxLength: 6, example: '482913' },
              name: { type: 'string', minLength: 2, description: 'Used as the display name when the account is created' },
            },
          },
          { phone: '+919812345678', otp: '482913', name: 'Aarav Mehta' },
        ),
        responses: { 200: ok('Signed in', session, sessionExample) },
        errors: [403],
      }),
    },
    '/auth/signup': {
      post: op({
        tag: TAG,
        summary: 'Sign up with email and password',
        description: 'Creates a `CUSTOMER` account and signs in. Returns **409** if the email or phone is already registered.',
        access: 'public',
        body: jsonBody(
          {
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', minLength: 2 },
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 8, maxLength: 72 },
              phone,
            },
          },
          { name: 'Aarav Mehta', email: 'aarav@example.com', password: 'SuperSecret123' },
        ),
        responses: { 201: ok('Account created', session, { ...sessionExample, user: { ...sessionExample.user, phone: null, email: 'aarav@example.com' } }) },
        errors: [409],
      }),
    },
    '/auth/login': {
      post: op({
        tag: TAG,
        summary: 'Sign in with email and password',
        description: 'Returns **401** for a wrong email or password and **403** for a deactivated account.',
        access: 'public',
        body: jsonBody(
          { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
          { email: 'admin@homeops.in', password: 'SuperSecret123' },
        ),
        responses: {
          200: ok('Signed in', session, {
            ...sessionExample,
            user: { ...sessionExample.user, name: 'Nisha Kapoor', phone: null, email: 'admin@homeops.in', role: 'ADMIN', isOnboarded: true },
          }),
        },
        errors: [401, 403],
      }),
    },
    '/auth/refresh': {
      post: op({
        tag: TAG,
        summary: 'Exchange a refresh token for a new token pair',
        description: 'Returns **401** if the refresh token is invalid or expired, or the account is no longer active.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }, { refreshToken: examples.tokens.refreshToken }),
        responses: { 200: ok('New tokens', ref('AuthTokens'), examples.tokens) },
        errors: [401],
      }),
    },
    '/auth/me': {
      get: op({
        tag: TAG,
        summary: 'Get the signed-in user',
        description: 'The user record plus their professional profile, if they have one.',
        responses: {
          200: ok('The user', {
            allOf: [ref('User'), { type: 'object', properties: { professional: { allOf: [ref('Professional')], nullable: true } } }],
          }),
        },
        errors: [404],
      }),
    },
  },
};
