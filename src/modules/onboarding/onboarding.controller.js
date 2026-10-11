const catchAsync = require('../../utils/catchAsync');
const service = require('./onboarding.service');

const getStatus = catchAsync(async (req, res) => {
  const status = await service.getStatus(req.user.id);
  res.status(200).json({ success: true, data: status });
});

module.exports = { getStatus };
