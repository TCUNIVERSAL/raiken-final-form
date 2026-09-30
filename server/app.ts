import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { saveIntakeToSupabase, saveAuditLogToSupabase, saveUploadedFile, isSupabaseConfigured, newMatterReference } from './supabaseClient.js';
import { isEmailConfigured, notifyFirmNewSubmission, sendReceivedEmail } from './emailService.js';
import { startVerification } from './verificationStore.js';
import { firmSummary, handleLiveSignWebhook, sendIntakeToLiveSign } from './livesign/service.js';
import { liveSignConfig } from './livesign/config.js';
import { timingSafeEqual } from 'crypto';
import {
  abandonOtherDrafts, createDraftSession, FormSessionRecord, getLatestDraft, getSessionById,
  incrementVisitorFormCount, markSessionSubmitted, touchVisitor, updateDraftSession
} from './sessionStore.js';
import { checkPhone } from '../src/utils/validation.js';

dotenv.config();

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));

// Helper to extract client IP address
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// ─── Health / Status Endpoint ────────────────────────────────────────────────
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'online',
    service: 'Raikan Standalone Client Intake Form API',
    supabaseConnected: isSupabaseConfigured(),
    timestamp: new Date().toISOString()
  });
});

// ─── Anonymous visitor cookie ────────────────────────────────────────────────
// A random UUID identifies the browser; it is never derived from personal or device data.
const VISITOR_COOKIE = 'form_visitor_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getOrCreateVisitorId(req: Request, res: Response): { visitorId: string; isNew: boolean } {
  const existing = req.cookies?.[VISITOR_COOKIE];
  if (typeof existing === 'string' && UUID_RE.test(existing)) {
    return { visitorId: existing, isNew: false };
  }
  const visitorId = randomUUID();
  res.cookie(VISITOR_COOKIE, visitorId, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production',
    path: '/'
  });
  return { visitorId, isNew: true };
}

function toClientSession(s: FormSessionRecord) {
  return {
    id: s.id,
    status: s.status,
    formType: s.form_type,
    currentStep: s.current_step,
    partyIndex: s.party_index,
    formData: s.form_data,
    updatedAt: s.updated_at
  };
}

const MAX_SESSION_BYTES = 512 * 1024;

// Returns this browser's latest draft (creating one if needed) so the form can resume
app.get('/api/session', async (req: Request, res: Response) => {
  try {
    const { visitorId, isNew } = getOrCreateVisitorId(req, res);
    await touchVisitor(visitorId, isNew);
    const session = (!isNew && await getLatestDraft(visitorId)) || await createDraftSession(visitorId);
    return res.json({ success: true, visitorId, session: toClientSession(session) });
  } catch (error: any) {
    console.error('❌ [SESSION LOAD ERROR]:', error);
    return res.status(500).json({ success: false, message: 'Could not load your saved form.' });
  }
});

// Starts a fresh draft; any other open draft of this visitor is marked abandoned
app.post('/api/session/new', async (req: Request, res: Response) => {
  try {
    const { visitorId, isNew } = getOrCreateVisitorId(req, res);
    await touchVisitor(visitorId, isNew);
    const session = await createDraftSession(visitorId);
    await abandonOtherDrafts(visitorId, session.id);
    return res.json({ success: true, session: toClientSession(session) });
  } catch (error: any) {
    console.error('❌ [SESSION CREATE ERROR]:', error);
    return res.status(500).json({ success: false, message: 'Could not start a new form.' });
  }
});

// Saves the complete current answers into the draft
app.put('/api/session/:id', async (req: Request, res: Response) => {
  try {
    const visitorId = req.cookies?.[VISITOR_COOKIE];
    const { id } = req.params;
    if (typeof visitorId !== 'string' || !UUID_RE.test(visitorId) || !UUID_RE.test(id)) {
      return res.status(404).json({ success: false, message: 'Form session not found.' });
    }

    const { formData, currentStep, partyIndex, formType } = req.body || {};
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      return res.status(400).json({ success: false, message: 'Missing form data.' });
    }
    if (JSON.stringify(formData).length > MAX_SESSION_BYTES) {
      return res.status(413).json({ success: false, message: 'The form data is too large.' });
    }

    const saved = await updateDraftSession(id, visitorId, {
      form_data: formData,
      current_step: Math.min(Math.max(parseInt(currentStep, 10) || 1, 1), 6),
      party_index: Math.min(Math.max(parseInt(partyIndex, 10) || 0, 0), 50),
      form_type: formType === 'Vendor' ? 'Vendor' : 'Purchaser'
    });

    if (!saved) {
      // Either not this visitor's session, or it has already been submitted
      const existing = await getSessionById(id);
      const status = existing && existing.visitor_id === visitorId ? 409 : 404;
      return res.status(status).json({ success: false, message: status === 409 ? 'This form has already been submitted.' : 'Form session not found.' });
    }

    touchVisitor(visitorId).catch(() => undefined);
    return res.json({ success: true, savedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('❌ [SESSION SAVE ERROR]:', error);
    return res.status(500).json({ success: false, message: 'Could not save your answers.' });
  }
});

// ─── Document Upload Endpoint ────────────────────────────────────────────────
// The browser sends the raw file body; the original name travels in X-File-Name.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOADS: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: 'pdf', matches: b => b.subarray(0, 4).toString('latin1') === '%PDF' },
  'image/jpeg': { ext: 'jpg', matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }
};
const DOCUMENT_KINDS = ['identity', 'proofOfAddress', 'contract'];

app.post(
  '/api/uploads',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    try {
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const allowed = ALLOWED_UPLOADS[contentType];
      let body = req.body as Buffer;
      if (!Buffer.isBuffer(body) && body) {
        if (typeof body === 'string') {
          body = Buffer.from(body);
        } else if ((body as any) instanceof Uint8Array) {
          body = Buffer.from(body);
        }
      }
      const kind = String(req.query.kind || '');

      if (!DOCUMENT_KINDS.includes(kind)) {
        return res.status(400).json({ success: false, message: 'Unknown document type.' });
      }
      if (!allowed) {
        return res.status(415).json({ success: false, message: 'Only PDF, JPG or PNG files are accepted.' });
      }
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ success: false, message: 'The file is empty.' });
      }
      if (!allowed.matches(body)) {
        return res.status(415).json({ success: false, message: 'The file content does not match its type. Please choose a real PDF, JPG or PNG file.' });
      }

      let fileName = 'document';
      try {
        fileName = decodeURIComponent(String(req.headers['x-file-name'] || 'document')).slice(0, 200);
      } catch {
        // keep default name
      }

      const id = randomUUID();
      const now = new Date();
      const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${id}.${allowed.ext}`;
      const storagePath = await saveUploadedFile(key, body, contentType);

      return res.json({
        success: true,
        document: {
          id,
          kind,
          fileName,
          mimeType: contentType,
          sizeBytes: body.length,
          storagePath,
          uploadedAt: now.toISOString()
        }
      });
    } catch (error: any) {
      console.error('❌ [UPLOAD HANDLER ERROR]:', error);
      return res.status(500).json({ success: false, message: 'The file could not be saved. Please try again.' });
    }
  }
);

// ─── Client Intake Form Submission Endpoint ──────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Server-side check of the legally required answers. Returns a message for the first problem found. */
function findMissingRequiredField(formData: any): string | null {
  if (!formData || typeof formData !== 'object') return 'Invalid submission data.';
  if (formData.role !== 'Purchaser' && formData.role !== 'Vendor') return 'Please choose Purchaser or Vendor.';
  if (!Array.isArray(formData.parties) || formData.parties.length === 0) return 'At least one person is required.';
  for (const [i, p] of formData.parties.entries()) {
    const who = `${formData.role} ${i + 1}`;
    if (!p?.firstName?.trim() || !p?.lastName?.trim()) return `${who}: full name is required.`;
    if (!p.email || !EMAIL_RE.test(String(p.email).trim())) return `${who}: a valid email is required.`;
    if (!p.mobile?.trim()) return `${who}: a contact number is required.`;
    const phoneErr = checkPhone(p.mobile, p.phoneCountryCode || '+61');
    if (phoneErr) return `${who}: ${phoneErr}`;
    if (!p.dob) return `${who}: date of birth is required.`;
    if (!p.residencyStatus) return `${who}: residency status is required.`;
    if (!p.occupation?.trim()) return `${who}: occupation is required.`;
    if (!p.addressLine1?.trim() || !p.suburb?.trim() || !p.postcode?.trim()) return `${who}: address is incomplete.`;
    if ((!p.country || p.country === 'Australia') && !/^\d{4}$/.test(String(p.postcode || '').trim())) {
      return `${who}: Australian postcode must be 4 digits (e.g. 5083).`;
    }
  }
  if (!formData.property?.addressLine1?.trim() || !formData.property?.postcode?.trim()) return 'The property address is required.';
  if (!/^\d{4}$/.test(String(formData.property?.postcode || '').trim())) {
    return 'Property postcode must be a valid 4-digit Australian postcode (e.g. 5000).';
  }
  const d = formData.declaration;
  if (!d?.authorityToAct) return 'Please authorise us to act as your conveyancer.';
  if (formData.role === 'Purchaser' && !d.coolingOffAcknowledged) return 'Please confirm you understand your cooling-off rights.';
  if (!d.signedName?.trim()) return 'Please type your full name in the declaration.';
  return null;
}

app.post('/api/intake', async (req: Request, res: Response) => {
  try {
    const { formData, telemetry, sessionId } = req.body;

    const problem = findMissingRequiredField(formData);
    if (problem) {
      return res.status(400).json({ success: false, message: problem });
    }

    const primaryParty = formData.parties[0];
    const clientName = `${primaryParty.firstName || ''} ${primaryParty.lastName || ''}`.trim() || 'Valued Client';
    const clientEmail = primaryParty.email || '';
    const clientPhone = primaryParty.mobile || '';

    // Freeze the draft first: this is atomic, so a double-click cannot create two matters
    const { visitorId, isNew } = getOrCreateVisitorId(req, res);
    if (isNew) await touchVisitor(visitorId, true);
    let linkedSessionId: string | null = null;
    if (!isNew && typeof sessionId === 'string' && UUID_RE.test(sessionId)) {
      const frozen = await markSessionSubmitted(sessionId, visitorId, formData);
      if (!frozen) {
        const existing = await getSessionById(sessionId);
        if (existing?.visitor_id === visitorId && existing.status === 'submitted') {
          return res.status(409).json({ success: false, message: 'This form has already been submitted.' });
        }
      } else {
        linkedSessionId = sessionId;
      }
    }

    // Legal matter reference, e.g. RK-2026-XXXX (regenerated on the rare clash when saving)
    let matterReference = newMatterReference();

    const propertyAddress = [
      formData.property?.addressLine1,
      formData.property?.suburb,
      formData.property?.state,
      formData.property?.postcode
    ].filter(Boolean).join(', ');

    // 1. Save Persistent Tracking Cookies in HTTP Response
    const cookieOptions = {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false, // Accessible to client scripts
      sameSite: 'lax' as const,
      path: '/'
    };

    // 2. Insert into Supabase `conveyancing_intakes`
    const intakeRecord = await saveIntakeToSupabase({
      session_id: linkedSessionId,
      matter_reference: matterReference,
      role: formData.role,
      party_count: formData.partyCount || 1,
      primary_name: clientName,
      primary_email: clientEmail,
      primary_phone: clientPhone,
      parties: formData.parties,
      property: formData.property || {},
      finance: formData.finance || {},
      stamp_duty: formData.stampDuty || {},
      id_documents: formData.idDocuments || [],
      ownership_type: formData.property?.ownershipType || null,
      broker_name: formData.finance?.brokerOrBankerName || null,
      broker_phone: formData.finance?.brokerPhone || null,
      broker_email: formData.finance?.brokerEmail || null,
      broker_company: formData.finance?.lenderName || null,
      how_did_you_hear: formData.howDidYouHear || null,
      signature_data: formData.declaration?.signatureDataUrl || null,
      phone_country_code: primaryParty.phoneCountryCode || '+61'
    });
    matterReference = intakeRecord?.matter_reference || matterReference;

    if (clientPhone) res.cookie('raikan_user_phone', clientPhone, cookieOptions);
    if (clientName) res.cookie('raikan_user_name', clientName, cookieOptions);
    if (clientEmail) res.cookie('raikan_user_email', clientEmail, cookieOptions);
    res.cookie('raikan_last_matter', matterReference, cookieOptions);
    if (telemetry?.sessionId) res.cookie('raikan_session_id', telemetry.sessionId, cookieOptions);

    await incrementVisitorFormCount(visitorId);

    // 3. Insert into Supabase `client_audit_logs` (tracking device, browser, phone, IP, cookies)
    const clientIp = getClientIp(req);
    await saveAuditLogToSupabase({
      intake_id: intakeRecord?.id,
      matter_reference: matterReference,
      session_id: telemetry?.sessionId || req.cookies?.raikan_session_id || 'sess_' + Date.now(),
      user_name: clientName,
      user_phone: clientPhone,
      user_email: clientEmail,
      browser: telemetry?.browser || req.headers['user-agent'] || 'Unknown Browser',
      operating_system: telemetry?.operatingSystem || 'Unknown OS',
      device_type: telemetry?.deviceType || 'Desktop',
      user_agent: req.headers['user-agent'] || telemetry?.userAgent || '',
      ip_address: clientIp,
      screen_resolution: telemetry?.screenResolution || '',
      timezone: telemetry?.timezone || 'Australia/Sydney',
      language: telemetry?.language || 'en-AU',
      referrer: telemetry?.referrer || req.headers.referer || 'Direct',
      cookie_payload: {
        receivedCookies: req.cookies || {},
        clientReported: telemetry || {}
      }
    });

    // 4. Every person starts as "unverified"; send the identity + AML check to LiveSign.
    //    Wait up to 15 s so the reply can say it was sent — slower calls finish in the
    //    background, and the worker retries anything LiveSign could not accept yet.
    const { intake: verificationIntake } = await startVerification(intakeRecord);
    const sending = sendIntakeToLiveSign(verificationIntake, { notifyFirmOnError: false });
    const outcome = await Promise.race([
      sending,
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 15_000))
    ]);

    // 5. Email: "sent to LiveSign" goes to everyone from sendIntakeToLiveSign; if it is not
    //    sent yet, confirm receipt now and the LiveSign email follows when it goes out.
    let emailSent = outcome === 'sent' && isEmailConfigured();
    if (outcome !== 'sent' && clientEmail) {
      const r = await sendReceivedEmail({ toEmail: clientEmail, personName: clientName, matterReference, role: formData.role, propertyAddress });
      emailSent = r.sent;
    }

    // Firm copy: new form + where it stands in LiveSign
    await notifyFirmNewSubmission(firmSummary(verificationIntake), outcome, outcome === 'error' ? 'See livesign_error on this intake in Supabase.' : undefined);

    // 6. Return success payload
    return res.json({
      success: true,
      matterReference,
      intakeId: intakeRecord?.id,
      clientEmail,
      emailDispatched: emailSent,
      verificationStatus: 'unverified',
      sentToLiveSign: outcome === 'sent',
      message: `Conveyancing intake recorded successfully. Matter #${matterReference}`
    });
  } catch (error: any) {
    console.error('❌ [INTAKE SUBMISSION HANDLER ERROR]:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'An internal error occurred while processing intake.'
    });
  }
});

// ─── LiveSign webhook ────────────────────────────────────────────────────────
// Registered with LiveSign only when PUBLIC_BASE_URL is set. The body is treated as a
// "something changed" signal: the result is always re-read from the LiveSign API.
function webhookTokenValid(req: Request): boolean {
  const secret = liveSignConfig.webhookSecret;
  if (!secret) return true;
  const given = String(req.query.token || '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/api/livesign/webhook', async (req: Request, res: Response) => {
  if (!webhookTokenValid(req)) {
    return res.status(401).json({ received: false });
  }
  // Acknowledge straight away; LiveSign should not wait for our processing
  res.json({ received: true });
  try {
    const { matched } = await handleLiveSignWebhook(req.body, req.query);
    if (!matched) console.warn('⚠️  [LIVESIGN WEBHOOK] No form linked to this envelope.');
  } catch (err: any) {
    console.error('❌ [LIVESIGN WEBHOOK] Sync failed:', err.message);
  }
});

// Return JSON (instead of Express's default HTML page) for oversized or malformed bodies
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'The file is larger than 5 MB. Please choose a smaller file.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'The request could not be read.' });
  }
  return next(err);
});

export { app };
