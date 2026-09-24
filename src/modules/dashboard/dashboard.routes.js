const { Router } = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./dashboard.controller');

const router = Router();

/**
 * @openapi
 * /dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Aggregate counts for the admin dashboard overview page
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Aggregate stats
 */
router.get('/stats', authenticate, authorize('ADMIN'), controller.getStats);

module.exports = router;
