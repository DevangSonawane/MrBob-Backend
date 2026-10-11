const { ref, ok, op } = require('../helpers');

module.exports = {
  tags: [],
  paths: {
    '/onboarding/status': {
      get: op({
        tag: 'Auth',
        summary: 'Is my account set up?',
        description:
          'A role-agnostic check for any signed-in user. The onboarding itself is under **Customer onboarding** and **Vendor onboarding**, ' +
          'which also return a detailed step-by-step state.',
        responses: {
          200: ok('Onboarding status', ref('OnboardingStatus'), { isOnboarded: false, role: 'CUSTOMER', hasProfessionalProfile: false, vendorOnboardingStatus: null }),
        },
        errors: [404],
      }),
    },
  },
};
