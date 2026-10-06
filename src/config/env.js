const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_BASE_PATH: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGIN: z.string().default('*'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  GOOGLE_MAPS_API_KEY: z.string().optional(),

  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),

  // Temporary, while there is no SMS/WhatsApp provider: when set, every OTP is
  // this fixed 6-digit code instead of a random one. Remove it once real
  // delivery is in place — anyone who knows the code can sign in as any number.
  OTP_STATIC_CODE: z
    .string()
    .regex(/^\d{6}$/, 'OTP_STATIC_CODE must be exactly 6 digits')
    .optional()
    .or(z.literal('').transform(() => undefined)),

  // KYC: 32-byte key (base64 or hex) for encrypting Aadhaar/PAN numbers at rest.
  // Optional in dev/test (a fixed insecure key is used); required in production
  // before any document can be saved — see utils/kycCrypto.js.
  KYC_ENCRYPTION_KEY: z.string().optional(),
  // Who verifies Aadhaar/PAN. 'manual' = an admin does it in the dashboard.
  KYC_VERIFICATION_PROVIDER: z.enum(['manual']).default('manual'),
  // Where uploaded documents go when R2 isn't configured (dev/test only).
  UPLOAD_DIR: z.string().default('./uploads'),

  LOG_LEVEL: z.string().default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;
