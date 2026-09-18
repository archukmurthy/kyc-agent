import React from "react";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { CUSTOMER_DEMO_START_PATH } from "./customerRoute";
import "./customerOwnershipChart.css";

export default function CustomerCompletePage() {
  return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={5} /><main className="ubo-customer-empty"><span>Review complete</span><h1>Thank you</h1><p>Your ownership answers and identity-verification population have been recorded for analyst review.</p><a href={CUSTOMER_DEMO_START_PATH}>Start another demo</a></main></div>;
}
