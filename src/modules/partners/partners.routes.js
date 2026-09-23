const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./partners.controller');
const schema = require('./partners.schema');

const router = Router();

/**
 * @openapi
 * /partners:
 *   post:
 *     tags: [Partners]
 *     summary: Create a builder/RWA partner (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created partner
 *   get:
 *     tags: [Partners]
 *     summary: List partners (admin/ops)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated list of partners
 */
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createPartner), controller.create);
router.get('/', authenticate, authorize('ADMIN'), validate(schema.listPartners), controller.list);

module.exports = router;
