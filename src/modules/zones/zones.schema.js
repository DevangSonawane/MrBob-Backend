const { z } = require('zod');

const createCity = {
  body: z.object({
    name: z.string().min(2),
    tier: z.enum(['TIER_1', 'TIER_2']),
  }),
};

const createZone = {
  body: z.object({
    cityId: z.string().uuid(),
    name: z.string().min(2),
  }),
};

const listZones = {
  query: z.object({ cityId: z.string().uuid().optional() }),
};

const byId = { params: z.object({ id: z.string().uuid() }) };

module.exports = { byId, createCity, createZone, listZones };
