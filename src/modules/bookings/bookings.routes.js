const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./bookings.controller');
const schema = require('./bookings.schema');

const router = Router();

router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createBooking), controller.create);
router.get('/', authenticate, validate(schema.listBookings), controller.list);

router.get('/:id', authenticate, validate(schema.getBooking), controller.getById);

router.patch(
  '/:id/status',
  authenticate,
  authorize('PROFESSIONAL', 'ADMIN'),
  validate(schema.updateStatus),
  controller.updateStatus,
);

module.exports = router;
