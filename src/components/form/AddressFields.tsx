import React from 'react';
import { AU_STATES, COUNTRIES } from '../../utils/validation.js';
import { Address } from './formState.js';
import { SelectField, TextField } from './fields.js';

interface AddressFieldsProps {
  idPrefix: string;
  address: Address;
  errors: Record<string, string>;
  live: Record<string, string>;
  onChange: (patch: Partial<Address>) => void;
}

const POSTCODE_LABEL = { label: 'Postcode', placeholder: 'e.g. 5083' };

export const AddressFields: React.FC<AddressFieldsProps> = ({ idPrefix, address, errors, live, onChange }) => {
  const id = (key: string) => `${idPrefix}-${key}`;
  const ok = (key: string, value: string) => Boolean(value.trim()) && !live[id(key)];
  const isAustralia = address.country === 'Australia';
  const postcode = POSTCODE_LABEL;

  return (
    <>
      <SelectField
        id={id('country')}
        label="Country"
        required
        placeholder="Choose a country"
        autoComplete="country-name"
        options={COUNTRIES.map(c => ({ value: c, label: c }))}
        value={address.country}
        error={errors[id('country')]}
        valid={ok('country', address.country)}
        // The state list differs by country, so reset it when the country changes
        onChange={v => onChange({ country: v, state: '' })}
      />
      <TextField
        id={id('addressLine1')}
        label="Street address"
        required
        placeholder="e.g. 160 Hampstead Road"
        autoComplete="address-line1"
        value={address.addressLine1}
        error={errors[id('addressLine1')]}
        valid={ok('addressLine1', address.addressLine1)}
        onChange={v => onChange({ addressLine1: v })}
      />
      <TextField
        id={id('addressLine2')}
        label="Unit / apartment"
        placeholder="e.g. Unit 3"
        autoComplete="address-line2"
        value={address.addressLine2}
        valid={Boolean(address.addressLine2.trim())}
        onChange={v => onChange({ addressLine2: v })}
      />
      <TextField
        id={id('suburb')}
        label={isAustralia ? 'Suburb / town' : 'City / town'}
        required
        placeholder={isAustralia ? 'e.g. Broadview' : 'e.g. Bengaluru'}
        autoComplete="address-level2"
        value={address.suburb}
        error={errors[id('suburb')]}
        valid={ok('suburb', address.suburb)}
        onChange={v => onChange({ suburb: v })}
      />
      <div className="rk-row">
        {isAustralia ? (
          <SelectField
            id={id('state')}
            label="State / territory"
            required
            placeholder="Choose"
            autoComplete="address-level1"
            options={AU_STATES.map(s => ({ value: s, label: s }))}
            value={address.state}
            error={errors[id('state')]}
            valid={ok('state', address.state)}
            onChange={v => onChange({ state: v })}
          />
        ) : (
          <TextField
            id={id('state')}
            label="State / region"
            required
            placeholder="e.g. Karnataka"
            autoComplete="address-level1"
            value={address.state}
            error={errors[id('state')]}
            valid={ok('state', address.state)}
            onChange={v => onChange({ state: v })}
          />
        )}
        <TextField
          id={id('postcode')}
          label={postcode.label}
          required
          placeholder={postcode.placeholder}
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={4}
          value={address.postcode}
          error={errors[id('postcode')]}
          valid={ok('postcode', address.postcode)}
          onChange={v => onChange({ postcode: v.replace(/\D/g, '').slice(0, 4) })}
        />
      </div>
    </>
  );
};
