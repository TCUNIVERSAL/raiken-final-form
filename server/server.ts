import dotenv from 'dotenv';
import { app } from './app.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { firmEmails, isEmailConfigured } from './emailService.js';
import { startLiveSignWorker } from './livesign/service.js';
import { liveSignConfig } from './livesign/config.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3005', 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 [RAIKAN CLIENT INTAKE SERVER] Running on http://localhost:${PORT}`);
  console.log(`   Supabase configured: ${isSupabaseConfigured() ? '✅ YES' : '⚠️ Pending .env keys'}`);
  console.log(`   Email dispatch ready: ${isEmailConfigured() ? '✅ YES' : 'ℹ️ Preview Mode (set SMTP_USER / SMTP_PASS)'}`);
  console.log(`   Firm notifications: ${firmEmails.length ? `✅ ${firmEmails.length} address(es)` : '⚠️ FIRM_EMAIL not set'}`);
  console.log(`   LiveSign: ${liveSignConfig.enabled ? `✅ ${liveSignConfig.baseUrl} (${liveSignConfig.productPackageType})` : '⚠️ LIVESIGN_API_KEY not set — forms wait until it is'}`);
  console.log(`   LiveSign updates: ${liveSignConfig.webhookUrl ? 'webhook + ' : ''}checking every ${liveSignConfig.pollSeconds}s\n`);
  startLiveSignWorker();
});
