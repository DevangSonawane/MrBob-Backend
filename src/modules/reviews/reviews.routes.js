const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./reviews.controller');
const schema = require('./reviews.schema');

const router = Router();

router.post('/', authenticate, authorize('CUSTOMER'), validate(schema.createReview), controller.create);

router.get('/', authenticate, authorize('ADMIN'), validate(schema.listAll), controller.listAll);

router.get('/professional/:professionalId', validate(schema.listForProfessional), controller.listForProfessional);

module.exports = router;
