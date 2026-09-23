const catchAsync = require('../../utils/catchAsync');
const service = require('./bookings.service');

const create = catchAsync(async (req, res) => {
  const booking = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: booking });
});

const list = catchAsync(async (req, res) => {
  const result = await service.listForUser(req.user, req.query);
  res.status(200).json({ success: true, ...result });
});

const getById = catchAsync(async (req, res) => {
  const booking = await service.getByIdForUser(req.params.id, req.user);
  res.status(200).json({ success: true, data: booking });
});

const updateStatus = catchAsync(async (req, res) => {
  const booking = await service.updateStatus(req.params.id, req.body.status);
  res.status(200).json({ success: true, data: booking });
});

module.exports = { create, list, getById, updateStatus };
