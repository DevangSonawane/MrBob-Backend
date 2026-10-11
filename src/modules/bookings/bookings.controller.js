const catchAsync = require('../../utils/catchAsync');
const service = require('./bookings.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

const create = catchAsync(async (req, res) => ok(res, await service.create(req.user, req.body), 201));

const confirmPayment = catchAsync(async (req, res) => ok(res, await service.confirmPayment(req.params.id, req.user, req.body)));

const list = catchAsync(async (req, res) => {
  const result = await service.list(req.user, req.query);
  res.status(200).json({ success: true, ...result });
});

const getSummary = catchAsync(async (req, res) => ok(res, await service.getSummary()));

const getById = catchAsync(async (req, res) => ok(res, await service.getById(req.params.id, req.user)));

const updateStatus = catchAsync(async (req, res) => ok(res, await service.updateStatus(req.params.id, req.body, req.user)));

const cancel = catchAsync(async (req, res) => ok(res, await service.cancel(req.params.id, req.user, req.body.reason)));

const reschedule = catchAsync(async (req, res) => ok(res, await service.reschedule(req.params.id, req.user, req.body.scheduledAt)));

const collectPayment = catchAsync(async (req, res) => ok(res, await service.collectPayment(req.params.id, req.user, req.body.method)));

const markRefunded = catchAsync(async (req, res) => ok(res, await service.markRefunded(req.params.id, req.user, req.body.reference)));

const remove = catchAsync(async (req, res) => ok(res, await service.remove(req.params.id)));

module.exports = { remove, create, confirmPayment, list, getSummary, getById, updateStatus, cancel, reschedule, collectPayment, markRefunded };
