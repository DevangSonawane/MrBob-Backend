const { Router, raw } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./payments.controller');
const schema = require('./payments.schema');

const router = Router();

// The team's list of every payment, and the totals above it.
router.get('/', authenticate, authorize('ADMIN'), validate(schema.listPayments), controller.listAll);
router.get('/summary', authenticate, authorize('ADMIN'), controller.getSummary);
router.get('/:id', authenticate, validate(schema.getPayment), controller.getById);

router.post('/webhook', raw({ type: 'application/json' }), controller.webhook);

module.exports = router;
