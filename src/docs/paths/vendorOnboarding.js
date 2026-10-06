const { ref, arrayOf, ok, paginated, fileResponse, jsonBody, multipartBody, pathParam, queryParam, dateParam, sortParams, pageParams, op } = require('../helpers');
const { examples, ONBOARDING_STATUSES } = require('../components');

// One tag per step of the vendor journey, so the docs read top to bottom in
// the order the vendor app calls them.
const STEP_1 = 'Vendor onboarding · Step 1 – Phone number';
const STEP_2 = 'Vendor onboarding · Step 2 – Verify OTP';
const STEP_3 = 'Vendor onboarding · Step 3 – Enter details';
const STEP_4 = 'Vendor onboarding · Step 4 – Verify vendor (admin)';
const STEP_5 = 'Vendor onboarding · Step 5 – Vendor verified';
// Everything the super admin panel needs is also listed under this tag (defined in ./users.js).
const SUPER_ADMIN = 'Super admin panel';

const application = ref('VendorApplication');
const adminApplication = ref('VendorApplicationAdmin');
const phone = { type: 'string', pattern: '^\\+?[1-9]\\d{9,14}$', example: '+919812345678', description: 'E.164 format' };
const binary = (description) => ({ type: 'string', format: 'binary', description });

const applicationId = pathParam('id', 'Application id');
const documentType = (values, description) => pathParam('type', description, { type: 'string', enum: values });
const side = pathParam('side', '`front` or `back` (only Aadhaar has a back). For `bank_account` the proof image is `front`.', { type: 'string', enum: ['front', 'back'] });

const NOT_EDITABLE = 'Returns **409** unless the application is `DRAFT` or `CHANGES_REQUESTED`.';
const reasonBody = (description, example) =>
  jsonBody(
    { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 5, maxLength: 500, description } } },
    { reason: example },
  );

const submittedEvent = examples.event('SUBMITTED', 'DRAFT', 'SUBMITTED', 'Ravi Kumar', 'PROFESSIONAL');
const verifiedEvent = (type, to = 'SUBMITTED') => examples.event('DOCUMENT_VERIFIED', 'SUBMITTED', to, 'Ops Reviewer', 'ADMIN', { documentType: type });
const fullTrail = [submittedEvent, verifiedEvent('AADHAAR'), verifiedEvent('PAN'), verifiedEvent('BANK_ACCOUNT', 'PENDING_APPROVAL')];

const underReview = examples.adminApplication('SUBMITTED', [submittedEvent]);
const pendingApproval = examples.adminApplication('PENDING_APPROVAL', fullTrail);
const approved = examples.adminApplication('APPROVED', [
  ...fullTrail,
  examples.event('APPROVED', 'PENDING_APPROVAL', 'APPROVED', 'Platform Admin', 'SUPER_ADMIN'),
]);

const changesRequested = (note, rejectedType) => {
  const base = examples.adminApplication('SUBMITTED', [
    submittedEvent,
    examples.event(rejectedType ? 'DOCUMENT_REJECTED' : 'CHANGES_REQUESTED', 'SUBMITTED', 'CHANGES_REQUESTED', 'Ops Reviewer', 'ADMIN', {
      documentType: rejectedType ?? null,
      note,
    }),
  ]);
  return {
    ...base,
    status: 'CHANGES_REQUESTED',
    flow: { ...examples.flow(3), steps: examples.flow(3).steps.map((step) => (step.step === 3 ? { ...step, status: 'ACTION_REQUIRED' } : step)) },
    isEditable: true,
    reviewNote: rejectedType ? null : note,
    nextStep: rejectedType ? rejectedType.toLowerCase() : 'submit',
    canSubmit: !rejectedType,
    documents: base.documents.map((doc) => (doc.type === rejectedType ? { ...doc, status: 'REJECTED', rejectionReason: note } : doc)),
  };
};

module.exports = {
  tags: [
    { name: STEP_1, description: 'The vendor enters their mobile number and receives a one-time code.' },
    { name: STEP_2, description: 'The vendor enters the code. This signs them in and opens (or resumes) their application.' },
    {
      name: STEP_3,
      description:
        'The vendor fills in six parts — personal details, profile photo, services, Aadhaar, PAN and bank account — in any order, then submits. ' +
        'Every save returns the whole application, including `detailSteps` and `nextStep`, so the app always knows what is left.',
    },
    {
      name: STEP_4,
      description:
        'Two stages. **Any admin** checks the Aadhaar, PAN and bank account (this is where a verification API will plug in later); once all three are ' +
        'verified the application becomes `PENDING_APPROVAL`. **A super admin** then gives the final decision.',
    },
    { name: STEP_5, description: 'What the vendor app calls to learn the outcome. Once `status` is `APPROVED` the vendor can be assigned jobs.' },
  ],

  paths: {
    '/vendor-onboarding/otp/request': {
      post: op({
        tag: STEP_1,
        summary: 'Send an OTP to the vendor\'s phone',
        description:
          'Generates a 6-digit code valid for 5 minutes and sends it over WhatsApp. Requesting again replaces the previous code.\n\n' +
          'In development, when no WhatsApp token is configured, the code is written to the server log instead of being sent.\n\n' +
          '**While no SMS provider is connected:** if the server has `OTP_STATIC_CODE` set, the code is always that fixed value.\n\n' +
          'Returns **403** if the number belongs to an admin account or a deactivated account.',
        access: 'public',
        body: jsonBody({ type: 'object', required: ['phone'], properties: { phone } }, { phone: '+919812345678' }),
        responses: {
          200: ok(
            'OTP sent',
            { type: 'object', properties: { sent: { type: 'boolean' }, expiresInSeconds: { type: 'integer' } } },
            { sent: true, expiresInSeconds: 300 },
          ),
        },
        errors: [403],
      }),
    },

    '/vendor-onboarding/otp/verify': {
      post: op({
        tag: STEP_2,
        summary: 'Verify the OTP and sign the vendor in',
        description:
          'On success:\n' +
          '- creates the account if this phone number is new (`isNewUser: true`), with the role `PROFESSIONAL`;\n' +
          '- makes sure a `DRAFT` application exists;\n' +
          '- returns the access and refresh tokens **and** the application, so the app can route a returning vendor straight to where they left off ' +
          '(use `application.flow.currentStep` and `application.nextStep`).\n\n' +
          'A code can be used once. Returns **400** for a wrong or expired code.',
        access: 'public',
        body: jsonBody(
          { type: 'object', required: ['phone', 'otp'], properties: { phone, otp: { type: 'string', pattern: '^\\d{6}$', example: '123456' } } },
          { phone: '+919812345678', otp: '123456' },
        ),
        responses: {
          200: ok('Signed in', ref('VendorSession'), {
            isNewUser: true,
            user: { id: 'c7d8e9f0-5555-4a1b-9c2d-3e4f5a6b7c8d', name: 'New Vendor', phone: '+919812345678', email: null, role: 'PROFESSIONAL', isOnboarded: false },
            ...examples.tokens,
            application: examples.newApplication,
          }),
        },
        errors: [403],
      }),
    },

    '/vendor-onboarding': {
      get: op({
        tag: STEP_3,
        summary: 'Get my application',
        description: 'Everything saved so far, which parts of step 3 are complete, and where the vendor is in the five-step flow. Call this on app launch.',
        responses: { 200: ok('The application', application, examples.application('DRAFT')) },
      }),
    },

    '/vendor-onboarding/personal-details': {
      put: op({
        tag: STEP_3,
        summary: 'Save personal details',
        description:
          `Replaces this whole part — omitted optional fields are cleared. The vendor must be at least 18. ${NOT_EDITABLE}\n\n` +
          '`phone` is only accepted when the account has none (it normally comes from the OTP login and cannot be changed here). ' +
          'Get `cityId` from `GET /zones/cities`.',
        body: jsonBody(
          {
            type: 'object',
            required: ['name', 'dateOfBirth', 'gender', 'cityId', 'addressLine1', 'pincode', 'state'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100, description: 'Full name, as on the Aadhaar card' },
              dateOfBirth: { type: 'string', format: 'date', description: 'YYYY-MM-DD. Must be 18 or older.' },
              gender: { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] },
              phone: { ...phone, description: 'Only when the account has no phone number yet' },
              email: { type: 'string', format: 'email' },
              alternatePhone: { ...phone, nullable: true },
              cityId: { type: 'string', format: 'uuid' },
              addressLine1: { type: 'string', minLength: 5, maxLength: 200 },
              addressLine2: { type: 'string', maxLength: 200, nullable: true },
              landmark: { type: 'string', maxLength: 120, nullable: true },
              pincode: { type: 'string', pattern: '^[1-9]\\d{5}$' },
              state: { type: 'string', minLength: 2, maxLength: 60 },
              emergencyContactName: { type: 'string', maxLength: 100, nullable: true, description: 'Provide together with emergencyContactPhone, or neither' },
              emergencyContactPhone: { ...phone, nullable: true },
            },
          },
          {
            name: 'Ravi Kumar',
            dateOfBirth: '1990-05-14',
            gender: 'MALE',
            email: 'ravi.kumar@example.com',
            cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d',
            addressLine1: '12, 4th Cross, 5th Block',
            addressLine2: 'Koramangala',
            landmark: 'Near Forum Mall',
            pincode: '560034',
            state: 'Karnataka',
            emergencyContactName: 'Sita Kumar',
            emergencyContactPhone: '+919876543210',
          },
        ),
        responses: { 200: ok('Updated application', application, examples.application('DRAFT')) },
        errors: [403, 409],
      }),
    },

    '/vendor-onboarding/profile-photo': {
      put: op({
        tag: STEP_3,
        summary: 'Upload a profile photo',
        description:
          `A clear photo of the vendor's face. JPEG, PNG or WebP, up to 5 MB. Uploading again replaces it. ${NOT_EDITABLE}\n\n` +
          'Reviewers see it during verification; customers see it once the vendor is approved.',
        body: multipartBody({ type: 'object', required: ['photo'], properties: { photo: binary('The image file') } }),
        responses: { 200: ok('Updated application', application, examples.application('DRAFT')) },
        errors: [403, 409, 503],
      }),
      get: op({
        tag: STEP_3,
        summary: 'Download my profile photo',
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [404],
      }),
    },

    '/vendor-onboarding/services': {
      put: op({
        tag: STEP_3,
        summary: 'Save the services the vendor provides',
        description:
          `Replaces this whole part. ${NOT_EDITABLE}\n\n` +
          'Get category ids from `GET /categories` and zones from `GET /zones?cityId=…`. The home zone must be in the city chosen in personal details.',
        body: jsonBody(
          {
            type: 'object',
            required: ['categories', 'experienceYears'],
            properties: {
              categories: { ...arrayOf({ type: 'string', format: 'uuid' }), minItems: 1, maxItems: 20, description: 'Ids of active service categories' },
              experienceYears: { type: 'integer', minimum: 0, maximum: 60 },
              homeZoneId: { type: 'string', format: 'uuid', nullable: true, description: 'The zone the vendor mainly works from' },
            },
          },
          { categories: ['3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d'], experienceYears: 6, homeZoneId: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b' },
        ),
        responses: { 200: ok('Updated application', application, examples.application('DRAFT')) },
        errors: [403, 409],
      }),
    },

    '/vendor-onboarding/documents/{type}': {
      put: op({
        tag: STEP_3,
        summary: 'Upload the Aadhaar card or PAN card',
        description:
          `Send as \`multipart/form-data\`. ${NOT_EDITABLE}\n\n` +
          '| | Aadhaar | PAN |\n|---|---|---|\n' +
          '| `number` | 12 digits (spaces allowed), checksum-validated | 10 characters, e.g. `ABCPE1234F` |\n' +
          '| `front` | required | required |\n' +
          '| `back` | required | not accepted |\n\n' +
          'Files: JPEG, PNG, WebP or PDF, up to 5 MB each. When replacing a document the files may be omitted to keep the ones already uploaded.\n\n' +
          'The number is stored encrypted and is only ever returned masked. Returns **409** if the number is already registered on another ' +
          'account, or if this document has already been verified.',
        params: [documentType(['aadhaar', 'pan'], 'Which document')],
        body: multipartBody({
          type: 'object',
          required: ['number', 'nameOnDocument'],
          properties: {
            number: { type: 'string', example: '2345 6789 0124', description: 'Aadhaar number or PAN' },
            nameOnDocument: { type: 'string', example: 'Ravi Kumar', description: 'Name exactly as printed on the document' },
            front: binary('Front of the card'),
            back: binary('Back of the card (Aadhaar only)'),
          },
        }),
        responses: { 200: ok('Updated application', application, examples.application('DRAFT')) },
        errors: [403, 409, 503],
      }),
    },

    '/vendor-onboarding/bank-details': {
      put: op({
        tag: STEP_3,
        summary: 'Save the payout bank account',
        description:
          `Send as \`multipart/form-data\`. ${NOT_EDITABLE}\n\n` +
          '`proof` is a cancelled cheque or the first page of the passbook (JPEG, PNG, WebP or PDF, up to 5 MB); it may be omitted when updating to ' +
          'keep the one already uploaded.\n\n' +
          'The account number is stored encrypted and only returned masked. Returns **409** if the account is already registered by another vendor, ' +
          'or has already been verified.',
        body: multipartBody({
          type: 'object',
          required: ['accountHolderName', 'accountNumber', 'ifsc', 'bankName', 'accountType'],
          properties: {
            accountHolderName: { type: 'string', example: 'Ravi Kumar' },
            accountNumber: { type: 'string', example: '50100123456789', description: '9 to 18 digits' },
            ifsc: { type: 'string', example: 'HDFC0001234', pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' },
            bankName: { type: 'string', example: 'HDFC Bank' },
            branchName: { type: 'string', example: 'Koramangala' },
            accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT'] },
            upiId: { type: 'string', example: 'ravi@hdfcbank' },
            proof: binary('Cancelled cheque or passbook page'),
          },
        }),
        responses: { 200: ok('Updated application', application, examples.application('DRAFT')) },
        errors: [403, 409, 503],
      }),
    },

    '/vendor-onboarding/documents/{type}/files/{side}': {
      get: op({
        tag: STEP_3,
        summary: 'Download one of my uploaded documents',
        description: 'The paths in `documents[].files` and `bankDetails.proofFile` point here.',
        params: [documentType(['aadhaar', 'pan', 'bank_account'], 'Which document'), side],
        responses: { 200: fileResponse('The file, served with `Cache-Control: private, no-store`') },
        errors: [404],
      }),
    },

    '/vendor-onboarding/submit': {
      post: op({
        tag: STEP_3,
        summary: 'Submit the application for verification',
        description:
          'Finishes step 3. Every part must be complete, otherwise **400** with `details.missing` listing what is left.\n\n' +
          'The application becomes `SUBMITTED` and can no longer be edited. On a resubmission where the Aadhaar, PAN and bank account are all ' +
          'still verified, it goes straight to `PENDING_APPROVAL`.',
        responses: {
          200: ok('Submitted — now in step 4', application, examples.application('SUBMITTED')),
          400: {
            description: 'Parts of step 3 are still missing',
            content: {
              'application/json': {
                schema: ref('Error'),
                example: { success: false, message: 'Complete every step before submitting', details: { missing: ['pan', 'bankDetails'] } },
              },
            },
          },
        },
        errors: [409],
      }),
    },

    '/vendor-onboarding/applications': {
      get: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'List vendors by status (with filters)',
        description:
          'Every vendor application, filterable and sortable. All filters combine (AND).\n\n' +
          '**Common views**\n' +
          '- Waiting for the super admin\'s final decision: `status=PENDING_APPROVAL`\n' +
          '- Documents still to verify: `status=SUBMITTED`\n' +
          '- Everything in review: `status=SUBMITTED,PENDING_APPROVAL`\n' +
          '- Verified vendors: `status=APPROVED` · Rejected: `status=REJECTED` · Sent back: `status=CHANGES_REQUESTED`\n\n' +
          '**Default order** is the review queue: oldest submission first, drafts that were never submitted last.',
        access: 'ADMIN',
        params: [
          queryParam('status', `One status, or several separated by commas. One of: ${ONBOARDING_STATUSES.join(', ')}`, { type: 'string', example: 'PENDING_APPROVAL' }),
          queryParam('search', 'Matches the vendor\'s name, phone or email (case-insensitive, partial)'),
          queryParam('cityId', 'Only vendors in this city', { type: 'string', format: 'uuid' }),
          queryParam('zoneId', 'Only vendors whose home zone is this zone', { type: 'string', format: 'uuid' }),
          queryParam('categoryId', 'Only vendors who offer this service category', { type: 'string', format: 'uuid' }),
          dateParam('submittedFrom', 'Submitted on or after this date'),
          dateParam('submittedTo', 'Submitted on or before this date'),
          ...sortParams(['submittedAt', 'createdAt', 'reviewedAt', 'name'], null, 'asc'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of vendors', ref('VendorApplicationListItem')) },
      }),
    },

    '/vendor-onboarding/applications/summary': {
      get: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Vendor counts by status',
        description: 'For status tabs and badges. `awaitingFinalApproval` is the number of vendors waiting for the super admin.',
        access: 'ADMIN',
        responses: {
          200: ok('Counts', ref('VendorSummary'), {
            byStatus: { DRAFT: 12, SUBMITTED: 5, PENDING_APPROVAL: 2, CHANGES_REQUESTED: 3, APPROVED: 152, REJECTED: 4 },
            total: 178,
            awaitingDocumentVerification: 5,
            awaitingFinalApproval: 2,
          }),
        },
      }),
    },

    '/vendor-onboarding/applications/{id}': {
      get: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Get an application for review',
        description: 'Includes the unmasked Aadhaar, PAN and account numbers, who verified each one, and the full audit trail.',
        access: 'ADMIN',
        params: [applicationId],
        responses: { 200: ok('The application', adminApplication, underReview) },
        errors: [404],
      }),
    },

    '/vendor-onboarding/applications/{id}/profile-photo': {
      get: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'View the vendor\'s profile photo',
        access: 'ADMIN',
        params: [applicationId],
        responses: { 200: fileResponse('The image', ['image/jpeg', 'image/png', 'image/webp']) },
        errors: [404],
      }),
    },

    '/vendor-onboarding/applications/{id}/documents/{type}/files/{side}': {
      get: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'View an uploaded document',
        access: 'ADMIN',
        params: [applicationId, documentType(['aadhaar', 'pan', 'bank_account'], 'Which document'), side],
        responses: { 200: fileResponse('The file') },
        errors: [404],
      }),
    },

    '/vendor-onboarding/applications/{id}/documents/{type}/verify': {
      post: op({
        tag: STEP_4,
        summary: 'Mark a document or the bank account as verified',
        description:
          'The manual check that stands in for the verification API. Only while the application is `SUBMITTED`.\n\n' +
          'When the Aadhaar, PAN and bank account are all verified the application moves to `PENDING_APPROVAL`, ready for the super admin.',
        access: 'ADMIN',
        params: [applicationId, documentType(['aadhaar', 'pan', 'bank_account'], 'What to verify')],
        responses: { 200: ok('Updated application', adminApplication, pendingApproval) },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/applications/{id}/documents/{type}/reject': {
      post: op({
        tag: STEP_4,
        summary: 'Reject a document or the bank account',
        description:
          'Only while the application is `SUBMITTED`. The application goes back to the vendor as `CHANGES_REQUESTED`; they must upload that ' +
          'item again and resubmit. The reason is shown to the vendor.',
        access: 'ADMIN',
        params: [applicationId, documentType(['aadhaar', 'pan', 'bank_account'], 'What to reject')],
        body: reasonBody('Why it was rejected — shown to the vendor', 'Photo is too blurry to read'),
        responses: { 200: ok('Updated application', adminApplication, changesRequested('Photo is too blurry to read', 'PAN')) },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/applications/{id}/request-changes': {
      post: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Send an application back to the vendor',
        description:
          'From `SUBMITTED` or `PENDING_APPROVAL` to `CHANGES_REQUESTED`. Use it when something other than a single document needs fixing ' +
          '(wrong address, unclear photo…).\n\n' +
          'List items in `documents` to force them to be uploaded again — they are marked rejected even if they had been verified. ' +
          'Anything not listed keeps its status.',
        access: 'ADMIN',
        params: [applicationId],
        body: jsonBody(
          {
            type: 'object',
            required: ['reason'],
            properties: {
              reason: { type: 'string', minLength: 5, maxLength: 500, description: 'Shown to the vendor' },
              documents: { ...arrayOf({ type: 'string', enum: ['AADHAAR', 'PAN', 'BANK_ACCOUNT'] }), default: [] },
            },
          },
          { reason: 'Please add your full address', documents: [] },
        ),
        responses: { 200: ok('Updated application', adminApplication, changesRequested('Please add your full address')) },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/applications/{id}/approve': {
      post: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Approve the vendor (final step)',
        description:
          'Only from `PENDING_APPROVAL` — i.e. after the Aadhaar, PAN and bank account are verified.\n\n' +
          'The vendor becomes `APPROVED`: their `kycStatus` is set to `VERIFIED` (which is what dispatch checks before assigning jobs), ' +
          '`isOnboarded` becomes true, and they are notified. This takes the vendor to step 5.',
        access: 'SUPER_ADMIN',
        params: [applicationId],
        responses: { 200: ok('Approved', adminApplication, approved) },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/applications/{id}/reject': {
      post: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Reject the vendor',
        description: 'From `SUBMITTED` or `PENDING_APPROVAL`. The vendor can no longer edit or resubmit unless a super admin reopens the application.',
        access: 'SUPER_ADMIN',
        params: [applicationId],
        body: reasonBody('Why the application was rejected — shown to the vendor', 'Documents do not match the applicant'),
        responses: {
          200: ok('Rejected', adminApplication, {
            ...underReview,
            status: 'REJECTED',
            reviewNote: 'Documents do not match the applicant',
            reviewedAt: '2026-10-06T12:00:00.000Z',
            reviewedBy: { id: 'f0e1d2c3-6666-4b5a-8d7c-6e5f4a3b2c1d', name: 'Platform Admin' },
            flow: { ...examples.flow(4), steps: examples.flow(4).steps.map((step) => (step.step === 4 ? { ...step, status: 'REJECTED' } : step)) },
            events: [
              submittedEvent,
              examples.event('REJECTED', 'SUBMITTED', 'REJECTED', 'Platform Admin', 'SUPER_ADMIN', { note: 'Documents do not match the applicant' }),
            ],
          }),
        },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/applications/{id}/reopen': {
      post: op({
        tag: [STEP_4, SUPER_ADMIN],
        summary: 'Reopen a rejected application',
        description:
          'From `REJECTED` to `CHANGES_REQUESTED`. Everything the vendor submitted is kept and documents keep their current status, ' +
          'so the vendor can fix what was wrong and resubmit.',
        access: 'SUPER_ADMIN',
        params: [applicationId],
        body: reasonBody('Why it is being reopened — shown to the vendor', 'Vendor sent clearer documents'),
        responses: { 200: ok('Reopened', adminApplication, changesRequested('Vendor sent clearer documents')) },
        errors: [404, 409],
      }),
    },

    '/vendor-onboarding/status': {
      get: op({
        tag: STEP_5,
        summary: 'Check my verification status',
        description:
          'A small payload for the "verification in progress" screen to poll, and for the app to confirm the vendor is verified.\n\n' +
          '| `status` | What to show |\n|---|---|\n' +
          '| `SUBMITTED`, `PENDING_APPROVAL` | Verification in progress (step 4) |\n' +
          '| `CHANGES_REQUESTED` | Back to step 3 — show `reviewNote` and any rejected document |\n' +
          '| `APPROVED` | Verified (step 5) — `flow.isVerified` is true |\n' +
          '| `REJECTED` | Not approved — show `reviewNote` |',
        responses: {
          200: ok('Current status', ref('VendorStatus'), {
            id: examples.APPLICATION_ID,
            status: 'APPROVED',
            flow: examples.flow(5),
            reviewNote: null,
            submittedAt: '2026-10-06T10:15:00.000Z',
            reviewedAt: '2026-10-06T12:00:00.000Z',
          }),
        },
      }),
    },
  },
};
