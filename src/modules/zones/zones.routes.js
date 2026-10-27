const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./zones.controller');
const schema = require('./zones.schema');

const router = Router();

router.get('/cities', controller.listCities);
router.post('/cities', authenticate, authorize('ADMIN'), validate(schema.createCity), controller.createCity);

router.delete('/cities/:id', authenticate, authorize('ADMIN'), validate(schema.byId), controller.removeCity);

// The pincode geofence. Anyone can ask whether a pincode is served; the team manages the list.
router.get('/serviceability', validate(schema.checkPincode), controller.checkPincode);
router.get('/pincodes', authenticate, authorize('ADMIN'), validate(schema.listPincodes), controller.listPincodes);
router.post('/pincodes', authenticate, authorize('ADMIN'), validate(schema.addPincodes), controller.addPincodes);
router.patch('/pincodes/:id', authenticate, authorize('ADMIN'), validate(schema.updatePincode), controller.updatePincode);
router.delete('/pincodes/:id', authenticate, authorize('ADMIN'), validate(schema.byId), controller.removePincode);

router.get('/', validate(schema.listZones), controller.listZones);
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createZone), controller.createZone);

router.delete('/:id', authenticate, authorize('ADMIN'), validate(schema.byId), controller.removeZone);

module.exports = router;
