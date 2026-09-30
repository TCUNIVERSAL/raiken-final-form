import '../helpers/setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addYearsIso, checkPostcode, clearHiddenStampDutyAnswers, formatDateLong, stampDutyVisibility, todayIso,
  validateDeclaration, validatePartyAddress, validatePartyDetails, validateProperty, validateStampDuty
} from '../../src/utils/validation.js';
import { createInitialFormData, createParty } from '../../src/components/form/formState.js';
import { TEST_EMAILS } from '../helpers/setup.js';

const validParty = () => ({
  ...createParty('p1'),
  firstName: 'Dhruvil', lastName: 'Patel', dob: '1985-03-12', email: TEST_EMAILS.purchaser1,
  mobile: '0412 345 678', residencyStatus: 'Australian Citizen', occupation: 'Engineer',
  addressLine1: '160 Hampstead Road', suburb: 'Broadview', state: 'SA', postcode: '5083', country: 'Australia'
});

describe('Person details validation', () => {
  test('TC-VAL-01 a fully completed person has no errors', () => {
    assert.deepEqual(validatePartyDetails(validParty()), {});
  });

  test('TC-VAL-02 an empty person reports every required field', () => {
    const errors = validatePartyDetails(createParty('p1'));
    assert.deepEqual(Object.keys(errors).sort(), ['dob', 'email', 'firstName', 'lastName', 'mobile', 'occupation', 'residencyStatus'].sort());
  });

  test('TC-VAL-03 invalid email addresses are rejected', () => {
    for (const email of ['dhruvil', 'dhruvil@', 'dhruvil@gmail', 'a b@gmail.com']) {
      assert.ok(validatePartyDetails({ ...validParty(), email }).email, `${email} should be invalid`);
    }
  });

  test('TC-VAL-04 each supplied test email is accepted', () => {
    for (const email of Object.values(TEST_EMAILS)) {
      assert.equal(validatePartyDetails({ ...validParty(), email }).email, undefined, email);
    }
  });

  test('TC-VAL-05 phone numbers: too short, letters rejected; AU and international accepted', () => {
    assert.ok(validatePartyDetails({ ...validParty(), mobile: '1234' }).mobile, 'too few digits for AU');
    assert.ok(validatePartyDetails({ ...validParty(), mobile: '04ab 345 678' }).mobile, 'letters not allowed');
    assert.equal(validatePartyDetails({ ...validParty(), mobile: '0412 345 678' }).mobile, undefined, 'valid AU');
    assert.equal(validatePartyDetails({ ...validParty(), mobile: '98765 43210', phoneCountryCode: '+91' }).mobile, undefined, 'valid IN');
    assert.ok(validatePartyDetails({ ...validParty(), mobile: '98765', phoneCountryCode: '+91' }).mobile, 'too short for IN');
  });

  test('TC-VAL-06 date of birth must make the person 18+ and be a real date', () => {
    assert.match(validatePartyDetails({ ...validParty(), dob: addYearsIso(-10) }).dob, /18/);
    assert.ok(validatePartyDetails({ ...validParty(), dob: '1985-02-30' }).dob, '30 Feb is not a real date');
    assert.ok(validatePartyDetails({ ...validParty(), dob: '1899-12-31' }).dob, 'before 1900 is too early');
    assert.equal(validatePartyDetails({ ...validParty(), dob: addYearsIso(-18) }).dob, undefined, 'exactly 18 today is allowed');
  });

  test('TC-VAL-07 the chosen date is shown in words', () => {
    assert.equal(formatDateLong('1985-03-12'), '12 March 1985');
    assert.equal(formatDateLong('not-a-date'), '');
  });
});

describe('Address validation', () => {
  test('TC-VAL-08 complete Australian address passes', () => {
    assert.deepEqual(validatePartyAddress(validParty()), {});
  });

  test('TC-VAL-09 postcode always enforces Australian 4-digit format', () => {
    assert.ok(checkPostcode('508', 'Australia'));
    assert.equal(checkPostcode('5083', 'Australia'), null);
    // All countries now enforce 4-digit Australian postcodes
    assert.ok(checkPostcode('560001', 'India'), '6-digit Indian PIN code should be rejected');
    assert.equal(checkPostcode('5083', 'India'), null, '4-digit postcode accepted even for India');
    assert.ok(checkPostcode('90210-1234', 'United States'), 'US ZIP+4 should be rejected');
    assert.ok(checkPostcode('SW1A 1AA', 'United Kingdom'), 'UK postcode should be rejected');
  });

  test('TC-VAL-10 missing street / suburb / state are reported', () => {
    const errors = validatePartyAddress({ ...validParty(), addressLine1: '', suburb: '', state: '' });
    assert.ok(errors.addressLine1 && errors.suburb && errors.state);
  });
});

describe('Property, mortgage and payment validation', () => {
  const form = () => {
    const f = createInitialFormData();
    f.parties = [validParty()];
    Object.assign(f.property, { addressLine1: '12 King William St', suburb: 'Adelaide', postcode: '5000', purchasePrice: '650000', intendedUse: 'To live in', ownershipType: 'Sole Owner' });
    Object.assign(f.finance, { mortgageRequired: 'No', paysByElectronicTransfer: true });
    return f;
  };

  test('TC-VAL-11 a complete purchaser property step passes', () => {
    assert.deepEqual(validateProperty(form()), {});
  });

  test('TC-VAL-12 purchasers must choose at least one payment method', () => {
    const f = form();
    f.finance.paysByElectronicTransfer = false;
    assert.ok(validateProperty(f)['finance.paysByElectronicTransfer']);
  });

  test('TC-VAL-13 cash / crypto amounts and "other" details are required when ticked', () => {
    const f = form();
    Object.assign(f.finance, { paysByCash: true, cashAmount: '', paysByVirtualAssets: true, virtualAssetsAmount: 'abc', paysByOther: true, otherPaymentDetails: '' });
    const e = validateProperty(f);
    assert.ok(e['finance.cashAmount'] && e['finance.virtualAssetsAmount'] && e['finance.otherPaymentDetails']);
  });

  test('TC-VAL-14 ownership type is required for all purchasers', () => {
    const f = form();
    f.property.ownershipType = '';
    assert.ok(validateProperty(f)['property.ownershipType'], 'ownership required even for single purchaser');
    f.property.ownershipType = 'Joint Tenants';
    assert.equal(validateProperty(f)['property.ownershipType'], undefined);
  });

  test('TC-VAL-15 settlement date cannot be in the past', () => {
    const f = form();
    f.property.settlementDate = addYearsIso(-1);
    assert.ok(validateProperty(f)['property.settlementDate']);
  });

  test('TC-VAL-16 vendors: price optional, bank name required when there is a mortgage', () => {
    const f = form();
    f.role = 'Vendor';
    f.property.purchasePrice = '';
    f.finance.mortgageRequired = 'Yes';
    const e = validateProperty(f);
    assert.equal(e['property.purchasePrice'], undefined);
    assert.ok(e['finance.lenderName']);
    assert.equal(e['finance.paysByElectronicTransfer'], undefined, 'vendors are not asked how they pay');
  });
});

describe('Stamp duty question chain', () => {
  const blank = () => createInitialFormData().stampDuty;

  test('TC-VAL-17 answering "No" to eligibility ends the questions', () => {
    const sd = { ...blank(), reliefEligible: 'No' as const };
    assert.equal(stampDutyVisibility(sd).firstHomeBuyer, false);
    assert.deepEqual(validateStampDuty(sd), {});
  });

  test('TC-VAL-18 the full chain appears in the live form order', () => {
    const sd = { ...blank(), reliefEligible: 'Yes' as const, firstHomeBuyer: 'Yes' as const, propertyType: 'Brand New Home',
      contractSignedOnOrAfter6Jul2024: 'No' as const, contractSignedBetween15Jun2023And5Jul2024: 'Yes' as const, underPriceThreshold: 'Yes' as const };
    const v = stampDutyVisibility(sd);
    assert.ok(v.firstHomeBuyer && v.propertyType && v.signedAfter && v.signedBetween && v.threshold && v.criteria);
    assert.ok(validateStampDuty(sd)['stampDuty.meetsEligibilityCriteria'], 'criteria question must be answered');
  });

  test('TC-VAL-19 changing an earlier answer clears the later hidden answers', () => {
    const sd = { ...blank(), reliefEligible: 'Yes' as const, firstHomeBuyer: 'Yes' as const, propertyType: 'Brand New Home', contractSignedOnOrAfter6Jul2024: 'Yes' as const, meetsEligibilityCriteria: 'Yes' as const };
    const cleared = clearHiddenStampDutyAnswers({ ...sd, firstHomeBuyer: 'No' });
    assert.equal(cleared.propertyType, '');
    assert.equal(cleared.contractSignedOnOrAfter6Jul2024, '');
    assert.equal(cleared.meetsEligibilityCriteria, '');
  });
});

describe('Declaration validation', () => {
  test('TC-VAL-20 purchasers must tick both boxes, type a name and use today or earlier', () => {
    const f = createInitialFormData();
    const e = validateDeclaration(f);
    assert.ok(e['declaration.coolingOffAcknowledged'] && e['declaration.authorityToAct'] && e['declaration.signedName']);
    assert.ok(e['declaration.signatureDataUrl'], 'signature is required');
    f.declaration = { coolingOffAcknowledged: true, authorityToAct: true, signedName: 'Dhruvil Patel', signedDate: todayIso(), signatureDataUrl: 'data:image/png;base64,abc' };
    assert.deepEqual(validateDeclaration(f), {});
    f.declaration.signedDate = addYearsIso(1);
    assert.ok(validateDeclaration(f)['declaration.signedDate'], 'future date is rejected');
  });

  test('TC-VAL-21 vendors only need the authority box (no cooling-off)', () => {
    const f = createInitialFormData();
    f.role = 'Vendor';
    f.declaration = { coolingOffAcknowledged: false, authorityToAct: true, signedName: 'Vatsal', signedDate: todayIso(), signatureDataUrl: 'data:image/png;base64,abc' };
    assert.deepEqual(validateDeclaration(f), {});
  });
});
