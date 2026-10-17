const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { dateRange, personSearch } = require('../../utils/queryFilters');

// Ratings on completed bookings, both ways: the customer rates the vendor and
// the vendor rates the customer, once each per booking (either can change
// theirs later). The vendor's average is kept on their profile.

const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;
const round = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100);

const recomputeProfessionalRating = async (professionalId) => {
  if (!professionalId) return;
  const result = await prisma.review.aggregate({ where: { authorRole: 'CUSTOMER', booking: { professionalId } }, _avg: { rating: true } });
  await prisma.professional.update({ where: { id: professionalId }, data: { rating: result._avg.rating ?? 0 } });
};

// Rates (or re-rates) a completed booking as its customer or its vendor.
const rate = async (bookingId, user, { rating, comment }) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { professional: { select: { userId: true } } } });
  const role = user.role === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'CUSTOMER';
  const mine = booking && (role === 'CUSTOMER' ? booking.customerId === user.id : booking.professional?.userId === user.id);
  if (!mine) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'COMPLETED') throw ApiError.conflict('A booking can be rated once it is completed');

  const data = { rating, comment: comment?.trim() || null, userId: user.id };
  await prisma.review.upsert({ where: { bookingId_authorRole: { bookingId, authorRole: role } }, update: data, create: { ...data, bookingId, authorRole: role } });
  if (role === 'CUSTOMER') await recomputeProfessionalRating(booking.professionalId);
  return { bookingId, role };
};

// The original customer endpoint (POST /reviews), kept for older app builds.
const create = async (userId, { bookingId, rating, comment }) => {
  await rate(bookingId, { id: userId, role: 'CUSTOMER' }, { rating, comment });
  return prisma.review.findUnique({ where: { bookingId_authorRole: { bookingId, authorRole: 'CUSTOMER' } } });
};

// Public: what customers said about a vendor.
const listForProfessional = async (professionalId, { page, limit }) => {
  const where = { authorRole: 'CUSTOMER', booking: { professionalId } };
  const [items, total] = await Promise.all([
    prisma.review.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } }),
    prisma.review.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

// ---------------------------------------------------------------------------
// The team's view
// ---------------------------------------------------------------------------

const adminInclude = {
  user: { select: { id: true, name: true } },
  booking: {
    select: {
      id: true,
      sequence: true,
      completedAt: true,
      category: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      professional: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
    },
  },
};

const adminView = (review) => {
  const { booking } = review;
  const vendor = booking.professional ? { professionalId: booking.professional.id, userId: booking.professional.user.id, name: booking.professional.user.name, phone: booking.professional.user.phone } : null;
  const customer = { id: booking.customer.id, name: booking.customer.name, phone: booking.customer.phone };
  const byCustomer = review.authorRole === 'CUSTOMER';
  return {
    id: review.id,
    // CUSTOMER = the customer rated the vendor; PROFESSIONAL = the vendor rated the customer.
    authorRole: review.authorRole,
    rating: review.rating,
    comment: review.comment,
    from: byCustomer ? { type: 'CUSTOMER', ...customer } : { type: 'VENDOR', ...vendor },
    about: byCustomer ? { type: 'VENDOR', ...vendor } : { type: 'CUSTOMER', ...customer },
    booking: { id: booking.id, bookingNumber: bookingNumber(booking.sequence), service: booking.category, completedAt: booking.completedAt },
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
};

const filtersOf = ({ authorRole, rating, maxRating, professionalId, customerId, search, createdFrom, createdTo }) => {
  const createdAt = dateRange(createdFrom, createdTo);
  const number = search?.match(/^bk-?0*(\d+)$/i);
  return {
    ...(authorRole && { authorRole }),
    ...(rating && { rating }),
    ...(maxRating && { rating: { lte: maxRating } }),
    ...(createdAt && { createdAt }),
    ...((professionalId || customerId || search) && {
      booking: {
        ...(professionalId && { professionalId }),
        ...(customerId && { customerId }),
        ...(search && (number ? { sequence: Number(number[1]) } : { OR: [{ customer: personSearch(search) }, { professional: { user: personSearch(search) } }] })),
      },
    }),
  };
};

// Averages and the 1-5 spread for a set of ratings.
const stats = async (where) => {
  const [aggregate, groups] = await Promise.all([
    prisma.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
  ]);
  return {
    average: round(aggregate._avg.rating),
    count: aggregate._count._all,
    distribution: Object.fromEntries([5, 4, 3, 2, 1].map((stars) => [stars, groups.find((group) => group.rating === stars)?._count._all ?? 0])),
  };
};

const listAll = async (query) => {
  const where = filtersOf(query);
  const [rows, total, summary] = await Promise.all([
    prisma.review.findMany({ where, ...toSkipTake(query), orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, include: adminInclude }),
    prisma.review.count({ where }),
    stats(where),
  ]);
  return { ...paginatedResponse(rows.map(adminView), total, query), summary };
};

// Headline numbers: how vendors and customers are rated, and how many
// completed bookings are still waiting for a rating.
const getSummary = async () => {
  const [vendors, customers, completed, ratedByCustomer, ratedByVendor] = await Promise.all([
    stats({ authorRole: 'CUSTOMER' }),
    stats({ authorRole: 'PROFESSIONAL' }),
    prisma.booking.count({ where: { status: 'COMPLETED' } }),
    prisma.review.count({ where: { authorRole: 'CUSTOMER', booking: { status: 'COMPLETED' } } }),
    prisma.review.count({ where: { authorRole: 'PROFESSIONAL', booking: { status: 'COMPLETED' } } }),
  ]);
  return {
    vendorRatings: vendors,
    customerRatings: customers,
    completedBookings: completed,
    awaitingCustomerRating: completed - ratedByCustomer,
    awaitingVendorRating: completed - ratedByVendor,
  };
};

module.exports = { rate, create, listForProfessional, listAll, getSummary, recomputeProfessionalRating };
