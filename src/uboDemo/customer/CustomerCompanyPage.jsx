import React, { useMemo, useState } from "react";
import { COUNTRIES } from "../../constants/appConstants";
import {
  createDemoCase,
  emptyDemoDraft,
  OWNERSHIP_TYPES,
  readDemoSession,
  validateDemoDraft,
} from "../demoSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { writeCustomerDemoCase } from "./customerOwnershipChartSession";
import { CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import "./customerOwnershipChart.css";

export default function CustomerCompanyPage() {
  const restoredDraft = useMemo(() => readDemoSession()?.draft || emptyDemoDraft(), []);
  const [draft, setDraft] = useState(restoredDraft);
  const [errors, setErrors] = useState({});
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    const nextErrors = validateDemoDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      event.preventDefault();
      return;
    }
    writeCustomerDemoCase({ draft, demoCase: createDemoCase(draft) });
  };

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={1} />
    <main className="ubo-customer-main ubo-customer-company-main">
      <div className="ubo-customer-intro"><span>Step 1 · Company</span><h1>Tell us about your company</h1><p>We’ll use these details to connect your ownership chart to the right company.</p></div>
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
