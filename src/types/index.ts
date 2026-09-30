import { ClientTelemetry } from '../utils/tracker.js';

export type ConveyancingRole = 'Purchaser' | 'Vendor';

export type DocumentKind = 'identity';

export type YesNo = 'Yes' | 'No' | '';

export interface UploadedDocument {
  id: string;
  kind: DocumentKind;
  partyId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
}

export interface PartyFormData {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  email: string;
  mobile: string;
  /** Country dial code, e.g. '+61' for Australia */
  phoneCountryCode: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  /** 'Australian Citizen' | 'Permanent Resident' | 'Temporary Resident' */
  residencyStatus: string;
  /** Used for the LiveSign AML check. */
  occupation: string;
  sameAddressAsPrevious: boolean;
  /** Driver licence / passport / photo card — front and back can be separate files. */
  idDocuments: UploadedDocument[];
}

export interface PropertyFormData {
  addressLine1: string;
  suburb: string;
  state: string;
  postcode: string;
  /** Purchase price for purchasers, sale price for vendors. */
  purchasePrice: string;
  settlementDate: string;
  /** Purchasers only: 'To live in' | 'For investment' */
  intendedUse: string;
  /** Purchasers with 2+ people: 'Joint Tenants' | 'Tenants in Common' | 'Not Sure' */
  ownershipType: string;
}

export interface FinanceFormData {
  /** Purchaser: "Are you taking a mortgage?" (Yes/No/Maybe). Vendor: "Mortgage on the property?" (Yes/No). */
  mortgageRequired: 'Yes' | 'No' | 'Maybe' | '';
  /** Banker / broker contact name (purchaser). */
  brokerOrBankerName: string;
  brokerPhone: string;
  brokerEmail: string;
  /** Bank / broker company name (purchaser) or bank holding the mortgage (vendor). */
  lenderName: string;
  // How the purchase will be paid (purchasers; sent to LiveSign for the AML check)
  paysByElectronicTransfer: boolean;
  paysByCash: boolean;
  cashAmount: string;
  paysByVirtualAssets: boolean;
  virtualAssetsAmount: string;
  paysByOther: boolean;
  otherPaymentDetails: string;
}

export interface StampDutyFormData {
  reliefEligible: 'Yes' | 'No' | 'Not Sure' | '';
  firstHomeBuyer: YesNo;
  /** 'Vacant Land' | 'Brand New Home' | 'Established Home' | 'Established Home With Substantial Renovation' */
  propertyType: string;
  contractSignedOnOrAfter6Jul2024: YesNo;
  contractSignedBetween15Jun2023And5Jul2024: YesNo;
  underPriceThreshold: YesNo;
  meetsEligibilityCriteria: YesNo;
  notes: string;
}

export interface DeclarationFormData {
  coolingOffAcknowledged: boolean;
  authorityToAct: boolean;
  signedName: string;
  signedDate: string;
  /** PNG data-URL of the client's drawn signature. */
  signatureDataUrl: string;
}

export interface ClientIntakeFormData {
  role: ConveyancingRole;
  /** True once the client has actively picked Purchaser or Vendor (role defaults to Purchaser). */
  roleConfirmed: boolean;
  partyCount: number;
  parties: PartyFormData[];
  property: PropertyFormData;
  finance: FinanceFormData;
  stampDuty: StampDutyFormData;
  declaration: DeclarationFormData;
  howDidYouHear: string;
  /** Flattened list of every uploaded document, filled in at submission time. */
  idDocuments: UploadedDocument[];
}

export interface IntakeSubmissionPayload {
  formData: ClientIntakeFormData;
  telemetry: ClientTelemetry;
}

export interface SubmissionResponse {
  success: boolean;
  matterReference: string;
  intakeId?: string;
  emailDispatched: boolean;
  /** Always 'unverified' at submission; changes once LiveSign verifies each person. */
  verificationStatus?: string;
  /** true when the identity check request reached LiveSign during submission. */
  sentToLiveSign?: boolean;
  message: string;
  clientEmail: string;
}
