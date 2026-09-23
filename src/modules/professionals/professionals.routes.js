const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./professionals.controller');
const schema = require('./professionals.schema');

const router = Router();

/**
 * @openapi
 * /professionals:
 *   post:
 *     tags: [Professionals]
 *     summary: Register the current user as a professional
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Professional profile created
 *   get:
 *     tags: [Professionals]
 *     summary: List professionals (admin/ops)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated list of professionals
 */
router.post('/', authenticate, validate(schema.registerProfessional), controller.register);
router.get('/', authenticate, authorize('ADMIN'), validate(schema.listProfessionals), controller.list);

/**
 * @openapi
 * /professionals/me:
 *   get:
 *     tags: [Professionals]
 *     summary: Get the current user's professional profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Professional profile
 *   patch:
 *     tags: [Professionals]
 *     summary: Update the current user's professional profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated professional profile
 */
router.get('/me', authenticate, authorize('PROFESSIONAL'), controller.getMe);
router.patch('/me', authenticate, authorize('PROFESSIONAL'), validate(schema.updateProfessional), controller.updateMe);

/**
 * @openapi
 * /professionals/{id}:
 *   get:
 *     tags: [Professionals]
 *     summary: Get a professional by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A professional
 */
router.get('/:id', authenticate, validate(schema.getProfessional), controller.getById);

/**
 * @openapi
 * /professionals/{id}/kyc-status:
 *   patch:
 *     tags: [Professionals]
 *     summary: Update a professional's KYC/verification status (admin/ops)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated professional
 */
router.patch('/:id/kyc-status', authenticate, authorize('ADMIN'), validate(schema.updateKycStatus), controller.updateKycStatus);

module.exports = router;
