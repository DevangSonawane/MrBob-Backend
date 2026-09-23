const catchAsync = require('../../utils/catchAsync');
const service = require('./dispatch.service');

const findCandidates = catchAsync(async (req, res) => {
  const candidates = await service.findCandidates(req.params.id);
  res.status(200).json({ success: true, data: candidates });
});

const assign = catchAsync(async (req, res) => {
  const booking = await service.assign(req.params.id, req.body.professionalId);
  res.status(200).json({ success: true, data: booking });
});

module.exports = { findCandidates, assign };
