import React, { useMemo, useState } from "react";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { readCustomerDemoContext } from "./customerOwnershipChartSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import { CUSTOMER_COMPLETE_PATH, CUSTOMER_DEMO_START_PATH, CUSTOMER_QUESTIONS_PATH } from "./customerRoute";
import { idvSubjectsFromTrace, traceReadyForIdv } from "./idvSubjects";
import { completeIdentityVerification, DISCOVERY_STATE, VERIFICATION_REASON } from "./verificationAssessment";
import "./customerOwnershipChart.css";
import { persistPocCase, smallStableHash } from "../pocCaseClient";
import { uboStore } from "../browserStore";

function readTrace(context) {
  try {
    const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
    if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId) return null;
    return session.researchResult?.ownershipResolutionTrace || null;
  } catch (_) { return null; }
}

function writeTrace(context, trace) {
  try {
    const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
    if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId || !session.researchResult) return false;
    uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString(), researchResult: { ...session.researchResult, ownershipResolutionTrace: trace } }));
    return true;
  } catch (_) { return false; }
}

function customerReason(subject) {
  const codes = subject.reasons?.map(({ code }) => code) || [];
  if (codes.includes(VERIFICATION_REASON.SENIOR_MANAGING_OFFICIAL_FALLBACK)) return "No individual beneficial owner could be established through ownership or control, so identity verification is required for a senior managing official.";
  if (codes.includes(VERIFICATION_REASON.OWNERSHIP_UBO)) return subject.reasons.find(({ code }) => code === VERIFICATION_REASON.OWNERSHIP_UBO)?.detail || "Identified through company ownership.";
  return "Identified through voting rights or control.";
}

export default function CustomerIdvPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const [trace, setTrace] = useState(() => readTrace(context));
  const [pendingPersonId, setPendingPersonId] = useState(null);
  const [saveError, setSaveError] = useState("");
  const subjects = useMemo(() => idvSubjectsFromTrace(trace), [trace]);
  const complete = async (personId) => {
    if (pendingPersonId) return;
    const next = completeIdentityVerification(trace, personId);
    const assessmentId = next?.verificationAssessment?.assessmentVersionId;
    setPendingPersonId(personId); setSaveError("");
    try {
      // The server decides and records the completion from its own stored
      // assessment; the browser sends only who. Its answer is what we show.
      const record = await persistPocCase("COMPLETE_IDV", {
        caseId: context.demoCaseId,
        actorType: "CUSTOMER",
        idempotencyKey: `idv:${smallStableHash([assessmentId, personId, "DEMO"])}`,
        payload: { personId },
      });
      const saved = record?.projection?.assessment?.trace || next;
      writeTrace(context, saved);
      setTrace(saved);
    } catch (cause) { setSaveError(cause.message || "Identity-verification completion could not be saved."); }
    finally { setPendingPersonId(null); }
  };
  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-empty"><span>Identity verification</span><h1>Start with a demo company</h1><a href={CUSTOMER_DEMO_START_PATH}>Enter company details</a></main></div>;
  if (!traceReadyForIdv(trace)) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-empty"><span>Identity verification</span><h1>Finish the questions first</h1><p>Ownership, control or fallback work is still pending. We will not complete onboarding until the final natural-person verification population is ready.</p><a href={CUSTOMER_QUESTIONS_PATH}>Return to questions</a></main></div>;
  const allComplete = trace.discoveryState === DISCOVERY_STATE.IDV_COMPLETE;
  return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={4} /><main className="ubo-customer-main"><div className="ubo-customer-intro"><span>Step 4 · Identity verification</span><h1>Complete identity verification</h1><p>The following people need to complete identity verification before we can complete your application.</p>{saveError && <p className="ubo-customer-error" role="alert">{saveError}</p>}</div><section className="ubo-customer-card ubo-resolution-ubo-results"><h2>People requiring identity verification</h2>{subjects.map((subject) => <article key={subject.personId} className={subject.verificationStatus === "COMPLETED" ? "completed" : ""}><div><strong>{subject.personName}</strong><span>{subject.role}</span><small>{customerReason(subject)}</small></div>{subject.verificationStatus === "COMPLETED" ? <strong className="ubo-idv-completed">✓ Identity verification completed</strong> : <button type="button" disabled={Boolean(pendingPersonId)} onClick={() => complete(subject.personId)}>{pendingPersonId === subject.personId ? "Saving demo completion…" : "Complete identity verification"}</button>}</article>)}</section><section className="ubo-customer-next-step"><div><small>Identity verification demo</small><h2>{allComplete ? "Application information complete" : "Complete identity verification to continue"}</h2><p>This records demo completion only (verification mode: DEMO). It does not represent final compliance approval.</p></div>{allComplete ? <a className="ubo-customer-primary" href={CUSTOMER_COMPLETE_PATH}>Application information complete <span>→</span></a> : <button className="ubo-customer-primary" type="button" disabled>Application information complete <span>→</span></button>}</section></main></div>;
}

export { customerReason, readTrace, writeTrace };
