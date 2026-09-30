import { ClientIntakeFormData, PartyFormData, StampDutyFormData } from '../types/index.js';

export type FieldErrors = Record<string, string>;

export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

export const COUNTRIES = [
  'Australia',
  'New Zealand',
  'India',
  'United Kingdom',
  'United States',
  'Canada',
  'Singapore',
  'China',
  'Hong Kong',
  'Malaysia',
  'Philippines',
  'South Africa',
  'Other'
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─── Date helpers (all dates are stored as YYYY-MM-DD strings) ───────────────
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addYearsIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return toIsoDate(d);
}

export const DOB_MIN = '1900-01-01';
/** Latest allowed date of birth: the person must be 18 or older today. */
export const dobMax = () => addYearsIso(-18);
export const settlementMin = () => todayIso();
export const settlementMax = () => addYearsIso(3);
export const signedDateMin = () => addYearsIso(-1);

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** "1985-03-12" → "12 March 1985" */
export function formatDateLong(value: string): string {
  if (!isRealIsoDate(value)) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Field-level checks ──────────────────────────────────────────────────────

/** Expected digit ranges for national phone numbers (excluding the country code). */
const PHONE_DIGIT_RULES: Record<string, { min: number; max: number }> = {
  '+61':  { min: 9, max: 10 },   // Australia: 04xx xxx xxx or 0x xxxx xxxx
  '+64':  { min: 8, max: 10 },   // New Zealand
  '+44':  { min: 10, max: 11 },  // UK
  '+1':   { min: 10, max: 10 },  // US / Canada
  '+91':  { min: 10, max: 10 },  // India
  '+86':  { min: 11, max: 11 },  // China
  '+63':  { min: 10, max: 10 },  // Philippines
};
const DEFAULT_PHONE_RULE = { min: 7, max: 15 };

export function checkPhone(value: string, countryCode: string = '+61', required = true): string | null {
  if (!value.trim()) return required ? 'Please enter a contact number.' : null;
  if (!/^[\d\s()\-.]+$/.test(value.trim())) return 'Use numbers only, for example 0412 345 678.';
  const digits = value.replace(/[\s()+\-.]/g, '');
  const rule = PHONE_DIGIT_RULES[countryCode] || DEFAULT_PHONE_RULE;
  if (digits.length < rule.min || digits.length > rule.max) {
    if (rule.min === rule.max) return `The number should be ${rule.min} digits long.`;
    return `The number should be ${rule.min} to ${rule.max} digits long.`;
  }
  return null;
}

function checkEmail(value: string, required = true): string | null {
  if (!value.trim()) return required ? 'Please enter an email address.' : null;
  if (!EMAIL_RE.test(value.trim())) return 'Please enter a valid email, for example name@example.com.';
  return null;
}

export function checkPostcode(value: string, _country: string): string | null {
  const v = value.trim();
  if (!v) return 'Please enter a postcode.';
  if (!/^\d{4}$/.test(v)) return 'Australian postcodes have 4 digits, for example 5083.';
  return null;
}

function checkMoney(value: string, required: boolean, emptyMessage: string): string | null {
  const v = value.trim();
  if (!v) return required ? emptyMessage : null;
  if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0) return 'Please enter the amount as a number, for example 650000.';
  return null;
}

function checkDate(value: string, min: string, max: string, labels: { empty: string; tooEarly: string; tooLate: string }): string | null {
  if (!value) return labels.empty || null;
  if (!isRealIsoDate(value)) return 'Please choose a valid date from the calendar.';
  if (value < min) return labels.tooEarly;
  if (value > max) return labels.tooLate;
  return null;
}

function set(errors: FieldErrors, key: string, message: string | null) {
  if (message) errors[key] = message;
}

const choose = (value: string, message: string) => (value ? null : message);

// ─── Step-level validators ───────────────────────────────────────────────────
export function validatePartyDetails(p: PartyFormData): FieldErrors {
  const e: FieldErrors = {};
  set(e, 'firstName', p.firstName.trim() ? null : 'Please enter the first name.');
  set(e, 'lastName', p.lastName.trim() ? null : 'Please enter the last name (surname).');
  set(e, 'mobile', checkPhone(p.mobile, p.phoneCountryCode || '+61'));
  set(e, 'email', checkEmail(p.email));
  set(e, 'dob', checkDate(p.dob, DOB_MIN, dobMax(), {
    empty: 'Please choose the date of birth.',
    tooEarly: 'Please check the year — it looks too early.',
    tooLate: 'This person must be at least 18 years old.'
  }));
  set(e, 'residencyStatus', p.residencyStatus ? null : 'Please choose a residency status.');
  set(e, 'occupation', p.occupation?.trim() ? null : 'Please enter the occupation (for example Nurse, Retired or Student).');
  return e;
}

export function validatePartyAddress(p: PartyFormData): FieldErrors {
  const e: FieldErrors = {};
  set(e, 'addressLine1', p.addressLine1.trim() ? null : 'Please enter the street address.');
  set(e, 'suburb', p.suburb.trim() ? null : 'Please enter the suburb, town or city.');
  set(e, 'country', p.country ? null : 'Please choose a country.');
  set(e, 'state', p.state.trim() ? null : 'Please choose or enter the state.');
  set(e, 'postcode', checkPostcode(p.postcode, p.country));
  return e;
}

export function validateProperty(data: ClientIntakeFormData): FieldErrors {
  const e: FieldErrors = {};
  const { property, finance, role } = data;
  const isPurchaser = role === 'Purchaser';

  set(e, 'property.addressLine1', property.addressLine1.trim() ? null : 'Please enter the property street address.');
  set(e, 'property.suburb', property.suburb.trim() ? null : 'Please enter the property suburb.');
  set(e, 'property.postcode', checkPostcode(property.postcode, 'Australia'));
  set(e, 'property.purchasePrice', checkMoney(property.purchasePrice, isPurchaser, 'Please enter the purchase price.'));
  set(e, 'property.settlementDate', checkDate(property.settlementDate, settlementMin(), settlementMax(), {
    empty: '',
    tooEarly: 'The settlement date cannot be in the past.',
    tooLate: 'The settlement date must be within the next 3 years.'
  }));

  if (isPurchaser) {
    set(e, 'property.intendedUse', choose(property.intendedUse, 'Please choose what the property is for.'));
    set(e, 'property.ownershipType', choose(property.ownershipType, 'Please choose how you would like to own the property.'));
  }

  set(e, 'finance.mortgageRequired', choose(finance.mortgageRequired, isPurchaser ? 'Please answer: are you taking a mortgage?' : 'Please answer: is there a mortgage on the property?'));
  if (isPurchaser) {
    set(e, 'finance.brokerPhone', checkPhone(finance.brokerPhone, '+61', false));
    set(e, 'finance.brokerEmail', checkEmail(finance.brokerEmail, false));
  }
  if (isPurchaser) {
    const anyMethod = finance.paysByElectronicTransfer || finance.paysByCash || finance.paysByVirtualAssets || finance.paysByOther;
    if (!anyMethod) e['finance.paysByElectronicTransfer'] = 'Please choose at least one way you will pay.';
    if (finance.paysByCash) set(e, 'finance.cashAmount', checkMoney(finance.cashAmount, true, 'Please enter how much will be paid in cash.'));
    if (finance.paysByVirtualAssets) set(e, 'finance.virtualAssetsAmount', checkMoney(finance.virtualAssetsAmount, true, 'Please enter how much will be paid in cryptocurrency.'));
    if (finance.paysByOther) set(e, 'finance.otherPaymentDetails', finance.otherPaymentDetails?.trim() ? null : 'Please describe the other way you will pay.');
  }
  if (!isPurchaser && finance.mortgageRequired === 'Yes') {
    set(e, 'finance.lenderName', finance.lenderName.trim() ? null : 'Please enter the bank name.');
  }
  return e;
}

// ─── Stamp duty relief: each question only appears after certain answers ─────
export const RELIEF_PROPERTY_TYPES = ['Vacant Land', 'Brand New Home', 'Established Home With Substantial Renovation'];

export function stampDutyVisibility(sd: StampDutyFormData) {
  const firstHomeBuyer = sd.reliefEligible === 'Yes' || sd.reliefEligible === 'Not Sure';
  const propertyType = firstHomeBuyer && sd.firstHomeBuyer === 'Yes';
  const signedAfter = propertyType && RELIEF_PROPERTY_TYPES.includes(sd.propertyType);
  const signedBetween = signedAfter && sd.contractSignedOnOrAfter6Jul2024 === 'No';
  const threshold = signedBetween && sd.contractSignedBetween15Jun2023And5Jul2024 === 'Yes';
  const criteria = (threshold && sd.underPriceThreshold === 'Yes') || (signedAfter && sd.contractSignedOnOrAfter6Jul2024 === 'Yes');
  return { firstHomeBuyer, propertyType, signedAfter, signedBetween, threshold, criteria, notes: firstHomeBuyer };
}

/** Blanks answers to questions that are no longer shown, so stale answers are never submitted. */
export function clearHiddenStampDutyAnswers(sd: StampDutyFormData): StampDutyFormData {
  const v = stampDutyVisibility(sd);
  const next = { ...sd };
  if (!v.firstHomeBuyer) next.firstHomeBuyer = '';
  if (!v.propertyType) next.propertyType = '';
  if (!v.signedAfter) next.contractSignedOnOrAfter6Jul2024 = '';
  if (!v.signedBetween) next.contractSignedBetween15Jun2023And5Jul2024 = '';
  if (!v.threshold) next.underPriceThreshold = '';
  if (!v.criteria) next.meetsEligibilityCriteria = '';
  if (!v.notes) next.notes = '';
  // A cleared answer can hide further questions, so repeat until nothing changes
  return JSON.stringify(next) === JSON.stringify(sd) ? next : clearHiddenStampDutyAnswers(next);
}

export function validateStampDuty(sd: StampDutyFormData): FieldErrors {
  const e: FieldErrors = {};
  const v = stampDutyVisibility(sd);
  set(e, 'stampDuty.reliefEligible', choose(sd.reliefEligible, 'Please answer: are you eligible for stamp duty relief?'));
  if (v.firstHomeBuyer) set(e, 'stampDuty.firstHomeBuyer', choose(sd.firstHomeBuyer, 'Please answer: are you a first home buyer?'));
  if (v.propertyType) set(e, 'stampDuty.propertyType', choose(sd.propertyType, 'Please choose what type of property it is.'));
  if (v.signedAfter) set(e, 'stampDuty.contractSignedOnOrAfter6Jul2024', choose(sd.contractSignedOnOrAfter6Jul2024, 'Please answer: was the contract signed on or after 6 July 2024?'));
  if (v.signedBetween) set(e, 'stampDuty.contractSignedBetween15Jun2023And5Jul2024', choose(sd.contractSignedBetween15Jun2023And5Jul2024, 'Please answer: was the contract signed between 15 June 2023 and 5 July 2024?'));
  if (v.threshold) set(e, 'stampDuty.underPriceThreshold', choose(sd.underPriceThreshold, 'Please answer the price question.'));
  if (v.criteria) set(e, 'stampDuty.meetsEligibilityCriteria', choose(sd.meetsEligibilityCriteria, 'Please answer: do you meet the eligibility criteria?'));
  return e;
}

export function validateDeclaration(data: ClientIntakeFormData): FieldErrors {
  const e: FieldErrors = {};
  const d = data.declaration;
  if (data.role === 'Purchaser' && !d.coolingOffAcknowledged) {
    e['declaration.coolingOffAcknowledged'] = 'Please tick this box to confirm you understand your cooling-off rights.';
  }
  if (!d.authorityToAct) e['declaration.authorityToAct'] = 'Please tick this box so we can act as your conveyancer.';
  set(e, 'declaration.signedName', d.signedName.trim() ? null : 'Please type your full name.');
  set(e, 'declaration.signedDate', checkDate(d.signedDate, signedDateMin(), todayIso(), {
    empty: 'Please choose today\'s date.',
    tooEarly: 'Please use today\'s date.',
    tooLate: 'The date cannot be in the future.'
  }));
  if (!d.signatureDataUrl) e['declaration.signatureDataUrl'] = 'Please draw your signature.';
  return e;
}

export function isPartyDetailsComplete(p: PartyFormData): boolean {
  return Object.keys(validatePartyDetails(p)).length === 0;
}
