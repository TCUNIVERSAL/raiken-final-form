import React from 'react';
import { ClientIntakeFormData, DeclarationFormData } from '../../types/index.js';
import { formatDateLong, signedDateMin, stampDutyVisibility, todayIso } from '../../utils/validation.js';
import { CheckboxCard, DateField, TextField, TickIcon } from './fields.js';
import { formatFileSize } from './FileUpload.js';
import { formatAddress, pickAddress, StepKey } from './formState.js';
import { partyDisplayName } from './PeopleStep.js';
import { SignaturePad } from './SignaturePad.js';

export interface ReviewProblem {
  step: StepKey;
  partyIndex?: number;
  message: string;
}

interface ReviewStepProps {
  formData: ClientIntakeFormData;
  problems: ReviewProblem[];
  errors: Record<string, string>;
  live: Record<string, string>;
  onDeclarationChange: (patch: Partial<DeclarationFormData>) => void;
  onEdit: (step: StepKey, partyIndex?: number) => void;
  submitError: string | null;
}

/** Raikan's details for the client to pass on — shown on the review and success pages. */
export const RaikanDetails: React.FC = () => (
  <div className="rk-info-box">
    <p className="rk-question">Please give these details to your real estate agent, mortgage broker or bank:</p>
    <dl className="rk-info-list">
      <div><dt>Company</dt><dd>Raikan Corporation</dd></div>
      <div><dt>Contact</dt><dd>Bhavesh Chaudhari</dd></div>
      <div><dt>Office</dt><dd>08 7076 9899</dd></div>
      <div><dt>Email</dt><dd>conveyancer@rcorpo.com</dd></div>
      <div><dt>Address</dt><dd>Shop 3, 160 Hampstead Road, Broadview SA 5083</dd></div>
    </dl>
  </div>
);

/** Filled-in answer row: "Label: value ✓" */
const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className={`rk-summary-row${value ? '' : ' rk-summary-empty'}`}>
    <dt>{label}:</dt>
    <dd>{value || 'Not provided'}</dd>
    {value && <TickIcon className="rk-tick" />}
  </div>
);

const Section: React.FC<{ title: string; onEdit: () => void; editLabel: string; children: React.ReactNode }> = ({ title, onEdit, editLabel, children }) => (
  <section className="rk-panel">
    <div className="rk-summary-head">
      <h2 className="rk-panel-title">{title}</h2>
      <button type="button" className="rk-link-button" onClick={onEdit} aria-label={editLabel}>Edit</button>
    </div>
    <dl className="rk-summary">{children}</dl>
  </section>
);

export const ReviewStep: React.FC<ReviewStepProps> = ({ formData, problems, errors, live, onDeclarationChange, onEdit, submitError }) => {
  const { role, property, finance, stampDuty, declaration } = formData;
  const isPurchaser = role === 'Purchaser';
  const money = (v: string) => (v ? `$${Number(v).toLocaleString('en-AU')}` : undefined);
  const sd = stampDutyVisibility(stampDuty);
  const propertyAddress = [property.addressLine1, property.suburb, [property.state, property.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <>
      {problems.length > 0 && (
        <div className="rk-error-summary" role="alert">
          <p className="rk-error-summary-title">Some required answers are missing:</p>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <a href="#" onClick={e => { e.preventDefault(); onEdit(p.step, p.partyIndex); }}>{p.message}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitError && (
        <div className="rk-error-summary" role="alert">
          <p className="rk-error-summary-title">The form could not be sent.</p>
          <p>{submitError} Your answers are saved — please try again.</p>
        </div>
      )}

      <p className="rk-lead">Please check your answers. Click <strong>Edit</strong> to change anything.</p>

      {formData.parties.map((p, i) => (
        <Section key={p.id} title={`${role} ${i + 1}`} onEdit={() => onEdit('people', i)} editLabel={`Edit ${role} ${i + 1}`}>
          <Row label="Name" value={[p.firstName, p.middleName, p.lastName].filter(s => s.trim()).join(' ')} />
          <Row label="Phone" value={p.mobile} />
          <Row label="Email" value={p.email} />
          <Row label="Date of birth" value={formatDateLong(p.dob)} />
          <Row label="Residency" value={p.residencyStatus} />
          <Row label="Occupation" value={p.occupation} />
          <Row label="Photo ID" value={p.idDocuments.length ? p.idDocuments.map(d => `${d.fileName} (${formatFileSize(d.sizeBytes)})`).join(', ') : undefined} />
        </Section>
      ))}

      <Section title="Addresses" onEdit={() => onEdit('people')} editLabel="Edit addresses">
        {formData.parties.map((p, i) => (
          <Row
            key={p.id}
            label={partyDisplayName(p) || `${role} ${i + 1}`}
            value={formatAddress(pickAddress(p)) ? `${formatAddress(pickAddress(p))}${p.sameAddressAsPrevious ? ' (same as above)' : ''}` : undefined}
          />
        ))}
      </Section>

      <Section title="Property" onEdit={() => onEdit('property')} editLabel="Edit property details">
        <Row label="Address" value={propertyAddress} />
        <Row label={isPurchaser ? 'Purchase price' : 'Sale price'} value={money(property.purchasePrice)} />
        <Row label="Settlement" value={formatDateLong(property.settlementDate) || 'Not known yet'} />
        {isPurchaser && <Row label="Property is for" value={property.intendedUse} />}
        {isPurchaser && <Row label="Ownership" value={property.ownershipType} />}
        <Row label={isPurchaser ? 'Taking a mortgage' : 'Mortgage on property'} value={finance.mortgageRequired} />
        {isPurchaser && (
          <Row label="Banker / broker" value={[finance.brokerOrBankerName, finance.lenderName, finance.brokerPhone, finance.brokerEmail].filter(Boolean).join(' · ')} />
        )}
        {isPurchaser && <Row label="Paying by" value={[
          finance.paysByElectronicTransfer && 'Bank transfer',
          finance.paysByCash && `Cash (${money(finance.cashAmount) || 'amount not given'})`,
          finance.paysByVirtualAssets && `Cryptocurrency (${money(finance.virtualAssetsAmount) || 'amount not given'})`,
          finance.paysByOther && `Other: ${finance.otherPaymentDetails}`
        ].filter(Boolean).join(', ')} />}
        {!isPurchaser && finance.mortgageRequired === 'Yes' && <Row label="Bank" value={finance.lenderName} />}
        {isPurchaser && <Row label="Heard about us" value={formData.howDidYouHear} />}
      </Section>

      {isPurchaser && (
        <Section title="Stamp duty relief" onEdit={() => onEdit('stampDuty')} editLabel="Edit stamp duty answers">
          <Row label="Eligible for relief" value={stampDuty.reliefEligible} />
          {sd.firstHomeBuyer && <Row label="First home buyer" value={stampDuty.firstHomeBuyer} />}
          {sd.propertyType && <Row label="Property is" value={stampDuty.propertyType} />}
          {sd.signedAfter && <Row label="Signed on/after 6 Jul 2024" value={stampDuty.contractSignedOnOrAfter6Jul2024} />}
          {sd.signedBetween && <Row label="Signed 15 Jun 2023 – 5 Jul 2024" value={stampDuty.contractSignedBetween15Jun2023And5Jul2024} />}
          {sd.threshold && <Row label="Under price limit" value={stampDuty.underPriceThreshold} />}
          {sd.criteria && <Row label="Meets criteria" value={stampDuty.meetsEligibilityCriteria} />}
          {sd.notes && <Row label="Notes" value={stampDuty.notes} />}
        </Section>
      )}

      <section className="rk-panel" aria-labelledby="declaration-title">
        <div className="rk-panel-head">
          <h2 id="declaration-title" className="rk-panel-title">Declaration</h2>
        </div>
        {isPurchaser && (
          <CheckboxCard
            id="declaration-coolingOffAcknowledged"
            required
            checked={declaration.coolingOffAcknowledged}
            error={errors['declaration-coolingOffAcknowledged']}
            onChange={checked => onDeclarationChange({ coolingOffAcknowledged: checked })}
          >
            I/We confirm that we understand our obligations for cooling-off rights.
          </CheckboxCard>
        )}
        <CheckboxCard
          id="declaration-authorityToAct"
          required
          checked={declaration.authorityToAct}
          error={errors['declaration-authorityToAct']}
          description={propertyAddress || 'Property address not entered yet'}
          onChange={checked => onDeclarationChange({ authorityToAct: checked })}
        >
          I/We authorise Raikan Corporation to act as our conveyancer for this property:
        </CheckboxCard>

        <div className="rk-signature-row">
          <SignaturePad
            id="declaration-signatureDataUrl"
            value={declaration.signatureDataUrl}
            error={errors['declaration-signatureDataUrl']}
            onChange={dataUrl => onDeclarationChange({ signatureDataUrl: dataUrl })}
          />
          <div className="rk-signature-details">
            <TextField
              id="declaration-signedName"
              label="Your name"
              required
              placeholder="e.g. John Michael Smith"
              autoComplete="name"
              value={declaration.signedName}
              error={errors['declaration-signedName']}
              valid={Boolean(declaration.signedName.trim()) && !live['declaration-signedName']}
              onChange={v => onDeclarationChange({ signedName: v })}
            />
            <DateField
              id="declaration-signedDate"
              label="Date"
              required
              min={signedDateMin()}
              max={todayIso()}
              value={declaration.signedDate}
              error={errors['declaration-signedDate']}
              valid={Boolean(declaration.signedDate) && !live['declaration-signedDate']}
              onChange={v => onDeclarationChange({ signedDate: v })}
            />
          </div>
        </div>
        <RaikanDetails />
      </section>
    </>
  );
};
