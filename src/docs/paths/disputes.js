const { arrayOf, ok, paginated, jsonBody, pathParam, queryParam, dateParam, sortParams, pageParams, op } = require('../helpers');

const CUSTOMER = 'Customer app — help & disputes';
const VENDOR = 'Vendor app — help & disputes';
const ADMIN = 'Help & disputes (admin)';

const disputeId = pathParam('id', 'Dispute id');
const STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const CATEGORY = ['BOOKING', 'PAYMENT', 'REFUND', 'SERVICE_QUALITY', 'PROFESSIONAL_BEHAVIOUR', 'CUSTOMER_BEHAVIOUR', 'PAYOUT', 'ACCOUNT', 'APP_ISSUE', 'OTHER'];
const PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const dateTime = { type: 'string', format: 'date-time' };
const uuid = { type: 'string', format: 'uuid' };

const baseProperties = {
  id: uuid,
  reference: { type: 'string', example: 'DSP-000042', description: 'Human-friendly number to show and quote' },
  type: { type: 'string', enum: ['HELP', 'DISPUTE'] },
  category: { type: 'string', enum: CATEGORY },
  categoryLabel: { type: 'string', example: 'A refund' },
  subject: { type: 'string' },
  description: { type: 'string' },
  status: { type: 'string', enum: STATUS },
  booking: {
    type: 'object',
    nullable: true,
    description: 'The booking it is about, if one was given',
    properties: { id: uuid, bookingNumber: { type: 'string' }, status: { type: 'string' }, scheduledAt: { ...dateTime, nullable: true }, service: { type: 'object', properties: { id: uuid, name: { type: 'string' } } } },
  },
  resolution: { type: 'string', nullable: true, description: 'What support decided, once resolved' },
  messageCount: { type: 'integer' },
  actions: { type: 'object', properties: { canReply: { type: 'boolean' }, canClose: { type: 'boolean' }, canResolve: { type: 'boolean' } } },
  resolvedAt: { ...dateTime, nullable: true },
  closedAt: { ...dateTime, nullable: true },
  createdAt: dateTime,
  updatedAt: dateTime,
};
const adminProperties = {
  raisedBy: { type: 'object', properties: { id: uuid, name: { type: 'string' }, phone: { type: 'string', nullable: true }, role: { type: 'string', enum: ['CUSTOMER', 'PROFESSIONAL'] } } },
  priority: { type: 'string', enum: PRIORITY },
  assignedTo: { type: 'object', nullable: true, properties: { id: uuid, name: { type: 'string' } } },
};
const messages = arrayOf({
  type: 'object',
  properties: {
    id: uuid,
    body: { type: 'string' },
    authorRole: { type: 'string', enum: ['CUSTOMER', 'PROFESSIONAL', 'ADMIN'] },
    authorName: { type: 'string', description: 'Support staff appear as "Support" to customers and vendors' },
    mine: { type: 'boolean', description: 'True when the caller wrote it' },
    createdAt: dateTime,
  },
});

const item = (admin) => ({ type: 'object', properties: { ...baseProperties, ...(admin && adminProperties) } });
const detail = (admin) => ({ type: 'object', properties: { ...baseProperties, ...(admin && adminProperties), messages } });

const example = (role, { status = 'IN_PROGRESS', admin = false } = {}) => {
  const vendor = role === 'PROFESSIONAL';
  const resolved = status === 'RESOLVED';
  const thread = [
    { id: 'b1c2d3e4-1111-4a2b-9c3d-4e5f6a7b8c9d', body: 'We are checking this with the payments team and will update you today.', authorRole: 'ADMIN', authorName: admin ? 'Ops Reviewer' : 'Support', mine: admin, createdAt: '2026-10-13T10:05:00.000Z' },
    { id: 'b1c2d3e4-2222-4a2b-9c3d-4e5f6a7b8c9d', body: 'Thank you. Please let me know.', authorRole: role, authorName: vendor ? 'Ravi Kumar' : 'Aarav Mehta', mine: !admin, createdAt: '2026-10-13T10:12:00.000Z' },
  ];
  return {
    id: 'd1e2f3a4-5555-4b6c-8d7e-9f0a1b2c3d4e',
    reference: 'DSP-000042',
    type: 'DISPUTE',
    category: vendor ? 'PAYOUT' : 'REFUND',
    categoryLabel: vendor ? 'My earnings or payout' : 'A refund',
    subject: vendor ? 'Payment for a completed job not received' : 'Refund not received for a cancelled booking',
    description: vendor ? 'I completed this job three days ago and have not been paid for it.' : 'I cancelled this booking on 9 October and paid online, but the refund has not arrived.',
    status,
    booking: { id: '5e4d3c2b-4444-4a1b-8c9d-0e1f2a3b4c5d', bookingNumber: 'BK-000123', status: vendor ? 'COMPLETED' : 'CANCELLED', scheduledAt: '2026-10-09T04:30:00.000Z', service: { id: '3f2e1d0c-2222-4b3a-8c7d-6e5f4a3b2c1d', name: 'Electrician' } },
    resolution: resolved ? 'The amount was sent to your account on 13 October.' : null,
    messageCount: thread.length,
    ...(admin && { raisedBy: { id: '9c8b7a6d-5555-4f4e-8d3c-2b1a0f9e8d7c', name: vendor ? 'Ravi Kumar' : 'Aarav Mehta', phone: '+919812345678', role }, priority: 'HIGH', assignedTo: { id: 'a1b2c3d4-0000-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ops Reviewer' } }),
    actions: { canReply: true, canClose: !admin, canResolve: admin && !resolved },
    resolvedAt: resolved ? '2026-10-13T12:30:00.000Z' : null,
    closedAt: null,
    createdAt: '2026-10-13T09:40:00.000Z',
    updatedAt: '2026-10-13T10:12:00.000Z',
    messages: thread,
  };
};

const CATEGORIES_FOR = {
  CUSTOMER: [
    { key: 'BOOKING', label: 'A booking' },
    { key: 'PAYMENT', label: 'A payment' },
    { key: 'REFUND', label: 'A refund' },
    { key: 'SERVICE_QUALITY', label: 'Quality of the work' },
    { key: 'PROFESSIONAL_BEHAVIOUR', label: "The professional's behaviour" },
    { key: 'ACCOUNT', label: 'My account' },
    { key: 'APP_ISSUE', label: 'A problem with the app' },
    { key: 'OTHER', label: 'Something else' },
  ],
  PROFESSIONAL: [
    { key: 'BOOKING', label: 'A booking' },
    { key: 'PAYMENT', label: 'A payment' },
    { key: 'CUSTOMER_BEHAVIOUR', label: "The customer's behaviour" },
    { key: 'PAYOUT', label: 'My earnings or payout' },
    { key: 'ACCOUNT', label: 'My account' },
    { key: 'APP_ISSUE', label: 'A problem with the app' },
    { key: 'OTHER', label: 'Something else' },
  ],
};

// The same six endpoints for each app; only the prefix, the role and the wording differ.
const ownPaths = (prefix, tag, role) => {
  const who = role === 'CUSTOMER' ? 'customer' : 'vendor';
  const bookings = role === 'CUSTOMER' ? 'a booking the customer made' : 'a job assigned to the vendor';
  const keys = CATEGORIES_FOR[role].map((category) => category.key);
  const mine = example(role);
  return {
    [`${prefix}/disputes/categories`]: {
      get: op({
        tag,
        summary: 'What I can raise an issue about',
        description: `The categories a ${who} can choose from, with the label to show. Use the \`key\` as \`category\` when raising one.`,
        access: role,
        responses: { 200: ok('Categories', arrayOf({ type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' } } }), CATEGORIES_FOR[role]) },
      }),
    },
    [`${prefix}/disputes`]: {
      post: op({
        tag,
        summary: 'Ask for help or raise a dispute',
        description:
          '`type` is `HELP` for a question or request and `DISPUTE` for a complaint that needs a decision (the default). ' +
          `Give \`bookingId\` when it is about a booking — it must be ${bookings}, otherwise **400**.\n\n` +
          'It starts as `OPEN`. The support team replies in the thread; the app is sent a push notification for each reply.',
        access: role,
        body: jsonBody(
          {
            type: 'object',
            required: ['category', 'subject', 'description'],
            properties: {
              type: { type: 'string', enum: ['HELP', 'DISPUTE'], default: 'DISPUTE' },
              category: { type: 'string', enum: keys },
              subject: { type: 'string', minLength: 3, maxLength: 150 },
              description: { type: 'string', minLength: 10, maxLength: 2000 },
              bookingId: { ...uuid, description: 'The booking it is about, if any' },
            },
          },
          { type: mine.type, category: mine.category, subject: mine.subject, description: mine.description, bookingId: mine.booking.id },
        ),
        responses: { 201: ok('Raised', detail(false), { ...mine, status: 'OPEN', messageCount: 0, messages: [] }) },
      }),
      get: op({
        tag,
        summary: 'List what I have raised',
        description: `Everything the signed-in ${who} has raised, newest first.`,
        access: role,
        params: [
          queryParam('status', `One status, or several separated by commas. One of: ${STATUS.join(', ')}`, { type: 'string', example: 'OPEN,IN_PROGRESS' }),
          queryParam('type', 'Only help requests, or only disputes', { type: 'string', enum: ['HELP', 'DISPUTE'] }),
          queryParam('bookingId', 'Only those about this booking', uuid),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of disputes', item(false)) },
      }),
    },
    [`${prefix}/disputes/{id}`]: {
      get: op({
        tag,
        summary: 'Get one, with its conversation',
        description: 'The dispute with every message in order. `actions` says whether the caller can still reply or close it. Someone else\'s returns **404**.',
        access: role,
        params: [disputeId],
        responses: { 200: ok('The dispute', detail(false), mine) },
        errors: [404],
      }),
    },
    [`${prefix}/disputes/{id}/messages`]: {
      post: op({
        tag,
        summary: 'Reply in the conversation',
        description: 'Adds a message. Replying after it was `RESOLVED` reopens it. Returns **409** once it is `CLOSED`.',
        access: role,
        params: [disputeId],
        body: jsonBody({ type: 'object', required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 2000 } } }, { message: 'Thank you. Please let me know.' }),
        responses: { 201: ok('The dispute, with the new message', detail(false), mine) },
        errors: [404, 409],
      }),
    },
    [`${prefix}/disputes/{id}/close`]: {
      post: op({
        tag,
        summary: 'Close it — nothing more is needed',
        description: 'Marks it `CLOSED`. It can no longer be replied to; raise a new one if the problem returns. Returns **409** if already closed.',
        access: role,
        params: [disputeId],
        responses: { 200: ok('Closed', detail(false), { ...mine, status: 'CLOSED', closedAt: '2026-10-13T12:40:00.000Z', actions: { canReply: false, canClose: false, canResolve: false } }) },
        errors: [404, 409],
      }),
    },
  };
};

const adminExample = example('CUSTOMER', { admin: true });

module.exports = {
  tags: [
    { name: CUSTOMER, description: 'The customer asks for help or raises a dispute — about a booking, a payment, a refund, the work, the professional, their account or the app — and follows the conversation with support.' },
    { name: VENDOR, description: 'The vendor asks for help or raises a dispute — about a job, a payment or payout, a customer, their account or the app — and follows the conversation with support.' },
    {
      name: ADMIN,
      description:
        'The support team\'s side: every help request and dispute with filters and headline counts, the conversation, and the decisions ' +
        '(set priority, assign, reply, resolve, close).\n\n' +
        '**Status** — `OPEN` (new) → `IN_PROGRESS` (support has replied) → `RESOLVED` (support\'s decision, recorded as `resolution`) or ' +
        '`CLOSED` (withdrawn, or nothing more to do). A reply from the person after `RESOLVED` reopens it.',
    },
  ],
  paths: {
    ...ownPaths('/customer', CUSTOMER, 'CUSTOMER'),
    ...ownPaths('/vendor', VENDOR, 'PROFESSIONAL'),

    '/disputes': {
      get: op({
        tag: ADMIN,
        summary: 'List help requests and disputes',
        description:
          'All filters combine (AND).\n\n' +
          '- Needs attention: `status=OPEN,IN_PROGRESS&sortBy=priority&sortOrder=desc` (most urgent first)\n' +
          '- Nobody on it yet: `unassigned=true`\n' +
          '- From vendors only: `raisedByRole=PROFESSIONAL`\n' +
          '- Everything one person raised: `userId=…`\n' +
          '- Find by reference: `search=DSP-000042`',
        access: 'ADMIN',
        params: [
          queryParam('status', `One or several, comma-separated: ${STATUS.join(', ')}`, { type: 'string', example: 'OPEN,IN_PROGRESS' }),
          queryParam('type', 'Help requests or disputes', { type: 'string', enum: ['HELP', 'DISPUTE'] }),
          queryParam('category', `One or several, comma-separated: ${CATEGORY.join(', ')}`),
          queryParam('priority', `One or several, comma-separated: ${PRIORITY.join(', ')}`),
          queryParam('raisedByRole', 'Raised by customers or by vendors', { type: 'string', enum: ['CUSTOMER', 'PROFESSIONAL'] }),
          queryParam('userId', 'Raised by this user', uuid),
          queryParam('bookingId', 'About this booking', uuid),
          queryParam('assignedToId', 'Handled by this admin', uuid),
          queryParam('unassigned', '`true` for those nobody is handling', { type: 'string', enum: ['true', 'false'] }),
          queryParam('search', 'A reference (`DSP-000042` matches that one only), or part of the subject, or the person\'s name / phone / email'),
          dateParam('createdFrom', 'Raised on or after this date'),
          dateParam('createdTo', 'Raised on or before this date'),
          ...sortParams(['createdAt', 'updatedAt', 'priority'], 'createdAt', 'desc'),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of disputes', item(true)) },
      }),
    },
    '/disputes/summary': {
      get: op({
        tag: ADMIN,
        summary: 'Counts for the support dashboard',
        description: '`byStatus` covers everything. The other figures count only what still needs attention (`OPEN` or `IN_PROGRESS`).',
        access: 'ADMIN',
        responses: {
          200: ok(
            'Summary',
            {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
                needingAttention: { type: 'integer' },
                activeByType: { type: 'object', additionalProperties: { type: 'integer' } },
                activeByPriority: { type: 'object', additionalProperties: { type: 'integer' } },
                unassigned: { type: 'integer' },
              },
            },
            { total: 212, byStatus: { OPEN: 14, IN_PROGRESS: 9, RESOLVED: 151, CLOSED: 38 }, needingAttention: 23, activeByType: { HELP: 8, DISPUTE: 15 }, activeByPriority: { URGENT: 1, HIGH: 4, NORMAL: 16, LOW: 2 }, unassigned: 6 },
          ),
        },
      }),
    },
    '/disputes/{id}': {
      get: op({
        tag: ADMIN,
        summary: 'Get one, with its conversation',
        description: 'Includes who raised it, its priority and who is handling it.',
        access: 'ADMIN',
        params: [disputeId],
        responses: { 200: ok('The dispute', detail(true), adminExample) },
        errors: [404],
      }),
      patch: op({
        tag: ADMIN,
        summary: 'Set priority, assign, or change status',
        description:
          'Send only what changes. `assignedToId` must be an admin (`null` unassigns). `status` may be `OPEN` or `IN_PROGRESS` (which reopens a ' +
          'resolved or closed one) or `CLOSED`; to resolve, use **Resolve** so the decision is recorded.',
        access: 'ADMIN',
        params: [disputeId],
        body: jsonBody(
          {
            type: 'object',
            minProperties: 1,
            properties: { status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'CLOSED'] }, priority: { type: 'string', enum: PRIORITY }, assignedToId: { ...uuid, nullable: true } },
          },
          { priority: 'HIGH', assignedToId: adminExample.assignedTo.id },
        ),
        responses: { 200: ok('Updated', detail(true), adminExample) },
        errors: [404],
      }),
    },
    '/disputes/{id}/messages': {
      post: op({
        tag: ADMIN,
        summary: 'Reply to the customer or vendor',
        description: 'Adds a message and notifies the person. The first reply moves an `OPEN` dispute to `IN_PROGRESS`. Returns **409** once it is `CLOSED`.',
        access: 'ADMIN',
        params: [disputeId],
        body: jsonBody({ type: 'object', required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 2000 } } }, { message: 'We are checking this with the payments team and will update you today.' }),
        responses: { 201: ok('The dispute, with the new message', detail(true), adminExample) },
        errors: [404, 409],
      }),
    },
    '/disputes/{id}/resolve': {
      post: op({
        tag: ADMIN,
        summary: 'Resolve with a decision',
        description:
          'Records `resolution`, marks it `RESOLVED`, adds the decision to the conversation and notifies the person. If nobody was assigned, ' +
          'the admin resolving it becomes the assignee. Returns **409** if it is already resolved or closed.',
        access: 'ADMIN',
        params: [disputeId],
        body: jsonBody({ type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', minLength: 5, maxLength: 2000 } } }, { resolution: 'The amount was sent to your account on 13 October.' }),
        responses: { 200: ok('Resolved', detail(true), example('CUSTOMER', { admin: true, status: 'RESOLVED' })) },
        errors: [404, 409],
      }),
    },
  },
};
