const { ref, ok, jsonBody, op } = require('../helpers');

const TAG = 'Customer onboarding';

module.exports = {
  tags: [{ name: TAG, description: 'What the customer app asks after first login. Vendors use the Vendor onboarding steps instead.' }],
  paths: {
    '/onboarding/status': {
      get: op({
        tag: TAG,
        summary: 'Get my onboarding status',
        responses: {
          200: ok('Onboarding status', ref('OnboardingStatus'), { isOnboarded: false, role: 'CUSTOMER', hasProfessionalProfile: false, vendorOnboardingStatus: null }),
        },
        errors: [404],
      }),
    },
    '/onboarding/customer': {
      post: op({
        tag: TAG,
        summary: 'Complete onboarding as a customer',
        description: 'Saves the customer\'s city and optional profile details and sets `isOnboarded` to true. Returns **409** if the phone is linked to another account.',
        body: jsonBody(
          {
            type: 'object',
            required: ['cityId'],
            properties: {
              name: { type: 'string', minLength: 2 },
              phone: { type: 'string', example: '+919812345678' },
              cityId: { type: 'string', format: 'uuid', description: 'From GET /zones/cities' },
              address: { type: 'string', minLength: 5 },
            },
          },
          { name: 'Aarav Mehta', cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', address: '12, 4th Cross, Koramangala' },
        ),
        responses: { 200: ok('Updated user', ref('User')) },
        errors: [409],
      }),
    },
  },
};
