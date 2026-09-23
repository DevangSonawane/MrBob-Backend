const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./reviews.controller');
const schema = require('./reviews.schema');

const router = Router();

/**
 * @openapi
 * /reviews:
 *   post:
 *     tags: [Reviews]
 *     summary: Review a completed booking (customer)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created review
 */
router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createReview), controller.create);

/**
 * @openapi
 * /reviews/professional/{professionalId}:
 *   get:
 *     tags: [Reviews]
 *     summary: List reviews for a professional
 *     parameters:
 *       - in: path
 *         name: professionalId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated list of reviews
 */
router.get('/professional/:professionalId', validate(schema.listForProfessional), controller.listForProfessional);

module.exports = router;
