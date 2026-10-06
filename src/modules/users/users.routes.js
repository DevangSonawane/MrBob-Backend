const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./users.controller');
const schema = require('./users.schema');

const router = Router();

router.get('/', authenticate, authorize('ADMIN'), validate(schema.listUsers), controller.list);

router.post('/', authenticate, authorize('ADMIN'), validate(schema.createUser), controller.create);

router.get('/summary', authenticate, authorize('ADMIN'), controller.getSummary);

router.patch('/me', authenticate, validate(schema.updateMe), controller.updateMe);

router.get('/:id', authenticate, authorize('ADMIN'), validate(schema.getUser), controller.getById);

router.patch('/:id/active', authenticate, authorize('ADMIN'), validate(schema.setActive), controller.setActive);

module.exports = router;
