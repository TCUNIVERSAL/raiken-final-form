import { fakeLiveSign, TEST_EMAILS, validPurchaserForm } from '../helpers/setup.js';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import type { Server } from 'http';
import { app } from '../../server/app.js';
import { emailOutbox } from '../../server/emailService.js';
import { liveSignConfig } from '../../server/livesign/config.js';
import { isSupabaseConfigured } from '../../server/supabaseClient.js';
import { isEmailConfigured } from '../../server/emailService.js';

let server: Server;
let base = '';

before(async () => {
  if (!liveSignConfig.baseUrl.startsWith('http://127.0.0.1:') || liveSignConfig.apiKey !== 'test-key' || isSupabaseConfigured() || isEmailConfigured()) {
    throw new Error('App is configured with real services — aborting before any request.');
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
  emailOutbox.length = 0;
  fakeLiveSign.reset();
});

function browser() {
  let cookie = '';
  return {
    async call(method: string, path: string, body?: unknown) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie?.includes('form_visitor_id=')) cookie = setCookie.split(';')[0];
      let json: any = null;
      try { json = await res.json(); } catch { /* not json */ }
      return { status: res.status, body: json };
    }
  };
}

describe('Intake API Postcode & Email Validation Cases', () => {
  test('TC-API-PC-01 submission rejected when party Australian postcode has fewer than 4 digits', async () => {
    const b = browser();
    const form = validPurchaserForm();
    form.parties[0].country = 'Australia';
    form.parties[0].postcode = '508'; // 3 digits
    const res = await b.call('POST', '/api/intake', { formData: form });
    assert.equal(res.status, 400, 'Should reject with HTTP 400');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Australian postcode must be 4 digits/i);
  });

  test('TC-API-PC-02 submission rejected when party Australian postcode is a 6-digit PIN code', async () => {
    const b = browser();
    const form = validPurchaserForm();
    form.parties[0].country = 'Australia';
    form.parties[0].postcode = '560001'; // 6 digits
    const res = await b.call('POST', '/api/intake', { formData: form });
    assert.equal(res.status, 400, 'Should reject with HTTP 400');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Australian postcode must be 4 digits/i);
  });

  test('TC-API-PC-03 submission rejected when property postcode has fewer than 4 digits', async () => {
    const b = browser();
    const form = validPurchaserForm();
    form.property.postcode = '500'; // 3 digits
    const res = await b.call('POST', '/api/intake', { formData: form });
    assert.equal(res.status, 400, 'Should reject with HTTP 400');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Property postcode must be a valid 4-digit Australian postcode/i);
  });

  test('TC-API-EML-01 submission rejected when primary party email is invalid', async () => {
    const b = browser();
    const form = validPurchaserForm();
    form.parties[0].email = 'invalid-email-address';
    const res = await b.call('POST', '/api/intake', { formData: form });
    assert.equal(res.status, 400, 'Should reject with HTTP 400');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /valid email is required/i);
  });

  test('TC-API-SUB-01 valid submission successfully sends LiveSign envelope and captures client email', async () => {
    const b = browser();
    const form = validPurchaserForm();
    const testClientEmail = 'test.buyer@raikan.example.com';
    form.parties[0].email = testClientEmail;
    form.parties[0].postcode = '5083';
    form.property.postcode = '5000';

    const res = await b.call('POST', '/api/intake', { formData: form });
    assert.equal(res.status, 200, 'Should succeed with HTTP 200');
    assert.equal(res.body.success, true);
    assert.equal(res.body.clientEmail, testClientEmail);
    assert.equal(res.body.sentToLiveSign, true);
    assert.ok(res.body.matterReference.startsWith('RK-2026-'));

    // Check LiveSign API call was made
    assert.equal(fakeLiveSign.expressCount(), 1, 'Should call LiveSign Express API once');
    assert.ok(fakeLiveSign.lastPayload, 'LiveSign payload must be recorded');
    assert.equal(fakeLiveSign.lastPayload.envelope.partnerReference, res.body.matterReference);

    // Check customer in LiveSign payload has the user-entered email
    const customer = fakeLiveSign.lastPayload.customers.find((c: any) => c.emailAddress === testClientEmail);
    assert.ok(customer, 'Customer in LiveSign envelope must match the user-entered email');

    // Check notification was delivered to firm email
    const firmNotif = emailOutbox.find(e => e.to === TEST_EMAILS.firm);
    assert.ok(firmNotif, 'Firm notification must be dispatched to FIRM_EMAIL');
  });
});
