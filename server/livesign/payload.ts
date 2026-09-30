/**
 * Maps a submitted intake to LiveSign's ExpressCreateEnvelopeViewModel
 * (POST /api/Envelopes/express). Pure — no I/O — so it is easy to test.
 *
 * One envelope per intake, one customer per person on the form. Every customer gets
 * a full VOI plus PEP/sanctions screening, and the envelope carries the AML details.
 */

export const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** LiveSign's id for Australia in /api/Utilities/country-codes. */
export const AUSTRALIA_COUNTRY_CODE_ID = 13;

export interface CountryPhoneCode {
  id: number;
  phoneCode?: string;
  countryCode?: string;
}

export interface EnvelopeOptions {
  partnerId: string;
  productPackageType: string;
  voiProductId: number | null;
  timeZone: string;
  webhookUrl?: string;
  countryCodes: CountryPhoneCode[];
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const text = (v: unknown) => String(v ?? '').trim();
const money = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9_999_999_999.99) : 0;
};

/**
 * Splits a phone number into LiveSign's country code id + national number
 * (pattern ^[1-9](\d *?){3,11}$ — no leading 0, no country prefix).
 * "0412 345 678" → AU / 412345678,  "+91 98765 43210" → India / 9876543210.
 */
export function splitMobile(raw: unknown, codes: CountryPhoneCode[]): { countryCodeId: number; mobileNumber: string } {
  const s = text(raw).replace(/[\s()\-.]/g, '');
  const international = s.startsWith('+') ? digits(s) : s.startsWith('00') ? digits(s).slice(2) : '';
  const auId = codes.find(c => digits(c.phoneCode) === '61')?.id ?? AUSTRALIA_COUNTRY_CODE_ID;

  if (international) {
    // Longest dialling prefix wins (e.g. +1 868 before +1)
    const match = codes
      .filter(c => digits(c.phoneCode) && international.startsWith(digits(c.phoneCode)))
      .sort((a, b) => digits(b.phoneCode).length - digits(a.phoneCode).length)[0];
    if (match) {
      return { countryCodeId: match.id, mobileNumber: international.slice(digits(match.phoneCode).length).replace(/^0+/, '') };
    }
    if (international.startsWith('61')) return { countryCodeId: auId, mobileNumber: international.slice(2).replace(/^0+/, '') };
  }
  return { countryCodeId: auId, mobileNumber: digits(s).replace(/^0+/, '') };
}

export function formatPersonAddress(p: any): string {
  return [p.addressLine2, p.addressLine1, p.suburb, [p.state, p.postcode].filter(Boolean).join(' '), p.country]
    .map(text).filter(Boolean).join(', ');
}

export function formatPropertyAddress(property: any): string {
  return [property?.addressLine1, property?.suburb, [property?.state, property?.postcode].filter(Boolean).join(' ')]
    .map(text).filter(Boolean).join(', ');
}

export function buildEnvelopePayload(intake: { matterReference: string; role: string; parties: any[]; property: any; finance: any }, opts: EnvelopeOptions) {
  const isPurchase = intake.role !== 'Vendor';
  const finance = intake.finance || {};
  const propertyAddress = formatPropertyAddress(intake.property);
  const usingALender = isPurchase && (finance.mortgageRequired === 'Yes' || finance.mortgageRequired === 'Maybe');

  // How the purchase is paid (purchasers answer this; for a sale nothing is being paid by the client)
  const cash = isPurchase && Boolean(finance.paysByCash);
  const virtual = isPurchase && Boolean(finance.paysByVirtualAssets);
  const other = isPurchase && Boolean(finance.paysByOther) && Boolean(text(finance.otherPaymentDetails));

  const envelope: Record<string, any> = {
    partnerId: opts.partnerId || ZERO_GUID,
    partnerReference: intake.matterReference,
    name: `${isPurchase ? 'Purchase' : 'Sale'}: ${propertyAddress || 'Property'} (${intake.matterReference})`.slice(0, 200),
    description: `Client intake ${intake.matterReference} — identity verification and AML check`,
    liveSignVerifyProductId: opts.voiProductId ?? undefined,
    payMethod: 'AccountHolderPays',
    notificationType: 'Email',
    webhookCallback: opts.webhookUrl,
    timeZone: opts.timeZone,
    productPackageType: opts.productPackageType,
    useSigningOrder: false,
    hasAml: true,
    aml: {
      transactionType: isPurchase ? 'Purchase' : 'Sale',
      propertyValue: money(intake.property?.purchasePrice) || undefined,
      properties: propertyAddress ? [propertyAddress] : undefined,
      usingALender,
      lenderName: usingALender && text(finance.lenderName) ? text(finance.lenderName) : undefined,
      isElectronicTransfer: isPurchase ? Boolean(finance.paysByElectronicTransfer) : undefined,
      isPhysicalCurrency: cash,
      physicalCurrencyAmount: cash ? money(finance.cashAmount) : 0,
      isVirtualAssets: virtual,
      virtualAssetsAmount: virtual ? money(finance.virtualAssetsAmount) : 0,
      isOtherFundingMeans: other,
      otherFundingMeansOfPayment: other ? text(finance.otherPaymentDetails).slice(0, 500) : 'None'
    }
  };

  const customers = (intake.parties || []).map((p: any, i: number) => {
    const firstName = text(p.firstName);
    const lastName = text(p.lastName);
    const rawPhone = p.phoneCountryCode ? `${text(p.phoneCountryCode)}${text(p.mobile)}` : text(p.mobile);
    const { countryCodeId, mobileNumber } = splitMobile(rawPhone, opts.countryCodes);
    return {
      index: i + 1,
      requiresPep: true,
      organisationName: `${firstName} ${lastName}`.trim() || 'Individual',
      firstName,
      middleName: text(p.middleName) || undefined,
      lastName,
      dob: /^\d{4}-\d{2}-\d{2}$/.test(text(p.dob)) ? `${text(p.dob)}T00:00:00Z` : undefined,
      emailAddress: text(p.email) || undefined,
      countryCodeId,
      mobileNumber,
      address: formatPersonAddress(p) || undefined,
      aml: { occupation: text(p.occupation) || undefined, isSigningAsSelf: true }
    };
  });

  return removeUndefined({ envelope, customers });
}

/** Problems LiveSign would reject, caught before sending. */
export function validateEnvelopePayload(payload: any): string[] {
  const problems: string[] = [];
  if (!payload?.customers?.length) problems.push('At least one person is required.');
  payload?.customers?.forEach((c: any, i: number) => {
    const who = `Person ${i + 1}`;
    if (!c.firstName || !c.lastName) problems.push(`${who}: full name is required.`);
    if (!c.emailAddress) problems.push(`${who}: email is required (LiveSign sends the link by email).`);
    if (!/^[1-9](\d *?){3,11}$/.test(c.mobileNumber || '')) problems.push(`${who}: mobile number "${c.mobileNumber || ''}" is not valid for LiveSign.`);
    if (!c.dob) problems.push(`${who}: date of birth is required for the PEP check.`);
  });
  return problems;
}

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, removeUndefined(v)])
    ) as T;
  }
  return value;
}
