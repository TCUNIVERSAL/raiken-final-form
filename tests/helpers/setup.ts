/**
 * Shared test helpers.
 *
 * The fake LiveSign and the safe environment come from tests/helpers/preload.ts, which
 * `npm test` loads with `node --import` BEFORE anything else. This file must NOT import
 * the preload: it only checks — synchronously, before any app code loads — that the
 * preload ran, and refuses to continue otherwise.
 */
import { TEST_EMAILS } from './constants.js';
import type { FakeEnvelope } from './preload.js';

const testEnv = (globalThis as any).__raikanTestEnv;
const safe = Boolean(testEnv)
  && process.env.NODE_ENV === 'test'
  && (process.env.LIVESIGN_BASE_URL || '').startsWith('http://127.0.0.1:')
  && !process.env.SUPABASE_URL
  && !process.env.SMTP_USER;
if (!safe) {
  throw new Error('Unsafe test environment: run the tests with `npm test` (the preload replaces LiveSign, Supabase and email with fakes).');
}

export { TEST_EMAILS };
export { createInitialFormData } from '../../src/components/form/formState.js';
import { createParty } from '../../src/components/form/formState.js';
import type { PartyFormData } from '../../src/types/index.js';

/** One complete, valid person (Purchaser 1 test email, South Australian address). */
export function validParty(overrides: Partial<PartyFormData> = {}): PartyFormData {
  return {
    ...createParty('p1'),
    firstName: 'Dhruvil', lastName: 'Patel', dob: '1985-03-12', email: TEST_EMAILS.purchaser1,
    mobile: '0412 345 678', residencyStatus: 'Australian Citizen', occupation: 'Engineer',
    addressLine1: '160 Hampstead Road', suburb: 'Broadview', state: 'SA', postcode: '5083', country: 'Australia',
    ...overrides
  };
}
export type { FakeEnvelope };
export const fakeLiveSign: {
  envelopes: Map<string, FakeEnvelope>;
  calls: string[];
  lastPayload: any;
  failExpressWith: number | null;
  expressCount(): number;
  reset(): void;
} = testEnv.fakeLiveSign;

/** A complete, valid purchaser submission using the supplied test emails. */
export function validPurchaserForm(overrides: Record<string, any> = {}) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const person = (id: string, first: string, email: string, mobile: string, phoneCountryCode = '+61') => ({
    id, firstName: first, middleName: '', lastName: 'Tester', dob: '1985-03-12', email, mobile, phoneCountryCode,
    occupation: 'Engineer', residencyStatus: 'Australian Citizen', sameAddressAsPrevious: false,
    addressLine1: '160 Hampstead Road', addressLine2: '', suburb: 'Broadview', state: 'SA', postcode: '5083', country: 'Australia',
    idDocuments: []
  });
  return {
    role: 'Purchaser',
    roleConfirmed: true,
    partyCount: 2,
    parties: [
      person('p1', 'Dhruvil', TEST_EMAILS.purchaser1, '0412 345 678', '+61'),
      person('p2', 'Vatsal', TEST_EMAILS.purchaser2, '98765 43210', '+91')
    ],
    property: { addressLine1: '12 King William Street', suburb: 'Adelaide', state: 'SA', postcode: '5000', purchasePrice: '650000', settlementDate: '', intendedUse: 'To live in', ownershipType: 'Joint Tenants' },
    finance: {
      mortgageRequired: 'Yes', brokerOrBankerName: '', brokerPhone: '', brokerEmail: '', lenderName: 'BankSA',
      paysByElectronicTransfer: true, paysByCash: true, cashAmount: '20000', paysByVirtualAssets: false, virtualAssetsAmount: '', paysByOther: false, otherPaymentDetails: ''
    },
    stampDuty: { reliefEligible: 'No', firstHomeBuyer: '', propertyType: '', contractSignedOnOrAfter6Jul2024: '', contractSignedBetween15Jun2023And5Jul2024: '', underPriceThreshold: '', meetsEligibilityCriteria: '', notes: '' },
    declaration: { coolingOffAcknowledged: true, authorityToAct: true, signedName: 'Dhruvil Tester', signedDate: iso, signatureDataUrl: 'data:image/png;base64,iVBOR' },
    howDidYouHear: 'Google search',
    idDocuments: [],
    ...overrides
  };
}
