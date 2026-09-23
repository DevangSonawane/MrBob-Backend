const catchAsync = require('../../utils/catchAsync');
const service = require('./amc.service');

const create = catchAsync(async (req, res) => {
  const subscription = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: subscription });
});

const listMine = catchAsync(async (req, res) => {
  const result = await service.listForCustomer(req.user.id, req.query);
  res.status(200).json({ success: true, ...result });
});

const getById = catchAsync(async (req, res) => {
  const subscription = await service.getByIdForUser(req.params.id, req.user);
  res.status(200).json({ success: true, data: subscription });
});

const cancel = catchAsync(async (req, res) => {
  const subscription = await service.cancel(req.params.id, req.user);
  res.status(200).json({ success: true, data: subscription });
});

module.exports = { create, listMine, getById, cancel };
