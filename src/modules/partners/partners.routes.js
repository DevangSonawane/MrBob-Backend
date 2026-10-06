const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./partners.controller');
const schema = require('./partners.schema');

const router = Router();

router.post('/', authenticate, authorize('ADMIN'), validate(schema.createPartner), controller.create);
router.get('/', authenticate, authorize('ADMIN'), validate(schema.listPartners), controller.list);

module.exports = router;
