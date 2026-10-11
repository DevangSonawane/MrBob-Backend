const catchAsync = require('../../utils/catchAsync');
const service = require('./customerOnboarding.service');

const ok = (res, data) => res.status(200).json({ success: true, data });

const requestOtp = catchAsync(async (req, res) => ok(res, await service.requestOtp(req.body.phone)));

const verifyOtp = catchAsync(async (req, res) => ok(res, await service.verifyOtp(req.body.phone, req.body.otp)));

const getStatus = catchAsync(async (req, res) => ok(res, await service.getStatus(req.user.id)));

const saveProfile = catchAsync(async (req, res) => ok(res, await service.saveProfile(req.user.id, req.body)));

const saveAddress = catchAsync(async (req, res) => ok(res, await service.saveAddress(req.user.id, req.body)));

module.exports = { requestOtp, verifyOtp, getStatus, saveProfile, saveAddress };
