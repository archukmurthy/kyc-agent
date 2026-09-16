import React from "react";

const STEPS = ["Company", "Ownership", "Questions"];

export default function CustomerJourneyHeader({ currentStep }) {
  return <>
    <header className="ubo-customer-header">
      <a className="ubo-customer-brand" href="/ubo-demo/customer/"><span>N</span><strong>Ownership review</strong></a>
      <span className="ubo-customer-secure">Customer journey · Demo</span>
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
