import React, { useMemo } from "react";
import { ownershipLabelFor } from "../demoSession";
import { customerOwnershipChartSessionForContext, readCustomerDemoContext } from "./customerOwnershipChartSession";
import { CUSTOMER_DEMO_START_PATH, CUSTOMER_OWNERSHIP_CHART_PATH } from "./customerRoute";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import OwnershipResolutionQuestions from "./OwnershipResolutionQuestions";
import "./customerOwnershipChart.css";

function QuestionContext({ context }) {
  return <section className="ubo-customer-context" aria-label="Company being reviewed">
    <div><small>Questions for</small><strong>{context.company.legalName}</strong></div>
    <dl>
      <div><dt>Registration</dt><dd>{context.company.registrationNumber}</dd></div>
      <div><dt>Country</dt><dd>{context.company.countryName}</dd></div>
      <div><dt>Ownership type</dt><dd>{ownershipLabelFor(context.company.ownershipType)}</dd></div>
      {context.referenceCaseId && <div><dt>Case reference</dt><dd>{context.referenceCaseId}</dd></div>}
    </dl>
  </section>;
}

export default function CustomerQuestionsPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const chartSession = useMemo(() => customerOwnershipChartSessionForContext(context), [context]);

  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={3} /><main className="ubo-customer-empty"><span>Customer questions step</span><h1>Start with a demo company</h1><p>This direct route needs seeded demo-session company and case context.</p><a href={CUSTOMER_DEMO_START_PATH}>Enter company details</a></main></div>;
  if (!chartSession?.result) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={3} /><main className="ubo-customer-empty"><span>Customer questions step</span><h1>Complete the ownership step first</h1><p>Upload and process an ownership chart before answering the questions generated from its comparison.</p><a href={CUSTOMER_OWNERSHIP_CHART_PATH}>Go to ownership</a></main></div>;

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={3} />
    <main className="ubo-customer-main">
      <QuestionContext context={context} />
      <div className="ubo-customer-intro"><span>Step 3 · Questions</span><h1>Resolve the remaining ownership and control questions</h1><p>We’ll show only the questions and supporting evidence still needed after comparing your chart with the available independent information.</p></div>
      <a className="ubo-customer-questions-back" href={CUSTOMER_OWNERSHIP_CHART_PATH}>← Back to ownership chart</a>
      <OwnershipResolutionQuestions researchResult={context.researchResult} result={chartSession.result} company={chartSession.result.company || context.company} context={context} />
    </main>
    <footer className="ubo-customer-footer">Demo experience · Browser-local result · Questions and resolution</footer>
  </div>;
}
