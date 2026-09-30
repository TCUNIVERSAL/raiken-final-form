import React from 'react';
import { ConveyancingRole } from '../types/index.js';

interface RoleSelectorProps {
  selectedRole: ConveyancingRole | null;
  onSelectRole: (role: ConveyancingRole) => void;
  returningUserName?: string;
  error?: string;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ selectedRole, onSelectRole, returningUserName, error }) => (
  <section className="rk-panel rk-role-panel" aria-label="Choose your form">
    {returningUserName && <p className="rk-welcome">Welcome back, {returningUserName}.</p>}
    <div id="role" className="rk-role-options" tabIndex={-1}>
      {(['Purchaser', 'Vendor'] as const).map(role => (
        <button key={role} type="button" className={`rk-role-card${selectedRole === role ? ' rk-role-selected' : ''}`} onClick={() => onSelectRole(role)}>
          <span className="rk-role-copy"><strong>{role === 'Purchaser' ? 'Buying a property' : 'Selling a property'}</strong><span>{role === 'Purchaser' ? 'Purchaser' : 'Vendor'} form</span></span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ))}
    </div>
    {error && <p className="rk-error" role="alert">{error}</p>}
  </section>
);
