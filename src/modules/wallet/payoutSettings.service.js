const prisma = require('../../config/prisma');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { personSearch } = require('../../utils/queryFilters');
const provider = require('./payoutProvider');

// How vendors are paid out. The platform default (one PayoutSettings row,
// edited by a super admin) covers every vendor; a vendor can have their own
// commission, hold period and payout method, which win over the default.

const SETTINGS_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
// "2 days 4 hours", "45 minutes", "No hold".
const holdLabel = (minutes) => {
  if (!minutes) return 'No hold';
  const parts = [[Math.floor(minutes / 1440), 'day'], [Math.floor((minutes % 1440) / 60), 'hour'], [minutes % 60, 'minute']];
  return parts.filter(([n]) => n).map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`).join(' ');
};
const holdView = (minutes) => ({ holdMinutes: minutes, holdLabel: holdLabel(minutes) });

const percent = (value) => Math.round(Number(value) * 100) / 100;
const dateOnly = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

// Until the team saves settings, the server's environment gives the defaults.
const defaults = () => ({ holdMinutes: Math.round(env.PAYOUT_HOLD_DAYS * 24 * 60), commissionPercent: env.PLATFORM_COMMISSION_PERCENT, payoutMethod: 'BANK_TRANSFER', frequency: 'AFTER_HOLD', firstPayoutDate: null, automaticPayouts: false, lastAutomaticRunOn: null, updatedAt: null, updatedById: null });

const load = async (db = prisma) => (await db.payoutSettings.findUnique({ where: { id: SETTINGS_ID } })) ?? defaults();

const addMonths = (date, months) => {
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
};

// The next scheduled payout days from today (inclusive), or [] when earnings
// are paid as soon as their hold ends.
const upcomingPayoutDates = (settings, count = 3, from = new Date()) => {
  if (settings.frequency === 'AFTER_HOLD' || !settings.firstPayoutDate) return [];
  const today = new Date(`${dateOnly(from)}T00:00:00.000Z`);
  const step = (date, n) => (settings.frequency === 'MONTHLY' ? addMonths(new Date(settings.firstPayoutDate), n) : new Date(new Date(settings.firstPayoutDate).getTime() + n * (settings.frequency === 'WEEKLY' ? 7 : 14) * DAY_MS));
  const dates = [];
  for (let n = 0; dates.length < count && n < 1000; n += 1) {
    const date = step(settings.firstPayoutDate, n);
    if (date >= today) dates.push(dateOnly(date));
  }
  return dates;
};

const settingsView = (settings) => ({
  ...holdView(settings.holdMinutes),
  commissionPercent: percent(settings.commissionPercent),
  payoutMethod: settings.payoutMethod,
  frequency: settings.frequency,
  firstPayoutDate: dateOnly(settings.firstPayoutDate),
  upcomingPayoutDates: upcomingPayoutDates(settings),
  automaticPayouts: settings.automaticPayouts,
  lastAutomaticRunOn: dateOnly(settings.lastAutomaticRunOn),
  // Whether money can really be sent: 'LIVE' (RazorpayX keys set), 'SIMULATED'
  // (development stand-in) or 'NOT_CONFIGURED' (only manual payouts work).
  provider: provider.isConfigured ? 'LIVE' : provider.isSimulated ? 'SIMULATED' : 'NOT_CONFIGURED',
  updatedAt: settings.updatedAt,
});

const getSettings = async () => settingsView(await load());

const updateSettings = async (body, actor) => {
  const current = await load();
  const next = { ...current, ...body };
  if (body.automaticPayouts && !provider.isConfigured && !provider.isSimulated) {
    throw new ApiError(503, 'Automatic payouts need a payout provider (RazorpayX) set up on the server first');
  }
  if (next.frequency !== 'AFTER_HOLD' && !next.firstPayoutDate) throw ApiError.badRequest('Choose the first payout date for a weekly, fortnightly or monthly schedule');
  const data = {
    holdMinutes: next.holdMinutes,
    commissionPercent: next.commissionPercent,
    payoutMethod: next.payoutMethod,
    frequency: next.frequency,
    firstPayoutDate: next.frequency === 'AFTER_HOLD' ? null : new Date(`${dateOnly(next.firstPayoutDate)}T00:00:00.000Z`),
    automaticPayouts: next.automaticPayouts,
    updatedById: actor.id,
  };
  const saved = await prisma.payoutSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
  return settingsView(saved);
};

// A vendor's terms: their own where set, the platform default otherwise.
const effectiveTerms = (professional, settings) => ({
  commissionPercent: percent(professional.commissionPercent ?? settings.commissionPercent),
  ...holdView(professional.payoutHoldMinutes ?? settings.holdMinutes),
  payoutMethod: professional.payoutMethod ?? settings.payoutMethod,
  custom: {
    commissionPercent: professional.commissionPercent === null || professional.commissionPercent === undefined ? null : percent(professional.commissionPercent),
    holdMinutes: professional.payoutHoldMinutes ?? null,
    payoutMethod: professional.payoutMethod ?? null,
  },
});

const termsFor = async (professionalId, db = prisma) => {
  const [professional, settings] = await Promise.all([
    db.professional.findUnique({ where: { id: professionalId }, select: { commissionPercent: true, payoutHoldMinutes: true, payoutMethod: true } }),
    load(db),
  ]);
  if (!professional) throw ApiError.notFound('Vendor not found');
  return effectiveTerms(professional, settings);
};

const termsSelect = {
  id: true,
  onboardingStatus: true,
  commissionPercent: true,
  payoutHoldMinutes: true,
  payoutMethod: true,
  user: { select: { id: true, name: true, phone: true } },
  documents: { where: { type: 'BANK_ACCOUNT' }, select: { status: true } },
};
const vendorTermsView = (professional, settings) => ({
  professionalId: professional.id,
  userId: professional.user.id,
  name: professional.user.name,
  phone: professional.user.phone,
  status: professional.onboardingStatus,
  bankAccountStatus: professional.documents[0]?.status ?? 'NOT_UPLOADED',
  ...effectiveTerms(professional, settings),
});

const listVendorTerms = async ({ page, limit, search, customOnly }) => {
  const where = {
    user: { deletedAt: null, ...(search && personSearch(search)) },
    ...(customOnly && { OR: [{ commissionPercent: { not: null } }, { payoutHoldMinutes: { not: null } }, { payoutMethod: { not: null } }] }),
  };
  const [rows, total, settings] = await Promise.all([
    prisma.professional.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { user: { name: 'asc' } }, select: termsSelect }),
    prisma.professional.count({ where }),
    load(),
  ]);
  return paginatedResponse(rows.map((row) => vendorTermsView(row, settings)), total, { page, limit });
};

// null clears a field, so the vendor follows the platform default again.
const columns = (body) => ({
  ...(body.commissionPercent !== undefined && { commissionPercent: body.commissionPercent }),
  ...(body.holdMinutes !== undefined && { payoutHoldMinutes: body.holdMinutes }),
  ...(body.payoutMethod !== undefined && { payoutMethod: body.payoutMethod }),
});

const setVendorTerms = async (professionalId, body) => {
  const exists = await prisma.professional.findUnique({ where: { id: professionalId }, select: { id: true } });
  if (!exists) throw ApiError.notFound('Vendor not found');
  await prisma.professional.update({ where: { id: professionalId }, data: columns(body) });
  const [row, settings] = await Promise.all([prisma.professional.findUnique({ where: { id: professionalId }, select: termsSelect }), load()]);
  return vendorTermsView(row, settings);
};

// The same terms for several vendors, or for every vendor when no ids are given.
// `reset: true` puts them back on the platform default.
const setManyVendorTerms = async ({ professionalIds, reset, ...body }) => {
  const data = reset ? { commissionPercent: null, payoutHoldMinutes: null, payoutMethod: null } : columns(body);
  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to change');
  const { count } = await prisma.professional.updateMany({ where: { ...(professionalIds && { id: { in: professionalIds } }), user: { deletedAt: null } }, data });
  return { updated: count };
};

module.exports = { holdLabel, load, getSettings, updateSettings, upcomingPayoutDates, termsFor, listVendorTerms, setVendorTerms, setManyVendorTerms, dateOnly };
