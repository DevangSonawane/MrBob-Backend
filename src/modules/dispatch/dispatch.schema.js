const { z } = require('zod');

const bookingParam = {
  params: z.object({ id: z.string().uuid() }),
};

const assign = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ professionalId: z.string().uuid() }),
};

module.exports = { bookingParam, assign };
