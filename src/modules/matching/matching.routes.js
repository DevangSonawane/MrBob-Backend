const { z } = require('zod');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const service = require('./matching.service');

const ok = (res, data) => res.status(200).json({ success: true, data });
const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

const schema = {
  presence: {
    body: z
      .object({ online: z.boolean(), latitude: latitude.optional(), longitude: longitude.optional() })
      .refine((data) => (data.latitude === undefined) === (data.longitude === undefined), { message: 'Send latitude and longitude together', path: ['longitude'] }),
  },
  nearby: { query: z.object({ latitude, longitude, categoryId: z.uuid().optional() }) },
  map: { query: z.object({ resolution: z.coerce.number().int().min(5).max(9).default(7), cityId: z.uuid().optional() }) },
  booking: { params: z.object({ id: z.uuid() }) },
};

// The vendor going online/offline and reporting their position. Inside /vendor.
const addVendorRoutes = (router) => {
  router.get('/presence', catchAsync(async (req, res) => ok(res, await service.getPresence(req.user))));
  router.put('/presence', validate(schema.presence), catchAsync(async (req, res) => ok(res, await service.updatePresence(req.user, req.body))));
};

// The customer seeing how many vendors are around. Inside /customer.
const addCustomerRoutes = (router) => {
  router.get('/nearby-vendors', validate(schema.nearby), catchAsync(async (req, res) => ok(res, await service.nearby(req.query))));
};

// The team's live map and a booking's offers. Inside /dispatch (admins).
const addAdminRoutes = (router, { authenticate, authorize }) => {
  router.get('/map', authenticate, authorize('ADMIN'), validate(schema.map), catchAsync(async (req, res) => ok(res, await service.map(req.query))));
  router.get('/bookings/:id/offers', authenticate, authorize('ADMIN'), validate(schema.booking), catchAsync(async (req, res) => ok(res, await service.offersForBooking(req.params.id))));
};

module.exports = { addVendorRoutes, addCustomerRoutes, addAdminRoutes };
