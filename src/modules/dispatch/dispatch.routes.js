const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./dispatch.controller');
const schema = require('./dispatch.schema');
const { addAdminRoutes } = require('../matching/matching.routes');

const router = Router();

router.get(
  '/bookings/:id/candidates',
  authenticate,
  authorize('ADMIN'),
  validate(schema.bookingParam),
  controller.findCandidates,
);

router.post('/bookings/:id/assign', authenticate, authorize('ADMIN'), validate(schema.assign), controller.assign);

// Nearby (H3) dispatch: the live supply/demand map and each booking's offers.
addAdminRoutes(router, { authenticate, authorize });

module.exports = router;
