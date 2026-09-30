import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpAndError, LabelText, TickIcon } from './fields.js';

/** Country dial codes — most common first, then alphabetical. */
export const COUNTRY_CODES = [
  { code: '+61',  flag: '🇦🇺', label: 'Australia',       short: 'AU' },
  { code: '+64',  flag: '🇳🇿', label: 'New Zealand',     short: 'NZ' },
  { code: '+44',  flag: '🇬🇧', label: 'United Kingdom',  short: 'UK' },
  { code: '+1',   flag: '🇺🇸', label: 'United States',   short: 'US' },
  { code: '+91',  flag: '🇮🇳', label: 'India',           short: 'IN' },
  { code: '+86',  flag: '🇨🇳', label: 'China',           short: 'CN' },
  { code: '+63',  flag: '🇵🇭', label: 'Philippines',     short: 'PH' },
  { code: '+84',  flag: '🇻🇳', label: 'Vietnam',         short: 'VN' },
  { code: '+27',  flag: '🇿🇦', label: 'South Africa',    short: 'ZA' },
  { code: '+92',  flag: '🇵🇰', label: 'Pakistan',        short: 'PK' },
  { code: '+94',  flag: '🇱🇰', label: 'Sri Lanka',       short: 'LK' },
  { code: '+880', flag: '🇧🇩', label: 'Bangladesh',      short: 'BD' },
  { code: '+62',  flag: '🇮🇩', label: 'Indonesia',       short: 'ID' },
  { code: '+60',  flag: '🇲🇾', label: 'Malaysia',        short: 'MY' },
  { code: '+65',  flag: '🇸🇬', label: 'Singapore',       short: 'SG' },
  { code: '+66',  flag: '🇹🇭', label: 'Thailand',        short: 'TH' },
  { code: '+81',  flag: '🇯🇵', label: 'Japan',           short: 'JP' },
  { code: '+82',  flag: '🇰🇷', label: 'South Korea',     short: 'KR' },
  { code: '+49',  flag: '🇩🇪', label: 'Germany',         short: 'DE' },
  { code: '+33',  flag: '🇫🇷', label: 'France',          short: 'FR' },
  { code: '+39',  flag: '🇮🇹', label: 'Italy',           short: 'IT' },
  { code: '+34',  flag: '🇪🇸', label: 'Spain',           short: 'ES' },
  { code: '+353', flag: '🇮🇪', label: 'Ireland',         short: 'IE' },
  { code: '+971', flag: '🇦🇪', label: 'UAE',             short: 'AE' },
  { code: '+966', flag: '🇸🇦', label: 'Saudi Arabia',    short: 'SA' },
  { code: '+852', flag: '🇭🇰', label: 'Hong Kong',       short: 'HK' },
  { code: '+20',  flag: '🇪🇬', label: 'Egypt',           short: 'EG' },
  { code: '+234', flag: '🇳🇬', label: 'Nigeria',         short: 'NG' },
  { code: '+254', flag: '🇰🇪', label: 'Kenya',           short: 'KE' },
  { code: '+55',  flag: '🇧🇷', label: 'Brazil',          short: 'BR' },
  { code: '+52',  flag: '🇲🇽', label: 'Mexico',          short: 'MX' },
  { code: '+7',   flag: '🇷🇺', label: 'Russia',          short: 'RU' },
  { code: '+90',  flag: '🇹🇷', label: 'Turkey',          short: 'TR' },
  { code: '+48',  flag: '🇵🇱', label: 'Poland',          short: 'PL' },
  { code: '+31',  flag: '🇳🇱', label: 'Netherlands',     short: 'NL' },
  { code: '+46',  flag: '🇸🇪', label: 'Sweden',          short: 'SE' },
  { code: '+47',  flag: '🇳🇴', label: 'Norway',          short: 'NO' },
  { code: '+41',  flag: '🇨🇭', label: 'Switzerland',     short: 'CH' },
] as const;

function describedBy(id: string, hint?: string, error?: string) {
  const parts: string[] = [];
  if (hint) parts.push(`${id}-hint`);
  if (error) parts.push(`${id}-error`);
  return parts.length ? parts.join(' ') : undefined;
}

interface PhoneFieldProps {
  id: string;
  label: string;
  countryCode: string;
  phoneNumber: string;
  onCountryCodeChange: (code: string) => void;
  onPhoneChange: (number: string) => void;
  required?: boolean;
  hint?: string;
  error?: string;
  valid?: boolean;
}

export const PhoneField: React.FC<PhoneFieldProps> = ({
  id, label, countryCode, phoneNumber, onCountryCodeChange, onPhoneChange,
  required, hint, error, valid
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const codeButtonRef = useRef<HTMLButtonElement>(null);
  const selected = COUNTRY_CODES.find(c => c.code === countryCode) || COUNTRY_CODES[0];

  // Filter countries by search query
  const filtered = search.trim()
    ? COUNTRY_CODES.filter(c => {
        const q = search.toLowerCase();
        return c.label.toLowerCase().includes(q) || c.code.includes(q) || c.short.toLowerCase().includes(q);
      })
    : [...COUNTRY_CODES];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus the search input when the dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlighted(0);
  }, [search]);

  const selectCountry = useCallback((code: string) => {
    onCountryCodeChange(code);
    setOpen(false);
    setSearch('');
    codeButtonRef.current?.focus();
  }, [onCountryCodeChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted(h => Math.min(h + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted(h => Math.max(h - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlighted]) selectCountry(filtered[highlighted].code);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setSearch('');
        codeButtonRef.current?.focus();
        break;
    }
  }, [filtered, highlighted, selectCountry]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return;
    const list = dropdownRef.current?.querySelector('.rk-phone-dropdown-list');
    const item = list?.children[highlighted] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const placeholder = selected.code === '+61' ? 'e.g. 0412 345 678' : 'Phone number';

  return (
    <div className={`rk-field${error ? ' rk-invalid' : ''}`}>
      <div className="rk-box rk-box-phone">
        <label htmlFor={id} className="rk-box-label">
          <LabelText label={label} required={required} />
        </label>
        <div className="rk-phone-group">
          {/* Country code button */}
          <button
            ref={codeButtonRef}
            type="button"
            className="rk-phone-code-btn"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? `${id}-country-list` : undefined}
            aria-label={`Country code: ${selected.flag} ${selected.code}`}
          >
            <span className="rk-phone-flag">{selected.flag}</span>
            <span className="rk-phone-code-text">{selected.code}</span>
            <svg className="rk-phone-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Phone number input */}
          <input
            id={id}
            type="tel"
            inputMode="tel"
            className="rk-box-input rk-phone-input"
            value={phoneNumber}
            placeholder={placeholder}
            autoComplete="tel-national"
            maxLength={20}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy(id, hint, error)}
            onChange={e => onPhoneChange(e.target.value)}
          />
        </div>
        {valid && !error && <TickIcon className="rk-tick" />}
      </div>

      {/* Searchable dropdown */}
      {open && (
        <div className="rk-phone-dropdown" ref={dropdownRef} onKeyDown={handleKeyDown}>
          <div className="rk-phone-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="rk-phone-search"
              placeholder="Search country or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search countries"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-country-list`}
              aria-autocomplete="list"
              aria-activedescendant={filtered[highlighted] ? `${id}-country-${highlighted}` : undefined}
            />
          </div>
          <ul id={`${id}-country-list`} className="rk-phone-dropdown-list" role="listbox" aria-label="Country codes">
            {filtered.length === 0 && (
              <li className="rk-phone-dropdown-empty" role="presentation">No matches found</li>
            )}
            {filtered.map((c, i) => (
              <li
                key={c.code}
                id={`${id}-country-${i}`}
                role="option"
                aria-selected={c.code === countryCode}
                className={`rk-phone-dropdown-item${i === highlighted ? ' rk-phone-dropdown-hl' : ''}${c.code === countryCode ? ' rk-phone-dropdown-sel' : ''}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => selectCountry(c.code)}
              >
                <span className="rk-phone-dropdown-flag">{c.flag}</span>
                <span className="rk-phone-dropdown-label">{c.label}</span>
                <span className="rk-phone-dropdown-code">{c.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HelpAndError id={id} hint={hint} error={error} />
    </div>
  );
};
