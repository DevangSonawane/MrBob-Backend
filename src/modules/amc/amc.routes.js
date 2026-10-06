const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./amc.controller');
const schema = require('./amc.schema');

const router = Router();

router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createSubscription), controller.create);
router.get('/', authenticate, authorize('CUSTOMER', 'ADMIN'), validate(schema.listSubscriptions), controller.list);

router.get('/:id', authenticate, validate(schema.getSubscription), controller.getById);

router.post('/:id/cancel', authenticate, validate(schema.getSubscription), controller.cancel);

module.exports = router;
