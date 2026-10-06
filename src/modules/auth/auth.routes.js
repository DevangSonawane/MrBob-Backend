const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./auth.controller');
const schema = require('./auth.schema');

const router = Router();

router.post('/otp/request', validate(schema.requestOtp), controller.requestOtp);

router.post('/otp/verify', validate(schema.verifyOtp), controller.verifyOtp);

router.post('/signup', validate(schema.signup), controller.signup);

router.post('/login', validate(schema.login), controller.login);

router.post('/refresh', validate(schema.refresh), controller.refresh);

router.get('/me', authenticate, controller.me);

module.exports = router;
