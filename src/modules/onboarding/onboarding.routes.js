const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./onboarding.controller');

const router = Router();

router.get('/status', authenticate, controller.getStatus);

// Customers onboard through modules/customerOnboarding, vendors through modules/vendorOnboarding.

module.exports = router;
