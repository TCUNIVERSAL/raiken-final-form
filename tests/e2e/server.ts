export {};

/**
 * Backend for browser (end-to-end) testing: the real app, but with the fake LiveSign,
 * in-memory storage and captured emails from tests/helpers/preload.ts.
 * Runs on port 3105 beside the normal backend; tests/e2e/vite.config.ts (port 5185) proxies to it.
 *
 * Extra test-only routes (this server only):
 *   GET  /__test/emails                       → emails the app tried to send
 *   POST /__test/livesign/:matterRef/verify   → mark every person on that form as passed
 */
await import('../helpers/preload.js');
const { app } = await import('../../server/app.js');
const { liveSignConfig } = await import('../../server/livesign/config.js');
const { isSupabaseConfigured } = await import('../../server/supabaseClient.js');
const { emailOutbox } = await import('../../server/emailService.js');
const { getIntakeByEnvelopeId } = await import('../../server/verificationStore.js');
const { syncIntakeFromLiveSign } = await import('../../server/livesign/service.js');

if (!liveSignConfig.baseUrl.startsWith('http://127.0.0.1:') || isSupabaseConfigured()) {
  throw new Error('E2E server is wired to real services — refusing to start.');
}

const fake = (globalThis as any).__raikanTestEnv.fakeLiveSign;

app.get('/__test/emails', (_req, res) => res.json(emailOutbox));
app.post('/__test/livesign/:ref/verify', async (req, res) => {
  const env = [...fake.envelopes.values()].find((e: any) => e.partnerReference === req.params.ref);
  if (!env) return res.status(404).json({ error: 'no envelope' });
  env.customers.forEach((c: any) => { c.voiOutcome = 'Passed'; c.voiCompletedOn = new Date().toISOString(); });
  const intake = await getIntakeByEnvelopeId(env.id);
  if (intake) await syncIntakeFromLiveSign(intake);
  res.json({ ok: true });
});

const port = parseInt(process.env.E2E_PORT || '3105', 10);
app.listen(port, '127.0.0.1', () => {
  console.log(`🧪 E2E test backend on http://127.0.0.1:${port} — fake LiveSign, in-memory store, emails captured`);
});
