import React, { useEffect, useRef, useState } from "react";
import { COUNTRIES } from "../constants/appConstants";
import {
  clearDemoSession,
  createDemoCase,
  emptyDemoDraft,
  OWNERSHIP_TYPES,
  ownershipLabelFor,
  readDemoSession,
  validateDemoDraft,
  writeDemoSession,
} from "./demoSession";
import {
  DEMO_RESEARCH_PATH,
  DEMO_START_PATH,
  isDemoResearchPath,
  navigateDemo,
} from "./demoRoute";
import "./uboDemo.css";

function DemoHeader({ onStartNew }) {
  return (
    <header className="ubo-demo-header">
      <a className="ubo-demo-brand" href={DEMO_START_PATH} aria-label="Ownership review demo home">
        <span className="ubo-demo-mark" aria-hidden="true">N</span>
        <span>Ownership review</span>
      </a>
      <button className="ubo-demo-link-button" type="button" onClick={onStartNew}>Start new case</button>
    </header>
  );
}

function DemoProgress({ research = false }) {
  return (
    <ol className="ubo-demo-progress" aria-label="Demo journey progress">
      <li className={research ? "complete" : "current"}><span>1</span>Company</li>
      <li className={research ? "current" : ""}><span>2</span>Research</li>
      <li><span>3</span>Ownership</li>
      <li><span>4</span>Review</li>
    </ol>
  );
}

function FieldError({ id, children }) {
  return <p className="ubo-demo-error" id={id} role="alert">{children}</p>;
}

function CompanyStart({ draft, errors, onChange, onSubmit }) {
  return (
    <main className="ubo-demo-main">
      <div className="ubo-demo-intro">
        <span className="ubo-demo-eyebrow">Ownership review</span>
        <h1>Let&rsquo;s research your company</h1>
        <p>Tell us which company you&rsquo;re reviewing. We&rsquo;ll use these details to start its ownership journey.</p>
      </div>

      <form className="ubo-demo-card" onSubmit={onSubmit} noValidate>
        <div className="ubo-demo-card-heading">
          <span>Company details</span>
          <small>Fields marked * are required</small>
        </div>

        <div className="ubo-demo-fields">
          <label className="ubo-demo-field ubo-demo-wide">
            <span>Company name *</span>
            <input
              autoComplete="organization"
              aria-invalid={Boolean(errors.legalName)}
              aria-describedby={errors.legalName ? "legal-name-error" : undefined}
              value={draft.legalName}
              onChange={(event) => onChange("legalName", event.target.value)}
              placeholder="Enter the registered company name"
            />
            {errors.legalName && <FieldError id="legal-name-error">{errors.legalName}</FieldError>}
          </label>

          <label className="ubo-demo-field">
            <span>Registration number *</span>
            <input
              autoComplete="off"
              inputMode="text"
              aria-invalid={Boolean(errors.registrationNumber)}
              aria-describedby={errors.registrationNumber ? "registration-error" : "registration-help"}
              value={draft.registrationNumber}
              onChange={(event) => onChange("registrationNumber", event.target.value)}
              placeholder="For example, 00445790"
            />
            <small id="registration-help">Letters and leading zeros are preserved.</small>
            {errors.registrationNumber && <FieldError id="registration-error">{errors.registrationNumber}</FieldError>}
          </label>

          <label className="ubo-demo-field">
            <span>Country of registration *</span>
            <select value={draft.countryCode} onChange={(event) => onChange("countryCode", event.target.value)}>
              {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </label>

          <label className="ubo-demo-field">
            <span>Ownership type *</span>
            <select value={draft.ownershipType} onChange={(event) => onChange("ownershipType", event.target.value)}>
              {OWNERSHIP_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
            </select>
            <small>Used as context for this demo; it does not change policy.</small>
          </label>

          <label className="ubo-demo-field">
            <span>Case ID / reference <em>Optional</em></span>
            <input
              autoComplete="off"
              value={draft.referenceCaseId}
              onChange={(event) => onChange("referenceCaseId", event.target.value)}
              placeholder="Your internal reference"
            />
          </label>
        </div>

        <div className="ubo-demo-actions">
          <p>Saved in this browser for this demo only.</p>
          <button className="ubo-demo-primary" type="submit">Start research <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </main>
  );
}

function ResearchPlaceholder({ demoCase, onEdit }) {
  if (!demoCase) {
    return (
      <main className="ubo-demo-main ubo-demo-empty">
        <h1>Start with company details</h1>
        <p>No demo company is saved in this browser yet.</p>
        <button className="ubo-demo-primary" type="button" onClick={onEdit}>Enter company details</button>
      </main>
    );
  }

  const { company } = demoCase;
  return (
    <main className="ubo-demo-main">
      <section className="ubo-demo-research-card">
        <div className="ubo-demo-spinner" aria-hidden="true" />
        <span className="ubo-demo-eyebrow">Research</span>
        <h1>Researching {company.legalName}</h1>
        <p className="ubo-demo-status">Research integration coming next</p>

        <dl className="ubo-demo-summary">
          <div><dt>Registration number</dt><dd>{company.registrationNumber}</dd></div>
          <div><dt>Country</dt><dd>{company.countryName}</dd></div>
          <div><dt>Ownership type</dt><dd>{ownershipLabelFor(company.ownershipType)}</dd></div>
          <div><dt>Case reference</dt><dd>{demoCase.referenceCaseId || "Not provided"}</dd></div>
        </dl>

        <button className="ubo-demo-secondary" type="button" onClick={onEdit}>Edit company details</button>
      </section>
    </main>
  );
}

export default function UboDemoRoot() {
  const restored = readDemoSession();
  const [draft, setDraft] = useState(() => restored?.draft || emptyDemoDraft());
  const [demoCase, setDemoCase] = useState(() => restored?.demoCase || null);
  const [errors, setErrors] = useState({});
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const skipNextSave = useRef(false);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    writeDemoSession({ draft, demoCase });
  }, [draft, demoCase]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const startResearch = (event) => {
    event.preventDefault();
    const nextErrors = validateDemoDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const nextCase = createDemoCase(draft);
    writeDemoSession({ draft, demoCase: nextCase });
    setDemoCase(nextCase);
    navigateDemo(DEMO_RESEARCH_PATH);
  };

  const startNewCase = () => {
    skipNextSave.current = true;
    clearDemoSession();
    setDraft(emptyDemoDraft());
    setDemoCase(null);
    setErrors({});
    navigateDemo(DEMO_START_PATH, { replace: true });
  };

  const editCompany = () => navigateDemo(DEMO_START_PATH);
  const research = isDemoResearchPath(pathname);

  return (
    <div className="ubo-demo-page">
      <DemoHeader onStartNew={startNewCase} />
      <DemoProgress research={research} />
      {research
        ? <ResearchPlaceholder demoCase={demoCase} onEdit={editCompany} />
        : <CompanyStart draft={draft} errors={errors} onChange={updateDraft} onSubmit={startResearch} />}
      <footer className="ubo-demo-footer">Demo experience · Browser-local session · No live provider request</footer>
    </div>
  );
}
