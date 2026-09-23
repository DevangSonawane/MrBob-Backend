const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./dispatch.controller');
const schema = require('./dispatch.schema');

const router = Router();

/**
 * @openapi
 * /dispatch/bookings/{id}/candidates:
 *   get:
 *     tags: [Dispatch]
 *     summary: Find candidate professionals for a booking (admin/ops)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ranked list of candidate professionals
 */
router.get(
  '/bookings/:id/candidates',
  authenticate,
  authorize('ADMIN'),
  validate(schema.bookingParam),
  controller.findCandidates,
);

/**
 * @openapi
 * /dispatch/bookings/{id}/assign:
 *   post:
 *     tags: [Dispatch]
 *     summary: Assign a professional to a booking (admin/ops)
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
 *             required: [professionalId]
 *             properties:
 *               professionalId: { type: string }
 *     responses:
 *       200:
 *         description: Booking updated to ASSIGNED
 */
router.post('/bookings/:id/assign', authenticate, authorize('ADMIN'), validate(schema.assign), controller.assign);

module.exports = router;
