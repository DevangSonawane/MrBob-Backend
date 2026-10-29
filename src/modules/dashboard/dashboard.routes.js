const { Router } = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const validate = require('../../utils/validate');
const controller = require('./dashboard.controller');
const schema = require('./dashboard.schema');

const router = Router();

router.get('/stats', authenticate, authorize('ADMIN'), controller.getStats);
router.get('/overview', authenticate, authorize('ADMIN'), validate(schema.overview), controller.getOverview);
router.get('/analytics', authenticate, authorize('ADMIN'), validate(schema.analytics), controller.getAnalytics);

router.get('/best-sellers', authenticate, authorize('ADMIN'), validate(schema.bestSellers), controller.getBestSellers);

module.exports = router;
