const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./amc.controller');
const schema = require('./amc.schema');

const router = Router();

/**
 * @openapi
 * /amc:
 *   post:
 *     tags: [AMC]
 *     summary: Create an AMC subscription (customer)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created subscription
 *   get:
 *     tags: [AMC]
 *     summary: List the current customer's AMC subscriptions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated list of subscriptions
 */
router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createSubscription), controller.create);
router.get('/', authenticate, authorize('CUSTOMER'), validate(schema.listMine), controller.listMine);

/**
 * @openapi
 * /amc/{id}:
 *   get:
 *     tags: [AMC]
 *     summary: Get an AMC subscription by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A subscription
 */
router.get('/:id', authenticate, validate(schema.getSubscription), controller.getById);

/**
 * @openapi
 * /amc/{id}/cancel:
 *   post:
 *     tags: [AMC]
 *     summary: Cancel an AMC subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cancelled subscription
 */
router.post('/:id/cancel', authenticate, validate(schema.getSubscription), controller.cancel);

module.exports = router;
