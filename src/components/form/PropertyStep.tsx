import React from 'react';
import { ClientIntakeFormData, FinanceFormData, PropertyFormData } from '../../types/index.js';
import { settlementMax, settlementMin } from '../../utils/validation.js';
import { CheckboxCard, ChoiceCards, DateField, Suggestions, TextField } from './fields.js';

interface PropertyStepProps {
  formData: ClientIntakeFormData;
  errors: Record<string, string>;
  live: Record<string, string>;
  onPropertyChange: (patch: Partial<PropertyFormData>) => void;
  onFinanceChange: (patch: Partial<FinanceFormData>) => void;
  onHowDidYouHearChange: (value: string) => void;
}

const BANKS = ['Commonwealth Bank', 'Westpac', 'ANZ', 'NAB', 'BankSA', "People's Choice"];
const HEARD_FROM = ['Google search', 'Facebook', 'Friend or family', 'Real estate agent', 'Mortgage broker', 'I am a returning client'];

export const PropertyStep: React.FC<PropertyStepProps> = ({
  formData, errors, live, onPropertyChange, onFinanceChange, onHowDidYouHearChange
}) => {
  const { property, finance } = formData;
  const isPurchaser = formData.role === 'Purchaser';
  const ok = (id: string, value: string) => Boolean(value.trim()) && !live[id];
  const moneyOnly = (v: string) => v.replace(/[^\d.]/g, '');


  return (
    <>
      <section className="rk-panel" aria-labelledby="property-title">
        <div className="rk-panel-head">
          <h2 id="property-title" className="rk-panel-title">
            {isPurchaser ? 'The property you are buying' : 'The property you are selling'}
          </h2>
        </div>
        <TextField id="property-addressLine1" label="Property address" required placeholder="e.g. 12 King William Street"
          value={property.addressLine1} error={errors['property-addressLine1']} valid={ok('property-addressLine1', property.addressLine1)}
          onChange={v => onPropertyChange({ addressLine1: v })} />
        <TextField id="property-suburb" label="Suburb / town" required placeholder="e.g. Adelaide"
          value={property.suburb} error={errors['property-suburb']} valid={ok('property-suburb', property.suburb)}
          onChange={v => onPropertyChange({ suburb: v })} />
        <div className="rk-row">
          <TextField id="property-state" label="State" required value="SA" readOnly valid
            hint="We handle South Australian properties only." onChange={() => undefined} />
          <TextField id="property-postcode" label="Postcode" required placeholder="e.g. 5000" inputMode="numeric" maxLength={4}
            value={property.postcode} error={errors['property-postcode']} valid={ok('property-postcode', property.postcode)}
            onChange={v => onPropertyChange({ postcode: v.replace(/\D/g, '').slice(0, 4) })} />
        </div>
        <TextField
          id="property-purchasePrice"
          label={isPurchaser ? 'Purchase price (AUD)' : 'Sale price (AUD)'}
          required={isPurchaser}
          hint="Numbers only, without $ or commas."
          placeholder="e.g. 650000"
          inputMode="decimal"
          maxLength={12}
          value={property.purchasePrice}
          error={errors['property-purchasePrice']}
          valid={ok('property-purchasePrice', property.purchasePrice)}
          onChange={v => onPropertyChange({ purchasePrice: moneyOnly(v) })}
        />
        <DateField
          id="property-settlementDate"
          label="Settlement date (if known)"
          hint="Leave this empty if you do not know the date yet."
          min={settlementMin()}
          max={settlementMax()}
          value={property.settlementDate}
          error={errors['property-settlementDate']}
          valid={ok('property-settlementDate', property.settlementDate)}
          onChange={v => onPropertyChange({ settlementDate: v })}
        />

        {isPurchaser && (
          <ChoiceCards
            id="property-intendedUse"
            label="This property is for"
            required
            options={[
              { value: 'To live in', label: 'To live in', description: 'It will be my / our home.' },
              { value: 'For investment', label: 'For investment', description: 'I / we will rent it out or hold it as an investment.' }
            ]}
            value={property.intendedUse}
            error={errors['property-intendedUse']}
            onChange={v => onPropertyChange({ intendedUse: v })}
          />
        )}

        {isPurchaser && (
          <ChoiceCards
            id="property-ownershipType"
            label="We would like to own the property as"
            required
            columns={3}
            options={[
              { value: 'Joint Tenants', label: 'Joint tenants', description: 'You own the whole property together, in equal shares.' },
              { value: 'Tenants in Common', label: 'Tenants in common', description: 'Each person owns a set share, e.g. 60% / 40%.' },
              { value: 'Not Sure', label: 'Not sure', description: 'We will explain the options and help you choose.' }
            ]}
            value={property.ownershipType}
            error={errors['property-ownershipType']}
            onChange={v => onPropertyChange({ ownershipType: v })}
          />
        )}
      </section>

      <section className="rk-panel" aria-labelledby="finance-title">
        <div className="rk-panel-head">
          <h2 id="finance-title" className="rk-panel-title">{isPurchaser ? 'Mortgage and payment' : 'Existing mortgage'}</h2>
        </div>
        <ChoiceCards
          id="finance-mortgageRequired"
          label={isPurchaser ? 'Are you taking a mortgage?' : 'Do you have a mortgage on the property?'}
          required
          columns={3}
          options={isPurchaser
            ? [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: 'Maybe', label: 'Maybe' }]
            : [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
          value={finance.mortgageRequired}
          error={errors['finance-mortgageRequired']}
          onChange={v => onFinanceChange({ mortgageRequired: v as FinanceFormData['mortgageRequired'] })}
        />

        {isPurchaser && (
          <>
            <p className="rk-question">My banker / mortgage broker details are <span className="rk-opt">(optional)</span></p>
            <div className="rk-row">
              <TextField id="finance-brokerOrBankerName" label="Name" placeholder="e.g. Sarah Jenkins"
                value={finance.brokerOrBankerName} valid={ok('finance-brokerOrBankerName', finance.brokerOrBankerName)}
                onChange={v => onFinanceChange({ brokerOrBankerName: v })} />
              <TextField id="finance-brokerPhone" type="tel" inputMode="tel" label="Contact number" placeholder="e.g. 0412 345 678" maxLength={20}
                value={finance.brokerPhone} error={errors['finance-brokerPhone']} valid={ok('finance-brokerPhone', finance.brokerPhone)}
                onChange={v => onFinanceChange({ brokerPhone: v })} />
            </div>
            <div className="rk-row">
              <TextField id="finance-brokerEmail" type="email" inputMode="email" label="E-mail address" placeholder="e.g. sarah@broker.com.au"
                value={finance.brokerEmail} error={errors['finance-brokerEmail']} valid={ok('finance-brokerEmail', finance.brokerEmail)}
                onChange={v => onFinanceChange({ brokerEmail: v })} />
              <TextField id="finance-lenderName" label="Company name" placeholder="e.g. Commonwealth Bank"
                value={finance.lenderName} valid={ok('finance-lenderName', finance.lenderName)}
                onChange={v => onFinanceChange({ lenderName: v })} />
            </div>
            <Suggestions items={BANKS} current={finance.lenderName} onPick={v => onFinanceChange({ lenderName: v })} />
            <TextField id="howDidYouHear" label="How did you hear about us?" placeholder="e.g. Google search"
              value={formData.howDidYouHear} valid={Boolean(formData.howDidYouHear.trim())}
              onChange={onHowDidYouHearChange} />
            <Suggestions items={HEARD_FROM} current={formData.howDidYouHear} onPick={onHowDidYouHearChange} />
          </>
        )}

        {isPurchaser && (
          <fieldset id="finance-paysByElectronicTransfer" tabIndex={-1}
            className={`rk-field rk-fieldset${errors['finance-paysByElectronicTransfer'] ? ' rk-invalid' : ''}`}>
            <legend className="rk-question">How will you pay for this property?<span className="rk-req" aria-hidden="true">*</span></legend>
            <p className="rk-hint rk-question-hint">Tick all that apply. This is required for the anti-money-laundering (AML) check.</p>
            <div className="rk-cards rk-cols-1">
              <CheckboxCard id="finance-pay-transfer" checked={finance.paysByElectronicTransfer}
                description="Including your home loan and money from your bank account."
                onChange={checked => onFinanceChange({ paysByElectronicTransfer: checked })}>
                Bank transfer
              </CheckboxCard>
              <CheckboxCard id="finance-pay-cash" checked={finance.paysByCash}
                onChange={checked => onFinanceChange({ paysByCash: checked, cashAmount: checked ? finance.cashAmount : '' })}>
                Cash
              </CheckboxCard>
              {finance.paysByCash && (
                <TextField id="finance-cashAmount" label="Cash amount (AUD)" required placeholder="e.g. 20000" inputMode="decimal" maxLength={12}
                  value={finance.cashAmount} error={errors['finance-cashAmount']} valid={ok('finance-cashAmount', finance.cashAmount)}
                  onChange={v => onFinanceChange({ cashAmount: moneyOnly(v) })} />
              )}
              <CheckboxCard id="finance-pay-virtual" checked={finance.paysByVirtualAssets}
                onChange={checked => onFinanceChange({ paysByVirtualAssets: checked, virtualAssetsAmount: checked ? finance.virtualAssetsAmount : '' })}>
                Cryptocurrency or other digital assets
              </CheckboxCard>
              {finance.paysByVirtualAssets && (
                <TextField id="finance-virtualAssetsAmount" label="Amount (AUD)" required placeholder="e.g. 50000" inputMode="decimal" maxLength={12}
                  value={finance.virtualAssetsAmount} error={errors['finance-virtualAssetsAmount']} valid={ok('finance-virtualAssetsAmount', finance.virtualAssetsAmount)}
                  onChange={v => onFinanceChange({ virtualAssetsAmount: moneyOnly(v) })} />
              )}
              <CheckboxCard id="finance-pay-other" checked={finance.paysByOther}
                onChange={checked => onFinanceChange({ paysByOther: checked, otherPaymentDetails: checked ? finance.otherPaymentDetails : '' })}>
                Other
              </CheckboxCard>
              {finance.paysByOther && (
                <TextField id="finance-otherPaymentDetails" label="Please describe" required placeholder="e.g. Gift from family" maxLength={300}
                  value={finance.otherPaymentDetails} error={errors['finance-otherPaymentDetails']} valid={ok('finance-otherPaymentDetails', finance.otherPaymentDetails)}
                  onChange={v => onFinanceChange({ otherPaymentDetails: v })} />
              )}
            </div>
            {errors['finance-paysByElectronicTransfer'] && <p className="rk-error" role="alert">{errors['finance-paysByElectronicTransfer']}</p>}
          </fieldset>
        )}

        {!isPurchaser && finance.mortgageRequired === 'Yes' && (
          <>
            <TextField id="finance-lenderName" label="Bank name" required placeholder="e.g. Commonwealth Bank"
              value={finance.lenderName} error={errors['finance-lenderName']} valid={ok('finance-lenderName', finance.lenderName)}
              onChange={v => onFinanceChange({ lenderName: v })} />
            <Suggestions items={BANKS} current={finance.lenderName} onPick={v => onFinanceChange({ lenderName: v })} />
          </>
        )}
      </section>


    </>
  );
};
