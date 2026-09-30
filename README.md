# 📋 Raikan Client Intake Form

A client-facing conveyancing intake form for Raikan Corporation:

- Every answer is saved to **Supabase** as the client types.
- Each person's identity and AML are verified through **LiveSign**.
- **Email updates** go to the client and to the firm.

---

## 🌟 Key Features

1. **Simple multi-step form** (same questions as the rcorpo.com Purchaser / Vendor forms)
   - Choose **Purchaser** or **Vendor**; the form opens straight away.
   - Purchaser: Start → Purchasers → Addresses → Property → Stamp duty → Review & confirm (6 steps). Vendor: 5 steps (no stamp duty).
   - Add or remove any number of people. Each has their own details, occupation and photo-ID upload.
   - "Same as above" copies the previous person's address.
   - Payment method questions for the AML check, and step-by-step stamp-duty questions.
   - A review page with Edit links, then a declaration (confirmation checkboxes, full name, date).

2. **Nothing is lost**
   - Answers are saved to `form_sessions` as the client types (a refresh, a closed tab, or a visit days later resumes where they stopped).
   - An anonymous `form_visitor_id` cookie links a browser to its forms. While offline, answers wait on the device and sync when back online.

3. **LiveSign identity + AML verification**
   - On submit, each person is saved as **unverified** and one LiveSign envelope is created: identity check, PEP/sanctions and AML (package `AMLWithVoi`).
   - LiveSign emails each person their verification link.
   - The server checks LiveSign every 2 minutes (plus a webhook when `PUBLIC_BASE_URL` is set). When a person's ID check passes they become **verified**; otherwise **failed** or **needs_review**.
   - If LiveSign can't be reached, the form waits and is sent automatically later, never twice.

4. **Emails**
   - Client: "form sent to LiveSign for verification", then "you have been verified".
   - Firm (`FIRM_EMAIL`): each new form, each verified / failed / needs-review result, and any LiveSign error.

---

## 🚀 Setup

### 1. `.env`
Copy the example and fill it in (`.env` is git-ignored):
```bash
cp .env.example .env
```
| Variable | What it is |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys. The **secret** key (`sb_secret_…`), not the publishable one. |
| `LIVESIGN_API_KEY` | Your LiveSign API key. Forms wait until it is set. |
| `LIVESIGN_BASE_URL` | `https://api.web.live-sign.com` (production, charged per check) or `https://sandbox.api.web.live-sign.com` with a sandbox key for testing. |
| `FIRM_EMAIL` | The firm's address for notifications (comma-separate several). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email sending. Without them, emails are only printed in the server console. |
| `PUBLIC_BASE_URL`, `LIVESIGN_WEBHOOK_SECRET` | Optional: public HTTPS address for instant LiveSign updates. |

Restart the backend after changing `.env`. The startup log shows what is configured.

### 2. Database
Supabase → **SQL Editor → New query**, paste the whole [`supabase_schema.sql`](./supabase_schema.sql) and click **Run**. It is safe to run again whenever this file changes. It creates or updates:
- `form_visitors`, `form_sessions`: saved answers while typing
- `conveyancing_intakes`: submitted forms, with `verification_status`, `livesign_status` and `aml_status`
- `identity_verifications`: one row per person (`unverified` → `verified` / `failed` / `needs_review`)
- `client_audit_logs` and the private `intake-documents` storage bucket

Row Level Security is on with no public policies, so only the backend (secret key) can read or write.

### 3. Run
```bash
npm install
npm run dev
```
- Form: `http://localhost:5175`
- API: `http://localhost:3005`

---

## API

| Route | Purpose |
|---|---|
| `GET /api/session` | Visitor cookie + latest saved draft |
| `PUT /api/session/:id` | Save the draft (owner only, drafts only) |
| `POST /api/session/new` | Start a new draft |
| `POST /api/uploads?kind=identity` | Upload a photo ID (PDF/JPG/PNG, 5 MB, content checked) |
| `POST /api/intake` | Submit: save, create verification rows, send to LiveSign, email client + firm |
| `POST /api/livesign/webhook` | LiveSign change notification (re-reads the envelope from LiveSign) |
