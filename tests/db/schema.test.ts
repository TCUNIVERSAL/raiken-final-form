/**
 * Live database checks — READ-ONLY. Confirms the real Supabase project has every table,
 * column and bucket the app needs. Uses the keys in .env; writes nothing.
 * Run with: npm run test:db
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const configured = /^https:\/\//.test(url) && Boolean(key) && !key.includes('your_key_here');
const sb = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;

async function columnsExist(table: string, columns: string) {
  const { error } = await sb!.from(table).select(columns, { head: true, count: 'exact' });
  return error ? error.message || error.code || 'unknown error' : null;
}

describe('Live Supabase schema (read-only)', { skip: configured ? false : 'SUPABASE_URL / SUPABASE_SECRET_KEY not set' }, () => {
  test('TC-DB-01 the key is a server (secret) key', () => {
    assert.ok(!key.startsWith('sb_publishable_'), 'SUPABASE_SECRET_KEY holds the publishable key');
  });
  test('TC-DB-02 form_visitors table', async () => assert.equal(await columnsExist('form_visitors', 'visitor_id,form_count,last_seen_at'), null));
  test('TC-DB-03 form_sessions table', async () => assert.equal(await columnsExist('form_sessions', 'id,visitor_id,status,form_data,current_step,party_index'), null));
  test('TC-DB-04 conveyancing_intakes base columns', async () => assert.equal(await columnsExist('conveyancing_intakes', 'id,matter_reference,parties,session_id'), null));
  test('TC-DB-05 conveyancing_intakes LiveSign columns', async () =>
    assert.equal(await columnsExist('conveyancing_intakes', 'verification_status,livesign_status,livesign_envelope_id,livesign_attempts,livesign_sent_email_at,aml_status,aml_risk_rating,verified_at'), null,
      'Run the latest supabase_schema.sql'));
  test('TC-DB-06 identity_verifications table', async () =>
    assert.equal(await columnsExist('identity_verifications', 'id,intake_id,party_id,status,livesign_customer_id,verified_email_sent_at'), null,
      'Run the latest supabase_schema.sql'));
  test('TC-DB-07 client_audit_logs table', async () => assert.equal(await columnsExist('client_audit_logs', 'id,matter_reference,session_id'), null));
  test('TC-DB-08 private intake-documents storage bucket', async () => {
    const { data, error } = await sb!.storage.listBuckets();
    assert.equal(error, null);
    const bucket = data?.find(b => b.id === 'intake-documents');
    assert.ok(bucket, 'bucket missing');
    assert.equal(bucket!.public, false, 'bucket must be private');
  });
});
