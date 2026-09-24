const catchAsync = require('../../utils/catchAsync');
const service = require('./reviews.service');

const create = catchAsync(async (req, res) => {
  const review = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: review });
});

const listForProfessional = catchAsync(async (req, res) => {
  const result = await service.listForProfessional(req.params.professionalId, req.query);
  res.status(200).json({ success: true, ...result });
});

const listAll = catchAsync(async (req, res) => {
  const result = await service.listAll(req.query);
  res.status(200).json({ success: true, ...result });
});

module.exports = { create, listForProfessional, listAll };
