(function () {
  "use strict";

  const h = React.createElement;
  const { OwnershipGraph, UboJourney, UboApplicantJourneyV2, DETAIL_LEVEL } = UboControlUI;
  const preingestedGraphViews = UboLabPreingestedEvidenceGraphViews;
  const API = "/api/ubo-control-lab";
  const TABS = ["CUSTOMER", "COMPLIANCE", "DECISIONS", "SOURCES", "HISTORY", "PLANNER", "EVIDENCE", "FEEDBACK", "DIAGNOSTICS"];
  const REVIEW_TABS = ["CASE_SUMMARY", "APPLICANT_JOURNEY_V2", "APPLICANT_PREVIEW", "CONTRACT_INSPECTOR", "OWNERSHIP_AND_CONTROL_GRAPH", "QUALIFICATIONS", "REQUIREMENTS_AND_CAUSAL_NEEDS", "RESOLUTION_PLAN", "EVIDENCE", "DECISION_HISTORY", "DIAGNOSTICS", "BASELINE_COMPARISON"];
  const GRAPH_FILTERS = ["OWNERSHIP", "VOTING", "CONTROL", "ALL"];
  let replayLibrary = null;
  try { replayLibrary = UboLabReplay.createReplayLibrary(window.localStorage); } catch (_error) { replayLibrary = null; }
  let applicantSessionCache = null;
  try { applicantSessionCache = UboLabApplicantSessions.createApplicantSessionCache(window.localStorage); } catch (_error) { applicantSessionCache = null; }
  let preingestedEvidenceCache = null;
  try { preingestedEvidenceCache = UboLabPreingestedEvidenceSessions.createCache(window.localStorage); } catch (_error) { preingestedEvidenceCache = null; }

  async function request(operation, payload) {
    const response = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ operation, payload }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || data.error || "Lab request failed");
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function shortHash(value) {
    return String(value || "—").replace("sha256:", "").slice(0, 12);
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function human(value) {
    const recorded = value === null || value === undefined || value === "" ? "Not recorded" : value;
    return String(recorded).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
  }

  function relationshipFilter(relationship) {
    if (relationship.dimension === "ECONOMIC" || relationship.relationshipType === "ECONOMIC_OWNERSHIP" || relationship.relationshipType === "TRUST_OWNERSHIP") return "OWNERSHIP";
    if (relationship.dimension === "VOTING" || relationship.relationshipType === "VOTING_RIGHTS") return "VOTING";
    return "CONTROL";
  }

  function filteredReviewGraph(graph, filter, entityDirectory) {
    const names = new Map((entityDirectory || []).map(({ entityId, party }) => [entityId, party?.name || party?.primaryName || entityId]));
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, primaryName: names.get(node.entityId) || node.primaryName || node.entityId })),
      relationships: filter === "ALL" ? graph.relationships : graph.relationships.filter((relationship) => relationshipFilter(relationship) === filter),
    };
  }

  function Metric({ label, value }) {
    return h("div", { className: "metric" }, h("span", null, label), h("strong", null, value ?? "—"));
  }

  function Empty({ children }) {
    return h("div", { className: "empty" }, children);
  }

  function PolicyReadinessWatermark({ readiness }) {
    if (!readiness?.watermarkRequired) return null;
    const identity = readiness.policyIdentity;
    return h("aside", { className: "policy-watermark", role: "status", "aria-label": "Policy readiness warning" },
      h("strong", null, "REVIEW POLICY — NOT APPROVED FOR PRODUCTION"),
      h("span", null, `${identity.policyPackId} · ${identity.version} · ${readiness.readiness} · ${readiness.blockingReasons.length} production blocker(s) · ${readiness.unresolvedSignoffs.length} unresolved sign-off(s)`));
  }

  function ResolutionExplanation({ view }) {
    const item = view.resolutionExplanation;
    const headline = item.noCustomerAction
      ? item.currentWave.actor === "SYSTEM" ? "Customer action is deferred while recorded system work runs"
        : item.currentWave.actor === "INTERNAL_REVIEW" ? "Customer action is deferred for internal review"
          : "No customer action is currently executable"
      : `${item.customerResolvableNeeds} customer-resolvable needs are now in the active wave`;
    return h("section", { className: "resolution-explanation", "aria-label": "Resolution state explanation" },
      h("div", null, h("p", { className: "source-label" }, "RESOLUTION STATE"), h("h3", null, headline), h("p", null, `Wave: ${human(item.currentWave.state)} · ${human(item.currentWave.actor)} · ${item.currentWave.actionCount} action(s).`)),
      h("div", { className: "grid-3" },
        h(Metric, { label: "Open InformationNeeds", value: item.openInformationNeeds }),
        h(Metric, { label: "ResolutionOptions", value: item.currentResolutionOptions }),
        h(Metric, { label: "System actions remaining", value: item.systemActionsRemaining }),
        h(Metric, { label: "Customer-resolvable", value: item.customerResolvableNeeds }),
        h(Metric, { label: "Internal-review needs", value: item.internalReviewNeeds }),
        h(Metric, { label: "Policy-content blocked", value: item.policyContentBlockedNeeds })),
      h("details", null, h("summary", null, "Resolution route breakdown"), h("pre", { className: "json" }, pretty(item.optionSummary))));
  }

  function NaturalPersonAssessments({ view }) {
    const nodes = new Map(view.graph.nodes.map((node) => [node.entityId, node]));
    const people = view.graph.nodes.filter(({ category }) => category === "NATURAL_PERSON");
    return h("div", { className: "person-assessments" }, people.map((person) => {
      const relationships = view.graph.relationships.filter(({ sourceEntityId }) => sourceEntityId === person.entityId);
      const calculations = view.compliance.calculations.filter(({ subjectEntityId }) => subjectEntityId === person.entityId);
      const bases = view.compliance.basisAssessments.filter(({ holderEntityId }) => holderEntityId === person.entityId);
      const qualification = view.graph.qualifications.find(({ entityId }) => entityId === person.entityId);
      const support = relationships.flatMap(({ support: relationshipSupport }) => relationshipSupport?.evidenceReferences || []);
      return h("article", { className: "person-assessment", key: person.entityId },
        h("div", null, h("strong", null, person.displayName), h("span", { className: qualification ? "state RESOLVED" : "state UNRESOLVED" }, qualification ? "Confirmed qualifying person" : "Not a confirmed UBO")),
        h("dl", null,
          h("dt", null, "Candidate / source fact"), h("dd", null, support.length ? support.map(({ system, referenceId }) => `${system} · ${referenceId}`).join("; ") : "No displayable source reference"),
          h("dt", null, "Operative relationship(s)"), h("dd", null, relationships.length ? relationships.map((relationship) => `${human(relationship.relationshipType)} ${human(relationship.measurement?.type)} ${relationship.measurement?.type === "RANGE" ? `${relationship.measurement.lowerBound}–${relationship.measurement.upperBound}%` : relationship.measurement?.value ?? ""} → ${nodes.get(relationship.targetEntityId)?.displayName}`).join("; ") : "None"),
          h("dt", null, "Economic calculation"), h("dd", null, calculations.filter(({ dimension }) => dimension === "ECONOMIC").length ? pretty(calculations.filter(({ dimension }) => dimension === "ECONOMIC")) : "None recorded"),
          h("dt", null, "Voting / control basis"), h("dd", null, relationships.filter(({ dimension }) => dimension !== "ECONOMIC").length ? relationships.filter(({ dimension }) => dimension !== "ECONOMIC").map((relationship) => `${human(relationship.relationshipType)} · ${relationship.measurement?.type === "RANGE" ? `(${relationship.measurement.lowerBound}%, ${relationship.measurement.upperBound}%]` : human(relationship.measurement?.type)}`).join("; ") : "None recorded"),
          h("dt", null, "G2.3 assessment"), h("dd", null, bases.length ? bases.map(({ requirementId, basisType, state, rationaleCode }) => `${requirementId} · ${human(basisType)} · ${human(state)} · ${human(rationaleCode)}`).join("; ") : "No determinative qualifying basis recorded"),
          h("dt", null, "Qualification result"), h("dd", null, qualification ? "Qualifies from an actual recorded G2.3 basis." : "Does not currently qualify: the source person is not itself a UBO conclusion, and no determinative threshold/control basis reaches the customer subject.")));
    }));
  }

  function Setup({ catalogue, mode, setMode, busy, error, startFixture, startLive, startReplay, savedResults, deleteReplay, clearReplays, storageError }) {
    const [fixtureId, setFixtureId] = React.useState("LAB18");
    const [company, setCompany] = React.useState({ legalEntityName: "", registrationNumber: "", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" });
    const update = (field, value) => setCompany((current) => ({ ...current, [field]: value }));
    return h("main", { className: "shell setup" },
      h("nav", { className: "mode-list", "aria-label": "Lab mode" },
        h("button", { className: `mode-button ${mode === "FIXTURE" ? "active" : ""}`, onClick: () => setMode("FIXTURE") }, h("strong", null, "Fixture Mode"), h("span", null, "Repeatable deterministic compliance scenarios.")),
        h("button", { className: `mode-button ${mode === "LIVE_DISCOVERY" ? "active" : ""}`, onClick: () => setMode("LIVE_DISCOVERY") }, h("strong", null, "Live Discovery"), h("span", null, "Real UK discovery through the accepted server-side adapter.")),
        h("button", { className: "mode-button", disabled: true, title: "Evidence Platform integration is pending" }, h("strong", null, "Live Evidence"), h("span", null, "Unavailable until Gate 4 — Evidence Platform integration is pending."))),
      h("section", { className: "card" },
        h("p", { className: "source-label" }, mode === "FIXTURE" ? "SIMULATED FIXTURE" : "LAB TEST COST CONTROL / REPLAY"),
        h("h2", null, mode === "FIXTURE" ? "Choose a compliance scenario" : "Reuse Discovery input or run a fresh search"),
        h("p", null, mode === "FIXTURE" ? "Every scenario runs through Decision Application v2 and creates a real immutable snapshot." : "Replay reuses only the saved normalized DiscoveryService result and starts a new downstream UBO exercise."),
        mode === "FIXTURE"
          ? h("div", { className: "form-grid" },
            h("div", { className: "field full" }, h("label", { htmlFor: "fixture" }, "Scenario"), h("select", { id: "fixture", value: fixtureId, onChange: (event) => setFixtureId(event.target.value) }, (catalogue?.fixtures || []).map((fixture) => h("option", { key: fixture.id, value: fixture.id }, `${fixture.id} · ${fixture.label}`)))),
            h("div", { className: "field full" }, h("p", null, catalogue?.fixtures.find(({ id }) => id === fixtureId)?.description || "")),
            h("div", { className: "field" }, h("label", { htmlFor: "fixture-risk" }, "Risk context"), h("select", { id: "fixture-risk", value: company.riskLevel, onChange: (event) => update("riskLevel", event.target.value) }, ["LOW", "MEDIUM", "HIGH"].map((value) => h("option", { key: value }, value)))),
            h("div", { className: "field", style: { alignSelf: "end" } }, h("button", { className: "primary", disabled: busy, onClick: () => startFixture(fixtureId, company.riskLevel) }, busy ? "Running…" : "Run UBO")))
          : h("div", null,
            h("section", { className: "replay-library", "aria-label": "Saved Discovery results" },
              h("div", { className: "replay-heading" }, h("div", null, h("h3", null, "Replay saved result"), h("p", null, "No external Discovery request. No paid search.")), h("span", { className: "source-label" }, "SAVED LOCALLY")),
              h("p", { className: "local-storage-note" }, "Saved locally in this browser — Lab testing only"),
              storageError && h("div", { className: "error", role: "alert" }, storageError, h("button", { type: "button", className: "danger", onClick: clearReplays }, "Clear invalid local data")),
              savedResults.length
                ? h("div", { className: "replay-list" }, savedResults.map((record) => h("article", { className: "replay-item", key: record.replayId },
                  h("div", null, h("span", { className: "source-label" }, "CAPTURED LIVE RESULT"), h("strong", null, record.companyContext.legalEntityName), h("p", null, `${record.companyContext.registrationNumber} · ${record.companyContext.jurisdiction} · Saved ${new Date(record.savedAt).toLocaleString()}`), h("p", null, `${human(record.discoveryResult.outcome.state)} · ${record.discoveryResult.candidateFacts.length} candidate fact(s) · ${record.discoveryResult.issues.length} adapter issue(s)`)),
                  h("div", { className: "actions" }, h("button", { type: "button", className: "primary", disabled: busy, onClick: () => startReplay(record) }, busy ? "Starting replay…" : "Replay as new UBO Lab case"), h("button", { type: "button", className: "danger", disabled: busy, onClick: () => deleteReplay(record.replayId) }, "Delete")))))
                : h(Empty, null, "No captured Live Discovery result is saved in this browser yet.")),
            h("section", { className: "fresh-discovery" },
              h("h3", null, "Run fresh live Discovery"),
              h("div", { className: "notice" }, "Runs the external Discovery service and may incur provider cost. Use Replay for repeated testing."),
              h("form", { className: "form-grid", onSubmit: (event) => { event.preventDefault(); startLive(company); } },
                h("div", { className: "field" }, h("label", { htmlFor: "name" }, "Legal entity name"), h("input", { id: "name", required: true, value: company.legalEntityName, onInput: (event) => update("legalEntityName", event.target.value), placeholder: "Example Holdings Ltd" })),
                h("div", { className: "field" }, h("label", { htmlFor: "number" }, "Registration/company number"), h("input", { id: "number", required: true, value: company.registrationNumber, onInput: (event) => update("registrationNumber", event.target.value), placeholder: "01234567" })),
                h("div", { className: "field" }, h("label", { htmlFor: "jurisdiction" }, "Jurisdiction"), h("input", { id: "jurisdiction", value: "GB", readOnly: true })),
                h("div", { className: "field" }, h("label", { htmlFor: "profile" }, "Entity profile"), h("select", { id: "profile", value: company.entityProfile, onChange: (event) => update("entityProfile", event.target.value) }, h("option", null, "COMPANY"), h("option", null, "LLP"))),
                h("div", { className: "field" }, h("label", { htmlFor: "risk" }, "Risk context"), h("select", { id: "risk", value: company.riskLevel, onChange: (event) => update("riskLevel", event.target.value) }, ["LOW", "MEDIUM", "HIGH"].map((value) => h("option", { key: value }, value)))),
                h("div", { className: "field", style: { alignSelf: "end" } }, h("button", { type: "submit", className: "secondary", disabled: busy }, busy ? "Running fresh live Discovery…" : "Run fresh live Discovery"))))),
        error && h("div", { className: "error", role: "alert" }, error)));
  }

  function CustomerPanel({ view, onAction, busy, error }) {
    return h("section", { className: "panel" },
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status" }, "Applying the customer response through Decision Application v2…"),
      h(ResolutionExplanation, { view }),
      h(UboJourney, { journey: view.journey, plan: view.plan, graph: view.graph, onAction, className: "lab-customer-journey", graphHeight: 760, showGraphDetails: true }));
  }

  function Requirements({ requirements }) {
    return h("div", { className: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, ["ID", "Requirement", "Applies", "Status", "Basis / support", "Open items"].map((name) => h("th", { key: name }, name)))),
      h("tbody", null, requirements.map((item) => h("tr", { key: item.requirementId },
        h("td", null, h("strong", null, item.requirementId)),
        h("td", null, h("details", null, h("summary", null, item.title), h("p", null, item.description), h("pre", { className: "json" }, pretty(item.rawResolution)))),
        h("td", null, human(item.applicability)),
        h("td", { className: `state ${item.status}` }, human(item.status)),
        h("td", null, `${item.resolutionMethods.length} method(s) · ${item.factReferences.length} fact(s) · ${item.evidenceReferences.length} evidence ref(s)`),
        h("td", null, `${item.informationNeeds.filter(({ state }) => state === "OPEN").length} need(s) · ${item.policyGaps.length} gap(s) · ${item.reviews.length} review(s)`))))));
  }

  function CompliancePanel({ view, session }) {
    const compliance = view.compliance;
    return h("section", { className: "panel" },
      h("div", { className: "grid-3" },
        h(Metric, { label: "Policy", value: `${compliance.policyIdentity.policyPackId} · ${compliance.policyIdentity.policyVersion}` }),
        h(Metric, { label: "Snapshot", value: `#${shortHash(view.snapshot.snapshotId)}` }),
        h(Metric, { label: "Current state", value: human(view.plan.state || compliance.terminal?.terminalOutcome || compliance.terminal?.orchestrationState) }),
        h(Metric, { label: "Entity profile", value: session.caseContext.entityProfile }),
        h(Metric, { label: "Graph version", value: view.graph.decision.graphVersion || view.diagnostics.graphVersion }),
        h(Metric, { label: "Policy hash", value: `#${shortHash(compliance.policyIdentity.policyHash)}` })),
      h("div", { className: "section grid-2" },
        h("div", null, h("h3", null, "Qualifying people and why"), compliance.qualifyingPersons.length ? compliance.qualifyingPersons.map((person) => h("details", { key: person.entityId }, h("summary", null, person.entityId), h("div", null, h("p", null, `Roles: ${(person.roles || []).map(human).join(", ")}`), h("pre", { className: "json" }, pretty(person.bases || []))))) : h(Empty, null, "No qualifying natural person is currently established.")),
        h("div", null, h("h3", null, "Recorded calculations"), compliance.calculations.length ? compliance.calculations.map((calculation) => h("details", { key: calculation.calculationId }, h("summary", null, `${human(calculation.dimension)} · ${calculation.aggregateKnownValue?.value ?? calculation.result?.value ?? "incomplete"}%`), h("pre", { className: "json" }, pretty(calculation)))) : h(Empty, null, "No effective-interest calculation is currently recorded."))),
      h("div", { className: "section" }, h("h3", null, "Natural-person qualification assessment"), compliance.qualifyingPersons.length || view.graph.nodes.some(({ category }) => category === "NATURAL_PERSON") ? h(NaturalPersonAssessments, { view }) : h(Empty, null, "No natural-person source facts are recorded.")),
      h("div", { className: "section" }, h(ResolutionExplanation, { view })),
      h("div", { className: "section" }, h("h3", null, "R01–R14 requirement matrix"), h(Requirements, { requirements: view.requirements })),
      h("div", { className: "section grid-2" },
        [["InformationNeeds", compliance.informationNeeds], ["PolicyGaps", compliance.policyGaps], ["OperationalBlockers", compliance.operationalBlockers], ["Conflicts", compliance.conflicts], ["ReviewRequirements", compliance.reviewRequirements], ["Risk signals", compliance.riskSignals]].map(([title, items]) => h("details", { key: title }, h("summary", null, `${title} · ${items.length}`), h("pre", { className: "json" }, pretty(items))))),
      h("div", { className: "section" }, h("h3", null, "Ownership and control explanation"), h(OwnershipGraph, { projection: view.graph, detailLevel: DETAIL_LEVEL.EXPLAIN, height: 760 })));
  }

  function DecisionsPanel({ session, busy, apply }) {
    const [identity, setIdentity] = React.useState({});
    const [claims, setClaims] = React.useState({});
    const parties = session.decisionTargets.candidateParties || [];
    const claimTargets = session.decisionTargets.candidateClaims || [];
    const directory = session.entityDirectory || [];
    const identityValue = (key) => identity[key] || { action: "REGISTER_NEW", entityId: "" };
    const claimValue = (key) => claims[key] || { resultingState: "OPERATIVE", supersededByClaimIds: "", adversarialClaimIds: "" };
    const submit = () => apply({
      identityDecisions: parties.map((target) => ({ candidatePartyKey: target.candidatePartyKey, ...identityValue(target.candidatePartyKey) })),
      claimDecisions: claimTargets.map((target) => {
        const value = claimValue(target.claimId);
        return {
          claimId: target.claimId,
          resultingState: value.resultingState,
          supersededByClaimIds: value.supersededByClaimIds.split(",").map((item) => item.trim()).filter(Boolean),
          adversarialClaimIds: value.adversarialClaimIds.split(",").map((item) => item.trim()).filter(Boolean),
        };
      }),
    });
    return h("section", { className: "panel" },
      h("h2", null, "Explicit decision consoles"),
      h("p", null, "No fuzzy identity matching or automatic claim adjudication is performed."),
      h("div", { className: "section" }, h("h3", null, `Identity decisions · ${parties.length}`), parties.length ? parties.map((target) => {
        const value = identityValue(target.candidatePartyKey);
        return h("article", { className: "decision", key: target.candidatePartyKey }, h("div", null, h("strong", null, target.party.name || target.candidatePartyKey), h("p", null, target.candidatePartyKey), h("pre", { className: "json" }, pretty(target.party))), h("div", { className: "decision-controls" }, h("label", null, "Decision", h("select", { value: value.action, onChange: (event) => setIdentity((current) => ({ ...current, [target.candidatePartyKey]: { ...value, action: event.target.value } })) }, ["REGISTER_NEW", "RESOLVE_EXISTING", "LEAVE_UNRESOLVED", "REJECT_MATCH"].map((option) => h("option", { key: option }, option)))), value.action === "RESOLVE_EXISTING" && h("label", null, "Canonical entity", h("select", { value: value.entityId, onChange: (event) => setIdentity((current) => ({ ...current, [target.candidatePartyKey]: { ...value, entityId: event.target.value } })) }, h("option", { value: "" }, "Choose entity"), directory.map((entry) => h("option", { key: entry.entityId, value: entry.entityId }, entry.party.name || entry.entityId))))));
      }) : h(Empty, null, "No candidate-party decisions are waiting.")),
      h("div", { className: "section" }, h("h3", null, `Claim adjudication · ${claimTargets.length}`), claimTargets.length ? claimTargets.map((target) => {
        const value = claimValue(target.claimId);
        return h("article", { className: "decision", key: target.claimId }, h("div", null, h("strong", null, `${human(target.claimType)} · ${human(target.relationship)}`), h("p", null, target.claimId), h("pre", { className: "json" }, pretty(target.originatingCandidateFact))), h("div", { className: "decision-controls" }, h("label", null, "Resulting state", h("select", { value: value.resultingState, onChange: (event) => setClaims((current) => ({ ...current, [target.claimId]: { ...value, resultingState: event.target.value } })) }, ["OPERATIVE", "PROVISIONAL", "DISPUTED", "REJECTED", "SUPERSEDED"].map((option) => h("option", { key: option }, option)))), value.resultingState === "SUPERSEDED" && h("label", null, "Superseding claim IDs", h("input", { value: value.supersededByClaimIds, onInput: (event) => setClaims((current) => ({ ...current, [target.claimId]: { ...value, supersededByClaimIds: event.target.value } })) })), value.resultingState === "DISPUTED" && h("label", null, "Adversarial claim IDs", h("input", { value: value.adversarialClaimIds, onInput: (event) => setClaims((current) => ({ ...current, [target.claimId]: { ...value, adversarialClaimIds: event.target.value } })) }))));
      }) : h(Empty, null, "No candidate-claim decisions are waiting.")),
      (parties.length > 0 || claimTargets.length > 0) && h("div", { className: "actions" }, h("button", { className: "primary", disabled: busy, onClick: submit }, busy ? "Applying…" : "Apply explicit decisions and evaluate")));
  }

  function SourcesPanel({ session }) {
    return h("section", { className: "panel" }, h("h2", null, "Candidate facts and provenance"), session.candidateSources.length ? session.candidateSources.map((source) => h("details", { key: source.sourceRecordId }, h("summary", null, `${source.capability} · ${source.outcomeState} · ${source.candidateFacts.length} candidate fact(s)`), h("div", null, h("span", { className: "source-label" }, source.capability === "CUSTOMER_INPUT" ? "CUSTOMER" : source.sourceState || (source.simulated ? "FIXTURE" : "LIVE")), h("p", null, `Request: ${source.requestId}`), h("pre", { className: "json" }, pretty({ facts: source.candidateFacts, evidence: source.operationEvidenceReferences, issues: source.issues }))))) : h(Empty, null, "No candidate sources have been intaken."));
  }

  function PlannerPanel({ view }) {
    return h("section", { className: "panel" }, h("h2", null, "Resolution Planner"), h(ResolutionExplanation, { view }), h("div", { className: "grid-3" }, h(Metric, { label: "Wave", value: human(view.plan.state) }), h(Metric, { label: "Actor", value: human(view.plan.recommendedWave.actor) }), h(Metric, { label: "Prior attempts", value: view.plan.summary.priorResolutionAttempts })), h("div", { className: "section grid-2" }, h("details", { open: true }, h("summary", null, `Recommended actions · ${view.plan.recommendedWave.actions.length}`), h("pre", { className: "json" }, pretty(view.plan.recommendedWave.actions))), h("details", null, h("summary", null, `Customer bundles · ${view.plan.recommendedWave.customerBundles.length}`), h("pre", { className: "json" }, pretty(view.plan.recommendedWave.customerBundles))), h("details", null, h("summary", null, `Deferred alternatives · ${view.plan.deferredAlternatives.length}`), h("pre", { className: "json" }, pretty(view.plan.deferredAlternatives))), h("details", null, h("summary", null, "Rationale"), h("pre", { className: "json" }, pretty(view.plan.rationale)))));
  }

  function HistoryPanel({ session }) {
    const [selected, setSelected] = React.useState(session.snapshots.length - 1);
    const [comparison, setComparison] = React.useState(null);
    React.useEffect(() => { setSelected(session.snapshots.length - 1); }, [session.snapshots.length]);
    React.useEffect(() => {
      if (selected <= 0) { setComparison(null); return; }
      request("COMPARE_SNAPSHOTS", { left: session.snapshots[selected - 1], right: session.snapshots[selected] }).then(setComparison).catch(() => setComparison(null));
    }, [selected, session.snapshots]);
    const entry = session.snapshots[selected];
    if (!entry) return h("section", { className: "panel" }, h(Empty, null, "No DecisionSnapshot exists yet. Resolve the explicit decisions first."));
    return h("section", { className: "panel history" },
      h("div", { className: "history-list", role: "listbox", "aria-label": "Decision snapshot history" },
        session.snapshots.map((item, index) => h("button", {
          className: `history-item ${index === selected ? "active" : ""}`,
          key: item.historyEntryId,
          onClick: () => setSelected(index),
          "aria-selected": index === selected,
        }, h("strong", null, `#${shortHash(item.view.snapshot.snapshotId)}`),
        h("span", null, `${item.reason} · ${item.view.snapshot.decisionContent.checkpoint.evaluationTime}`),
        h("span", null, `Predecessor: ${shortHash(item.predecessorSnapshotId)}`)))),
      h("div", null,
        h("div", { className: "grid-3" },
          h(Metric, { label: "Policy", value: entry.view.snapshot.decisionContent.policy.identity.policyVersion }),
          h(Metric, { label: "State", value: human(entry.view.plan.state) }),
          h(Metric, { label: "Checkpoint", value: entry.view.snapshot.decisionContent.checkpoint.type })),
        comparison && h("details", { open: true }, h("summary", null, "Change from predecessor"), h("pre", { className: "json" }, pretty(comparison))),
        h("h3", { className: "section" }, "Historical graph — projected from this immutable snapshot"),
        h(OwnershipGraph, { projection: entry.view.graph, detailLevel: DETAIL_LEVEL.EXPLAIN }),
        h("details", null, h("summary", null, "Historical journey and requirements"),
          h("pre", { className: "json" }, pretty({ journey: entry.view.journey, requirements: entry.view.requirements })))));
  }

  function EvidencePanel({ view, session }) {
    const references = view.compliance.evidenceManifest?.evidenceReferences || [];
    return h("section", { className: "panel" }, h("p", { className: "source-label" }, "LIVE EVIDENCE DISABLED"), h("h2", null, "Evidence"), h("div", { className: "notice" }, "NOT YET AVAILABLE — EVIDENCE PLATFORM INTEGRATION IN PROGRESS"), h("p", null, "Customer evidence actions produce only a correlated external handoff. There is no fake upload or browser extraction path."), h("h3", { className: "section" }, `Current EvidenceReferences · ${references.length}`), references.length ? h("pre", { className: "json" }, pretty(references)) : h(Empty, null, "No evidence references are present in the current manifest."), h("h3", { className: "section" }, `Pending external handoffs · ${session.externalHandoffs.length}`), session.externalHandoffs.length ? h("pre", { className: "json" }, pretty(session.externalHandoffs)) : h(Empty, null, "No evidence handoff has been requested."));
  }

  function FeedbackPanel({ view, feedback, setFeedback }) {
    const [draft, setDraft] = React.useState({ category: "POLICY", note: "", requirementId: "", entityId: "", workItemId: "" });
    const add = () => {
      if (!draft.note.trim()) return;
      setFeedback((items) => [...items, { feedbackVersion: "ubo-control-lab-feedback-v1", createdAt: new Date().toISOString(), snapshotHash: view.snapshot.decisionContentHash, ...draft, note: draft.note.trim() }]);
      setDraft((current) => ({ ...current, note: "" }));
    };
    const exportPayload = { exportedAt: new Date().toISOString(), sessionOnly: true, items: feedback };
    const copy = async () => navigator.clipboard.writeText(pretty(exportPayload));
    const download = () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([pretty(exportPayload)], { type: "application/json" }));
      link.download = `ubo-control-lab-feedback-${shortHash(view.snapshot.snapshotId)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    };
    return h("section", { className: "panel" }, h("h2", null, "Practitioner feedback"), h("p", null, `Notes are session-only and pinned to snapshot #${shortHash(view.snapshot.snapshotId)}.`), h("div", { className: "form-grid" },
      h("div", { className: "field" }, h("label", null, "Category"), h("select", { value: draft.category, onChange: (event) => setDraft({ ...draft, category: event.target.value }) }, ["POLICY", "QUESTION", "EVIDENCE", "CALCULATION", "UX", "OTHER"].map((value) => h("option", { key: value }, value)))),
      h("div", { className: "field" }, h("label", null, "Requirement (optional)"), h("select", { value: draft.requirementId, onChange: (event) => setDraft({ ...draft, requirementId: event.target.value }) }, h("option", { value: "" }, "No requirement selected"), view.requirements.map(({ requirementId }) => h("option", { key: requirementId }, requirementId)))),
      h("div", { className: "field" }, h("label", null, "Entity ID (optional)"), h("input", { value: draft.entityId, onInput: (event) => setDraft({ ...draft, entityId: event.target.value }) })),
      h("div", { className: "field" }, h("label", null, "Work item ID (optional)"), h("input", { value: draft.workItemId, onInput: (event) => setDraft({ ...draft, workItemId: event.target.value }) })),
      h("div", { className: "field full" }, h("label", null, "Note"), h("textarea", { rows: 4, value: draft.note, onInput: (event) => setDraft({ ...draft, note: event.target.value }) }))),
      h("div", { className: "actions" }, h("button", { className: "primary", onClick: add }, "Add note"), h("button", { className: "secondary", disabled: !feedback.length, onClick: copy }, "Copy JSON"), h("button", { className: "secondary", disabled: !feedback.length, onClick: download }, "Download JSON")),
      h("div", { className: "feedback-list" }, feedback.map((item, index) => h("div", { className: "feedback-item", key: `${item.createdAt}:${index}` }, h("strong", null, item.category), ` · #${shortHash(item.snapshotHash)} · ${item.note}`))));
  }

  function DiagnosticsPanel({ view, session }) {
    return h("section", { className: "panel" }, h("h2", null, "Diagnostics"), h("div", { className: "grid-3" }, h(Metric, { label: "Lab source state", value: session.sourceState }), session.discovery?.replay && h(Metric, { label: "Replay saved", value: new Date(session.discovery.replay.originalSavedAt).toLocaleString() }), Object.entries(view.diagnostics).map(([key, value]) => h(Metric, { key, label: human(key), value: typeof value === "object" ? value.readiness || shortHash(value.hash || value.policyHash) : Array.isArray(value) ? value.join(", ") : String(value) }))), h("details", { className: "section" }, h("summary", null, "Current public projections and sealed session envelope"), h("pre", { className: "json" }, pretty({ sourceState: session.sourceState, replay: session.discovery?.replay || null, policyReadiness: session.policyReadiness, snapshot: view.snapshot, graph: view.graph, journey: view.journey, plan: view.plan, caseState: session.caseState }))));
  }

  function Workspace({ session, setSession, busy, setBusy, error, setError, reset }) {
    const [tab, setTab] = React.useState(session.decisionTargets.candidateParties.length || session.decisionTargets.candidateClaims.length ? "DECISIONS" : "CUSTOMER");
    const [feedback, setFeedback] = React.useState([]);
    const currentEntry = session.snapshots.at(-1);
    const view = currentEntry?.view;
    const run = async (operation, payload, nextTab) => {
      setBusy(true); setError("");
      try { const next = await request(operation, payload); setSession(next); if (nextTab) setTab(nextTab); }
      catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    const onCustomerAction = (customerAction) => run("APPLY_CUSTOMER_ACTION", { session, customerAction }, "DECISIONS");
    const onDecisions = ({ identityDecisions, claimDecisions }) => run("APPLY_REVIEWER_DECISIONS", { session, identityDecisions, claimDecisions }, "CUSTOMER");
    const state = view ? (view.plan.state || view.compliance.terminal?.terminalOutcome || view.compliance.terminal?.orchestrationState) : "EXPLICIT_DECISIONS_REQUIRED";
    return h("main", { className: "shell" },
      h("header", { className: "workspace-header" }, h("div", null, h("h2", null, session.companyContext.legalEntityName), h("p", null, `${session.sourceLabel} · ${session.caseContext.entityProfile} · ${session.caseContext.riskLevel} risk`)), h("div", { className: "actions", style: { marginTop: 0 } }, h("span", { className: `source-state ${String(session.sourceState || "").toLowerCase()}` }, session.sourceState), h("span", { className: "status" }, human(state)), h("button", { className: "secondary", onClick: reset }, "New case"))),
      error && h("div", { className: "error", role: "alert" }, error),
      h("div", { className: "tabs", role: "tablist", "aria-label": "Lab workspace views" }, TABS.map((name) => h("button", { key: name, className: "tab", role: "tab", "aria-selected": tab === name, onClick: () => setTab(name), disabled: !view && !["DECISIONS", "SOURCES", "EVIDENCE"].includes(name) }, human(name)))),
      tab === "CUSTOMER" && view && h(CustomerPanel, { view, onAction: onCustomerAction, busy, error }),
      tab === "COMPLIANCE" && view && h(CompliancePanel, { view, session }),
      tab === "DECISIONS" && h(DecisionsPanel, { session, busy, apply: onDecisions }),
      tab === "SOURCES" && h(SourcesPanel, { session }),
      tab === "HISTORY" && view && h(HistoryPanel, { session }),
      tab === "PLANNER" && view && h(PlannerPanel, { view }),
      tab === "EVIDENCE" && h(EvidencePanel, { view: view || { compliance: { evidenceManifest: { evidenceReferences: [] } } }, session }),
      tab === "FEEDBACK" && view && h(FeedbackPanel, { view, feedback, setFeedback }),
      tab === "DIAGNOSTICS" && view && h(DiagnosticsPanel, { view, session }));
  }

  function ReviewSetup({ catalogue, mode, setMode, busy, error, savedResults, storageError, startFixture, startLive, startReplay }) {
    const fixtures = catalogue?.fixtures || [];
    const profiles = catalogue?.profiles || [];
    const [fixtureId, setFixtureId] = React.useState("V2-LAB-07");
    const [profileId, setProfileId] = React.useState("asda-wave-9-further-coverage");
    const [company, setCompany] = React.useState({ legalEntityName: "", registrationNumber: "", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "MEDIUM" });
    const updateFixture = (value) => {
      setFixtureId(value);
      setProfileId(fixtures.find(({ id }) => id === value)?.defaultProfileId || "NOT_PROVIDED");
    };
    const update = (field, value) => setCompany((current) => ({ ...current, [field]: value }));
    const selectedProfile = profiles.find((profile) => profile.profileId === profileId);
    const Profile = h("div", { className: "field full" },
      h("label", { htmlFor: "review-profile" }, "RegistryCapabilityProfile — Lab review only"),
      h("select", { id: "review-profile", value: profileId, onChange: (event) => setProfileId(event.target.value) }, profiles.map((profile) => h("option", { key: profile.profileId, value: profile.profileId }, profile.label))),
      h("p", { className: "field-help" }, selectedProfile?.warning || "NOT_PROVIDED"),
      selectedProfile?.profileHash && h("details", null, h("summary", null, `Profile #${shortHash(selectedProfile.profileHash)} · A-15 dependency`), h("pre", { className: "json" }, pretty(selectedProfile))));
    return h("main", { className: "shell setup review-setup" },
      h("nav", { className: "mode-list", "aria-label": "Successor acquisition mode" },
        [["FIXTURE", "Fixture", "Ten deterministic successor scenarios."], ["LIVE_DISCOVERY", "Fresh Live Discovery", "One server-side provider run; provider cost may apply."], ["REPLAY", "Replay", "Reuse a browser-saved normalized result with zero transport calls."]].map(([value, label, description]) => h("button", { key: value, className: `mode-button ${mode === value ? "active" : ""}`, onClick: () => setMode(value) }, h("strong", null, label), h("span", null, description)))),
      h("section", { className: "card" },
        h("p", { className: "source-label" }, "SUCCESSOR REVIEW · 1.6-RC · REVIEW ONLY"),
        h("h2", null, mode === "FIXTURE" ? "Choose a successor scenario" : mode === "REPLAY" ? "Replay a normalized Discovery result" : "Run fresh Discovery once"),
        mode === "FIXTURE" && h("div", { className: "form-grid" },
          h("div", { className: "field full" }, h("label", { htmlFor: "review-fixture" }, "Scenario"), h("select", { id: "review-fixture", value: fixtureId, onChange: (event) => updateFixture(event.target.value) }, fixtures.map((fixture) => h("option", { key: fixture.id, value: fixture.id }, `${fixture.id} · ${fixture.label}`))), h("p", { className: "field-help" }, fixtures.find(({ id }) => id === fixtureId)?.description)),
          Profile,
          h("div", { className: "field full" }, h("button", { className: "primary", disabled: busy, onClick: () => startFixture(fixtureId, profileId) }, busy ? "Evaluating actual successor pipeline…" : "Run successor review"))),
        mode === "REPLAY" && h("div", null,
          Profile,
          storageError && h("div", { className: "error", role: "alert" }, storageError),
          savedResults.length ? h("div", { className: "replay-list section" }, savedResults.map((record) => h("article", { className: "replay-item", key: record.replayId }, h("div", null, h("strong", null, record.companyContext.legalEntityName), h("p", null, `${record.companyContext.registrationNumber} · normalized facts saved ${new Date(record.savedAt).toLocaleString()}`)), h("button", { className: "primary", disabled: busy, onClick: () => startReplay(record, profileId) }, "Replay into successor review")))) : h(Empty, null, "No saved Live Discovery result is available in this browser.")),
        mode === "LIVE_DISCOVERY" && h("div", null,
          h("div", { className: "notice" }, "This makes one external Discovery request and may incur provider cost. Credentials remain server-side; later comparisons reuse the saved normalized result."),
          h("form", { className: "form-grid section", onSubmit: (event) => { event.preventDefault(); startLive(company, profileId); } },
            h("div", { className: "field" }, h("label", { htmlFor: "review-company" }, "Legal entity name"), h("input", { id: "review-company", required: true, value: company.legalEntityName, onInput: (event) => update("legalEntityName", event.target.value) })),
            h("div", { className: "field" }, h("label", { htmlFor: "review-number" }, "Company number"), h("input", { id: "review-number", required: true, value: company.registrationNumber, onInput: (event) => update("registrationNumber", event.target.value) })),
            h("div", { className: "field" }, h("label", null, "Entity profile"), h("select", { value: company.entityProfile, onChange: (event) => update("entityProfile", event.target.value) }, h("option", null, "COMPANY"), h("option", null, "LLP"))),
            Profile,
            h("div", { className: "field full" }, h("button", { className: "secondary", disabled: busy }, busy ? "Running once…" : "Run fresh live Discovery")))),
        error && h("div", { className: "error", role: "alert" }, error)));
  }

  function ReviewHeaderMetrics({ view, session }) {
    const items = [
      ["Policy", `${view.snapshot.decisionContent.policy.identity.policyPackId} ${view.snapshot.decisionContent.policy.identity.policyVersion}`],
      ["Readiness", view.policyReadiness.readiness], ["Runtime", view.policyReadiness.runtimeMode], ["Snapshot", `${view.snapshot.snapshotSchemaVersion} · #${shortHash(view.snapshot.snapshotId)}`],
      ["Plan", view.plan.state], ["Open causal needs", view.counts.openCausalNeeds], ["Customer actions", view.counts.currentCustomerActions], ["System actions", view.counts.currentSystemActions],
      ["Reviews", view.counts.reviewRequirements], ["Specialist routes", view.counts.specialistRoutes], ["Capability profile", session.selectedProfileId], ["Production", "NOT AUTHORIZED"],
    ];
    return h("div", { className: "review-status-grid", "aria-label": "Successor review status" }, items.map(([label, value]) => h(Metric, { key: label, label, value: human(value) })));
  }

  function ReviewCountPanel({ view, selectedList, setSelectedList }) {
    const lists = {
      openCausalNeeds: view.informationNeeds,
      affectedCalculations: view.affectedDiagnostics.filter((item) => item.calculationId || item.affected?.calculationIds?.length),
      affectedPaths: view.affectedDiagnostics.filter((item) => item.pathId || item.affected?.pathIds?.length),
      operationalBlockers: view.operationalBlockers,
      reviewRequirements: view.reviewRequirements,
      specialistRoutes: view.specialistRoutes,
      currentSystemActions: view.plan.currentPlanningWave.actor === "SYSTEM" ? view.plan.recommendedActions : [],
      currentCustomerActions: view.plan.currentPlanningWave.actor === "CUSTOMER" ? view.plan.recommendedActions : [],
      currentInternalActions: view.plan.currentPlanningWave.actor === "INTERNAL" ? view.plan.recommendedActions : [],
      currentSpecialistActions: view.plan.currentPlanningWave.actor === "SPECIALIST" ? view.plan.recommendedActions : [],
    };
    return h("section", { className: "count-inspector" },
      h("div", { className: "count-buttons" }, Object.entries(view.counts).map(([key, value]) => h("button", { key, className: selectedList === key ? "active" : "", onClick: () => setSelectedList(key), "aria-pressed": selectedList === key }, h("strong", null, value), h("span", null, human(key))))),
      selectedList && h("div", { className: "deterministic-list", role: "region", "aria-label": human(selectedList) },
        h("div", { className: "list-heading" }, h("h3", null, `${human(selectedList)} · ${lists[selectedList]?.length || 0}`), h("button", { className: "secondary", onClick: () => setSelectedList(null) }, "Close list")),
        (lists[selectedList] || []).length ? (lists[selectedList] || []).map((item, index) => h("details", { key: item.needId || item.actionId || item.reviewRequirementId || item.blockerId || item.routeId || index }, h("summary", null, item.needId || item.semanticActionType || item.reasonCode || `${human(selectedList)} ${index + 1}`), h("pre", { className: "json" }, pretty(item)))) : h(Empty, null, "The current snapshot records no items in this category.")));
  }

  function ReviewGraphPanel({ view, session, graphFilter, setGraphFilter }) {
    const graph = filteredReviewGraph(view.graph, graphFilter, session.entityDirectory);
    const hiddenControl = view.graph.relationships.filter((relationship) => relationshipFilter(relationship) === "CONTROL").length;
    const hiddenVoting = view.graph.relationships.filter((relationship) => relationshipFilter(relationship) === "VOTING").length;
    return h("section", { className: "panel review-graph-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("p", { className: "source-label" }, "PRESENTATION FILTER ONLY"), h("h2", null, "Ownership & Control Graph"), h("p", null, `Projection #${shortHash(view.graph.projectionHash)} remains unchanged; filtering does not recalculate qualification, needs, plan or snapshot.`)),
        h("div", { className: "graph-filters", role: "group", "aria-label": "Relationship filter" }, GRAPH_FILTERS.map((filter) => h("button", { key: filter, className: filter === graphFilter ? "active" : "", onClick: () => setGraphFilter(filter), "aria-pressed": filter === graphFilter }, human(filter))))),
      graphFilter === "OWNERSHIP" && (hiddenControl || hiddenVoting) ? h("div", { className: "overlay-note" }, `${hiddenVoting} voting and ${hiddenControl} control relationship(s) remain recorded as overlays. Choose Voting, Control or All to inspect them.`) : null,
      h(OwnershipGraph, { projection: graph, detailLevel: DETAIL_LEVEL.EXPLAIN, height: 840 }));
  }

  function ApplicantPreview({ view }) {
    const journey = view.journeyProjection;
    const bundles = journey.customerWorkBundles;
    return h("section", { className: "panel applicant-preview" },
      h("p", { className: "source-label" }, "JOURNEYPROJECTION v2 · READ-ONLY CONTRACT PREVIEW"),
      h("h2", null, "Applicant work preview"),
      h("p", null, "This preview is generated only from the verified DecisionSnapshot v2. Applying input remains a separate Decision Application v3 operation."),
      h("div", { className: "grid-3 section" },
        h(Metric, { label: "Customer work state", value: human(journey.customerWorkState) }),
        h(Metric, { label: "Open work bundles", value: bundles.length }),
        h(Metric, { label: "Customer input complete", value: String(journey.customerInputComplete) }),
        h(Metric, { label: "Final case complete", value: String(journey.finalCaseComplete) }),
        h(Metric, { label: "Internal review pending", value: journey.finishLine.internalReviewPending }),
        h(Metric, { label: "Evidence handoffs", value: journey.finishLine.evidenceHandoffBundles })),
      journey.policyContentBlocks.length > 0 && h("div", { className: "notice" }, `POLICY CONTENT REQUIRED · ${journey.policyContentBlocks.length} blocked option(s). No wording has been invented.`),
      bundles.length ? h("div", { className: "work-bundle-list section" }, bundles.map((bundle) => h("article", { className: "qualification-card", key: bundle.bundleId },
        h("div", { className: "panel-heading" }, h("div", null, h("h3", null, `${bundle.informationNeedIds.length} causal need(s) · ${human(bundle.state)}`), h("p", null, `${human(bundle.expectedResult)} · re-evaluate: ${human(bundle.reEvaluationTrigger)}`)), h("span", { className: "status" }, bundle.permittedSemanticActions.some(({ executable }) => executable) ? "ACTION AVAILABLE" : human(bundle.state))),
        bundle.evidenceHandoff && h("div", { className: bundle.evidenceHandoff.readiness === "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED" ? "notice evidence-ready" : "notice" }, bundle.evidenceHandoff.readiness === "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED" ? "EVIDENCE HANDOFF READY — EXECUTION NOT CONNECTED" : human(bundle.evidenceHandoff.readiness)),
        h("p", null, `Subject: ${bundle.canonicalSubject.entityId || bundle.canonicalSubject.entityIds.join(", ")} · Requirements: ${bundle.requirementIds.join(", ") || "none"}`),
        h("details", null, h("summary", null, "Known, missing and permitted work"), h("pre", { className: "json" }, pretty({ knownInformation: bundle.knownInformation, missingInformation: bundle.missingInformation, permittedSemanticActions: bundle.permittedSemanticActions, signoffDependencies: bundle.signoffDependencies })))))) : h(Empty, null, journey.customerInputComplete ? "No customer work is currently executable. Final review and system work remain separate." : "No customer bundle is present in the pinned plan."));
  }

  function ApplicantJourneyPanel({ catalogue, labSession, setLabSession, profileId, cachedRecord, cacheNotice, cacheError, resumeCached, startNew, resetCurrent, saveLiveLocally }) {
    const [fixtureId, setFixtureId] = React.useState("AJV2-01");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const run = async (operation, payload) => {
      setBusy(true);
      setError("");
      try {
        const next = await request(operation, payload);
        setLabSession(next);
        return next;
      } catch (cause) {
        setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`);
        throw cause;
      } finally {
        setBusy(false);
      }
    };
    const start = () => run("START_APPLICANT_FIXTURE", { fixtureId, profileId });
    if (!labSession) {
      return h("section", { className: "panel applicant-journey-host" },
        h("p", { className: "source-label" }, "REVIEW-ONLY | ACTUAL DECISION APPLICATION v3 CONTRACTS"),
        h("h2", null, "Applicant Journey v2"),
        h("p", null, "Start a sanitized scenario. Viewing this tab does not run paid Discovery, Evidence or production persistence."),
        cacheNotice && h("div", { className: "notice", role: "status" }, cacheNotice),
        cacheError && h("div", { className: "error", role: "alert" }, cacheError),
        error && h("div", { className: "error", role: "alert" }, error),
        cachedRecord && h("button", { className: "primary", disabled: busy, onClick: resumeCached }, "Resume last demo"),
        h("div", { className: "field" },
          h("label", null, "Applicant fixture"),
          h("select", { value: fixtureId, onChange: (event) => setFixtureId(event.target.value) },
            (catalogue?.fixtures || []).map((fixture) => h("option", { key: fixture.fixtureId, value: fixture.fixtureId }, `${fixture.fixtureId} - ${fixture.label}`)))),
        h("button", { className: "primary", disabled: busy, onClick: start }, busy ? "Building journey..." : "Start applicant journey"));
    }
    const current = labSession.snapshots.at(-1);
    const submit = async (customerAction) => {
      const operationId = `${labSession.sessionId}:customer-action:${(labSession.acceptedOperations || []).length + 1}`;
      if (applicantSessionCache) {
        try { await applicantSessionCache.markInFlight(labSession, operationId, labSession.liveSaveOptIn === true); }
        catch (_cause) { /* Submission may continue with the visible Lab-only storage warning. */ }
      }
      return run("SUBMIT_APPLICANT_ACTION_AND_ADVANCE", { session: labSession, customerAction, operationId });
    };
    const resumeEvaluation = () => run("RESUME_APPLICANT_ADVANCE", {
      session: labSession,
      operationId: labSession.orchestrationState.operationId,
    });
    const latestActivity = (labSession.customerActivityHistory || []).at(-1);
    return h("section", { className: "applicant-journey-host" },
      h("div", { className: "panel applicant-lab-toolbar" },
        h("div", null,
          h("p", { className: "source-label" }, labSession.sourceMode === "LIVE"
            ? (labSession.liveSaveOptIn === true ? "LIVE LAB CASE — SAVED LOCALLY FOR DEMO/TESTING" : "LIVE LAB CASE — NOT SAVED")
            : "LAB SESSION — SAVED LOCALLY IN THIS BROWSER"),
          h("h2", null, `${labSession.fixtureId} - ${labSession.fixtureLabel}`),
          h("p", null, `Snapshot #${shortHash(current.snapshot.snapshotId)} | ${labSession.policyMode} | ${labSession.snapshots.length} immutable snapshot(s)`)),
        h("div", { className: "actions" },
          h("button", { className: "secondary", onClick: startNew, disabled: busy }, "Start new case"),
          h("button", { className: "secondary", onClick: resetCurrent, disabled: busy }, "Reset this demo"),
          labSession.sourceMode === "LIVE" && labSession.liveSaveOptIn !== true
            ? h("button", { className: "secondary", onClick: saveLiveLocally, disabled: busy }, "Save this Lab session locally for demo/testing")
            : null)),
      cacheNotice && h("div", { className: "notice", role: "status" }, cacheNotice),
      cacheError && h("div", { className: "error", role: "alert" }, cacheError),
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status", "aria-live": "polite" }, "Saving your response and refreshing the ownership review…"),
      labSession.orchestrationState?.status === "INTERNAL_REVIEW_PENDING" && h("section", { className: "panel applicant-pending", role: "status" },
        h("h3", null, "Your response has been submitted."),
        h("p", null, "Our review team needs to verify it.")),
      labSession.orchestrationState?.status === "EVIDENCE_HANDOFF_PENDING" && h("section", { className: "panel applicant-pending", role: "status" },
        h("h3", null, "EVIDENCE HANDOFF READY — EXECUTION NOT CONNECTED"),
        h("p", null, "Nothing was uploaded and no Evidence Artifact was created.")),
      labSession.orchestrationState?.status === "DELEGATION_HANDOFF_PENDING" && h("section", { className: "panel applicant-pending", role: "status" },
        h("h3", null, "Help request prepared"),
        h("p", null, "Host execution is pending. No invitation was sent and the work is not complete.")),
      labSession.orchestrationState?.status === "EVALUATION_FAILED" && h("section", { className: "panel applicant-pending", role: "alert" },
        h("h3", null, "Your response is recorded"),
        h("p", null, labSession.orchestrationError?.message),
        h("button", { className: "primary", disabled: busy, onClick: resumeEvaluation }, "Refresh review status")),
      h(UboApplicantJourneyV2, {
        journey: current.journey,
        actorContext: labSession.actorContext,
        actionResult: labSession.latestCustomerActionResult,
        content: labSession.content,
        onSubmitAction: submit,
        submittedBundleIds: labSession.submittedBundleIds || [],
        submissionState: busy ? { status: "SUBMITTING" } : null,
        className: "lab-applicant-journey",
      }),
      latestActivity && h("section", { className: "panel applicant-submission-history", "aria-label": "Submitted customer activity" },
        h("p", { className: "source-label" }, "SUBMITTED ACTIVITY"),
        h("h3", null, latestActivity.actionType === "CONFIRM_ESTABLISHED_INFORMATION" ? "Confirmation recorded" : "Customer response recorded"),
        h("p", null, `${human(latestActivity.status)} · submitted ${latestActivity.submittedAt}.`),
        h("p", null, "This activity remains recorded even when it is no longer a current task.")));
  }

  function ApplicantInternalReviewPanel({ applicantSession, busy, completeFixtureReview }) {
    if (!applicantSession) return null;
    const pendingCount = applicantSession.pendingDecisionTargets.candidateParties.length
      + applicantSession.pendingDecisionTargets.candidateClaims.length;
    return h("section", { className: "panel section" },
      h("p", { className: "source-label" }, "APPLICANT SESSION — INTERNAL ORCHESTRATION"),
      h("h2", null, "Applicant submission review"),
      h("p", null, `${pendingCount} explicit identity/claim decision target(s) pending.`),
      applicantSession.sourceMode === "FIXTURE" && applicantSession.fixtureReviewConfiguration && pendingCount > 0
        ? h("div", { className: "notice" },
          h("strong", null, "DEMO FIXTURE — PRECONFIGURED REVIEW DECISIONS"),
          h("p", null, "This deterministic fixture helper calls the normal applyDecisions and evaluate operations. It is unavailable for live or replay data."),
          h("button", { className: "primary", disabled: busy, onClick: completeFixtureReview }, "Complete fixture review and refresh journey"))
        : pendingCount > 0 ? h("p", null, "A reviewer must complete the explicit decisions through an authorised internal workflow.") : null);
  }

  function ApplicantSessionDiagnostics({ applicantSession }) {
    if (!applicantSession) return null;
    return h("section", { className: "panel section" },
      h("h2", null, "Applicant session diagnostics"),
      h("pre", { className: "json" }, pretty({
        operationHistory: applicantSession.operationHistory,
        orchestrationHistory: applicantSession.orchestrationHistory,
        pendingDecisionTargets: applicantSession.pendingDecisionTargets,
        latestCustomerActionResult: applicantSession.latestCustomerActionResult,
        completedCustomerAttempts: applicantSession.completedCustomerAttempts || [],
        snapshots: applicantSession.snapshots.map(({ sequence, reason, predecessorSnapshotId, snapshot }) => ({ sequence, reason, predecessorSnapshotId, snapshotId: snapshot.snapshotId, snapshotHash: snapshot.decisionContentHash })),
      })));
  }

  function ContractInspector({ view }) {
    return h("section", { className: "panel" },
      h("p", { className: "source-label" }, "IMMUTABLE VERSIONED CONTRACT"),
      h("h2", null, "JourneyProjection v2 inspector"),
      h("div", { className: "grid-3" },
        h(Metric, { label: "Projection", value: view.journeyProjection.contractVersion }),
        h(Metric, { label: "Snapshot", value: `#${shortHash(view.journeyProjection.decision.snapshotHash)}` }),
        h(Metric, { label: "Plan", value: `#${shortHash(view.journeyProjection.decision.planHash)}` })),
      h("pre", { className: "json section contract-json" }, pretty(view.journeyProjection)));
  }

  function ReviewQualifications({ view, session }) {
    const names = new Map(session.entityDirectory.map(({ entityId, party }) => [entityId, party?.name || entityId]));
    const cards = view.qualifications.map((assessment) => {
      const bases = assessment.basisRecords.map((basis) => h("details", { className: "section", key: basis.basisId },
        h("summary", null, `${human(basis.route)} · ${human(basis.dimension || basis.condition)} · ${human(basis.assessmentState)}`),
        h("div", { className: "route-summary" },
          h("p", null, `${human(basis.classification)} · ${human(basis.directness)} · ${human(basis.methodStatus)} · threshold ${basis.threshold?.comparator || "—"}${basis.threshold?.value ?? "—"}%`),
          h("p", null, `Reason: ${human(basis.reasonCode)} · Sign-offs: ${(basis.requiredSignoffs || basis.reviewDependencies || []).join(", ") || "none"}`),
          h("pre", { className: "json" }, pretty({ calculation: basis.recordedCalculation, attributedRights: basis.targetRightReferences, chains: basis.orderedPathReferences, evidenceReferences: basis.evidenceReferences, governance: assessment.governance })))));
      return h("article", { className: "qualification-card", key: assessment.assessmentId },
        h("div", { className: "panel-heading" }, h("div", null, h("h3", null, names.get(assessment.personEntityId) || assessment.personEntityId), h("p", null, `${human(assessment.routeStatus)} · ${human(assessment.reasonCode)}`)), h("span", { className: "status" }, assessment.firmPolicyOnlySatisfied ? "FIRM POLICY ONLY" : assessment.routeStatus)),
        h("div", { className: "grid-3" }, h(Metric, { label: "Assessed routes", value: assessment.assessedRoutes.join(", ") }), h(Metric, { label: "Unassessed routes", value: assessment.unassessedRoutes.join(", ") || "None" }), h(Metric, { label: "Production", value: assessment.governance.productionAuthorized ? "AUTHORIZED" : "NOT AUTHORIZED" })),
        bases);
    });
    return h("section", { className: "panel" }, h("h2", null, "Route-specific qualification"), h("p", null, "Statutory, firm-policy and review-required routes are shown independently. No naked UBO boolean is inferred."), cards.length ? cards : h(Empty, null, "No natural-person qualification assessment is present in this snapshot."));
  }

  function ReviewRequirements({ view }) {
    const rows = view.requirements.map((item) => h("tr", { key: item.requirementId },
      h("td", null, h("strong", null, item.requirementId)), h("td", null, human(item.applicability)),
      h("td", { className: `state ${item.resolutionState}` }, human(item.resolutionState)), h("td", null, human(item.reasonCode)),
      h("td", null, item.causalInformationNeedIds.length), h("td", null, `${item.reviewRequirementIds.length} review · ${item.operationalBlockerIds.length} blocker · ${item.specialistRouteIds.length} specialist`)));
    const needs = view.informationNeeds.map((need) => h("details", { key: need.needId },
      h("summary", null, `${human(need.concept)} · ${need.needId}`),
      h("div", null,
        h("p", null, `Target: ${need.targetKind} · ${need.frontierEntityId || need.targetReference?.entityId || "case"} · Requirements: ${need.requiredByRequirementIds.join(", ")}`),
        h("p", null, `Affected: ${need.affected.calculationIds.length} calculation(s), ${need.affected.pathIds.length} path(s), ${need.affected.relationshipIds.length} relationship(s)`),
        h("p", null, `Content: ${human(need.contentReadinessStatus)} · Sign-offs: ${need.requiredSignoffIds.join(", ") || "none"}`),
        h("pre", { className: "json" }, pretty(need)))));
    return h("section", { className: "panel" }, h("h2", null, "R01–R14 requirements and causal InformationNeeds"), h("p", null, "Each open causal need appears once. Affected paths and calculations are dependent diagnostics, not additional needs."),
      h("div", { className: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, ["Requirement", "Applies", "Resolution", "Reason", "Causal needs", "Reviews / blockers"].map((item) => h("th", { key: item }, item)))), h("tbody", null, rows))),
      h("div", { className: "section" }, needs));
  }

  function ReviewPlan({ view }) {
    const plan = view.plan;
    const groups = plan.resolutionGroups.map((group) => h("details", { key: group.groupId },
      h("summary", null, `${human(group.structureAcquisitionStrategy)} · ${group.coveredInformationNeedIds.length} need(s)`),
      h("div", null, h("p", null, `Why: ${group.rationaleCodes.map(human).join("; ")}`), h("p", null, `Expected: ${human(group.expectedResolution)} · Re-evaluate: ${human(group.reEvaluationTrigger)}`), h("pre", { className: "json" }, pretty(group)))));
    return h("section", { className: "panel" }, h("p", { className: "source-label" }, "EXACT PLAN PINNED IN SNAPSHOT"), h("h2", null, "ResolutionPlan v2"),
      h("div", { className: "grid-3" }, h(Metric, { label: "Plan ID", value: `#${shortHash(plan.planId)}` }), h(Metric, { label: "Plan hash", value: `#${shortHash(plan.planHash)}` }), h(Metric, { label: "State / actor", value: `${human(plan.state)} · ${human(plan.currentPlanningWave.actor)}` }), h(Metric, { label: "Groups", value: plan.resolutionGroups.length }), h(Metric, { label: "Selected actions", value: plan.recommendedActions.length }), h(Metric, { label: "Prior attempts", value: plan.attemptHistory.length })),
      h("div", { className: "section grid-2" }, groups),
      h("details", { className: "section", open: true }, h("summary", null, `Current ${human(plan.currentPlanningWave.actor)} actions · ${plan.recommendedActions.length}`), h("pre", { className: "json" }, pretty(plan.recommendedActions))),
      h("details", null, h("summary", null, `Deferred alternatives · ${plan.deferredAlternatives.length}`), h("pre", { className: "json" }, pretty(plan.deferredAlternatives))),
      h("details", null, h("summary", null, "Predecessor, policy blocks and re-evaluation"), h("pre", { className: "json" }, pretty({ predecessorPlan: plan.predecessorPlan, unresolvedPolicyContentDependencies: plan.unresolvedPolicyContentDependencies, reEvaluationTriggers: plan.reEvaluationTriggers, rationaleCodes: plan.rationaleCodes }))));
  }

  function ReviewEvidence({ view }) {
    return h("section", { className: "panel" }, h("p", { className: "source-label" }, "EVIDENCE EXECUTION NOT YET CONNECTED"), h("h2", null, "Provider-neutral evidence"), h("div", { className: "notice" }, "No uploader, extraction service, Evidence Platform call or false receipt is available in Wave 10."), h("h3", { className: "section" }, `EvidenceReferences · ${view.evidence.references.length}`), view.evidence.references.length ? h("pre", { className: "json" }, pretty(view.evidence.references)) : h(Empty, null, "No relationship EvidenceReferences are recorded."), h("h3", { className: "section" }, `Percentage evidence assessments · ${view.evidence.percentageAssessments.length}`), view.evidence.percentageAssessments.length ? h("pre", { className: "json" }, pretty(view.evidence.percentageAssessments)) : h(Empty, null, "No percentage-evidence comparison is recorded."));
  }

  function ReviewHistory({ session }) {
    const [selected, setSelected] = React.useState(session.snapshots.length - 1);
    React.useEffect(() => setSelected(session.snapshots.length - 1), [session.snapshots.length]);
    const entry = session.snapshots[selected];
    const historyList = h("div", { className: "history-list", role: "listbox" }, session.snapshots.map((item, index) => h("button", { key: item.historyEntryId, className: `history-item ${index === selected ? "active" : ""}`, onClick: () => setSelected(index), "aria-selected": index === selected }, h("strong", null, `#${shortHash(item.view.snapshot.snapshotId)}`), h("span", null, `${human(item.reason)} · ${item.view.snapshot.decisionContent.checkpoint.evaluationTime}`), h("span", null, `Predecessor: ${shortHash(item.predecessorSnapshotId)}`))));
    const recordedView = entry ? h("div", null,
      h("h2", null, "Immutable DecisionSnapshot v2"),
      h("div", { className: "grid-3" }, h(Metric, { label: "Policy", value: entry.view.snapshot.decisionContent.policy.identity.policyVersion }), h(Metric, { label: "Profile", value: entry.view.plan.registryCapabilityProfileRef?.profileId || entry.view.plan.registryCapabilityProfileRef?.state || "NOT_PROVIDED" }), h(Metric, { label: "Plan", value: `#${shortHash(entry.view.plan.planHash)}` }), h(Metric, { label: "Pipeline", value: entry.view.governance.pipelineMaturity }), h(Metric, { label: "State", value: entry.view.plan.state }), h(Metric, { label: "Production", value: "NOT AUTHORIZED" })),
      h("details", { className: "section" }, h("summary", null, "Reconstruct recorded view without recalculation"), h("pre", { className: "json" }, pretty(entry.view)))) : null;
    return h("section", { className: "panel history" }, historyList, recordedView);
  }

  function ReviewDiagnostics({ view, session, graphFilter }) {
    const exportPayload = { feedbackVersion: "ubo-control-lab-feedback-v2", mode: session.mode, policyIdentity: session.policyIdentity, snapshotIdentity: { snapshotId: view.snapshot.snapshotId, hash: view.snapshot.decisionContentHash }, planIdentity: { planId: view.plan.planId, hash: view.plan.planHash }, profileIdentity: session.registryCapabilityProfileRef, graphFilter, selectedQualification: null, selectedNeed: null, selectedGroup: null, selectedAction: null };
    const copy = () => navigator.clipboard.writeText(pretty(exportPayload));
    return h("section", { className: "panel" }, h("h2", null, "Successor diagnostics"), h("div", { className: "grid-3" }, Object.entries(view.diagnostics).map(([key, value]) => h(Metric, { key, label: human(key), value: typeof value === "string" ? value : value?.profileId || value?.state || (Array.isArray(value) ? value.length : "Recorded") }))), h("details", { className: "section" }, h("summary", null, "Algorithms, profile, sign-offs and working state"), h("pre", { className: "json" }, pretty({ diagnostics: view.diagnostics, governance: view.governance, policyReadiness: view.policyReadiness, sessionPins: { contractVersion: session.contractVersion, reviewApplicationContractVersion: session.reviewApplicationContractVersion, policyIdentity: session.policyIdentity, snapshotVersion: session.snapshotVersion, registryCapabilityProfileRef: session.registryCapabilityProfileRef, evaluationTime: session.evaluationTime } }))), h("div", { className: "section" }, h("h3", null, "Session-only feedback context"), h("p", null, "The export pins mode, policy, snapshot, plan, profile and graph filter. Add practitioner free text after copying; there is no production persistence."), h("button", { className: "secondary", onClick: copy }, "Copy feedback context JSON")));
  }

  function ReviewComparison({ session }) {
    const [comparison, setComparison] = React.useState(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      if (!String(session.selectedFixtureId || "").startsWith("V2-LAB-")) return;
      request("REVIEW_COMPARISON", { fixtureId: session.selectedFixtureId, profileId: session.selectedProfileId }).then(setComparison).catch((cause) => setError(cause.message));
    }, [session.selectedFixtureId, session.selectedProfileId]);
    return h("section", { className: "panel" }, h("p", { className: "source-label" }, "SAME NORMALIZED CANDIDATE FACTS · NO SECOND SEARCH"), h("h2", null, "Baseline 1.5-RC versus successor 1.6-RC"), h("div", { className: "notice" }, "The definitions differ: v1 projected unresolved rows and v2 causal needs/dependent diagnostics are not directly identical metrics."), error && h("div", { className: "error" }, error), comparison ? h("div", { className: "comparison-grid section" }, [["Baseline — 1.5-RC", comparison.baseline], ["Successor review — 1.6-RC", comparison.successor]].map(([title, value]) => h("article", { className: "comparison-card", key: title }, h("h3", null, title), h("pre", { className: "json" }, pretty(value))))) : h(Empty, null, String(session.selectedFixtureId || "").startsWith("V2-LAB-") ? "Building the exact comparison…" : "Comparison is available for the sanitized fixture set."));
  }

  function PreingestedEvidenceWorkspace({ readiness }) {
    const [demo, setDemo] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const [restored, setRestored] = React.useState(false);
    const [showAllRelationships, setShowAllRelationships] = React.useState(false);
    React.useEffect(() => {
      if (!preingestedEvidenceCache) { setRestored(true); return; }
      preingestedEvidenceCache.restore().then(async ({ record, error: cacheError }) => {
        if (cacheError) setError(cacheError);
        if (record) {
          try {
            const verified = await request("VALIDATE_PREINGESTED_EVIDENCE_SESSION", { session: record.session });
            setDemo(verified);
            setNotice("Restored Snapshot and Evidence references from this browser’s sealed Lab-only cache.");
          } catch (_cause) { setError("The saved Bettercomms demo failed server-side Snapshot or Artifact-reference verification."); }
        }
        setRestored(true);
      });
    }, []);
    React.useEffect(() => {
      if (!restored || !demo || !preingestedEvidenceCache) return;
      preingestedEvidenceCache.save(demo).catch(() => setError("This Bettercomms Lab session could not be saved locally."));
    }, [demo, restored]);
    const run = async (operation, payload) => {
      setBusy(true); setError(""); setNotice("");
      try { setDemo(await request(operation, payload)); }
      catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    const reset = () => {
      if (preingestedEvidenceCache) preingestedEvidenceCache.clear();
      setDemo(null); setError(""); setNotice("Demo reset. A new session will receive a new idempotent operation identity.");
    };
    const current = demo?.snapshots?.at(-1);
    const extracted = demo?.extraction?.capabilityResult;
    const finalContent = demo?.stage === "SNAPSHOT_B" ? current.snapshot.decisionContent : null;
    const assessments = finalContent?.personQualificationAssessments || [];
    const assessmentFor = (id) => assessments.find(({ personEntityId }) => personEntityId === id);
    const effectiveBasis = (id) => assessmentFor(id)?.basisRecords.find(({ route, dimension }) => route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC");
    const mitchell = effectiveBasis("mitchell-fortescue");
    const lee = effectiveBasis("lee-taylor");
    const displayGraph = finalContent && (showAllRelationships
      ? preingestedGraphViews.createFullSourceGraphView(current.graph, demo.entityDirectory)
      : preingestedGraphViews.createTargetRelevantGraphView(current.graph, demo.entityDirectory));
    const ownershipStatements = displayGraph?.relationships
      .filter(({ relationshipType }) => relationshipType === "ECONOMIC_OWNERSHIP")
      .map(({ relationshipId, presentationLabel }) => h("li", { key: relationshipId }, presentationLabel));
    const r08 = finalContent?.evidenceSufficiency?.find(({ requirementId }) => requirementId === "UBO-R08");
    const evidenceNeedCount = current?.snapshot?.decisionContent?.informationNeedsV2?.filter(({ status, requiredByRequirementIds }) => status === "OPEN" && requiredByRequirementIds.some((id) => ["UBO-R01", "UBO-R08"].includes(id))).length || 0;
    const factHeading = (fact) => fact.type === "RELATIONSHIP"
      ? `${fact.subject.name} → ${fact.object.name}`
      : fact.attribute === "officer_relationship"
        ? `${fact.subject.name} · officer metadata`
        : `${human(fact.attribute)} · source certification`;
    const factSummary = (fact) => fact.type === "RELATIONSHIP"
      ? `${human(fact.relationship)} · ${human(fact.measurement.type)} ${fact.measurement.value}%`
      : fact.attribute === "officer_relationship"
        ? `${human(fact.attribute)} · ${fact.value.relationshipValue.qualitative}`
        : fact.value.text;
    const factState = (fact) => fact.type === "RELATIONSHIP" || fact.attribute === "officer_relationship"
      ? `temporal ${human(fact.qualifiers?.currentState || fact.value?.temporal?.state)}`
      : "source statement · no relationship-currentness assertion";
    if (!demo) return h("main", { className: "shell preingested-demo" },
      h("section", { className: "panel demo-hero" },
        h("p", { className: "source-label" }, "REAL SOURCE IMAGE — MANUALLY REVIEWED FIXTURE"),
        h("p", { className: "source-label" }, "REVIEW LAB — NOT PRODUCTION UPLOAD"),
        h("h2", null, "BETTERCOMMS — SOURCE-BACKED REVIEWED OWNERSHIP CHART"),
        h("p", null, "Replay reviewed source statements through EvidenceConsumerV1, the merged adapter, explicit fixture decisions, Decision Application v3 and Snapshot v2."),
        h("div", { className: "notice" }, "Historical Evidence-store linkage not yet revalidated · No fresh automated interpretation performed · No source bytes are published or stored in this browser."),
        notice && h("div", { className: "notice", role: "status" }, notice),
        error && h("div", { className: "error", role: "alert" }, error),
        h("button", { className: "primary", disabled: busy, onClick: () => run("START_PREINGESTED_EVIDENCE_DEMO", {}) }, busy ? "Starting…" : "Open source-backed Bettercomms demo")));
    return h("main", { className: "shell preingested-demo" },
      h("header", { className: "workspace-header" },
        h("div", null, demo.labels.map((label) => h("p", { className: "source-label", key: label }, label)), h("p", { className: "source-label" }, "REVIEW LAB — NOT PRODUCTION UPLOAD"), h("h2", null, demo.fixtureLabel), h("p", null, `${human(demo.stage)} · ${demo.snapshots.length} immutable snapshot(s) · productionAuthorized=false`)),
        h("button", { className: "secondary", disabled: busy, onClick: reset }, "Reset demo")),
      notice && h("div", { className: "notice", role: "status" }, notice),
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status", "aria-live": "polite" }, demo.stage === "EVIDENCE_REQUIRED" ? "Passing the manually reviewed fixture through EvidenceConsumerV1…" : "Applying explicit fixture decisions and creating Snapshot B…"),
      h("section", { className: "panel" },
        h("div", { className: "grid-3" },
          h(Metric, { label: "Stage", value: human(demo.stage) }), h(Metric, { label: "Active snapshot", value: `#${shortHash(current.snapshot.snapshotId)}` }), h(Metric, { label: "Open ownership/evidence needs", value: evidenceNeedCount }),
          h(Metric, { label: "Customer work bundles", value: current.journey.customerWorkBundles.length }), h(Metric, { label: "Evidence facts", value: extracted?.candidateFacts?.length || 0 }), h(Metric, { label: "Production", value: "NOT AUTHORIZED" })),
        demo.stage === "EVIDENCE_REQUIRED" && h("div", { className: "section" },
          h("h3", null, "1. Ownership structure Evidence is required"),
          h("p", null, "Snapshot A records the unresolved ownership/evidence need and pins the planner’s structure-Evidence request."),
          h("details", null, h("summary", null, "Inspect the pinned ExternalEvidenceHandoff plan"), h("pre", { className: "json" }, pretty(current.journey.customerWorkBundles))),
          h("button", { className: "primary section", disabled: busy || demo.sourceMode !== "FIXTURE", onClick: () => run("USE_PREINGESTED_BETTERCOMMS_ARTIFACT", { session: demo }) }, "Use source-backed reviewed Bettercomms fixture")),
        demo.stage === "SOURCE_FACTS_EXTRACTED" && h("div", { className: "section" },
          h("div", { className: "evidence-extracted-state" }, "SOURCE FACTS EXTRACTED — NOT YET ACCEPTED INTO THE UBO GRAPH"),
          h("p", null, `${extracted.candidateFacts.length} extracted facts from one source document. No claim is operative and no UBO calculation has run from them yet.`),
          h("div", { className: "grid-3 section" }, h(Metric, { label: "Identity targets", value: demo.decisionTargets.candidateParties.length }), h(Metric, { label: "Claim targets", value: demo.decisionTargets.candidateClaims.length }), h(Metric, { label: "Interpretation", value: extracted.outcome.state })),
          h("button", { className: "primary section", disabled: busy, onClick: () => run("APPLY_PREINGESTED_FIXTURE_DECISIONS", { session: demo }) }, "DEMO FIXTURE — APPLY PRECONFIGURED IDENTITY AND CLAIM DECISIONS"))),
      extracted && h("section", { className: "panel section" },
        h("h2", null, "Public Evidence DTO and adapter trace"),
        h("p", { className: "notice" }, "This is a deterministic replay of manually reviewed source statements. It is not a new automated interpretation or a persisted historical Evidence operation."),
        h("div", { className: "grid-3" }, h(Metric, { label: "Fixture Artifact", value: demo.extraction.artifact.artifactId }), h(Metric, { label: "Original SHA-256", value: demo.extraction.artifact.digest }), h(Metric, { label: "Media", value: `${demo.extraction.artifact.mediaType} · ${demo.extraction.artifact.sizeBytes} bytes` }), h(Metric, { label: "Fixture operation", value: demo.extraction.interpretation.operationId }), h(Metric, { label: "Source documents", value: 1 }), h(Metric, { label: "Mapped facts", value: extracted.candidateFacts.length })),
        h("div", { className: "fact-grid section" }, extracted.candidateFacts.map((fact) => h("article", { className: "fact-card", key: fact.factId },
          h("span", { className: "source-label" }, fact.type === "RELATIONSHIP" ? "REQUESTED OWNERSHIP" : fact.attribute === "officer_relationship" ? "DISCOVERED OFFICER METADATA" : "DISCOVERED CERTIFICATION STATEMENT"),
          h("h3", null, factHeading(fact)),
          h("p", null, factSummary(fact)),
          h("p", null, `Fact ${fact.factId} · ${factState(fact)}`),
          h("details", null, h("summary", null, "Proof locator and source reference"), h("pre", { className: "json" }, pretty(fact.evidenceReferences)))))),
        h("details", { className: "section" }, h("summary", null, `Typed adapter limitations · ${extracted.issues.length}`), h("pre", { className: "json" }, pretty(extracted.issues)))),
      demo.sourceAttestation && h("section", { className: "panel section attestation-panel" },
        h("p", { className: "source-label" }, "RECOVERED SOURCE CERTIFICATION · REVIEW REQUIRED"),
        h("h2", null, "Certification is present; present-day ownership currentness is not established"),
        h("p", null, demo.sourceAttestation.reason),
        h("div", { className: "grid-3 section" },
          h(Metric, { label: "Visible mark", value: `${demo.sourceAttestation.metadata.signatureText} · not authenticated` }),
          h(Metric, { label: "Signer / stated capacity", value: `${demo.sourceAttestation.metadata.signerName} ${demo.sourceAttestation.metadata.signerPostnominal} · ${demo.sourceAttestation.metadata.signerCapacity}` }),
          h(Metric, { label: "Professional reference", value: `${demo.sourceAttestation.metadata.professionalReference.label}: ${demo.sourceAttestation.metadata.professionalReference.value} · not verified` }),
          h(Metric, { label: "Certification date", value: `${demo.sourceAttestation.metadata.signedDate} · ownership as-at date not stated` }),
          h(Metric, { label: "Declaration", value: demo.sourceAttestation.metadata.declarationText }),
          h(Metric, { label: "Reviewed scope", value: `${demo.sourceAttestation.coveredFactIds.length} economic facts · manual annotation` })),
        h("p", { className: "notice" }, "Certification date 5 May 2026, source capture time, fixture review time, requested assessment date and Evidence freshness remain distinct. Historical capture time is not revalidated; no relationship is made CURRENT."),
        h("p", { className: "notice" }, demo.sourceAttestation.reviewInterpretation.limitation),
        h("details", null, h("summary", null, "Inspect the separate currentness assessment"), h("pre", { className: "json" }, pretty(demo.sourceAttestation)))),
      finalContent && h(React.Fragment, null,
        h("section", { className: "panel section result-panel" },
          h("p", { className: "source-label" }, "SNAPSHOT B · FRESH DETERMINISTIC EVALUATION"), h("h2", null, "Current qualification is indeterminate"),
          h("article", { className: "boundary-result" }, h("h3", null, "Mitchell Fortescue"), h("strong", null, "Source-stated arithmetic · 75% × 100% = nominal 75%"), h("p", null, `Current statutory effective-interest route · ${mitchell?.assessmentState || "INDETERMINATE"}. The engine records the path as ${mitchell?.recordedCalculation?.status || "UNRESOLVED"} because both material edges have UNKNOWN currentness.`)),
          h("article", { className: "boundary-result" }, h("h3", null, "Lee Taylor"), h("strong", null, "Source-stated arithmetic · 25% × 100% = nominal 25%"), h("p", null, `Current statutory effective-interest route · ${lee?.assessmentState || "INDETERMINATE"}. The source percentage can be inspected, but the engine cannot treat the path as current without scoped attestation.`)),
          h("p", null, `R08 Evidence sufficiency remains separate · ${r08?.status || "INSUFFICIENT"}. The attestation assessment contributes no additional independent source.`),
          h("p", null, "Officer roles remain source-backed entity metadata only; they create no control edge, appointment/removal right or qualification basis."),
          h("details", null, h("summary", null, "Pinned route, calculation, path and Evidence references"), h("pre", { className: "json" }, pretty({ mitchell, lee, policy: finalContent.policy.identity, productionAuthorized: false })))),
        h("section", { className: "panel section review-graph-panel" },
          h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Ownership graph"), h("p", null, showAllRelationships ? "Full source-document view. The regulated subject remains highlighted." : "Target-specific reverse-reachability view for Better Comms VOIP Ltd.")),
            h("label", { className: "source-graph-toggle" }, h("input", { type: "checkbox", checked: showAllRelationships, onChange: (event) => setShowAllRelationships(event.target.checked) }), " Show all relationships from source document")),
          h("p", null, showAllRelationships ? "Both subsidiaries are shown beneath their owner, Better Holdco." : "Off-path sibling Better Network Services is retained in the case and source view, but excluded here because it is not on a path to the regulated target."),
          h("ul", { className: "ownership-statements" }, ownershipStatements),
          h(OwnershipGraph, { projection: displayGraph, detailLevel: DETAIL_LEVEL.EXPLAIN, height: 760 })),
        h("section", { className: "panel section" }, h("h2", null, "Applicant journey after re-evaluation"), h("div", { className: "grid-3" }, h(Metric, { label: "Ownership document", value: "SOURCE-REVIEWED FIXTURE" }), h(Metric, { label: "Ownership structure", value: "UPDATED · CURRENTNESS OPEN" }), h(Metric, { label: "Statutory qualifying people", value: assessmentFor("mitchell-fortescue")?.routeStatus === "ROUTE_SATISFIED" ? 1 : 0 }), h(Metric, { label: "Customer bundles", value: current.journey.customerWorkBundles.length }), h(Metric, { label: "Internal review pending", value: current.journey.finishLine.internalReviewPending }), h(Metric, { label: "Final case complete", value: String(current.journey.finalCaseComplete) })), current.journey.customerWorkBundles.length ? h("pre", { className: "json section" }, pretty(current.journey.customerWorkBundles)) : h("p", { className: "notice" }, "The ownership document was reviewed, but relationship currentness/freshness remains unresolved in the deterministic case."))),
      h("section", { className: "panel section history" },
        h("div", { className: "history-list" }, demo.snapshots.map((item) => h("article", { className: "history-item", key: item.snapshot.snapshotId }, h("strong", null, `${item.sequence}. ${human(item.reason)}`), h("span", null, `#${shortHash(item.snapshot.snapshotId)}`), h("span", null, item.snapshot.decisionContent.history.supersessionReason || "GENESIS")))),
        h("div", null, h("h2", null, "Immutable Decision History"), h("p", null, "Snapshot A remains reconstructable. Snapshot B is linked with NEW_FACTS and pins the graph, calculations, qualifications, Evidence references, needs and plan."), h("details", null, h("summary", null, "Evidence handoff correlation and decision audit"), h("pre", { className: "json" }, pretty({ externalEvidenceHandoff: demo.externalEvidenceHandoff, artifactCorrelation: demo.artifactCorrelation, decisionAudit: demo.decisionAudit }))))),
      h("section", { className: "panel section" }, h("h2", null, "Presenter guide"), h("ol", null,
        h("li", null, "Show Snapshot A’s unresolved ownership need and planned Evidence request."), h("li", null, "Use the source-backed manually reviewed fixture; no new provider call occurs."), h("li", null, "Inspect six relationship facts plus eight ordinary certification statements from one source document."), h("li", null, "Apply the visibly fixture-only identity and claim decisions."), h("li", null, "Show the dated certification, unverified authority and why current qualification remains indeterminate."), h("li", null, "Compare the target-specific graph with the optional full source-document view."))),
      readiness && h("p", { className: "field-help" }, `Policy ${readiness.policyIdentity?.version || "1.6-RC"} remains REVIEW ONLY and not production approved.`));
  }

  function ReviewWorkspace({ session, setSession, busy, setBusy, error, setError, reset, catalogue, applicantCatalogue }) {
    const [tab, setTab] = React.useState("CASE_SUMMARY");
    const [graphFilter, setGraphFilter] = React.useState(session.uiState?.graphFilter || "OWNERSHIP");
    const [selectedList, setSelectedList] = React.useState(null);
    const [applicantSession, setApplicantSession] = React.useState(null);
    const [cachedApplicantRecord, setCachedApplicantRecord] = React.useState(null);
    const [applicantCacheNotice, setApplicantCacheNotice] = React.useState("");
    const [applicantCacheError, setApplicantCacheError] = React.useState(applicantSessionCache ? "" : "Browser-local applicant session storage is unavailable.");
    const suppressNextApplicantSave = React.useRef(false);
    const current = session.snapshots.at(-1);
    const view = current?.view;
    const run = async (operation, payload) => { setBusy(true); setError(""); try { setSession(await request(operation, payload)); } catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); } finally { setBusy(false); } };
    const apply = ({ identityDecisions, claimDecisions }) => run("APPLY_REVIEW_DECISIONS", { session, identityDecisions, claimDecisions });
    const changeProfile = (profileId) => run("CHANGE_REVIEW_PROFILE", { session, profileId, evaluationTime: new Date().toISOString() });
    React.useEffect(() => {
      if (!applicantSessionCache) return;
      applicantSessionCache.restoreLast().then(async ({ record, error: restoreError }) => {
        if (restoreError) { setApplicantCacheError(restoreError); return; }
        if (!record) return;
        setCachedApplicantRecord(record);
        try {
          const verified = await request("VALIDATE_APPLICANT_SESSION", { session: record.session });
          suppressNextApplicantSave.current = true;
          setApplicantSession(verified);
          setTab("APPLICANT_JOURNEY_V2");
          setApplicantCacheNotice(record.inFlightOperation
            ? "Your previous submission may still be processing. Review the latest recorded activity before trying again."
            : "Restored your local Lab demo session");
        } catch (_cause) {
          setApplicantCacheError("The saved applicant session failed Snapshot verification and was not restored.");
        }
      });
    }, []);
    React.useEffect(() => {
      if (!applicantSessionCache || !applicantSession) return;
      if (suppressNextApplicantSave.current) { suppressNextApplicantSave.current = false; return; }
      if (!["FIXTURE", "REPLAY"].includes(applicantSession.sourceMode) && applicantSession.liveSaveOptIn !== true) return;
      applicantSessionCache.save(applicantSession, { liveOptIn: applicantSession.liveSaveOptIn === true })
        .then((record) => { setCachedApplicantRecord(record); setApplicantCacheError(""); })
        .catch(() => setApplicantCacheError("This Lab session could not be saved locally."));
    }, [applicantSession]);
    const resumeCachedApplicant = async () => {
      if (!cachedApplicantRecord) return;
      setBusy(true); setError("");
      try {
        const verified = await request("VALIDATE_APPLICANT_SESSION", { session: cachedApplicantRecord.session });
        suppressNextApplicantSave.current = true;
        setApplicantSession(verified);
        setApplicantCacheNotice("Restored your local Lab demo session");
      } catch (cause) { setApplicantCacheError(cause.message); }
      finally { setBusy(false); }
    };
    const startNewApplicant = () => {
      if (applicantSession && !window.confirm("Start a new Lab demo? The current demo remains available through Resume last demo.")) return;
      setApplicantSession(null);
      setApplicantCacheNotice("Choose a fixture to start a new Lab demo. Your previous saved demo has not been deleted.");
    };
    const resetApplicant = async () => {
      if (!applicantSession || !window.confirm("Reset this demo to its initial fixture state? Its locally saved progress will be removed.")) return;
      const fixtureId = applicantSession.fixtureId;
      setBusy(true); setError("");
      try {
        if (applicantSessionCache) await applicantSessionCache.remove(applicantSession.sessionId);
        const next = await request("START_APPLICANT_FIXTURE", { fixtureId, profileId: applicantSession.profileIdentity?.profileId || session.selectedProfileId });
        setApplicantSession(next);
        setApplicantCacheNotice("Demo reset to its initial fixture state.");
      } catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    const completeFixtureReview = async () => {
      setBusy(true); setError("");
      try {
        setApplicantSession(await request("COMPLETE_APPLICANT_FIXTURE_REVIEW", { session: applicantSession }));
        setApplicantCacheNotice("Preconfigured fixture review completed and the applicant journey was refreshed.");
      } catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    const saveLiveApplicantLocally = async () => {
      if (!applicantSessionCache || !applicantSession || applicantSession.sourceMode !== "LIVE") return;
      setBusy(true); setError("");
      try {
        const next = { ...applicantSession, liveSaveOptIn: true };
        const record = await applicantSessionCache.save(next, { liveOptIn: true });
        suppressNextApplicantSave.current = true;
        setApplicantSession(next);
        setCachedApplicantRecord(record);
        setApplicantCacheNotice("Saved only in this browser — Lab testing, not production case storage");
      } catch (cause) { setApplicantCacheError(cause.message); }
      finally { setBusy(false); }
    };
    if (!view) return h("main", { className: "shell" }, h("header", { className: "workspace-header" }, h("div", null, h("h2", null, session.companyContext.legalEntityName), h("p", null, "Successor intake is candidate-before-conclusion; explicit identity and claim decisions are required.")), h("button", { className: "secondary", onClick: reset }, "New case")), error && h("div", { className: "error" }, error), h(DecisionsPanel, { session, busy, apply }));
    const profileOptions = (catalogue?.profiles || []).map((profile) => h("option", { key: profile.profileId, value: profile.profileId }, profile.label));
    const header = h("header", { className: "workspace-header" },
      h("div", null, h("p", { className: "source-label" }, "SUCCESSOR REVIEW — 1.6-RC"), h("h2", null, session.companyContext.legalEntityName), h("p", null, `${session.sourceLabel} · ${session.sourceState} · Snapshot #${shortHash(view.snapshot.snapshotId)}`)),
      h("div", { className: "actions", style: { marginTop: 0 } }, h("label", { className: "profile-control" }, "Lab profile", h("select", { value: session.selectedProfileId, disabled: busy, onChange: (event) => changeProfile(event.target.value) }, profileOptions)), h("button", { className: "secondary", onClick: reset }, "New case")));
    const tabs = h("div", { className: "tabs", role: "tablist", "aria-label": "Successor review workspace views" }, REVIEW_TABS.map((name) => h("button", { key: name, className: "tab", role: "tab", "aria-selected": tab === name, onClick: () => setTab(name) }, human(name))));
    const summary = h("section", { className: "panel" }, h("h2", null, "Case Summary"), h("div", { className: "grid-2" },
      h("div", null, h("h3", null, "Decision state"), h("p", null, `${human(view.plan.state)} with ${view.counts.openCausalNeeds} open causal need(s). The exact pinned current wave is ${human(view.plan.currentPlanningWave.actor)}.`), h("p", null, `Governance: ${view.governance.readiness}; productionAuthorized=${String(view.governance.productionAuthorized)}.`)),
      h("div", { className: "applicant-disabled" }, h("p", { className: "source-label" }, "APPLICANT CONTRACT PREVIEW AVAILABLE"), h("p", null, `${view.journeyProjection.customerWorkBundles.length} immutable work bundle(s) are exposed read-only. Use Applicant Journey v2 for the separate interactive fixture-backed experience.`))));
    const panels = {
      CASE_SUMMARY: summary,
      APPLICANT_JOURNEY_V2: h(ApplicantJourneyPanel, {
        catalogue: applicantCatalogue,
        labSession: applicantSession,
        setLabSession: setApplicantSession,
        profileId: session.selectedProfileId,
        cachedRecord: cachedApplicantRecord,
        cacheNotice: applicantCacheNotice,
        cacheError: applicantCacheError,
        resumeCached: resumeCachedApplicant,
        startNew: startNewApplicant,
        resetCurrent: resetApplicant,
        saveLiveLocally: saveLiveApplicantLocally,
      }),
      APPLICANT_PREVIEW: h(ApplicantPreview, { view }),
      CONTRACT_INSPECTOR: h(ContractInspector, { view }),
      OWNERSHIP_AND_CONTROL_GRAPH: h(ReviewGraphPanel, { view, session, graphFilter, setGraphFilter }),
      QUALIFICATIONS: h(ReviewQualifications, { view, session }),
      REQUIREMENTS_AND_CAUSAL_NEEDS: h(ReviewRequirements, { view }),
      RESOLUTION_PLAN: h(ReviewPlan, { view }),
      EVIDENCE: h(ReviewEvidence, { view }),
      DECISION_HISTORY: h(React.Fragment, null,
        h(ReviewHistory, { session }),
        h(ApplicantInternalReviewPanel, { applicantSession, busy, completeFixtureReview })),
      DIAGNOSTICS: h(React.Fragment, null,
        h(ReviewDiagnostics, { view, session, graphFilter }),
        h(ApplicantSessionDiagnostics, { applicantSession })),
      BASELINE_COMPARISON: h(ReviewComparison, { session }),
    };
    return h("main", { className: "shell successor-workspace" }, header,
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status" }, "Creating a new immutable successor snapshot…"),
      h(ReviewHeaderMetrics, { view, session }), h(ReviewCountPanel, { view, selectedList, setSelectedList }), tabs, panels[tab]);
  }

  function App() {
    const [catalogue, setCatalogue] = React.useState(null);
    const [doctrine, setDoctrine] = React.useState(() => preingestedEvidenceCache?.hasSaved() ? "PREINGESTED_EVIDENCE" : "BASELINE");
    const [mode, setMode] = React.useState("FIXTURE");
    const [session, setSession] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [savedResults, setSavedResults] = React.useState([]);
    const [storageError, setStorageError] = React.useState(replayLibrary ? "" : "Browser-local replay storage is unavailable.");
    const attemptedApplicantRestore = React.useRef(false);
    React.useEffect(() => { fetch(API).then((response) => response.json()).then(setCatalogue).catch(() => setError("Fixture catalogue could not be loaded.")); }, []);
    React.useEffect(() => {
      if (!applicantSessionCache || attemptedApplicantRestore.current || preingestedEvidenceCache?.hasSaved()
        || new URLSearchParams(window.location.search).has("newCase")) return;
      attemptedApplicantRestore.current = true;
      applicantSessionCache.restoreLast().then(async ({ record }) => {
        if (!record || !["FIXTURE", "REPLAY", "LIVE"].includes(record.sourceMode)
          || !record.sourceIdentity?.sourceFixtureId) return;
        setDoctrine("SUCCESSOR_REVIEW");
        setBusy(true);
        try {
          setSession(await request("START_REVIEW_FIXTURE", {
            fixtureId: record.sourceIdentity.sourceFixtureId,
            profileId: record.profileIdentity?.profileId || "NOT_PROVIDED",
          }));
        } catch (_cause) {
          setError("The saved applicant demo could not restore its Lab workspace.");
        } finally { setBusy(false); }
      });
    }, []);
    React.useEffect(() => {
      if (!replayLibrary) return;
      const saved = replayLibrary.read();
      setSavedResults(saved.records);
      setStorageError(saved.error || "");
    }, []);
    const start = async (operation, payload) => {
      setBusy(true); setError("");
      try {
        const next = await request(operation, payload);
        if ((operation === "START_LIVE" || operation === "START_REVIEW_LIVE") && next.replayCapture && replayLibrary) {
          setSavedResults(replayLibrary.save(next.replayCapture));
          setStorageError("");
        }
        const nextSession = { ...next };
        delete nextSession.replayCapture;
        setSession(nextSession);
      }
      catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    const deleteReplay = (replayId) => {
      try { setSavedResults(replayLibrary.remove(replayId)); setStorageError(""); }
      catch (_cause) { setStorageError("The saved result could not be deleted from browser-local storage."); }
    };
    const clearReplays = () => {
      try { setSavedResults(replayLibrary ? replayLibrary.clear() : []); setStorageError(""); }
      catch (_cause) { setStorageError("Browser-local replay storage could not be cleared."); }
    };
    const evidenceDemo = doctrine === "PREINGESTED_EVIDENCE";
    const successor = doctrine !== "BASELINE";
    const currentView = session?.snapshots?.at(-1)?.view;
    const reviewPolicy = catalogue?.review?.policy;
    const setupReviewReadiness = reviewPolicy ? { watermarkRequired: true, policyIdentity: { policyPackId: reviewPolicy.policyPackId, version: reviewPolicy.version }, readiness: reviewPolicy.readiness, blockingReasons: [{ code: "POLICY_NOT_PRODUCTION_APPROVED" }], unresolvedSignoffs: Array.from({ length: reviewPolicy.blockingSignoffCount }, (_, index) => ({ signoffId: `REVIEW_SIGNOFF_${index + 1}` })) } : null;
    const readiness = session?.policyReadiness || currentView?.policyReadiness || (successor ? setupReviewReadiness : catalogue?.policyReadiness);
    const selectDoctrine = (value) => { setDoctrine(value); setSession(null); setError(""); setMode("FIXTURE"); };
    return h("div", { className: "lab" },
      h("header", { className: "topbar" }, h("div", { className: "brand" }, h("div", { className: "brand-mark", "aria-hidden": "true" }, "UBO"), h("div", null, h("h1", null, "UBO Control Lab"), h("p", null, "Standalone compliance testing environment"))), h("div", { className: "session-badges" }, h("span", { className: "badge warn" }, "LAB DEMO — BROWSER-LOCAL SESSION STORAGE"), h("span", { className: "badge" }, successor ? "Policy 1.6-RC · REVIEW ONLY" : "Policy 1.5-RC · BASELINE"), h("span", { className: "badge" }, evidenceDemo ? "EvidenceConsumerV1 · Decision App v3" : successor ? "Review App v1 · Snapshot v2" : "Decision App v2 · Snapshot v1"))),
      h(PolicyReadinessWatermark, { readiness }),
      h("nav", { className: "doctrine-selector with-evidence-demo", "aria-label": "Policy and engine version" },
        h("button", { className: !successor ? "active" : "", "aria-pressed": !successor, onClick: () => selectDoctrine("BASELINE") }, h("strong", null, "BASELINE — 1.5-RC"), h("span", null, "Existing public v1 behavior")),
        h("button", { className: doctrine === "SUCCESSOR_REVIEW" ? "active" : "", "aria-pressed": doctrine === "SUCCESSOR_REVIEW", onClick: () => selectDoctrine("SUCCESSOR_REVIEW") }, h("strong", null, "SUCCESSOR REVIEW — 1.6-RC"), h("span", null, "Snapshot v2 · Review only · Not production approved")),
        h("button", { className: evidenceDemo ? "active" : "", "aria-pressed": evidenceDemo, onClick: () => selectDoctrine("PREINGESTED_EVIDENCE") }, h("strong", null, "BETTERCOMMS EVIDENCE DEMO"), h("span", null, "Pre-ingested Artifact · No upload"))),
      evidenceDemo
        ? h(PreingestedEvidenceWorkspace, { readiness })
        : session
        ? successor
          ? h(ReviewWorkspace, { session, setSession, busy, setBusy, error, setError, catalogue: catalogue?.review, applicantCatalogue: catalogue?.applicant, reset: () => { setSession(null); setError(""); } })
          : h(Workspace, { session, setSession, busy, setBusy, error, setError, reset: () => { setSession(null); setError(""); } })
        : successor
          ? h(ReviewSetup, { catalogue: catalogue?.review, mode, setMode, busy, error, savedResults, storageError, startFixture: (fixtureId, profileId) => start("START_REVIEW_FIXTURE", { fixtureId, profileId }), startLive: (companyContext, profileId) => start("START_REVIEW_LIVE", { companyContext, profileId }), startReplay: (replayRecord, profileId) => start("START_REVIEW_REPLAY", { replayRecord, profileId }) })
          : h(Setup, { catalogue, mode, setMode, busy, error, savedResults, storageError, deleteReplay, clearReplays, startFixture: (fixtureId, riskLevel) => start("START_FIXTURE", { fixtureId, riskLevel }), startLive: (companyContext) => start("START_LIVE", { companyContext }), startReplay: (replayRecord) => start("START_REPLAY", { replayRecord }) }));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
}());
