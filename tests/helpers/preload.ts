/**
 * Test environment PRELOAD — loaded by `node --import` (see package.json) so it finishes
 * BEFORE any test or app module is evaluated. Never import app code from here.
 *
 * - Starts a fake LiveSign API on a random local port (nothing is sent to the real LiveSign,
 *   so no checks are charged).
 * - Blanks Supabase and SMTP settings so the app uses its in-memory store and only records
 *   emails in `emailOutbox` (no test data reaches the real database, no real emails are sent).
 */
import http from 'http';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';

import { TEST_EMAILS } from './constants.js';

export interface FakeEnvelope {
  id: string;
  status: string;
  partnerReference: string;
  partnerId?: string;
  aml: { status: string; riskRating: string | null };
  customers: any[];
}

export const fakeLiveSign = {
  envelopes: new Map<string, FakeEnvelope>(),
  calls: [] as string[],
  lastPayload: null as any,
  /** Set to an HTTP status to make the next express-envelope calls fail. */
  failExpressWith: null as number | null,
  expressCount() {
    return this.calls.filter(c => c === 'POST /api/Envelopes/express').length;
  },
  reset() {
    this.envelopes.clear();
    this.calls.length = 0;
    this.lastPayload = null;
    this.failExpressWith = null;
  }
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const url = req.url || '';
    fakeLiveSign.calls.push(`${req.method} ${url.split('?')[0]}`);
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers['x-api-key'] !== 'test-key') return send(401, 'Invalid API key');
    if (url.startsWith('/api/Utilities/country-codes')) return send(200, [{ id: 13, phoneCode: '+61' }, { id: 99, phoneCode: '+91' }]);
    if (req.method === 'GET' && url.startsWith('/api/Envelopes?')) {
      return send(200, { results: [...fakeLiveSign.envelopes.values()].map(e => ({ id: e.id, partnerReference: e.partnerReference, partnerId: e.partnerId })) });
    }
    if (req.method === 'POST' && url === '/api/Envelopes/express') {
      if (fakeLiveSign.failExpressWith) {
        return send(fakeLiveSign.failExpressWith, fakeLiveSign.failExpressWith === 400
          ? { errors: { 'Customers[0].MobileNumber': ['Invalid mobile number'] } }
          : 'Service unavailable');
      }
      const payload = JSON.parse(body);
      fakeLiveSign.lastPayload = payload;
      // Like the real LiveSign: an unknown / all-zero partner id is refused before anything is created
      if (!payload?.envelope?.partnerId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(payload.envelope.partnerId)) {
        return send(400, ['Invalid PartnerId provided']);
      }
      const envelope: FakeEnvelope = {
        id: randomUUID(),
        status: 'Draft',
        partnerReference: payload.envelope.partnerReference,
        partnerId: payload.envelope.partnerId,
        aml: { status: 'AwaitingVoiAndPep', riskRating: null },
        customers: payload.customers.map((c: any) => ({
          id: randomUUID(), index: c.index, firstName: c.firstName, lastName: c.lastName, emailAddress: c.emailAddress,
          voiOutcome: 'NotCalculated', voiReviewStatus: 'NotStarted', hasFlaggedItems: false
        }))
      };
      fakeLiveSign.envelopes.set(envelope.id, envelope);
      return send(200, envelope);
    }
    const start = url.match(/^\/api\/Envelopes\/([\w-]+)\/start$/);
    if (req.method === 'POST' && start && fakeLiveSign.envelopes.has(start[1])) {
      fakeLiveSign.envelopes.get(start[1])!.status = 'SentToClient';
      return send(200, {});
    }
    const get = url.match(/^\/api\/Envelopes\/([\w-]+)$/);
    if (req.method === 'GET' && get && fakeLiveSign.envelopes.has(get[1])) return send(200, fakeLiveSign.envelopes.get(get[1]));
    send(404, 'Not found');
  });
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
server.unref();
const port = (server.address() as AddressInfo).port;

Object.assign(process.env, {
  NODE_ENV: 'test',
  SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_ANON_KEY: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  FIRM_EMAIL: TEST_EMAILS.firm,
  LIVESIGN_API_KEY: 'test-key',
  LIVESIGN_BASE_URL: `http://127.0.0.1:${port}`,
  LIVESIGN_PARTNER_ID: '11111111-2222-3333-4444-555555555555',
  PUBLIC_BASE_URL: '',
  LIVESIGN_WEBHOOK_SECRET: 'test-webhook-secret'
});

// Hand the fake LiveSign to the tests without them importing this file (see setup.ts)
(globalThis as any).__raikanTestEnv = { fakeLiveSign };
