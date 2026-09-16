import React, { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../../constants/appConstants";
import {
  createDemoCase,
  emptyDemoDraft,
  OWNERSHIP_TYPES,
  readDemoSession,
  validateDemoDraft,
  writeDemoSession,
} from "../demoSession";
import { listenForCustomerHandoff } from "../customerHandoff";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import AnalystCustomerRequests from "./AnalystCustomerRequests";
import { sameCustomerCompany, writeCustomerDemoCase } from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import "./customerOwnershipChart.css";

export default function CustomerCompanyPage() {
  const restored = useMemo(() => readDemoSession(), []);
  const [draft, setDraft] = useState(restored?.draft || emptyDemoDraft());
  const [demoCase, setDemoCase] = useState(restored?.demoCase || null);
  const [researchResult, setResearchResult] = useState(restored?.researchResult || null);
  const [errors, setErrors] = useState({});
  useEffect(() => listenForCustomerHandoff((handoff) => {
    writeDemoSession(handoff);
    setDraft(handoff.draft);
    setDemoCase(handoff.demoCase);
    setResearchResult(handoff.researchResult);
    const clean = new URL(window.location.href);
    clean.searchParams.delete("handoff");
    clean.searchParams.delete("handoffOrigin");
    window.history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
  }), []);
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    const nextErrors = validateDemoDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      event.preventDefault();
      return;
    }
    const created = createDemoCase(draft);
    const continuingSameCompany = demoCase?.demoCaseId && sameCustomerCompany(demoCase.company, created.company);
    writeCustomerDemoCase({ draft, demoCase: continuingSameCompany ? { ...created, demoCaseId: demoCase.demoCaseId } : created });
  };
  const assertionCount = (researchResult?.candidateSources || []).reduce((count, source) => count + (source.candidateFacts || []).length, 0);

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={1} />
    <main className="ubo-customer-main ubo-customer-company-main">
      <div className="ubo-customer-intro"><span>Step 1 · Company</span><h1>Tell us about your company</h1><p>We’ll use these details to connect your ownership chart to the right company.</p></div>
      {assertionCount > 0 && <aside className="ubo-customer-connected" role="status"><strong>Connected to existing ownership research</strong><p>{assertionCount} source assertion{assertionCount === 1 ? "" : "s"} will continue with this same demo case.</p></aside>}
      <AnalystCustomerRequests requests={researchResult?.analystCustomerRequests || []} />
      <form className="ubo-customer-card ubo-customer-company-form" action={CUSTOMER_OWNERSHIP_CHART_PATH} method="get" onSubmit={submit}>
        <label className="wide"><span>Company name *</span><input autoComplete="organization" value={draft.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Enter the registered company name" />{errors.legalName && <small className="ubo-customer-field-error">{errors.legalName}</small>}</label>
        <label><span>Registration number *</span><input value={draft.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} placeholder="For example, 00445790" />{errors.registrationNumber && <small className="ubo-customer-field-error">{errors.registrationNumber}</small>}</label>
        <label><span>Country of registration *</span><select value={draft.countryCode} onChange={(event) => update("countryCode", event.target.value)}>{COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
        <label><span>Ownership type *</span><select value={draft.ownershipType} onChange={(event) => update("ownershipType", event.target.value)}>{OWNERSHIP_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
        <label className="wide"><span>Case reference <em>Optional</em></span><input value={draft.referenceCaseId} onChange={(event) => update("referenceCaseId", event.target.value)} placeholder="Your internal reference" /></label>
        <div className="ubo-customer-company-actions"><small>Saved in this browser for this demo only.</small><button className="ubo-customer-primary" type="submit">Continue to ownership <span>→</span></button></div>
      </form>
    </main>
    <footer className="ubo-customer-footer">Demo experience · Browser-local session</footer>
  </div>;
}
