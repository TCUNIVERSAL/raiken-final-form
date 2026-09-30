import dotenv from 'dotenv';
dotenv.config();

const env = (name: string, fallback = '') => (process.env[name] ?? fallback).trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const apiKey = env('LIVESIGN_API_KEY');
const publicBaseUrl = env('PUBLIC_BASE_URL').replace(/\/+$/, '');
const webhookSecret = env('LIVESIGN_WEBHOOK_SECRET');
let discoveredPartnerId = '';

export const liveSignConfig = {
  apiKey,
  /** Production by default. For testing without charges use https://sandbox.api.web.live-sign.com with a sandbox key. */
  baseUrl: env('LIVESIGN_BASE_URL', 'https://api.web.live-sign.com').replace(/\/+$/, ''),
  /** AML package on the account. Confirm with GET /api/Products (see README). */
  productPackageType: env('LIVESIGN_PRODUCT_PACKAGE', 'AMLWithVoi'),
  /** "If an ARNECC VOI is required for each customer set 1, else null" (LiveSign spec). */
  voiProductId: /^\d+$/.test(env('LIVESIGN_VOI_PRODUCT_ID', '1')) ? parseInt(env('LIVESIGN_VOI_PRODUCT_ID', '1'), 10) : null,
  timeZone: env('LIVESIGN_TIMEZONE', 'Australia/Adelaide'),
  /** How often pending verifications are checked with LiveSign (seconds). */
  pollSeconds: Math.max(30, parseInt(env('LIVESIGN_POLL_SECONDS', '120'), 10) || 120),
  webhookSecret,

  get enabled(): boolean {
    return Boolean(apiKey) && !apiKey.includes('your_key_here');
  },

  get partnerId(): string {
    const fromEnv = env('LIVESIGN_PARTNER_ID');
    return UUID_RE.test(fromEnv) ? fromEnv : discoveredPartnerId;
  },

  setDiscoveredPartnerId(id: string) {
    if (UUID_RE.test(id)) discoveredPartnerId = id;
  },

  /** Webhook address given to LiveSign — only when the app has a public HTTPS URL; otherwise polling is used. */
  get webhookUrl(): string | undefined {
    if (!/^https:\/\//.test(publicBaseUrl)) return undefined;
    const token = webhookSecret ? `?token=${encodeURIComponent(webhookSecret)}` : '';
    return `${publicBaseUrl}/api/livesign/webhook${token}`;
  }
};
