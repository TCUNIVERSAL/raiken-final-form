-- ==============================================================================
-- Raikan Client Intake Form - Supabase Schema
-- ==============================================================================
-- Run in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Safe to run more than once, and safe on a database created from the older
-- version of this file (it only adds what is missing).
--
-- ACCESS MODEL: server-only.
-- Row Level Security is ON for every table and there are NO public policies,
-- so the browser / anon key cannot read or write anything. Only the backend,
-- using the secret (service role) key from .env, can access the data.
-- Drafts contain names, dates of birth and addresses, so do not add public policies.

-- ------------------------------------------------------------------------------
-- 1. Anonymous browser visitors (one row per form_visitor_id cookie)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id TEXT NOT NULL UNIQUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cookie_version TEXT NOT NULL DEFAULT 'v1',
    form_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 2. Form sessions - every answer is saved here while the client types
--    (1 visitor > many sessions; submitted sessions are never changed again)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id TEXT NOT NULL REFERENCES public.form_visitors(visitor_id) ON DELETE CASCADE,
    form_type TEXT NOT NULL DEFAULT 'Purchaser',
    current_step INTEGER NOT NULL DEFAULT 1,
    party_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'abandoned')),
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. Completed conveyancing intakes (final legal matter record)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conveyancing_intakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.form_sessions(id) ON DELETE SET NULL,
    matter_reference TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('Purchaser', 'Vendor')),
    party_count INTEGER NOT NULL DEFAULT 1,
    primary_name TEXT NOT NULL,
    primary_email TEXT NOT NULL,
    primary_phone TEXT NOT NULL,
    parties JSONB NOT NULL DEFAULT '[]'::jsonb,
    property JSONB NOT NULL DEFAULT '{}'::jsonb,
    finance JSONB NOT NULL DEFAULT '{}'::jsonb,
    stamp_duty JSONB NOT NULL DEFAULT '{}'::jsonb,
    id_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For databases created from the older schema: add the session link if it is missing.
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.form_sessions(id) ON DELETE SET NULL;

-- LiveSign identity verification state of each submitted form
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_status TEXT NOT NULL DEFAULT 'pending_send';
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_envelope_id TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_envelope_status TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_error TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_sent_email_at TIMESTAMPTZ;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS livesign_last_synced_at TIMESTAMPTZ;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS aml_status TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS aml_risk_rating TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Ownership, broker/banker, and referral fields (always collected for purchasers)
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS ownership_type TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS broker_name TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS broker_phone TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS broker_email TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS broker_company TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS how_did_you_hear TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE public.conveyancing_intakes ADD COLUMN IF NOT EXISTS phone_country_code TEXT DEFAULT '+61';

-- ------------------------------------------------------------------------------
-- 3b. Identity verification per person (one row for each purchaser / vendor)
--     status: unverified -> verified (LiveSign ID check passed) | failed | needs_review
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id UUID NOT NULL REFERENCES public.conveyancing_intakes(id) ON DELETE CASCADE,
    matter_reference TEXT NOT NULL,
    party_id TEXT NOT NULL,
    party_index INTEGER NOT NULL DEFAULT 0,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    mobile TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'failed', 'needs_review')),
    livesign_envelope_id TEXT,
    livesign_customer_id TEXT,
    voi_outcome TEXT,
    voi_review_status TEXT,
    has_flagged_items BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (intake_id, party_id)
);

-- ------------------------------------------------------------------------------
-- 4. Client telemetry & audit logs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id UUID REFERENCES public.conveyancing_intakes(id) ON DELETE CASCADE,
    matter_reference TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_name TEXT,
    user_phone TEXT,
    user_email TEXT,
    browser TEXT,
    operating_system TEXT,
    device_type TEXT,
    user_agent TEXT,
    ip_address TEXT,
    screen_resolution TEXT,
    timezone TEXT,
    language TEXT,
    referrer TEXT,
    cookie_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_form_visitors_vid ON public.form_visitors(visitor_id);
CREATE INDEX IF NOT EXISTS idx_form_sessions_visitor_status ON public.form_sessions(visitor_id, status);
CREATE INDEX IF NOT EXISTS idx_form_sessions_activity ON public.form_sessions(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_ref ON public.conveyancing_intakes(matter_reference);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_email ON public.conveyancing_intakes(primary_email);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_phone ON public.conveyancing_intakes(primary_phone);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_created ON public.conveyancing_intakes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_session ON public.conveyancing_intakes(session_id);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_livesign ON public.conveyancing_intakes(livesign_status, verification_status);
CREATE INDEX IF NOT EXISTS idx_conveyancing_intakes_envelope ON public.conveyancing_intakes(livesign_envelope_id);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_intake ON public.identity_verifications(intake_id);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_status ON public.identity_verifications(status);
CREATE INDEX IF NOT EXISTS idx_client_audit_session ON public.client_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_client_audit_phone ON public.client_audit_logs(user_phone);
CREATE INDEX IF NOT EXISTS idx_client_audit_email ON public.client_audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_client_audit_created ON public.client_audit_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Row Level Security: ON, with no public policies (server-only access)
-- ------------------------------------------------------------------------------
ALTER TABLE public.form_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conveyancing_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

-- Remove the public policies created by the previous version of this file.
-- (They let anyone holding the anon key read every client's intake.)
DROP POLICY IF EXISTS "Allow public intake submission" ON public.conveyancing_intakes;
DROP POLICY IF EXISTS "Allow public audit log submission" ON public.client_audit_logs;
DROP POLICY IF EXISTS "Allow select for own matter by reference" ON public.conveyancing_intakes;
DROP POLICY IF EXISTS "Allow select for audit logs by reference" ON public.client_audit_logs;

-- ------------------------------------------------------------------------------
-- 7. Private storage bucket for uploaded ID documents (5 MB, PDF/JPG/PNG)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('intake-documents', 'intake-documents', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png']) ON CONFLICT (id) DO NOTHING;
