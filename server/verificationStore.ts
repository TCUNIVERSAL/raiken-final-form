import { randomUUID } from 'crypto';
import { unwrap, withFallback } from './sessionStore.js';
import type { PersonStatus } from './livesign/verdict.js';

// ─── Identity verification records ──────────────────────────────────────────
// `conveyancing_intakes` holds the LiveSign state of each submitted form and
// `identity_verifications` holds one row per person with their own status.
// Intakes saved to the local fallback (Supabase not configured) are tracked in memory.

/** pending_send: waiting to be sent (no key yet / LiveSign unreachable) · sent · send_error: LiveSign rejected it (needs staff) */
export type LiveSignSendStatus = 'pending_send' | 'sent' | 'send_error';

export interface IntakeRecord {
  id: string;
  matter_reference: string;
  role: string;
  primary_name: string;
  primary_email: string;
  parties: any[];
  property: any;
  finance: any;
  created_at: string;
  verification_status: PersonStatus;
  livesign_status: LiveSignSendStatus;
  livesign_envelope_id: string | null;
  livesign_envelope_status: string | null;
  livesign_error: string | null;
  livesign_attempts: number;
  livesign_sent_email_at: string | null;
  aml_status: string | null;
  aml_risk_rating: string | null;
  verified_at: string | null;
  livesign_last_synced_at: string | null;
}

export interface PersonVerification {
  id: string;
  intake_id: string;
  matter_reference: string;
  party_id: string;
  party_index: number;
  full_name: string;
  email: string;
  mobile: string;
  status: PersonStatus;
  livesign_envelope_id: string | null;
  livesign_customer_id: string | null;
  voi_outcome: string | null;
  voi_review_status: string | null;
  has_flagged_items: boolean;
  verified_at: string | null;
  verified_email_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const localIntakes = new Map<string, IntakeRecord>();
const localPeople = new Map<string, PersonVerification>();

const isLocalId = (id: string) => id.startsWith('local_');
const now = () => new Date().toISOString();

const INTAKE_DEFAULTS = {
  verification_status: 'unverified' as PersonStatus,
  livesign_status: 'pending_send' as LiveSignSendStatus,
  livesign_envelope_id: null,
  livesign_envelope_status: null,
  livesign_error: null,
  livesign_attempts: 0,
  livesign_sent_email_at: null,
  aml_status: null,
  aml_risk_rating: null,
  verified_at: null,
  livesign_last_synced_at: null
};

/** Creates the "unverified" rows for a newly submitted intake and returns the full intake record. */
export async function startVerification(intake: any): Promise<{ intake: IntakeRecord; people: PersonVerification[] }> {
  const record: IntakeRecord = {
    ...INTAKE_DEFAULTS,
    id: intake.id,
    matter_reference: intake.matter_reference,
    role: intake.role,
    primary_name: intake.primary_name,
    primary_email: intake.primary_email,
    parties: intake.parties || [],
    property: intake.property || {},
    finance: intake.finance || {},
    created_at: intake.created_at || now()
  };
  const people: PersonVerification[] = record.parties.map((p: any, i: number) => ({
    id: randomUUID(),
    intake_id: record.id,
    matter_reference: record.matter_reference,
    party_id: String(p.id || `p${i + 1}`),
    party_index: i,
    full_name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    email: String(p.email || '').trim(),
    mobile: String(p.mobile || '').trim(),
    status: 'unverified',
    livesign_envelope_id: null,
    livesign_customer_id: null,
    voi_outcome: null,
    voi_review_status: null,
    has_flagged_items: false,
    verified_at: null,
    verified_email_sent_at: null,
    created_at: now(),
    updated_at: now()
  }));

  const keepLocal = () => {
    localIntakes.set(record.id, record);
    people.forEach(p => localPeople.set(p.id, p));
    return { intake: record, people };
  };
  if (isLocalId(record.id)) return keepLocal();

  return withFallback('startVerification', async client => {
    unwrap(await client.from('conveyancing_intakes').update({ ...INTAKE_DEFAULTS, updated_at: now() }).eq('id', record.id));
    if (people.length) unwrap(await client.from('identity_verifications').insert(people));
    return { intake: record, people };
  }, keepLocal);
}

export async function updateIntake(id: string, patch: Partial<IntakeRecord>): Promise<void> {
  if (isLocalId(id)) {
    const current = localIntakes.get(id);
    if (current) localIntakes.set(id, { ...current, ...patch });
    return;
  }
  await withFallback('updateIntake', async client => {
    unwrap(await client.from('conveyancing_intakes').update({ ...patch, updated_at: now() }).eq('id', id));
  }, () => {
    const current = localIntakes.get(id);
    if (current) localIntakes.set(id, { ...current, ...patch });
  });
}

export async function updatePerson(id: string, patch: Partial<PersonVerification>): Promise<void> {
  const values = { ...patch, updated_at: now() };
  const local = () => {
    const current = localPeople.get(id);
    if (current) localPeople.set(id, { ...current, ...values });
  };
  if (localPeople.has(id)) return local();
  await withFallback('updatePerson', async client => {
    unwrap(await client.from('identity_verifications').update(values).eq('id', id));
  }, local);
}

export async function getPeople(intakeId: string): Promise<PersonVerification[]> {
  const local = () => [...localPeople.values()].filter(p => p.intake_id === intakeId).sort((a, b) => a.party_index - b.party_index);
  if (isLocalId(intakeId)) return local();
  return withFallback('getPeople', async client => unwrap(await client
    .from('identity_verifications')
    .select('*')
    .eq('intake_id', intakeId)
    .order('party_index', { ascending: true })) as PersonVerification[], local);
}

export async function getIntakeByEnvelopeId(envelopeId: string): Promise<IntakeRecord | null> {
  const local = () => [...localIntakes.values()].find(i => i.livesign_envelope_id === envelopeId) || null;
  const fromLocal = local();
  if (fromLocal) return fromLocal;
  return withFallback('getIntakeByEnvelopeId', async client => unwrap(await client
    .from('conveyancing_intakes')
    .select('*')
    .eq('livesign_envelope_id', envelopeId)
    .maybeSingle()) as IntakeRecord | null, local);
}

/**
 * Forms the background job still has work for: not yet sent to LiveSign, or sent and
 * waiting for people to verify. Only the last 30 days are checked.
 */
export async function listIntakesNeedingWork(limit = 50): Promise<IntakeRecord[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const needsWork = (i: IntakeRecord) => i.created_at >= since && (
    i.livesign_status === 'pending_send' ||
    (i.livesign_status === 'sent' && (i.verification_status === 'unverified' || i.verification_status === 'needs_review')));
  const local = [...localIntakes.values()].filter(needsWork);

  const remote = await withFallback<IntakeRecord[]>('listIntakesNeedingWork', async client => {
    const toSend = unwrap(await client.from('conveyancing_intakes').select('*')
      .eq('livesign_status', 'pending_send').gte('created_at', since).order('created_at').limit(limit)) as IntakeRecord[];
    const toSync = unwrap(await client.from('conveyancing_intakes').select('*')
      .eq('livesign_status', 'sent').in('verification_status', ['unverified', 'needs_review'])
      .gte('created_at', since).order('livesign_last_synced_at', { ascending: true, nullsFirst: true }).limit(limit)) as IntakeRecord[];
    return [...toSend, ...toSync];
  }, () => []);

  return [...local, ...remote].slice(0, limit * 2);
}
