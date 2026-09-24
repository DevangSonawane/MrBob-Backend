const { Router } = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const onboardingRoutes = require('../modules/onboarding/onboarding.routes');
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

const router = Router();

router.use('/auth', authRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/users', usersRoutes);
router.use('/professionals', professionalsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/categories', categoriesRoutes);
router.use('/dispatch', dispatchRoutes);
router.use('/payments', paymentsRoutes);
router.use('/amc', amcRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/zones', zonesRoutes);
router.use('/partners', partnersRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
