import React, { useEffect, useRef, useState } from 'react';
import {
  ClientIntakeFormData, ConveyancingRole, DeclarationFormData, FinanceFormData, PartyFormData,
  PropertyFormData, StampDutyFormData, SubmissionResponse, UploadedDocument
} from '../types/index.js';
import { RoleSelector } from './RoleSelector.js';
import { SubmissionSuccess } from './SubmissionSuccess.js';
import { getRememberedUser, saveUserIdentityCookies, collectClientTelemetry } from '../utils/tracker.js';
import {
  clearHiddenStampDutyAnswers, FieldErrors, validateDeclaration, validatePartyAddress, validatePartyDetails,
  validateProperty, validateStampDuty
} from '../utils/validation.js';
import {
  Address, applyAddressChange, applySameAsAbove, collectDocuments, createInitialFormData, createParty,
  MAX_PARTIES, StepKey, stepFromNumber, stepsFor, stepTitle, stepToNumber
} from './form/formState.js';
import { ErrorSummary, Stepper } from './form/fields.js';
import { PeopleStep } from './form/PeopleStep.js';
import { PropertyStep } from './form/PropertyStep.js';
import { StampDutyStep } from './form/StampDutyStep.js';
import { ReviewProblem, ReviewStep } from './form/ReviewStep.js';
import { useSessionSync } from './form/useSessionSync.js';
import '../form.css';

function prefixKeys(errors: FieldErrors, prefix: string): FieldErrors {
  const out: FieldErrors = {};
  Object.entries(errors).forEach(([k, v]) => { out[`${prefix}${k.replace('.', '-')}`] = v; });
  return out;
}

function focusField(fieldId: string | undefined) {
  if (!fieldId) return;
  // Wait for the error messages to render before moving focus
  setTimeout(() => {
    const el = document.getElementById(fieldId);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, 0);
}

function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export const ClientIntakeWizard: React.FC = () => {
  const [step, setStep] = useState<StepKey>('start');
  const [partyIndex, setPartyIndex] = useState(0);
  const [formData, setFormData] = useState<ClientIntakeFormData>(createInitialFormData);
  const [attempted, setAttempted] = useState<Partial<Record<StepKey, boolean>>>({});
  const [returnToReview, setReturnToReview] = useState(false);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [ready, setReady] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [manualSaveNotice, setManualSaveNotice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<{ response: SubmissionResponse; formData: ClientIntakeFormData } | null>(null);
  const [returningUser, setReturningUser] = useState('');

  const sync = useSessionSync(ready && !submission);
  const saveImmediatelyRef = useRef(false);
  // Saved answers are applied once per page; re-running effects (StrictMode, hot reload)
  // must never overwrite newer answers with the snapshot loaded at start-up.
  const restoreAppliedRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hasNavigatedRef = useRef(false);

  const role = formData.role;
  const steps = stepsFor(role);
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLastStep = step === 'review';

  // ─── Load saved answers from the server (or this device when offline) ─────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await sync.restore();
      if (cancelled || restoreAppliedRef.current) return;
      restoreAppliedRef.current = true;
      if (restored?.hasAnswers) {
        setFormData(restored.formData);
        setStep(stepFromNumber(restored.formData.role, restored.currentStep));
        setPartyIndex(restored.partyIndex);
        setRestoredNotice(restored.currentStep > 1);
      } else {
        // Nothing saved yet — pre-fill contact details remembered from an earlier visit
        const remembered = getRememberedUser();
        if (remembered.name || remembered.phone || remembered.email) {
          setReturningUser(remembered.name || remembered.email || remembered.phone);
          setFormData(prev => {
            const parties = [...prev.parties];
            const nameParts = (remembered.name || '').split(' ');
            parties[0] = {
              ...parties[0],
              firstName: parties[0].firstName || nameParts[0] || '',
              lastName: parties[0].lastName || nameParts.slice(1).join(' ') || '',
              mobile: parties[0].mobile || remembered.phone || '',
              email: parties[0].email || remembered.email || ''
            };
            return { ...prev, parties };
          });
        }
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Save every change to the server ───────────────────────────────────────
  useEffect(() => {
    if (!ready || submission) return;
    const immediate = saveImmediatelyRef.current;
    saveImmediatelyRef.current = false;
    sync.queueSave({ formData, currentStep: stepToNumber(role, step), partyIndex }, immediate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, step, partyIndex, ready]);

  /** Marks the next state change as important enough to save without waiting. */
  const saveSoon = () => { saveImmediatelyRef.current = true; };

  // Start each page at the top
  useEffect(() => {
    window.scrollTo(0, 0);
    setManualSaveNotice(false);
    if (hasNavigatedRef.current) titleRef.current?.focus({ preventScroll: true });
    hasNavigatedRef.current = true;
  }, [step]);

  // ─── Validation ────────────────────────────────────────────────────────────
  const errorsForStep = (s: StepKey, data: ClientIntakeFormData = formData): FieldErrors => {
    switch (s) {
      case 'start':
        return data.roleConfirmed ? {} : { role: 'Please choose whether you are buying or selling.' };
      case 'people': {
        // Validate ALL parties' details AND addresses together
        let allErrors: FieldErrors = {};
        data.parties.forEach(p => {
          allErrors = { ...allErrors, ...prefixKeys(validatePartyDetails(p), `${p.id}-`) };
          allErrors = { ...allErrors, ...prefixKeys(validatePartyAddress(p), `${p.id}-addr-`) };
        });
        return allErrors;
      }
      case 'property':
        return prefixKeys(validateProperty(data), '');
      case 'stampDuty':
        return prefixKeys(validateStampDuty(data.stampDuty), '');
      case 'review':
        return prefixKeys(validateDeclaration(data), '');
    }
  };

  // Live errors drive the ✓ marks; shown errors only appear after the client tries to continue
  const liveErrors = errorsForStep(step);
  const errors: FieldErrors = attempted[step] ? liveErrors : {};

  // On pages where several people answer the same questions, say whose answer is missing
  const summaryErrors: FieldErrors = {};
  Object.entries(errors).forEach(([key, message]) => {
    const owner = step === 'people' && formData.parties.length > 1
      ? formData.parties.findIndex(p => key.startsWith(`${p.id}-`))
      : -1;
    summaryErrors[key] = owner === -1 ? message : `${role} ${owner + 1}: ${message}`;
  });

  const reviewProblems: ReviewProblem[] = [];
  formData.parties.forEach((p, i) => {
    if (Object.keys(validatePartyDetails(p)).length) {
      reviewProblems.push({ step: 'people', partyIndex: i, message: `${role} ${i + 1}: some personal details are missing or incorrect.` });
    }
  });
  formData.parties.forEach((p, i) => {
    if (Object.keys(validatePartyAddress(p)).length) {
      reviewProblems.push({ step: 'people', partyIndex: i, message: `${role} ${i + 1}: the address is missing or incomplete.` });
    }
  });
  if (Object.keys(validateProperty(formData)).length) {
    reviewProblems.push({ step: 'property', message: 'Property: some answers are missing or incorrect.' });
  }
  if (role === 'Purchaser' && Object.keys(validateStampDuty(formData.stampDuty)).length) {
    reviewProblems.push({ step: 'stampDuty', message: 'Stamp duty: some questions have not been answered.' });
  }

  // ─── State updates ─────────────────────────────────────────────────────────
  const updateParty = (index: number, field: keyof PartyFormData, value: string) => {
    setFormData(prev => {
      const parties = [...prev.parties];
      parties[index] = { ...parties[index], [field]: value };
      if (index === 0 && ['firstName', 'lastName', 'mobile', 'email'].includes(field)) {
        const p = parties[0];
        saveUserIdentityCookies({ name: `${p.firstName} ${p.lastName}`.trim(), phone: p.mobile, email: p.email });
      }
      return { ...prev, parties };
    });
  };

  const selectParty = (index: number) => {
    setPartyIndex(index);
  };

  const addParty = () => {
    if (formData.parties.length >= MAX_PARTIES) return;
    saveSoon();
    const newIndex = formData.parties.length;
    setFormData(prev => {
      const parties = [...prev.parties, createParty()];
      return { ...prev, parties, partyCount: parties.length };
    });
    selectParty(newIndex);
  };

  const setPartyCount = (count: number) => {
    const clamped = Math.max(1, Math.min(MAX_PARTIES, count));
    setPartyIndex(index => Math.min(index, clamped - 1));
    saveSoon();
    setFormData(prev => {
      let parties = [...prev.parties];
      if (clamped > parties.length) {
        // Add parties
        while (parties.length < clamped) parties.push(createParty());
      } else if (clamped < parties.length) {
        // Remove excess parties from the end
        parties = parties.slice(0, clamped);
      }
      // The first person has nobody "above" them to copy from
      if (parties[0]?.sameAddressAsPrevious) parties[0] = { ...parties[0], sameAddressAsPrevious: false };
      return { ...prev, parties, partyCount: parties.length };
    });
  };

  const removeParty = (index: number) => {
    saveSoon();
    setFormData(prev => {
      const parties = prev.parties.filter((_, i) => i !== index);
      // The first person has nobody "above" them to copy from
      if (parties[0]?.sameAddressAsPrevious) parties[0] = { ...parties[0], sameAddressAsPrevious: false };
      return { ...prev, parties, partyCount: parties.length };
    });
    const nextIndex = index < partyIndex ? partyIndex - 1 : Math.min(partyIndex, formData.parties.length - 2);
    selectParty(Math.max(0, nextIndex));
  };

  const addDocument = (partyId: string, doc: UploadedDocument) => {
    saveSoon();
    setFormData(prev => ({
      ...prev,
      parties: prev.parties.map(p => (p.id === partyId ? { ...p, idDocuments: [...p.idDocuments, doc] } : p))
    }));
  };

  const removeDocument = (partyId: string, docId: string) => {
    saveSoon();
    setFormData(prev => ({
      ...prev,
      parties: prev.parties.map(p => (p.id === partyId ? { ...p, idDocuments: p.idDocuments.filter(d => d.id !== docId) } : p))
    }));
  };

  const onUploadingChange = (uploading: boolean) => setUploadsInFlight(n => Math.max(0, n + (uploading ? 1 : -1)));

  // ─── Navigation ────────────────────────────────────────────────────────────
  const goToStep = (s: StepKey, pIndex = 0) => {
    saveSoon();
    setRestoredNotice(false);
    setAttempted(a => ({ ...a, [s]: false }));
    setPartyIndex(pIndex);
    setStep(s);
  };

  const handleNext = () => {
    const stepErrors = errorsForStep(step);
    if (Object.keys(stepErrors).length) {
      setAttempted(a => ({ ...a, [step]: true }));
      focusField(Object.keys(stepErrors)[0]);
      return;
    }

    if (returnToReview) {
      setReturnToReview(false);
      goToStep('review');
      return;
    }
    goToStep(steps[Math.min(steps.length - 1, stepIndex + 1)]);
  };

  const handleBack = () => {
    const prev = steps[Math.max(0, stepIndex - 1)];
    goToStep(prev);
  };

  const handleSelectRole = (selected: ConveyancingRole) => {
    setFormData(prev => ({ ...prev, role: selected, roleConfirmed: true }));
    setRestoredNotice(false);
    setReturnToReview(false);
    goToStep(returnToReview ? 'review' : 'people');
  };

  const handleEditFromReview = (s: StepKey, pIndex = 0) => {
    setReturnToReview(true);
    goToStep(s, pIndex);
  };

  const handleSaveProgress = async () => {
    await sync.saveNow();
    setManualSaveNotice(true);
  };

  const handleStartOver = async () => {
    setConfirmStartOver(false);
    setRestoredNotice(false);
    setReady(false);
    await sync.startNewSession();
    setFormData(createInitialFormData());
    setStep('start');
    setPartyIndex(0);
    setAttempted({});
    setReturnToReview(false);
    setSubmitError(null);
    setReady(true);
  };

  // ─── Submission (API → Supabase → confirmation email) ─────────────────────
  const handleSubmitIntake = async () => {
    const declarationErrors = errorsForStep('review');
    setAttempted(a => ({ ...a, review: true }));
    if (reviewProblems.length > 0) {
      window.scrollTo(0, 0);
      return;
    }
    if (Object.keys(declarationErrors).length) {
      focusField(Object.keys(declarationErrors)[0]);
      return;
    }
    if (uploadsInFlight > 0) return;

    setIsSubmitting(true);
    setSubmitError(null);
    await sync.saveNow();

    const primary = formData.parties[0];
    const fullName = `${primary.firstName || ''} ${primary.lastName || ''}`.trim();
    const telemetry = collectClientTelemetry({ name: fullName, phone: primary.mobile, email: primary.email });
    const blank = createInitialFormData();
    const isVendor = formData.role === 'Vendor';
    const payload: ClientIntakeFormData = {
      ...formData,
      // Drop purchaser-only answers left over if the client switched role part-way through
      ...(isVendor && {
        stampDuty: blank.stampDuty,
        howDidYouHear: '',
        property: { ...formData.property, intendedUse: '', ownershipType: '' },
        finance: { ...formData.finance, brokerOrBankerName: '', brokerPhone: '', brokerEmail: '' },
        declaration: { ...formData.declaration, coolingOffAcknowledged: false }
      }),
      partyCount: formData.parties.length,
      idDocuments: collectDocuments(formData)
    };

    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ formData: payload, telemetry, sessionId: sync.getSessionId() })
      });
      const data: SubmissionResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Submission failed.');
      }
      sync.markSubmitted();
      setSubmission({ response: data, formData: payload });
      window.scrollTo(0, 0);
    } catch (err: any) {
      console.error('Submission error:', err);
      setSubmitError(navigator.onLine
        ? err.message || 'Something went wrong while sending the form.'
        : 'You appear to be offline.');
      window.scrollTo(0, 0);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartAnother = async () => {
    setSubmission(null);
    await handleStartOver();
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (submission) {
    return (
      <div className="rk-form">
        <div className="rk-shell">
          <Stepper steps={steps.map(s => stepTitle(s, role))} current={steps.length} allDone />
          <SubmissionSuccess response={submission.response} formData={submission.formData} onStartAnother={handleStartAnother} />
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="rk-form">
        <div className="rk-shell rk-loading" aria-live="polite">Loading your form…</div>
      </div>
    );
  }

  let primaryLabel = step === 'people' ? 'Continue to property' : step === 'property' && role === 'Purchaser' ? 'Continue to stamp duty' : 'Review your details';
  if (isLastStep) primaryLabel = isSubmitting ? 'Sending…' : 'Submit your form';
  else if (returnToReview) primaryLabel = 'Save and go back to review';

  let saveMessage: React.ReactNode = null;
  if (uploadsInFlight > 0) saveMessage = 'Please wait — a file is still uploading.';
  else if (sync.status === 'offline') saveMessage = navigator.onLine ? 'Saved on this device · waiting to sync' : 'Offline · saved on this device';
  else if (sync.status === 'saving') saveMessage = 'Saving…';
  else if (manualSaveNotice && sync.lastSavedAt) saveMessage = 'Saved. You can close this page and continue later on this device.';
  else if (sync.lastSavedAt) saveMessage = `Autosaved at ${formatTime(sync.lastSavedAt)}`;
  else if (formData.roleConfirmed) saveMessage = 'Changes save automatically';

  return (
    <div className="rk-form">
      <div className="rk-shell">
        <Stepper steps={steps.map(s => s === 'people' ? 'Your details' : stepTitle(s, role))} current={stepIndex} onStepClick={isSubmitting ? undefined : index => { setReturnToReview(false); goToStep(steps[index]); }} />
        <header className="rk-intro">
          <h1 className="rk-title" ref={titleRef} tabIndex={-1}>
            {step === 'start' && 'Client intake form'}
            {step === 'people' && `${role} details`}
            {step === 'property' && 'Property details'}
            {step === 'stampDuty' && 'Stamp duty relief'}
            {step === 'review' && 'Review and confirm'}
          </h1>
          {step === 'start' && (
            <p className="rk-lead">Choose whether you are buying or selling to begin.</p>
          )}
          {step !== 'start' && <p className="rk-lead">{step === 'people' ? 'Use the legal names of everyone on the contract.' : step === 'property' ? 'Enter the property and finance details.' : step === 'stampDuty' ? 'Answer these questions so we can check which relief may apply.' : 'Check your answers, then sign and submit.'}</p>}
          {step !== 'start' && <p className="rk-required-note"><span className="rk-req">*</span> Required fields</p>}
        </header>

        {restoredNotice && (
          <div className="rk-notice" role="status">
            <p>Welcome back — we have restored the answers you entered earlier.</p>
            {confirmStartOver ? (
              <p className="rk-notice-actions">
                <span>Clear this form and start again?</span>
                <button type="button" className="rk-btn rk-btn-danger rk-btn-small" onClick={handleStartOver}>Yes, start again</button>
                <button type="button" className="rk-btn rk-btn-secondary rk-btn-small" onClick={() => setConfirmStartOver(false)}>Cancel</button>
              </p>
            ) : (
              <button type="button" className="rk-link-button" onClick={() => setConfirmStartOver(true)}>Start a new form instead</button>
            )}
          </div>
        )}

        {returnToReview && !isLastStep && (
          <p className="rk-notice">You are changing an answer. When you are done, click <strong>Save and go back to review</strong>.</p>
        )}

        {!isLastStep && <ErrorSummary errors={summaryErrors} />}

        {step === 'start' && (
          <RoleSelector
            selectedRole={formData.roleConfirmed ? role : null}
            onSelectRole={handleSelectRole}
            returningUserName={returningUser}
            error={errors.role}
          />
        )}

        {step === 'people' && (
          <PeopleStep
            formData={formData}
            partyIndex={partyIndex}
            errors={errors}
            live={liveErrors}
            onSelectParty={selectParty}
            onUpdateParty={updateParty}
            onSetPartyCount={setPartyCount}
            onAddParty={addParty}
            onRemoveParty={removeParty}
            onAddDocument={addDocument}
            onRemoveDocument={removeDocument}
            onUploadingChange={onUploadingChange}
            onAddressChange={(i: number, patch: Partial<Address>) => setFormData(prev => ({ ...prev, parties: applyAddressChange(prev.parties, i, patch) }))}
            onSameAsAbove={(i: number, checked: boolean) => {
              saveSoon();
              setFormData(prev => ({ ...prev, parties: applySameAsAbove(prev.parties, i, checked) }));
            }}
          />
        )}

        {step === 'property' && (
          <PropertyStep
            formData={formData}
            errors={errors}
            live={liveErrors}
            onPropertyChange={(patch: Partial<PropertyFormData>) => setFormData(prev => ({ ...prev, property: { ...prev.property, ...patch } }))}
            onFinanceChange={(patch: Partial<FinanceFormData>) => setFormData(prev => ({ ...prev, finance: { ...prev.finance, ...patch } }))}
            onHowDidYouHearChange={(value: string) => setFormData(prev => ({ ...prev, howDidYouHear: value }))}
          />
        )}

        {step === 'stampDuty' && (
          <StampDutyStep
            stampDuty={formData.stampDuty}
            errors={errors}
            onChange={(patch: Partial<StampDutyFormData>) => setFormData(prev => ({
              ...prev,
              stampDuty: clearHiddenStampDutyAnswers({ ...prev.stampDuty, ...patch })
            }))}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            formData={formData}
            problems={reviewProblems}
            errors={errors}
            live={liveErrors}
            onDeclarationChange={(patch: Partial<DeclarationFormData>) => setFormData(prev => ({ ...prev, declaration: { ...prev.declaration, ...patch } }))}
            onEdit={handleEditFromReview}
            submitError={submitError}
          />
        )}

        {/* Navigation */}
        {step !== 'start' && <div className="rk-action-area"><div className="rk-nav">
            <button type="button" className="rk-btn rk-btn-secondary" onClick={handleBack} disabled={isSubmitting}>
              Back
            </button>
          <div className="rk-nav-right">
            {formData.roleConfirmed && (
              <button type="button" className="rk-btn rk-btn-ghost" onClick={handleSaveProgress} disabled={isSubmitting}>
                Save progress
              </button>
            )}
            <button
              type="button"
              className="rk-btn rk-btn-primary"
              onClick={isLastStep ? handleSubmitIntake : handleNext}
              disabled={isSubmitting || (isLastStep && uploadsInFlight > 0)}
            >
              {primaryLabel}
            </button>
          </div>
        </div>

        <p className={`rk-save-status${sync.status === 'offline' ? ' rk-save-offline' : ''}`} aria-live="polite">{saveMessage}</p></div>}
      </div>
    </div>
  );
};
