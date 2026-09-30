import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
// Server-only key: the new "secret" key (sb_secret_...) or the legacy service_role key.
// The anon key is a last resort — with server-only RLS it cannot write anything.
const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseKey = serverKey || process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
    supabaseUrl.startsWith('http') &&
    supabaseKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseKey.includes('eyJhbGciOi...') &&
    !supabaseKey.includes('your_key_here')
  );
}

export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  if (isSupabaseConfigured()) {
    try {
      if (!serverKey) {
        console.warn('⚠️ [SUPABASE] Only SUPABASE_ANON_KEY is set. Database rules allow server-only access, so set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.');
      }
      supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      console.log('✅ [SUPABASE] Connected successfully to:', supabaseUrl);
      return supabase;
    } catch (err) {
      console.error('❌ [SUPABASE] Error creating client:', err);
      return null;
    }
  }
  return null;
}

// In-memory fallback if Supabase keys are pending configuration
const localIntakesFallback: any[] = [];
const localAuditLogsFallback: any[] = [];

/** Legal matter reference, e.g. RK-2026-4821. */
export function newMatterReference(): string {
  return `RK-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function saveIntakeToSupabase(intake: {
  session_id?: string | null;
  matter_reference: string;
  role: string;
  party_count: number;
  primary_name: string;
  primary_email: string;
  primary_phone: string;
  parties: any[];
  property: any;
  finance: any;
  stamp_duty: any;
  id_documents: any[];
  ownership_type?: string | null;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_email?: string | null;
  broker_company?: string | null;
  how_did_you_hear?: string | null;
  signature_data?: string | null;
  phone_country_code?: string | null;
  [key: string]: any;
}) {
  const client = getSupabase();
  if (client) {
    try {
      let row: Record<string, any> = { ...intake };
      for (let attempt = 0; attempt < 6; attempt++) {
        const { data, error } = await client
          .from('conveyancing_intakes')
          .insert([row])
          .select()
          .single();

        if (!error) {
          console.log('⚡ [SUPABASE] Intake inserted successfully. ID:', data.id);
          return data;
        }
        // Reference already used by an earlier matter — draw a new one
        if (error.code === '23505' && String(error.message).includes('matter_reference')) {
          row = { ...row, matter_reference: newMatterReference() };
          continue;
        }
        // A session that only exists in the local fallback cannot be linked (or the
        // session_id column has not been added yet) — keep the intake without the link
        if ('session_id' in row) {
          console.warn('⚠️ [SUPABASE] Could not link intake to its form session, saving without the link:', error.message);
          const { session_id: _unlinked, ...withoutLink } = row;
          row = withoutLink;
          continue;
        }
        console.error('❌ [SUPABASE INSERT ERROR]:', error.message);
        throw error;
      }
      throw new Error('Could not insert intake after several attempts.');
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE] Falling back to local storage due to error:', err.message);
    }
  } else {
    console.log('ℹ️ [SUPABASE] Keys not yet provided in .env — stored in local fallback store.');
  }

  // Local fallback
  const record = { id: 'local_' + Date.now(), ...intake, created_at: new Date().toISOString() };
  localIntakesFallback.push(record);
  return record;
}

export async function saveAuditLogToSupabase(log: {
  intake_id?: string;
  matter_reference: string;
  session_id: string;
  user_name: string;
  user_phone: string;
  user_email: string;
  browser: string;
  operating_system: string;
  device_type: string;
  user_agent: string;
  ip_address: string;
  screen_resolution: string;
  timezone: string;
  language: string;
  referrer: string;
  cookie_payload: any;
}) {
  const client = getSupabase();
  if (client) {
    try {
      const { data, error } = await client
        .from('client_audit_logs')
        .insert([log])
        .select()
        .single();

      if (error) {
        console.error('❌ [SUPABASE AUDIT LOG ERROR]:', error.message);
      } else {
        console.log('🔍 [SUPABASE] Audit & Cookie telemetry logged. ID:', data.id);
        return data;
      }
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE] Audit log fallback:', err.message);
    }
  }

  localAuditLogsFallback.push({ id: 'local_audit_' + Date.now(), ...log, created_at: new Date().toISOString() });
}

// ─── Document uploads (Supabase Storage, with local-disk fallback) ────────────
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'intake-documents';
const localUploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'uploads')
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');

/** Stores an uploaded file and returns a storage path of the form `supabase:<bucket>/<key>` or `local:<key>`. */
export async function saveUploadedFile(key: string, data: Buffer, contentType: string): Promise<string> {
  const client = getSupabase();
  if (client) {
    try {
      const { error } = await client.storage.from(storageBucket).upload(key, data, { contentType, upsert: false });
      if (error) throw error;
      console.log('📎 [SUPABASE STORAGE] Uploaded:', key);
      return `supabase:${storageBucket}/${key}`;
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE STORAGE] Falling back to local disk due to error:', err.message);
    }
  }

  const target = path.join(localUploadDir, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return `local:${key}`;
}
