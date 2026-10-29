const jwt = require('jsonwebtoken');
const env = require('../../config/env');

// Firebase Cloud Messaging over its HTTP v1 API. Signs in as the Firebase
// service account (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
// FIREBASE_PRIVATE_KEY, from the key file in Firebase console → Project
// settings → Service accounts) and sends one message per device token.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
// Errors that mean the token itself is dead (app uninstalled, token rotated,
// or from another Firebase project): the device should be forgotten.
const DEAD_TOKEN_CODES = ['UNREGISTERED', 'SENDER_ID_MISMATCH'];

// Read at call time, so the keys can be set (or tests can set them) without a restart.
const isConfigured = () => Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

// Hosts store the key on one line with literal "\n"s.
const privateKey = () => env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

let cached = null; // { accessToken, expiresAt, clientEmail }
let signingIn = null; // the sign-in in progress, shared by every send that needs it

const signIn = async () => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: env.FIREBASE_CLIENT_EMAIL, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, privateKey(), { algorithm: 'RS256' });
  const res = await globalThis.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Firebase sign-in failed (${res.status}): ${body.error_description ?? body.error ?? 'no access token'}`);
  cached = { accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000, clientEmail: env.FIREBASE_CLIENT_EMAIL };
  return cached.accessToken;
};

// An OAuth access token for the service account, reused until a minute before
// it expires. Sends to several devices at once share one sign-in.
const accessToken = () => {
  if (cached && cached.clientEmail === env.FIREBASE_CLIENT_EMAIL && cached.expiresAt > Date.now() + 60 * 1000) return Promise.resolve(cached.accessToken);
  signingIn ??= signIn().finally(() => {
    signingIn = null;
  });
  return signingIn;
};

// FCM data values must all be strings.
const stringify = (data = {}) =>
  Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));

// Sends one notification to one device. Resolves to { ok: true } or
// { ok: false, deadToken, error }; never throws for a delivery failure.
const send = async (token, { title, body, data }) => {
  const message = {
    token,
    notification: { title, body },
    data: stringify(data),
    // Shown straight away, with sound, even when the phone is idle (job offers expire in a minute).
    android: { priority: 'HIGH', notification: { sound: 'default' } },
    apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
  };
  const res = await globalThis.fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (res.ok) return { ok: true };
  const error = (await res.json().catch(() => ({}))).error ?? {};
  const code = (error.details ?? []).find((detail) => detail.errorCode)?.errorCode ?? error.status;
  // A 401 means our access token went bad: drop it so the next send signs in again.
  if (res.status === 401) cached = null;
  return { ok: false, deadToken: res.status === 404 || DEAD_TOKEN_CODES.includes(code), error: `${res.status} ${code ?? ''} ${error.message ?? ''}`.trim() };
};

const resetForTests = () => {
  cached = null;
  signingIn = null;
};

module.exports = { isConfigured, send, resetForTests };
