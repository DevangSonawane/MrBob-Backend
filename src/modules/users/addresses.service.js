const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

// A user's saved addresses. Invariant: if a user has any addresses, exactly
// one is the default, and the user's cityId / one-line `address` mirror it.

const MAX_ADDRESSES = 10;

const addressInclude = { city: { select: { id: true, name: true } }, zone: { select: { id: true, name: true } } };

const toView = ({ cityId: _cityId, zoneId: _zoneId, userId: _userId, latitude, longitude, ...address }) => ({
  ...address,
  latitude: latitude === null ? null : Number(latitude),
  longitude: longitude === null ? null : Number(longitude),
});

const oneLine = (address) =>
  [address.line1, address.line2, address.landmark, address.city?.name, `${address.state} ${address.pincode}`.trim()].filter(Boolean).join(', ');

// The city must be one we serve; a zone, if given, must belong to it.
const assertPlace = async (cityId, zoneId) => {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');
  if (zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.isActive || zone.cityId !== cityId) throw ApiError.badRequest('Zone must be an active zone in the selected city');
  }
};

// Re-establishes the invariant after any change, inside the same transaction.
const syncDefault = async (tx, userId) => {
  let current = await tx.address.findFirst({ where: { userId, isDefault: true }, include: addressInclude });
  if (!current) {
    const newest = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (newest) current = await tx.address.update({ where: { id: newest.id }, data: { isDefault: true }, include: addressInclude });
  }
  await tx.user.update({
    where: { id: userId },
    // An address saved without a city (validation off) leaves the user's city as it was.
    data: current ? { ...(current.cityId && { cityId: current.cityId }), address: oneLine(current) || null } : { address: null },
  });
};

const findOwn = async (userId, id) => {
  const address = await prisma.address.findFirst({ where: { id, userId } });
  if (!address) throw ApiError.notFound('Address not found');
  return address;
};

const list = async (userId) => {
  const addresses = await prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    include: addressInclude,
  });
  return addresses.map(toView);
};

const getOne = async (userId, id) => {
  await findOwn(userId, id);
  return toView(await prisma.address.findUnique({ where: { id }, include: addressInclude }));
};

// `unchecked` (onboarding with validation off) skips the city/zone rules; the
// caller has already made sure the ids exist.
const create = async (userId, { isDefault, ...data }, { unchecked = false } = {}) => {
  if (!unchecked) await assertPlace(data.cityId, data.zoneId);
  const count = await prisma.address.count({ where: { userId } });
  if (count >= MAX_ADDRESSES) throw ApiError.badRequest(`You can save up to ${MAX_ADDRESSES} addresses`);

  const makeDefault = isDefault || count === 0;
  const created = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    const address = await tx.address.create({ data: { ...data, userId, isDefault: makeDefault } });
    await syncDefault(tx, userId);
    return address;
  });
  return getOne(userId, created.id);
};

const update = async (userId, id, { isDefault, ...data }, { unchecked = false } = {}) => {
  const existing = await findOwn(userId, id);
  // Moving to another city invalidates a zone that wasn't re-chosen.
  if (data.cityId && data.cityId !== existing.cityId && data.zoneId === undefined) data.zoneId = null;
  if (!unchecked && (data.cityId || data.zoneId !== undefined)) {
    await assertPlace(data.cityId ?? existing.cityId, data.zoneId === undefined ? existing.zoneId : data.zoneId);
  }

  await prisma.$transaction(async (tx) => {
    if (isDefault === true) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    await tx.address.update({ where: { id }, data: { ...data, ...(isDefault === true && { isDefault: true }) } });
    await syncDefault(tx, userId);
  });
  return getOne(userId, id);
};

const setDefault = (userId, id) => update(userId, id, { isDefault: true });

const remove = async (userId, id) => {
  await findOwn(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    // If that was the default, the most recently added one takes over.
    await syncDefault(tx, userId);
  });
  return list(userId);
};

// Onboarding's address step: sets the default address, creating it the
// first time and updating it if the step is repeated.
const saveDefault = async (userId, data, options) => {
  const current = await prisma.address.findFirst({ where: { userId, isDefault: true } });
  return current ? update(userId, current.id, data, options) : create(userId, { ...data, isDefault: true }, options);
};

module.exports = { list, getOne, create, update, setDefault, remove, saveDefault, toView, addressInclude, MAX_ADDRESSES };
