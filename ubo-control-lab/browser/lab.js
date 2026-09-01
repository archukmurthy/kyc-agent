(function () {
  "use strict";

  const h = React.createElement;
  const { OwnershipGraph, UboJourney, DETAIL_LEVEL } = UboControlUI;
  const API = "/api/ubo-control-lab";
  const TABS = ["CUSTOMER", "COMPLIANCE", "DECISIONS", "SOURCES", "HISTORY", "PLANNER", "EVIDENCE", "FEEDBACK", "DIAGNOSTICS"];

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

  function Setup({ catalogue, mode, setMode, busy, error, startFixture, startLive }) {
    const [fixtureId, setFixtureId] = React.useState("LAB18");
    const [company, setCompany] = React.useState({ legalEntityName: "", registrationNumber: "", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" });
    const update = (field, value) => setCompany((current) => ({ ...current, [field]: value }));
    return h("main", { className: "shell setup" },
      h("nav", { className: "mode-list", "aria-label": "Lab mode" },
        h("button", { className: `mode-button ${mode === "FIXTURE" ? "active" : ""}`, onClick: () => setMode("FIXTURE") }, h("strong", null, "Fixture Mode"), h("span", null, "Repeatable deterministic compliance scenarios.")),
        h("button", { className: `mode-button ${mode === "LIVE_DISCOVERY" ? "active" : ""}`, onClick: () => setMode("LIVE_DISCOVERY") }, h("strong", null, "Live Discovery"), h("span", null, "Real UK discovery through the accepted server-side adapter.")),
        h("button", { className: "mode-button", disabled: true, title: "Evidence Platform integration is pending" }, h("strong", null, "Live Evidence"), h("span", null, "Unavailable until Gate 4 — Evidence Platform integration is pending."))),
      h("section", { className: "card" },
        h("p", { className: "source-label" }, mode === "FIXTURE" ? "SIMULATED FIXTURE" : "LIVE PROVIDER"),
        h("h2", null, mode === "FIXTURE" ? "Choose a compliance scenario" : "Start a real UK company case"),
        h("p", null, mode === "FIXTURE" ? "Every scenario runs through Decision Application v2 and creates a real immutable snapshot." : "The company number is required to bind the subject safely. Legacy UBO conclusions are ignored."),
        mode === "FIXTURE"
          ? h("div", { className: "form-grid" },
            h("div", { className: "field full" }, h("label", { htmlFor: "fixture" }, "Scenario"), h("select", { id: "fixture", value: fixtureId, onChange: (event) => setFixtureId(event.target.value) }, (catalogue?.fixtures || []).map((fixture) => h("option", { key: fixture.id, value: fixture.id }, `${fixture.id} · ${fixture.label}`)))),
            h("div", { className: "field full" }, h("p", null, catalogue?.fixtures.find(({ id }) => id === fixtureId)?.description || "")),
            h("div", { className: "field" }, h("label", { htmlFor: "fixture-risk" }, "Risk context"), h("select", { id: "fixture-risk", value: company.riskLevel, onChange: (event) => update("riskLevel", event.target.value) }, ["LOW", "MEDIUM", "HIGH"].map((value) => h("option", { key: value }, value)))),
            h("div", { className: "field", style: { alignSelf: "end" } }, h("button", { className: "primary", disabled: busy, onClick: () => startFixture(fixtureId, company.riskLevel) }, busy ? "Running…" : "Run UBO")))
          : h("form", { className: "form-grid", onSubmit: (event) => { event.preventDefault(); startLive(company); } },
            h("div", { className: "field" }, h("label", { htmlFor: "name" }, "Legal entity name"), h("input", { id: "name", required: true, value: company.legalEntityName, onInput: (event) => update("legalEntityName", event.target.value), placeholder: "Example Holdings Ltd" })),
            h("div", { className: "field" }, h("label", { htmlFor: "number" }, "Registration/company number"), h("input", { id: "number", required: true, value: company.registrationNumber, onInput: (event) => update("registrationNumber", event.target.value), placeholder: "01234567" })),
            h("div", { className: "field" }, h("label", { htmlFor: "jurisdiction" }, "Jurisdiction"), h("input", { id: "jurisdiction", value: "GB", readOnly: true })),
            h("div", { className: "field" }, h("label", { htmlFor: "profile" }, "Entity profile"), h("select", { id: "profile", value: company.entityProfile, onChange: (event) => update("entityProfile", event.target.value) }, h("option", null, "COMPANY"), h("option", null, "LLP"))),
            h("div", { className: "field" }, h("label", { htmlFor: "risk" }, "Risk context"), h("select", { id: "risk", value: company.riskLevel, onChange: (event) => update("riskLevel", event.target.value) }, ["LOW", "MEDIUM", "HIGH"].map((value) => h("option", { key: value }, value)))),
            h("div", { className: "field", style: { alignSelf: "end" } }, h("button", { type: "submit", className: "primary", disabled: busy }, busy ? "Running live Discovery…" : "Run UBO"))),
        error && h("div", { className: "error", role: "alert" }, error)));
  }

  function CustomerPanel({ view, onAction, busy, error }) {
    return h("section", { className: "panel" },
      error && h("div", { className: "error", role: "alert" }, error),
      busy && h("div", { className: "notice", role: "status" }, "Applying the customer response through Decision Application v2…"),
      h(UboJourney, { journey: view.journey, plan: view.plan, graph: view.graph, onAction }),
      h("div", { className: "section" }, h("h3", null, "Full ownership graph"), h(OwnershipGraph, { projection: view.graph, detailLevel: DETAIL_LEVEL.CUSTOMER })));
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
      h("div", { className: "section" }, h("h3", null, "R01–R14 requirement matrix"), h(Requirements, { requirements: view.requirements })),
      h("div", { className: "section grid-2" },
        [["InformationNeeds", compliance.informationNeeds], ["PolicyGaps", compliance.policyGaps], ["OperationalBlockers", compliance.operationalBlockers], ["Conflicts", compliance.conflicts], ["ReviewRequirements", compliance.reviewRequirements], ["Risk signals", compliance.riskSignals]].map(([title, items]) => h("details", { key: title }, h("summary", null, `${title} · ${items.length}`), h("pre", { className: "json" }, pretty(items))))),
      h("div", { className: "section" }, h("h3", null, "Ownership and control explanation"), h(OwnershipGraph, { projection: view.graph, detailLevel: DETAIL_LEVEL.EXPLAIN })));
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
    return h("section", { className: "panel" }, h("h2", null, "Candidate facts and provenance"), session.candidateSources.length ? session.candidateSources.map((source) => h("details", { key: source.sourceRecordId }, h("summary", null, `${source.capability} · ${source.outcomeState} · ${source.candidateFacts.length} candidate fact(s)`), h("div", null, h("span", { className: "source-label" }, source.simulated ? "SIMULATED" : source.capability === "CUSTOMER_INPUT" ? "CUSTOMER" : "LIVE"), h("p", null, `Request: ${source.requestId}`), h("pre", { className: "json" }, pretty({ facts: source.candidateFacts, evidence: source.operationEvidenceReferences, issues: source.issues }))))) : h(Empty, null, "No candidate sources have been intaken."));
  }

  function PlannerPanel({ view }) {
    return h("section", { className: "panel" }, h("h2", null, "Resolution Planner"), h("div", { className: "grid-3" }, h(Metric, { label: "Wave", value: human(view.plan.state) }), h(Metric, { label: "Actor", value: human(view.plan.recommendedWave.actor) }), h(Metric, { label: "Prior attempts", value: view.plan.summary.priorResolutionAttempts })), h("div", { className: "section grid-2" }, h("details", { open: true }, h("summary", null, `Recommended actions · ${view.plan.recommendedWave.actions.length}`), h("pre", { className: "json" }, pretty(view.plan.recommendedWave.actions))), h("details", null, h("summary", null, `Customer bundles · ${view.plan.recommendedWave.customerBundles.length}`), h("pre", { className: "json" }, pretty(view.plan.recommendedWave.customerBundles))), h("details", null, h("summary", null, `Deferred alternatives · ${view.plan.deferredAlternatives.length}`), h("pre", { className: "json" }, pretty(view.plan.deferredAlternatives))), h("details", null, h("summary", null, "Rationale"), h("pre", { className: "json" }, pretty(view.plan.rationale)))));
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
    return h("section", { className: "panel" }, h("h2", null, "Diagnostics"), h("div", { className: "grid-3" }, Object.entries(view.diagnostics).map(([key, value]) => h(Metric, { key, label: human(key), value: typeof value === "object" ? shortHash(value.hash || value.policyHash) : Array.isArray(value) ? value.join(", ") : String(value) }))), h("details", { className: "section" }, h("summary", null, "Current public projections and sealed session envelope"), h("pre", { className: "json" }, pretty({ snapshot: view.snapshot, graph: view.graph, journey: view.journey, plan: view.plan, caseState: session.caseState }))));
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
      h("header", { className: "workspace-header" }, h("div", null, h("h2", null, session.companyContext.legalEntityName), h("p", null, `${session.sourceLabel} · ${session.caseContext.entityProfile} · ${session.caseContext.riskLevel} risk`)), h("div", { className: "actions", style: { marginTop: 0 } }, h("span", { className: "status" }, human(state)), h("button", { className: "secondary", onClick: reset }, "New case"))),
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
    React.useEffect(() => { fetch(API).then((response) => response.json()).then(setCatalogue).catch(() => setError("Fixture catalogue could not be loaded.")); }, []);
    const start = async (operation, payload) => {
      setBusy(true); setError("");
      try { setSession(await request(operation, payload)); }
      catch (cause) { setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); }
      finally { setBusy(false); }
    };
    return h("div", { className: "lab" },
      h("header", { className: "topbar" }, h("div", { className: "brand" }, h("div", { className: "brand-mark", "aria-hidden": "true" }, "UBO"), h("div", null, h("h1", null, "UBO Control Lab"), h("p", null, "Standalone compliance testing environment"))), h("div", { className: "session-badges" }, h("span", { className: "badge warn" }, "SESSION-ONLY / NON-RESUMABLE"), h("span", { className: "badge" }, "Policy 1.5-RC"), h("span", { className: "badge" }, "Decision App v2"))),
      session
        ? h(Workspace, { session, setSession, busy, setBusy, error, setError, reset: () => { setSession(null); setError(""); } })
        : h(Setup, { catalogue, mode, setMode, busy, error, startFixture: (fixtureId, riskLevel) => start("START_FIXTURE", { fixtureId, riskLevel }), startLive: (companyContext) => start("START_LIVE", { companyContext }) }));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
}());
