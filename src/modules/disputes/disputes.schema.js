const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, booleanFlag, dateOnly, sortOrder } = require('../../utils/queryFilters');

const TYPES = ['HELP', 'DISPUTE'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

// What each side can raise something about. The label is what the app shows.
const CATEGORIES = {
  BOOKING: { label: 'A booking', for: ['CUSTOMER', 'PROFESSIONAL'] },
  PAYMENT: { label: 'A payment', for: ['CUSTOMER', 'PROFESSIONAL'] },
  REFUND: { label: 'A refund', for: ['CUSTOMER'] },
  SERVICE_QUALITY: { label: 'Quality of the work', for: ['CUSTOMER'] },
  PROFESSIONAL_BEHAVIOUR: { label: "The professional's behaviour", for: ['CUSTOMER'] },
  CUSTOMER_BEHAVIOUR: { label: "The customer's behaviour", for: ['PROFESSIONAL'] },
  PAYOUT: { label: 'My earnings or payout', for: ['PROFESSIONAL'] },
  ACCOUNT: { label: 'My account', for: ['CUSTOMER', 'PROFESSIONAL'] },
  APP_ISSUE: { label: 'A problem with the app', for: ['CUSTOMER', 'PROFESSIONAL'] },
  OTHER: { label: 'Something else', for: ['CUSTOMER', 'PROFESSIONAL'] },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

const disputeId = z.object({ id: z.uuid() });
const message = z.string().trim().min(1, 'Write a message').max(2000);

const create = {
  body: z.object({
    type: z.enum(TYPES).default('DISPUTE'),
    category: z.enum(CATEGORY_KEYS),
    subject: z.string().trim().min(3, 'Give a subject of at least 3 characters').max(150),
    description: z.string().trim().min(10, 'Describe the issue in at least 10 characters').max(2000),
    bookingId: z.uuid().optional(), // the booking it is about, if any
  }),
};

const listMine = {
  query: paginationQuery.extend({
    status: commaList(STATUSES).optional(),
    type: z.enum(TYPES).optional(),
    bookingId: z.uuid().optional(),
  }),
};

const one = { params: disputeId };
const reply = { params: disputeId, body: z.object({ message }) };

// --- Support team ---

const listAll = {
  query: paginationQuery.extend({
    status: commaList(STATUSES).optional(),
    type: z.enum(TYPES).optional(),
    category: commaList(CATEGORY_KEYS).optional(),
    priority: commaList(PRIORITIES).optional(),
    raisedByRole: z.enum(['CUSTOMER', 'PROFESSIONAL']).optional(),
    userId: z.uuid().optional(), // everything one person has raised
    bookingId: z.uuid().optional(),
    assignedToId: z.uuid().optional(),
    unassigned: booleanFlag.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'priority']).default('createdAt'),
    sortOrder: sortOrder.default('desc'),
  }),
};

const update = {
  params: disputeId,
  body: z
    .object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(), // RESOLVED goes through /resolve, with a resolution
      priority: z.enum(PRIORITIES).optional(),
      assignedToId: z.uuid().nullable().optional(), // null = unassign
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

const resolve = {
  params: disputeId,
  body: z.object({ resolution: z.string().trim().min(5, 'Say what was decided, in at least 5 characters').max(2000) }),
};

module.exports = { TYPES, STATUSES, PRIORITIES, CATEGORIES, CATEGORY_KEYS, create, listMine, one, reply, listAll, update, resolve };
