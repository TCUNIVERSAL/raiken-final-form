import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPostcode, validatePartyAddress, validateProperty } from '../../src/utils/validation.js';
import { validParty, createInitialFormData } from '../helpers/setup.js';

describe('Australian Postcode / PIN Code Validation', () => {
  test('TC-AU-PC-01 valid South Australian postcode 5083 is accepted', () => {
    assert.equal(checkPostcode('5083', 'Australia'), null);
  });

  test('TC-AU-PC-02 valid Adelaide CBD postcode 5000 is accepted', () => {
    assert.equal(checkPostcode('5000', 'Australia'), null);
  });

  test('TC-AU-PC-03 valid interstate Australian postcodes are accepted', () => {
    const validCodes = ['2000', '3000', '4000', '6000', '0800', '7000', '2600'];
    for (const code of validCodes) {
      assert.equal(checkPostcode(code, 'Australia'), null, `Expected ${code} to be accepted`);
    }
  });

  test('TC-AU-PC-04 incomplete 3-digit postcode 508 is rejected', () => {
    const error = checkPostcode('508', 'Australia');
    assert.ok(error, '3-digit postcode should be rejected');
    assert.match(error, /Australian postcodes have 4 digits/i);
  });

  test('TC-AU-PC-05 2-digit postcode 50 is rejected', () => {
    const error = checkPostcode('50', 'Australia');
    assert.ok(error, '2-digit postcode should be rejected');
  });

  test('TC-AU-PC-06 5-digit US ZIP code 90210 is rejected when country is Australia', () => {
    const error = checkPostcode('90210', 'Australia');
    assert.ok(error, '5-digit ZIP should be rejected for Australia');
  });

  test('TC-AU-PC-07 6-digit Indian PIN code 560001 is rejected when country is Australia', () => {
    const error = checkPostcode('560001', 'Australia');
    assert.ok(error, '6-digit PIN code must be rejected when country is Australia');
  });

  test('TC-AU-PC-08 postcode containing letters or symbols is rejected', () => {
    assert.ok(checkPostcode('508A', 'Australia'));
    assert.ok(checkPostcode('50-83', 'Australia'));
    assert.ok(checkPostcode('ABCD', 'Australia'));
  });

  test('TC-AU-PC-09 empty postcode string is rejected', () => {
    const error = checkPostcode('', 'Australia');
    assert.ok(error, 'Empty postcode should be rejected');
    assert.match(error, /Please enter a postcode/i);
  });

  test('TC-AU-PC-10 postcode with whitespace is trimmed and accepted if 4 digits', () => {
    assert.equal(checkPostcode('  5083  ', 'Australia'), null);
  });

  test('TC-AU-PC-11 party address validation enforces Australian 4-digit postcode', () => {
    const party = { ...validParty(), country: 'Australia', postcode: '560001' };
    const errors = validatePartyAddress(party);
    assert.ok(errors.postcode, 'Party address with 6-digit postcode should produce an error');
    assert.match(errors.postcode, /Australian postcodes have 4 digits/i);
  });

  test('TC-AU-PC-12 property address validation enforces Australian 4-digit postcode', () => {
    const form = createInitialFormData();
    form.parties = [validParty()];
    form.property.addressLine1 = '12 King William St';
    form.property.suburb = 'Adelaide';
    form.property.postcode = '508'; // Invalid 3 digits
    const errors = validateProperty(form);
    assert.ok(errors['property.postcode'], 'Property with 3-digit postcode should produce an error');
  });
});

describe('Email Extraction & Validation Rules', () => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  test('TC-EML-01 standard client email is accepted', () => {
    assert.ok(EMAIL_RE.test('client.user@example.com'));
  });

  test('TC-EML-02 Australian corporate domain email is accepted', () => {
    assert.ok(EMAIL_RE.test('intake@raikan.com.au'));
  });

  test('TC-EML-03 client gmail address is accepted', () => {
    assert.ok(EMAIL_RE.test('user@gmail.com'));
    assert.ok(EMAIL_RE.test('test.client@gmail.com'));
    assert.ok(EMAIL_RE.test('example.user46@gmail.com'));
  });

  test('TC-EML-04 malformed email missing @ is rejected', () => {
    assert.equal(EMAIL_RE.test('client.userexample.com'), false);
  });

  test('TC-EML-05 email missing domain is rejected', () => {
    assert.equal(EMAIL_RE.test('client@'), false);
  });

  test('TC-EML-06 email missing TLD is rejected', () => {
    assert.equal(EMAIL_RE.test('client@domain'), false);
  });

  test('TC-EML-07 email containing spaces is rejected', () => {
    assert.equal(EMAIL_RE.test('client user@example.com'), false);
  });
});

describe('Gmail App Password Sanitization', () => {
  test('TC-SEC-01 16-character App Password with spaces is sanitized', () => {
    const rawPass = 'abcd efgh ijkl mnop';
    const sanitized = rawPass.replace(/\s+/g, '');
    assert.equal(sanitized, 'abcdefghijklmnop');
    assert.equal(sanitized.length, 16);
  });

  test('TC-SEC-02 App Password with surrounding whitespace or tabs is trimmed', () => {
    const rawPass = ' \t abcd efgh ijkl mnop \n ';
    const sanitized = rawPass.replace(/\s+/g, '');
    assert.equal(sanitized, 'abcdefghijklmnop');
  });
});
