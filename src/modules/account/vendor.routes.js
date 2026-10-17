const { Router } = require('express');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { authenticate, authorize } = require('../../middlewares/auth');
const users = require('../users/users.controller');
const vendors = require('../vendorOnboarding/vendorOnboarding.service');
const bookings = require('../bookings/bookings.controller');
const bookingsSchema = require('../bookings/bookings.schema');
const reviews = require('../reviews/reviews.controller');
const reviewsSchema = require('../reviews/reviews.schema');
const { addOwnRoutes: addDisputeRoutes } = require('../disputes/disputes.routes');
const { addVendorRoutes: addJobRoutes } = require('../jobs/jobs.routes');
const { addVendorRoutes: addWalletRoutes } = require('../wallet/wallet.routes');
const schema = require('./account.schema');

// The vendor app's own corner of the API: the signed-in vendor's profile and
// the jobs assigned to them.
const router = Router();
router.use(authenticate, authorize('PROFESSIONAL'));

const ok = (res, data) => res.status(200).json({ success: true, data });

router.get('/profile', catchAsync(async (req, res) => ok(res, await vendors.getMyProfile(req.user.id))));
router.patch('/profile', validate(schema.updateVendorProfile), catchAsync(async (req, res) => ok(res, await vendors.updateMyProfile(req.user.id, req.body))));
router.delete('/profile', users.deleteMe);

router.get('/bookings', validate(bookingsSchema.listBookings), bookings.list);
router.get('/bookings/:id', validate(bookingsSchema.getBooking), bookings.getById);
// Rate the customer once the booking is completed (again to change it).
router.post('/bookings/:id/rating', validate(reviewsSchema.rateBooking), reviews.rateBooking);

// Taking and doing jobs, and the money earned from them.
addJobRoutes(router);
addWalletRoutes(router);

// Help & disputes raised by this vendor.
addDisputeRoutes(router);

module.exports = router;
