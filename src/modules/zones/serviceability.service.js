const prisma = require('../../config/prisma');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

// The pincode geofence: which pincodes the service is offered in.
//
// A pincode is serviceable while its row, its city and (if it has one) its
// zone are all active, so taking a city or zone out of service closes its
// pincodes too. The geofence is applied when a booking is made (assertBookable),
// and only while PINCODE_GEOFENCE is 'strict'. Saving an address is never
// refused for it: a customer outside the area can still sign up, and their
// address says it is not serviceable so the app can tell them.

const enforced = () => env.PINCODE_GEOFENCE === 'strict';

const include = { city: { select: { id: true, name: true, isActive: true } }, zone: { select: { id: true, name: true, isActive: true } } };

const isLive = (row) => Boolean(row?.isActive && row.city.isActive && (!row.zone || row.zone.isActive));

const toView = ({ city, zone, ...row }) => ({
  ...row,
  city: { id: city.id, name: city.name },
  zone: zone ? { id: zone.id, name: zone.name } : null,
  serviceable: isLive({ ...row, city, zone }),
});

const clean = (pincode) => String(pincode ?? '').trim();

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

// What the customer app shows for a pincode, before or while adding an address.
const check = async (pincode) => {
  const row = await prisma.serviceablePincode.findUnique({ where: { pincode: clean(pincode) }, include });
  if (!isLive(row)) return { pincode: clean(pincode), serviceable: false, city: null, zone: null, areaName: null };
  return { pincode: row.pincode, serviceable: true, city: { id: row.city.id, name: row.city.name }, zone: row.zone && { id: row.zone.id, name: row.zone.name }, areaName: row.areaName };
};

// Which of these pincodes are serviceable, in one query (for lists of addresses).
const serviceableSet = async (pincodes) => {
  const wanted = [...new Set(pincodes.map(clean).filter(Boolean))];
  if (!wanted.length) return new Set();
  const rows = await prisma.serviceablePincode.findMany({ where: { pincode: { in: wanted } }, include });
  return new Set(rows.filter(isLive).map((row) => row.pincode));
};

// The zone a pincode belongs to, for an address saved without one. Only used
// when the pincode is in the city the address was saved in.
const zoneFor = async (pincode, cityId) => {
  const row = await prisma.serviceablePincode.findUnique({ where: { pincode: clean(pincode) }, include });
  return isLive(row) && row.cityId === cityId && row.zoneId ? row.zoneId : null;
};

// Called before a booking is made at an address.
const assertBookable = async (pincode) => {
  if (!enforced()) return;
  const result = await check(pincode);
  if (!result.serviceable) {
    throw ApiError.badRequest(`We don't serve pincode ${clean(pincode) || '(none)'} yet`, { code: 'PINCODE_NOT_SERVICEABLE', pincode: clean(pincode) || null });
  }
};

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const assertPlace = async (cityId, zoneId) => {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');
  if (zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.isActive || zone.cityId !== cityId) throw ApiError.badRequest('Zone must be an active zone in the selected city');
  }
};

const list = async ({ page, limit, cityId, zoneId, isActive, search }) => {
  const where = {
    ...(cityId && { cityId }),
    ...(zoneId && { zoneId }),
    ...(isActive !== undefined && { isActive }),
    ...(search && { OR: [{ pincode: { startsWith: search } }, { areaName: { contains: search, mode: 'insensitive' } }] }),
  };
  const [rows, total] = await Promise.all([
    prisma.serviceablePincode.findMany({ where, include, orderBy: { pincode: 'asc' }, ...toSkipTake({ page, limit }) }),
    prisma.serviceablePincode.count({ where }),
  ]);
  return paginatedResponse(rows.map(toView), total, { page, limit });
};

// Adds one or many pincodes to a city (and zone). A pincode already in the
// list is moved here and switched back on, so pasting a list twice is safe.
const add = async ({ cityId, zoneId = null, areaName = null, pincodes }) => {
  await assertPlace(cityId, zoneId);
  const unique = [...new Set(pincodes)];
  const existing = new Set((await prisma.serviceablePincode.findMany({ where: { pincode: { in: unique } }, select: { pincode: true } })).map((row) => row.pincode));

  await prisma.$transaction(
    unique.map((pincode) =>
      prisma.serviceablePincode.upsert({
        where: { pincode },
        create: { pincode, cityId, zoneId, areaName },
        update: { cityId, zoneId, ...(areaName && { areaName }), isActive: true },
      }),
    ),
  );
  const rows = await prisma.serviceablePincode.findMany({ where: { pincode: { in: unique } }, include, orderBy: { pincode: 'asc' } });
  return { added: unique.filter((pincode) => !existing.has(pincode)).length, updated: existing.size, items: rows.map(toView) };
};

const update = async (id, data) => {
  const row = await prisma.serviceablePincode.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Pincode not found');
  // Moving to another city drops a zone that wasn't re-chosen.
  const cityId = data.cityId ?? row.cityId;
  const zoneId = data.zoneId !== undefined ? data.zoneId : cityId === row.cityId ? row.zoneId : null;
  if (data.cityId || data.zoneId) await assertPlace(cityId, zoneId);
  const updated = await prisma.serviceablePincode.update({ where: { id }, data: { ...data, cityId, zoneId }, include });
  return toView(updated);
};

const remove = async (id) => {
  const row = await prisma.serviceablePincode.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Pincode not found');
  await prisma.serviceablePincode.delete({ where: { id } });
  return { deleted: true, pincode: row.pincode };
};

module.exports = { enforced, check, serviceableSet, zoneFor, assertBookable, list, add, update, remove };
