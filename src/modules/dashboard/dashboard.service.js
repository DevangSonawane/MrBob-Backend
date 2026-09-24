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

module.exports = { getStats };
