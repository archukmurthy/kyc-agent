import React, { useMemo } from "react";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { CUSTOMER_DEMO_START_PATH, CUSTOMER_IDV_PATH } from "./customerRoute";
import { readCustomerDemoContext } from "./customerOwnershipChartSession";
import { readTrace } from "./CustomerIdvPage";
import { DISCOVERY_STATE } from "./verificationAssessment";
import "./customerOwnershipChart.css";

export default function CustomerCompletePage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const trace = useMemo(() => readTrace(context), [context]);
  if (trace?.discoveryState !== DISCOVERY_STATE.IDV_COMPLETE) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={5} /><main className="ubo-customer-empty"><span>Review not complete</span><h1>Finish identity verification first</h1><p>Every person currently requiring identity verification must complete it before the application information can be marked complete.</p><a href={CUSTOMER_IDV_PATH}>Return to identity verification</a></main></div>;
  return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={5} /><main className="ubo-customer-empty"><span>Review complete</span><h1>Thank you</h1><p>Your ownership answers and identity-verification population have been recorded for analyst review.</p><a href={CUSTOMER_DEMO_START_PATH}>Start another demo</a></main></div>;
}
