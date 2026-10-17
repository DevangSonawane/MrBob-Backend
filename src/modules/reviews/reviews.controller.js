const catchAsync = require('../../utils/catchAsync');
const service = require('./reviews.service');
const bookings = require('../bookings/bookings.service');

const create = catchAsync(async (req, res) => {
  const review = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: review });
});

// Rates a booking from the customer or vendor app, and returns the booking.
const rateBooking = catchAsync(async (req, res) => {
  await service.rate(req.params.id, req.user, req.body);
  res.status(200).json({ success: true, data: await bookings.getById(req.params.id, req.user) });
});

const listForProfessional = catchAsync(async (req, res) => {
  const result = await service.listForProfessional(req.params.professionalId, req.query);
  res.status(200).json({ success: true, ...result });
});

const listAll = catchAsync(async (req, res) => {
  const result = await service.listAll(req.query);
  res.status(200).json({ success: true, ...result });
});

const getSummary = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.getSummary() }));

module.exports = { create, rateBooking, listForProfessional, listAll, getSummary };
