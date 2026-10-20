const catchAsync = require('../../utils/catchAsync');
const service = require('./dashboard.service');

const getStats = catchAsync(async (req, res) => {
  const stats = await service.getStats();
  res.status(200).json({ success: true, data: stats });
});

const getOverview = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.getOverview(req.query) }));
const getAnalytics = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.getAnalytics(req.query) }));

module.exports = { getStats, getOverview, getAnalytics };
