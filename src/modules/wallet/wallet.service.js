const prisma = require('../../config/prisma');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const notifications = require('../notifications/notifications.service');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { personSearch } = require('../../utils/queryFilters');
const payoutSettings = require('./payoutSettings.service');
const payoutAccount = require('./payoutAccount.service');
const provider = require('./payoutProvider');

// The vendor wallet. Completing a job credits the vendor with an EARNING. It
// is held for PAYOUT_HOLD_DAYS, then is ready to be sent; the team sends the
// money to the vendor's bank account and records a PAYOUT, which marks the
// earnings it covers as PAID. If the vendor took the customer's cash
// themselves, the earning is SETTLED_IN_CASH and nothing is owed for it.

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;
const payoutNumber = (sequence) => `PO-${String(sequence).padStart(6, '0')}`;

// Earnings still to be sent, split by whether their hold has ended.
const unpaid = (professionalId) => ({ professionalId, type: 'EARNING', status: 'PENDING' });
const onHold = (professionalId, now) => ({ ...unpaid(professionalId), availableAt: { gt: now } });
const ready = (professionalId, now) => ({ ...unpaid(professionalId), availableAt: { lte: now } });

const entryInclude = {
  booking: { select: { id: true, sequence: true, completedAt: true, category: { select: { id: true, name: true } } } },
  payout: { select: { id: true, sequence: true, reference: true, paidAt: true, status: true, mode: true, method: true } },
};

const toView = (entry, now = new Date()) => {
  const earning = entry.type === 'EARNING';
  // A payout handed to the provider shows as PROCESSING until it is confirmed.
  const status = !earning ? (entry.payout?.status === 'PROCESSING' ? 'PROCESSING' : 'PAID') : entry.status !== 'PENDING' ? entry.status : entry.availableAt > now ? 'ON_HOLD' : 'READY';
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
    payout: entry.payout
      ? { id: entry.payout.id, payoutNumber: payoutNumber(entry.payout.sequence), reference: entry.payout.reference, paidAt: entry.payout.paidAt, status: entry.payout.status, mode: entry.payout.mode, method: entry.payout.method }
      : null,
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
  // The vendor's commission and hold period at the moment the job is completed.
  const terms = await payoutSettings.termsFor(booking.professionalId, tx);
  const gross = money(booking.price);
  const commission = money((gross * terms.commissionPercent) / 100);
  const tookCash = booking.payment?.status === 'SUCCESS' && booking.payment.method === 'CASH';
  const data = {
    professionalId: booking.professionalId,
    type: 'EARNING',
    status: tookCash ? 'SETTLED_IN_CASH' : 'PENDING',
    amount: money(gross - commission),
    grossAmount: gross,
    commission,
    availableAt: new Date(Date.now() + terms.holdMinutes * 60 * 1000),
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
  const [terms, settings] = await Promise.all([payoutSettings.termsFor(professionalId), payoutSettings.load()]);
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
    // How long an earning is held: in minutes, as words, and in days (kept for older app builds).
    holdMinutes: terms.holdMinutes,
    holdLabel: terms.holdLabel,
    holdDays: Math.round((terms.holdMinutes / 1440) * 100) / 100,
    commissionPercent: terms.commissionPercent,
    payoutMethod: terms.payoutMethod,
    payoutFrequency: settings.frequency,
    // The next scheduled payout day, or null when earnings are paid as soon as their hold ends.
    nextPayoutDate: payoutSettings.upcomingPayoutDates(settings, 1)[0] ?? null,
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
  const [vendors, settings] = await Promise.all([
    prisma.professional.findMany({ where: { id: { in: pageRows.map((row) => row.professionalId) } }, select: { ...vendorSummary.select, payoutMethod: true, documents: { where: { type: 'BANK_ACCOUNT' }, select: { status: true } } } }),
    payoutSettings.load(),
  ]);
  const byId = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const items = pageRows.map(({ professionalId, ...row }) => {
    const vendor = byId.get(professionalId);
    return { ...vendorView(vendor), ...row, payoutMethod: vendor.payoutMethod ?? settings.payoutMethod, bankAccountStatus: vendor.documents[0]?.status ?? 'NOT_UPLOADED' };
  });
  return {
    ...paginatedResponse(items, rows.length, { page, limit }),
    nextPayoutDate: payoutSettings.upcomingPayoutDates(await payoutSettings.load(), 1)[0] ?? null,
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
  method: payout.method,
  mode: payout.mode,
  status: payout.status,
  failureReason: payout.failureReason,
  providerPayoutId: payout.providerPayoutId,
  processedAt: payout.processedAt,
  note: payout.note,
  // Every entry but the payout's own (a failed payout no longer covers any).
  earningsCovered: Math.max(0, payout._count.entries - 1),
  paidAt: payout.paidAt,
  createdAt: payout.createdAt,
});
const payoutInclude = { professional: vendorSummary, _count: { select: { entries: true } } };

const notifyVendor = (userId, title, body, payoutId) =>
  notifications
    .sendPushNotification(userId, { title, body, data: { type: 'PAYOUT', payoutId } })
    .catch((err) => logger.warn({ err: err.message, userId }, 'Failed to send payout notification'));

const loadPayout = (id) => prisma.vendorPayout.findUnique({ where: { id }, include: payoutInclude });

// Moves the vendor's earnings onto a new payout, all in one transaction:
// ready ones only, unless includeOnHold. Guarded on PENDING so two payouts at
// once can never settle the same earnings.
const settle = async (professionalId, { mode, method, reference, note, actor, includeOnHold }) => {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const due = await tx.walletEntry.findMany({ where: includeOnHold ? unpaid(professionalId) : ready(professionalId, now), select: { id: true, amount: true } });
    if (due.length === 0) throw ApiError.conflict(includeOnHold ? 'This vendor is not owed anything' : 'This vendor has nothing ready to be paid out yet');
    const amount = money(due.reduce((total, entry) => total + Number(entry.amount), 0));
    const manual = mode === 'MANUAL';

    const created = await tx.vendorPayout.create({
      data: { professionalId, amount, reference: reference ?? 'pending', method, mode, status: manual ? 'PAID' : 'PROCESSING', note: note ?? null, createdById: actor?.id ?? null, paidAt: now, ...(manual && { processedAt: now }) },
    });
    // Until the provider confirms, an automatic payout shows as processing.
    if (!reference) await tx.vendorPayout.update({ where: { id: created.id }, data: { reference: payoutNumber(created.sequence) } });
    const { count } = await tx.walletEntry.updateMany({ where: { id: { in: due.map((entry) => entry.id) }, status: 'PENDING' }, data: { status: 'PAID', payoutId: created.id } });
    if (count !== due.length) throw ApiError.conflict('These earnings were just paid out by someone else — reload and try again');
    await tx.walletEntry.create({ data: { professionalId, type: 'PAYOUT', status: manual ? 'PAID' : 'PENDING', amount, payoutId: created.id, note: reference ?? null } });
    return created;
  });
};

// Applies what the provider says happened to a payout.
const applyProviderResult = async (payoutId, { status, providerPayoutId, failureReason }) => {
  const payout = await prisma.vendorPayout.findUnique({ where: { id: payoutId }, include: { professional: vendorSummary } });
  if (!payout || payout.status !== 'PROCESSING') return payout;

  if (status === 'PAID') {
    const now = new Date();
    await prisma.$transaction([
      prisma.vendorPayout.update({ where: { id: payoutId }, data: { status: 'PAID', processedAt: now, paidAt: now, ...(providerPayoutId && { providerPayoutId, reference: providerPayoutId }) } }),
      prisma.walletEntry.updateMany({ where: { payoutId, type: 'PAYOUT' }, data: { status: 'PAID', ...(providerPayoutId && { note: providerPayoutId }) } }),
    ]);
    notifyVendor(payout.professional.user.id, 'Payout sent', `₹${money(payout.amount)} has been sent to you (${payoutNumber(payout.sequence)}).`, payoutId);
  } else if (status === 'FAILED') {
    // The money did not go: the earnings are owed again and can be paid later.
    await prisma.$transaction([
      prisma.walletEntry.updateMany({ where: { payoutId, type: 'EARNING' }, data: { status: 'PENDING', payoutId: null } }),
      prisma.walletEntry.deleteMany({ where: { payoutId, type: 'PAYOUT' } }),
      prisma.vendorPayout.update({ where: { id: payoutId }, data: { status: 'FAILED', failureReason: failureReason || 'The payout provider could not send it', ...(providerPayoutId && { providerPayoutId }) } }),
    ]);
    logger.warn({ payoutId, failureReason }, 'Vendor payout failed; earnings are owed again');
  } else if (providerPayoutId) {
    await prisma.vendorPayout.update({ where: { id: payoutId }, data: { providerPayoutId } });
  }
  return loadPayout(payoutId);
};

// Checks a vendor can be paid by `method` right now, and returns where to.
const destinationFor = async (professionalId, method) => {
  if (method === 'CASH') throw ApiError.badRequest('Cash cannot be sent automatically — hand it over and record it as a manual payout');
  const destination = await payoutAccount.destinationFor(professionalId);
  if (method === 'UPI' && !destination.upiId) throw ApiError.badRequest('This vendor has no UPI id — add one first');
  if (method === 'BANK_TRANSFER' && !(destination.accountNumber && destination.ifsc)) throw ApiError.badRequest('This vendor has no bank account — add one first');
  if (!destination.verified) throw ApiError.badRequest('This vendor\'s bank details are not verified yet');
  return destination;
};

// Sends the vendor's money through the payout provider: from "Send now" in the
// dashboard (mode AUTOMATIC, by an admin) or from the automatic payout run.
const sendPayout = async (professionalId, { method, includeOnHold = false, note, actor = null } = {}) => {
  await findVendor(professionalId);
  const terms = await payoutSettings.termsFor(professionalId);
  const payoutMethod = method ?? terms.payoutMethod;
  const destination = await destinationFor(professionalId, payoutMethod);
  const payout = await settle(professionalId, { mode: 'AUTOMATIC', method: payoutMethod, note, actor, includeOnHold });

  try {
    const vendor = await prisma.professional.findUnique({ where: { id: professionalId }, select: { razorpayContactId: true, razorpayBankFundAccountId: true, razorpayUpiFundAccountId: true } });
    const result = await provider.send({
      vendor: destination.vendor,
      method: payoutMethod,
      destination,
      ids: { contactId: vendor.razorpayContactId, bankFundAccountId: vendor.razorpayBankFundAccountId, upiFundAccountId: vendor.razorpayUpiFundAccountId },
      amount: Number(payout.amount),
      referenceId: payout.id,
      narration: `Mr Bob ${payoutNumber(payout.sequence)}`,
    });
    const ids = result.ids ?? {};
    if (ids.contactId || ids.bankFundAccountId || ids.upiFundAccountId) {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { ...(ids.contactId && { razorpayContactId: ids.contactId }), ...(ids.bankFundAccountId && { razorpayBankFundAccountId: ids.bankFundAccountId }), ...(ids.upiFundAccountId && { razorpayUpiFundAccountId: ids.upiFundAccountId }) },
      });
    }
    // Marked so the team can tell it apart from a real transfer.
    if (result.simulated) await prisma.vendorPayout.update({ where: { id: payout.id }, data: { note: [note, 'Simulated — no payout provider is connected, so no money was moved'].filter(Boolean).join(' · ') } });
    return payoutView(await applyProviderResult(payout.id, result));
  } catch (err) {
    return payoutView(await applyProviderResult(payout.id, { status: 'FAILED', failureReason: err.message }));
  }
};

// Records a transfer the team made themselves (bank app, UPI app, cash).
const createPayout = async (professionalId, { reference, note, method, includeOnHold = false }, actor) => {
  const vendor = await findVendor(professionalId);
  const payoutMethod = method ?? (await payoutSettings.termsFor(professionalId)).payoutMethod;
  const payout = await settle(professionalId, { mode: 'MANUAL', method: payoutMethod, reference, note, actor, includeOnHold });
  notifyVendor(vendor.user.id, 'Payout sent', `₹${money(payout.amount)} has been sent to you (${payoutNumber(payout.sequence)}).`, payout.id);
  return payoutView(await loadPayout(payout.id));
};

// Asks the provider about payouts it has not confirmed yet (the webhook
// usually does this first).
const refreshProcessing = async () => {
  const pending = await prisma.vendorPayout.findMany({ where: { status: 'PROCESSING', providerPayoutId: { not: null } }, select: { id: true, providerPayoutId: true }, take: 50 });
  for (const payout of pending) {
    try {
      await applyProviderResult(payout.id, await provider.fetchStatus(payout.providerPayoutId));
    } catch (err) {
      logger.warn({ err: err.message, payoutId: payout.id }, 'Could not check a payout with the provider');
    }
  }
  return { checked: pending.length };
};

// The provider's webhook: payout.processed / payout.failed / payout.reversed / payout.rejected.
const handleProviderEvent = async (event) => {
  const entity = event?.payload?.payout?.entity;
  if (!entity?.id) return { handled: false };
  const payout = await prisma.vendorPayout.findFirst({ where: { OR: [{ providerPayoutId: entity.id }, { id: entity.reference_id ?? '' }] }, select: { id: true } });
  if (!payout) return { handled: false };
  await applyProviderResult(payout.id, { status: provider.toStatus(entity.status), providerPayoutId: entity.id, failureReason: entity.failure_reason ?? entity.status_details?.description });
  return { handled: true };
};

// Pays every vendor whose money is ready, when automatic payouts are on and
// today is a payout day (or every run, on "as soon as the hold ends").
// `force` runs it now regardless — the dashboard's "Run now".
const runAutomaticPayouts = async ({ force = false, actor = null } = {}) => {
  const settings = await payoutSettings.load();
  const today = payoutSettings.dateOnly(new Date());
  if (!force) {
    if (!settings.automaticPayouts) return { ran: false, reason: 'Automatic payouts are off' };
    if (settings.frequency !== 'AFTER_HOLD') {
      const nextDay = payoutSettings.upcomingPayoutDates(settings, 1)[0];
      if (nextDay !== today) return { ran: false, reason: 'Today is not a payout day' };
      if (payoutSettings.dateOnly(settings.lastAutomaticRunOn) === today) return { ran: false, reason: 'Already run today' };
    }
  }

  const groups = await prisma.walletEntry.groupBy({ by: ['professionalId'], where: { type: 'EARNING', status: 'PENDING', availableAt: { lte: new Date() } } });
  const result = { ran: true, sent: 0, amount: 0, failed: [], skipped: [] };
  for (const { professionalId } of groups) {
    const vendor = await prisma.professional.findUnique({ where: { id: professionalId }, select: { user: { select: { name: true, deletedAt: true } } } });
    if (!vendor || vendor.user.deletedAt) continue;
    try {
      const payout = await sendPayout(professionalId, { actor });
      if (payout.status === 'FAILED') result.failed.push({ professionalId, name: vendor.user.name, reason: payout.failureReason });
      else {
        result.sent += 1;
        result.amount = money(result.amount + payout.amount);
      }
    } catch (err) {
      result.skipped.push({ professionalId, name: vendor.user.name, reason: err.message });
    }
  }
  if (settings.frequency !== 'AFTER_HOLD' && settings.updatedAt) await prisma.payoutSettings.update({ where: { id: 1 }, data: { lastAutomaticRunOn: new Date(`${today}T00:00:00.000Z`) } });
  logger.info({ ...result, skipped: result.skipped.length, failed: result.failed.length }, 'Automatic payout run');
  return result;
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
  sendPayout,
  refreshProcessing,
  handleProviderEvent,
  runAutomaticPayouts,
  listPayouts,
};
