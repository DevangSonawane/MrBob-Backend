const { Router } = require('express');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { authenticate, authorize } = require('../../middlewares/auth');
const service = require('./wallet.service');
const schema = require('./wallet.schema');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const page = (res, result) => res.status(200).json({ success: true, ...result });

// The vendor's own wallet. Mounted inside /vendor, which already restricts the role.
const addVendorRoutes = (router) => {
  router.get('/wallet', catchAsync(async (req, res) => ok(res, await service.getMyWallet(req.user))));
  router.get('/wallet/transactions', validate(schema.listTransactions), catchAsync(async (req, res) => page(res, await service.listMyTransactions(req.user, req.query))));
  router.get('/wallet/pending', validate(schema.listPending), catchAsync(async (req, res) => page(res, await service.listMyPending(req.user, req.query))));
};

// The team's side, mounted at /payouts: who is owed what, and recording payouts.
const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/', validate(schema.listPayouts), catchAsync(async (req, res) => page(res, await service.listPayouts(req.query))));
router.get('/due', validate(schema.listDue), catchAsync(async (req, res) => page(res, await service.listDue(req.query))));
router.get('/vendors/:professionalId', validate(schema.vendorWallet), catchAsync(async (req, res) => ok(res, await service.getVendorWallet(req.params.professionalId))));
router.get('/vendors/:professionalId/transactions', validate(schema.vendorTransactions), catchAsync(async (req, res) => page(res, await service.listVendorTransactions(req.params.professionalId, req.query))));
router.get('/vendors/:professionalId/pending', validate(schema.vendorPending), catchAsync(async (req, res) => page(res, await service.listVendorPending(req.params.professionalId, req.query))));
// Sending money out is a super admin decision.
router.post('/vendors/:professionalId', authorize('SUPER_ADMIN'), validate(schema.createPayout), catchAsync(async (req, res) => ok(res, await service.createPayout(req.params.professionalId, req.body, req.user), 201)));

module.exports = router;
module.exports.addVendorRoutes = addVendorRoutes;
