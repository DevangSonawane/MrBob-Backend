const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('./ApiError');

// Aadhaar and PAN numbers are encrypted at rest with AES-256-GCM. A separate
// keyed hash of the number is stored alongside so we can detect the same
// document being registered on two accounts without decrypting anything.

const DEV_KEY = crypto.createHash('sha256').update('insecure-dev-only-kyc-key').digest();

let cachedKey;

const loadKey = () => {
  if (cachedKey) return cachedKey;

  if (!env.KYC_ENCRYPTION_KEY) {
    if (env.NODE_ENV === 'production') {
      throw new ApiError(503, 'Document storage is not configured (KYC_ENCRYPTION_KEY is missing)');
    }
    logger.warn('KYC_ENCRYPTION_KEY is not set — using an insecure built-in dev key');
    cachedKey = DEV_KEY;
    return cachedKey;
  }

  const raw = env.KYC_ENCRYPTION_KEY.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ApiError(503, 'KYC_ENCRYPTION_KEY must be 32 bytes (base64 or hex encoded)');
  }
  cachedKey = key;
  return cachedKey;
};

// The hash uses its own key derived from the master key, so a leaked hash
// column can't be brute-forced without it (Aadhaar's keyspace is small).
const hashKey = () => Buffer.from(crypto.hkdfSync('sha256', loadKey(), Buffer.alloc(0), 'kyc-number-hash', 32));

const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
};

const decrypt = (payload) => {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1') throw new Error('Unsupported KYC ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
};

const hashNumber = (type, number) => crypto.createHmac('sha256', hashKey()).update(`${type}:${number}`).digest('hex');

const maskNumber = (type, last4) => (type === 'AADHAAR' ? `XXXX XXXX ${last4}` : `XXXXXX${last4}`); // PAN, bank account

module.exports = { encrypt, decrypt, hashNumber, maskNumber };
