const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const validate = require('../../utils/validate');
const catchAsync = require('../../utils/catchAsync');
const { authorize } = require('../../middlewares/auth');
const service = require('./assistant.service');

// POST /bookings/draft — the customer describes the problem, typed or spoken
// (the phone turns speech into text), and gets a booking draft to confirm.
// The team can use it too, for a customer on the phone.

const draftBody = {
  body: z.object({
    message: z.string().trim().min(3, 'Describe the problem').max(2000),
    source: z.enum(['TEXT', 'VOICE']).default('TEXT'),
    // Answers to the questions a previous draft asked, sent back with the same message.
    answers: z
      .array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(500) }))
      .max(4)
      .optional(),
  }),
};

// Each draft is a paid AI call: a fair limit per person, on top of the API-wide one.
const perPerson = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { success: false, message: 'Too many requests to the assistant. Wait a few minutes, or choose the service yourself.' },
});

const addRoutes = (router, authenticate) => {
  router.post(
    '/draft',
    authenticate,
    authorize('CUSTOMER', 'ADMIN'),
    perPerson,
    validate(draftBody),
    catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.draft(req.user, req.body) })),
  );
};

module.exports = { addRoutes };
