const { Router, raw } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./payments.controller');
const schema = require('./payments.schema');

const router = Router();

router.get('/:id', authenticate, validate(schema.getPayment), controller.getById);

router.post('/webhook', raw({ type: 'application/json' }), controller.webhook);

module.exports = router;
