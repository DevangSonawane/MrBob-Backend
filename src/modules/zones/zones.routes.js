const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./zones.controller');
const schema = require('./zones.schema');

const router = Router();

router.get('/cities', controller.listCities);
router.post('/cities', authenticate, authorize('ADMIN'), validate(schema.createCity), controller.createCity);

router.get('/', validate(schema.listZones), controller.listZones);
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createZone), controller.createZone);

module.exports = router;
