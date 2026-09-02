(function () {
  "use strict";

  const h = React.createElement;
  const { OwnershipGraph, UboJourney, DETAIL_LEVEL } = UboControlUI;
  const API = "/api/ubo-control-lab";
  const TABS = ["CUSTOMER", "COMPLIANCE", "DECISIONS", "SOURCES", "HISTORY", "PLANNER", "EVIDENCE", "FEEDBACK", "DIAGNOSTICS"];
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

  function Metric({ label, value }) {
    return h("div", { className: "metric" }, h("span", null, label), h("strong", null, value ?? "—"));
  }

  function Empty({ children }) {
    return h("div", { className: "empty" }, children);
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
    return h("section", { className: "panel" }, h("h2", null, "Diagnostics"), h("div", { className: "grid-3" }, h(Metric, { label: "Lab source state", value: session.sourceState }), session.discovery?.replay && h(Metric, { label: "Replay saved", value: new Date(session.discovery.replay.originalSavedAt).toLocaleString() }), Object.entries(view.diagnostics).map(([key, value]) => h(Metric, { key, label: human(key), value: typeof value === "object" ? shortHash(value.hash || value.policyHash) : Array.isArray(value) ? value.join(", ") : String(value) }))), h("details", { className: "section" }, h("summary", null, "Current public projections and sealed session envelope"), h("pre", { className: "json" }, pretty({ sourceState: session.sourceState, replay: session.discovery?.replay || null, snapshot: view.snapshot, graph: view.graph, journey: view.journey, plan: view.plan, caseState: session.caseState }))));
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

  function App() {
    const [catalogue, setCatalogue] = React.useState(null);
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
        if (operation === "START_LIVE" && next.replayCapture && replayLibrary) {
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
    return h("div", { className: "lab" },
      h("header", { className: "topbar" }, h("div", { className: "brand" }, h("div", { className: "brand-mark", "aria-hidden": "true" }, "UBO"), h("div", null, h("h1", null, "UBO Control Lab"), h("p", null, "Standalone compliance testing environment"))), h("div", { className: "session-badges" }, h("span", { className: "badge warn" }, "CASE NON-RESUMABLE / REPLAY LOCAL"), h("span", { className: "badge" }, "Policy 1.5-RC"), h("span", { className: "badge" }, "Decision App v2"))),
      session
        ? h(Workspace, { session, setSession, busy, setBusy, error, setError, reset: () => { setSession(null); setError(""); } })
        : h(Setup, { catalogue, mode, setMode, busy, error, savedResults, storageError, deleteReplay, clearReplays, startFixture: (fixtureId, riskLevel) => start("START_FIXTURE", { fixtureId, riskLevel }), startLive: (companyContext) => start("START_LIVE", { companyContext }), startReplay: (replayRecord) => start("START_REPLAY", { replayRecord }) }));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
}());
