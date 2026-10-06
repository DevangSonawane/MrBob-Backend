const { ref, arrayOf, ok, paginated, fileResponse, jsonBody, pathParam, queryParam, pageParams, op } = require('../helpers');
const { KYC_STATUSES } = require('../components');

const TAG = 'Professionals';
const professionalId = pathParam('id', 'Professional id (the same id as their vendor onboarding application)');

module.exports = {
  tags: [
    {
      name: TAG,
      description: 'Professional (vendor) profiles. A profile is created and verified through the Vendor onboarding steps, not here.',
    },
  ],
  paths: {
    '/professionals': {
      get: op({
        tag: TAG,
        summary: 'List professionals',
        access: 'ADMIN',
        params: [
          queryParam('kycStatus', 'Only professionals with this verification status', { type: 'string', enum: KYC_STATUSES }),
          queryParam('category', 'Only professionals serving this service category id', { type: 'string', format: 'uuid' }),
          queryParam('zoneId', 'Only professionals whose home zone is this zone', { type: 'string', format: 'uuid' }),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of professionals, newest first', ref('ProfessionalListItem')) },
      }),
    },
    '/professionals/me': {
      get: op({
        tag: TAG,
        summary: 'Get my professional profile',
        access: 'PROFESSIONAL',
        responses: { 200: ok('The profile', ref('Professional')) },
        errors: [404],
      }),
      patch: op({
        tag: TAG,
        summary: 'Update my services or home zone',
        description: 'Send at least one field.',
        access: 'PROFESSIONAL',
        body: jsonBody(
          {
            type: 'object',
            properties: { categories: { ...arrayOf({ type: 'string' }), minItems: 1, description: 'Service category ids' }, homeZoneId: { type: 'string', format: 'uuid' } },
          },
          { categories: ['3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d'] },
        ),
        responses: { 200: ok('Updated profile', ref('Professional')) },
        errors: [404],
      }),
    },
    '/professionals/{id}': {
      get: op({
        tag: TAG,
        summary: 'Get a professional',
        description: 'Admins and the professional themselves receive the full record; everyone else receives the public profile only.',
        params: [professionalId],
        responses: { 200: ok('The professional', { oneOf: [ref('ProfessionalPublic'), ref('ProfessionalWithUser')] }) },
        errors: [404],
      }),
    },
    '/professionals/{id}/photo': {
      get: op({
        tag: TAG,
        summary: 'Get a professional\'s profile photo',
        description: 'Available to any signed-in user once the professional is approved; before that, only to admins and the professional themselves (otherwise **404**).',
        params: [professionalId],
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [404],
      }),
    },
  },
};
