/**
 * LIVE email test — sends REAL emails through the SMTP account in .env to the three test
 * addresses, using matter reference RK-TEST-0001. Nothing else (no database, no LiveSign).
 * Run only on purpose:  npm run test:email
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_EMAILS } from '../helpers/constants.js';
import {
  emailOutbox, isEmailConfigured, notifyFirmNewSubmission, sendReceivedEmail, sendSentToLiveSignEmail, sendVerifiedEmail
} from '../../server/emailService.js';

const enabled = process.env.LIVE_EMAIL_TEST === '1';
const REF = 'RK-TEST-0001';
const base = { matterReference: REF, role: 'Purchaser', propertyAddress: '12 King William Street, Adelaide SA 5000' };

describe('Live email delivery (real SMTP)', { skip: enabled ? false : 'set LIVE_EMAIL_TEST=1 (npm run test:email)' }, () => {
  test('TC-MAIL-01 SMTP settings are present', () => {
    assert.ok(isEmailConfigured(), 'SMTP_USER / SMTP_PASS missing in .env');
  });

  test('TC-MAIL-02 Purchaser 1 receives "Form received and sent to LiveSign"', async () => {
    const r = await sendSentToLiveSignEmail({ ...base, toEmail: TEST_EMAILS.purchaser1, personName: 'Dhruvil Patel' });
    assert.equal(r.sent, true, 'SMTP refused the message — check the server log for the reason');
  });

  test('TC-MAIL-03 Purchaser 1 receives "You have been verified"', async () => {
    const r = await sendVerifiedEmail({ ...base, toEmail: TEST_EMAILS.purchaser1, personName: 'Dhruvil Patel' });
    assert.equal(r.sent, true);
  });

  test('TC-MAIL-04 Purchaser 2 receives "Form received" (LiveSign pending version)', async () => {
    const r = await sendReceivedEmail({ ...base, toEmail: TEST_EMAILS.purchaser2, personName: 'Vatsal Vachhani' });
    assert.equal(r.sent, true);
  });

  test('TC-MAIL-05 the firm receives "New purchaser form" at FIRM_EMAIL', async () => {
    await notifyFirmNewSubmission({
      ...base,
      people: [
        { name: 'Dhruvil Patel', email: TEST_EMAILS.purchaser1, mobile: '0412 345 678' },
        { name: 'Vatsal Vachhani', email: TEST_EMAILS.purchaser2, mobile: '+91 98765 43210' }
      ]
    }, 'sent');
    const firmMail = emailOutbox.filter(e => e.to === TEST_EMAILS.firm && e.subject.includes(REF));
    assert.ok(firmMail.length > 0, 'FIRM_EMAIL is not the firm test address or no email was attempted');
    assert.ok(firmMail.every(e => e.delivered), 'SMTP refused the firm email');
  });
});
