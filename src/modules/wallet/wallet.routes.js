const express = require('express');
const { Router } = express;
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { authenticate, authorize } = require('../../middlewares/auth');
const service = require('./wallet.service');
const settings = require('./payoutSettings.service');
const payoutAccount = require('./payoutAccount.service');
const provider = require('./payoutProvider');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
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

// RazorpayX tells us when a payout went through or failed. Public, but signed;
// it needs the raw body (see app.js), so it sits before the auth below.
router.post(
  '/webhook',
  express.raw({ type: '*/*' }),
  catchAsync(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    if (!provider.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) throw ApiError.badRequest('Invalid signature');
    const result = await service.handleProviderEvent(JSON.parse(raw.toString('utf8')));
    logger.info({ event: JSON.parse(raw.toString('utf8')).event, ...result }, 'Payout webhook');
    res.status(200).json({ success: true, data: result });
  }),
);

router.use(authenticate, authorize('ADMIN'));

// Payout terms: the platform default, and each vendor's own. Changing them is a super admin decision.
router.get('/settings', catchAsync(async (req, res) => ok(res, await settings.getSettings())));
router.put('/settings', authorize('SUPER_ADMIN'), validate(schema.updateSettings), catchAsync(async (req, res) => ok(res, await settings.updateSettings(req.body, req.user))));
router.get('/vendor-terms', validate(schema.listVendorTerms), catchAsync(async (req, res) => page(res, await settings.listVendorTerms(req.query))));
router.put('/vendor-terms', authorize('SUPER_ADMIN'), validate(schema.setManyVendorTerms), catchAsync(async (req, res) => ok(res, await settings.setManyVendorTerms(req.body))));
router.put('/vendors/:professionalId/terms', authorize('SUPER_ADMIN'), validate(schema.setVendorTerms), catchAsync(async (req, res) => ok(res, await settings.setVendorTerms(req.params.professionalId, req.body))));

// Paying vendors through the provider: one vendor now, or the automatic run now.
router.post('/vendors/:professionalId/send', authorize('SUPER_ADMIN'), validate(schema.sendPayout), catchAsync(async (req, res) => ok(res, await service.sendPayout(req.params.professionalId, { ...req.body, actor: req.user }), 201)));
router.post('/run-automatic', authorize('SUPER_ADMIN'), catchAsync(async (req, res) => ok(res, await service.runAutomaticPayouts({ force: true, actor: req.user }))));
router.post('/refresh', catchAsync(async (req, res) => ok(res, await service.refreshProcessing())));

// Where a vendor is paid: bank account and UPI id.
router.get('/vendors/:professionalId/payout-account', validate(schema.vendorWallet), catchAsync(async (req, res) => ok(res, await payoutAccount.get(req.params.professionalId))));
router.put('/vendors/:professionalId/payout-account', authorize('SUPER_ADMIN'), validate(schema.setPayoutAccount), catchAsync(async (req, res) => ok(res, await payoutAccount.set(req.params.professionalId, req.body, req.user))));

router.get('/', validate(schema.listPayouts), catchAsync(async (req, res) => page(res, await service.listPayouts(req.query))));
router.get('/due', validate(schema.listDue), catchAsync(async (req, res) => page(res, await service.listDue(req.query))));
router.get('/vendors/:professionalId', validate(schema.vendorWallet), catchAsync(async (req, res) => ok(res, await service.getVendorWallet(req.params.professionalId))));
router.get('/vendors/:professionalId/transactions', validate(schema.vendorTransactions), catchAsync(async (req, res) => page(res, await service.listVendorTransactions(req.params.professionalId, req.query))));
router.get('/vendors/:professionalId/pending', validate(schema.vendorPending), catchAsync(async (req, res) => page(res, await service.listVendorPending(req.params.professionalId, req.query))));
// Sending money out is a super admin decision.
router.post('/vendors/:professionalId', authorize('SUPER_ADMIN'), validate(schema.createPayout), catchAsync(async (req, res) => ok(res, await service.createPayout(req.params.professionalId, req.body, req.user), 201)));

module.exports = router;
module.exports.addVendorRoutes = addVendorRoutes;
