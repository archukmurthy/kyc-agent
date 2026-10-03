import React from "react";
import { currentCustomerSession } from "../../auth/customerSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { DEMO_START_PATH } from "../demoRoute";

/** True when research has been attached to the case. Its contents are not
 *  inspected here - only whether there is any. */
export function hasResearch(researchResult) {
  return Boolean(researchResult && typeof researchResult === "object");
}

// The chart is compared with the registry research, and the questions come from
// that comparison. Without research there is nothing to compare, the questions
// would be incomplete, and the server refuses them (case_not_ready) - so the
// journey stops here, before a chart reading is paid for.
export default function ResearchRequiredNotice({ currentStep, stepLabel }) {
  const customer = Boolean(currentCustomerSession());
  return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={currentStep} /><main className="ubo-customer-empty">
    <span>{stepLabel}</span>
    <h1>Ownership research is needed first</h1>
    {customer
      ? <p>This review has no registry research to compare your ownership chart with yet. Your details are saved - please contact the person who sent you this link.</p>
      : <><p>This case has no registry research yet, so a chart could not be compared and some questions would never be asked. Run the research for this company first.</p><a href={DEMO_START_PATH}>Start research</a></>}
  </main></div>;
}
