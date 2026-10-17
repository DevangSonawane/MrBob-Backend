const { z } = require('zod');

// YYYY-MM-DD, a real date in the past.
const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)) && value < new Date().toISOString().slice(0, 10) && value >= '1900-01-01', 'Date of birth must be a real date in the past');

const text = (max) => z.string().trim().max(max).nullable().optional();
const nonEmpty = (schema) => schema.refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

// Everything is optional: send only what changes; null (or '') clears a field.
const vendorProfileFields = {
      name: z.string().trim().min(1).max(100).optional(),
      email: z.email().optional(),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
      dateOfBirth: dateOfBirth.nullable().optional(),
      alternatePhone: text(20),
      addressLine1: text(200),
      addressLine2: text(200),
      landmark: text(200),
      pincode: text(10),
      state: text(60),
      cityId: z.uuid().nullable().optional(),
      homeZoneId: z.uuid().nullable().optional(),
      emergencyContactName: text(100),
      emergencyContactPhone: text(20),
      experienceYears: z.coerce.number().int().min(0).max(60).nullable().optional(),
      categories: z.array(z.uuid()).max(20).optional(),
};

const updateVendorProfile = { body: nonEmpty(z.object(vendorProfileFields)) };

module.exports = { updateVendorProfile, vendorProfileFields, nonEmpty };
