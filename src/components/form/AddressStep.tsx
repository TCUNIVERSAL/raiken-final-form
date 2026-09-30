import React from 'react';
import { ClientIntakeFormData } from '../../types/index.js';
import { AddressFields } from './AddressFields.js';
import { CheckboxCard } from './fields.js';
import { Address, pickAddress } from './formState.js';
import { partyDisplayName } from './PeopleStep.js';

interface AddressStepProps {
  formData: ClientIntakeFormData;
  errors: Record<string, string>;
  live: Record<string, string>;
  onAddressChange: (index: number, patch: Partial<Address>) => void;
  onSameAsAbove: (index: number, checked: boolean) => void;
}

export const AddressStep: React.FC<AddressStepProps> = ({ formData, errors, live, onAddressChange, onSameAsAbove }) => {
  const role = formData.role;

  return (
    <>
      {formData.parties.map((p, i) => {
        const name = partyDisplayName(p);
        const previous = formData.parties[i - 1];
        return (
          <section key={p.id} className="rk-panel" aria-labelledby={`${p.id}-addr-title`}>
            <div className="rk-panel-head">
              <p className="rk-overline">{role} {i + 1}</p>
              <h2 id={`${p.id}-addr-title`} className="rk-panel-title">
                Current home address{name ? ` of ${name}` : ''}
              </h2>
            </div>

            {previous && (
              <CheckboxCard
                id={`${p.id}-sameAsAbove`}
                checked={p.sameAddressAsPrevious}
                onChange={checked => onSameAsAbove(i, checked)}
                description={p.sameAddressAsPrevious
                  ? 'Copied. You can still change any part of the address below.'
                  : `Copy the address of ${partyDisplayName(previous) || `${role} ${i}`}.`}
              >
                Same as above
              </CheckboxCard>
            )}

            <AddressFields
              idPrefix={`${p.id}-addr`}
              address={pickAddress(p)}
              errors={errors}
              live={live}
              onChange={patch => onAddressChange(i, patch)}
            />
          </section>
        );
      })}
    </>
  );
};
