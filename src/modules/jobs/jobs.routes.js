const { z } = require('zod');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { uploadImages } = require('../../middlewares/upload');
const { paginationQuery } = require('../../utils/pagination');
const service = require('./jobs.service');

const jobId = z.object({ id: z.uuid() });
const otp = z.coerce.string().trim().regex(/^\d{4}$/, 'OTP must be 4 digits');
const schema = {
  list: { query: paginationQuery },
  one: { params: jobId },
  otp: { params: jobId, body: z.object({ otp }) },
  image: { params: jobId.extend({ imageId: z.uuid() }) },
};

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// The vendor's job flow. Mounted inside /vendor, which already restricts the role.
const addVendorRoutes = (router) => {
  router.get('/jobs/available', validate(schema.list), catchAsync(async (req, res) => res.status(200).json({ success: true, ...(await service.listAvailable(req.user, req.query)) })));
  router.get('/jobs/available/:id', validate(schema.one), catchAsync(async (req, res) => ok(res, await service.getAvailable(req.user, req.params.id))));
  router.post('/jobs/:id/decline', validate(schema.one), catchAsync(async (req, res) => ok(res, await service.decline(req.user, req.params.id))));
  router.post('/jobs/:id/accept', validate(schema.one), catchAsync(async (req, res) => ok(res, await service.accept(req.user, req.params.id))));
  router.post('/jobs/:id/start', validate(schema.otp), catchAsync(async (req, res) => ok(res, await service.start(req.user, req.params.id, req.body.otp))));
  router.post('/jobs/:id/completion-otp', validate(schema.otp), catchAsync(async (req, res) => ok(res, await service.verifyCompletionOtp(req.user, req.params.id, req.body.otp))));
  router.post(
    '/jobs/:id/completion-images',
    uploadImages('images', service.MAX_IMAGES),
    validate(schema.one),
    catchAsync(async (req, res) => ok(res, await service.addImages(req.user, req.params.id, req.files), 201)),
  );
  router.delete('/jobs/:id/completion-images/:imageId', validate(schema.image), catchAsync(async (req, res) => ok(res, await service.removeImage(req.user, req.params.id, req.params.imageId))));
  router.post('/jobs/:id/complete', validate(schema.one), catchAsync(async (req, res) => ok(res, await service.complete(req.user, req.params.id))));
};

// Served from /bookings: anyone who can see the booking can see its photos.
const getImage = [
  validate(schema.image),
  catchAsync(async (req, res, next) => {
    const image = await service.openImage(req.user, req.params.id, req.params.imageId);
    res.set({ 'Content-Type': image.mimeType, 'Cache-Control': 'private, max-age=3600' });
    image.stream.on('error', next);
    image.stream.pipe(res);
  }),
];

module.exports = { addVendorRoutes, getImage };
