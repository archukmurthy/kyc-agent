import React from "react";

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

function identityVerificationStatus(assessment, verificationSubject, completion) {
  if (verificationSubject?.verificationStatus === "COMPLETED") return "Completed";
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

function OwnershipFactReview({ item }) {
  const source = item.resultingFact || item.customerAssertion || item.independentAssertion;
  const legalEntity = item.holderPartyType === "LEGAL_ENTITY";
  return <article className="ubo-analyst-assessment-card"><header><div><span>{legalEntity ? "Significant ownership link" : "Ownership fact"}</span><h3>{factName(source, "subject")} → {factName(source, "object")}</h3></div><strong>{legalEntity ? "Continue through ownership chain" : humanize(item.ownershipEstablishment)}</strong></header><dl><div><dt>Customer chart</dt><dd>{measurement(item.customerAssertion?.measurement)}</dd></div><div><dt>Independent information</dt><dd>{measurement(item.independentAssertion?.measurement)}</dd></div><div><dt>Relationship outcome</dt><dd>{humanize(item.ownershipLink?.outcome)}</dd></div><div><dt>Holder type</dt><dd>{legalEntity ? "Legal entity" : humanize(item.holderPartyType)}</dd></div><div><dt>UBO consequence</dt><dd>{legalEntity ? "Continue through ownership chain" : "Included in the person's aggregate assessment"}</dd></div>{legalEntity && <div><dt>Identity verification</dt><dd>Not applicable — legal entity</dd></div>}</dl>{item.reason && <p>{item.reason}</p>}</article>;
}

function AuditFact({ item }) {
  const source = item.resultingFact || item.customerAssertion || item.independentAssertion;
  return <article className="ubo-analyst-audit-card"><h3>{factName(source, "subject")} → {factName(source, "object")}</h3><dl><dt>Original comparison</dt><dd>{item.originalComparison?.status || "DECLARATION"} · {item.originalComparison?.detail || "No comparison detail"}</dd><dt>Customer assertion</dt><dd>{measurement(item.customerAssertion?.measurement)}</dd><dt>Independent assertion</dt><dd>{measurement(item.independentAssertion?.measurement)}</dd><dt>Fact requirements</dt><dd>{item.factRequirements?.map(({ type }) => type).join(", ") || "None"}</dd><dt>Questions generated</dt><dd>{item.questions?.map(({ prompt, status, answer }) => `${prompt} [${status}]${answer !== undefined ? ` Answer: ${answer}` : ""}`).join(" · ") || "Not required"}</dd><dt>Evidence</dt><dd>{item.evidence?.map(({ status, purpose }) => `${status}: ${purpose}`).join(" · ") || "Not required"}</dd><dt>Resulting fact</dt><dd>{item.resultingFact ? measurement(item.resultingFact.measurement) : "None"}</dd><dt>Ownership establishment</dt><dd>{item.ownershipEstablishment}</dd><dt>Path / edge outcome</dt><dd>{item.ownershipLink?.outcome || "Not applicable"}</dd><dt>Resolution state</dt><dd>{item.resolutionStatus}</dd><dt>Reason</dt><dd>{item.reason || "Not recorded"}</dd></dl></article>;
}

export default function AnalystResolutionView({ mode, demoCase, result }) {
  const trace = result?.ownershipResolutionTrace;
  const audit = mode === "AUDIT";
  if (!trace) return <main className="ubo-demo-results"><section className="ubo-demo-review-wait"><span className="ubo-demo-eyebrow">{audit ? "Audit" : "Analyst review"}</span><h1>Customer resolution trace is not available yet</h1><p>Complete the customer ownership and Questions steps. This page will update when the shared Questions Engine records its conclusions.</p></section></main>;
  const people = trace.personOwnershipAssessments || [];
  const facts = trace.ownershipFacts || [];
  const verification = trace.verificationAssessment;
  const verificationPopulation = verification?.verificationPopulation || trace.verificationPopulation || [];
  const completions = trace.idvCompletionHistory || [];
  const summary = verification?.summary || {};
  return <main className="ubo-demo-results ubo-analyst-resolution"><header className="ubo-demo-result-heading"><div><span className="ubo-demo-eyebrow">{audit ? "Audit" : "Analyst review"}</span><h1>{audit ? "Analyst reasoning and traceability" : "Assessment Details"}</h1><p>{demoCase?.company?.legalName} · {audit ? "Technical engine history and policy record" : "What the system concluded and why"}</p></div></header>
    {!audit ? <>
      <section className="ubo-demo-card ubo-analyst-summary"><h2>Current ownership/control assessment</h2><p>Legal-entity links are traversal steps. UBO and IDV conclusions are made only for canonical natural-person assessments.</p><dl><div><dt>Natural persons assessed</dt><dd>{summary.naturalPersonsAssessed ?? people.length}</dd></div><div><dt>Beneficial owners identified</dt><dd>{summary.beneficialOwnersIdentified ?? trace.uboAssessments?.length ?? 0}</dd></div><div><dt>People requiring IDV</dt><dd>{summary.peopleRequiringIdv ?? verificationPopulation.length}</dd></div><div><dt>IDV completed</dt><dd>{summary.idvCompleted ?? completions.length} of {summary.peopleRequiringIdv ?? verificationPopulation.length}</dd></div><div><dt>Current journey state</dt><dd>{humanize(trace.discoveryState)}</dd></div><div><dt>Assessment version</dt><dd>{verification?.assessmentVersionId || "Not finalized"}</dd></div></dl></section>
      <section className="ubo-analyst-section"><h2>Significant ownership relationships</h2>{facts.length ? facts.map((item) => <OwnershipFactReview key={item.id} item={item} />) : <p>No ownership facts have been recorded.</p>}</section>
      <section className="ubo-analyst-section"><h2>Natural-person UBO assessments</h2>{people.length ? people.map((item) => <PersonAssessment key={item.assessmentId} assessment={item} verificationSubject={verificationPopulation.find((subject) => samePerson(subject, item))} completion={completions.find((completion) => samePerson(completion, item))} />) : <p>No aggregate natural-person ownership assessment is available yet.</p>}</section>
      <section className="ubo-analyst-section"><h2>Current identity-verification population</h2>{verificationPopulation.length ? verificationPopulation.map((subject) => <article className="ubo-analyst-assessment-card" key={subject.personId}><header><div><span>{subject.role}</span><h3>{subject.personName}</h3></div><strong>{subject.verificationStatus === "COMPLETED" ? "Completed" : "Required"}</strong></header><p>{subject.reasons?.map(({ detail }) => detail).join(" ")}</p></article>) : <p>No current natural-person identity-verification requirement is available.</p>}</section>
    </> : <>
      <section className="ubo-analyst-section"><h2>A. Ownership facts and paths</h2>{facts.length ? facts.map((item) => <AuditFact key={item.id} item={item} />) : <p>No ownership fact trace is available.</p>}</section>
      <section className="ubo-analyst-section"><h2>B. Natural-person UBO assessments</h2>{people.length ? people.map((item) => <PersonAssessment key={item.assessmentId} assessment={item} verificationSubject={verificationPopulation.find((subject) => samePerson(subject, item))} completion={completions.find((completion) => samePerson(completion, item))} audit />) : <p>No aggregate natural-person assessment is available.</p>}</section>
      <section className="ubo-demo-card ubo-analyst-audit-card"><h2>Control and fallback audit</h2><dl><dt>Control status</dt><dd>{trace.controlResolution?.status || "NOT_STARTED"}</dd><dt>Fallback outcome</dt><dd>{trace.fallback?.outcome || "NOT_ACTIVATED"}</dd><dt>Ownership routes assessed</dt><dd>{trace.auditTrail?.ownershipRoutesAssessed?.join(", ") || "None"}</dd><dt>Control routes assessed</dt><dd>{trace.auditTrail?.controlRoutesAssessed?.join(", ") || "None"}</dd><dt>Fallback reason</dt><dd>{trace.auditTrail?.fallbackReason || "Not applicable"}</dd></dl></section>
      <section className="ubo-analyst-section"><h2>Assessment and identity-verification history</h2>{(trace.auditEvents || []).length ? (trace.auditEvents || []).map((item) => <article className="ubo-analyst-audit-card" key={item.eventId}><h3>{humanize(item.type)}</h3><dl><dt>Recorded at</dt><dd>{item.occurredAt}</dd><dt>Assessment version</dt><dd>{item.assessmentVersionId}</dd>{item.personName && <><dt>Person</dt><dd>{item.personName}</dd></>}{item.from !== undefined && <><dt>Changed from</dt><dd>{String(item.from)}</dd><dt>Changed to</dt><dd>{String(item.to)}</dd></>}</dl></article>) : <p>No assessment transition has been recorded.</p>}</section>
      {(verification?.diagnosticIssues || []).length > 0 && <section className="ubo-analyst-section"><h2>Assessment diagnostics</h2>{verification.diagnosticIssues.map((item) => <p key={`${item.code}:${item.partyId}`}>{item.code}: {item.message}</p>)}</section>}
    </>}
  </main>;
}
