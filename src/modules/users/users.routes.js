const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { uploadFiles } = require('../../middlewares/upload');
const controller = require('./users.controller');
const schema = require('./users.schema');

const router = Router();

// Request and response shapes are documented in src/docs/paths/users.js and
// src/docs/paths/customer.js (served at /api-docs).

// ---------------------------------------------------------------------------
// The signed-in user's own account. Declared before '/:id' so "me" is never
// read as an id.
// ---------------------------------------------------------------------------

router.get('/me', authenticate, controller.getMe);
router.patch('/me', authenticate, validate(schema.updateMe), controller.updateMe);
router.delete('/me', authenticate, controller.deleteMe);

router.put('/me/photo', authenticate, uploadFiles(['photo'], { imagesOnly: true }), controller.setMyPhoto);
router.delete('/me/photo', authenticate, controller.removeMyPhoto);

router.post('/me/phone/request', authenticate, validate(schema.requestPhoneChange), controller.requestPhoneChange);
router.post('/me/phone/verify', authenticate, validate(schema.confirmPhoneChange), controller.confirmPhoneChange);

router.get('/me/addresses', authenticate, controller.listMyAddresses);
router.post('/me/addresses', authenticate, validate(schema.createAddress), controller.createMyAddress);
router.patch('/me/addresses/:addressId', authenticate, validate(schema.updateAddress), controller.updateMyAddress);
router.post('/me/addresses/:addressId/default', authenticate, validate(schema.addressOnly), controller.setMyDefaultAddress);
router.delete('/me/addresses/:addressId', authenticate, validate(schema.addressOnly), controller.removeMyAddress);

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

router.get('/', authenticate, authorize('ADMIN'), validate(schema.listUsers), controller.list);
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createUser), controller.create);
router.get('/summary', authenticate, authorize('ADMIN'), controller.getSummary);

router.get('/:id', authenticate, authorize('ADMIN'), validate(schema.getUser), controller.getById);
router.get('/:id/photo', authenticate, validate(schema.getUser), controller.getPhoto);
router.patch('/:id/active', authenticate, authorize('ADMIN'), validate(schema.setActive), controller.setActive);

router.get('/:id/location', authenticate, authorize('ADMIN'), validate(schema.getUser), controller.getLocation);

// Editing or deleting someone else's account is a super admin decision.
router.put('/:id/location', authenticate, authorize('SUPER_ADMIN'), validate(schema.setLocation), controller.setLocation);
router.patch('/:id', authenticate, authorize('SUPER_ADMIN'), validate(schema.adminUpdate), controller.adminUpdate);
router.delete('/:id', authenticate, authorize('SUPER_ADMIN'), validate(schema.getUser), controller.adminDelete);

module.exports = router;
