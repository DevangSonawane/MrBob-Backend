const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { uploadFiles } = require('../../middlewares/upload');
const controller = require('./vendorOnboarding.controller');
const schema = require('./vendorOnboarding.schema');

const router = Router();

// Request and response shapes for every route here are documented in
// src/docs/paths/vendorOnboarding.js (served at /api-docs).

// ---------------------------------------------------------------------------
// Steps 1 & 2 — phone number and OTP (public)
// ---------------------------------------------------------------------------

router.post('/otp/request', validate(schema.requestOtp), controller.requestOtp);
router.post('/otp/verify', validate(schema.verifyOtp), controller.verifyOtp);

// ---------------------------------------------------------------------------
// Step 3 — enter details (the signed-in vendor)
// ---------------------------------------------------------------------------

router.get('/', authenticate, controller.getMine);
router.get('/status', authenticate, controller.getMyStatus);

router.put('/personal-details', authenticate, validate(schema.savePersonalDetails), controller.savePersonalDetails);

router.put('/profile-photo', authenticate, uploadFiles(['photo'], { imagesOnly: true }), controller.saveProfilePhoto);
router.get('/profile-photo', authenticate, controller.getMyProfilePhoto);

router.put('/services', authenticate, validate(schema.saveServices), controller.saveServices);

router.put('/documents/:type', authenticate, uploadFiles(['front', 'back']), validate(schema.saveDocument), controller.saveDocument);

router.put('/bank-details', authenticate, uploadFiles(['proof']), validate(schema.saveBankDetails), controller.saveBankDetails);

router.get('/documents/:type/files/:side', authenticate, validate(schema.documentFile), controller.getMyDocumentFile);

router.post('/submit', authenticate, controller.submit);

// ---------------------------------------------------------------------------
// Step 4 — verify vendor: review queue and document verification (admins)
// ---------------------------------------------------------------------------

router.get('/applications', authenticate, authorize('ADMIN'), validate(schema.listApplications), controller.listApplications);

router.get('/applications/summary', authenticate, authorize('ADMIN'), controller.getSummary);

router.get('/applications/:id', authenticate, authorize('ADMIN'), validate(schema.applicationParams), controller.getApplication);

router.get(
  '/applications/:id/profile-photo',
  authenticate,
  authorize('ADMIN'),
  validate(schema.applicationParams),
  controller.getApplicationProfilePhoto,
);

router.get(
  '/applications/:id/documents/:type/files/:side',
  authenticate,
  authorize('ADMIN'),
  validate(schema.applicationDocumentFile),
  controller.getApplicationDocumentFile,
);

router.post(
  '/applications/:id/documents/:type/verify',
  authenticate,
  authorize('ADMIN'),
  validate(schema.applicationDocumentParams),
  controller.verifyDocument,
);

router.post(
  '/applications/:id/documents/:type/reject',
  authenticate,
  authorize('ADMIN'),
  validate(schema.rejectDocument),
  controller.rejectDocument,
);

router.post(
  '/applications/:id/request-changes',
  authenticate,
  authorize('ADMIN'),
  validate(schema.requestChanges),
  controller.requestChanges,
);

// ---------------------------------------------------------------------------
// Step 4 — verify vendor: final decision (super admin). Approval is step 5.
// ---------------------------------------------------------------------------

router.post('/applications/:id/approve', authenticate, authorize('SUPER_ADMIN'), validate(schema.applicationParams), controller.approve);

router.post('/applications/:id/reject', authenticate, authorize('SUPER_ADMIN'), validate(schema.rejectApplication), controller.reject);

router.post('/applications/:id/reopen', authenticate, authorize('SUPER_ADMIN'), validate(schema.reopenApplication), controller.reopen);

module.exports = router;
