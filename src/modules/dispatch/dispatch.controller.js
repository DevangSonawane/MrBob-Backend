const catchAsync = require('../../utils/catchAsync');
const service = require('./dispatch.service');
const bookings = require('../bookings/bookings.service');

const findCandidates = catchAsync(async (req, res) => {
  const candidates = await service.findCandidates(req.params.id, req.user);
  res.status(200).json({ success: true, data: candidates });
});

const assign = catchAsync(async (req, res) => {
  await service.assign(req.params.id, req.body.professionalId, req.user);
  // Same shape as every other booking response.
  res.status(200).json({ success: true, data: await bookings.getById(req.params.id, req.user) });
});

module.exports = { findCandidates, assign };
