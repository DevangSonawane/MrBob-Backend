const catchAsync = require('../../utils/catchAsync');
const service = require('./amc.service');

const create = catchAsync(async (req, res) => {
  const subscription = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: subscription });
});

const list = catchAsync(async (req, res) => {
  const result = await service.list(req.user, req.query);
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

const getSummary = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.getSummary() }));

const update = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.update(req.params.id, req.body) }));

module.exports = { create, list, update, getSummary, getById, cancel };
