const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const service = require('./payments.service');
const razorpay = require('./razorpay.client');

const createOrderForBooking = catchAsync(async (req, res) => {
  const result = await service.createOrderForBooking(req.params.bookingId);
  res.status(201).json({ success: true, data: result });
});

const getById = catchAsync(async (req, res) => {
  const payment = await service.getById(req.params.id);
  res.status(200).json({ success: true, data: payment });
});

// Expects express.raw() on this route so req.body is the raw buffer needed
// for HMAC signature verification.
const webhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const isValid = razorpay.verifyWebhookSignature(req.body, signature);

  if (!isValid) {
    throw ApiError.unauthorized('Invalid webhook signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  const event = payload.event;
  const entity = payload.payload?.payment?.entity;

  logger.info({ event, orderId: entity?.order_id }, 'Razorpay webhook received');

  if (entity?.order_id) {
    if (event === 'payment.captured') {
      await service.markStatusByGatewayRef(entity.order_id, 'SUCCESS');
    } else if (event === 'payment.failed') {
      await service.markStatusByGatewayRef(entity.order_id, 'FAILED');
    }
  }

  res.status(200).json({ success: true });
});

module.exports = { createOrderForBooking, getById, webhook };
