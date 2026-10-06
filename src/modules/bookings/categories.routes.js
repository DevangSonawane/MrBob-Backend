const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
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
  validate(schema.createCategory),
  catchAsync(async (req, res) => {
    const category = await service.create(req.body);
    res.status(201).json({ success: true, data: category });
  }),
);

module.exports = router;
