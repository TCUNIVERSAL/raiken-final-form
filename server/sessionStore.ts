import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getSupabase } from './supabaseClient.js';

// ─── Visitors & incremental form sessions ─────────────────────────────────────
// Every change a client makes is saved to `form_sessions.form_data`. When Supabase
// is not configured (or a call fails) the same behaviour runs in memory so the
// app keeps working locally; that memory is cleared when the server restarts.

export type SessionStatus = 'draft' | 'submitted' | 'abandoned';

export interface FormSessionRecord {
  id: string;
  visitor_id: string;
  form_type: string;
  current_step: number;
  party_index: number;
  status: SessionStatus;
  form_data: any;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_activity_at: string;
}

interface LocalVisitor {
  visitor_id: string;
  first_seen_at: string;
  last_seen_at: string;
  form_count: number;
}

const localVisitors = new Map<string, LocalVisitor>();
const localSessions = new Map<string, FormSessionRecord>();

/** Runs a Supabase call, or the local equivalent when Supabase is unavailable or errors. */
export async function withFallback<T>(label: string, remote: (client: SupabaseClient) => Promise<T>, local: () => T): Promise<T> {
  const client = getSupabase();
  if (client) {
    try {
      return await remote(client);
    } catch (err: any) {
      console.warn(`⚠️ [SUPABASE] ${label} failed, using local fallback:`, err?.message || err);
    }
  }
  return local();
}

export function unwrap<T>(result: { data: T; error: any }): T {
  if (result.error) throw result.error;
  return result.data;
}

const lastVisitorTouch = new Map<string, number>();

/** Records the visitor (first visit) or refreshes `last_seen_at` — at most once a minute per visitor unless forced. */
export async function touchVisitor(visitorId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastVisitorTouch.get(visitorId) || 0) < 60_000) return;
  lastVisitorTouch.set(visitorId, now);
  const iso = new Date(now).toISOString();
  await withFallback('touchVisitor', async client => {
    unwrap(await client
      .from('form_visitors')
      .upsert({ visitor_id: visitorId, last_seen_at: iso, updated_at: iso }, { onConflict: 'visitor_id' }));
  }, () => {
    const existing = localVisitors.get(visitorId);
    localVisitors.set(visitorId, existing
      ? { ...existing, last_seen_at: iso }
      : { visitor_id: visitorId, first_seen_at: iso, last_seen_at: iso, form_count: 0 });
  });
}

export async function getLatestDraft(visitorId: string): Promise<FormSessionRecord | null> {
  return withFallback('getLatestDraft', async client => unwrap(await client
    .from('form_sessions')
    .select('*')
    .eq('visitor_id', visitorId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as FormSessionRecord | null,
  () => [...localSessions.values()]
    .filter(s => s.visitor_id === visitorId && s.status === 'draft')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null);
}

export async function createDraftSession(visitorId: string): Promise<FormSessionRecord> {
  return withFallback('createDraftSession', async client => unwrap(await client
    .from('form_sessions')
    .insert([{ visitor_id: visitorId, form_type: 'Purchaser', form_data: {} }])
    .select('*')
    .single()) as FormSessionRecord,
  () => {
    const iso = new Date().toISOString();
    const record: FormSessionRecord = {
      id: randomUUID(),
      visitor_id: visitorId,
      form_type: 'Purchaser',
      current_step: 1,
      party_index: 0,
      status: 'draft',
      form_data: {},
      created_at: iso,
      updated_at: iso,
      completed_at: null,
      last_activity_at: iso
    };
    localSessions.set(record.id, record);
    return record;
  });
}

export async function getSessionById(id: string): Promise<FormSessionRecord | null> {
  return withFallback('getSessionById', async client => unwrap(await client
    .from('form_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()) as FormSessionRecord | null,
  () => localSessions.get(id) || null);
}

/** Saves the latest answers into a draft. Returns false if it is not an editable draft of this visitor. */
export async function updateDraftSession(id: string, visitorId: string, patch: {
  form_data: any;
  current_step: number;
  party_index: number;
  form_type: string;
}): Promise<boolean> {
  const iso = new Date().toISOString();
  const values = { ...patch, updated_at: iso, last_activity_at: iso };
  return withFallback('updateDraftSession', async client => {
    const row = unwrap(await client
      .from('form_sessions')
      .update(values)
      .eq('id', id)
      .eq('visitor_id', visitorId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle());
    return Boolean(row);
  }, () => {
    const s = localSessions.get(id);
    if (!s || s.visitor_id !== visitorId || s.status !== 'draft') return false;
    localSessions.set(id, { ...s, ...values });
    return true;
  });
}

/** Marks this visitor's other drafts as abandoned (used when they choose to start again). */
export async function abandonOtherDrafts(visitorId: string, keepId: string): Promise<void> {
  const iso = new Date().toISOString();
  await withFallback('abandonOtherDrafts', async client => {
    unwrap(await client
      .from('form_sessions')
      .update({ status: 'abandoned', updated_at: iso })
      .eq('visitor_id', visitorId)
      .eq('status', 'draft')
      .neq('id', keepId));
  }, () => {
    localSessions.forEach((s, key) => {
      if (s.visitor_id === visitorId && s.status === 'draft' && s.id !== keepId) {
        localSessions.set(key, { ...s, status: 'abandoned', updated_at: iso });
      }
    });
  });
}

/** Freezes a draft as submitted with its final answers. Returns false if it was not an open draft of this visitor. */
export async function markSessionSubmitted(id: string, visitorId: string, formData: any): Promise<boolean> {
  const iso = new Date().toISOString();
  const values = { status: 'submitted' as const, form_data: formData, completed_at: iso, updated_at: iso, last_activity_at: iso };
  return withFallback('markSessionSubmitted', async client => {
    const row = unwrap(await client
      .from('form_sessions')
      .update(values)
      .eq('id', id)
      .eq('visitor_id', visitorId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle());
    return Boolean(row);
  }, () => {
    const s = localSessions.get(id);
    if (!s || s.visitor_id !== visitorId || s.status !== 'draft') return false;
    localSessions.set(id, { ...s, ...values });
    return true;
  });
}

export async function incrementVisitorFormCount(visitorId: string): Promise<void> {
  await withFallback('incrementVisitorFormCount', async client => {
    const row = unwrap(await client
      .from('form_visitors')
      .select('form_count')
      .eq('visitor_id', visitorId)
      .maybeSingle()) as { form_count: number } | null;
    unwrap(await client
      .from('form_visitors')
      .update({ form_count: (row?.form_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('visitor_id', visitorId));
  }, () => {
    const v = localVisitors.get(visitorId);
    if (v) localVisitors.set(visitorId, { ...v, form_count: v.form_count + 1 });
  });
}
