import { fakeLiveSign, TEST_EMAILS, validPurchaserForm } from '../helpers/setup.js';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import type { Server } from 'http';
import { app } from '../../server/app.js';
import { emailOutbox } from '../../server/emailService.js';
import { getIntakeByEnvelopeId, getPeople, listIntakesNeedingWork } from '../../server/verificationStore.js';
import { sendIntakeToLiveSign } from '../../server/livesign/service.js';
import { liveSignConfig } from '../../server/livesign/config.js';
import { isSupabaseConfigured } from '../../server/supabaseClient.js';
import { isEmailConfigured } from '../../server/emailService.js';

let server: Server;
let base = '';

before(async () => {
  // Belt and braces: the app must be wired to the fakes before any request is made
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
  fakeLiveSign.failExpressWith = null;
});

/** A browser: keeps the visitor cookie between requests. */
function browser() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: (body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)) as BodyInit | undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie?.includes('form_visitor_id=')) cookie = setCookie.split(';')[0];
      let json: any = null;
      try { json = await res.json(); } catch { /* not json */ }
      return { status: res.status, body: json, setCookie };
    }
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  let value = await fn();
  while (!ok(value) && Date.now() < end) {
    await sleep(50);
    value = await fn();
  }
  return value;
}
const subjectsTo = (email: string) => emailOutbox.filter(e => e.to === email).map(e => e.subject);
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function submitForm(b: ReturnType<typeof browser>, form = validPurchaserForm()) {
  const { body: s } = await b.call('GET', '/api/session');
  await b.call('PUT', `/api/session/${s.session.id}`, { formData: form, currentStep: 6, partyIndex: 0, formType: form.role });
  const res = await b.call('POST', '/api/intake', { formData: form, telemetry: {}, sessionId: s.session.id });
  return { res, sessionId: s.session.id as string };
}

async function envelopeFor(matterReference: string) {
  return [...fakeLiveSign.envelopes.values()].find(e => e.partnerReference === matterReference)!;
}

async function webhook(envelopeId: string, token = 'test-webhook-secret') {
  return fetch(`${base}/api/livesign/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelopeId })
  });
}

// ─── Saving answers (sessions) ───────────────────────────────────────────────
describe('Saving answers while typing', () => {
  test('TC-API-01 first visit sets an anonymous, httpOnly visitor cookie and creates a draft', async () => {
    const b = browser();
    const r = await b.call('GET', '/api/session');
    assert.equal(r.status, 200);
    assert.match(r.setCookie || '', /form_visitor_id=[0-9a-f-]{36}/);
    assert.match(r.setCookie || '', /HttpOnly/i);
    assert.match(r.setCookie || '', /SameSite=Lax/i);
    assert.equal(r.body.session.status, 'draft');
  });

  test('TC-API-02 answers saved with PUT come back after a refresh (same browser)', async () => {
    const b = browser();
    const { body: first } = await b.call('GET', '/api/session');
    const form = validPurchaserForm();
    const put = await b.call('PUT', `/api/session/${first.session.id}`, { formData: form, currentStep: 3, partyIndex: 1, formType: 'Purchaser' });
    assert.equal(put.status, 200);
    const { body: again } = await b.call('GET', '/api/session');
    assert.equal(again.session.id, first.session.id);
    assert.equal(again.session.currentStep, 3);
    assert.equal(again.session.partyIndex, 1);
    assert.equal(again.session.formData.parties[1].email, TEST_EMAILS.purchaser2);
  });

  test('TC-API-03 another browser cannot write to someone else\'s draft', async () => {
    const owner = browser();
    const { body } = await owner.call('GET', '/api/session');
    const stranger = browser();
    await stranger.call('GET', '/api/session');
    const r = await stranger.call('PUT', `/api/session/${body.session.id}`, { formData: { hacked: true }, currentStep: 1, partyIndex: 0 });
    assert.equal(r.status, 404);
  });

  test('TC-API-04 bad or oversized drafts are refused', async () => {
    const b = browser();
    const { body } = await b.call('GET', '/api/session');
    assert.equal((await b.call('PUT', `/api/session/${body.session.id}`, { currentStep: 1 })).status, 400);
    const huge = { notes: 'x'.repeat(600 * 1024) };
    assert.equal((await b.call('PUT', `/api/session/${body.session.id}`, { formData: huge, currentStep: 1, partyIndex: 0 })).status, 413);
  });

  test('TC-API-05 "Start a new form" creates a fresh draft', async () => {
    const b = browser();
    const { body: first } = await b.call('GET', '/api/session');
    const { body: fresh } = await b.call('POST', '/api/session/new');
    assert.notEqual(fresh.session.id, first.session.id);
    const { body: latest } = await b.call('GET', '/api/session');
    assert.equal(latest.session.id, fresh.session.id);
  });
});

// ─── Photo ID uploads ────────────────────────────────────────────────────────
describe('Photo ID upload', () => {
  const upload = (body: Uint8Array, type: string, name = 'licence.png', kind = 'identity') =>
    fetch(`${base}/api/uploads?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body: body as BodyInit });

  test('TC-UP-01 a real PNG is accepted and its details returned', async () => {
    const r = await upload(PNG, 'image/png');
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.document.fileName, 'licence.png');
    assert.equal(j.document.sizeBytes, PNG.length);
    assert.equal(j.document.kind, 'identity');
  });

  test('TC-UP-02 a disallowed file type is rejected', async () => {
    assert.equal((await upload(Uint8Array.from(Buffer.from('hello')), 'text/plain', 'notes.txt')).status, 415);
  });

  test('TC-UP-03 a file pretending to be a PDF is rejected (content check)', async () => {
    assert.equal((await upload(Uint8Array.from(Buffer.from('not a pdf')), 'application/pdf', 'fake.pdf')).status, 415);
  });

  test('TC-UP-04 files over 5 MB are rejected with a clear message', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(Buffer.from('%PDF'));
    const r = await upload(big, 'application/pdf', 'big.pdf');
    assert.equal(r.status, 413);
    assert.match((await r.json()).message, /5 MB/);
  });

  test('TC-UP-05 an unknown document kind is rejected', async () => {
    assert.equal((await upload(PNG, 'image/png', 'x.png', 'passwords')).status, 400);
  });
});

// ─── Submitting ──────────────────────────────────────────────────────────────
describe('Submitting the form', () => {
  test('TC-SUB-01 missing required answers are refused by the server', async () => {
    const b = browser();
    const noOccupation = validPurchaserForm();
    noOccupation.parties[0] = { ...noOccupation.parties[0], occupation: '' };
    assert.equal((await b.call('POST', '/api/intake', { formData: noOccupation, telemetry: {} })).status, 400);
    const noAuthority = validPurchaserForm({ declaration: { coolingOffAcknowledged: true, authorityToAct: false, signedName: 'x', signedDate: '2026-01-01', signatureDataUrl: 'data:image/png;base64,abc' } });
    const r = await b.call('POST', '/api/intake', { formData: noAuthority, telemetry: {} });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /authorise/i);
  });

  test('TC-SUB-02 a valid form is recorded, sent to LiveSign and reported as unverified', async () => {
    const b = browser();
    const { res } = await submitForm(b);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.match(res.body.matterReference, /^RK-\d{4}-\d{4}$/);
    assert.equal(res.body.sentToLiveSign, true);
    assert.equal(res.body.verificationStatus, 'unverified');
    const people = await getPeople(res.body.intakeId);
    assert.equal(people.length, 2);
    assert.ok(people.every(p => p.status === 'unverified' && p.livesign_customer_id));
  });

  test('TC-SUB-03 each purchaser is emailed "sent to LiveSign" and the firm gets a copy', async () => {
    const b = browser();
    const { res } = await submitForm(b);
    const ref = res.body.matterReference;
    assert.ok(subjectsTo(TEST_EMAILS.purchaser1).some(s => s.includes('sent to LiveSign') && s.includes(ref)), JSON.stringify(emailOutbox));
    assert.ok(subjectsTo(TEST_EMAILS.purchaser2).some(s => s.includes('sent to LiveSign') && s.includes(ref)));
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.startsWith('New purchaser form') && s.includes(ref) && s.includes('sent to LiveSign')));
  });

  test('TC-SUB-04 a submitted form cannot be submitted or changed again', async () => {
    const b = browser();
    const { sessionId } = await submitForm(b);
    const form = validPurchaserForm();
    assert.equal((await b.call('POST', '/api/intake', { formData: form, telemetry: {}, sessionId })).status, 409);
    assert.equal((await b.call('PUT', `/api/session/${sessionId}`, { formData: form, currentStep: 2, partyIndex: 0 })).status, 409);
  });

  test('TC-SUB-05 after submitting, the next visit starts a brand-new draft', async () => {
    const b = browser();
    const { sessionId } = await submitForm(b);
    const { body } = await b.call('GET', '/api/session');
    assert.notEqual(body.session.id, sessionId);
    assert.equal(body.session.status, 'draft');
  });
});

// ─── LiveSign verification ───────────────────────────────────────────────────
describe('LiveSign verification → verified status and emails', () => {
  test('TC-FLOW-01 a webhook with the wrong secret is refused', async () => {
    assert.equal((await webhook('00000000-0000-0000-0000-000000000000', 'wrong')).status, 401);
  });

  test('TC-FLOW-02 one person passes → only that person is verified and emailed; firm notified', async () => {
    const b = browser();
    const { res } = await submitForm(b);
    const env = await envelopeFor(res.body.matterReference);
    emailOutbox.length = 0;

    env.customers[0].voiOutcome = 'Passed';
    env.customers[0].voiCompletedOn = new Date().toISOString();
    assert.equal((await webhook(env.id)).status, 200);
    const people = await waitFor(() => getPeople(res.body.intakeId), p => p[0].status === 'verified');

    assert.equal(people[0].status, 'verified');
    assert.equal(people[1].status, 'unverified');
    assert.ok(subjectsTo(TEST_EMAILS.purchaser1).some(s => s.startsWith('You have been verified')));
    assert.equal(subjectsTo(TEST_EMAILS.purchaser2).length, 0, 'the other person is not emailed');
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.includes('Dhruvil Tester: verified')));

    // TC-FLOW-03 (same form): the same news arriving again must not send a second email
    await webhook(env.id);
    await sleep(300);
    assert.equal(subjectsTo(TEST_EMAILS.purchaser1).filter(s => s.startsWith('You have been verified')).length, 1);
  });

  test('TC-FLOW-04 flagged → needs review (firm told) → approved → everyone verified', async () => {
    const b = browser();
    const { res } = await submitForm(b);
    const env = await envelopeFor(res.body.matterReference);
    env.customers[0].voiOutcome = 'Passed';
    env.customers[1].voiOutcome = 'Passed';
    env.customers[1].hasFlaggedItems = true;
    emailOutbox.length = 0;
    await webhook(env.id);
    let people = await waitFor(() => getPeople(res.body.intakeId), p => p[1].status === 'needs_review');
    assert.equal(people[1].status, 'needs_review');
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.includes('Vatsal Tester: needs review')));

    env.customers[1].voiReviewStatus = 'Approved';
    await webhook(env.id);
    people = await waitFor(() => getPeople(res.body.intakeId), p => p[1].status === 'verified');
    assert.ok(people.every(p => p.status === 'verified'));
    const intake = await getIntakeByEnvelopeId(env.id);
    const settled = await waitFor(async () => (await getIntakeByEnvelopeId(env.id))!, i => i.verification_status === 'verified');
    assert.equal(settled.verification_status, 'verified', JSON.stringify(intake));
    assert.ok(subjectsTo(TEST_EMAILS.purchaser2).some(s => s.startsWith('You have been verified')));
  });

  test('TC-FLOW-05 a failed ID check marks the person failed and alerts the firm', async () => {
    const b = browser();
    const { res } = await submitForm(b);
    const env = await envelopeFor(res.body.matterReference);
    env.customers[0].voiOutcome = 'Failed';
    emailOutbox.length = 0;
    await webhook(env.id);
    const people = await waitFor(() => getPeople(res.body.intakeId), p => p[0].status === 'failed');
    assert.equal(people[0].status, 'failed');
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.includes('identity check failed')));
    assert.equal(subjectsTo(TEST_EMAILS.purchaser1).filter(s => s.startsWith('You have been verified')).length, 0);
  });

  test('TC-FLOW-06 LiveSign down at submit: form still accepted, sent automatically later, only once', async () => {
    fakeLiveSign.failExpressWith = 503;
    const b = browser();
    const { res } = await submitForm(b);
    assert.equal(res.status, 200);
    assert.equal(res.body.sentToLiveSign, false);
    assert.ok(subjectsTo(TEST_EMAILS.purchaser1).some(s => s.startsWith('Form received')));
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.includes('LiveSign pending')));

    fakeLiveSign.failExpressWith = null;
    emailOutbox.length = 0;
    const before = fakeLiveSign.expressCount();
    const pending = (await listIntakesNeedingWork()).find(i => i.matter_reference === res.body.matterReference)!;
    assert.equal(pending.livesign_status, 'pending_send');
    assert.equal(await sendIntakeToLiveSign(pending), 'sent');
    assert.equal(await sendIntakeToLiveSign(pending), 'sent', 'running the retry again is harmless');
    assert.equal(fakeLiveSign.expressCount(), before + 1, 'exactly one envelope created');
    assert.ok(subjectsTo(TEST_EMAILS.purchaser2).some(s => s.includes('sent to LiveSign')));
  });

  test('TC-FLOW-07 LiveSign rejects the data: marked for staff and the firm is alerted', async () => {
    fakeLiveSign.failExpressWith = 400;
    const b = browser();
    const { res } = await submitForm(b);
    assert.equal(res.status, 200, 'the client still gets their confirmation');
    assert.equal(res.body.sentToLiveSign, false);
    assert.ok(subjectsTo(TEST_EMAILS.firm).some(s => s.includes('LiveSign error')));
    const waiting = (await listIntakesNeedingWork()).find(i => i.matter_reference === res.body.matterReference);
    assert.equal(waiting, undefined, 'rejected forms are not retried forever');
  });
});
