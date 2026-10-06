const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./onboarding.controller');
const schema = require('./onboarding.schema');

const router = Router();

router.get('/status', authenticate, controller.getStatus);

router.post('/customer', authenticate, validate(schema.completeCustomer), controller.completeCustomer);

// Professionals onboard through the step-by-step flow in modules/vendorOnboarding.

module.exports = router;
