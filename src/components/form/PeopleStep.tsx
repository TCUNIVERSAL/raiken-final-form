import React from 'react';
import { ClientIntakeFormData, PartyFormData, UploadedDocument } from '../../types/index.js';
import { DOB_MIN, dobMax } from '../../utils/validation.js';
import { Address, MAX_PARTIES, formatAddress, pickAddress } from './formState.js';
import { CheckboxCard, DateField, SelectField, Suggestions, TextField } from './fields.js';
import { PhoneField } from './PhoneField.js';
import { FileUpload } from './FileUpload.js';
import { AddressFields } from './AddressFields.js';

interface PeopleStepProps {
  formData: ClientIntakeFormData;
  partyIndex: number;
  errors: Record<string, string>;
  live: Record<string, string>;
  onSelectParty: (index: number) => void;
  onUpdateParty: (index: number, field: keyof PartyFormData, value: string) => void;
  onSetPartyCount: (count: number) => void;
  onAddParty: () => void;
  onRemoveParty: (index: number) => void;
  onAddDocument: (partyId: string, doc: UploadedDocument) => void;
  onRemoveDocument: (partyId: string, docId: string) => void;
  onUploadingChange: (uploading: boolean) => void;
  onAddressChange: (index: number, patch: Partial<Address>) => void;
  onSameAsAbove: (index: number, checked: boolean) => void;
}

export const RESIDENCY_OPTIONS = [
  { value: 'Australian Citizen', label: 'Australian citizen', description: 'I am an Australian citizen.' },
  { value: 'Permanent Resident', label: 'Permanent resident', description: 'I hold an Australian permanent visa.' },
  { value: 'Temporary Resident', label: 'Temporary resident', description: 'I am in Australia on a temporary visa.' }
];

const OCCUPATION_SUGGESTIONS = ['Retired', 'Student', 'Self-employed', 'Business owner', 'Home duties', 'Not currently working'];

export function partyDisplayName(p: PartyFormData): string {
  return [p.firstName, p.lastName].filter(s => s.trim()).join(' ');
}

/** Renders address fields with a clear option to reuse the previous person's address. */
const AddressSection: React.FC<{
  party: PartyFormData;
  index: number;
  role: string;
  previousParty: PartyFormData | undefined;
  errors: Record<string, string>;
  live: Record<string, string>;
  onAddressChange: (patch: Partial<Address>) => void;
  onSameAsAbove: (checked: boolean) => void;
}> = ({ party, index, previousParty, role, errors, live, onAddressChange, onSameAsAbove }) => {

  const previousName = previousParty && (partyDisplayName(previousParty) || `${role.toLowerCase()} ${index}`);

  return (
    <div className="rk-address-section">
      <h3 className="rk-person-section-head">Current address</h3>
      {previousParty && (
        <CheckboxCard
          id={`${party.id}-addr-choice`}
          checked={party.sameAddressAsPrevious}
          onChange={onSameAsAbove}
        >
          Use {previousName}'s address
        </CheckboxCard>
      )}
      {previousParty && party.sameAddressAsPrevious ? (
        <div className="rk-address-copied">
          <p className="rk-hint">Address shared with {previousName}</p>
          <p>{formatAddress(pickAddress(party)) || 'Add the address to the previous person’s details.'}</p>
        </div>
      ) : (
        <AddressFields
          idPrefix={`${party.id}-addr`}
          address={pickAddress(party)}
          errors={errors}
          live={live}
          onChange={onAddressChange}
        />
      )}
    </div>
  );
};

/** Renders a single person's complete form (details + address). */
const PersonForm: React.FC<{
  party: PartyFormData;
  index: number;
  role: string;
  errors: Record<string, string>;
  live: Record<string, string>;
  previousParty: PartyFormData | undefined;
  onUpdate: (field: keyof PartyFormData, value: string) => void;
  onAddDocument: (doc: UploadedDocument) => void;
  onRemoveDocument: (docId: string) => void;
  onUploadingChange: (uploading: boolean) => void;
  onAddressChange: (patch: Partial<Address>) => void;
  onSameAsAbove: (checked: boolean) => void;
}> = ({
  party, index, role, errors, live,
  previousParty, onUpdate, onAddDocument, onRemoveDocument, onUploadingChange,
  onAddressChange, onSameAsAbove
}) => {
  const id = (field: string) => `${party.id}-${field}`;
  const ok = (field: keyof PartyFormData) => Boolean(String(party[field]).trim()) && !live[id(field)];

  return (
    <div className="rk-person-card" aria-labelledby={`${party.id}-title`}>
      {/* Separator line between people */}
      {index > 0 && <hr className="rk-person-divider" />}

      {/* Heading */}
      <h2 id={`${party.id}-title`} className="rk-person-heading" tabIndex={-1}>
        {partyDisplayName(party) || `${role} ${index + 1}`}
      </h2>

      <h3 className="rk-person-section-head">Personal details</h3>

      {/* ─── Name row: 3 columns ─── */}
      <div className="rk-name-row">
        <TextField id={id('firstName')} label="First name" required placeholder="e.g. Alex" autoComplete="given-name"
          value={party.firstName} error={errors[id('firstName')]} valid={ok('firstName')} onChange={v => onUpdate('firstName', v)} />
        <TextField id={id('middleName')} label="Middle name" placeholder="If applicable" autoComplete="additional-name"
          value={party.middleName} valid={ok('middleName')} onChange={v => onUpdate('middleName', v)} />
        <TextField id={id('lastName')} label="Last name" required placeholder="e.g. Taylor" autoComplete="family-name"
          value={party.lastName} error={errors[id('lastName')]} valid={ok('lastName')} onChange={v => onUpdate('lastName', v)} />
      </div>

      {/* ─── Phone + Email row ─── */}
      <div className="rk-contact-row">
        <PhoneField id={id('mobile')} label="Phone number" required
          countryCode={party.phoneCountryCode || '+61'}
          phoneNumber={party.mobile}
          onCountryCodeChange={v => onUpdate('phoneCountryCode', v)}
          onPhoneChange={v => onUpdate('mobile', v)}
          error={errors[id('mobile')]} valid={ok('mobile')} />
        <TextField id={id('email')} type="email" inputMode="email" label="Email address" required
          placeholder="e.g. alex@example.com" autoComplete="email"
          value={party.email} error={errors[id('email')]} valid={ok('email')} onChange={v => onUpdate('email', v)} />
      </div>

      {/* ─── DOB ─── */}
      <div className="rk-dob-row">
        <DateField
          id={id('dob')}
          label="Date of birth"
          required
          min={DOB_MIN}
          max={dobMax()}
          autoComplete="bday"
          value={party.dob}
          error={errors[id('dob')]}
          valid={ok('dob')}
          onChange={v => onUpdate('dob', v)}
        />
      </div>

      <TextField id={id('occupation')} label="Occupation" required placeholder="e.g. Nurse" autoComplete="organization-title"
        value={party.occupation} error={errors[id('occupation')]} valid={ok('occupation')} onChange={v => onUpdate('occupation', v)} />
      <Suggestions items={OCCUPATION_SUGGESTIONS} current={party.occupation} onPick={v => onUpdate('occupation', v)} />

      {/* ─── Address ─── */}
      <AddressSection
        party={party}
        index={index}
        role={role}
        previousParty={previousParty}
        errors={errors}
        live={live}
        onAddressChange={onAddressChange}
        onSameAsAbove={onSameAsAbove}
      />

      {/* ─── Residency + ID ─── */}
      <h3 className="rk-person-section-head">Residency and identity</h3>
      <p className="rk-person-intro">Photo ID is optional at this stage.</p>
      <div className="rk-extras-row">
        <SelectField
          id={id('residencyStatus')}
          label="Residency status"
          required
          placeholder="Select your status"
          options={RESIDENCY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          value={party.residencyStatus}
          error={errors[id('residencyStatus')]}
          valid={Boolean(party.residencyStatus) && !live[id('residencyStatus')]}
          onChange={v => onUpdate('residencyStatus', v)}
        />
        <FileUpload
          id={id('idDocuments')}
          label="Identity documents"
          hint="Driver’s licence, passport or photo card."
          kind="identity"
          partyId={party.id}
          value={party.idDocuments}
          onAdd={onAddDocument}
          onRemove={onRemoveDocument}
          onUploadingChange={onUploadingChange}
        />
      </div>

    </div>
  );
};

export const PeopleStep: React.FC<PeopleStepProps> = ({
  formData, partyIndex, errors, live, onSelectParty, onUpdateParty, onSetPartyCount,
  onAddDocument, onRemoveDocument, onUploadingChange,
  onAddressChange, onSameAsAbove
}) => {
  const role = formData.role;
  const total = formData.parties.length;
  const initialSelectedPartyId = React.useRef(partyIndex > 0 ? formData.parties[partyIndex]?.id : undefined);

  React.useEffect(() => {
    const partyId = initialSelectedPartyId.current;
    if (!partyId) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById(`${partyId}-title`);
      heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
      heading?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="rk-panel rk-people-panel">
      {/* ─── Number selector ─── */}
      <div className="rk-count-selector">
        <label htmlFor="partyCount" className="rk-count-label">
          How many {role.toLowerCase()}s are involved? <span className="rk-req" aria-hidden="true">*</span>
        </label>
        <div className="rk-box rk-count-box">
          <select
            id="partyCount"
            className="rk-box-input rk-select rk-count-select"
            value={String(total)}
            aria-required="true"
            aria-label={`Number of ${role.toLowerCase()}s`}
            onChange={e => onSetPartyCount(Number(e.target.value))}
          >
            {Array.from({ length: MAX_PARTIES }, (_, i) => {
              const num = i + 1;
              return (
                <option key={num} value={String(num)}>
                  {num} {num === 1 ? role : `${role}s`}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {total > 1 && (
        <nav className="rk-person-nav" aria-label={`${role} details`}>
          {formData.parties.map((party, i) => (
            <button
              key={party.id}
              type="button"
              className={`rk-person-nav-button${partyIndex === i ? ' rk-person-nav-active' : ''}`}
              aria-current={partyIndex === i ? 'true' : undefined}
              aria-controls={`${party.id}-title`}
              onClick={() => {
                onSelectParty(i);
                const heading = document.getElementById(`${party.id}-title`);
                heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
                heading?.focus({ preventScroll: true });
              }}
            >
              <span className="rk-person-nav-name">{partyDisplayName(party) || `${role} ${i + 1}`}</span>
            </button>
          ))}
        </nav>
      )}

      {/* ─── All people on this page ─── */}
      {formData.parties.map((party, i) => (
        <PersonForm
          key={party.id}
          party={party}
          index={i}
          role={role}
          errors={errors}
          live={live}
          previousParty={formData.parties[i - 1]}
          onUpdate={(field, value) => onUpdateParty(i, field, value)}
          onAddDocument={doc => onAddDocument(party.id, doc)}
          onRemoveDocument={docId => onRemoveDocument(party.id, docId)}
          onUploadingChange={onUploadingChange}
          onAddressChange={patch => onAddressChange(i, patch)}
          onSameAsAbove={checked => onSameAsAbove(i, checked)}
        />
      ))}
    </section>
  );
};
