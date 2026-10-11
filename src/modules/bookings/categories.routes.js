const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { uploadFiles } = require('../../middlewares/upload');
const service = require('./categories.service');
const catchAsync = require('../../utils/catchAsync');
const schema = require('./categories.schema');

const router = Router();

router.get(
  '/',
  catchAsync(async (req, res) => {
    const categories = await service.list();
    res.status(200).json({ success: true, data: categories });
  }),
);

router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  // JSON, or multipart/form-data when an image is sent along.
  uploadFiles(['image'], { imagesOnly: true }),
  validate(schema.createCategory),
  catchAsync(async (req, res) => {
    const category = await service.create(req.body, req.files);
    res.status(201).json({ success: true, data: category });
  }),
);

// Category pictures are public: the app shows them before anyone signs in.
router.get(
  '/:id/image',
  validate(schema.categoryOnly),
  catchAsync(async (req, res, next) => {
    const image = await service.openImage(req.params.id);
    res.set({ 'Content-Type': image.mimeType, 'Cache-Control': 'public, max-age=86400' });
    image.stream.on('error', next);
    image.stream.pipe(res);
  }),
);

router.put(
  '/:id/image',
  authenticate,
  authorize('ADMIN'),
  uploadFiles(['image'], { imagesOnly: true }),
  validate(schema.categoryOnly),
  catchAsync(async (req, res) => {
    res.status(200).json({ success: true, data: await service.setImage(req.params.id, req.files) });
  }),
);

router.delete(
  '/:id/image',
  authenticate,
  authorize('ADMIN'),
  validate(schema.categoryOnly),
  catchAsync(async (req, res) => {
    res.status(200).json({ success: true, data: await service.removeImage(req.params.id) });
  }),
);

module.exports = router;
