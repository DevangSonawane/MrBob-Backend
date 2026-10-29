const { ref, ok, jsonBody, pathParam, op } = require('../helpers');
const { examples } = require('../components');

const TAG = 'Auth';
const SESSION = 'Sign-in & tokens (both apps)';
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
        'Email + password sign-in for the admin dashboard, token refresh, and a generic phone + OTP sign-in. The apps sign in through ' +
        'their own onboarding sections instead (**Customer onboarding** and **Vendor onboarding**, steps 1 and 2). Every sign-in ' +
        'returns an access token (15 min) and a refresh token (30 days).',
    },
  ],
  paths: {
    '/users/me/devices': {
      post: op({
        tag: SESSION,
        summary: 'Register this device for push notifications',
        description:
          'Call right after signing in, and again on every app start and whenever Firebase gives the app a new token ' +
          '(`onTokenRefresh` / `onNewToken`). `token` is the Firebase Cloud Messaging registration token.\n\n' +
          'The device belongs to this sign-in: signing out (`POST /auth/logout`), or the account being deactivated or deleted, removes it. ' +
          'A token already registered — another account signed in on the same phone — moves to the caller. The 10 most recently seen devices are kept.\n\n' +
          '**What arrives:** a notification (`title`, `body`) plus `data` with string values. `data.type` says what it is about and which id comes with it:\n\n' +
          '| `type` | Sent to | Also in `data` |\n|---|---|---|\n' +
          '| `JOB_OFFER` | Vendor: a job near you (accept within the offer time) | `bookingId` |\n' +
          '| `BOOKING` | Customer or vendor: assigned, started, completed, cancelled, rescheduled, refunded | `bookingId`, `status` |\n' +
          '| `VENDOR_ONBOARDING` | Vendor: approved, rejected, changes needed | `status` |\n' +
          '| `PAYOUT` | Vendor: money sent | `payoutId` |\n' +
          '| `DISPUTE` | Whoever raised it: a reply, resolved, closed | `disputeId`, `status` |',
        body: jsonBody(
          {
            type: 'object',
            required: ['token', 'platform'],
            properties: { token: { type: 'string', minLength: 20, description: 'FCM registration token' }, platform: { type: 'string', enum: ['ANDROID', 'IOS', 'WEB'] } },
          },
          { token: 'fGx2Lp0kTqeY3dW7:APA91bH4m...', platform: 'ANDROID' },
        ),
        responses: {
          201: ok(
            'Registered',
            { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, platform: { type: 'string', enum: ['ANDROID', 'IOS', 'WEB'] }, registeredAt: { type: 'string', format: 'date-time' }, lastSeenAt: { type: 'string', format: 'date-time' } } },
            { id: '1a2b3c4d-6666-4e5f-8a9b-0c1d2e3f4a5b', platform: 'ANDROID', registeredAt: '2026-10-30T09:30:00.000Z', lastSeenAt: '2026-10-30T09:30:00.000Z' },
          ),
        },
      }),
    },
    '/users/me/devices/{token}': {
      delete: op({
        tag: SESSION,
        summary: 'Stop push notifications on this device',
        description: 'For a "notifications off" switch. Signing out already does this. `token` must be URL-encoded. **404** if this account has no such device.',
        params: [pathParam('token', 'The FCM registration token, URL-encoded', { type: 'string' })],
        responses: { 200: ok('Removed', { type: 'object', properties: { removed: { type: 'boolean', example: true } } }, { removed: true }) },
        errors: [404],
      }),
    },
    '/auth/otp/request': {
      post: op({
        tag: TAG,
        summary: 'Send a login OTP',
        description:
          'Generates a 4-digit code valid for 5 minutes (5 wrong attempts discard it). In development without a WhatsApp token, the code is written to the server log. ' +
          'If the server has `OTP_STATIC_CODE` set (no SMS provider yet), the code is always that fixed value — and admin accounts are ' +
          'refused here (**403**), because a shared code proves nothing about who is signing in. They use email + password.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['phone'], properties: { phone } }, { phone: '+919812345678' }),
        responses: { 200: ok('OTP sent', { type: 'object', properties: { sent: { type: 'boolean' } } }, { sent: true }) },
        errors: [403],
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
              otp: { type: 'string', pattern: '^\\d{4}$', example: '4829' },
              name: { type: 'string', minLength: 2, description: 'Used as the display name when the account is created' },
            },
          },
          { phone: '+919812345678', otp: '4829', name: 'Aarav Mehta' },
        ),
        responses: { 200: ok('Signed in', session, sessionExample) },
        errors: [403],
      }),
    },
    '/auth/vendor-login': {
      post: op({
        tag: [SESSION, TAG],
        summary: 'Vendor sign-in for the web dashboard',
        description:
          'Request the code with `POST /auth/otp/request` first. Unlike **Verify the OTP and sign in**, this never creates an account: the ' +
          'number must already belong to a vendor (otherwise **403**). Returns **400** for a wrong or expired code.',
        access: 'public',
        body: jsonBody(
          { type: 'object', required: ['phone', 'otp'], properties: { phone, otp: { type: 'string', pattern: '^\\d{4}$', example: '4829' } } },
          { phone: '+919812345678', otp: '4829' },
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
        tag: [SESSION, TAG],
        summary: 'Get a new access token',
        description:
          'Call this when a request fails with **401** and `details.code` `TOKEN_EXPIRED` (or a little before `accessTokenExpiresIn` runs out), ' +
          'then retry the request with the new access token. The refresh token stays the same and is extended for another 30 days, so a ' +
          'device in regular use stays signed in.\n\n' +
          'Returns **401** with `details.code` `SESSION_EXPIRED` when the refresh token was not used for 30 days, the device signed out, or the ' +
          'account was deactivated or deleted — send the user to sign in again. Refresh tokens issued before 21 Oct 2026 still work once.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }, { refreshToken: examples.tokens.refreshToken }),
        responses: { 200: ok('A new access token (and the same refresh token)', ref('AuthTokens'), examples.tokens) },
        errors: [401],
      }),
    },
    '/auth/logout': {
      post: op({
        tag: [SESSION, TAG],
        summary: 'Sign this device out',
        description:
          'The refresh token stops working, and the push notification devices registered with this sign-in are removed. The current access token ' +
          'still works until it expires (at most `accessTokenExpiresIn`). Always succeeds.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }, { refreshToken: examples.tokens.refreshToken }),
        responses: { 200: ok('Signed out', { type: 'object', properties: { signedOut: { type: 'boolean' } } }, { signedOut: true }) },
      }),
    },
    '/auth/me': {
      get: op({
        tag: [SESSION, TAG],
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
