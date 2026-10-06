const { z } = require('zod');
const { OTP_LENGTH } = require('./otp.store');

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number, use E.164 format e.g. +919812345678');

const requestOtp = {
  body: z.object({
    phone: phoneSchema,
  }),
};

const verifyOtp = {
  body: z.object({
    phone: phoneSchema,
    otp: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `OTP must be ${OTP_LENGTH} digits`),
    name: z.string().min(2).optional(), // used to complete profile on first login
  }),
};

const refresh = {
  body: z.object({
    refreshToken: z.string().min(1),
  }),
};

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72); // bcrypt silently truncates beyond 72 bytes

const signup = {
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: passwordSchema,
    phone: phoneSchema.optional(),
  }),
};

const login = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
};

module.exports = { requestOtp, verifyOtp, refresh, signup, login };
