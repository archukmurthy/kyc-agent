import React, { useMemo } from "react";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { readCustomerDemoContext } from "./customerOwnershipChartSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { CUSTOMER_COMPLETE_PATH, CUSTOMER_DEMO_START_PATH, CUSTOMER_QUESTIONS_PATH } from "./customerRoute";
import { idvSubjectsFromTrace, traceReadyForIdv } from "./idvSubjects";
import "./customerOwnershipChart.css";

function readTrace(context) {
  try {
    const session = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY) || "null");
    if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId) return null;
    return session.researchResult?.ownershipResolutionTrace || null;
  } catch (_) { return null; }
}

export default function CustomerIdvPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const trace = useMemo(() => readTrace(context), [context]);
  const subjects = useMemo(() => idvSubjectsFromTrace(trace), [trace]);
  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-empty"><span>Identity verification</span><h1>Start with a demo company</h1><a href={CUSTOMER_DEMO_START_PATH}>Enter company details</a></main></div>;
  if (!traceReadyForIdv(trace)) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-empty"><span>Identity verification</span><h1>Finish the questions first</h1><p>Ownership, control or fallback work is still pending. We will not complete onboarding until the final natural-person verification population is ready.</p><a href={CUSTOMER_QUESTIONS_PATH}>Return to questions</a></main></div>;
  return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-main"><div className="ubo-customer-intro"><span>Step 4 · IDV</span><h1>Verify the people identified in this review</h1><p>Each natural person appears once, even where several ownership or control routes apply.</p></div><section className="ubo-customer-card ubo-resolution-ubo-results"><h2>People requiring identity verification</h2>{subjects.map((subject) => <article key={subject.personId}><strong>{subject.personName}</strong><span>{subject.bases.length ? subject.bases.join(" · ").replaceAll("_", " ").toLowerCase() : subject.reason}</span><small>Natural person · identity verification required once</small></article>)}</section><section className="ubo-customer-next-step"><div><small>Identity verification demo</small><h2>Continue when verification is complete</h2><p>This demo records the handoff population; production provider integration remains outside this branch.</p></div><a className="ubo-customer-primary" href={CUSTOMER_COMPLETE_PATH}>Complete review <span>→</span></a></section></main></div>;
}

export { readTrace };
