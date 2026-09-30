import React from "react";
import { DEMO_AUDIT_PATH, DEMO_REVIEW_PATH } from "../demoRoute";
import { CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import { currentCustomerSession } from "../../auth/customerSession";

const STEPS = ["Company", "Ownership", "Questions", "Identity verification", "Complete"];

export function showCustomerOwnershipAnalysis(value = process.env.REACT_APP_SHOW_CUSTOMER_OWNERSHIP_ANALYSIS) {
  if (value == null || value === "") return true;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

export default function CustomerJourneyHeader({ currentStep, onViewOwnershipAnalysis, ownershipAnalysisVisible = false }) {
  const ownershipAnalysisPath = `${CUSTOMER_OWNERSHIP_CHART_PATH}?view=analysis`;
  return <>
    <header className="ubo-customer-header">
      <a className="ubo-customer-brand" href="/ubo-demo/customer/"><span>N</span><strong>Ownership review</strong></a>
      <div className="ubo-customer-header-actions">
        <span className="ubo-customer-secure">Customer journey · Demo</span>
        <nav className="ubo-customer-analyst-links" aria-label="Analyst views">
          {showCustomerOwnershipAnalysis() && <a href={ownershipAnalysisPath} aria-current={ownershipAnalysisVisible ? "page" : undefined} onClick={onViewOwnershipAnalysis ? (event) => { event.preventDefault(); onViewOwnershipAnalysis(); } : undefined}>View Ownership Analysis</a>}
          {/* Analyst screens: not for a customer, who could not open them anyway. */}
          {!currentCustomerSession() && <a href={DEMO_REVIEW_PATH}>Open Analyst Review</a>}
          {!currentCustomerSession() && <a href={DEMO_AUDIT_PATH}>Open Audit</a>}
        </nav>
      </div>
    </header>
    <ol className="ubo-customer-progress" aria-label="Customer journey progress">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < currentStep ? "complete" : step === currentStep ? "current" : "";
        return <li className={state} key={label}><span className="ubo-customer-progress-number">{step}</span><span className="ubo-customer-progress-label">{label}</span></li>;
      })}
    </ol>
  </>;
}
