import React from 'react';
import { ClientIntakeFormData, SubmissionResponse } from '../types/index.js';
import { RaikanDetails } from './form/ReviewStep.js';

interface SubmissionSuccessProps {
  response: SubmissionResponse;
  formData: ClientIntakeFormData;
  onStartAnother: () => void;
}

const SuccessIcon = () => (
  <svg className="rk-success-icon" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
    <path d="M48 10v10M20 22l7 7M76 22l-7 7" stroke="var(--rk-cyan)" strokeWidth="4" strokeLinecap="round" />
    <circle cx="48" cy="58" r="26" fill="none" stroke="var(--rk-primary)" strokeWidth="5" />
    <path d="M36 58l8 8 16-17" fill="none" stroke="var(--rk-primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SubmissionSuccess: React.FC<SubmissionSuccessProps> = ({ response, formData, onStartAnother }) => {
  const email = response.clientEmail || formData.parties[0]?.email;
  return (
    <section className="rk-success" aria-labelledby="success-title">
      <SuccessIcon />
      <h1 id="success-title" className="rk-title">We've received your details!</h1>
      <p className="rk-lead">
        {response.sentToLiveSign
          ? 'Your details have been sent to LiveSign to verify your identity.'
          : 'Your identity verification request is being sent to LiveSign.'}
      </p>

      <div className="rk-info-box rk-next-steps">
        <p className="rk-question">What happens next</p>
        <ol>
          <li>Each person on this form will get an email from <strong>LiveSign</strong> with a secure link. Please check junk mail too.</li>
          <li>Open the link on your phone: scan your photo ID and take a quick selfie. It takes about 5 minutes.</li>
          <li>We will email you as soon as your identity has been verified.</li>
        </ol>
      </div>

      <div className="rk-summary rk-success-summary">
        <div className="rk-summary-row">
          <dt>Your reference:</dt>
          <dd className="rk-reference">{response.matterReference}</dd>
        </div>
        {email && (
          <div className="rk-summary-row">
            <dt>Confirmation:</dt>
            <dd>{response.emailDispatched ? `Sent to ${email}` : `We will email ${email}`}</dd>
          </div>
        )}
      </div>

      <p className="rk-hint">Please keep your reference number. You will need it if you call us on 08 7076 9899.</p>

      <RaikanDetails />

      <div className="rk-button-row">
        <button type="button" className="rk-btn rk-btn-secondary" onClick={() => window.print()}>Print this page</button>
        <button type="button" className="rk-btn rk-btn-primary" onClick={onStartAnother}>Start another form</button>
      </div>
    </section>
  );
};
