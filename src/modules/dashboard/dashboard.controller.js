const catchAsync = require('../../utils/catchAsync');
const service = require('./dashboard.service');

const getStats = catchAsync(async (req, res) => {
  const stats = await service.getStats();
  res.status(200).json({ success: true, data: stats });
});

module.exports = { getStats };
