const prisma = require('../../config/prisma');

// Read-only aggregate counts for the admin dashboard's overview page.
// Intentionally simple (counts, not time-series) — this is a first pass at
// "reporting"; swap for real analytics queries once there's a concrete need.
const getStats = async () => {
  const [
    totalCustomers,
    totalProfessionals,
    pendingKyc,
    verifiedProfessionals,
    bookingsByStatus,
    activeAmcSubscriptions,
    totalPartners,
    totalCities,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.user.count({ where: { role: 'PROFESSIONAL' } }),
    prisma.professional.count({ where: { kycStatus: { in: ['PENDING', 'IN_REVIEW'] } } }),
    prisma.professional.count({ where: { kycStatus: 'VERIFIED' } }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.aMCSubscription.count({ where: { status: 'ACTIVE' } }),
    prisma.partner.count(),
    prisma.city.count({ where: { isActive: true } }),
  ]);

  const bookingStatusCounts = bookingsByStatus.reduce((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return {
    users: { totalCustomers, totalProfessionals },
    professionals: { pendingKyc, verified: verifiedProfessionals },
    bookings: {
      total: Object.values(bookingStatusCounts).reduce((sum, n) => sum + n, 0),
      byStatus: bookingStatusCounts,
    },
    amc: { active: activeAmcSubscriptions },
    partners: { total: totalPartners },
    cities: { active: totalCities },
  };
};


// ---------------------------------------------------------------------------
// The admin dashboard's home page and analytics, from real data.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const round1 = (value) => Math.round(value * 10) / 10;
const percentOf = (part, whole) => (whole ? round1((part / whole) * 100) : 0);

// The last `months` calendar months, oldest first, as { key: 'YYYY-MM', label: 'Oct', start, end }.
const monthBuckets = (months) => {
  const now = new Date();
  return Array.from({ length: months }, (_unused, index) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - index), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { key: start.toISOString().slice(0, 7), label: start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), start, end };
  });
};
const countByMonth = (buckets, dates) => buckets.map((bucket) => ({ label: bucket.label, month: bucket.key, value: dates.filter((date) => date >= bucket.start && date < bucket.end).length }));

// Names for a { id: count } tally, largest first.
const named = (counts, names) =>
  Object.entries(counts)
    .map(([id, value]) => ({ id: id === 'null' ? null : id, label: id === 'null' ? 'Not set' : (names.get(id) ?? 'Removed'), value }))
    .sort((a, b) => b.value - a.value);
const tally = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [row[key] ?? 'null']: (acc[row[key] ?? 'null'] ?? 0) + row._count._all }), {});
const lookups = async () => {
  const [categories, cities] = await Promise.all([prisma.serviceCategory.findMany({ select: { id: true, name: true } }), prisma.city.findMany({ select: { id: true, name: true } })]);
  return { categoryNames: new Map(categories.map((c) => [c.id, c.name])), cityNames: new Map(cities.map((c) => [c.id, c.name])), categories };
};

// Home page: headline numbers, the monthly trend, and bookings by service and city.
const getOverview = async ({ months }) => {
  const now = Date.now();
  const buckets = monthBuckets(months);
  const [statusGroups, last30, previous30, trendRows, serviceGroups, cityGroups, collected, names] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.booking.count({ where: { createdAt: { gte: new Date(now - 30 * DAY_MS) } } }),
    prisma.booking.count({ where: { createdAt: { gte: new Date(now - 60 * DAY_MS), lt: new Date(now - 30 * DAY_MS) } } }),
    prisma.booking.findMany({ where: { createdAt: { gte: buckets[0].start } }, select: { createdAt: true } }),
    prisma.booking.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['cityId'], _count: { _all: true } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', bookingId: { not: null } }, _sum: { amount: true } }),
    lookups(),
  ]);
  const byStatus = Object.fromEntries(statusGroups.map((row) => [row.status, row._count._all]));
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  return {
    bookings: {
      total,
      last30Days: last30,
      // Change in bookings created over the last 30 days vs the 30 before.
      changePercent: previous30 ? round1(((last30 - previous30) / previous30) * 100) : last30 ? 100 : 0,
      active: (byStatus.ASSIGNED ?? 0) + (byStatus.IN_PROGRESS ?? 0),
      waitingForVendor: (byStatus.PENDING ?? 0) + (byStatus.MATCHING ?? 0),
      completed: byStatus.COMPLETED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
      byStatus,
    },
    amountCollected: money(collected._sum.amount),
    trend: countByMonth(buckets, trendRows.map((row) => row.createdAt)),
    byService: named(tally(serviceGroups, 'categoryId'), names.categoryNames).slice(0, 8),
    byCity: named(tally(cityGroups, 'cityId'), names.cityNames),
  };
};

// Analytics: bookings or vendors over the last `months` months, optionally for
// one city and/or one service.
const getAnalytics = async ({ type, months, cityId, categoryId }) => {
  const buckets = monthBuckets(months);
  const since = buckets[0].start;
  const names = await lookups();

  if (type === 'vendors') {
    const where = {
      createdAt: { gte: since },
      user: { deletedAt: null, ...(cityId && { cityId }) },
      ...(categoryId && { categories: { has: categoryId } }),
    };
    const vendors = await prisma.professional.findMany({ where, select: { createdAt: true, onboardingStatus: true, categories: true, rating: true, user: { select: { cityId: true } } } });
    const approved = vendors.filter((vendor) => vendor.onboardingStatus === 'APPROVED');
    const rated = vendors.filter((vendor) => Number(vendor.rating) > 0);
    const byCity = vendors.reduce((acc, vendor) => ({ ...acc, [vendor.user.cityId ?? 'null']: (acc[vendor.user.cityId ?? 'null'] ?? 0) + 1 }), {});
    return {
      type,
      months,
      totals: {
        vendors: vendors.length,
        approved: approved.length,
        approvalRate: percentOf(approved.length, vendors.length),
        averageRating: rated.length ? round1(rated.reduce((sum, vendor) => sum + Number(vendor.rating), 0) / rated.length) : null,
      },
      trend: countByMonth(buckets, vendors.map((vendor) => vendor.createdAt)),
      byCity: named(byCity, names.cityNames),
      serviceCoverage: names.categories.map((category) => ({ id: category.id, label: category.name, value: vendors.filter((vendor) => vendor.categories.includes(category.id)).length })).sort((a, b) => b.value - a.value),
      byStatus: ['APPROVED', 'PENDING_APPROVAL', 'SUBMITTED', 'CHANGES_REQUESTED', 'DRAFT', 'REJECTED'].map((status) => ({ id: status, label: status, value: vendors.filter((vendor) => vendor.onboardingStatus === status).length })),
    };
  }

  const where = { createdAt: { gte: since }, ...(cityId && { cityId }), ...(categoryId && { categoryId }) };
  const bookings = await prisma.booking.findMany({ where, select: { createdAt: true, status: true, price: true, categoryId: true, cityId: true, payment: { select: { status: true, amount: true } } } });
  const completed = bookings.filter((booking) => booking.status === 'COMPLETED');
  const completedValue = money(completed.reduce((sum, booking) => sum + Number(booking.price ?? 0), 0));
  const collected = money(bookings.filter((booking) => booking.payment?.status === 'SUCCESS').reduce((sum, booking) => sum + Number(booking.payment.amount), 0));
  const count = (key) => bookings.reduce((acc, booking) => ({ ...acc, [booking[key] ?? 'null']: (acc[booking[key] ?? 'null'] ?? 0) + 1 }), {});
  return {
    type,
    months,
    totals: {
      bookings: bookings.length,
      completed: completed.length,
      completedValue,
      amountCollected: collected,
      completionRate: percentOf(completed.length, bookings.length),
      averageBookingValue: completed.length ? money(completedValue / completed.length) : 0,
    },
    trend: countByMonth(buckets, bookings.map((booking) => booking.createdAt)),
    byCity: named(count('cityId'), names.cityNames),
    byService: named(count('categoryId'), names.categoryNames),
    byStatus: ['AWAITING_PAYMENT', 'PENDING', 'MATCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((status) => ({ id: status, label: status, value: bookings.filter((booking) => booking.status === status).length })),
  };
};

module.exports = { getStats, getOverview, getAnalytics };
