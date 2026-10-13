const prisma = require('../../config/prisma');
const env = require('../../config/env');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const notifications = require('../notifications/notifications.service');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { personSearch } = require('../../utils/queryFilters');

// The vendor wallet. Completing a job credits the vendor with an EARNING. It
// is held for PAYOUT_HOLD_DAYS, then is ready to be sent; the team sends the
// money to the vendor's bank account and records a PAYOUT, which marks the
// earnings it covers as PAID. If the vendor took the customer's cash
// themselves, the earning is SETTLED_IN_CASH and nothing is owed for it.

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;
const payoutNumber = (sequence) => `PO-${String(sequence).padStart(6, '0')}`;

// Earnings still to be sent, split by whether their hold has ended.
const unpaid = (professionalId) => ({ professionalId, type: 'EARNING', status: 'PENDING' });
const onHold = (professionalId, now) => ({ ...unpaid(professionalId), availableAt: { gt: now } });
const ready = (professionalId, now) => ({ ...unpaid(professionalId), availableAt: { lte: now } });

const entryInclude = {
  booking: { select: { id: true, sequence: true, completedAt: true, category: { select: { id: true, name: true } } } },
  payout: { select: { id: true, sequence: true, reference: true, paidAt: true } },
};

const toView = (entry, now = new Date()) => {
  const earning = entry.type === 'EARNING';
  const status = !earning || entry.status !== 'PENDING' ? entry.status : entry.availableAt > now ? 'ON_HOLD' : 'READY';
  return {
    id: entry.id,
    type: entry.type,
    // Money coming to the vendor (a job) or going out to their bank (a payout).
    direction: earning ? 'CREDIT' : 'DEBIT',
    title: earning ? `Earning${entry.booking ? ` for ${bookingNumber(entry.booking.sequence)}` : ''}` : `Payout${entry.payout ? ` ${payoutNumber(entry.payout.sequence)}` : ''}`,
    amount: money(entry.amount),
    grossAmount: earning ? money(entry.grossAmount) : null,
    commission: earning ? money(entry.commission) : null,
    status,
    // ON_HOLD: when it becomes ready to be sent.
    availableAt: earning ? entry.availableAt : null,
    booking: entry.booking ? { id: entry.booking.id, bookingNumber: bookingNumber(entry.booking.sequence), service: entry.booking.category, completedAt: entry.booking.completedAt } : null,
    payout: entry.payout ? { id: entry.payout.id, payoutNumber: payoutNumber(entry.payout.sequence), reference: entry.payout.reference, paidAt: entry.payout.paidAt } : null,
    note: entry.note,
    createdAt: entry.createdAt,
  };
};

// ---------------------------------------------------------------------------
// Called by the booking flow
// ---------------------------------------------------------------------------

// Credits the vendor for a completed job. Safe to call twice: one earning per booking.
const creditForBooking = async (tx, booking) => {
  if (!booking.professionalId || booking.price === null) return null;
  const gross = money(booking.price);
  const commission = money((gross * env.PLATFORM_COMMISSION_PERCENT) / 100);
  const tookCash = booking.payment?.status === 'SUCCESS' && booking.payment.method === 'CASH';
  const data = {
    professionalId: booking.professionalId,
    type: 'EARNING',
    status: tookCash ? 'SETTLED_IN_CASH' : 'PENDING',
    amount: money(gross - commission),
    grossAmount: gross,
    commission,
    availableAt: new Date(Date.now() + env.PAYOUT_HOLD_DAYS * DAY_MS),
    note: tookCash ? 'Paid in cash to the vendor' : null,
  };
  return tx.walletEntry.upsert({ where: { bookingId: booking.id }, update: {}, create: { ...data, bookingId: booking.id } });
};

// The customer paid the vendor in cash: the vendor already has the money.
const settleInCash = (tx, bookingId) =>
  tx.walletEntry.updateMany({ where: { bookingId, type: 'EARNING', status: 'PENDING' }, data: { status: 'SETTLED_IN_CASH', note: 'Paid in cash to the vendor' } });

// ---------------------------------------------------------------------------
// The vendor's view
// ---------------------------------------------------------------------------

const sum = async (where) => money((await prisma.walletEntry.aggregate({ where, _sum: { amount: true } }))._sum.amount);

const summarise = async (professionalId) => {
  const now = new Date();
  const [held, readyNow, paidOut, cash, nextRelease, lastPayout, jobs] = await Promise.all([
    sum(onHold(professionalId, now)),
    sum(ready(professionalId, now)),
    sum({ professionalId, type: 'PAYOUT' }),
    sum({ professionalId, type: 'EARNING', status: 'SETTLED_IN_CASH' }),
    prisma.walletEntry.findFirst({ where: onHold(professionalId, now), orderBy: { availableAt: 'asc' }, select: { availableAt: true, amount: true } }),
    prisma.vendorPayout.findFirst({ where: { professionalId }, orderBy: { paidAt: 'desc' }, select: { id: true, sequence: true, amount: true, paidAt: true, reference: true } }),
    prisma.walletEntry.count({ where: { professionalId, type: 'EARNING' } }),
  ]);
  return {
    currency: 'INR',
    // Everything earned that has not been sent to the vendor yet.
    balance: money(held + readyNow),
    onHold: held,
    readyForPayout: readyNow,
    totalPaidOut: paidOut,
    collectedInCash: cash,
    totalEarned: money(held + readyNow + paidOut + cash),
    jobsPaidFor: jobs,
    holdDays: env.PAYOUT_HOLD_DAYS,
    nextRelease: nextRelease ? { at: nextRelease.availableAt, amount: money(nextRelease.amount) } : null,
    lastPayout: lastPayout ? { id: lastPayout.id, payoutNumber: payoutNumber(lastPayout.sequence), amount: money(lastPayout.amount), paidAt: lastPayout.paidAt, reference: lastPayout.reference } : null,
  };
};

const professionalOf = async (userId) => {
  const professional = await prisma.professional.findUnique({ where: { userId }, select: { id: true } });
  if (!professional) throw ApiError.notFound('Vendor profile not found');
  return professional.id;
};

const getMyWallet = async (user) => summarise(await professionalOf(user.id));

const listEntries = async (professionalId, { page, limit, type, status }) => {
  const now = new Date();
  const byStatus = {
    ON_HOLD: onHold(professionalId, now),
    READY: ready(professionalId, now),
    PENDING: unpaid(professionalId),
    PAID: { professionalId, status: 'PAID' },
    SETTLED_IN_CASH: { professionalId, status: 'SETTLED_IN_CASH' },
  };
  const where = { ...(status ? byStatus[status] : { professionalId }), ...(type && { type }) };
  const [rows, total] = await Promise.all([
    prisma.walletEntry.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' }, include: entryInclude }),
    prisma.walletEntry.count({ where }),
  ]);
  return paginatedResponse(rows.map((row) => toView(row, now)), total, { page, limit });
};

const listMyTransactions = async (user, query) => listEntries(await professionalOf(user.id), query);

// What is still to be sent: each unpaid earning, soonest release first, with the totals.
const listPendingFor = async (professionalId, { page, limit }) => {
  const now = new Date();
  const where = unpaid(professionalId);
  const [rows, total, held, readyNow] = await Promise.all([
    prisma.walletEntry.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { availableAt: 'asc' }, include: entryInclude }),
    prisma.walletEntry.count({ where }),
    sum(onHold(professionalId, now)),
    sum(ready(professionalId, now)),
  ]);
  return { ...paginatedResponse(rows.map((row) => toView(row, now)), total, { page, limit }), totals: { pending: money(held + readyNow), onHold: held, readyForPayout: readyNow } };
};

const listMyPending = async (user, query) => listPendingFor(await professionalOf(user.id), query);

// ---------------------------------------------------------------------------
// The team's side: who is owed what, and recording that it was sent
// ---------------------------------------------------------------------------

const vendorSummary = { select: { id: true, user: { select: { id: true, name: true, phone: true } } } };
const vendorView = (professional) => ({ professionalId: professional.id, userId: professional.user.id, name: professional.user.name, phone: professional.user.phone });

// Vendors with money in their wallet, the ones with the most ready to send first.
const listDue = async ({ page, limit, search, readyOnly }) => {
  const now = new Date();
  const groups = await prisma.walletEntry.groupBy({
    by: ['professionalId'],
    where: { type: 'EARNING', status: 'PENDING', ...(search && { professional: { user: personSearch(search) } }) },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const readyGroups = await prisma.walletEntry.groupBy({
    by: ['professionalId'],
    where: { type: 'EARNING', status: 'PENDING', availableAt: { lte: now }, professionalId: { in: groups.map((group) => group.professionalId) } },
    _sum: { amount: true },
    _min: { availableAt: true },
  });
  const readyBy = new Map(readyGroups.map((group) => [group.professionalId, group]));

  const rows = groups
    .map((group) => {
      const readyRow = readyBy.get(group.professionalId);
      const readyAmount = money(readyRow?._sum.amount);
      const balance = money(group._sum.amount);
      return { professionalId: group.professionalId, balance, readyForPayout: readyAmount, onHold: money(balance - readyAmount), pendingEarnings: group._count._all, readySince: readyRow?._min.availableAt ?? null };
    })
    .filter((row) => !readyOnly || row.readyForPayout > 0)
    .sort((a, b) => b.readyForPayout - a.readyForPayout || b.balance - a.balance);

  const pageRows = rows.slice((page - 1) * limit, page * limit);
  const vendors = await prisma.professional.findMany({ where: { id: { in: pageRows.map((row) => row.professionalId) } }, select: { ...vendorSummary.select, documents: { where: { type: 'BANK_ACCOUNT' }, select: { status: true } } } });
  const byId = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const items = pageRows.map(({ professionalId, ...row }) => {
    const vendor = byId.get(professionalId);
    return { ...vendorView(vendor), ...row, bankAccountStatus: vendor.documents[0]?.status ?? 'NOT_UPLOADED' };
  });
  return {
    ...paginatedResponse(items, rows.length, { page, limit }),
    totals: { vendors: rows.length, balance: money(rows.reduce((total, row) => total + row.balance, 0)), readyForPayout: money(rows.reduce((total, row) => total + row.readyForPayout, 0)) },
  };
};

const findVendor = async (professionalId) => {
  const professional = await prisma.professional.findUnique({ where: { id: professionalId }, ...vendorSummary });
  if (!professional) throw ApiError.notFound('Vendor not found');
  return professional;
};

const getVendorWallet = async (professionalId) => ({ vendor: vendorView(await findVendor(professionalId)), wallet: await summarise(professionalId) });

const listVendorTransactions = async (professionalId, query) => {
  await findVendor(professionalId);
  return listEntries(professionalId, query);
};

const payoutView = (payout) => ({
  id: payout.id,
  payoutNumber: payoutNumber(payout.sequence),
  vendor: vendorView(payout.professional),
  amount: money(payout.amount),
  reference: payout.reference,
  note: payout.note,
  earningsCovered: payout._count.entries - 1, // every entry but the payout's own
  paidAt: payout.paidAt,
  createdAt: payout.createdAt,
});
const payoutInclude = { professional: vendorSummary, _count: { select: { entries: true } } };

// Records that the vendor's ready earnings were sent to their bank account.
// The transfer itself is made outside this system; `reference` is its id.
const createPayout = async (professionalId, { reference, note }, actor) => {
  const vendor = await findVendor(professionalId);
  const now = new Date();

  const payout = await prisma.$transaction(async (tx) => {
    const due = await tx.walletEntry.findMany({ where: ready(professionalId, now), select: { id: true, amount: true } });
    if (due.length === 0) throw ApiError.conflict('This vendor has nothing ready to be paid out yet');
    const amount = money(due.reduce((total, entry) => total + Number(entry.amount), 0));

    const created = await tx.vendorPayout.create({ data: { professionalId, amount, reference, note: note ?? null, createdById: actor.id, paidAt: now } });
    // Guarded on PENDING so two admins paying at once cannot both settle the same earnings.
    const { count } = await tx.walletEntry.updateMany({ where: { id: { in: due.map((entry) => entry.id) }, status: 'PENDING' }, data: { status: 'PAID', payoutId: created.id } });
    if (count !== due.length) throw ApiError.conflict('These earnings were just paid out by someone else — reload and try again');
    await tx.walletEntry.create({ data: { professionalId, type: 'PAYOUT', status: 'PAID', amount, payoutId: created.id, note: reference } });
    return created;
  });

  notifications
    .sendPushNotification(vendor.user.id, { title: 'Payout sent', body: `₹${money(payout.amount)} has been sent to your bank account (${payoutNumber(payout.sequence)}).`, data: { type: 'PAYOUT', payoutId: payout.id } })
    .catch((err) => logger.warn({ err: err.message, userId: vendor.user.id }, 'Failed to send payout notification'));
  return payoutView(await prisma.vendorPayout.findUnique({ where: { id: payout.id }, include: payoutInclude }));
};

const listPayouts = async ({ page, limit, professionalId, search }) => {
  const where = { ...(professionalId && { professionalId }), ...(search && { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { professional: { user: personSearch(search) } }] }) };
  const [rows, total] = await Promise.all([
    prisma.vendorPayout.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { paidAt: 'desc' }, include: payoutInclude }),
    prisma.vendorPayout.count({ where }),
  ]);
  return paginatedResponse(rows.map(payoutView), total, { page, limit });
};

module.exports = {
  creditForBooking,
  settleInCash,
  getMyWallet,
  listMyTransactions,
  listMyPending,
  listDue,
  getVendorWallet,
  listVendorTransactions,
  listVendorPending: async (professionalId, query) => {
    await findVendor(professionalId);
    return listPendingFor(professionalId, query);
  },
  createPayout,
  listPayouts,
};
