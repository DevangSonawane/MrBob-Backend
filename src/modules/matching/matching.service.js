const prisma = require('../../config/prisma');
const env = require('../../config/env');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const notifications = require('../notifications/notifications.service');
const geo = require('./geo');

// Finding a vendor for a booking, Uber style. Vendors who are online report
// their position, which is placed in an H3 hexagon. A new booking is placed in
// the hexagon of its address. Offers then go out in waves: the nearest few
// online vendors within one ring of hexagons, and if nobody accepts within the
// offer time, the next few within a wider ring, and so on. The first to
// accept gets the job. If nobody nearby takes it — or the booking has no
// location — it is opened to every approved vendor, as before.

const OPEN_STATUSES = ['PENDING', 'MATCHING'];
const PRESENCE_TTL_MS = 5 * 60 * 1000; // no position for 5 minutes = treated as offline
const nearbyMode = () => env.DISPATCH_MODE === 'nearby';
const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;

const notifyVendor = (userId, booking, distanceKm) =>
  notifications
    .sendPushNotification(userId, {
      title: 'New job near you',
      body: `${booking.category?.name ?? 'A job'}${distanceKm !== null ? ` · ${distanceKm} km away` : ''}. Accept within ${env.DISPATCH_OFFER_SECONDS} seconds.`,
      data: { type: 'JOB_OFFER', bookingId: booking.id },
    })
    .catch((err) => logger.warn({ err: err.message, userId }, 'Failed to send job offer notification'));

// ---------------------------------------------------------------------------
// Vendor presence
// ---------------------------------------------------------------------------

const vendorOf = async (userId) => {
  const vendor = await prisma.professional.findUnique({ where: { userId } });
  if (!vendor) throw ApiError.forbidden('Finish vendor onboarding first');
  return vendor;
};

const presenceView = (vendor, activeOffers = 0) => ({
  online: vendor.isOnline,
  latitude: vendor.lastLatitude === null ? null : Number(vendor.lastLatitude),
  longitude: vendor.lastLongitude === null ? null : Number(vendor.lastLongitude),
  h3Cell: vendor.h3Cell,
  lastSeenAt: vendor.lastSeenAt,
  onlineSince: vendor.onlineSince,
  // Only approved vendors are offered jobs.
  canReceiveOffers: vendor.isOnline && vendor.onboardingStatus === 'APPROVED',
  activeOffers,
  // How often the app should send its position while online.
  updateEverySeconds: 30,
});

// Going online or offline, and the regular position updates while online.
const updatePresence = async (user, { online, latitude, longitude }) => {
  const vendor = await vendorOf(user.id);
  const goingOnline = online && !vendor.isOnline;
  const point = geo.hasPoint(latitude, longitude);
  if (online && !point && !vendor.h3Cell) throw ApiError.badRequest('Send your location (latitude and longitude) to go online');

  const updated = await prisma.professional.update({
    where: { id: vendor.id },
    data: {
      isOnline: Boolean(online),
      lastSeenAt: new Date(),
      ...(goingOnline && { onlineSince: new Date() }),
      ...(!online && { onlineSince: null }),
      ...(point && { lastLatitude: latitude, lastLongitude: longitude, h3Cell: geo.cellFor(latitude, longitude) }),
    },
  });
  // Going offline hands back the offers this vendor has not answered.
  if (!online) await prisma.jobOffer.updateMany({ where: { professionalId: vendor.id, status: 'OFFERED' }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });
  const activeOffers = await prisma.jobOffer.count({ where: { professionalId: vendor.id, status: 'OFFERED', expiresAt: { gt: new Date() } } });
  return presenceView(updated, activeOffers);
};

const getPresence = async (user) => {
  const vendor = await vendorOf(user.id);
  const activeOffers = await prisma.jobOffer.count({ where: { professionalId: vendor.id, status: 'OFFERED', expiresAt: { gt: new Date() } } });
  return presenceView(vendor, activeOffers);
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const loadBooking = (id) => prisma.booking.findUnique({ where: { id }, include: { category: { select: { id: true, name: true } } } });
const isOpen = (booking) => booking && OPEN_STATUSES.includes(booking.status) && !booking.professionalId && !booking.openToAllAt;

// Nobody nearby (or no location): any approved vendor may now take it.
const openToAll = async (booking, reason) => {
  await prisma.booking.update({ where: { id: booking.id }, data: { openToAllAt: new Date() } });
  logger.info({ bookingId: booking.id, reason }, 'Booking opened to all vendors');
};

// Online, approved vendors in the given cells who offer the service, are not
// on a job right now and have not been offered this booking yet — nearest first.
const candidates = async (booking, cells) => {
  const since = new Date(Date.now() - PRESENCE_TTL_MS);
  const vendors = await prisma.professional.findMany({
    where: {
      isOnline: true,
      lastSeenAt: { gte: since },
      h3Cell: { in: cells },
      onboardingStatus: 'APPROVED',
      kycStatus: 'VERIFIED',
      user: { isActive: true, deletedAt: null },
      // A vendor with no services chosen is treated as offering everything.
      OR: [{ categories: { has: booking.categoryId } }, { categories: { isEmpty: true } }],
      jobOffers: { none: { bookingId: booking.id } },
      bookings: { none: { status: 'IN_PROGRESS' } },
    },
    select: { id: true, userId: true, rating: true, lastLatitude: true, lastLongitude: true },
  });
  return vendors
    .map((vendor) => ({ ...vendor, distanceKm: geo.distanceKm(booking.latitude, booking.longitude, vendor.lastLatitude, vendor.lastLongitude) }))
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999) || Number(b.rating) - Number(a.rating));
};

// Sends the next wave of offers, widening the ring until someone is found.
const nextWave = async (booking) => {
  for (let wave = booking.dispatchWave + 1; wave <= geo.RINGS.length; wave += 1) {
    const found = (await candidates(booking, geo.disk(booking.h3Cell, geo.RINGS[wave - 1]))).slice(0, env.DISPATCH_WAVE_SIZE);
    if (found.length === 0) continue;

    const expiresAt = new Date(Date.now() + env.DISPATCH_OFFER_SECONDS * 1000);
    await prisma.$transaction(async (tx) => {
      await tx.jobOffer.createMany({ data: found.map((vendor) => ({ bookingId: booking.id, professionalId: vendor.id, wave, distanceKm: vendor.distanceKm, expiresAt })), skipDuplicates: true });
      await tx.booking.update({ where: { id: booking.id }, data: { dispatchWave: wave, ...(booking.status === 'PENDING' && { status: 'MATCHING' }) } });
      if (booking.status === 'PENDING') {
        await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'STATUS_CHANGED', actorRole: 'SYSTEM', fromStatus: 'PENDING', toStatus: 'MATCHING', note: `Offered to ${found.length} nearby ${found.length === 1 ? 'vendor' : 'vendors'}` } });
      }
    });
    found.forEach((vendor) => notifyVendor(vendor.userId, booking, vendor.distanceKm));
    return { wave, offered: found.length };
  }
  await prisma.booking.update({ where: { id: booking.id }, data: { dispatchWave: geo.RINGS.length } });
  await openToAll(booking, 'no vendor nearby');
  return { wave: null, offered: 0, openToAll: true };
};

// Starts finding a vendor for a booking that has just become open (booked,
// or paid for). Safe to call more than once.
const start = async (bookingId) => {
  if (!nearbyMode()) return { skipped: 'DISPATCH_MODE is all' };
  let booking = await loadBooking(bookingId);
  if (!isOpen(booking) || booking.dispatchWave > 0) return { skipped: 'not open' };
  if (!booking.h3Cell) {
    const cell = geo.cellFor(booking.latitude, booking.longitude);
    if (!cell) {
      await openToAll(booking, 'no location');
      return { openToAll: true };
    }
    booking = await prisma.booking.update({ where: { id: bookingId }, data: { h3Cell: cell }, include: { category: { select: { id: true, name: true } } } });
  }
  return nextWave(booking);
};

// Runs after the booking is saved, so the customer's request is not held up.
const startSoon = (bookingId) => {
  globalThis.setImmediate(() => start(bookingId).catch((err) => logger.error({ err: err.message, bookingId }, 'Dispatch failed to start')));
};

// A vendor turns an offer down; if nobody else is still deciding, the next wave goes out.
const decline = async (user, bookingId) => {
  const vendor = await vendorOf(user.id);
  const { count } = await prisma.jobOffer.updateMany({ where: { bookingId, professionalId: vendor.id, status: 'OFFERED' }, data: { status: 'DECLINED', respondedAt: new Date() } });
  if (count === 0) throw ApiError.conflict('This job is not offered to you');
  await advanceIfIdle(bookingId);
  return { declined: true };
};

// Next wave when every offer for the booking has been answered or has run out.
const advanceIfIdle = async (bookingId) => {
  const booking = await loadBooking(bookingId);
  if (!isOpen(booking) || !booking.h3Cell) return null;
  const waiting = await prisma.jobOffer.count({ where: { bookingId, status: 'OFFERED', expiresAt: { gt: new Date() } } });
  return waiting ? null : nextWave(booking);
};

// Called when a vendor takes the job: their offer is accepted, everyone else's withdrawn.
const settleOnAccept = async (tx, bookingId, professionalId) => {
  await tx.jobOffer.updateMany({ where: { bookingId, professionalId, status: 'OFFERED' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
  await tx.jobOffer.updateMany({ where: { bookingId, status: 'OFFERED', NOT: { professionalId } }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });
};

// The booking was cancelled, assigned by the team, or deleted: pending offers are withdrawn.
const withdrawAll = (bookingId, db = prisma) => db.jobOffer.updateMany({ where: { bookingId, status: 'OFFERED' }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });

// May this vendor take this booking? In 'nearby' mode only with a live offer,
// or once the booking is open to everyone.
const mayAccept = async (booking, professionalId) => {
  if (!nearbyMode() || booking.openToAllAt) return true;
  return Boolean(await prisma.jobOffer.findFirst({ where: { bookingId: booking.id, professionalId, status: 'OFFERED', expiresAt: { gt: new Date() } } }));
};

// Which open bookings a vendor sees in their "new jobs" list.
const availableWhereFor = (professionalId) =>
  nearbyMode()
    ? {
        status: { in: OPEN_STATUSES },
        professionalId: null,
        OR: [{ openToAllAt: { not: null } }, { offers: { some: { professionalId, status: 'OFFERED', expiresAt: { gt: new Date() } } } }],
      }
    : { status: { in: OPEN_STATUSES }, professionalId: null };

const offerFor = (bookingId, professionalId) =>
  prisma.jobOffer.findFirst({ where: { bookingId, professionalId, status: 'OFFERED', expiresAt: { gt: new Date() } }, select: { expiresAt: true, distanceKm: true, wave: true } });

// The heartbeat: expire offers that ran out and send the next wave; start
// dispatch for open bookings that never started (e.g. created while the
// server was busy); and mark vendors offline whose app stopped reporting.
const tick = async () => {
  if (!nearbyMode()) return { skipped: true };
  const now = new Date();
  await prisma.jobOffer.updateMany({ where: { status: 'OFFERED', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  await prisma.professional.updateMany({ where: { isOnline: true, lastSeenAt: { lt: new Date(Date.now() - 3 * PRESENCE_TTL_MS) } }, data: { isOnline: false, onlineSince: null } });

  const stalled = await prisma.booking.findMany({
    where: { status: { in: OPEN_STATUSES }, professionalId: null, openToAllAt: null, offers: { none: { status: 'OFFERED' } } },
    select: { id: true, dispatchWave: true },
    take: 100,
  });
  let advanced = 0;
  for (const booking of stalled) {
    try {
      if (booking.dispatchWave === 0) await start(booking.id);
      else await advanceIfIdle(booking.id);
      advanced += 1;
    } catch (err) {
      logger.warn({ err: err.message, bookingId: booking.id }, 'Dispatch tick failed for a booking');
    }
  }
  return { advanced };
};

// ---------------------------------------------------------------------------
// Customers: who is around
// ---------------------------------------------------------------------------

// How many vendors are online near a point, the nearest one's distance and a
// rough arrival time. Areas are shown at resolution 7 (~5 km²), never exact positions.
const nearby = async ({ latitude, longitude, categoryId }) => {
  const cell = geo.cellFor(latitude, longitude);
  const vendors = await prisma.professional.findMany({
    where: {
      isOnline: true,
      lastSeenAt: { gte: new Date(Date.now() - PRESENCE_TTL_MS) },
      h3Cell: { in: geo.disk(cell, 6) }, // ~5 km
      onboardingStatus: 'APPROVED',
      user: { isActive: true, deletedAt: null },
      ...(categoryId && { OR: [{ categories: { has: categoryId } }, { categories: { isEmpty: true } }] }),
    },
    select: { h3Cell: true, lastLatitude: true, lastLongitude: true },
  });
  const distances = vendors.map((vendor) => geo.distanceKm(latitude, longitude, vendor.lastLatitude, vendor.lastLongitude)).filter((km) => km !== null).sort((a, b) => a - b);
  const areas = vendors.reduce((acc, vendor) => {
    const area = geo.parent(vendor.h3Cell);
    acc[area] = (acc[area] ?? 0) + 1;
    return acc;
  }, {});
  return {
    vendorsNearby: vendors.length,
    nearestKm: distances[0] ?? null,
    etaMinutes: geo.etaMinutes(distances[0] ?? null),
    radiusKm: 5,
    areas: Object.entries(areas).map(([areaCell, count]) => ({ cell: areaCell, center: geo.center(areaCell), boundary: geo.boundary(areaCell), vendors: count })),
  };
};

// ---------------------------------------------------------------------------
// The team: the live map and a booking's offers
// ---------------------------------------------------------------------------

// Supply and demand per hexagon: online vendors and open bookings.
const map = async ({ resolution = geo.PUBLIC_RESOLUTION, cityId }) => {
  const [vendors, bookings] = await Promise.all([
    prisma.professional.findMany({
      where: { isOnline: true, lastSeenAt: { gte: new Date(Date.now() - PRESENCE_TTL_MS) }, h3Cell: { not: null }, user: { deletedAt: null, ...(cityId && { cityId }) } },
      select: { h3Cell: true },
    }),
    prisma.booking.findMany({ where: { status: { in: [...OPEN_STATUSES, 'ASSIGNED', 'IN_PROGRESS'] }, h3Cell: { not: null }, ...(cityId && { cityId }) }, select: { h3Cell: true, status: true } }),
  ]);
  const cells = new Map();
  const at = (cell) => {
    const key = geo.parent(cell, resolution);
    if (!cells.has(key)) cells.set(key, { cell: key, onlineVendors: 0, openBookings: 0, activeJobs: 0 });
    return cells.get(key);
  };
  vendors.forEach((vendor) => (at(vendor.h3Cell).onlineVendors += 1));
  bookings.forEach((booking) => (OPEN_STATUSES.includes(booking.status) ? (at(booking.h3Cell).openBookings += 1) : (at(booking.h3Cell).activeJobs += 1)));
  const items = [...cells.values()].map((item) => ({ ...item, center: geo.center(item.cell), boundary: geo.boundary(item.cell) }));
  return {
    resolution,
    totals: { onlineVendors: vendors.length, openBookings: bookings.filter((booking) => OPEN_STATUSES.includes(booking.status)).length, activeJobs: bookings.filter((booking) => !OPEN_STATUSES.includes(booking.status)).length },
    cells: items,
  };
};

const offersForBooking = async (bookingId) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, sequence: true, h3Cell: true, dispatchWave: true, openToAllAt: true, status: true } });
  if (!booking) throw ApiError.notFound('Booking not found');
  const offers = await prisma.jobOffer.findMany({
    where: { bookingId },
    orderBy: [{ wave: 'asc' }, { distanceKm: 'asc' }],
    include: { professional: { select: { id: true, rating: true, user: { select: { name: true, phone: true } } } } },
  });
  return {
    bookingNumber: bookingNumber(booking.sequence),
    status: booking.status,
    h3Cell: booking.h3Cell,
    wave: booking.dispatchWave,
    maxWaves: geo.RINGS.length,
    openToAll: Boolean(booking.openToAllAt),
    openToAllAt: booking.openToAllAt,
    offers: offers.map((offer) => ({
      id: offer.id,
      wave: offer.wave,
      status: offer.status === 'OFFERED' && offer.expiresAt <= new Date() ? 'EXPIRED' : offer.status,
      distanceKm: offer.distanceKm === null ? null : Number(offer.distanceKm),
      vendor: { professionalId: offer.professional.id, name: offer.professional.user.name, phone: offer.professional.user.phone, rating: Number(offer.professional.rating) },
      offeredAt: offer.offeredAt,
      expiresAt: offer.expiresAt,
      respondedAt: offer.respondedAt,
    })),
  };
};

module.exports = {
  updatePresence,
  getPresence,
  start,
  startSoon,
  decline,
  advanceIfIdle,
  settleOnAccept,
  withdrawAll,
  mayAccept,
  availableWhereFor,
  offerFor,
  tick,
  nearby,
  map,
  offersForBooking,
};
