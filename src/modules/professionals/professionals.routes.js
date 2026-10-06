const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./professionals.controller');
const schema = require('./professionals.schema');

const router = Router();

router.get('/', authenticate, authorize('ADMIN'), validate(schema.listProfessionals), controller.list);

router.get('/me', authenticate, authorize('PROFESSIONAL'), controller.getMe);
router.patch('/me', authenticate, authorize('PROFESSIONAL'), validate(schema.updateProfessional), controller.updateMe);

router.get('/:id', authenticate, validate(schema.getProfessional), controller.getById);

router.get('/:id/photo', authenticate, validate(schema.getProfessional), controller.getPhoto);

// Creating a professional profile and deciding its KYC outcome both happen
// through the vendor onboarding flow — see modules/vendorOnboarding.

module.exports = router;
