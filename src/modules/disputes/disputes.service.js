const prisma = require('../../config/prisma');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const notifications = require('../notifications/notifications.service');
const { isAdmin } = require('../../utils/roles');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { dateRange, personSearch } = require('../../utils/queryFilters');
const { bookingNumber } = require('../bookings/bookings.service');
const { CATEGORIES, STATUSES, PRIORITIES } = require('./disputes.schema');

// Help & disputes. A customer or a vendor raises one (optionally about a
// booking of theirs), the support team answers in a thread, and it ends
// RESOLVED (support's decision) or CLOSED (withdrawn, or nothing more to do).

const reference = (sequence) => `DSP-${String(sequence).padStart(6, '0')}`;
const roleOf = (user) => (isAdmin(user.role) ? 'ADMIN' : user.role === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'CUSTOMER');
const person = { select: { id: true, name: true, phone: true } };

const include = {
  raisedBy: person,
  assignedTo: { select: { id: true, name: true } },
  booking: { select: { id: true, sequence: true, status: true, scheduledAt: true, category: { select: { id: true, name: true } } } },
  _count: { select: { messages: true } },
};

const toView = (dispute, viewer) => {
  const staff = isAdmin(viewer.role);
  const open = dispute.status !== 'CLOSED';
  return {
    id: dispute.id,
    reference: reference(dispute.sequence),
    type: dispute.type,
    category: dispute.category,
    categoryLabel: CATEGORIES[dispute.category].label,
    subject: dispute.subject,
    description: dispute.description,
    status: dispute.status,
    booking: dispute.booking
      ? { id: dispute.booking.id, bookingNumber: bookingNumber(dispute.booking.sequence), status: dispute.booking.status, scheduledAt: dispute.booking.scheduledAt, service: dispute.booking.category }
      : null,
    resolution: dispute.resolution,
    messageCount: dispute._count.messages,
    // Who raised it, how urgent it is and who is handling it are for the support team.
    ...(staff && { raisedBy: { ...dispute.raisedBy, role: dispute.raisedByRole }, priority: dispute.priority, assignedTo: dispute.assignedTo }),
    actions: {
      canReply: open,
      canClose: !staff && open,
      canResolve: staff && ['OPEN', 'IN_PROGRESS'].includes(dispute.status),
    },
    resolvedAt: dispute.resolvedAt,
    closedAt: dispute.closedAt,
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
  };
};

const loadMessages = async (disputeId, viewer) => {
  const staff = isAdmin(viewer.role);
  const messages = await prisma.disputeMessage.findMany({
    where: { disputeId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, body: true, authorRole: true, authorId: true, createdAt: true, author: { select: { name: true } } },
  });
  return messages.map(({ authorId, author, ...message }) => ({
    ...message,
    // Customers and vendors see the team as "Support", not individual staff names.
    authorName: message.authorRole === 'ADMIN' && !staff ? 'Support' : (author?.name ?? 'Deleted user'),
    mine: authorId === viewer.id,
  }));
};

const find = async (id) => {
  const dispute = await prisma.dispute.findUnique({ where: { id }, include });
  if (!dispute) throw ApiError.notFound('Dispute not found');
  return dispute;
};

// The person who raised it, or the support team. Anyone else is told it does not exist.
const findFor = async (id, viewer) => {
  const dispute = await find(id);
  if (!isAdmin(viewer.role) && dispute.raisedById !== viewer.id) throw ApiError.notFound('Dispute not found');
  return dispute;
};

const detail = async (id, viewer) => ({ ...toView(await find(id), viewer), messages: await loadMessages(id, viewer) });

const notify = (dispute, title, body) => {
  notifications
    .sendPushNotification(dispute.raisedById, { title, body, data: { type: 'DISPUTE', disputeId: dispute.id, status: dispute.status } })
    .catch((err) => logger.warn({ err: err.message, userId: dispute.raisedById }, 'Failed to send dispute notification'));
};

// ---------------------------------------------------------------------------
// Customers and vendors
// ---------------------------------------------------------------------------

const categoriesFor = (user) =>
  Object.entries(CATEGORIES)
    .filter(([, category]) => category.for.includes(roleOf(user)))
    .map(([key, category]) => ({ key, label: category.label }));

const create = async (user, { bookingId, ...data }) => {
  const role = roleOf(user);
  if (!CATEGORIES[data.category].for.includes(role)) throw ApiError.badRequest('This category does not apply to your account');

  if (bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true, professional: { select: { userId: true } } } });
    const theirs = booking && (role === 'CUSTOMER' ? booking.customerId === user.id : booking.professional?.userId === user.id);
    if (!theirs) throw ApiError.badRequest('Choose one of your own bookings');
  }

  const dispute = await prisma.dispute.create({ data: { ...data, bookingId: bookingId ?? null, raisedById: user.id, raisedByRole: role } });
  return detail(dispute.id, user);
};

const listMine = async (user, { page, limit, status, type, bookingId }) => {
  const where = { raisedById: user.id, ...(status && { status: { in: status } }), ...(type && { type }), ...(bookingId && { bookingId }) };
  const [rows, total] = await Promise.all([
    prisma.dispute.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' }, include }),
    prisma.dispute.count({ where }),
  ]);
  return paginatedResponse(rows.map((row) => toView(row, user)), total, { page, limit });
};

const getOne = async (id, viewer) => {
  await findFor(id, viewer);
  return detail(id, viewer);
};

// Adds a message to the thread. A reply from support moves a new dispute to
// IN_PROGRESS; a reply from the person after it was resolved reopens it.
const reply = async (id, viewer, body) => {
  const dispute = await findFor(id, viewer);
  if (dispute.status === 'CLOSED') throw ApiError.conflict('This is closed. Raise a new one if you still need help.');

  const staff = isAdmin(viewer.role);
  const nextStatus = staff ? (dispute.status === 'OPEN' ? 'IN_PROGRESS' : dispute.status) : dispute.status === 'RESOLVED' ? 'OPEN' : dispute.status;
  await prisma.$transaction([
    prisma.disputeMessage.create({ data: { disputeId: id, authorId: viewer.id, authorRole: roleOf(viewer), body } }),
    prisma.dispute.update({ where: { id }, data: { status: nextStatus, ...(nextStatus === 'OPEN' && dispute.status === 'RESOLVED' && { resolvedAt: null }) } }),
  ]);
  if (staff) notify({ ...dispute, status: nextStatus }, 'Support replied', `New reply on ${reference(dispute.sequence)}: ${dispute.subject}`);
  return detail(id, viewer);
};

// The person who raised it says they need nothing more.
const close = async (id, viewer) => {
  const dispute = await findFor(id, viewer);
  if (dispute.status === 'CLOSED') throw ApiError.conflict('This is already closed');
  await prisma.dispute.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
  return detail(id, viewer);
};

// ---------------------------------------------------------------------------
// Support team
// ---------------------------------------------------------------------------

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

const listAll = async (viewer, query) => {
  const { page, limit, status, type, category, priority, raisedByRole, userId, bookingId, assignedToId, unassigned, search, sortBy, sortOrder } = query;
  const createdAt = dateRange(query.createdFrom, query.createdTo);
  const ref = search?.match(/^dsp-?0*(\d+)$/i);
  const where = {
    ...(status && { status: { in: status } }),
    ...(type && { type }),
    ...(category && { category: { in: category } }),
    ...(priority && { priority: { in: priority } }),
    ...(raisedByRole && { raisedByRole }),
    ...(userId && { raisedById: userId }),
    ...(bookingId && { bookingId }),
    ...(assignedToId && { assignedToId }),
    ...(unassigned && { assignedToId: null }),
    ...(createdAt && { createdAt }),
    // "DSP-000123" is a reference and matches that one; anything else searches the subject and the person.
    ...(search && (ref ? { sequence: Number(ref[1]) } : { OR: [{ subject: { contains: search, mode: 'insensitive' } }, { raisedBy: personSearch(search) }] })),
  };

  // Prisma sorts enums by declaration order (LOW first), so "desc" is most urgent first.
  const orderBy = sortBy === 'priority' ? [{ priority: sortOrder }, { createdAt: 'asc' }] : [{ [sortBy]: sortOrder }];
  const [rows, total] = await Promise.all([
    prisma.dispute.findMany({ where, ...toSkipTake({ page, limit }), orderBy, include }),
    prisma.dispute.count({ where }),
  ]);
  return paginatedResponse(rows.map((row) => toView(row, viewer)), total, { page, limit });
};

const getSummary = async () => {
  const active = { status: { in: ['OPEN', 'IN_PROGRESS'] } };
  const [byStatusRows, byTypeRows, byPriorityRows, unassigned] = await Promise.all([
    prisma.dispute.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.dispute.groupBy({ by: ['type'], where: active, _count: { _all: true } }),
    prisma.dispute.groupBy({ by: ['priority'], where: active, _count: { _all: true } }),
    prisma.dispute.count({ where: { ...active, assignedToId: null } }),
  ]);
  const tally = (keys, rows, field) => Object.fromEntries(keys.map((key) => [key, rows.find((row) => row[field] === key)?._count._all ?? 0]));
  const byStatus = tally(STATUSES, byStatusRows, 'status');
  const byPriority = tally(PRIORITIES, byPriorityRows, 'priority');
  return {
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    byStatus,
    // The rest count only what still needs attention (open or in progress).
    needingAttention: byStatus.OPEN + byStatus.IN_PROGRESS,
    activeByType: tally(['HELP', 'DISPUTE'], byTypeRows, 'type'),
    activeByPriority: Object.fromEntries(Object.keys(PRIORITY_RANK).map((key) => [key, byPriority[key]])),
    unassigned,
  };
};

const update = async (id, { status, priority, assignedToId }, viewer) => {
  const dispute = await find(id);
  if (assignedToId) {
    const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
    if (!assignee || assignee.deletedAt || !isAdmin(assignee.role)) throw ApiError.badRequest('A dispute can only be assigned to an admin');
  }
  await prisma.dispute.update({
    where: { id },
    data: {
      ...(priority && { priority }),
      ...(assignedToId !== undefined && { assignedToId }),
      ...(status && {
        status,
        closedAt: status === 'CLOSED' ? new Date() : null,
        // Reopening sets the decision aside until it is resolved again.
        ...(status !== 'CLOSED' && { resolvedAt: null }),
      }),
    },
  });
  if (status === 'CLOSED' && dispute.status !== 'CLOSED') notify({ ...dispute, status }, 'Request closed', `${reference(dispute.sequence)} has been closed.`);
  return detail(id, viewer);
};

const resolve = async (id, resolution, viewer) => {
  const dispute = await find(id);
  if (!['OPEN', 'IN_PROGRESS'].includes(dispute.status)) throw ApiError.conflict(`This is already ${dispute.status}`);
  await prisma.$transaction([
    prisma.dispute.update({ where: { id }, data: { status: 'RESOLVED', resolution, resolvedAt: new Date(), assignedToId: dispute.assignedToId ?? viewer.id } }),
    prisma.disputeMessage.create({ data: { disputeId: id, authorId: viewer.id, authorRole: 'ADMIN', body: resolution } }),
  ]);
  notify({ ...dispute, status: 'RESOLVED' }, 'Resolved', `${reference(dispute.sequence)} has been resolved: ${resolution}`);
  return detail(id, viewer);
};

module.exports = { reference, categoriesFor, create, listMine, getOne, reply, close, listAll, getSummary, update, resolve };
