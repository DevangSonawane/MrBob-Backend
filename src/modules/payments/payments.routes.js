const { Router, raw } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./payments.controller');
const schema = require('./payments.schema');

const router = Router();

/**
 * @openapi
 * /payments/bookings/{bookingId}/order:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Razorpay order for a booking
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Created payment + Razorpay order
 */
router.post(
  '/bookings/:bookingId/order',
  authenticate,
  validate(schema.createOrderForBooking),
  controller.createOrderForBooking,
);

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Get a payment by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A payment
 */
router.get('/:id', authenticate, validate(schema.getPayment), controller.getById);

/**
 * @openapi
 * /payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Razorpay webhook receiver (signature-verified, not authenticated)
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook', raw({ type: 'application/json' }), controller.webhook);

module.exports = router;
