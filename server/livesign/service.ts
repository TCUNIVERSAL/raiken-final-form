import { liveSignClient, LiveSignError } from './client.js';
import { liveSignConfig } from './config.js';
import { buildEnvelopePayload, CountryPhoneCode, formatPropertyAddress, validateEnvelopePayload } from './payload.js';
import { envelopeCustomers, findCustomer, overallStatus, personStatusFromCustomer } from './verdict.js';
import {
  getIntakeByEnvelopeId, getPeople, IntakeRecord, listIntakesNeedingWork, PersonVerification, updateIntake, updatePerson
} from '../verificationStore.js';
import {
  FirmFormSummary, notifyFirmPersonStatus, notifyFirmSendError, sendSentToLiveSignEmail, sendVerifiedEmail
} from '../emailService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEND_ATTEMPTS = 20;

/** One LiveSign operation per form at a time (webhook, poller and submission can overlap). */
const busy = new Set<string>();
async function exclusive<T>(intakeId: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (busy.has(intakeId)) return undefined;
  busy.add(intakeId);
  try {
    return await fn();
  } finally {
    busy.delete(intakeId);
  }
}

// ─── Account look-ups (cached) ───────────────────────────────────────────────
let countryCodes: CountryPhoneCode[] | null = null;
async function getCountryCodes(): Promise<CountryPhoneCode[]> {
  if (countryCodes) return countryCodes;
  try {
    const list = await liveSignClient.get<CountryPhoneCode[]>('/api/Utilities/country-codes');
    countryCodes = Array.isArray(list) ? list : [];
  } catch {
    return []; // Australian numbers still work without the list
  }
  return countryCodes;
}

/** LiveSign requires the partner id on each envelope; read it from an existing envelope if not configured. */
async function ensurePartnerId(): Promise<string> {
  if (liveSignConfig.partnerId) return liveSignConfig.partnerId;
  try {
    const page = await liveSignClient.get<any>('/api/Envelopes?take=10&orderBy=CreatedOn&orderDesc=true');
    const found = (page?.results || []).map((r: any) => r?.partnerId).find((id: any) => UUID_RE.test(id || '') && !/^0{8}-/.test(id));
    if (found) liveSignConfig.setDiscoveredPartnerId(found);
  } catch {
    // Envelope creation will report a clear error if the partner id is really needed
  }
  return liveSignConfig.partnerId;
}

/** Finds an envelope already created for this matter (protects against duplicates after a timeout). */
async function findExistingEnvelope(matterReference: string): Promise<any | null> {
  try {
    const page = await liveSignClient.get<any>(`/api/Envelopes?take=10&orderBy=CreatedOn&orderDesc=true&query=${encodeURIComponent(matterReference)}`);
    const match = (page?.results || []).find((e: any) => e?.partnerReference === matterReference);
    return match?.id ? await liveSignClient.get(`/api/Envelopes/${match.id}`) : null;
  } catch {
    return null;
  }
}

function emailParams(intake: IntakeRecord, person: { full_name: string; email: string }) {
  return {
    toEmail: person.email,
    personName: person.full_name || 'there',
    matterReference: intake.matter_reference,
    role: intake.role,
    propertyAddress: formatPropertyAddress(intake.property)
  };
}

export function firmSummary(intake: IntakeRecord): FirmFormSummary {
  return {
    matterReference: intake.matter_reference,
    role: intake.role,
    propertyAddress: formatPropertyAddress(intake.property),
    people: (intake.parties || []).map((p: any) => ({
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      email: String(p.email || ''),
      mobile: String(p.mobile || '')
    }))
  };
}

/** Email 1 to every person on the form (once per form). */
async function emailEveryoneSentToLiveSign(intake: IntakeRecord, people: PersonVerification[]) {
  if (intake.livesign_sent_email_at) return;
  const seen = new Set<string>();
  for (const person of people) {
    const email = person.email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    await sendSentToLiveSignEmail(emailParams(intake, person));
  }
  const at = new Date().toISOString();
  intake.livesign_sent_email_at = at;
  await updateIntake(intake.id, { livesign_sent_email_at: at });
}

// ─── Send a form to LiveSign ─────────────────────────────────────────────────
export type SendOutcome = 'sent' | 'pending' | 'error';

/**
 * Creates the LiveSign envelope (identity check + PEP + AML) for a submitted form.
 * Safe to call repeatedly: an envelope already created for this matter is reused.
 */
export async function sendIntakeToLiveSign(intake: IntakeRecord, opts: { notifyFirmOnError?: boolean } = {}): Promise<SendOutcome> {
  const result = await exclusive(intake.id, async (): Promise<SendOutcome> => {
    if (intake.livesign_status === 'sent') return 'sent';
    if (!liveSignConfig.enabled) {
      await updateIntake(intake.id, { livesign_status: 'pending_send', livesign_error: 'LIVESIGN_API_KEY is not set yet.' });
      return 'pending';
    }

    const attempts = (intake.livesign_attempts || 0) + 1;
    try {
      let envelope = attempts > 1 ? await findExistingEnvelope(intake.matter_reference) : null;

      if (!envelope) {
        const payload = buildEnvelopePayload(
          { matterReference: intake.matter_reference, role: intake.role, parties: intake.parties, property: intake.property, finance: intake.finance },
          {
            partnerId: await ensurePartnerId(),
            productPackageType: liveSignConfig.productPackageType,
            voiProductId: liveSignConfig.voiProductId,
            timeZone: liveSignConfig.timeZone,
            webhookUrl: liveSignConfig.webhookUrl,
            countryCodes: await getCountryCodes()
          }
        );
        const problems = validateEnvelopePayload(payload);
        if (problems.length) throw new LiveSignError(`Form data not accepted for LiveSign: ${problems.join(' ')}`, 422, false);
        envelope = await liveSignClient.post('/api/Envelopes/express', payload);
      }

      if (!envelope?.id) throw new LiveSignError('LiveSign did not return an envelope id.', 502, true);

      // Express envelopes may be created as a draft; starting one sends the customer emails
      if (envelope.status === 'Draft') {
        await liveSignClient.post(`/api/Envelopes/${envelope.id}/start`);
        envelope = { ...envelope, status: 'SentToClient' };
      }

      const people = await getPeople(intake.id);
      const customers = envelopeCustomers(envelope);
      for (const person of people) {
        const customer = findCustomer(customers, person);
        await updatePerson(person.id, { livesign_envelope_id: envelope.id, livesign_customer_id: customer?.id || null });
      }

      Object.assign(intake, { livesign_status: 'sent', livesign_envelope_id: envelope.id });
      await updateIntake(intake.id, {
        livesign_status: 'sent',
        livesign_envelope_id: envelope.id,
        livesign_envelope_status: envelope.status || null,
        livesign_error: null,
        livesign_attempts: attempts,
        aml_status: envelope.aml?.status || null,
        aml_risk_rating: envelope.aml?.riskRating || null
      });
      console.log(`🛡️  [LIVESIGN] ${intake.matter_reference} sent — envelope ${envelope.id}`);
      await emailEveryoneSentToLiveSign(intake, people);
      return 'sent';
    } catch (err: any) {
      const e = err instanceof LiveSignError ? err : new LiveSignError(err?.message || 'Unknown error', 500, true);
      // Rejected data will not fix itself by retrying — leave it for staff instead
      const giveUp = !e.retryable && e.status >= 400 && e.status < 500 && e.status !== 429;
      const status = giveUp || attempts >= MAX_SEND_ATTEMPTS ? 'send_error' : 'pending_send';
      await updateIntake(intake.id, { livesign_status: status, livesign_error: e.message.slice(0, 1000), livesign_attempts: attempts });
      console.warn(`⚠️  [LIVESIGN] ${intake.matter_reference} not sent (${status}): ${e.message}`);
      // At submission the firm's "new form" email already reports the error
      if (status === 'send_error' && opts.notifyFirmOnError !== false) await notifyFirmSendError(firmSummary(intake), e.message);
      return status === 'send_error' ? 'error' : 'pending';
    }
  });
  return result ?? 'pending';
}

// ─── Read results back from LiveSign ─────────────────────────────────────────
/** Re-reads the envelope from LiveSign and updates each person (and the form) — never trusts webhook bodies. */
export async function syncIntakeFromLiveSign(intake: IntakeRecord): Promise<void> {
  if (!liveSignConfig.enabled || !intake.livesign_envelope_id || !UUID_RE.test(intake.livesign_envelope_id)) return;
  await exclusive(intake.id, async () => {
    const envelope = await liveSignClient.get<any>(`/api/Envelopes/${intake.livesign_envelope_id}`);
    const customers = envelopeCustomers(envelope);
    const people = await getPeople(intake.id);
    const at = new Date().toISOString();
    const changes: Array<{ person: PersonVerification; status: 'verified' | 'failed' | 'needs_review' }> = [];

    for (const person of people) {
      const customer = findCustomer(customers, person);
      if (!customer) continue;
      const status = personStatusFromCustomer(customer);
      const changed = status !== person.status || customer.id !== person.livesign_customer_id;
      if (changed) {
        await updatePerson(person.id, {
          status,
          livesign_customer_id: customer.id,
          voi_outcome: customer.voiOutcome || null,
          voi_review_status: customer.voiReviewStatus || null,
          has_flagged_items: Boolean(customer.hasFlaggedItems),
          verified_at: status === 'verified' ? (person.verified_at || customer.voiCompletedOn || at) : person.verified_at
        });
        if (status !== person.status) {
          console.log(`🛡️  [LIVESIGN] ${intake.matter_reference} — ${person.full_name}: ${person.status} → ${status}`);
          if (status !== 'unverified') changes.push({ person, status });
        }
        person.status = status;
      }
      // Email 2 — exactly once per person
      if (status === 'verified' && !person.verified_email_sent_at && person.email) {
        await sendVerifiedEmail(emailParams(intake, person));
        await updatePerson(person.id, { verified_email_sent_at: new Date().toISOString() });
      }
    }

    const overall = overallStatus(people.map(p => p.status));
    for (const change of changes) {
      await notifyFirmPersonStatus(firmSummary(intake), { name: change.person.full_name, email: change.person.email }, change.status, overall === 'verified');
    }
    await updateIntake(intake.id, {
      verification_status: overall,
      verified_at: overall === 'verified' ? (intake.verified_at || at) : null,
      livesign_envelope_status: envelope?.status || null,
      aml_status: envelope?.aml?.status || null,
      aml_risk_rating: envelope?.aml?.riskRating || null,
      livesign_last_synced_at: at
    });
  });
}

/** Webhook: LiveSign says "envelope X changed" — find the form and re-read it. */
export async function handleLiveSignWebhook(body: any, query: any): Promise<{ matched: boolean }> {
  const candidates = [query?.envelopeId, body?.envelopeId, body?.EnvelopeId, body?.envelope?.id, body?.Envelope?.Id, body?.data?.envelopeId, body?.id, body?.Id];
  const envelopeId = candidates.find(c => typeof c === 'string' && UUID_RE.test(c));
  if (!envelopeId) return { matched: false };
  const intake = await getIntakeByEnvelopeId(envelopeId);
  if (!intake) return { matched: false };
  await syncIntakeFromLiveSign(intake);
  return { matched: true };
}

// ─── Background job ──────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Sends forms still waiting for LiveSign and checks pending verifications every LIVESIGN_POLL_SECONDS. */
export function startLiveSignWorker() {
  if (timer) return;
  const tick = async () => {
    if (running || !liveSignConfig.enabled) return;
    running = true;
    try {
      for (const intake of await listIntakesNeedingWork()) {
        try {
          if (intake.livesign_status === 'pending_send') await sendIntakeToLiveSign(intake);
          else await syncIntakeFromLiveSign(intake);
        } catch (err: any) {
          console.warn(`⚠️  [LIVESIGN] Background check failed for ${intake.matter_reference}: ${err.message}`);
        }
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, liveSignConfig.pollSeconds * 1000);
  timer.unref?.();
  setTimeout(tick, 10_000).unref?.();
}
