const { ref, arrayOf, ok, fileResponse, jsonBody, multipartBody, pathParam, requiredWhenStrict, op } = require('../helpers');
const { examples } = require('../components');

// One tag per step of the customer journey, then one for managing the account afterwards.
const STEP_1 = 'Customer onboarding · Step 1 – Phone number';
const STEP_2 = 'Customer onboarding · Step 2 – Verify OTP';
const STEP_3 = 'Customer onboarding · Step 3 – Name & gender';
const STEP_4 = 'Customer onboarding · Step 4 – Address';
const ACCOUNT = 'My account';

const phone = { type: 'string', pattern: '^\\+?[1-9]\\d{9,14}$', example: '+919812345678', description: 'E.164 format' };
const otp = { type: 'string', pattern: '^\\d{4}$', example: '1234' };
const gender = { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] };
const onboarding = ref('CustomerOnboarding');
const profile = ref('UserProfile');
const addressId = pathParam('addressId', 'Address id');

const addressProperties = {
  label: { type: 'string', enum: ['HOME', 'WORK', 'OTHER'], default: 'HOME' },
  line1: { type: 'string', minLength: 5, maxLength: 200, description: 'House / flat number and street' },
  line2: { type: 'string', maxLength: 200, nullable: true, description: 'Area or locality' },
  landmark: { type: 'string', maxLength: 120, nullable: true },
  cityId: { type: 'string', format: 'uuid', description: 'From GET /zones/cities' },
  zoneId: { type: 'string', format: 'uuid', nullable: true, description: 'From GET /zones?cityId=…; must be in that city' },
  state: { type: 'string', minLength: 2, maxLength: 60 },
  pincode: { type: 'string', pattern: '^[1-9]\\d{5}$' },
  latitude: { type: 'number', minimum: -90, maximum: 90, nullable: true, description: 'Send with longitude, or leave both out' },
  longitude: { type: 'number', minimum: -180, maximum: 180, nullable: true },
  contactName: { type: 'string', maxLength: 100, nullable: true, description: 'Who to ask for, if not the account holder' },
  contactPhone: { ...phone, nullable: true },
  isDefault: { type: 'boolean', description: 'Make this the default address' },
};
const addressRequired = ['line1', 'cityId', 'state', 'pincode'];
const addressBodyExample = {
  label: 'HOME',
  line1: '12, 4th Cross, 5th Block',
  line2: 'Koramangala',
  landmark: 'Near Forum Mall',
  cityId: examples.address.city.id,
  zoneId: examples.address.zone.id,
  state: 'Karnataka',
  pincode: '560034',
  latitude: 12.9352,
  longitude: 77.6245,
};

module.exports = {
  tags: [
    { name: STEP_1, description: 'The customer enters their mobile number and receives a one-time code.' },
    { name: STEP_2, description: 'The customer enters the code. This signs them in and tells the app which step comes next.' },
    { name: STEP_3, description: 'The customer gives their name and gender.' },
    { name: STEP_4, description: 'The customer adds their first address. Saving it completes onboarding.' },
    {
      name: ACCOUNT,
      description:
        'What a signed-in user can do with their own account after onboarding: view and edit the profile, change the photo or phone number, ' +
        'manage saved addresses, and delete the account.',
    },
  ],

  paths: {
    '/customer-onboarding/otp/request': {
      post: op({
        tag: STEP_1,
        summary: 'Send an OTP to the customer\'s phone',
        description:
          'Generates a 4-digit code valid for 5 minutes. Requesting again replaces the previous code.\n\n' +
          '**While no SMS provider is connected:** if the server has `OTP_STATIC_CODE` set, the code is always that fixed value.\n\n' +
          'Returns **403** if the number is registered as a vendor or an admin, or the account is deactivated.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['phone'], properties: { phone } }, { phone: '+919812345678' }),
        responses: {
          200: ok('OTP sent', { type: 'object', properties: { sent: { type: 'boolean' }, expiresInSeconds: { type: 'integer' } } }, { sent: true, expiresInSeconds: 300 }),
        },
        errors: [403],
      }),
    },

    '/customer-onboarding/otp/verify': {
      post: op({
        tag: STEP_2,
        summary: 'Verify the OTP and sign the customer in',
        description:
          'Creates the account the first time a number is used (`isNewUser: true`). Returns the tokens together with the customer\'s onboarding ' +
          'state, so the app can route on `nextStep`: `profile` (step 3), `address` (step 4), or `null` when onboarding is already complete.\n\n' +
          'A code can be used once. Returns **400** for a wrong or expired code; after 5 wrong attempts a new one must be requested.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['phone', 'otp'], properties: { phone, otp } }, { phone: '+919812345678', otp: '1234' }),
        responses: { 200: ok('Signed in', ref('CustomerSession'), { isNewUser: true, ...examples.tokens, ...examples.customerOnboarding('new') }) },
        errors: [403],
      }),
    },

    '/customer-onboarding': {
      get: op({
        tag: STEP_2,
        summary: 'Get my onboarding state',
        description: 'Where the signed-in customer is in the four steps. Call it on app launch to decide which screen to open.',
        responses: { 200: ok('Onboarding state', onboarding, examples.customerOnboarding('profile')) },
        errors: [403, 404],
      }),
    },

    '/customer-onboarding/profile': {
      put: op({
        tag: STEP_3,
        summary: 'Save name and gender',
        description:
          'No field is mandatory — send whichever of `name`, `gender`, `email` and `dateOfBirth` the customer has filled in; the rest can be added ' +
          'later from the profile screen. ' +
          'Returns **409** if the email belongs to another account.',
        body: jsonBody(
          {
            type: 'object',
            ...requiredWhenStrict(['name', 'gender']),
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              gender,
              email: { type: 'string', format: 'email', nullable: true },
              dateOfBirth: { type: 'string', format: 'date', nullable: true },
            },
          },
          { name: 'Aarav Mehta', gender: 'MALE' },
        ),
        responses: { 200: ok('Saved — next is the address', onboarding, examples.customerOnboarding('profile')) },
        errors: [403, 409],
      }),
    },

    '/customer-onboarding/address': {
      put: op({
        tag: STEP_4,
        summary: 'Save the first address',
        description:
          'Saves the customer\'s default address and, once name and gender are also in, sets `isOnboarded` to true. Calling it again updates ' +
          'that same address. More addresses are added later through **My account**.\n\n' +
          'No field is mandatory. Get `cityId` from `GET /zones/cities`.',
        body: jsonBody({ type: 'object', ...requiredWhenStrict(addressRequired), properties: addressProperties }, addressBodyExample),
        responses: { 200: ok('Saved — onboarding complete', onboarding, examples.customerOnboarding('done')) },
        errors: [403],
      }),
    },

    '/users/me': {
      get: op({
        tag: ACCOUNT,
        summary: 'Get my profile',
        description: 'The signed-in user with their city, saved addresses (default first) and, for vendors, their onboarding status.',
        responses: { 200: ok('The profile', profile, examples.me()) },
        errors: [404],
      }),
      patch: op({
        tag: ACCOUNT,
        summary: 'Edit my profile',
        description:
          'Send only the fields that change. The phone number is changed through the phone endpoints below, and addresses through the address ' +
          'endpoints. Returns **409** if the email belongs to another account.',
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              gender,
              email: { type: 'string', format: 'email' },
              dateOfBirth: { type: 'string', format: 'date', nullable: true, description: 'Send null to clear it' },
            },
          },
          { name: 'Aarav Mehta', email: 'aarav@example.com', dateOfBirth: '1994-03-21' },
        ),
        responses: { 200: ok('Updated profile', profile, examples.me()) },
        errors: [404, 409],
      }),
      delete: op({
        tag: ACCOUNT,
        summary: 'Delete my account',
        description:
          'Permanent. The account can no longer sign in, and its personal details are wiped: name, phone, email, photo and all saved ' +
          'addresses. Open booking requests are cancelled and active AMC plans are ended. Past bookings and reviews are kept without the ' +
          'personal details. The phone number becomes free to register again as a new account.\n\n' +
          'Returns **409** while a booking is assigned or in progress, and **403** for admin accounts (a super admin removes those).',
        responses: { 200: ok('Account deleted', { type: 'object', properties: { deleted: { type: 'boolean' } } }, { deleted: true }) },
        errors: [403, 404, 409],
      }),
    },

    '/users/me/photo': {
      put: op({
        tag: ACCOUNT,
        summary: 'Upload or replace my profile photo',
        description: 'JPEG, PNG or WebP, up to 5 MB. Fetch it back from the `profilePhoto` path in the profile.',
        body: multipartBody({ type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } }),
        responses: { 200: ok('Updated profile', profile, { ...examples.me(), profilePhoto: `/users/${examples.customerUser().id}/photo` }) },
        errors: [404, 503],
      }),
      delete: op({
        tag: ACCOUNT,
        summary: 'Remove my profile photo',
        responses: { 200: ok('Updated profile', profile, examples.me()) },
        errors: [404],
      }),
    },

    '/users/{id}/photo': {
      get: op({
        tag: [ACCOUNT, 'Users'],
        summary: 'Get a user\'s profile photo',
        description: 'A user can fetch their own photo; admins can fetch anyone\'s. Otherwise **403**. **404** when there is no photo.',
        params: [pathParam('id', 'User id')],
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [403, 404],
      }),
    },

    '/users/me/phone/request': {
      post: op({
        tag: ACCOUNT,
        summary: 'Change my phone number — step 1: send an OTP to the new number',
        description: 'Returns **409** if the new number is already used by another account.',
        body: jsonBody({ type: 'object', required: ['phone'], properties: { phone } }, { phone: '+919898989898' }),
        responses: {
          200: ok('OTP sent to the new number', { type: 'object', properties: { sent: { type: 'boolean' }, expiresInSeconds: { type: 'integer' } } }, { sent: true, expiresInSeconds: 300 }),
        },
        errors: [404, 409],
      }),
    },

    '/users/me/phone/verify': {
      post: op({
        tag: ACCOUNT,
        summary: 'Change my phone number — step 2: confirm with the OTP',
        description: 'On success the new number replaces the old one and is what the user signs in with from now on. Existing tokens stay valid.',
        body: jsonBody({ type: 'object', required: ['phone', 'otp'], properties: { phone, otp } }, { phone: '+919898989898', otp: '1234' }),
        responses: { 200: ok('Updated profile', profile, { ...examples.me(), phone: '+919898989898' }) },
        errors: [404, 409],
      }),
    },

    '/users/me/addresses': {
      get: op({
        tag: ACCOUNT,
        summary: 'List my addresses',
        responses: { 200: ok('Saved addresses, default first', arrayOf(ref('Address')), [examples.address]) },
      }),
      post: op({
        tag: ACCOUNT,
        summary: 'Add an address',
        description: 'Up to 10 addresses. The first one saved is the default; send `isDefault: true` to make a later one the default.',
        body: jsonBody({ type: 'object', required: addressRequired, properties: addressProperties }, { ...addressBodyExample, label: 'WORK', isDefault: false }),
        responses: { 201: ok('Address created', ref('Address'), { ...examples.address, label: 'WORK', isDefault: false }) },
      }),
    },

    '/users/me/addresses/{addressId}': {
      patch: op({
        tag: ACCOUNT,
        summary: 'Edit an address',
        description: 'Send only the fields that change. Changing the city clears the zone unless a new one is sent.',
        params: [addressId],
        body: jsonBody({ type: 'object', minProperties: 1, properties: addressProperties }, { line2: 'HSR Layout', pincode: '560102' }),
        responses: { 200: ok('Updated address', ref('Address'), { ...examples.address, line2: 'HSR Layout', pincode: '560102' }) },
        errors: [404],
      }),
      delete: op({
        tag: ACCOUNT,
        summary: 'Delete an address',
        description: 'If it was the default, the most recently added remaining address becomes the default. Returns the remaining addresses.',
        params: [addressId],
        responses: { 200: ok('Remaining addresses', arrayOf(ref('Address')), []) },
        errors: [404],
      }),
    },

    '/users/me/addresses/{addressId}/default': {
      post: op({
        tag: ACCOUNT,
        summary: 'Make an address the default',
        params: [addressId],
        responses: { 200: ok('Updated address', ref('Address'), examples.address) },
        errors: [404],
      }),
    },
  },
};
