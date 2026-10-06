const catchAsync = require('../../utils/catchAsync');
const service = require('./professionals.service');

const list = catchAsync(async (req, res) => {
  const result = await service.list(req.query);
  res.status(200).json({ success: true, ...result });
});

const getById = catchAsync(async (req, res) => {
  const professional = await service.getById(req.params.id, req.user);
  res.status(200).json({ success: true, data: professional });
});

const getPhoto = catchAsync(async (req, res, next) => {
  const photo = await service.getPhoto(req.params.id, req.user);
  res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, max-age=300' });
  photo.stream.on('error', next);
  photo.stream.pipe(res);
});

const getMe = catchAsync(async (req, res) => {
  const professional = await service.getByUserId(req.user.id);
  res.status(200).json({ success: true, data: professional });
});

const updateMe = catchAsync(async (req, res) => {
  const professional = await service.update(req.user.id, req.body);
  res.status(200).json({ success: true, data: professional });
});

module.exports = { list, getById, getPhoto, getMe, updateMe };
