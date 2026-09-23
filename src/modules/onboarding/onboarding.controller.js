const catchAsync = require('../../utils/catchAsync');
const sanitizeUser = require('../../utils/sanitizeUser');
const service = require('./onboarding.service');

const getStatus = catchAsync(async (req, res) => {
  const status = await service.getStatus(req.user.id);
  res.status(200).json({ success: true, data: status });
});

const completeCustomer = catchAsync(async (req, res) => {
  const user = await service.completeCustomerOnboarding(req.user.id, req.body);
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

const completeProfessional = catchAsync(async (req, res) => {
  const { user, professional } = await service.completeProfessionalOnboarding(req.user.id, req.body);
  res.status(200).json({ success: true, data: { user: sanitizeUser(user), professional } });
});

module.exports = { getStatus, completeCustomer, completeProfessional };
