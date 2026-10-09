import React, { useState } from "react";
import { persistPocCase } from "./pocCaseClient";

function humanize(value) { return String(value || "Not recorded").replaceAll("_", " ").toLowerCase(); }
function measurement(value) {
  if (!value || value.type === "UNKNOWN") return "Not established";
  if (value.type === "EXACT") return `${value.value}%`;
  if (value.type === "RANGE") return `${value.lowerBound ?? 0}%–${value.upperBound ?? 100}%`;
  return humanize(value.type);
}
function factName(fact, side) { return fact?.[side]?.name || "Unknown party"; }
function normalized(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function samePerson(left, right) { return normalized(left?.personId || left?.personName) === normalized(right?.personId || right?.personName); }
function isRelationshipFact(fact) { return fact?.type === "RELATIONSHIP" || Boolean(fact?.subject && fact?.object); }
function declarationHeading(item, companyName) {
  if (item.resultingFact?.attribute === "nominee_arrangement" || item.resultingFact?.type === "NOMINEE_ARRANGEMENT") return `Nominee arrangement for ${companyName || "the company under review"}`;
  return humanize(item.resultingFact?.attribute || item.resultingFact?.type || "Customer declaration");
}
function declarationValue(fact) {
  if (fact?.attribute === "nominee_arrangement") return fact.value === false ? "No nominee arrangement declared" : fact.value === true ? "Nominee arrangement declared" : "Not established";
  if (fact?.type === "NOMINEE_ARRANGEMENT") return "Nominee arrangement declared";
  return fact?.value == null ? "Not recorded" : humanize(fact.value);
}

// The server labels each completion it records ("DEMO - not verified" in this demo).
const completedLabel = (completion) => completion?.verificationLabel || "Completed";

function identityVerificationStatus(assessment, verificationSubject, completion) {
  if (verificationSubject?.verificationStatus === "COMPLETED") return completedLabel(completion);
  if (verificationSubject?.currentRequirementStatus === "REQUIRED") return "Required";
  if (completion) return "No longer required — completed under an earlier assessment";
  return assessment.idvRequired ? "Required" : "Not required";
}

function PersonAssessment({ assessment, audit = false, verificationSubject, completion }) {
  const threshold = assessment.threshold || {};
  return <article className="ubo-analyst-assessment-card">
    <header><div><span>Natural-person ownership assessment</span><h3>{assessment.personName}</h3></div><strong>{assessment.determination === "DEFINITE_UBO" ? "UBO identified" : assessment.determination === "DEFINITE_NON_UBO" ? "Not identified as UBO" : "Indeterminate"}</strong></header>
    <dl><div><dt>Party type</dt><dd>Natural person</dd></div><div><dt>Ownership paths</dt><dd>{assessment.ownershipPaths?.length || 0}</dd></div><div><dt>Aggregate effective ownership</dt><dd>{measurement(assessment.aggregateEffectiveOwnership)}</dd></div><div><dt>Applicable threshold</dt><dd>{threshold.comparator || ">="}{threshold.value ?? 25}%</dd></div><div><dt>Identity verification</dt><dd>{identityVerificationStatus(assessment, verificationSubject, completion)}</dd></div>{audit && <><div><dt>Policy</dt><dd>{assessment.policyId} · {assessment.policyVersion}</dd></div><div><dt>Machine result</dt><dd>{assessment.determination}</dd></div></>}</dl>
    <details open={audit}><summary>Ownership paths considered</summary>{(assessment.ownershipPaths || []).map((path) => <section key={path.pathId}><strong>{path.route}</strong><dl><div><dt>Direct ownership</dt><dd>{measurement(path.directOwnership)}</dd></div>{path.downstreamOwnership?.length > 0 && <div><dt>Downstream ownership</dt><dd>{path.downstreamOwnership.map(measurement).join(" × ")}</dd></div>}<div><dt>Effective ownership on this path</dt><dd>{measurement(path.effectiveOwnership)}</dd></div>{audit && <div><dt>Relationship references</dt><dd>{path.relationshipIds?.join(", ") || "None"}</dd></div>}</dl></section>)}</details>
  </article>;
}

function OwnershipFactReview({ item, companyName }) {
  const source = item.resultingFact || item.customerAssertion || item.independentAssertion;
  if (!isRelationshipFact(source)) return <article className="ubo-analyst-assessment-card"><header><div><span>Customer ownership declaration</span><h3>{declarationHeading(item, companyName)}</h3></div><strong>{humanize(item.ownershipEstablishment)}</strong></header><dl><div><dt>Customer response</dt><dd>{declarationValue(source)}</dd></div><div><dt>Resolution state</dt><dd>{humanize(item.resolutionStatus)}</dd></div><div><dt>Supporting evidence</dt><dd>{item.evidence?.length ? item.evidence.map(({ status }) => humanize(status)).join(", ") : "Not required"}</dd></div><div><dt>UBO consequence</dt><dd>{source?.value === false ? "No nominee ownership route added" : "Nominee ownership is assessed separately"}</dd></div></dl>{item.reason && <p>{item.reason}</p>}</article>;
  // A registry shareholder the customer proved has gone (UBO-51): no longer an
  // owner, so neither a link to follow nor part of anyone's aggregate.
  if (item.holderRemoved) return <article className="ubo-analyst-assessment-card"><header><div><span>Shareholder no longer current</span><h3>{factName(source, "subject")} → {factName(source, "object")}</h3></div><strong>Removed · evidence verified</strong></header><dl><div><dt>Customer chart</dt><dd>Not shown</dd></div><div><dt>Independent information</dt><dd>{measurement(item.independentAssertion?.measurement)}</dd></div><div><dt>Supporting evidence</dt><dd>{item.evidence?.length ? item.evidence.map(({ status }) => humanize(status)).join(", ") : "None"}</dd></div><div><dt>UBO consequence</dt><dd>No current ownership - excluded from the ownership chain and from any aggregate</dd></div></dl>{item.reason && <p>{item.reason}</p>}</article>;
  const legalEntity = item.holderPartyType === "LEGAL_ENTITY";
  return <article className="ubo-analyst-assessment-card"><header><div><span>{legalEntity ? "Significant ownership link" : "Ownership fact"}</span><h3>{factName(source, "subject")} → {factName(source, "object")}</h3></div><strong>{legalEntity ? "Continue through ownership chain" : humanize(item.ownershipEstablishment)}</strong></header><dl><div><dt>Customer chart</dt><dd>{measurement(item.customerAssertion?.measurement)}</dd></div><div><dt>Independent information</dt><dd>{measurement(item.independentAssertion?.measurement)}</dd></div><div><dt>Relationship outcome</dt><dd>{humanize(item.ownershipLink?.outcome)}</dd></div><div><dt>Holder type</dt><dd>{legalEntity ? "Legal entity" : humanize(item.holderPartyType)}</dd></div><div><dt>UBO consequence</dt><dd>{legalEntity ? "Continue through ownership chain" : "Included in the person's aggregate assessment"}</dd></div>{legalEntity && <div><dt>Identity verification</dt><dd>Not applicable — legal entity</dd></div>}</dl>{item.reason && <p>{item.reason}</p>}</article>;
}

function AuditFact({ item, companyName }) {
  const source = item.resultingFact || item.customerAssertion || item.independentAssertion;
  const relationship = isRelationshipFact(source);
  return <article className="ubo-analyst-audit-card"><h3>{relationship ? `${factName(source, "subject")} → ${factName(source, "object")}` : declarationHeading(item, companyName)}</h3><dl><dt>Original comparison</dt><dd>{item.originalComparison?.status || "DECLARATION"} · {item.originalComparison?.detail || "No comparison detail"}</dd><dt>Customer assertion</dt><dd>{relationship ? measurement(item.customerAssertion?.measurement) : declarationValue(source)}</dd><dt>Independent assertion</dt><dd>{relationship ? measurement(item.independentAssertion?.measurement) : "Not applicable"}</dd><dt>Fact requirements</dt><dd>{item.factRequirements?.map(({ type }) => type).join(", ") || "None"}</dd><dt>Questions generated</dt><dd>{item.questions?.map(({ prompt, status, answer }) => `${prompt} [${status}]${answer !== undefined ? ` Answer: ${answer}` : ""}`).join(" · ") || "Not required"}</dd><dt>Evidence</dt><dd>{item.evidence?.map(({ status, purpose }) => `${status}: ${purpose}`).join(" · ") || "Not required"}</dd><dt>Resulting fact</dt><dd>{relationship ? measurement(item.resultingFact?.measurement) : declarationValue(source)}</dd><dt>Ownership establishment</dt><dd>{item.ownershipEstablishment}</dd><dt>Path / edge outcome</dt><dd>{item.ownershipLink?.outcome || "Not applicable"}</dd><dt>Resolution state</dt><dd>{item.resolutionStatus}</dd><dt>Reason</dt><dd>{item.reason || "Not recorded"}</dd></dl></article>;
}

// Reopening sets the finalised assessment aside and keeps the customer's
// answers and uploads (REOPEN_CASE, analyst only). The page then reloads the
// case from the server, which is where it now stands.
async function reopenOnServer(caseId, idempotencyKey) {
  await persistPocCase("REOPEN_CASE", { caseId, idempotencyKey, actorType: "ANALYST", payload: {} });
  window.location.reload();
}

function ReopenReview({ caseId, verification, reopenCase }) {
  const [stage, setStage] = useState("IDLE");
  const [error, setError] = useState("");
  const reopen = async () => {
    setStage("SAVING");
    setError("");
    try {
      await reopenCase(caseId, `reopen:${verification.assessmentVersionId}:${verification.calculatedAt || Date.now()}`);
    } catch (caught) {
      setError(caught.message);
      setStage("IDLE");
    }
  };
  return <section className="ubo-demo-card ubo-analyst-summary"><h2>Finalised review</h2>
    {stage === "IDLE" && <button type="button" onClick={() => setStage("CONFIRM")}>Reopen review</button>}
    {stage !== "IDLE" && <><p>The finalised assessment is set aside and the customer can change their answers again. Their answers, uploads and completed identity checks are kept.</p>
      <button type="button" onClick={reopen} disabled={stage === "SAVING"}>{stage === "SAVING" ? "Reopening…" : "Yes, reopen"}</button> <button type="button" onClick={() => setStage("IDLE")} disabled={stage === "SAVING"}>Cancel</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function AnalystResolutionView({ mode, demoCase, result, reopenCase = reopenOnServer }) {
  const trace = result?.ownershipResolutionTrace;
  const audit = mode === "AUDIT";
  if (!trace) return <main className="ubo-demo-results"><section className="ubo-demo-review-wait"><span className="ubo-demo-eyebrow">{audit ? "Audit" : "Analyst review"}</span><h1>Waiting for the customer</h1>{demoCase?.demoCaseId && <p className="ubo-demo-case-reference">{demoCase.company?.legalName} · case {String(demoCase.demoCaseId).replace(/^demo-/, "").slice(0, 8)}</p>}<p>The customer has not finalised their answers on this case yet. This page shows the assessment once they do.{audit ? " Every step so far is in the case ledger below." : ""}</p><p>If you have not sent them their link yet, create it on the research page. If you reopened this review, their earlier answers, uploads and identity checks are kept.</p></section></main>;
  const people = trace.personOwnershipAssessments || [];
  const facts = trace.ownershipFacts || [];
  const relationshipFacts = facts.filter((item) => isRelationshipFact(item.resultingFact || item.customerAssertion || item.independentAssertion));
  const declarationFacts = facts.filter((item) => !relationshipFacts.includes(item));
  const verification = trace.verificationAssessment;
  const verificationPopulation = verification?.verificationPopulation || trace.verificationPopulation || [];
  const completions = trace.idvCompletionHistory || [];
  const summary = verification?.summary || {};
  return <main className="ubo-demo-results ubo-analyst-resolution"><header className="ubo-demo-result-heading"><div><span className="ubo-demo-eyebrow">{audit ? "Audit" : "Analyst review"}</span><h1>{audit ? "Analyst reasoning and traceability" : "Assessment Details"}</h1><p>{demoCase?.company?.legalName} · {audit ? "Technical engine history and policy record" : "What the system concluded and why"}</p></div></header>
    {!audit ? <>
      {verification?.finalized && demoCase?.demoCaseId && <ReopenReview caseId={demoCase.demoCaseId} verification={verification} reopenCase={reopenCase} />}
      <section className="ubo-demo-card ubo-analyst-summary"><h2>Current ownership/control assessment</h2><p>Legal-entity links are traversal steps. UBO and IDV conclusions are made only for canonical natural-person assessments.</p><dl><div><dt>Natural persons assessed</dt><dd>{summary.naturalPersonsAssessed ?? people.length}</dd></div><div><dt>Beneficial owners identified</dt><dd>{summary.beneficialOwnersIdentified ?? trace.uboAssessments?.length ?? 0}</dd></div><div><dt>People requiring IDV</dt><dd>{summary.peopleRequiringIdv ?? verificationPopulation.length}</dd></div><div><dt>{completions.some((completion) => completion.verificationMode === "DEMO") ? "IDV completed (demo - not verified)" : "IDV completed"}</dt><dd>{summary.idvCompleted ?? completions.length} of {summary.peopleRequiringIdv ?? verificationPopulation.length}</dd></div><div><dt>Current journey state</dt><dd>{humanize(trace.discoveryState)}</dd></div><div><dt>Assessment version</dt><dd>{verification?.assessmentVersionId || "Not finalized"}</dd></div></dl></section>
      <section className="ubo-analyst-section"><h2>Significant ownership relationships</h2>{relationshipFacts.length ? relationshipFacts.map((item) => <OwnershipFactReview key={item.id} item={item} companyName={demoCase?.company?.legalName} />) : <p>No significant ownership relationships have been recorded.</p>}</section>
      {declarationFacts.length > 0 && <section className="ubo-analyst-section"><h2>Ownership declarations</h2>{declarationFacts.map((item) => <OwnershipFactReview key={item.id} item={item} companyName={demoCase?.company?.legalName} />)}</section>}
      <section className="ubo-analyst-section"><h2>Natural-person UBO assessments</h2>{people.length ? people.map((item) => <PersonAssessment key={item.assessmentId} assessment={item} verificationSubject={verificationPopulation.find((subject) => samePerson(subject, item))} completion={completions.find((completion) => samePerson(completion, item))} />) : <p>No aggregate natural-person ownership assessment is available yet.</p>}</section>
      <section className="ubo-analyst-section"><h2>Current identity-verification population</h2>{verificationPopulation.length ? verificationPopulation.map((subject) => <article className="ubo-analyst-assessment-card" key={subject.personId}><header><div><span>{subject.role}</span><h3>{subject.personName}</h3></div><strong>{subject.verificationStatus === "COMPLETED" ? completedLabel(completions.find((completion) => samePerson(completion, subject))) : "Required"}</strong></header><p>{subject.reasons?.map(({ detail }) => detail).join(" ")}</p></article>) : <p>No current natural-person identity-verification requirement is available.</p>}</section>
    </> : <>
      <section className="ubo-analyst-section"><h2>A. Ownership facts and paths</h2>{facts.length ? facts.map((item) => <AuditFact key={item.id} item={item} companyName={demoCase?.company?.legalName} />) : <p>No ownership fact trace is available.</p>}</section>
      <section className="ubo-analyst-section"><h2>B. Natural-person UBO assessments</h2>{people.length ? people.map((item) => <PersonAssessment key={item.assessmentId} assessment={item} verificationSubject={verificationPopulation.find((subject) => samePerson(subject, item))} completion={completions.find((completion) => samePerson(completion, item))} audit />) : <p>No aggregate natural-person assessment is available.</p>}</section>
      <section className="ubo-demo-card ubo-analyst-audit-card"><h2>Control and fallback audit</h2><dl><dt>Control status</dt><dd>{trace.controlResolution?.status || "NOT_STARTED"}</dd><dt>Fallback outcome</dt><dd>{trace.fallback?.outcome || "NOT_ACTIVATED"}</dd><dt>Ownership routes assessed</dt><dd>{trace.auditTrail?.ownershipRoutesAssessed?.join(", ") || "None"}</dd><dt>Control routes assessed</dt><dd>{trace.auditTrail?.controlRoutesAssessed?.join(", ") || "None"}</dd><dt>Fallback reason</dt><dd>{trace.auditTrail?.fallbackReason || "Not applicable"}</dd></dl></section>
      <section className="ubo-analyst-section"><h2>Assessment and identity-verification history</h2>{(trace.auditEvents || []).length ? (trace.auditEvents || []).map((item) => <article className="ubo-analyst-audit-card" key={item.eventId}><h3>{humanize(item.type)}</h3><dl><dt>Recorded at</dt><dd>{item.occurredAt}</dd><dt>Assessment version</dt><dd>{item.assessmentVersionId}</dd>{item.personName && <><dt>Person</dt><dd>{item.personName}</dd></>}{item.from !== undefined && <><dt>Changed from</dt><dd>{String(item.from)}</dd><dt>Changed to</dt><dd>{String(item.to)}</dd></>}</dl></article>) : <p>No assessment transition has been recorded.</p>}</section>
      {(verification?.diagnosticIssues || []).length > 0 && <section className="ubo-analyst-section"><h2>Assessment diagnostics</h2>{verification.diagnosticIssues.map((item) => <p key={`${item.code}:${item.partyId}`}>{item.code}: {item.message}</p>)}</section>}
    </>}
  </main>;
}
