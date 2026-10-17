const { ref, arrayOf, ok, paginated, jsonBody, multipartBody, pathParam, queryParam, pageParams, op } = require('../helpers');
const { examples } = require('../components');

const JOBS = 'Vendor app — jobs';
const WALLET = 'Vendor app — wallet';
const PAYOUTS = 'Vendor payouts (admin)';
const TERMS = 'Payout settings (admin)';
const METHODS = ['BANK_TRANSFER', 'UPI', 'CASH'];
const FREQUENCIES = ['AFTER_HOLD', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];

const jobId = pathParam('id', 'Booking id');
const professionalId = pathParam('professionalId', 'Vendor (professional) id');
const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
const amount = (description) => ({ type: 'number', example: 299, ...(description && { description }) });
const booking = ref('BookingDetail');
const otpBody = (example) => jsonBody({ type: 'object', required: ['otp'], properties: { otp: { type: 'string', pattern: '^\\d{4}$', description: 'The 4-digit code the customer reads out' } } }, { otp: example });

// The same job at each stage, as the vendor sees it.
const base = examples.booking('assigned', 'vendor');
const image = { id: 'c0ffee00-1111-4a2b-9c3d-4e5f6a7b8c9d', url: `/bookings/${base.id}/completion-images/c0ffee00-1111-4a2b-9c3d-4e5f6a7b8c9d`, uploadedAt: '2026-10-09T06:10:00.000Z' };
const stage = {
  accepted: base,
  started: { ...base, status: 'IN_PROGRESS', startedAt: '2026-10-09T04:35:00.000Z', job: { nextStep: 'VERIFY_COMPLETION_OTP', completionOtpVerified: false }, actions: { ...base.actions, canCancel: false, canReschedule: false, canCollectPayment: false } },
};
stage.otpVerified = { ...stage.started, job: { nextStep: 'UPLOAD_IMAGES', completionOtpVerified: true } };
stage.withPhotos = { ...stage.otpVerified, job: { nextStep: 'COMPLETE', completionOtpVerified: true }, completionImages: [image] };
stage.completed = { ...stage.withPhotos, status: 'COMPLETED', completedAt: '2026-10-09T06:15:00.000Z', job: { nextStep: null, completionOtpVerified: true } };

const availableJob = {
  type: 'object',
  description: 'A job nobody has taken yet. The customer\'s name, phone and exact address are shown only after accepting.',
  properties: {
    id: uuid,
    bookingNumber: { type: 'string', example: 'BK-000123' },
    service: { type: 'object', properties: { id: uuid, name: { type: 'string' }, tier: { type: 'string' } } },
    scheduledAt: { ...dateTime, nullable: true },
    description: { type: 'string', nullable: true },
    price: { ...amount('What the customer pays, in rupees'), nullable: true },
    paymentMode: { type: 'string', enum: ['ONLINE', 'PAY_AFTER_SERVICE'] },
    area: { type: 'object', properties: { city: { type: 'object', nullable: true }, zone: { type: 'object', nullable: true }, pincode: { type: 'string', nullable: true } } },
    createdAt: dateTime,
  },
};
const availableExample = {
  id: base.id,
  bookingNumber: base.bookingNumber,
  service: base.service,
  scheduledAt: base.scheduledAt,
  description: base.description,
  price: base.price,
  paymentMode: 'ONLINE',
  area: { city: base.address.city, zone: base.address.zone, pincode: base.address.pincode },
  createdAt: base.createdAt,
};

const ENTRY_STATUS = ['ON_HOLD', 'READY', 'PROCESSING', 'PAID', 'SETTLED_IN_CASH'];
const transaction = {
  type: 'object',
  properties: {
    id: uuid,
    type: { type: 'string', enum: ['EARNING', 'PAYOUT'] },
    direction: { type: 'string', enum: ['CREDIT', 'DEBIT'], description: '`CREDIT` = earned from a job, `DEBIT` = sent to the bank account' },
    title: { type: 'string', example: 'Earning for BK-000123' },
    amount: amount('What the vendor gets (earning) or was sent (payout)'),
    grossAmount: { ...amount('Earning: what the customer was charged'), nullable: true },
    commission: { ...amount('Earning: the platform\'s share'), nullable: true },
    status: {
      type: 'string',
      enum: ENTRY_STATUS,
      description: '`ON_HOLD` earned, waiting out the hold · `READY` hold over, waiting to be sent · `PROCESSING` (payouts) handed to the payout provider, not confirmed yet · `PAID` sent · `SETTLED_IN_CASH` the vendor took the customer\'s cash, nothing to send',
    },
    availableAt: { ...dateTime, nullable: true, description: 'Earning: when the hold ends' },
    booking: { type: 'object', nullable: true, properties: { id: uuid, bookingNumber: { type: 'string' }, service: { type: 'object' }, completedAt: { ...dateTime, nullable: true } } },
    payout: { type: 'object', nullable: true, properties: { id: uuid, payoutNumber: { type: 'string', example: 'PO-000007' }, reference: { type: 'string' }, paidAt: dateTime, status: { type: 'string', enum: ['PROCESSING', 'PAID', 'FAILED'] }, mode: { type: 'string', enum: ['MANUAL', 'AUTOMATIC'] }, method: { type: 'string', enum: METHODS } } },
    note: { type: 'string', nullable: true },
    createdAt: dateTime,
  },
};
const earningExample = {
  id: 'e1a2b3c4-1111-4d5e-8f6a-7b8c9d0e1f2a',
  type: 'EARNING',
  direction: 'CREDIT',
  title: 'Earning for BK-000123',
  amount: 299,
  grossAmount: 299,
  commission: 0,
  status: 'ON_HOLD',
  availableAt: '2026-10-11T06:15:00.000Z',
  booking: { id: base.id, bookingNumber: 'BK-000123', service: { id: base.service.id, name: 'Electrician' }, completedAt: '2026-10-09T06:15:00.000Z' },
  payout: null,
  note: null,
  createdAt: '2026-10-09T06:15:00.000Z',
};
const payoutRef = { id: 'f0e1d2c3-2222-4b4a-9c8d-7e6f5a4b3c2d', payoutNumber: 'PO-000007', reference: 'NEFT-HDFCN26281234567', paidAt: '2026-10-08T11:00:00.000Z', status: 'PAID', mode: 'MANUAL', method: 'BANK_TRANSFER' };
const payoutEntryExample = { ...earningExample, id: 'e1a2b3c4-2222-4d5e-8f6a-7b8c9d0e1f2a', type: 'PAYOUT', direction: 'DEBIT', title: 'Payout PO-000007', amount: 1450, grossAmount: null, commission: null, status: 'PAID', availableAt: null, booking: null, payout: payoutRef, note: payoutRef.reference, createdAt: payoutRef.paidAt };

const wallet = {
  type: 'object',
  properties: {
    currency: { type: 'string', example: 'INR' },
    balance: amount('Everything earned that has not been sent yet (`onHold` + `readyForPayout`)'),
    onHold: amount('Earned recently and still inside the hold period'),
    readyForPayout: amount('Hold over — will be in the next transfer'),
    totalPaidOut: amount('Sent to the bank account so far'),
    collectedInCash: amount('Jobs where the vendor took the customer\'s cash directly'),
    totalEarned: amount('All of the above together'),
    jobsPaidFor: { type: 'integer' },
    holdMinutes: { type: 'integer', example: 2880, description: 'How long an earning is held after the job is completed, in minutes' },
    holdLabel: { type: 'string', example: '2 days', description: 'The hold period in words, e.g. "1 day 4 hours"' },
    holdDays: { type: 'number', example: 2, description: 'The hold period in days (may be fractional); prefer holdMinutes' },
    commissionPercent: { type: 'number', example: 10, description: 'The platform\'s share of each job for this vendor' },
    payoutMethod: { type: 'string', enum: METHODS },
    payoutFrequency: { type: 'string', enum: FREQUENCIES },
    nextPayoutDate: { type: 'string', format: 'date', nullable: true, description: 'The next scheduled payout day; null when earnings are paid as soon as their hold ends' },
    nextRelease: { type: 'object', nullable: true, description: 'The next earning to come off hold', properties: { at: dateTime, amount: amount() } },
    lastPayout: { type: 'object', nullable: true, properties: { id: uuid, payoutNumber: { type: 'string' }, amount: amount(), paidAt: dateTime, reference: { type: 'string' } } },
  },
};
const walletExample = {
  currency: 'INR',
  balance: 897,
  onHold: 299,
  readyForPayout: 598,
  totalPaidOut: 1450,
  collectedInCash: 349,
  totalEarned: 2696,
  jobsPaidFor: 9,
  holdMinutes: 2880,
  holdLabel: '2 days',
  holdDays: 2,
  commissionPercent: 10,
  payoutMethod: 'BANK_TRANSFER',
  payoutFrequency: 'WEEKLY',
  nextPayoutDate: '2026-10-20',
  nextRelease: { at: '2026-10-11T06:15:00.000Z', amount: 299 },
  lastPayout: { id: payoutRef.id, payoutNumber: payoutRef.payoutNumber, amount: 1450, paidAt: payoutRef.paidAt, reference: payoutRef.reference },
};

const pageWith = (description, item, extra) => {
  const response = paginated(description, item);
  Object.assign(response.content['application/json'].schema.properties, extra);
  return response;
};
const pendingTotals = { totals: { type: 'object', properties: { pending: amount(), onHold: amount(), readyForPayout: amount() } } };
const transactionFilters = [
  queryParam('type', 'Only earnings, or only payouts', { type: 'string', enum: ['EARNING', 'PAYOUT'] }),
  queryParam('status', '`PENDING` = everything not sent yet (`ON_HOLD` and `READY` together)', { type: 'string', enum: ['ON_HOLD', 'READY', 'PENDING', 'PAID', 'SETTLED_IN_CASH'] }),
  ...pageParams,
];

const vendorRef = { type: 'object', properties: { professionalId: uuid, userId: uuid, name: { type: 'string' }, phone: { type: 'string', nullable: true } } };
const vendorExample = { professionalId: examples.APPLICATION_ID, userId: '9c8b7a6d-5555-4f4e-8d3c-2b1a0f9e8d7c', name: 'Ravi Kumar', phone: '+919812345678' };
const payout = {
  type: 'object',
  properties: { id: uuid, payoutNumber: { type: 'string' }, vendor: vendorRef, amount: amount(), reference: { type: 'string', description: 'Transfer reference: the bank / UPI reference, or the provider payout id' }, method: { type: 'string', enum: METHODS }, mode: { type: 'string', enum: ['MANUAL', 'AUTOMATIC'], description: '`MANUAL` = recorded by the team, `AUTOMATIC` = sent through the payout provider' }, status: { type: 'string', enum: ['PROCESSING', 'PAID', 'FAILED'] }, failureReason: { type: 'string', nullable: true }, providerPayoutId: { type: 'string', nullable: true }, processedAt: { type: 'string', format: 'date-time', nullable: true }, note: { type: 'string', nullable: true }, earningsCovered: { type: 'integer' }, paidAt: dateTime, createdAt: dateTime },
};
const payoutExample = { id: payoutRef.id, payoutNumber: payoutRef.payoutNumber, vendor: vendorExample, amount: 598, reference: payoutRef.reference, method: 'BANK_TRANSFER', mode: 'MANUAL', status: 'PAID', failureReason: null, providerPayoutId: null, processedAt: '2026-10-13T11:00:00.000Z', note: null, earningsCovered: 2, paidAt: '2026-10-13T11:00:00.000Z', createdAt: '2026-10-13T11:00:00.000Z' };

const settingsSchema = {
  type: 'object',
  properties: {
    holdMinutes: { type: 'integer', minimum: 0, maximum: 86400, description: 'How long an earning is held after the job is completed, in minutes (days × 1440 + hours × 60 + minutes); at most 60 days' },
    holdLabel: { type: 'string', description: 'The hold period in words (read only)' },
    commissionPercent: { type: 'number', minimum: 0, maximum: 100, description: 'The platform\'s share of each job' },
    payoutMethod: { type: 'string', enum: METHODS, description: 'How vendors are paid by default' },
    frequency: { type: 'string', enum: FREQUENCIES, description: '`AFTER_HOLD` pays each earning once its hold ends; the others pay on a schedule' },
    firstPayoutDate: { type: 'string', format: 'date', nullable: true, description: 'The first scheduled payout day; later ones repeat from it' },
    upcomingPayoutDates: { type: 'array', items: { type: 'string', format: 'date' }, description: 'The next three scheduled payout days (read only)' },
    automaticPayouts: { type: 'boolean', description: 'Send ready earnings through the payout provider on each payout day, without anyone pressing a button' },
    lastAutomaticRunOn: { type: 'string', format: 'date', nullable: true },
    provider: { type: 'string', enum: ['LIVE', 'SIMULATED', 'NOT_CONFIGURED'], description: '`LIVE` RazorpayX keys are set and money really moves · `SIMULATED` development stand-in · `NOT_CONFIGURED` only manual payouts work (read only)' },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
const settingsExample = { holdMinutes: 2880, holdLabel: '2 days', commissionPercent: 10, payoutMethod: 'BANK_TRANSFER', frequency: 'WEEKLY', firstPayoutDate: '2026-10-20', upcomingPayoutDates: ['2026-10-20', '2026-10-27', '2026-11-03'], automaticPayouts: true, lastAutomaticRunOn: '2026-10-13', provider: 'LIVE', updatedAt: '2026-10-18T09:00:00.000Z' };
const termsSchema = {
  type: 'object',
  properties: {
    ...vendorRef.properties,
    status: { type: 'string', description: 'Vendor onboarding status' },
    bankAccountStatus: { type: 'string' },
    commissionPercent: { type: 'number', description: 'In effect: the vendor\'s own, or the default' },
    holdMinutes: { type: 'integer' },
    holdLabel: { type: 'string' },
    payoutMethod: { type: 'string', enum: METHODS },
    custom: { type: 'object', description: 'The vendor\'s own values; null = following the default', properties: { commissionPercent: { type: 'number', nullable: true }, holdMinutes: { type: 'integer', nullable: true }, payoutMethod: { type: 'string', nullable: true } } },
  },
};
const termsExample = { ...vendorExample, status: 'APPROVED', bankAccountStatus: 'VERIFIED', commissionPercent: 8, holdMinutes: 2880, holdLabel: '2 days', payoutMethod: 'UPI', custom: { commissionPercent: 8, holdMinutes: null, payoutMethod: 'UPI' } };
const termsFields = {
  commissionPercent: { type: 'number', minimum: 0, maximum: 100, nullable: true },
  holdMinutes: { type: 'integer', minimum: 0, maximum: 86400, nullable: true, description: 'In minutes' },
  payoutMethod: { type: 'string', enum: METHODS, nullable: true },
};

const payoutAccount = {
  type: 'object',
  properties: {
    status: { type: 'string', description: '`VERIFIED` once checked (details entered by the team count as checked)' },
    accountHolderName: { type: 'string', nullable: true },
    maskedAccountNumber: { type: 'string', nullable: true, example: 'XXXX6789' },
    ifsc: { type: 'string', nullable: true },
    bankName: { type: 'string', nullable: true },
    branchName: { type: 'string', nullable: true },
    accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT'], nullable: true },
    upiId: { type: 'string', nullable: true },
    hasBankAccount: { type: 'boolean' },
    hasUpi: { type: 'boolean' },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
const payoutAccountExample = { status: 'VERIFIED', accountHolderName: 'Ravi Kumar', maskedAccountNumber: 'XXXX6789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branchName: 'Koramangala', accountType: 'SAVINGS', upiId: 'ravi@hdfcbank', hasBankAccount: true, hasUpi: true, updatedAt: '2026-10-18T10:00:00.000Z' };

module.exports = {
  tags: [
    {
      name: JOBS,
      description:
        'How an **approved** vendor takes and does a job. Until a super admin approves the vendor, these return **403**.\n\n' +
        '| Step | Vendor app | Call |\n|---|---|---|\n' +
        '| 1 | See open jobs | `GET /vendor/jobs/available` |\n' +
        '| 2 | Take one | `POST /vendor/jobs/{id}/accept` |\n' +
        '| 3 | Arrive, ask the customer for the **start code**, enter it | `POST /vendor/jobs/{id}/start` |\n' +
        '| 4 | Finish the work, ask for the **completion code**, enter it | `POST /vendor/jobs/{id}/completion-otp` |\n' +
        '| 5 | Upload photos of the finished work | `POST /vendor/jobs/{id}/completion-images` |\n' +
        '| 6 | Complete the job | `POST /vendor/jobs/{id}/complete` |\n\n' +
        'Every step returns the booking; its `job.nextStep` says what comes next (`START`, `VERIFY_COMPLETION_OTP`, `UPLOAD_IMAGES`, `COMPLETE`). ' +
        'The vendor\'s own jobs are listed with `GET /vendor/bookings`.\n\n' +
        '**The codes** are 4 digits and appear in the **customer\'s** booking (`otp.start` while assigned, `otp.completion` once started) — ' +
        'the vendor is never sent them. After 5 wrong tries the code is replaced and the customer sees the new one. ' +
        'Completing a job credits the vendor\'s wallet.',
    },
    {
      name: WALLET,
      description:
        'The vendor\'s money. Completing a job adds its amount to the wallet as an earning. It is **on hold** for 2 days, then **ready**, ' +
        'and is **paid** when the team sends it to the vendor\'s bank account — which shows as a payout transaction.\n\n' +
        'If the customer paid the vendor in cash, the vendor already has the money: that earning shows as `SETTLED_IN_CASH` and is not part of the balance.',
    },
    {
      name: TERMS,
      description:
        'How vendors are paid: the platform default for every vendor (hold period, commission, payout method and payout schedule) and ' +
        'each vendor\'s own commission, hold period and method, which win over the default. Changes apply to jobs completed from then on; ' +
        'earnings already in a wallet keep the terms they were credited with.',
    },
    {
      name: PAYOUTS,
      description:
        'The team\'s side of the wallet: which vendors are owed money, and recording that it was sent. The bank transfer itself is made outside ' +
        'this system; recording the payout marks the earnings it covers as paid and notifies the vendor.',
    },
  ],
  paths: {
    '/vendor/jobs/available': {
      get: op({
        tag: JOBS,
        summary: 'Step 1 — jobs I can take',
        description: 'Every confirmed booking nobody has taken yet, soonest first. For now there is no matching on the vendor\'s services or city: any approved vendor sees and can accept any open order. An online booking appears once it is paid.',
        access: 'PROFESSIONAL',
        params: pageParams,
        responses: { 200: paginated('A page of open jobs', availableJob) },
      }),
    },
    '/vendor/jobs/available/{id}': {
      get: op({
        tag: JOBS,
        summary: 'Step 1 — one open job',
        description: 'Returns **404** once someone has taken it.',
        access: 'PROFESSIONAL',
        params: [jobId],
        responses: { 200: ok('The job', availableJob, availableExample) },
        errors: [404],
      }),
    },
    '/vendor/jobs/{id}/accept': {
      post: op({
        tag: JOBS,
        summary: 'Step 2 — take the job',
        description:
          'The first vendor to accept gets it; anyone after gets **409**. The booking becomes `ASSIGNED`, the customer is notified and their app ' +
          'shows the start code. The response now includes the customer and the full address.',
        access: 'PROFESSIONAL',
        params: [jobId],
        responses: { 200: ok('The booking, now assigned to the vendor', booking, stage.accepted) },
        errors: [409],
      }),
    },
    '/vendor/jobs/{id}/start': {
      post: op({
        tag: JOBS,
        summary: 'Step 3 — start with the customer\'s start code',
        description: 'The booking becomes `IN_PROGRESS` and the customer\'s app shows the completion code. A wrong code returns **400** and says how many tries are left.',
        access: 'PROFESSIONAL',
        params: [jobId],
        body: otpBody('4821'),
        responses: { 200: ok('The booking, in progress', booking, stage.started) },
        errors: [409],
      }),
    },
    '/vendor/jobs/{id}/completion-otp': {
      post: op({
        tag: JOBS,
        summary: 'Step 4 — enter the customer\'s completion code',
        description: 'Confirms with the customer that the work is done. A wrong code returns **400**. Calling it again once verified does nothing.',
        access: 'PROFESSIONAL',
        params: [jobId],
        body: otpBody('7306'),
        responses: { 200: ok('The booking, code verified', booking, stage.otpVerified) },
        errors: [409],
      }),
    },
    '/vendor/jobs/{id}/completion-images': {
      post: op({
        tag: JOBS,
        summary: 'Step 5 — upload photos of the finished work',
        description:
          'Send as `multipart/form-data` with one or more files in `images`. JPEG, PNG or WebP, up to 5 MB each, at most 5 photos per job ' +
          '(across all uploads). Can be called more than once while the job is in progress.',
        access: 'PROFESSIONAL',
        params: [jobId],
        body: multipartBody({ type: 'object', required: ['images'], properties: { images: arrayOf({ type: 'string', format: 'binary' }) } }),
        responses: { 201: ok('The booking, with its photos', booking, stage.withPhotos) },
        errors: [409, 503],
      }),
    },
    '/vendor/jobs/{id}/completion-images/{imageId}': {
      delete: op({
        tag: JOBS,
        summary: 'Step 5 — remove a photo',
        description: 'Only while the job is in progress.',
        access: 'PROFESSIONAL',
        params: [jobId, pathParam('imageId', 'Photo id')],
        responses: { 200: ok('The booking, without that photo', booking, stage.otpVerified) },
        errors: [404, 409],
      }),
    },
    '/vendor/jobs/{id}/complete': {
      post: op({
        tag: JOBS,
        summary: 'Step 6 — complete the job',
        description:
          'Needs the completion code verified and at least one photo, otherwise **409**. The booking becomes `COMPLETED`, the customer is ' +
          'notified, and the job\'s amount is added to the vendor\'s wallet (on hold for 2 days).',
        access: 'PROFESSIONAL',
        params: [jobId],
        responses: { 200: ok('The completed booking', booking, stage.completed) },
        errors: [409],
      }),
    },

    '/vendor/wallet': {
      get: op({
        tag: WALLET,
        summary: 'My wallet',
        description: '`balance` is the total still to be sent to the vendor. It is made of `onHold` (inside the 2-day hold) and `readyForPayout` (hold over).',
        access: 'PROFESSIONAL',
        responses: { 200: ok('The wallet', wallet, walletExample) },
        errors: [404],
      }),
    },
    '/vendor/wallet/transactions': {
      get: op({
        tag: WALLET,
        summary: 'My transactions',
        description: 'Every earning (a credit, one per completed job) and every payout (a debit, money sent to the bank account), newest first.',
        access: 'PROFESSIONAL',
        params: transactionFilters,
        responses: { 200: paginated('A page of transactions', transaction) },
        errors: [404],
      }),
    },
    '/vendor/wallet/pending': {
      get: op({
        tag: WALLET,
        summary: 'Payments still to come',
        description: 'The earnings that have not been sent yet, the next to be released first, with `totals` for the screen header.',
        access: 'PROFESSIONAL',
        params: pageParams,
        responses: { 200: pageWith('A page of unpaid earnings, with totals', transaction, pendingTotals) },
        errors: [404],
      }),
    },

    '/payouts/settings': {
      get: op({
        tag: TERMS,
        summary: 'Payout defaults for every vendor',
        description: 'Until a super admin saves settings, the server\'s environment provides them (hold 2 days = 2880 minutes, no commission, bank transfer, paid as soon as the hold ends).',
        access: 'ADMIN',
        responses: { 200: ok('The settings', settingsSchema, settingsExample) },
      }),
      put: op({
        tag: TERMS,
        summary: 'Change the payout defaults',
        description:
          'Send only what changes. A `WEEKLY`, `BIWEEKLY` or `MONTHLY` schedule needs `firstPayoutDate`; later payout days repeat from it ' +
          '(monthly on the same day of the month). Vendors with their own terms keep them.',
        access: 'SUPER_ADMIN',
        body: jsonBody(
          { type: 'object', minProperties: 1, properties: { holdMinutes: termsFields.holdMinutes, commissionPercent: termsFields.commissionPercent, payoutMethod: { type: 'string', enum: METHODS }, frequency: { type: 'string', enum: FREQUENCIES }, firstPayoutDate: { type: 'string', format: 'date', nullable: true }, automaticPayouts: { type: 'boolean', description: 'Needs the payout provider; **503** without it' } } },
          { commissionPercent: 10, frequency: 'WEEKLY', firstPayoutDate: '2026-10-20', automaticPayouts: true },
        ),
        responses: { 200: ok('The saved settings', settingsSchema, settingsExample) },
      }),
    },
    '/payouts/vendor-terms': {
      get: op({
        tag: TERMS,
        summary: 'Every vendor\'s payout terms',
        description: 'The commission, hold period and method in effect for each vendor, and which of them are the vendor\'s own (`custom`). By name.',
        access: 'ADMIN',
        params: [queryParam('search', 'Vendor name, phone or email'), queryParam('customOnly', 'Only vendors with terms of their own', { type: 'string', enum: ['true', 'false'] }), ...pageParams],
        responses: { 200: paginated('A page of vendors', termsSchema) },
      }),
      put: op({
        tag: TERMS,
        summary: 'Set terms for several vendors, or all',
        description:
          'Applies the same commission, hold period and/or method to the vendors in `professionalIds`, or to **every** vendor when it is left out. ' +
          '`null` on a field, or `reset: true`, puts them back on the platform default.',
        access: 'SUPER_ADMIN',
        body: jsonBody(
          { type: 'object', properties: { professionalIds: arrayOf(uuid), reset: { type: 'boolean' }, ...termsFields } },
          { professionalIds: [examples.APPLICATION_ID], commissionPercent: 8 },
        ),
        responses: { 200: ok('How many vendors changed', { type: 'object', properties: { updated: { type: 'integer' } } }, { updated: 1 }) },
      }),
    },
    '/payouts/vendors/{professionalId}/terms': {
      put: op({
        tag: TERMS,
        summary: 'Set one vendor\'s payout terms',
        description: 'Send only what changes; `null` puts that field back on the platform default.',
        access: 'SUPER_ADMIN',
        params: [professionalId],
        body: jsonBody({ type: 'object', minProperties: 1, properties: termsFields }, { commissionPercent: 8, payoutMethod: 'UPI' }),
        responses: { 200: ok('The vendor\'s terms', termsSchema, termsExample) },
        errors: [404],
      }),
    },
    '/payouts/vendors/{professionalId}/send': {
      post: op({
        tag: PAYOUTS,
        summary: 'Send a vendor\'s money now',
        description:
          'Sends everything the vendor has ready (or everything owed, with `includeOnHold`) through the payout provider, to their bank account ' +
          '(IMPS) or UPI id. Needs verified bank details or a UPI id, otherwise **400**; cash cannot be sent this way. Returns the payout: ' +
          '`PAID`, `PROCESSING` (the provider confirms later and the status updates itself) or `FAILED` with `failureReason`, in which case the ' +
          'earnings are owed again. **409** if nothing is owed; **503** in production without a payout provider.',
        access: 'SUPER_ADMIN',
        params: [professionalId],
        body: jsonBody(
          { type: 'object', properties: { method: { type: 'string', enum: ['BANK_TRANSFER', 'UPI'], description: 'Defaults to the vendor\'s payout method' }, includeOnHold: { type: 'boolean' }, note: { type: 'string', maxLength: 500 } } },
          {},
        ),
        responses: { 201: ok('The payout', payout, { ...payoutExample, mode: 'AUTOMATIC', status: 'PROCESSING', reference: 'pout_00000000000001', providerPayoutId: 'pout_00000000000001', processedAt: null }) },
        errors: [404, 409, 503],
      }),
    },
    '/payouts/run-automatic': {
      post: op({
        tag: PAYOUTS,
        summary: 'Run the automatic payout now',
        description:
          'Pays every vendor whose money is ready, as the scheduled run would — but now, whatever the schedule. Vendors who cannot be paid ' +
          'automatically (no or unverified bank details, cash method) are listed in `skipped`; provider failures in `failed`. The server also ' +
          'runs this by itself every 10 minutes when automatic payouts are on and it is a payout day.',
        access: 'SUPER_ADMIN',
        responses: {
          200: ok(
            'What happened',
            { type: 'object', properties: { ran: { type: 'boolean' }, sent: { type: 'integer' }, amount: amount(), failed: arrayOf({ type: 'object' }), skipped: arrayOf({ type: 'object', properties: { professionalId: uuid, name: { type: 'string' }, reason: { type: 'string' } } }) } },
            { ran: true, sent: 3, amount: 2650, failed: [], skipped: [{ professionalId: examples.APPLICATION_ID, name: 'Ravi Kumar', reason: 'This vendor has no bank account — add one first' }] },
          ),
        },
      }),
    },
    '/payouts/refresh': {
      post: op({
        tag: PAYOUTS,
        summary: 'Check processing payouts with the provider',
        description: 'Asks the payout provider about payouts still `PROCESSING` and updates them. The webhook and the 10-minute run normally do this.',
        access: 'ADMIN',
        responses: { 200: ok('How many were checked', { type: 'object', properties: { checked: { type: 'integer' } } }, { checked: 2 }) },
      }),
    },
    '/payouts/webhook': {
      post: op({
        tag: PAYOUTS,
        summary: 'RazorpayX payout webhook',
        description:
          'Point RazorpayX\'s webhook here for `payout.processed`, `payout.failed`, `payout.reversed` and `payout.rejected`, with ' +
          '`RAZORPAYX_WEBHOOK_SECRET` as the secret. Signed with `X-Razorpay-Signature`; **400** if the signature is wrong.',
        access: 'public',
        body: jsonBody({ type: 'object', properties: { event: { type: 'string' }, payload: { type: 'object' } } }, { event: 'payout.processed', payload: { payout: { entity: { id: 'pout_00000000000001', status: 'processed' } } } }),
        responses: { 200: ok('Received', { type: 'object', properties: { handled: { type: 'boolean' } } }, { handled: true }) },
      }),
    },
    '/vendor/payout-account': {
      get: op({
        tag: WALLET,
        summary: 'My bank account and UPI id',
        description: 'Where the vendor\'s payouts are sent. The account number is only shown masked. `status` is `VERIFIED` once the team has checked the details.',
        access: 'PROFESSIONAL',
        responses: { 200: ok('Where I am paid', payoutAccount, payoutAccountExample) },
        errors: [404],
      }),
      put: op({
        tag: WALLET,
        summary: 'Add or change my bank account or UPI id',
        description:
          'Send only what changes. The account number is needed (with the IFSC) the first time a bank account is added; afterwards leave it out ' +
          'to keep it. An empty `upiId` removes it. Any change goes back to `PENDING` until the team checks it, and payouts are only sent to ' +
          'checked details. **409** if the account belongs to another vendor.',
        access: 'PROFESSIONAL',
        body: jsonBody(
          { type: 'object', minProperties: 1, properties: { accountHolderName: { type: 'string' }, accountNumber: { type: 'string', description: '9 to 18 digits' }, ifsc: { type: 'string', example: 'HDFC0001234' }, bankName: { type: 'string' }, branchName: { type: 'string' }, accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT'] }, upiId: { type: 'string', example: 'ravi@okhdfc' } } },
          { accountHolderName: 'Ravi Kumar', accountNumber: '50100123456789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', upiId: 'ravi@okhdfc' },
        ),
        responses: { 200: ok('Where I am paid', payoutAccount, { ...payoutAccountExample, status: 'PENDING' }) },
        errors: [404, 409],
      }),
    },
    '/payouts/vendors/{professionalId}/payout-account/verify': {
      post: op({
        tag: PAYOUTS,
        summary: 'Mark a vendor\'s bank details as checked',
        description: 'For details the vendor entered themselves: once verified, payouts can be sent there. **400** if there is nothing to verify.',
        access: 'ADMIN',
        params: [professionalId],
        responses: { 200: ok('Where the vendor is paid', payoutAccount, payoutAccountExample) },
        errors: [404],
      }),
    },
    '/payouts/vendors/{professionalId}/payout-account': {
      get: op({
        tag: PAYOUTS,
        summary: 'A vendor\'s bank account and UPI id',
        description: 'The account number is only ever shown masked.',
        access: 'ADMIN',
        params: [professionalId],
        responses: { 200: ok('Where the vendor is paid', payoutAccount, payoutAccountExample) },
        errors: [404],
      }),
      put: op({
        tag: PAYOUTS,
        summary: 'Add or change a vendor\'s bank account or UPI id',
        description:
          'Send only what changes. The account number is needed (with the IFSC) the first time a bank account is added; afterwards leave it out to ' +
          'keep it. An empty `upiId` removes the UPI id. Details entered here count as verified. **409** if the account belongs to another vendor.',
        access: 'SUPER_ADMIN',
        params: [professionalId],
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: {
              accountHolderName: { type: 'string' },
              accountNumber: { type: 'string', description: '9 to 18 digits' },
              ifsc: { type: 'string', example: 'HDFC0001234' },
              bankName: { type: 'string' },
              branchName: { type: 'string' },
              accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT'] },
              upiId: { type: 'string', example: 'ravi@hdfcbank' },
            },
          },
          { accountHolderName: 'Ravi Kumar', accountNumber: '50100123456789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', accountType: 'SAVINGS', upiId: 'ravi@hdfcbank' },
        ),
        responses: { 200: ok('Where the vendor is paid', payoutAccount, payoutAccountExample) },
        errors: [404, 409],
      }),
    },
    '/payouts/due': {
      get: op({
        tag: PAYOUTS,
        summary: 'Vendors who are owed money',
        description: 'One row per vendor with an unpaid balance, the largest amount ready to send first. `readyOnly=true` hides vendors whose money is all still on hold.',
        access: 'ADMIN',
        params: [queryParam('search', 'Vendor name, phone or email'), queryParam('readyOnly', 'Only vendors with something ready to send', { type: 'string', enum: ['true', 'false'] }), ...pageParams],
        responses: {
          200: pageWith(
            'A page of vendors',
            {
              type: 'object',
              properties: {
                ...vendorRef.properties,
                balance: amount(),
                readyForPayout: amount(),
                onHold: amount(),
                pendingEarnings: { type: 'integer' },
                readySince: { ...dateTime, nullable: true },
                bankAccountStatus: { type: 'string', description: 'Whether the vendor\'s bank details are verified — check before sending money' },
                payoutMethod: { type: 'string', enum: METHODS },
              },
            },
            { nextPayoutDate: { type: 'string', format: 'date', nullable: true }, totals: { type: 'object', properties: { vendors: { type: 'integer' }, balance: amount(), readyForPayout: amount() } } },
          ),
        },
      }),
    },
    '/payouts': {
      get: op({
        tag: PAYOUTS,
        summary: 'Payouts made',
        description: 'Newest first. Filter to one vendor, or search by transfer reference or vendor.',
        access: 'ADMIN',
        params: [queryParam('professionalId', 'Only this vendor', uuid), queryParam('search', 'Transfer reference, or vendor name / phone / email'), ...pageParams],
        responses: { 200: paginated('A page of payouts', payout) },
      }),
    },
    '/payouts/vendors/{professionalId}': {
      get: op({
        tag: PAYOUTS,
        summary: 'A vendor\'s wallet',
        access: 'ADMIN',
        params: [professionalId],
        responses: { 200: ok('The vendor and their wallet', { type: 'object', properties: { vendor: vendorRef, wallet } }, { vendor: vendorExample, wallet: walletExample }) },
        errors: [404],
      }),
      post: op({
        tag: PAYOUTS,
        summary: 'Record a payout to a vendor',
        description:
          'Call this **after** transferring the money. It settles everything the vendor has ready (not what is still on hold), records the ' +
          'transfer `reference`, and notifies the vendor. Returns **409** if nothing is ready.',
        access: 'SUPER_ADMIN',
        params: [professionalId],
        body: jsonBody(
          { type: 'object', required: ['reference'], properties: { reference: { type: 'string', minLength: 3, maxLength: 200, description: 'Bank / UPI transaction reference' }, method: { type: 'string', enum: METHODS, description: 'How it was sent; defaults to the vendor\'s payout method' }, includeOnHold: { type: 'boolean', description: 'Also settle earnings still on hold' }, note: { type: 'string', maxLength: 500 } } },
          { reference: payoutRef.reference },
        ),
        responses: { 201: ok('The payout', payout, payoutExample) },
        errors: [404, 409],
      }),
    },
    '/payouts/vendors/{professionalId}/transactions': {
      get: op({
        tag: PAYOUTS,
        summary: 'A vendor\'s transactions',
        access: 'ADMIN',
        params: [professionalId, ...transactionFilters],
        responses: { 200: paginated('A page of transactions', transaction) },
        errors: [404],
      }),
    },
    '/payouts/vendors/{professionalId}/pending': {
      get: op({
        tag: PAYOUTS,
        summary: 'What a vendor is still owed',
        access: 'ADMIN',
        params: [professionalId, ...pageParams],
        responses: { 200: pageWith('A page of unpaid earnings, with totals', transaction, pendingTotals) },
        errors: [404],
      }),
    },
  },
  examples: { earningExample, payoutEntryExample },
};
