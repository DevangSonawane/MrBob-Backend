const Anthropic = require('@anthropic-ai/sdk').default;
const env = require('../../config/env');

// The Claude client used by the booking assistant. Created on first use, and
// only when ANTHROPIC_API_KEY is set. Tests swap in a stand-in with useForTests.

let client = null;
let override = null;

const isConfigured = () => Boolean(override || env.ANTHROPIC_API_KEY);

const get = () => {
  if (override) return override;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 30 * 1000, maxRetries: 1 });
  return client;
};

const useForTests = (fake) => {
  override = fake;
};

module.exports = { isConfigured, get, useForTests, Anthropic };
