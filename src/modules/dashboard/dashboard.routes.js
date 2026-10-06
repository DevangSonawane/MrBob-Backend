const { Router } = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./dashboard.controller');

const router = Router();

router.get('/stats', authenticate, authorize('ADMIN'), controller.getStats);

module.exports = router;
