const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

// Sends money to vendors through RazorpayX Payouts. With RAZORPAYX_* set it
// makes real transfers; without them, development and tests get a stand-in
// that "pays" at once, and production refuses (only manual payouts work).

const BASE_URL = 'https://api.razorpay.com/v1';
const isConfigured = Boolean(env.RAZORPAYX_KEY_ID && env.RAZORPAYX_KEY_SECRET && env.RAZORPAYX_ACCOUNT_NUMBER);
const isSimulated = !isConfigured && env.NODE_ENV !== 'production';

// The provider's payout states, folded into ours.
const STATUS = { processed: 'PAID', queued: 'PROCESSING', pending: 'PROCESSING', processing: 'PROCESSING', scheduled: 'PROCESSING' };
const toStatus = (providerStatus) => STATUS[providerStatus] ?? 'FAILED';

const call = async (method, path, body, idempotencyKey) => {
  const response = await globalThis.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.RAZORPAYX_KEY_ID}:${env.RAZORPAYX_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey && { 'X-Payout-Idempotency': idempotencyKey }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.description ?? `Payout provider returned ${response.status}`;
    logger.warn({ path, status: response.status, reason }, 'RazorpayX request failed');
    throw new ApiError(502, reason);
  }
  return data;
};

// The vendor as a RazorpayX contact, and the bank account or UPI id to pay.
// Ids already created are passed in and reused.
const ensureDestination = async ({ vendor, method, destination, ids }) => {
  const contactId =
    ids.contactId ?? (await call('POST', '/contacts', { name: vendor.name, contact: vendor.phone ?? undefined, email: vendor.email ?? undefined, type: 'vendor', reference_id: vendor.professionalId })).id;
  if (method === 'UPI') {
    const fundAccountId = ids.upiFundAccountId ?? (await call('POST', '/fund_accounts', { contact_id: contactId, account_type: 'vpa', vpa: { address: destination.upiId } })).id;
    return { contactId, fundAccountId, upiFundAccountId: fundAccountId };
  }
  const fundAccountId =
    ids.bankFundAccountId ??
    (await call('POST', '/fund_accounts', { contact_id: contactId, account_type: 'bank_account', bank_account: { name: destination.accountHolderName, ifsc: destination.ifsc, account_number: destination.accountNumber } })).id;
  return { contactId, fundAccountId, bankFundAccountId: fundAccountId };
};

// Returns the provider's payout id and our status for it, plus any provider
// ids created on the way (to be saved on the vendor).
const send = async ({ vendor, method, destination, ids, amount, referenceId, narration }) => {
  if (isSimulated) {
    logger.info({ referenceId, amount }, 'Payout provider not configured — simulating a successful payout');
    return { providerPayoutId: `sim_payout_${crypto.randomUUID()}`, status: 'PAID', ids: {} };
  }
  if (!isConfigured) throw new ApiError(503, 'Automatic payouts are not set up on this server. Record the transfer manually instead.');

  const created = await ensureDestination({ vendor, method, destination, ids });
  const payout = await call(
    'POST',
    '/payouts',
    {
      account_number: env.RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id: created.fundAccountId,
      amount: Math.round(amount * 100),
      currency: 'INR',
      mode: method === 'UPI' ? 'UPI' : 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: narration.slice(0, 30),
    },
    referenceId,
  );
  return { providerPayoutId: payout.id, status: toStatus(payout.status), failureReason: payout.failure_reason ?? null, ids: created };
};

const fetchStatus = async (providerPayoutId) => {
  if (isSimulated || providerPayoutId.startsWith('sim_')) return { status: 'PAID' };
  const payout = await call('GET', `/payouts/${providerPayoutId}`);
  return { status: toStatus(payout.status), failureReason: payout.failure_reason ?? payout.status_details?.description ?? null };
};

const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.RAZORPAYX_WEBHOOK_SECRET || !signature) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', env.RAZORPAYX_WEBHOOK_SECRET).update(rawBody).digest('hex'));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

module.exports = { isConfigured, isSimulated, toStatus, send, fetchStatus, verifyWebhookSignature };
