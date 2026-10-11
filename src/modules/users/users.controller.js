const catchAsync = require('../../utils/catchAsync');
const sanitizeUser = require('../../utils/sanitizeUser');
const usersService = require('./users.service');
const addresses = require('./addresses.service');
const { isAdmin } = require('../../utils/roles');
const ApiError = require('../../utils/ApiError');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// --- The signed-in user ---

const getMe = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.getMe(req.user.id))));

const updateMe = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.updateMe(req.user.id, req.body))));

const setMyPhoto = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.setPhoto(req.user.id, req.files))));

const removeMyPhoto = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.removePhoto(req.user.id))));

const requestPhoneChange = catchAsync(async (req, res) => ok(res, await usersService.requestPhoneChange(req.user.id, req.body.phone)));

const confirmPhoneChange = catchAsync(async (req, res) =>
  ok(res, sanitizeUser(await usersService.confirmPhoneChange(req.user.id, req.body.phone, req.body.otp))),
);

const deleteMe = catchAsync(async (req, res) => ok(res, await usersService.deleteMe(req.user.id)));

const listMyAddresses = catchAsync(async (req, res) => ok(res, await addresses.list(req.user.id)));

const createMyAddress = catchAsync(async (req, res) => ok(res, await addresses.create(req.user.id, req.body), 201));

const updateMyAddress = catchAsync(async (req, res) => ok(res, await addresses.update(req.user.id, req.params.addressId, req.body)));

const setMyDefaultAddress = catchAsync(async (req, res) => ok(res, await addresses.setDefault(req.user.id, req.params.addressId)));

const removeMyAddress = catchAsync(async (req, res) => ok(res, await addresses.remove(req.user.id, req.params.addressId)));

// --- Administration ---

const list = catchAsync(async (req, res) => {
  const result = await usersService.list(req.query);
  res.status(200).json({ success: true, ...result, items: result.items.map(sanitizeUser) });
});

const getSummary = catchAsync(async (req, res) => ok(res, await usersService.getSummary()));

const getById = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.getDetail(req.params.id))));

// A user's photo is visible to that user and to admins.
const getPhoto = catchAsync(async (req, res, next) => {
  if (req.params.id !== req.user.id && !isAdmin(req.user.role)) throw ApiError.forbidden('You do not have access to this photo');
  const photo = await usersService.openPhoto(req.params.id);
  res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-store' });
  photo.stream.on('error', next);
  photo.stream.pipe(res);
});

const setActive = catchAsync(async (req, res) =>
  ok(res, sanitizeUser(await usersService.setActive(req.params.id, req.body.isActive, req.user))),
);

const getLocation = catchAsync(async (req, res) => ok(res, await usersService.getLocation(req.params.id)));

const setLocation = catchAsync(async (req, res) => ok(res, await usersService.setLocation(req.params.id, req.body)));

const adminUpdate = catchAsync(async (req, res) => ok(res, sanitizeUser(await usersService.adminUpdate(req.params.id, req.body, req.user))));

const adminDelete = catchAsync(async (req, res) => ok(res, await usersService.adminDelete(req.params.id, req.user)));

const create = catchAsync(async (req, res) => {
  const { user, temporaryPassword } = await usersService.create(req.body, req.user);
  ok(res, { user: sanitizeUser(user), temporaryPassword }, 201);
});

module.exports = {
  getMe,
  updateMe,
  setMyPhoto,
  removeMyPhoto,
  requestPhoneChange,
  confirmPhoneChange,
  deleteMe,
  listMyAddresses,
  createMyAddress,
  updateMyAddress,
  setMyDefaultAddress,
  removeMyAddress,
  list,
  getSummary,
  getById,
  getPhoto,
  setActive,
  adminUpdate,
  getLocation,
  setLocation,
  adminDelete,
  create,
};
