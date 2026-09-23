const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const registerProfessional = {
  body: z.object({
    categories: z.array(z.string()).min(1),
    homeZoneId: z.string().uuid().optional(),
  }),
};

const listProfessionals = {
  query: paginationQuery.extend({
    kycStatus: z.enum(['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED']).optional(),
    category: z.string().optional(),
    zoneId: z.string().uuid().optional(),
  }),
};

const getProfessional = {
  params: z.object({ id: z.string().uuid() }),
};

const updateProfessional = {
  body: z
    .object({
      categories: z.array(z.string()).min(1).optional(),
      homeZoneId: z.string().uuid().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

const updateKycStatus = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ kycStatus: z.enum(['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED']) }),
};

module.exports = { registerProfessional, listProfessionals, getProfessional, updateProfessional, updateKycStatus };
