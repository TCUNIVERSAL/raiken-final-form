import React, { useEffect } from 'react';
import { ClientIntakeWizard } from './components/ClientIntakeWizard.js';

export const App: React.FC = () => {
  // The form is designed for a single light theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  }, []);

  return (
    <div className="rk-app">
      <a className="rk-skip-link" href="#client-form">Skip to form</a>
      <main id="client-form" className="rk-main">
        <ClientIntakeWizard />
      </main>

    </div>
  );
};
