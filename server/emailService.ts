import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = (process.env.SMTP_USER || '').trim();
// Gmail shows app passwords in groups ("abcd efgh ijkl mnop"); the spaces are not part of it
const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const smtpFrom = process.env.SMTP_FROM || 'Raikan Conveyancing <intake@raikan.com.au>';

export function isEmailConfigured(): boolean {
  const user = process.env.SMTP_USER || smtpUser;
  const pass = process.env.SMTP_PASS || smtpPass;
  return Boolean(user && pass);
}

function createTransporter() {
  if (!isEmailConfigured()) return null;
  const host = process.env.SMTP_HOST || smtpHost;
  const port = parseInt(process.env.SMTP_PORT || String(smtpPort), 10);
  const user = process.env.SMTP_USER || smtpUser;
  const rawPass = process.env.SMTP_PASS || smtpPass;
  const pass = rawPass.replace(/\s+/g, '');
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

/** Client-entered text must never be able to inject HTML into an email. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(opts: { heading: string; intro: string; body: string }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f1f1f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1b29;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dcdce4;border-radius:4px;overflow:hidden;">
    <div style="background:#1b2f63;padding:28px;color:#ffffff;">
      <h1 style="margin:0 0 6px;font-size:22px;">${opts.heading}</h1>
      <p style="margin:0;font-size:14px;opacity:.9;">${opts.intro}</p>
    </div>
    <div style="padding:28px;line-height:1.6;font-size:15px;">${opts.body}
      <p style="font-size:13px;color:#595869;margin-top:24px;">Questions? Call us on 08 7076 9899 or reply to this email.</p>
    </div>
    <div style="background:#f8f8fb;padding:16px 28px;font-size:12px;color:#8c8b9c;border-top:1px solid #dcdce4;">
      &copy; ${new Date().getFullYear()} Raikan Corporation &bull; Shop 3, 160 Hampstead Road, Broadview SA 5083
    </div>
  </div>
</body></html>`;
}

function referenceBox(matterReference: string): string {
  return `<div style="background:#f1f1f5;border-left:4px solid #1b2f63;padding:14px 18px;margin:18px 0;">
    <div style="font-size:11px;text-transform:uppercase;color:#595869;font-weight:700;letter-spacing:.05em;">Your reference</div>
    <div style="font-size:18px;font-weight:800;font-family:monospace;margin-top:4px;">${esc(matterReference)}</div>
  </div>`;
}

/** Recent emails (recipient + subject only), used by the automated tests and for debugging. */
export const emailOutbox: Array<{ to: string; subject: string; delivered: boolean; at: string }> = [];

function record(to: string, subject: string, delivered: boolean) {
  emailOutbox.push({ to, subject, delivered, at: new Date().toISOString() });
  if (emailOutbox.length > 200) emailOutbox.shift();
}

async function deliver(to: string, subject: string, html: string): Promise<{ sent: boolean; messageId?: string }> {
  const result = await send(to, subject, html);
  record(to, subject, result.sent);
  return result;
}

async function send(to: string, subject: string, html: string): Promise<{ sent: boolean; messageId?: string }> {
  const transporter = createTransporter();
  if (!transporter) {
    // SMTP not configured: show what would be sent, and report it as NOT sent
    console.log(`📧 [EMAIL PREVIEW — SMTP not set in .env] To: ${to} | Subject: ${subject}`);
    return { sent: false };
  }
  try {
    const info = await transporter.sendMail({ from: smtpFrom, to, subject, html });
    console.log(`📧 [EMAIL SENT] ${subject} → ${to}`);
    return { sent: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`❌ [EMAIL ERROR] ${subject} → ${to}:`, err.message);
    return { sent: false };
  }
}

export interface PersonEmailParams {
  toEmail: string;
  personName: string;
  matterReference: string;
  role: string;
  propertyAddress: string;
}

/** Email 1 — the form was received and the identity check request is now with LiveSign. */
export function sendSentToLiveSignEmail(p: PersonEmailParams) {
  const body = `
    <p>Dear <strong>${esc(p.personName)}</strong>,</p>
    <p>Thank you — we have received your ${esc(p.role.toLowerCase())} form${p.propertyAddress ? ` for <strong>${esc(p.propertyAddress)}</strong>` : ''} and sent it to <strong>LiveSign</strong> to verify your identity.</p>
    ${referenceBox(p.matterReference)}
    <p style="font-weight:700;margin-bottom:6px;">What to do next</p>
    <ol style="padding-left:20px;margin-top:0;">
      <li>Look for an email from <strong>LiveSign</strong> (check your junk folder too).</li>
      <li>Open the link on your phone and follow the steps: scan your photo ID and take a quick selfie.</li>
      <li>We will email you again as soon as your identity has been verified.</li>
    </ol>`;
  return deliver(
    p.toEmail,
    `Form received and sent to LiveSign for identity verification [${p.matterReference}]`,
    layout({ heading: 'Your form has been sent to LiveSign', intro: 'Next step: verify your identity', body })
  );
}

/** Used when LiveSign could not be reached at submission time: form received, link to follow. */
export function sendReceivedEmail(p: PersonEmailParams) {
  const body = `
    <p>Dear <strong>${esc(p.personName)}</strong>,</p>
    <p>Thank you — we have received your ${esc(p.role.toLowerCase())} form${p.propertyAddress ? ` for <strong>${esc(p.propertyAddress)}</strong>` : ''}.</p>
    ${referenceBox(p.matterReference)}
    <p>Your identity verification request is being sent to <strong>LiveSign</strong>. You will receive another email from us once it has been sent, and then an email from LiveSign with your verification link.</p>`;
  return deliver(
    p.toEmail,
    `Form received [${p.matterReference}]`,
    layout({ heading: 'We have received your form', intro: 'Your identity verification link will follow shortly', body })
  );
}

/** Email 2 — this person's identity has been verified by LiveSign. */
export function sendVerifiedEmail(p: PersonEmailParams) {
  const body = `
    <p>Dear <strong>${esc(p.personName)}</strong>,</p>
    <p>Good news — your identity has been <strong>successfully verified</strong> through LiveSign.</p>
    ${referenceBox(p.matterReference)}
    <p>You do not need to do anything else for the identity check. Our conveyancing team will be in touch about the next steps for your ${esc(p.role.toLowerCase())}${p.propertyAddress ? ` of <strong>${esc(p.propertyAddress)}</strong>` : ''}.</p>`;
  return deliver(
    p.toEmail,
    `You have been verified [${p.matterReference}]`,
    layout({ heading: 'Your identity is verified', intro: 'Thank you for completing your LiveSign check', body })
  );
}

// ─── Firm notifications (FIRM_EMAIL in .env, comma-separated for several) ────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const firmEmails = (process.env.FIRM_EMAIL || '')
  .split(',')
  .map(e => e.trim())
  .filter(e => EMAIL_RE.test(e));

async function deliverToFirm(subject: string, html: string) {
  for (const to of firmEmails) await deliver(to, subject, html);
}

function detailsTable(rows: Array<[string, string]>): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">${rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#595869;width:38%;">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

export interface FirmFormSummary {
  matterReference: string;
  role: string;
  propertyAddress: string;
  people: Array<{ name: string; email: string; mobile: string }>;
}

/** New form submitted — with where it stands in LiveSign. */
export function notifyFirmNewSubmission(form: FirmFormSummary, liveSign: 'sent' | 'pending' | 'error', detail?: string) {
  const status = liveSign === 'sent'
    ? 'Sent to LiveSign — waiting for each person to verify'
    : liveSign === 'pending'
      ? 'Not sent to LiveSign yet — the server will keep retrying automatically'
      : 'LiveSign REJECTED the details — please review';
  const body = `
    <p>A new <strong>${esc(form.role.toLowerCase())}</strong> form has been submitted.</p>
    ${referenceBox(form.matterReference)}
    ${detailsTable([
      ['Property', form.propertyAddress],
      ['LiveSign', status],
      ['Problem', detail || ''],
      ...form.people.map((p, i): [string, string] => [`${form.role} ${i + 1}`, `${p.name} · ${p.email} · ${p.mobile}`])
    ])}`;
  return deliverToFirm(
    `New ${form.role.toLowerCase()} form [${form.matterReference}] — ${liveSign === 'sent' ? 'sent to LiveSign' : liveSign === 'pending' ? 'LiveSign pending' : 'LiveSign error'}`,
    layout({ heading: 'New client form', intro: form.propertyAddress || form.role, body })
  );
}

/** A person's LiveSign result changed to verified / failed / needs review. */
export function notifyFirmPersonStatus(form: FirmFormSummary, person: { name: string; email: string }, status: 'verified' | 'failed' | 'needs_review', allVerified: boolean) {
  const label = status === 'verified' ? 'VERIFIED' : status === 'failed' ? 'FAILED the identity check' : 'FLAGGED — needs review in LiveSign';
  const body = `
    <p><strong>${esc(person.name)}</strong> (${esc(person.email)}) — <strong>${esc(label)}</strong>.</p>
    ${referenceBox(form.matterReference)}
    ${detailsTable([
      ['Property', form.propertyAddress],
      ['Whole form', allVerified ? 'Everyone on this form is now verified' : 'Waiting for other people / review']
    ])}
    ${status !== 'verified' ? '<p>Please open this envelope in LiveSign to review.</p>' : ''}`;
  return deliverToFirm(
    `${person.name}: ${status === 'verified' ? 'verified' : status === 'failed' ? 'identity check failed' : 'needs review'} [${form.matterReference}]`,
    layout({ heading: status === 'verified' ? 'Client verified' : 'Client needs attention', intro: form.propertyAddress || form.role, body })
  );
}

/** LiveSign rejected a form's data — someone must fix it and re-send. */
export function notifyFirmSendError(form: FirmFormSummary, error: string) {
  return notifyFirmNewSubmission(form, 'error', error);
}
