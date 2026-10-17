const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./bookings.controller');
const schema = require('./bookings.schema');
const { getImage: getCompletionImage } = require('../jobs/jobs.routes');

const router = Router();

// Request and response shapes are documented in src/docs/paths/bookings.js
// (served at /api-docs).

// The whole booking — service, date & time, problem, address, payment choice — in one call.
router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createBooking), controller.create);
// The same, made by the team from the web dashboard for a customer who called or walked in.
router.post('/admin', authenticate, authorize('ADMIN'), validate(schema.createForCustomer), controller.createForCustomer);

// Customers see their own bookings, professionals their jobs, admins everything (with filters).
router.get('/', authenticate, validate(schema.listBookings), controller.list);
router.get('/summary', authenticate, authorize('ADMIN'), controller.getSummary);
router.get('/:id', authenticate, validate(schema.getBooking), controller.getById);
router.get('/:id/completion-images/:imageId', authenticate, ...getCompletionImage);
router.delete('/:id', authenticate, authorize('SUPER_ADMIN'), validate(schema.getBooking), controller.remove);

// Payment
router.post('/:id/payment/confirm', authenticate, authorize('CUSTOMER'), validate(schema.confirmPayment), controller.confirmPayment);
router.post('/:id/payment/collect', authenticate, authorize('PROFESSIONAL', 'ADMIN'), validate(schema.collectPayment), controller.collectPayment);
router.post('/:id/payment/refund', authenticate, authorize('ADMIN'), validate(schema.markRefunded), controller.markRefunded);

// Changes
router.post('/:id/cancel', authenticate, authorize('CUSTOMER', 'ADMIN'), validate(schema.cancelBooking), controller.cancel);
router.post('/:id/reschedule', authenticate, authorize('CUSTOMER', 'ADMIN'), validate(schema.rescheduleBooking), controller.reschedule);
router.patch('/:id/status', authenticate, authorize('ADMIN'), validate(schema.updateStatus), controller.updateStatus);

module.exports = router;
