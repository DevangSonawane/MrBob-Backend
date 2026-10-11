const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./customerOnboarding.controller');
const schema = require('./customerOnboarding.schema');

const router = Router();

// Request and response shapes are documented in src/docs/paths/customer.js
// (served at /api-docs).

// Steps 1 & 2 — phone number and OTP (public)
router.post('/otp/request', validate(schema.requestOtp), controller.requestOtp);
router.post('/otp/verify', validate(schema.verifyOtp), controller.verifyOtp);

// Where the signed-in customer is in onboarding
router.get('/', authenticate, controller.getStatus);

// Step 3 — name and gender
router.put('/profile', authenticate, validate(schema.saveProfile), controller.saveProfile);

// Step 4 — address
router.put('/address', authenticate, validate(schema.saveAddress), controller.saveAddress);

module.exports = router;
