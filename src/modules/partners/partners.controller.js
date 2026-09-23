const catchAsync = require('../../utils/catchAsync');
const service = require('./partners.service');

const create = catchAsync(async (req, res) => {
  const partner = await service.create(req.body);
  res.status(201).json({ success: true, data: partner });
});

const list = catchAsync(async (req, res) => {
  const result = await service.list(req.query);
  res.status(200).json({ success: true, ...result });
});

module.exports = { create, list };
