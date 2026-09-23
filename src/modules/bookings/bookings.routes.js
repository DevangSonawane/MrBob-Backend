const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./bookings.controller');
const schema = require('./bookings.schema');

const router = Router();

/**
 * @openapi
 * /bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Create a booking (customer)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, address]
 *             properties:
 *               categoryId: { type: string }
 *               address: { type: string }
 *               scheduledAt: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Created booking (status PENDING)
 *   get:
 *     tags: [Bookings]
 *     summary: List bookings visible to the current user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated list of bookings
 */
router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createBooking), controller.create);
router.get('/', authenticate, validate(schema.listBookings), controller.list);

/**
 * @openapi
 * /bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: Get a booking by id (customer/professional on the booking, or admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A booking
 */
router.get('/:id', authenticate, validate(schema.getBooking), controller.getById);

/**
 * @openapi
 * /bookings/{id}/status:
 *   patch:
 *     tags: [Bookings]
 *     summary: Transition a booking's status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [MATCHING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Updated booking
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize('PROFESSIONAL', 'ADMIN'),
  validate(schema.updateStatus),
  controller.updateStatus,
);

module.exports = router;
