(function () {
  "use strict";

  const h = React.createElement;
  const { OwnershipGraph, UboJourney, DETAIL_LEVEL } = UboControlUI;
  const API = "/api/ubo-control-lab";
  const TABS = ["CUSTOMER", "COMPLIANCE", "DECISIONS", "SOURCES", "HISTORY", "PLANNER", "EVIDENCE", "FEEDBACK", "DIAGNOSTICS"];
  const REVIEW_TABS = ["CASE_SUMMARY", "OWNERSHIP_AND_CONTROL_GRAPH", "QUALIFICATIONS", "REQUIREMENTS_AND_CAUSAL_NEEDS", "RESOLUTION_PLAN", "EVIDENCE", "DECISION_HISTORY", "DIAGNOSTICS", "BASELINE_COMPARISON"];
  const GRAPH_FILTERS = ["OWNERSHIP", "VOTING", "CONTROL", "ALL"];
  let replayLibrary = null;
  try { replayLibrary = UboLabReplay.createReplayLibrary(window.localStorage); } catch (_error) { replayLibrary = null; }

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
    return String(value || "Not recorded").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
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

  function ReviewWorkspace({ session, setSession, busy, setBusy, error, setError, reset, catalogue }) {
    const [tab, setTab] = React.useState("CASE_SUMMARY");
    const [graphFilter, setGraphFilter] = React.useState(session.uiState?.graphFilter || "OWNERSHIP");
    const [selectedList, setSelectedList] = React.useState(null);
    const current = session.snapshots.at(-1);
    const view = current?.view;
    const run = async (operation, payload) => { setBusy(true); setError(""); try { setSession(await request(operation, payload)); } catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); } finally { setBusy(false); } };
    const apply = ({ identityDecisions, claimDecisions }) => run("APPLY_REVIEW_DECISIONS", { session, identityDecisions, claimDecisions });
    const changeProfile = (profileId) => run("CHANGE_REVIEW_PROFILE", { session, profileId, evaluationTime: new Date().toISOString() });
    if (!view) return h("main", { className: "shell" }, h("header", { className: "workspace-header" }, h("div", null, h("h2", null, session.companyContext.legalEntityName), h("p", null, "Successor intake is candidate-before-conclusion; explicit identity and claim decisions are required.")), h("button", { className: "secondary", onClick: reset }, "New case")), error && h("div", { className: "error" }, error), h(DecisionsPanel, { session, busy, apply }));
    const profileOptions = (catalogue?.profiles || []).map((profile) => h("option", { key: profile.profileId, value: profile.profileId }, profile.label));
    const header = h("header", { className: "workspace-header" },
      h("div", null, h("p", { className: "source-label" }, "SUCCESSOR REVIEW — 1.6-RC"), h("h2", null, session.companyContext.legalEntityName), h("p", null, `${session.sourceLabel} · ${session.sourceState} · Snapshot #${shortHash(view.snapshot.snapshotId)}`)),
      h("div", { className: "actions", style: { marginTop: 0 } }, h("label", { className: "profile-control" }, "Lab profile", h("select", { value: session.selectedProfileId, disabled: busy, onChange: (event) => changeProfile(event.target.value) }, profileOptions)), h("button", { className: "secondary", onClick: reset }, "New case")));
    const tabs = h("div", { className: "tabs", role: "tablist", "aria-label": "Successor review workspace views" }, REVIEW_TABS.map((name) => h("button", { key: name, className: "tab", role: "tab", "aria-selected": tab === name, onClick: () => setTab(name) }, human(name))));
    const summary = h("section", { className: "panel" }, h("h2", null, "Case Summary"), h("div", { className: "grid-2" },
      h("div", null, h("h3", null, "Decision state"), h("p", null, `${human(view.plan.state)} with ${view.counts.openCausalNeeds} open causal need(s). The exact pinned current wave is ${human(view.plan.currentPlanningWave.actor)}.`), h("p", null, `Governance: ${view.governance.readiness}; productionAuthorized=${String(view.governance.productionAuthorized)}.`)),
      h("div", { className: "applicant-disabled" }, h("p", { className: "source-label" }, "APPLICANT JOURNEY v2 NOT YET ENABLED"), h("p", null, `${view.plan.customerActions.length} planned customer action(s) are read-only. Wave 11 owns JourneyProjection v2 and CustomerAction v2.`))));
    const panels = {
      CASE_SUMMARY: summary,
      OWNERSHIP_AND_CONTROL_GRAPH: h(ReviewGraphPanel, { view, session, graphFilter, setGraphFilter }),
      QUALIFICATIONS: h(ReviewQualifications, { view, session }),
      REQUIREMENTS_AND_CAUSAL_NEEDS: h(ReviewRequirements, { view }),
      RESOLUTION_PLAN: h(ReviewPlan, { view }),
      EVIDENCE: h(ReviewEvidence, { view }),
      DECISION_HISTORY: h(ReviewHistory, { session }),
      DIAGNOSTICS: h(ReviewDiagnostics, { view, session, graphFilter }),
      BASELINE_COMPARISON: h(ReviewComparison, { session }),
    };
    return h("main", { className: "shell successor-workspace" }, header,
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status" }, "Creating a new immutable successor snapshot…"),
      h(ReviewHeaderMetrics, { view, session }), h(ReviewCountPanel, { view, selectedList, setSelectedList }), tabs, panels[tab]);
  }

  function App() {
    const [catalogue, setCatalogue] = React.useState(null);
    const [doctrine, setDoctrine] = React.useState("BASELINE");
    const [mode, setMode] = React.useState("FIXTURE");
    const [session, setSession] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [savedResults, setSavedResults] = React.useState([]);
    const [storageError, setStorageError] = React.useState(replayLibrary ? "" : "Browser-local replay storage is unavailable.");
    React.useEffect(() => { fetch(API).then((response) => response.json()).then(setCatalogue).catch(() => setError("Fixture catalogue could not be loaded.")); }, []);
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
    const successor = doctrine === "SUCCESSOR_REVIEW";
    const currentView = session?.snapshots?.at(-1)?.view;
    const reviewPolicy = catalogue?.review?.policy;
    const setupReviewReadiness = reviewPolicy ? { watermarkRequired: true, policyIdentity: { policyPackId: reviewPolicy.policyPackId, version: reviewPolicy.version }, readiness: reviewPolicy.readiness, blockingReasons: [{ code: "POLICY_NOT_PRODUCTION_APPROVED" }], unresolvedSignoffs: Array.from({ length: reviewPolicy.blockingSignoffCount }, (_, index) => ({ signoffId: `REVIEW_SIGNOFF_${index + 1}` })) } : null;
    const readiness = session?.policyReadiness || currentView?.policyReadiness || (successor ? setupReviewReadiness : catalogue?.policyReadiness);
    const selectDoctrine = (value) => { setDoctrine(value); setSession(null); setError(""); setMode("FIXTURE"); };
    return h("div", { className: "lab" },
      h("header", { className: "topbar" }, h("div", { className: "brand" }, h("div", { className: "brand-mark", "aria-hidden": "true" }, "UBO"), h("div", null, h("h1", null, "UBO Control Lab"), h("p", null, "Standalone compliance testing environment"))), h("div", { className: "session-badges" }, h("span", { className: "badge warn" }, "CASE NON-RESUMABLE / REPLAY LOCAL"), h("span", { className: "badge" }, successor ? "Policy 1.6-RC · REVIEW ONLY" : "Policy 1.5-RC · BASELINE"), h("span", { className: "badge" }, successor ? "Review App v1 · Snapshot v2" : "Decision App v2 · Snapshot v1"))),
      h(PolicyReadinessWatermark, { readiness }),
      h("nav", { className: "doctrine-selector", "aria-label": "Policy and engine version" },
        h("button", { className: !successor ? "active" : "", "aria-pressed": !successor, onClick: () => selectDoctrine("BASELINE") }, h("strong", null, "BASELINE — 1.5-RC"), h("span", null, "Existing public v1 behavior")),
        h("button", { className: successor ? "active" : "", "aria-pressed": successor, onClick: () => selectDoctrine("SUCCESSOR_REVIEW") }, h("strong", null, "SUCCESSOR REVIEW — 1.6-RC"), h("span", null, "Snapshot v2 · Review only · Not production approved"))),
      session
        ? successor
          ? h(ReviewWorkspace, { session, setSession, busy, setBusy, error, setError, catalogue: catalogue?.review, reset: () => { setSession(null); setError(""); } })
          : h(Workspace, { session, setSession, busy, setBusy, error, setError, reset: () => { setSession(null); setError(""); } })
        : successor
          ? h(ReviewSetup, { catalogue: catalogue?.review, mode, setMode, busy, error, savedResults, storageError, startFixture: (fixtureId, profileId) => start("START_REVIEW_FIXTURE", { fixtureId, profileId }), startLive: (companyContext, profileId) => start("START_REVIEW_LIVE", { companyContext, profileId }), startReplay: (replayRecord, profileId) => start("START_REVIEW_REPLAY", { replayRecord, profileId }) })
          : h(Setup, { catalogue, mode, setMode, busy, error, savedResults, storageError, deleteReplay, clearReplays, startFixture: (fixtureId, riskLevel) => start("START_FIXTURE", { fixtureId, riskLevel }), startLive: (companyContext) => start("START_LIVE", { companyContext }), startReplay: (replayRecord) => start("START_REPLAY", { replayRecord }) }));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
}());
