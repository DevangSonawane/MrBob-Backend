const catchAsync = require('../../utils/catchAsync');
const sanitizeUser = require('../../utils/sanitizeUser');
const usersService = require('./users.service');

const list = catchAsync(async (req, res) => {
  const result = await usersService.list(req.query);
  res.status(200).json({ success: true, ...result, items: result.items.map(sanitizeUser) });
});

const getById = catchAsync(async (req, res) => {
  const user = await usersService.getById(req.params.id);
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

const updateMe = catchAsync(async (req, res) => {
  const user = await usersService.update(req.user.id, req.body);
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

const setActive = catchAsync(async (req, res) => {
  const user = await usersService.setActive(req.params.id, req.body.isActive);
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

const create = catchAsync(async (req, res) => {
  const { user, temporaryPassword } = await usersService.create(req.body);
  res.status(201).json({ success: true, data: { user: sanitizeUser(user), temporaryPassword } });
});

module.exports = { list, getById, updateMe, setActive, create };
