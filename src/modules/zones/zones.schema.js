const { z } = require('zod');
const fields = require('../../utils/fieldSchemas');
const { paginationQuery } = require('../../utils/pagination');
const { booleanFlag } = require('../../utils/queryFilters');

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

const updateCity = {
  params: byId.params,
  body: z
    .object({ name: z.string().trim().min(2).max(80).optional(), tier: z.enum(['TIER_1', 'TIER_2']).optional() })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

const updateZone = { params: byId.params, body: z.object({ name: z.string().trim().min(2).max(80) }) };

// --- Pincode geofence ---

const checkPincode = { query: z.object({ pincode: fields.pincode }) };

const listPincodes = {
  query: paginationQuery.extend({
    cityId: z.uuid().optional(),
    zoneId: z.uuid().optional(),
    isActive: booleanFlag.optional(),
    search: z.string().trim().regex(/^\w[\w\s-]*$/, 'Search by pincode or area name').max(60).optional(),
  }),
};

// One pincode or many: an array, or a pasted list separated by commas, spaces or new lines.
const pincodeList = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(/[\s,;]+/).filter(Boolean) : value),
  z.array(fields.pincode).min(1, 'Add at least one pincode').max(500, 'Add up to 500 pincodes at a time'),
);

const addPincodes = {
  body: z.object({
    cityId: z.uuid(),
    zoneId: z.uuid().nullish(),
    areaName: fields.optionalText(120),
    pincodes: pincodeList,
  }),
};

const updatePincode = {
  params: byId.params,
  body: z
    .object({
      cityId: z.uuid().optional(),
      zoneId: z.uuid().nullable().optional(),
      areaName: fields.optionalText(120).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

module.exports = { byId, createCity, createZone, updateCity, updateZone, listZones, checkPincode, listPincodes, addPincodes, updatePincode };
