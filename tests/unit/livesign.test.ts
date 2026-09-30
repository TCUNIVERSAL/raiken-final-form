import '../helpers/setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelopePayload, splitMobile, validateEnvelopePayload } from '../../server/livesign/payload.js';
import { findCustomer, overallStatus, personStatusFromCustomer } from '../../server/livesign/verdict.js';
import { TEST_EMAILS, validPurchaserForm } from '../helpers/setup.js';

const codes = [{ id: 13, phoneCode: '+61' }, { id: 99, phoneCode: '+91' }];
const opts = { partnerId: '11111111-2222-3333-4444-555555555555', productPackageType: 'AMLWithVoi', voiProductId: 1, timeZone: 'Australia/Adelaide', countryCodes: codes };

function payloadFor(form = validPurchaserForm()) {
  return buildEnvelopePayload({ matterReference: 'RK-2026-1000', role: form.role, parties: form.parties, property: form.property, finance: form.finance }, opts) as any;
}

describe('Phone numbers for LiveSign', () => {
  test('TC-LS-01 Australian numbers → country 13 without the leading 0', () => {
    assert.deepEqual(splitMobile('0412 345 678', codes), { countryCodeId: 13, mobileNumber: '412345678' });
    assert.deepEqual(splitMobile('+61 412 345 678', codes), { countryCodeId: 13, mobileNumber: '412345678' });
  });

  test('TC-LS-02 international numbers use the matching country code', () => {
    assert.deepEqual(splitMobile('+91 98765 43210', codes), { countryCodeId: 99, mobileNumber: '9876543210' });
    assert.deepEqual(splitMobile('0091 98765 43210', codes), { countryCodeId: 99, mobileNumber: '9876543210' });
  });
});

describe('Envelope sent to LiveSign', () => {
  test('TC-LS-03 AML is switched on with purchase details, lender and payment methods', () => {
    const aml = payloadFor().envelope.aml;
    assert.equal(payloadFor().envelope.hasAml, true);
    assert.equal(aml.transactionType, 'Purchase');
    assert.equal(aml.propertyValue, 650000);
    assert.deepEqual(aml.properties, ['12 King William Street, Adelaide, SA 5000']);
    assert.equal(aml.usingALender, true);
    assert.equal(aml.lenderName, 'BankSA');
    assert.equal(aml.isElectronicTransfer, true);
    assert.equal(aml.isPhysicalCurrency, true);
    assert.equal(aml.physicalCurrencyAmount, 20000);
    assert.equal(aml.virtualAssetsAmount, 0, 'required by the schema even when not used');
    assert.equal(aml.otherFundingMeansOfPayment, 'None', 'required by the schema even when not used');
  });

  test('TC-LS-04 link sent by email, AML package, matter reference as partner reference', () => {
    const env = payloadFor().envelope;
    assert.equal(env.notificationType, 'Email');
    assert.equal(env.productPackageType, 'AMLWithVoi');
    assert.equal(env.partnerReference, 'RK-2026-1000');
    assert.equal(env.liveSignVerifyProductId, 1);
  });

  test('TC-LS-05 one LiveSign customer per person, with PEP check, DOB, email and occupation', () => {
    const [c1, c2] = payloadFor().customers;
    assert.equal(c1.emailAddress, TEST_EMAILS.purchaser1);
    assert.equal(c2.emailAddress, TEST_EMAILS.purchaser2);
    assert.equal(c1.requiresPep, true);
    assert.equal(c1.dob, '1985-03-12T00:00:00Z');
    assert.equal(c1.aml.occupation, 'Engineer');
    assert.equal(c2.countryCodeId, 99);
    assert.equal(c1.index, 1);
    assert.equal(c2.index, 2);
  });

  test('TC-LS-06 a vendor form becomes a Sale with no purchase-payment details', () => {
    const f = validPurchaserForm({ role: 'Vendor' });
    const aml = payloadFor(f).envelope.aml;
    assert.equal(aml.transactionType, 'Sale');
    assert.equal(aml.usingALender, false);
    assert.equal(aml.isPhysicalCurrency, false);
  });

  test('TC-LS-07 missing email / DOB / bad mobile are caught before sending', () => {
    const f = validPurchaserForm();
    f.parties[0] = { ...f.parties[0], email: '', dob: '', mobile: '12' };
    const problems = validateEnvelopePayload(payloadFor(f));
    assert.ok(problems.some(p => /email/.test(p)));
    assert.ok(problems.some(p => /date of birth/.test(p)));
    assert.ok(problems.some(p => /mobile/.test(p)));
  });
});

describe('Reading results back from LiveSign', () => {
  test('TC-LS-08 ID check result → person status', () => {
    assert.equal(personStatusFromCustomer({ voiOutcome: 'NotCalculated' }), 'unverified');
    assert.equal(personStatusFromCustomer({ voiOutcome: 'Passed' }), 'verified');
    assert.equal(personStatusFromCustomer({ voiOutcome: 'Passed', hasFlaggedItems: true }), 'needs_review');
    assert.equal(personStatusFromCustomer({ voiOutcome: 'Passed', hasFlaggedItems: true, voiReviewStatus: 'Approved' }), 'verified');
    assert.equal(personStatusFromCustomer({ voiOutcome: 'Failed' }), 'failed');
    assert.equal(personStatusFromCustomer({ voiOutcome: 'Passed', voiReviewStatus: 'Rejected' }), 'failed');
  });

  test('TC-LS-09 the whole form is verified only when everyone is', () => {
    assert.equal(overallStatus(['verified', 'unverified']), 'unverified');
    assert.equal(overallStatus(['verified', 'verified']), 'verified');
    assert.equal(overallStatus(['verified', 'needs_review']), 'needs_review');
    assert.equal(overallStatus(['verified', 'failed']), 'failed');
  });

  test('TC-LS-10 LiveSign customers are matched to our people by id, position, then email', () => {
    const customers = [{ id: 'c1', index: 1, emailAddress: 'x@y.com' }, { id: 'c2', index: 2, emailAddress: TEST_EMAILS.purchaser2, firstName: 'Vatsal', lastName: 'Tester' }];
    assert.equal(findCustomer(customers, { livesign_customer_id: 'c2', party_index: 0 })?.id, 'c2');
    assert.equal(findCustomer(customers, { party_index: 0 })?.id, 'c1');
    assert.equal(findCustomer([customers[1]], { party_index: 5, email: TEST_EMAILS.purchaser2, full_name: 'Vatsal Tester' })?.id, 'c2');
  });
});
