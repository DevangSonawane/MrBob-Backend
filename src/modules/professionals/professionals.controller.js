const catchAsync = require('../../utils/catchAsync');
const service = require('./professionals.service');

const register = catchAsync(async (req, res) => {
  const professional = await service.register(req.user.id, req.body);
  res.status(201).json({ success: true, data: professional });
});

const list = catchAsync(async (req, res) => {
  const result = await service.list(req.query);
  res.status(200).json({ success: true, ...result });
});

const getById = catchAsync(async (req, res) => {
  const professional = await service.getById(req.params.id);
  res.status(200).json({ success: true, data: professional });
});

const getMe = catchAsync(async (req, res) => {
  const professional = await service.getByUserId(req.user.id);
  res.status(200).json({ success: true, data: professional });
});

const updateMe = catchAsync(async (req, res) => {
  const professional = await service.update(req.user.id, req.body);
  res.status(200).json({ success: true, data: professional });
});

const updateKycStatus = catchAsync(async (req, res) => {
  const professional = await service.updateKycStatus(req.params.id, req.body.kycStatus);
  res.status(200).json({ success: true, data: professional });
});

module.exports = { register, list, getById, getMe, updateMe, updateKycStatus };
