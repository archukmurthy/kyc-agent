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
import { sameCustomerCompany, writeCustomerDemoCase } from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import "./customerOwnershipChart.css";
import { persistPocCase } from "../pocCaseClient";
import { currentCustomerSession } from "../../auth/customerSession";

export default function CustomerCompanyPage() {
  const restored = useMemo(() => readDemoSession(), []);
  const [draft, setDraft] = useState(restored?.draft || emptyDemoDraft());
  const [demoCase, setDemoCase] = useState(restored?.demoCase || null);
  const [researchResult, setResearchResult] = useState(restored?.researchResult || null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
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
  // On a customer link the company is the analyst's: the server keeps it as it
  // is whatever is sent (research and the chart are matched to it), so the
  // page shows it as fixed instead of letting a change be silently dropped.
  const fixedCompany = Boolean(currentCustomerSession());
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validateDemoDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const created = createDemoCase(draft);
    const continuingSameCompany = demoCase?.demoCaseId && sameCustomerCompany(demoCase.company, created.company);
    const nextCase = continuingSameCompany ? { ...created, demoCaseId: demoCase.demoCaseId } : created;
    writeCustomerDemoCase({ draft, demoCase: nextCase });
    try {
      await persistPocCase("UPSERT_CASE", { caseId: nextCase.demoCaseId, idempotencyKey: `customer-case:${nextCase.demoCaseId}`, payload: { draft, demoCase: nextCase }, actorType: "CUSTOMER" });
      window.location.assign(CUSTOMER_OWNERSHIP_CHART_PATH);
    } catch (cause) { setSaveError(`${cause.message} Your case was not submitted.`); }
  };
  const assertionCount = (researchResult?.candidateSources || []).reduce((count, source) => count + (source.candidateFacts || []).length, 0);

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={1} />
    <main className="ubo-customer-main ubo-customer-company-main">
      <div className="ubo-customer-intro"><span>Step 1 · Company</span><h1>Tell us about your company</h1><p>We’ll use these details to connect your ownership chart to the right company.</p></div>
      {assertionCount > 0 && <aside className="ubo-customer-connected" role="status"><strong>Connected to existing ownership research</strong><p>{assertionCount} source assertion{assertionCount === 1 ? "" : "s"} will continue with this same demo case.</p></aside>}
      {fixedCompany && <p className="ubo-customer-connected" role="note">These are the company details for your review. If something is wrong, tell the person who sent you this link.</p>}
      <form className="ubo-customer-card ubo-customer-company-form" action={CUSTOMER_OWNERSHIP_CHART_PATH} method="get" onSubmit={submit}>
        <label className="wide"><span>Company name *</span><input autoComplete="organization" readOnly={fixedCompany} value={draft.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Enter the registered company name" />{errors.legalName && <small className="ubo-customer-field-error">{errors.legalName}</small>}</label>
        <label><span>Registration number *</span><input readOnly={fixedCompany} value={draft.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} placeholder="For example, 00445790" />{errors.registrationNumber && <small className="ubo-customer-field-error">{errors.registrationNumber}</small>}</label>
        <label><span>Country of registration *</span><select disabled={fixedCompany} value={draft.countryCode} onChange={(event) => update("countryCode", event.target.value)}>{COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
        <label><span>Ownership type *</span><select disabled={fixedCompany} value={draft.ownershipType} onChange={(event) => update("ownershipType", event.target.value)}>{OWNERSHIP_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
        <label className="wide"><span>Case reference <em>Optional</em></span><input value={draft.referenceCaseId} onChange={(event) => update("referenceCaseId", event.target.value)} placeholder="Your internal reference" /></label>
        {saveError && <p className="ubo-customer-error" role="alert">{saveError}</p>}
        <div className="ubo-customer-company-actions"><small>Submitted company details are saved to this POC case.</small><button className="ubo-customer-primary" type="submit">Continue to ownership <span>→</span></button></div>
      </form>
    </main>
    <footer className="ubo-customer-footer">Demo experience · Server-saved POC case</footer>
  </div>;
}
