const catchAsync = require('../../utils/catchAsync');
const service = require('./disputes.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

const categories = catchAsync(async (req, res) => ok(res, service.categoriesFor(req.user)));
const create = catchAsync(async (req, res) => ok(res, await service.create(req.user, req.body), 201));
const listMine = catchAsync(async (req, res) => res.status(200).json({ success: true, ...(await service.listMine(req.user, req.query)) }));
const getOne = catchAsync(async (req, res) => ok(res, await service.getOne(req.params.id, req.user)));
const reply = catchAsync(async (req, res) => ok(res, await service.reply(req.params.id, req.user, req.body.message), 201));
const close = catchAsync(async (req, res) => ok(res, await service.close(req.params.id, req.user)));

const listAll = catchAsync(async (req, res) => res.status(200).json({ success: true, ...(await service.listAll(req.user, req.query)) }));
const getSummary = catchAsync(async (req, res) => ok(res, await service.getSummary()));
const update = catchAsync(async (req, res) => ok(res, await service.update(req.params.id, req.body, req.user)));
const resolve = catchAsync(async (req, res) => ok(res, await service.resolve(req.params.id, req.body.resolution, req.user)));

module.exports = { categories, create, listMine, getOne, reply, close, listAll, getSummary, update, resolve };
