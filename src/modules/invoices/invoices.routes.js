const { Router } = require('express');
const { z } = require('zod');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { authenticate, authorize } = require('../../middlewares/auth');
const { paginationQuery } = require('../../utils/pagination');
const { dateOnly } = require('../../utils/queryFilters');
const service = require('./invoices.service');

const ok = (res, data) => res.status(200).json({ success: true, data });
const sendPdf = (res, { buffer, filename }) => {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  res.status(200).send(buffer);
};

const bookingParam = { params: z.object({ id: z.uuid() }) };
const listQuery = {
  query: paginationQuery.extend({
    search: z.string().trim().min(1).max(100).optional(), // INV-000123, BK-000123, or the customer's name / phone / email
    status: z.enum(['PAID', 'UNPAID']).optional(),
    customerId: z.uuid().optional(), // one customer's invoices
    issuedFrom: dateOnly.optional(),
    issuedTo: dateOnly.optional(),
  }),
};

// The customer's invoice for one of their bookings. Mounted inside /customer.
const addCustomerRoutes = (router) => {
  router.get('/bookings/:id/invoice', validate(bookingParam), catchAsync(async (req, res) => ok(res, await service.getForBooking(req.params.id, req.user))));
  router.get('/bookings/:id/invoice/pdf', validate(bookingParam), catchAsync(async (req, res) => sendPdf(res, await service.pdfForBooking(req.params.id, req.user))));
};

// The team's list of every invoice, mounted at /invoices.
const router = Router();
router.use(authenticate, authorize('ADMIN'));
router.get('/', validate(listQuery), catchAsync(async (req, res) => res.status(200).json({ success: true, ...(await service.list(req.query)) })));
router.get('/:id', validate(bookingParam), catchAsync(async (req, res) => ok(res, await service.getById(req.params.id))));
router.get('/:id/pdf', validate(bookingParam), catchAsync(async (req, res) => sendPdf(res, await service.pdfById(req.params.id))));

module.exports = router;
module.exports.addCustomerRoutes = addCustomerRoutes;
