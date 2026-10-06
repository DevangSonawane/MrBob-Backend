const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./dispatch.controller');
const schema = require('./dispatch.schema');

const router = Router();

router.get(
  '/bookings/:id/candidates',
  authenticate,
  authorize('ADMIN'),
  validate(schema.bookingParam),
  controller.findCandidates,
);

router.post('/bookings/:id/assign', authenticate, authorize('ADMIN'), validate(schema.assign), controller.assign);

module.exports = router;
