import React from "react";
import { CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import { customerOwnershipChartSessionForContext, readCustomerDemoContext } from "./customerOwnershipChartSession";

const STEPS = ["Company", "Ownership", "Questions", "Identity verification", "Complete"];

export function showCustomerOwnershipAnalysis(value = process.env.REACT_APP_SHOW_CUSTOMER_OWNERSHIP_ANALYSIS) {
  if (value == null || value === "") return true;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

export default function CustomerJourneyHeader({ currentStep, onViewOwnershipAnalysis, ownershipAnalysisVisible = false }) {
  const ownershipAnalysisPath = `${CUSTOMER_OWNERSHIP_CHART_PATH}?view=analysis`;
  // Nothing to analyse before a chart is read: the link only reloaded the
  // upload page (found in the end-to-end check).
  const hasChart = Boolean(customerOwnershipChartSessionForContext(readCustomerDemoContext())?.result);
  return <>
    <header className="ubo-customer-header">
      <a className="ubo-customer-brand" href="/ubo-demo/customer/"><span>N</span><strong>Ownership review</strong></a>
      <div className="ubo-customer-header-actions">
        <span className="ubo-customer-secure">Customer journey · Demo</span>
        <nav className="ubo-customer-analyst-links" aria-label="Analyst views">
          {showCustomerOwnershipAnalysis() && hasChart && <a href={ownershipAnalysisPath} aria-current={ownershipAnalysisVisible ? "page" : undefined} onClick={onViewOwnershipAnalysis ? (event) => { event.preventDefault(); onViewOwnershipAnalysis(); } : undefined}>View Ownership Analysis</a>}
          {/* No links to the analyst's screens here. They were hidden only once
              the customer's session had loaded, which after a page load is a
              moment later than this header draws - so customers saw them
              (end-to-end check, 2026-10-08). An analyst previewing has their
              own tab. */}
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
