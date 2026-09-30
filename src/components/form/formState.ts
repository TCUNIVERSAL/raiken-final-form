import { ClientIntakeFormData, ConveyancingRole, PartyFormData, UploadedDocument } from '../../types/index.js';
import { todayIso } from '../../utils/validation.js';

export const MAX_PARTIES = 20;

// ─── Steps ───────────────────────────────────────────────────────────────────
export type StepKey = 'start' | 'people' | 'property' | 'stampDuty' | 'review';

/** Vendors have no stamp duty questions, so their form is one step shorter. */
export function stepsFor(role: ConveyancingRole): StepKey[] {
  return role === 'Purchaser'
    ? ['start', 'people', 'property', 'stampDuty', 'review']
    : ['start', 'people', 'property', 'review'];
}

export function stepTitle(key: StepKey, role: ConveyancingRole): string {
  switch (key) {
    case 'start': return 'Start';
    case 'people': return `${role}s`;
    case 'property': return 'Property';
    case 'stampDuty': return 'Stamp duty';
    case 'review': return 'Review & confirm';
  }
}

// ─── Defaults ────────────────────────────────────────────────────────────────
export function newPartyId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createParty(id: string = newPartyId()): PartyFormData {
  return {
    id,
    firstName: '',
    middleName: '',
    lastName: '',
    dob: '',
    email: '',
    mobile: '',
    phoneCountryCode: '+61',
    addressLine1: '',
    addressLine2: '',
    suburb: '',
    state: '',
    postcode: '',
    country: 'Australia',
    residencyStatus: '',
    occupation: '',
    sameAddressAsPrevious: false,
    idDocuments: []
  };
}

export function createInitialFormData(): ClientIntakeFormData {
  return {
    role: 'Purchaser',
    roleConfirmed: false,
    partyCount: 1,
    parties: [createParty('p1')],
    property: {
      addressLine1: '',
      suburb: '',
      state: 'SA',
      postcode: '',
      purchasePrice: '',
      settlementDate: '',
      intendedUse: '',
      ownershipType: ''
    },
    finance: {
      mortgageRequired: '',
      brokerOrBankerName: '',
      brokerPhone: '',
      brokerEmail: '',
      lenderName: '',
      paysByElectronicTransfer: false,
      paysByCash: false,
      cashAmount: '',
      paysByVirtualAssets: false,
      virtualAssetsAmount: '',
      paysByOther: false,
      otherPaymentDetails: ''
    },
    stampDuty: {
      reliefEligible: '',
      firstHomeBuyer: '',
      propertyType: '',
      contractSignedOnOrAfter6Jul2024: '',
      contractSignedBetween15Jun2023And5Jul2024: '',
      underPriceThreshold: '',
      meetsEligibilityCriteria: '',
      notes: ''
    },
    declaration: {
      coolingOffAcknowledged: false,
      authorityToAct: false,
      signedName: '',
      signedDate: todayIso(),
      signatureDataUrl: ''
    },
    howDidYouHear: '',
    idDocuments: []
  };
}

// ─── Address helpers ─────────────────────────────────────────────────────────
export const ADDRESS_KEYS = ['addressLine1', 'addressLine2', 'suburb', 'state', 'postcode', 'country'] as const;
export type AddressKey = typeof ADDRESS_KEYS[number];
export type Address = Pick<PartyFormData, AddressKey>;

export function pickAddress(p: PartyFormData): Address {
  return {
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    suburb: p.suburb,
    state: p.state,
    postcode: p.postcode,
    country: p.country
  };
}

export function sameAddress(a: Address, b: Address): boolean {
  return ADDRESS_KEYS.every(k => a[k] === b[k]);
}

export function formatAddress(a: Address): string {
  return [a.addressLine1, a.addressLine2, a.suburb, [a.state, a.postcode].filter(Boolean).join(' '), a.country]
    .filter(s => s && s.trim())
    .join(', ');
}

/**
 * Applies an address change to party `index`. Any following parties that ticked
 * "Same as above" and whose address still matches (i.e. they have not edited the
 * copy) are kept in sync.
 */
export function applyAddressChange(parties: PartyFormData[], index: number, patch: Partial<Address>): PartyFormData[] {
  const next = parties.map(p => ({ ...p }));
  Object.assign(next[index], patch);
  for (let j = index + 1; j < next.length; j++) {
    if (!next[j].sameAddressAsPrevious) break;
    if (!sameAddress(pickAddress(parties[j]), pickAddress(parties[j - 1]))) break;
    Object.assign(next[j], pickAddress(next[j - 1]));
  }
  return next;
}

/** Ticking copies the previous party's address; unticking clears it only if it was not edited. */
export function applySameAsAbove(parties: PartyFormData[], index: number, checked: boolean): PartyFormData[] {
  const next = parties.map(p => ({ ...p }));
  const previous = pickAddress(next[index - 1]);
  if (checked) {
    Object.assign(next[index], previous, { sameAddressAsPrevious: true });
  } else {
    const untouched = sameAddress(pickAddress(next[index]), previous);
    const blank = pickAddress(createParty());
    Object.assign(next[index], untouched ? blank : {}, { sameAddressAsPrevious: false });
  }
  return next;
}

// ─── Restoring saved data ───────────────────────────────────────────────────
/** Merges saved (server or offline) form data over fresh defaults so older or partial saves still load. */
export function normalizeFormData(raw: any): ClientIntakeFormData | null {
  if (!raw || !Array.isArray(raw.parties) || raw.parties.length === 0) return null;
  const base = createInitialFormData();
  const formData: ClientIntakeFormData = {
    ...base,
    ...raw,
    role: raw.role === 'Vendor' ? 'Vendor' : 'Purchaser',
    roleConfirmed: Boolean(raw.roleConfirmed),
    parties: raw.parties.slice(0, MAX_PARTIES).map((p: PartyFormData) => {
      const party = { ...createParty(p?.id || newPartyId()), ...p };
      if (!Array.isArray(party.idDocuments)) party.idDocuments = [];
      return party;
    }),
    property: { ...base.property, ...raw.property, state: 'SA' },
    finance: { ...base.finance, ...raw.finance },
    stampDuty: { ...base.stampDuty, ...raw.stampDuty },
    declaration: { ...base.declaration, ...raw.declaration },
    howDidYouHear: typeof raw.howDidYouHear === 'string' ? raw.howDidYouHear : ''
  };
  formData.partyCount = formData.parties.length;
  return formData;
}

/** Converts a saved 1-based step number back to a step of this role's form. */
export function stepFromNumber(role: ConveyancingRole, n: number): StepKey {
  const steps = stepsFor(role);
  return steps[Math.min(Math.max(Math.round(n) || 1, 1), steps.length) - 1];
}

export function stepToNumber(role: ConveyancingRole, key: StepKey): number {
  return stepsFor(role).indexOf(key) + 1;
}

// ─── Offline buffer (used only while the server cannot be reached) ──────────
const OFFLINE_KEY = 'raikan_intake_offline_v1';

export interface OfflineSnapshot {
  sessionId: string | null;
  savedAt: string;
  currentStep: number;
  partyIndex: number;
  formData: ClientIntakeFormData;
}

export function writeOfflineBuffer(snapshot: OfflineSnapshot) {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked — nothing else we can do offline
  }
}

export function readOfflineBuffer(): OfflineSnapshot | null {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const formData = normalizeFormData(parsed?.formData);
    if (!formData) return null;
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      savedAt: String(parsed.savedAt || ''),
      currentStep: Number(parsed.currentStep) || 1,
      partyIndex: Math.min(Math.max(Number(parsed.partyIndex) || 0, 0), formData.parties.length - 1),
      formData
    };
  } catch {
    return null;
  }
}

export function clearOfflineBuffer() {
  try {
    localStorage.removeItem(OFFLINE_KEY);
  } catch {
    // ignore
  }
}

/** Every uploaded file in one list, tagged with its owner — sent to the API as `idDocuments`. */
export function collectDocuments(data: ClientIntakeFormData): UploadedDocument[] {
  return data.parties.flatMap(p => p.idDocuments.map(d => ({ ...d, partyId: p.id })));
}
