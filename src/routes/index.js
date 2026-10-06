const { Router } = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const onboardingRoutes = require('../modules/onboarding/onboarding.routes');
const vendorOnboardingRoutes = require('../modules/vendorOnboarding/vendorOnboarding.routes');
const usersRoutes = require('../modules/users/users.routes');
const professionalsRoutes = require('../modules/professionals/professionals.routes');
const bookingsRoutes = require('../modules/bookings/bookings.routes');
const categoriesRoutes = require('../modules/bookings/categories.routes');
const dispatchRoutes = require('../modules/dispatch/dispatch.routes');
const paymentsRoutes = require('../modules/payments/payments.routes');
const amcRoutes = require('../modules/amc/amc.routes');
const reviewsRoutes = require('../modules/reviews/reviews.routes');
const zonesRoutes = require('../modules/zones/zones.routes');
const partnersRoutes = require('../modules/partners/partners.routes');
const dashboardRoutes = require('../modules/dashboard/dashboard.routes');

// Every module and where it is mounted. Also read by the API docs test,
// which checks each route below has a documented counterpart.
const mounts = [
  ['/auth', authRoutes],
  ['/onboarding', onboardingRoutes],
  ['/vendor-onboarding', vendorOnboardingRoutes],
  ['/users', usersRoutes],
  ['/professionals', professionalsRoutes],
  ['/bookings', bookingsRoutes],
  ['/categories', categoriesRoutes],
  ['/dispatch', dispatchRoutes],
  ['/payments', paymentsRoutes],
  ['/amc', amcRoutes],
  ['/reviews', reviewsRoutes],
  ['/zones', zonesRoutes],
  ['/partners', partnersRoutes],
  ['/dashboard', dashboardRoutes],
];

const router = Router();
mounts.forEach(([path, moduleRouter]) => router.use(path, moduleRouter));

module.exports = router;
module.exports.mounts = mounts;
