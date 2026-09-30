import '../helpers/setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAddressChange, applySameAsAbove, collectDocuments, createInitialFormData, createParty, normalizeFormData,
  pickAddress, stepFromNumber, stepsFor, stepToNumber
} from '../../src/components/form/formState.js';

const withAddress = (id: string) => ({
  ...createParty(id), addressLine1: '160 Hampstead Road', suburb: 'Broadview', state: 'SA', postcode: '5083', country: 'Australia'
});

describe('Steps', () => {
  test('TC-FS-01 purchasers get 5 steps, vendors 4 (no stamp duty)', () => {
    assert.equal(stepsFor('Purchaser').length, 5);
    assert.deepEqual(stepsFor('Vendor'), ['start', 'people', 'property', 'review']);
  });

  test('TC-FS-02 saved step numbers map back to the right step, out-of-range values are clamped', () => {
    assert.equal(stepFromNumber('Purchaser', 4), 'stampDuty');
    assert.equal(stepFromNumber('Vendor', 4), 'review');
    assert.equal(stepFromNumber('Vendor', 99), 'review');
    assert.equal(stepToNumber('Purchaser', 'review'), 5);
  });
});

describe('"Same as above" address copying', () => {
  test('TC-FS-03 ticking copies the previous person\'s address', () => {
    const parties = applySameAsAbove([withAddress('p1'), createParty('p2')], 1, true);
    assert.deepEqual(pickAddress(parties[1]), pickAddress(parties[0]));
    assert.equal(parties[1].sameAddressAsPrevious, true);
  });

  test('TC-FS-04 the copy stays in sync while untouched', () => {
    let parties = applySameAsAbove([withAddress('p1'), createParty('p2')], 1, true);
    parties = applyAddressChange(parties, 0, { addressLine1: '14 Smith Street' });
    assert.equal(parties[1].addressLine1, '14 Smith Street');
  });

  test('TC-FS-05 once the person edits their copy, it is no longer overwritten', () => {
    let parties = applySameAsAbove([withAddress('p1'), createParty('p2')], 1, true);
    parties = applyAddressChange(parties, 1, { addressLine2: 'Unit 2' });
    parties = applyAddressChange(parties, 0, { addressLine1: '16 Smith Street' });
    assert.equal(parties[1].addressLine1, '160 Hampstead Road');
    assert.equal(parties[1].addressLine2, 'Unit 2');
  });

  test('TC-FS-06 unticking clears an untouched copy but keeps an edited one', () => {
    const copied = applySameAsAbove([withAddress('p1'), createParty('p2')], 1, true);
    assert.equal(applySameAsAbove(copied, 1, false)[1].addressLine1, '');
    const edited = applyAddressChange(copied, 1, { addressLine2: 'Unit 2' });
    assert.equal(applySameAsAbove(edited, 1, false)[1].addressLine1, '160 Hampstead Road');
  });
});

describe('Restoring saved answers', () => {
  test('TC-FS-07 older / partial saves are completed with defaults', () => {
    const restored = normalizeFormData({ role: 'Vendor', parties: [{ id: 'p1', firstName: 'Vatsal' }] });
    assert.ok(restored);
    assert.equal(restored!.role, 'Vendor');
    assert.equal(restored!.parties[0].firstName, 'Vatsal');
    assert.deepEqual(restored!.parties[0].idDocuments, []);
    assert.equal(restored!.property.state, 'SA');
    assert.equal(restored!.finance.paysByCash, false);
  });

  test('TC-FS-08 invalid saved data is ignored', () => {
    assert.equal(normalizeFormData(null), null);
    assert.equal(normalizeFormData({ parties: [] }), null);
  });

  test('TC-FS-09 uploaded documents are collected with their owner for submission', () => {
    const f = createInitialFormData();
    f.parties[0].idDocuments = [{ id: 'd1', kind: 'identity', fileName: 'licence.png', mimeType: 'image/png', sizeBytes: 70, storagePath: 'local:x', uploadedAt: '' }];
    const docs = collectDocuments(f);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].partyId, 'p1');
  });
});
