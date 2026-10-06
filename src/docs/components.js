const { ref, arrayOf, UUID } = require('./helpers');

// Shared building blocks -----------------------------------------------------

const str = (example, extra = {}) => ({ type: 'string', ...(example !== undefined && { example }), ...extra });
const nullable = (schema) => ({ ...schema, nullable: true });
const id = (example = '5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e') => ({ ...UUID, example });
const dateTime = (example = '2026-10-06T09:30:00.000Z') => ({ type: 'string', format: 'date-time', example });
const money = (example) => str(example, { description: 'Decimal amount in INR, serialised as a string' });
const oneOf = (values, example) => ({ type: 'string', enum: values, ...(example && { example }) });
const object = (properties, required) => ({ type: 'object', ...(required && { required }), properties });

const ROLES = ['CUSTOMER', 'PROFESSIONAL', 'ADMIN', 'SUPER_ADMIN'];
const KYC_STATUSES = ['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED'];
const BOOKING_STATUSES = ['PENDING', 'MATCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const ONBOARDING_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];
const DOCUMENT_STATUSES = ['NOT_UPLOADED', 'PENDING', 'VERIFIED', 'REJECTED'];

const errorResponse = (description, message, details) => ({
  description,
  content: {
    'application/json': {
      schema: ref('Error'),
      example: { success: false, message, ...(details && { details }) },
    },
  },
});

// Examples reused across the vendor onboarding docs --------------------------

const flowExample = (current) => {
  const status = (step) => (step < current ? 'COMPLETE' : step === current ? 'CURRENT' : 'PENDING');
  return {
    currentStep: current,
    isVerified: current === 5,
    steps: [
      { step: 1, key: 'PHONE_NUMBER', title: 'Phone number', status: 'COMPLETE' },
      { step: 2, key: 'VERIFY_OTP', title: 'Verify OTP', status: 'COMPLETE' },
      { step: 3, key: 'ENTER_DETAILS', title: 'Enter details', status: current === 5 ? 'COMPLETE' : status(3) },
      { step: 4, key: 'VERIFY_VENDOR', title: 'Verification', status: current === 5 ? 'COMPLETE' : status(4) },
      { step: 5, key: 'VERIFIED', title: 'Verified', status: current === 5 ? 'COMPLETE' : 'PENDING' },
    ],
  };
};

const APPLICATION_ID = '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const newApplicationExample = {
  id: APPLICATION_ID,
  status: 'DRAFT',
  flow: flowExample(3),
  isEditable: true,
  detailSteps: ['personalDetails', 'profilePhoto', 'services', 'aadhaar', 'pan', 'bankDetails'].map((key) => ({ key, complete: false })),
  nextStep: 'personalDetails',
  canSubmit: false,
  reviewNote: null,
  submittedAt: null,
  reviewedAt: null,
  profilePhoto: null,
  personalDetails: {
    name: 'New Vendor', phone: '+919812345678', email: null, dateOfBirth: null, gender: null, alternatePhone: null, city: null,
    addressLine1: null, addressLine2: null, landmark: null, pincode: null, state: null, emergencyContactName: null, emergencyContactPhone: null,
  },
  services: { categories: [], experienceYears: null, homeZone: null },
  documents: [{ type: 'AADHAAR', status: 'NOT_UPLOADED' }, { type: 'PAN', status: 'NOT_UPLOADED' }],
  bankDetails: { status: 'NOT_UPLOADED' },
};

const filledApplication = (status, overrides = {}) => {
  const current = status === 'APPROVED' ? 5 : ['SUBMITTED', 'PENDING_APPROVAL'].includes(status) ? 4 : 3;
  const documentStatus = ['PENDING_APPROVAL', 'APPROVED'].includes(status) ? 'VERIFIED' : 'PENDING';
  const verifiedAt = documentStatus === 'VERIFIED' ? '2026-10-06T11:05:00.000Z' : null;
  return {
    id: APPLICATION_ID,
    status,
    flow: flowExample(current),
    isEditable: status === 'DRAFT',
    detailSteps: ['personalDetails', 'profilePhoto', 'services', 'aadhaar', 'pan', 'bankDetails'].map((key) => ({ key, complete: true })),
    nextStep: status === 'DRAFT' ? 'submit' : null,
    canSubmit: status === 'DRAFT',
    reviewNote: null,
    submittedAt: status === 'DRAFT' ? null : '2026-10-06T10:15:00.000Z',
    reviewedAt: status === 'APPROVED' ? '2026-10-06T12:00:00.000Z' : null,
    profilePhoto: '/vendor-onboarding/profile-photo',
    personalDetails: {
      name: 'Ravi Kumar', phone: '+919812345678', email: 'ravi.kumar@example.com', dateOfBirth: '1990-05-14', gender: 'MALE',
      alternatePhone: null, city: { id: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Bengaluru' },
      addressLine1: '12, 4th Cross, 5th Block', addressLine2: 'Koramangala', landmark: 'Near Forum Mall', pincode: '560034', state: 'Karnataka',
      emergencyContactName: 'Sita Kumar', emergencyContactPhone: '+919876543210',
    },
    services: {
      categories: [{ id: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', name: 'Electrician', tier: 'REPAIR' }],
      experienceYears: 6,
      homeZone: { id: '7a6b5c4d-3333-4e2f-9a1b-0c9d8e7f6a5b', name: 'Koramangala' },
    },
    documents: [
      {
        type: 'AADHAAR', status: documentStatus, maskedNumber: 'XXXX XXXX 0124', nameOnDocument: 'Ravi Kumar', rejectionReason: null, verifiedAt,
        files: { front: '/vendor-onboarding/documents/aadhaar/files/front', back: '/vendor-onboarding/documents/aadhaar/files/back' },
        uploadedAt: '2026-10-06T10:05:00.000Z',
      },
      {
        type: 'PAN', status: documentStatus, maskedNumber: 'XXXXXX234F', nameOnDocument: 'Ravi Kumar', rejectionReason: null, verifiedAt,
        files: { front: '/vendor-onboarding/documents/pan/files/front', back: null },
        uploadedAt: '2026-10-06T10:08:00.000Z',
      },
    ],
    bankDetails: {
      status: documentStatus, accountHolderName: 'Ravi Kumar', maskedAccountNumber: 'XXXXXX6789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank',
      branchName: 'Koramangala', accountType: 'SAVINGS', upiId: 'ravi@hdfcbank', rejectionReason: null, verifiedAt,
      proofFile: '/vendor-onboarding/documents/bank_account/files/front', uploadedAt: '2026-10-06T10:12:00.000Z',
    },
    ...overrides,
  };
};

const adminApplicationExample = (status, events) => {
  const base = filledApplication(status);
  const prefix = `/vendor-onboarding/applications/${APPLICATION_ID}`;
  const reviewer = { id: 'a1b2c3d4-4444-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ops Reviewer' };
  const verified = base.documents[0].status === 'VERIFIED';
  const verification = { verificationSource: verified ? 'MANUAL' : null, verificationRef: null, verifiedBy: verified ? reviewer : null };
  return {
    ...base,
    profilePhoto: `${prefix}/profile-photo`,
    documents: base.documents.map((doc) => ({
      ...doc,
      number: doc.type === 'AADHAAR' ? '234567890124' : 'ABCPE1234F',
      ...verification,
      files: { front: `${prefix}/documents/${doc.type.toLowerCase()}/files/front`, back: doc.files.back && `${prefix}/documents/aadhaar/files/back` },
    })),
    bankDetails: { ...base.bankDetails, accountNumber: '50100123456789', ...verification, proofFile: `${prefix}/documents/bank_account/files/front` },
    user: { id: 'c7d8e9f0-5555-4a1b-9c2d-3e4f5a6b7c8d', isActive: true },
    reviewedBy: status === 'APPROVED' ? { id: 'f0e1d2c3-6666-4b5a-8d7c-6e5f4a3b2c1d', name: 'Platform Admin' } : null,
    events,
  };
};

const event = (action, fromStatus, toStatus, actorName, actorRole, extra = {}) => ({
  id: '1a2b3c4d-7777-4e5f-9a0b-1c2d3e4f5a6b',
  action,
  documentType: null,
  fromStatus,
  toStatus,
  note: null,
  createdAt: '2026-10-06T10:15:00.000Z',
  actor: { id: 'a1b2c3d4-4444-4e5f-8a9b-0c1d2e3f4a5b', name: actorName, role: actorRole },
  ...extra,
});

const examples = {
  APPLICATION_ID,
  flow: flowExample,
  newApplication: newApplicationExample,
  application: filledApplication,
  adminApplication: adminApplicationExample,
  event,
  tokens: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI…',
    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoi…',
  },
};

// Schemas --------------------------------------------------------------------

const userSummary = object({ id: id(), name: str('Ravi Kumar'), phone: nullable(str('+919812345678')) });

const professionalFields = {
  id: id(),
  userId: id(),
  categories: { ...arrayOf(UUID), description: 'Ids of the service categories this professional serves' },
  kycStatus: oneOf(KYC_STATUSES, 'VERIFIED'),
  rating: str('4.80', { description: 'Average review rating (0–5), serialised as a string' }),
  homeZoneId: nullable(id()),
  onboardingStatus: oneOf(ONBOARDING_STATUSES, 'APPROVED'),
  dateOfBirth: nullable(dateTime('1990-05-14T00:00:00.000Z')),
  gender: nullable(oneOf(['MALE', 'FEMALE', 'OTHER'], 'MALE')),
  alternatePhone: nullable(str()),
  addressLine1: nullable(str('12, 4th Cross, 5th Block')),
  addressLine2: nullable(str('Koramangala')),
  landmark: nullable(str()),
  pincode: nullable(str('560034')),
  state: nullable(str('Karnataka')),
  emergencyContactName: nullable(str()),
  emergencyContactPhone: nullable(str()),
  experienceYears: nullable({ type: 'integer', example: 6 }),
  profilePhotoKey: nullable(str(undefined, { description: 'Internal storage key — fetch the image from the photo endpoints instead' })),
  profilePhotoMime: nullable(str('image/jpeg')),
  submittedAt: nullable(dateTime()),
  reviewedAt: nullable(dateTime()),
  reviewedById: nullable(id()),
  reviewNote: nullable(str()),
  createdAt: dateTime(),
  updatedAt: dateTime(),
};

const vendorDocument = object({
  type: oneOf(['AADHAAR', 'PAN']),
  status: oneOf(DOCUMENT_STATUSES, 'PENDING'),
  maskedNumber: str('XXXX XXXX 0124', { description: 'Only the last four characters are ever shown to the vendor' }),
  nameOnDocument: str('Ravi Kumar'),
  rejectionReason: nullable(str('Photo is too blurry to read')),
  verifiedAt: nullable(dateTime()),
  files: object({
    front: str('/vendor-onboarding/documents/aadhaar/files/front'),
    back: nullable(str('/vendor-onboarding/documents/aadhaar/files/back')),
  }),
  uploadedAt: dateTime(),
});
vendorDocument.description = 'When `status` is `NOT_UPLOADED` only `type` and `status` are present. `files` are authenticated API paths (relative to the API base), not public URLs.';

const vendorBankDetails = object({
  status: oneOf(DOCUMENT_STATUSES, 'PENDING'),
  accountHolderName: str('Ravi Kumar'),
  maskedAccountNumber: str('XXXXXX6789'),
  ifsc: str('HDFC0001234'),
  bankName: str('HDFC Bank'),
  branchName: nullable(str('Koramangala')),
  accountType: oneOf(['SAVINGS', 'CURRENT'], 'SAVINGS'),
  upiId: nullable(str('ravi@hdfcbank')),
  rejectionReason: nullable(str()),
  verifiedAt: nullable(dateTime()),
  proofFile: str('/vendor-onboarding/documents/bank_account/files/front', { description: 'Authenticated API path of the cancelled cheque / passbook image' }),
  uploadedAt: dateTime(),
});
vendorBankDetails.description = 'When `status` is `NOT_UPLOADED` only `status` is present.';

const verificationFields = {
  verificationSource: nullable(str('MANUAL', { description: '`MANUAL` when an admin checked it, otherwise the verification provider\'s name' })),
  verificationRef: nullable(str(undefined, { description: 'Provider reference id, when verified automatically' })),
  verifiedBy: nullable(object({ id: id(), name: str('Ops Reviewer') })),
};

const vendorApplicationProperties = {
  id: nullable({ ...id(APPLICATION_ID), description: 'Application id. Null only when `status` is `NOT_STARTED`.' }),
  status: {
    ...oneOf(['NOT_STARTED', ...ONBOARDING_STATUSES], 'DRAFT'),
    description:
      '`DRAFT` filling in details · `SUBMITTED` documents being verified · `PENDING_APPROVAL` waiting for the super admin · ' +
      '`CHANGES_REQUESTED` sent back to the vendor · `APPROVED` verified · `REJECTED` declined',
  },
  flow: ref('VendorFlow'),
  isEditable: { type: 'boolean', description: 'True while the vendor can still change details (`DRAFT`, `CHANGES_REQUESTED`)' },
  detailSteps: {
    ...arrayOf(object({ key: oneOf(['personalDetails', 'profilePhoto', 'services', 'aadhaar', 'pan', 'bankDetails']), complete: { type: 'boolean' } })),
    description: 'The parts of step 3 (Enter details) and whether each is filled in',
  },
  nextStep: nullable(str('services', { description: 'Within step 3: the first unfinished part, `submit` when all are done, null when not editable' })),
  canSubmit: { type: 'boolean' },
  reviewNote: nullable(str('Please add your full address', { description: 'Reviewer\'s reason for requested changes or rejection' })),
  submittedAt: nullable(dateTime()),
  reviewedAt: nullable(dateTime()),
  profilePhoto: nullable(str('/vendor-onboarding/profile-photo', { description: 'Authenticated API path of the photo' })),
  personalDetails: object({
    name: str('Ravi Kumar'),
    phone: nullable(str('+919812345678')),
    email: nullable(str('ravi.kumar@example.com')),
    dateOfBirth: nullable(str('1990-05-14', { format: 'date' })),
    gender: nullable(oneOf(['MALE', 'FEMALE', 'OTHER'], 'MALE')),
    alternatePhone: nullable(str()),
    city: nullable(object({ id: id(), name: str('Bengaluru') })),
    addressLine1: nullable(str('12, 4th Cross, 5th Block')),
    addressLine2: nullable(str('Koramangala')),
    landmark: nullable(str('Near Forum Mall')),
    pincode: nullable(str('560034')),
    state: nullable(str('Karnataka')),
    emergencyContactName: nullable(str('Sita Kumar')),
    emergencyContactPhone: nullable(str('+919876543210')),
  }),
  services: object({
    categories: arrayOf(object({ id: id(), name: str('Electrician'), tier: oneOf(['REPAIR', 'RENOVATION', 'RECURRING'], 'REPAIR') })),
    experienceYears: nullable({ type: 'integer', example: 6 }),
    homeZone: nullable(object({ id: id(), name: str('Koramangala') })),
  }),
  documents: arrayOf(ref('VendorDocument')),
  bankDetails: ref('VendorBankDetails'),
};

const schemas = {
  Error: object(
    {
      success: { type: 'boolean', example: false },
      message: str('Validation failed'),
      details: {
        type: 'object',
        nullable: true,
        description: 'Present on validation errors (`formErrors`, `fieldErrors`) and on a few others, e.g. `missing` when submitting an incomplete application',
        additionalProperties: true,
      },
    },
    ['success', 'message'],
  ),
  PaginationMeta: object({
    page: { type: 'integer', example: 1 },
    limit: { type: 'integer', example: 20 },
    total: { type: 'integer', example: 42 },
    totalPages: { type: 'integer', example: 3 },
  }),
  AuthTokens: object({
    accessToken: str(examples.tokens.accessToken, { description: 'JWT, valid 15 minutes. Send as `Authorization: Bearer <accessToken>`.' }),
    refreshToken: str(examples.tokens.refreshToken, { description: 'JWT, valid 30 days. Exchange at `POST /auth/refresh`.' }),
  }),
  PublicUser: object({
    id: id(),
    name: str('Ravi Kumar'),
    phone: nullable(str('+919812345678')),
    email: nullable(str('ravi.kumar@example.com')),
    role: oneOf(ROLES, 'CUSTOMER'),
    isOnboarded: { type: 'boolean', example: false },
  }),
  AuthSession: object({ user: ref('PublicUser'), accessToken: str(examples.tokens.accessToken), refreshToken: str(examples.tokens.refreshToken) }),
  User: object({
    id: id(),
    name: str('Ravi Kumar'),
    phone: nullable(str('+919812345678')),
    email: nullable(str('ravi.kumar@example.com')),
    role: oneOf(ROLES, 'CUSTOMER'),
    cityId: nullable(id()),
    address: nullable(str('12, 4th Cross, Koramangala')),
    isOnboarded: { type: 'boolean' },
    isActive: { type: 'boolean', example: true },
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  City: object({ id: id(), name: str('Bengaluru'), tier: oneOf(['TIER_1', 'TIER_2'], 'TIER_1'), isActive: { type: 'boolean', example: true }, createdAt: dateTime() }),
  Zone: object({ id: id(), cityId: id(), name: str('Koramangala'), isActive: { type: 'boolean', example: true }, createdAt: dateTime() }),
  ServiceCategory: object({
    id: id(),
    name: str('Electrician'),
    tier: oneOf(['REPAIR', 'RENOVATION', 'RECURRING'], 'REPAIR'),
    basePrice: money('299'),
    isActive: { type: 'boolean', example: true },
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  Professional: { ...object(professionalFields), description: 'The full professional record, including personal onboarding details. Only admins and the professional themselves receive this.' },
  ProfessionalWithUser: object({ ...professionalFields, user: userSummary, homeZone: nullable(ref('Zone')) }),
  ProfessionalListItem: object({ ...professionalFields, user: userSummary }),
  ProfessionalPublic: {
    ...object({
      id: id(),
      categories: arrayOf(UUID),
      kycStatus: oneOf(KYC_STATUSES, 'VERIFIED'),
      rating: str('4.80'),
      homeZone: nullable(ref('Zone')),
      photo: nullable(str('/professionals/5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e/photo', { description: 'Photo path once the professional is approved' })),
      user: object({ id: id(), name: str('Ravi Kumar') }),
    }),
    description: 'What other users see of a professional.',
  },
  Booking: object({
    id: id(),
    customerId: id(),
    professionalId: nullable(id()),
    categoryId: id(),
    status: oneOf(BOOKING_STATUSES, 'PENDING'),
    scheduledAt: nullable(dateTime('2026-10-08T04:30:00.000Z')),
    address: str('12, 4th Cross, Koramangala, Bengaluru'),
    price: nullable(money('299')),
    partnerId: nullable(id()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  Payment: object({
    id: id(),
    bookingId: nullable(id()),
    subscriptionId: nullable(id()),
    amount: money('299'),
    method: nullable(str('upi')),
    gatewayRef: nullable(str('order_Pq1x2y3z4A5b6C', { description: 'Razorpay order id' })),
    status: oneOf(['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'], 'CREATED'),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  RazorpayOrder: {
    ...object({
      id: str('order_Pq1x2y3z4A5b6C'),
      amount: { type: 'number', example: 29900, description: 'In paise when created by Razorpay; in rupees for the dev mock order' },
      currency: str('INR'),
      receipt: str('booking_5b0f6c1e-7d6a-4c58-9d3e-2a1f0b9c8d7e'),
      status: str('created'),
      dev: { type: 'boolean', description: 'Present and true when Razorpay is not configured and a mock order was returned' },
    }),
    description: 'The order as returned by Razorpay — pass `id` to Razorpay Checkout.',
    additionalProperties: true,
  },
  AMCSubscription: object({
    id: id(),
    customerId: id(),
    plan: str('Complete Care'),
    startDate: dateTime('2026-10-06T00:00:00.000Z'),
    renewalDate: dateTime('2027-10-06T00:00:00.000Z'),
    status: oneOf(['ACTIVE', 'EXPIRED', 'CANCELLED'], 'ACTIVE'),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  Review: object({
    id: id(),
    bookingId: id(),
    userId: id(),
    rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
    comment: nullable(str('Very professional and punctual.')),
    createdAt: dateTime(),
  }),
  Partner: object({ id: id(), type: oneOf(['BUILDER', 'RWA'], 'BUILDER'), name: str('Prestige Group'), cityId: id(), contact: nullable(str('+919000011111')), createdAt: dateTime() }),
  DashboardStats: object({
    users: object({ totalCustomers: { type: 'integer', example: 1284 }, totalProfessionals: { type: 'integer', example: 186 } }),
    professionals: object({ pendingKyc: { type: 'integer', example: 14 }, verified: { type: 'integer', example: 152 } }),
    bookings: object({
      total: { type: 'integer', example: 964 },
      byStatus: { type: 'object', additionalProperties: { type: 'integer' }, example: { PENDING: 84, MATCHING: 31, ASSIGNED: 76, IN_PROGRESS: 42, COMPLETED: 687, CANCELLED: 44 } },
    }),
    amc: object({ active: { type: 'integer', example: 238 } }),
    partners: object({ total: { type: 'integer', example: 42 } }),
    cities: object({ active: { type: 'integer', example: 8 } }),
  }),
  OnboardingStatus: object({
    isOnboarded: { type: 'boolean', example: false },
    role: oneOf(ROLES, 'CUSTOMER'),
    hasProfessionalProfile: { type: 'boolean', example: false },
    vendorOnboardingStatus: nullable({ ...oneOf(ONBOARDING_STATUSES), description: 'Null for accounts that never started vendor onboarding' }),
  }),

  // Vendor onboarding
  VendorFlow: {
    ...object({
      currentStep: { type: 'integer', minimum: 3, maximum: 5, example: 3, description: 'The step the vendor is on (1 and 2 are done once they hold a token)' },
      isVerified: { type: 'boolean', example: false },
      steps: arrayOf(
        object({
          step: { type: 'integer', example: 3 },
          key: oneOf(['PHONE_NUMBER', 'VERIFY_OTP', 'ENTER_DETAILS', 'VERIFY_VENDOR', 'VERIFIED']),
          title: str('Enter details'),
          status: {
            ...oneOf(['PENDING', 'CURRENT', 'COMPLETE', 'ACTION_REQUIRED', 'REJECTED']),
            description: '`ACTION_REQUIRED`: the reviewer sent it back, the vendor must fix details and resubmit. `REJECTED`: verification failed for good.',
          },
        }),
      ),
    }),
    description: 'The five-step onboarding journey, ready to render as a progress tracker.',
    example: examples.flow(3),
  },
  VendorDocument: vendorDocument,
  VendorBankDetails: vendorBankDetails,
  VendorApplication: { ...object(vendorApplicationProperties), description: 'A vendor\'s onboarding application as the vendor sees it.' },
  VendorSession: object({
    isNewUser: { type: 'boolean', description: 'True when this phone number had no account before' },
    user: ref('PublicUser'),
    accessToken: str(examples.tokens.accessToken),
    refreshToken: str(examples.tokens.refreshToken),
    application: ref('VendorApplication'),
  }),
  VendorStatus: object({
    id: nullable(id(APPLICATION_ID)),
    status: oneOf(['NOT_STARTED', ...ONBOARDING_STATUSES], 'SUBMITTED'),
    flow: ref('VendorFlow'),
    reviewNote: nullable(str()),
    submittedAt: nullable(dateTime()),
    reviewedAt: nullable(dateTime()),
  }),
  VendorOnboardingEvent: object({
    id: id(),
    action: oneOf(['SUBMITTED', 'RESUBMITTED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'REOPENED']),
    documentType: nullable(oneOf(['AADHAAR', 'PAN', 'BANK_ACCOUNT'])),
    fromStatus: nullable(oneOf(ONBOARDING_STATUSES)),
    toStatus: nullable(oneOf(ONBOARDING_STATUSES)),
    note: nullable(str()),
    createdAt: dateTime(),
    actor: nullable({ ...object({ id: id(), name: str('Ops Reviewer'), role: oneOf(ROLES, 'ADMIN') }), description: 'Null when an automated verification did it' }),
  }),
  VendorApplicationAdmin: {
    ...object({
      ...vendorApplicationProperties,
      documents: arrayOf(object({ ...vendorDocument.properties, number: str('234567890124', { description: 'Full, unmasked document number' }), ...verificationFields })),
      bankDetails: object({ ...vendorBankDetails.properties, accountNumber: str('50100123456789', { description: 'Full, unmasked account number' }), ...verificationFields }),
      user: object({ id: id(), isActive: { type: 'boolean', example: true } }),
      reviewedBy: nullable(object({ id: id(), name: str('Platform Admin') })),
      events: { ...arrayOf(ref('VendorOnboardingEvent')), description: 'Audit trail, oldest first' },
    }),
    description: 'The application as a reviewer sees it: unmasked numbers, who verified what, and the audit trail. File paths point at the admin endpoints.',
  },
  VendorApplicationListItem: object({
    id: { ...id(APPLICATION_ID), description: 'Application id — use it in the review endpoints' },
    status: oneOf(ONBOARDING_STATUSES, 'PENDING_APPROVAL'),
    userId: id(),
    name: str('Ravi Kumar'),
    phone: nullable(str('+919812345678')),
    email: nullable(str('ravi.kumar@example.com')),
    isActive: { type: 'boolean', example: true, description: 'False when the account has been deactivated' },
    city: nullable(object({ id: id(), name: str('Bengaluru') })),
    homeZone: nullable(object({ id: id(), name: str('Koramangala') })),
    serviceCount: { type: 'integer', example: 2 },
    experienceYears: nullable({ type: 'integer', example: 6 }),
    profilePhoto: nullable(str(`/vendor-onboarding/applications/${APPLICATION_ID}/profile-photo`, { description: 'Authenticated API path' })),
    documents: {
      ...arrayOf(object({ type: oneOf(['AADHAAR', 'PAN', 'BANK_ACCOUNT']), status: oneOf(DOCUMENT_STATUSES) })),
      example: [{ type: 'AADHAAR', status: 'VERIFIED' }, { type: 'PAN', status: 'PENDING' }, { type: 'BANK_ACCOUNT', status: 'PENDING' }],
    },
    submittedAt: nullable(dateTime()),
    reviewedAt: nullable(dateTime()),
    createdAt: dateTime(),
  }),
  VendorSummary: object({
    byStatus: {
      type: 'object',
      additionalProperties: { type: 'integer' },
      example: { DRAFT: 12, SUBMITTED: 5, PENDING_APPROVAL: 2, CHANGES_REQUESTED: 3, APPROVED: 152, REJECTED: 4 },
    },
    total: { type: 'integer', example: 178 },
    awaitingDocumentVerification: { type: 'integer', example: 5, description: 'Applications in `SUBMITTED` — documents to check' },
    awaitingFinalApproval: { type: 'integer', example: 2, description: 'Applications in `PENDING_APPROVAL` — waiting for the super admin' },
  }),
  UserListItem: {
    allOf: [
      ref('User'),
      object({
        city: nullable(object({ id: id(), name: str('Bengaluru') })),
        professional: nullable({
          ...object({
            id: { ...id(APPLICATION_ID), description: 'Also the vendor application id' },
            onboardingStatus: oneOf(ONBOARDING_STATUSES, 'APPROVED'),
            kycStatus: oneOf(KYC_STATUSES, 'VERIFIED'),
            rating: str('4.80'),
          }),
          description: 'Present for vendors; null for everyone else',
        }),
      }),
    ],
  },
  UserDetail: {
    allOf: [
      ref('UserListItem'),
      object({
        counts: object({
          bookings: { type: 'integer', example: 24, description: 'Bookings made as a customer' },
          reviews: { type: 'integer', example: 9 },
          amcSubscriptions: { type: 'integer', example: 1 },
        }),
      }),
    ],
  },
  UserSummary: object({
    total: { type: 'integer', example: 1486 },
    byRole: { type: 'object', additionalProperties: { type: 'integer' }, example: { CUSTOMER: 1284, PROFESSIONAL: 186, ADMIN: 14, SUPER_ADMIN: 2 } },
    active: { type: 'integer', example: 1460 },
    inactive: { type: 'integer', example: 26 },
    onboarded: { type: 'integer', example: 1321 },
    newInLast30Days: { type: 'integer', example: 96 },
  }),
};

const responses = {
  BadRequest: errorResponse('The request is invalid — either it failed validation (see `details.fieldErrors`) or a business rule rejected it', 'Validation failed', {
    formErrors: [],
    fieldErrors: { phone: ['Invalid phone number, use E.164 format e.g. +919812345678'] },
  }),
  Unauthorized: errorResponse('Missing, invalid or expired access token', 'Invalid or expired token'),
  Forbidden: errorResponse('The signed-in account is not allowed to do this', 'You do not have access to this resource'),
  NotFound: errorResponse('The resource does not exist', 'Not found'),
  Conflict: errorResponse('The request conflicts with the current state', 'Your application is under review and cannot be edited'),
  ServiceUnavailable: errorResponse('A required integration is not configured on the server', 'Document storage is not configured (R2 credentials are missing)'),
};

module.exports = { schemas, responses, examples, ROLES, KYC_STATUSES, BOOKING_STATUSES, ONBOARDING_STATUSES };
