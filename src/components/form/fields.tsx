import React from 'react';
import { formatDateLong } from '../../utils/validation.js';

// ─── Small icons ─────────────────────────────────────────────────────────────
export const TickIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function describedBy(id: string, hint?: string, error?: string) {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

export const LabelText: React.FC<{ label: string; required?: boolean }> = ({ label, required }) => (
  <>
    {label}
    {required ? <span className="rk-req" aria-hidden="true">*</span> : <span className="rk-opt"> (optional)</span>}
  </>
);

export const HelpAndError: React.FC<{ id: string; hint?: string; error?: string }> = ({ id, hint, error }) => (
  <>
    {hint && <p id={`${id}-hint`} className="rk-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="rk-error" role="alert">{error}</p>}
  </>
);

// ─── Inline-label input box ("Name:  e.g. John Smith  ✓") ────────────────────
interface BoxProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  valid?: boolean;
  children: React.ReactNode;
  after?: React.ReactNode;
}

export const InputBox: React.FC<BoxProps> = ({ id, label, required, hint, error, valid, children, after }) => (
  <div className={`rk-field${error ? ' rk-invalid' : ''}`}>
    <div className="rk-box">
      <label htmlFor={id} className="rk-box-label"><LabelText label={label} required={required} /></label>
      {children}
      {valid && !error && <TickIcon className="rk-tick" />}
    </div>
    {after}
    <HelpAndError id={id} hint={hint} error={error} />
  </div>
);

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  valid?: boolean;
  type?: 'text' | 'email' | 'tel';
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  maxLength?: number;
  readOnly?: boolean;
}

export const TextField: React.FC<TextFieldProps> = ({
  id, label, value, onChange, placeholder, required, hint, error, valid, type = 'text', inputMode, autoComplete, maxLength = 120, readOnly
}) => (
  <InputBox id={id} label={label} required={required} hint={hint} error={error} valid={valid}>
    <input
      id={id}
      type={type}
      className="rk-box-input"
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete={autoComplete}
      maxLength={maxLength}
      readOnly={readOnly}
      aria-required={required}
      aria-invalid={Boolean(error)}
      aria-describedby={describedBy(id, hint, error)}
      onChange={e => onChange(e.target.value)}
    />
  </InputBox>
);

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  required?: boolean;
  hint?: string;
  error?: string;
  valid?: boolean;
  autoComplete?: string;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  id, label, value, onChange, options, placeholder, required, hint, error, valid, autoComplete
}) => (
  <InputBox id={id} label={label} required={required} hint={hint} error={error} valid={valid}>
    <select
      id={id}
      className={`rk-box-input rk-select${value ? '' : ' rk-placeholder'}`}
      value={value}
      autoComplete={autoComplete}
      aria-required={required}
      aria-invalid={Boolean(error)}
      aria-describedby={describedBy(id, hint, error)}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </InputBox>
);

interface DateFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
  required?: boolean;
  hint?: string;
  error?: string;
  valid?: boolean;
  autoComplete?: string;
}

/** Native date input (calendar popup in every modern browser) plus the chosen date spelled out. */
export const DateField: React.FC<DateFieldProps> = ({ id, label, value, onChange, min, max, required, hint, error, valid, autoComplete }) => {
  const readable = formatDateLong(value);
  return (
    <InputBox
      id={id}
      label={label}
      required={required}
      hint={hint}
      error={error}
      valid={valid}
      after={readable ? (
        <p className="rk-date-readout" aria-live="polite">
          <strong>{readable}</strong>
        </p>
      ) : undefined}
    >
      <input
        id={id}
        type="date"
        className="rk-box-input rk-date"
        value={value}
        min={min}
        max={max}
        autoComplete={autoComplete}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, hint, error)}
        onChange={e => onChange(e.target.value)}
        // Open the calendar when the box is clicked, not only the small icon
        onClick={e => {
          try {
            (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            // Not supported, or already open — the native control still works
          }
        }}
      />
    </InputBox>
  );
};

// ─── Suggestion chips ────────────────────────────────────────────────────────
export const Suggestions: React.FC<{ items: string[]; current?: string; onPick: (value: string) => void }> = ({ items, current, onPick }) => (
  <div className="rk-suggestions">
    <p className="rk-overline">Suggestions</p>
    <div className="rk-chips">
      {items.map(item => (
        <button
          key={item}
          type="button"
          className={`rk-chip${current === item ? ' rk-chip-active' : ''}`}
          aria-pressed={current === item}
          onClick={() => onPick(item)}
        >
          {item}
        </button>
      ))}
    </div>
  </div>
);

// ─── Choice cards (radio in the corner) ──────────────────────────────────────
export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

interface ChoiceCardsProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ChoiceOption[];
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  columns?: 1 | 2 | 3;
}

export const ChoiceCards: React.FC<ChoiceCardsProps> = ({ id, label, value, onChange, options, required, hint, error, columns = 2 }) => (
  <fieldset
    id={id}
    tabIndex={-1}
    className={`rk-field rk-fieldset${error ? ' rk-invalid' : ''}`}
    aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
  >
    <legend className="rk-question">
      {label}
      {required ? <span className="rk-req" aria-hidden="true">*</span> : <span className="rk-opt"> (optional)</span>}
    </legend>
    {hint && <div id={`${id}-hint`} className="rk-hint rk-question-hint">{hint}</div>}
    <div className={`rk-cards rk-cols-${columns}`}>
      {options.map(o => (
        <label key={o.value} className={`rk-card-choice${value === o.value ? ' rk-card-selected' : ''}`}>
          <input
            type="radio"
            name={id}
            value={o.value}
            checked={value === o.value}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
            onChange={() => onChange(o.value)}
          />
          <span className="rk-card-title">{o.label}</span>
          {o.description && <span className="rk-card-desc">{o.description}</span>}
        </label>
      ))}
    </div>
    {error && <p id={`${id}-error`} className="rk-error" role="alert">{error}</p>}
  </fieldset>
);

// ─── Checkbox card (for "Same as above" and declarations) ────────────────────
interface CheckboxCardProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  description?: React.ReactNode;
  required?: boolean;
  error?: string;
}

export const CheckboxCard: React.FC<CheckboxCardProps> = ({ id, checked, onChange, children, description, required, error }) => (
  <div className={`rk-field${error ? ' rk-invalid' : ''}`}>
    <label htmlFor={id} className={`rk-check-card${checked ? ' rk-card-selected' : ''}`}>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-invalid={Boolean(error)} aria-required={required} aria-describedby={[description ? `${id}-description` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} />
      <span>
        <span className="rk-card-title">
          {children}
          {required && <span className="rk-req" aria-hidden="true">*</span>}
        </span>
        {description && <span id={`${id}-description`} className="rk-card-desc">{description}</span>}
      </span>
    </label>
    {error && <p id={`${id}-error`} className="rk-error" role="alert">{error}</p>}
  </div>
);

// ─── Horizontal stepper ──────────────────────────────────────────────────────
export const Stepper: React.FC<{ steps: string[]; current: number; allDone?: boolean; onStepClick?: (index: number) => void }> = ({ steps, current, allDone, onStepClick }) => (
  <nav aria-label="Form progress" className="rk-stepper-nav">
    <div className="rk-progress-heading"><span>Your progress</span><strong>{allDone ? 'Complete' : `${current + 1} of ${steps.length}`}</strong></div>
    <ol className="rk-stepper">
      {steps.map((title, i) => {
        const done = allDone || i < current;
        const isCurrent = !allDone && i === current;
        return (
          <li
            key={title}
            className={`rk-step${done ? ' rk-step-done' : ''}${isCurrent ? ' rk-step-current' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`${title}: ${done ? 'completed' : isCurrent ? 'current step' : 'upcoming'}`}
          >
            {onStepClick && i < current && !allDone ? (
              <button type="button" className="rk-step-button" onClick={() => onStepClick(i)} aria-label={`Go back to ${title}`}>
                <span className="rk-step-dot"><TickIcon /></span><span className="rk-step-label">{title}<small>Completed · edit</small></span>
              </button>
            ) : (
              <><span className="rk-step-dot">{done ? <TickIcon /> : i + 1}</span><span className="rk-step-label">{title}<small>{done ? 'Completed' : isCurrent ? 'You are here' : 'Coming up'}</small></span></>
            )}
          </li>
        );
      })}
    </ol>
    {!allDone && (
      <p className="rk-step-mobile">Step {current + 1} of {steps.length}: <strong>{steps[current]}</strong></p>
    )}
    <div className="rk-journey-track" aria-hidden="true"><span style={{ width: `${allDone ? 100 : current / (steps.length - 1) * 100}%` }} /></div>
  </nav>
);

// ─── Error summary ───────────────────────────────────────────────────────────
export const ErrorSummary: React.FC<{ errors: Record<string, string> }> = ({ errors }) => {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="rk-error-summary" role="alert" id="rk-error-summary">
      <p className="rk-error-summary-title">
        Please fix {entries.length === 1 ? 'this 1 thing' : `these ${entries.length} things`} before continuing:
      </p>
      <ul>
        {entries.map(([fieldId, message]) => (
          <li key={fieldId}>
            <a
              href={`#${fieldId}`}
              onClick={e => {
                e.preventDefault();
                const el = document.getElementById(fieldId);
                el?.scrollIntoView({ block: 'center' });
                el?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
