(function publish(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("react"), require("./OwnershipGraph"));
  else root.UboControlUI = Object.freeze({ ...root.UboControlUI, ...factory(root.React, root.UboControlUI) });
}(typeof globalThis !== "undefined" ? globalThis : this, function factory(React, graphModule) {
  "use strict";

  const h = React.createElement;
  const JOURNEY_CONTRACT_VERSION = "ubo-journey-projection-v1";
  const PLAN_CONTRACT_VERSION = "ubo-resolution-plan-v1";
  const GRAPH_CONTRACT_VERSION = "ubo-ownership-graph-projection-v1";
  const CUSTOMER_ACTION_EVENT_VERSION = "ubo-customer-action-v1";
  const CUSTOMER_STRATEGIES = new Set(["CUSTOMER_QUESTION", "CUSTOMER_DOCUMENT", "CUSTOMER_ATTESTATION"]);

  function unique(values) {
    return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
  }

  function humanize(value) {
    return String(value || "Information").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
  }

  function assertJourneyInputs(journey, plan, graph) {
    if (!journey || journey.contractVersion !== JOURNEY_CONTRACT_VERSION) {
      throw new TypeError(`UboJourney supports only ${JOURNEY_CONTRACT_VERSION}`);
    }
    if (!plan || plan.contractVersion !== PLAN_CONTRACT_VERSION) {
      throw new TypeError(`UboJourney supports only ${PLAN_CONTRACT_VERSION}`);
    }
    if (!Array.isArray(journey.customerWorkItems) || !journey.internalReview || !Array.isArray(journey.operationalBlockers)) {
      throw new TypeError("journey must contain the complete public customer projection");
    }
    if (!plan.recommendedWave || !Array.isArray(plan.recommendedWave.actions) || !Array.isArray(plan.recommendedWave.customerBundles)) {
      throw new TypeError("plan must contain the complete public recommended wave");
    }
    if (journey.decision?.snapshotHash && plan.snapshotHash && journey.decision.snapshotHash !== plan.snapshotHash) {
      throw new TypeError("journey and plan must describe the same DecisionSnapshot");
    }
    if (graph && graph.contractVersion !== GRAPH_CONTRACT_VERSION) {
      throw new TypeError(`graph must use ${GRAPH_CONTRACT_VERSION}`);
    }
    return { journey, plan, graph };
  }

  function displayValue(value) {
    if (Array.isArray(value)) return value.map(humanize).join(", ");
    if (value === true) return "Yes";
    if (value === false) return "No";
    return String(value ?? "Not recorded");
  }

  function entityName(entityId, journey, graph) {
    const node = graph?.nodes?.find((item) => item.entityId === entityId);
    if (node?.displayName) return node.displayName;
    const handoff = journey.qualifyingPersonHandoff?.find((item) => item.personEntityId === entityId);
    const name = handoff?.knownIdentityFields?.find(({ field }) => field === "full_legal_name")?.value;
    return name || "Ownership or control party";
  }

  function matchingWorkItems(bundle, journey) {
    const needIds = new Set(bundle.informationNeedIds || []);
    return (journey.customerWorkItems || []).filter((item) => (item.informationNeedIds || []).some((id) => needIds.has(id)));
  }

  function entityProfile(bundle, journey) {
    return matchingWorkItems(bundle, journey).map((item) => item.subject?.entityProfile).find(Boolean) || null;
  }

  function fieldLabel(field, profile) {
    const labels = {
      date_of_birth: "Date of birth",
      country_of_residence: "Country of residence",
      country_of_nationality: "Country of nationality",
      CURRENT_OWNERSHIP_AND_CONTROL: profile === "LLP" ? "Current members and surplus-asset rights" : "Current shareholders and ownership percentages",
      VOTING_RIGHTS: profile === "LLP" ? "Member voting rights" : "Voting rights",
      APPOINTMENT_CONTROL: profile === "LLP" ? "Persons entitled to participate in management" : "Director or board appointment rights",
      SIGNIFICANT_INFLUENCE_OR_CONTROL: "Other significant influence or control",
      SENIOR_MANAGEMENT_CANDIDATE: "Senior management candidate details",
      IDENTITY_ATTRIBUTE: "Identity information",
    };
    return labels[field] || humanize(field);
  }

  function fieldControl(field, profile, value, update, error, idPrefix) {
    const label = fieldLabel(field, profile);
    const id = `ubo-field-${String(idPrefix || "bundle").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${String(field).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const isLong = ["CURRENT_OWNERSHIP_AND_CONTROL", "VOTING_RIGHTS", "APPOINTMENT_CONTROL", "SIGNIFICANT_INFLUENCE_OR_CONTROL", "SENIOR_MANAGEMENT_CANDIDATE"].includes(field);
    const props = {
      id,
      name: field,
      value: value || "",
      required: true,
      "aria-required": "true",
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${id}-error` : undefined,
      onInput: (event) => update(field, event.target.value),
    };
    const control = isLong
      ? h("textarea", { ...props, rows: 4 })
      : h("input", { ...props, type: field === "date_of_birth" ? "date" : "text", autoComplete: field === "country_of_residence" ? "country-name" : "off" });
    return h("div", { className: "uj-field", key: field },
      h("label", { htmlFor: id }, label, h("span", { className: "uj-required" }, "Required")),
      control,
      error && h("p", { id: `${id}-error`, className: "uj-field-error", role: "alert" }, error));
  }

  function actionForField(actions, field) {
    return actions.find(({ subject }) => (subject?.attribute || subject?.concept) === field);
  }

  function ownershipStatement(row, contract, targetEntityId, localPartyKey) {
    const naturalPerson = row.entityType === "NATURAL_PERSON";
    const identifiers = row.registrationNumber
      ? [{ namespace: "CUSTOMER_PROVIDED_REGISTRATION", value: row.registrationNumber.trim() }]
      : [];
    let measurement;
    if (row.measurementType === "RANGE") {
      measurement = {
        type: "RANGE",
        lowerBound: row.lowerBound === "" ? null : Number(row.lowerBound),
        upperBound: row.upperBound === "" ? null : Number(row.upperBound),
        lowerInclusive: true,
        upperInclusive: true,
      };
    } else if (row.measurementType === "UNKNOWN") {
      measurement = { type: "UNKNOWN", ...(row.unknownReason ? { reason: row.unknownReason.trim() } : {}) };
    } else measurement = { type: "EXACT", value: row.exactValue === "" ? null : Number(row.exactValue) };
    return {
      type: contract.factType,
      concept: contract.concept,
      direction: contract.direction,
      subject: {
        name: row.name.trim(),
        entityType: row.entityType,
        ...(row.jurisdiction ? { jurisdiction: row.jurisdiction.trim().toUpperCase() } : {}),
        externalIdentifiers: identifiers,
        ...(naturalPerson ? { localPartyKey, registerAsNew: true } : {}),
      },
      object: { entityId: targetEntityId, externalIdentifiers: [] },
      relationship: contract.relationshipType,
      measurement,
      qualifiers: { currentState: contract.temporalMeaning, economicInterestConcept: contract.concept },
    };
  }

  function StructuredOwnershipField({ field, action, bundle, value, update, error }) {
    const contract = action.actionTemplate.submissionContract;
    const emptyRow = () => ({
      name: "", entityType: "NATURAL_PERSON", registrationNumber: "", jurisdiction: "",
      measurementType: "EXACT", exactValue: "", lowerBound: "", upperBound: "", unknownReason: "",
    });
    const [rows, setRows] = React.useState([emptyRow()]);
    const emit = (next) => {
      setRows(next);
      update(field, next.map((row, index) => ownershipStatement(
        row, contract, bundle.subject.entityId, `${bundle.bundleId}:owner:${index + 1}`,
      )));
    };
    const change = (index, key, nextValue) => emit(rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: nextValue } : row));
    const add = () => emit([...rows, emptyRow()]);
    const remove = (index) => emit(rows.filter((_row, rowIndex) => rowIndex !== index));
    return h("fieldset", { className: "uj-ownership-group", "aria-describedby": error ? `${bundle.bundleId}-ownership-error` : undefined },
      h("legend", null, "Current direct shareholders"),
      rows.map((row, index) => h("div", { className: "uj-ownership-row", key: `${bundle.bundleId}:owner:${index + 1}` },
        h("div", { className: "uj-ownership-row-header" }, h("strong", null, `Owner ${index + 1}`), rows.length > 1 && h("button", { type: "button", className: "uj-link-button", onClick: () => remove(index) }, "Remove")),
        h("label", null, "Name", h("input", { value: row.name, required: true, onInput: (event) => change(index, "name", event.target.value) })),
        h("label", null, "Owner type", h("select", { value: row.entityType, onChange: (event) => change(index, "entityType", event.target.value) },
          h("option", { value: "NATURAL_PERSON" }, "Person"), h("option", { value: "LEGAL_ENTITY" }, "Legal entity"))),
        row.entityType === "LEGAL_ENTITY" && h(React.Fragment, null,
          h("label", null, "Registration number (if known)", h("input", { value: row.registrationNumber, onInput: (event) => change(index, "registrationNumber", event.target.value) })),
          h("label", null, "Jurisdiction (if known)", h("input", { value: row.jurisdiction, onInput: (event) => change(index, "jurisdiction", event.target.value), maxLength: 2, placeholder: "GB" }))),
        h("label", null, "Ownership information", h("select", { value: row.measurementType, onChange: (event) => change(index, "measurementType", event.target.value) },
          contract.allowedMeasurementTypes.map((type) => h("option", { value: type, key: type }, type === "EXACT" ? "Exact percentage" : type === "RANGE" ? "Percentage range" : "Percentage unknown")))),
        row.measurementType === "EXACT" && h("label", null, "Percentage", h("input", { type: "number", min: 0, max: 100, step: "any", value: row.exactValue, required: true, onInput: (event) => change(index, "exactValue", event.target.value) })),
        row.measurementType === "RANGE" && h("div", { className: "uj-range" },
          h("label", null, "From %", h("input", { type: "number", min: 0, max: 100, step: "any", value: row.lowerBound, required: true, onInput: (event) => change(index, "lowerBound", event.target.value) })),
          h("label", null, "To %", h("input", { type: "number", min: 0, max: 100, step: "any", value: row.upperBound, required: true, onInput: (event) => change(index, "upperBound", event.target.value) }))),
        row.measurementType === "UNKNOWN" && h("label", null, "What ownership information do you know?", h("textarea", { rows: 2, value: row.unknownReason, onInput: (event) => change(index, "unknownReason", event.target.value) })))),
      h("button", { type: "button", className: "uj-secondary", onClick: add }, "Add another shareholder"),
      error && h("p", { id: `${bundle.bundleId}-ownership-error`, className: "uj-field-error", role: "alert" }, error));
  }

  function StateCard({ tone = "neutral", eyebrow, title, children }) {
    return h("section", { className: `uj-state-card ${tone}`, role: "status" },
      h("span", { className: "uj-state-icon", "aria-hidden": "true" }, tone === "complete" ? "✓" : tone === "progress" ? "↻" : "·"),
      h("div", null, h("p", { className: "uj-eyebrow" }, eyebrow), h("h3", null, title), children));
  }

  function ResolutionState({ journey, plan }) {
    if (journey.journeyState === "SPECIALIST_REVIEW_REQUIRED") {
      return h(StateCard, { tone: "complete", eyebrow: "Customer portion complete", title: "This structure will continue through specialist review." }, h("p", null, "We have the information we currently need from you. No further ownership questions are active."));
    }
    if (plan.state === "INTERNAL_REVIEW" || journey.journeyState === "INTERNAL_REVIEW_REQUIRED") {
      return h(StateCard, { tone: "complete", eyebrow: "Customer portion complete", title: "Your application will continue through review." }, h("p", null, "We have the information we currently need from you."));
    }
    if (plan.state === "SYSTEM_RESOLUTION") {
      return h(StateCard, { tone: "progress", eyebrow: "No action needed", title: "We are checking available information." }, h("p", null, "You can leave this with us for now. We will only ask if something remains unresolved."));
    }
    if (plan.state === "BLOCKED") {
      return h(StateCard, { eyebrow: "No customer remediation", title: "We cannot continue this check right now." }, h("p", null, "There is no additional ownership information for you to provide at this stage."));
    }
    return h(StateCard, { tone: "complete", eyebrow: "Ownership information established", title: "No additional ownership information is currently required." }, h("p", null, "The established ownership and control structure is shown below where available."));
  }

  function templateConfigured(actions) {
    return actions.every((action) => !action.actionTemplate
      || ["SUPPLIED", "CONTROL_ROOM_APPROVED"].includes(action.actionTemplate.contentStatus));
  }

  function customerChoices(bundle) {
    return (bundle.policyPermittedAlternatives || []).filter((item) => CUSTOMER_STRATEGIES.has(item.strategy)
      && item.applicabilityState === "APPLICABLE" && item.deferredReasonCode === "CUSTOMER_CHOICE_AVAILABLE");
  }

  function makeEvent({ eventType, bundle, journey, plan, values, confirmationResult, selectedResolutionOptionId, evidenceTypes }) {
    const items = matchingWorkItems(bundle, journey);
    const actions = bundle.recommendedCustomerActions || [];
    return {
      contractVersion: CUSTOMER_ACTION_EVENT_VERSION,
      eventType,
      snapshotId: plan.snapshotId,
      snapshotHash: plan.snapshotHash,
      bundleId: bundle.bundleId,
      workItemIds: unique(items.map(({ workItemId }) => workItemId)),
      actionIntentIds: unique(items.flatMap(({ actionIntentIds }) => actionIntentIds || [])),
      actionIds: unique(actions.map(({ actionId }) => actionId)),
      semanticActionTypes: unique(actions.map(({ actionType }) => actionType)),
      informationNeedIds: unique(bundle.informationNeedIds),
      requirementIds: unique(bundle.requirementIds),
      subject: {
        entityId: bundle.subject?.entityId || null,
        family: bundle.subject?.family || null,
        entityProfile: entityProfile(bundle, journey),
      },
      values: { ...(values || {}) },
      confirmationResult: confirmationResult || null,
      selectedCustomerResolutionOptionId: selectedResolutionOptionId || null,
      evidenceAction: eventType === "EVIDENCE_ACTION_REQUESTED" ? {
        intent: "EVIDENCE_ACTION_REQUESTED",
        evidenceTypes: unique(evidenceTypes || bundle.evidenceRequirements),
      } : null,
    };
  }

  function BundleCard({ bundle, journey, plan, graph, selected, onSelect, onAction }) {
    const actions = bundle.recommendedCustomerActions || [];
    const missing = bundle.missingFacts || [];
    const known = bundle.knownFacts || [];
    const profile = entityProfile(bundle, journey);
    const confirmation = actions.some(({ actionType }) => actionType === "CONFIRM_ESTABLISHED_INFORMATION");
    const evidence = unique([...(bundle.evidenceRequirements || []), ...actions.flatMap(({ evidenceTypes }) => evidenceTypes || [])]);
    const choices = customerChoices(bundle);
    const configured = templateConfigured(actions);
    const [values, setValues] = React.useState({});
    const [confirmationResult, setConfirmationResult] = React.useState("");
    const [selectedOption, setSelectedOption] = React.useState("");
    const [errors, setErrors] = React.useState({});
    const [submitted, setSubmitted] = React.useState(false);
    const statusRef = React.useRef(null);
    const update = (field, value) => { setValues((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: undefined })); };

    React.useEffect(() => { if (submitted && statusRef.current) statusRef.current.focus(); }, [submitted]);

    const submit = (event) => {
      event.preventDefault();
      const nextErrors = {};
      missing.forEach((field) => {
        const action = actionForField(actions, field);
        if (action?.actionTemplate?.submissionContract) {
          const rows = Array.isArray(values[field]) ? values[field] : [];
          const invalid = rows.length === 0 || rows.some((row) => !row.subject?.name
            || (row.measurement?.type === "EXACT" && !Number.isFinite(row.measurement.value))
            || (row.measurement?.type === "RANGE" && (!Number.isFinite(row.measurement.lowerBound) || !Number.isFinite(row.measurement.upperBound))));
          if (invalid) nextErrors[field] = "Provide a name and valid ownership percentage information for each shareholder.";
        } else if (!String(values[field] || "").trim()) nextErrors[field] = `${fieldLabel(field, profile)} is required.`;
      });
      if (confirmation && !confirmationResult) nextErrors.confirmation = "Choose whether the established information is still correct.";
      if (choices.length > 1 && !selectedOption) nextErrors.option = "Choose one of the available ways to respond.";
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) return;
      onAction?.(makeEvent({ eventType: "CUSTOMER_ACTION_SUBMITTED", bundle, journey, plan, values, confirmationResult: confirmationResult || null, selectedResolutionOptionId: selectedOption || null }));
      setSubmitted(true);
    };

    const requestEvidence = () => {
      onAction?.(makeEvent({ eventType: "EVIDENCE_ACTION_REQUESTED", bundle, journey, plan, values: {}, evidenceTypes: evidence }));
      setSubmitted(true);
    };
    const approvedWording = actions.map(({ actionTemplate }) => actionTemplate?.wording).find(Boolean);

    return h("article", {
      className: `uj-bundle ${selected ? "selected" : ""}`,
      "data-bundle-id": bundle.bundleId,
      onClick: () => onSelect(bundle.bundleId),
    },
    h("header", { className: "uj-bundle-header" },
      h("div", null, h("p", { className: "uj-eyebrow" }, bundle.subject?.family === "SENIOR_MANAGEMENT_PREPARATION" ? "Senior management candidate" : "Ownership and control"), h("h3", null, entityName(bundle.subject?.entityId, journey, graph))),
      h("span", { className: "uj-task-count" }, `${missing.length + evidence.length || 1} item${missing.length + evidence.length === 1 ? "" : "s"}`)),
    known.length > 0 && h("section", { className: "uj-known", "aria-label": "Already established" }, h("h4", null, "Already established"), h("dl", null, known.map(({ field, value }) => h(React.Fragment, { key: field }, h("dt", null, fieldLabel(field, profile)), h("dd", null, displayValue(value)))))),
    !configured ? h("div", { className: "uj-unavailable", role: "alert" }, h("strong", null, "Customer wording not configured"), h("p", null, "This request cannot be shown as an approved customer question yet."))
      : h("form", { className: "uj-form", onSubmit: submit, noValidate: true },
        h("section", { className: "uj-needed", "aria-label": "Still needed" }, h("h4", null, confirmation ? "Please confirm" : "Still needed"),
          approvedWording && h("p", { className: "uj-policy-wording" }, approvedWording.replace("{subject.display_name}", entityName(bundle.subject?.entityId, journey, graph))),
          confirmation && h("fieldset", { className: "uj-confirm" }, h("legend", null, "Is the established information still correct?"),
            h("label", null, h("input", { type: "radio", name: `${bundle.bundleId}-confirmation`, value: "CONFIRMED", checked: confirmationResult === "CONFIRMED", onChange: () => { setConfirmationResult("CONFIRMED"); setErrors((current) => ({ ...current, confirmation: undefined })); } }), " Yes, it is still correct"),
            h("label", null, h("input", { type: "radio", name: `${bundle.bundleId}-confirmation`, value: "CORRECTION_REQUIRED", checked: confirmationResult === "CORRECTION_REQUIRED", onChange: () => { setConfirmationResult("CORRECTION_REQUIRED"); setErrors((current) => ({ ...current, confirmation: undefined })); } }), " No, it needs updating"),
            errors.confirmation && h("p", { className: "uj-field-error", role: "alert" }, errors.confirmation)),
          missing.map((field) => {
            const action = actionForField(actions, field);
            return action?.actionTemplate?.submissionContract
              ? h(StructuredOwnershipField, { key: field, field, action, bundle, value: values[field], update, error: errors[field] })
              : fieldControl(field, profile, values[field], update, errors[field], bundle.bundleId);
          }),
          choices.length > 1 && h("div", { className: "uj-field" }, h("label", { htmlFor: `${bundle.bundleId}-option` }, "How would you like to respond?", h("span", { className: "uj-required" }, "Required")), h("select", { id: `${bundle.bundleId}-option`, value: selectedOption, onChange: (event) => setSelectedOption(event.target.value) }, h("option", { value: "" }, "Choose an approved option"), choices.map((choice) => h("option", { key: choice.resolutionOptionId, value: choice.resolutionOptionId }, choice.strategy === "CUSTOMER_DOCUMENT" ? "Provide an approved document" : "Provide details directly"))), errors.option && h("p", { className: "uj-field-error", role: "alert" }, errors.option))),
        evidence.length > 0 && h("section", { className: "uj-evidence" }, h("p", { className: "uj-eyebrow" }, "Supporting evidence"), h("h4", null, evidence.map(humanize).join(", ")), h("p", null, "A secure upload will be provided by the application hosting this journey."), h("button", { type: "button", className: "uj-secondary", onClick: requestEvidence }, "Continue to secure document handoff")),
        (missing.length > 0 || confirmation) && h("button", { type: "submit", className: "uj-primary" }, confirmation ? "Send confirmation" : "Send information"),
        submitted && h("p", { className: "uj-submitted", tabIndex: -1, ref: statusRef, role: "status" }, "Sent to the host. This task remains open until refreshed UBO projections are supplied.")));
  }

  function QualifyingSummary({ journey, graph }) {
    const people = journey.qualifyingPersonHandoff || [];
    if (!people.length) return null;
    return h("section", { className: "uj-people", "aria-label": "Established qualifying people" }, h("p", { className: "uj-eyebrow" }, "Established people"), h("div", null, people.map((person) => h("article", { key: person.personEntityId }, h("strong", null, entityName(person.personEntityId, journey, graph)), h("span", null, (person.roles || []).map(humanize).join(" · ") || "Recorded qualifying person")))));
  }

  function UboJourney({ journey: suppliedJourney, plan: suppliedPlan, graph: suppliedGraph, onAction, className = "" }) {
    const { journey, plan, graph } = assertJourneyInputs(suppliedJourney, suppliedPlan, suppliedGraph);
    const bundles = plan.state === "CUSTOMER_RESOLUTION" ? plan.recommendedWave.customerBundles : [];
    const [selectedBundleId, setSelectedBundleId] = React.useState(bundles[0]?.bundleId || null);
    const headingRef = React.useRef(null);
    const selectedBundle = bundles.find(({ bundleId }) => bundleId === selectedBundleId) || bundles[0] || null;
    const highlightEntityIds = selectedBundle?.graphLinks?.entityIds || [];
    const highlightRelationshipIds = selectedBundle?.graphLinks?.relationshipIds || [];

    React.useEffect(() => {
      setSelectedBundleId(bundles[0]?.bundleId || null);
      if (headingRef.current) headingRef.current.focus({ preventScroll: true });
    }, [plan.snapshotHash, plan.snapshotId]);

    const graphSelection = (selection) => {
      const linked = bundles.find((bundle) => selection.kind === "entity"
        ? bundle.graphLinks?.entityIds?.includes(selection.id)
        : selection.kind === "relationship" ? bundle.graphLinks?.relationshipIds?.includes(selection.id) : false);
      if (linked) setSelectedBundleId(linked.bundleId);
    };

    return h("section", { className: `uj-shell ${className}`.trim(), "data-plan-state": plan.state },
      h("header", { className: "uj-header" }, h("div", null, h("p", { className: "uj-kicker" }, "UBO CONTROL · CUSTOMER JOURNEY"), h("h2", { ref: headingRef, tabIndex: -1 }, "Your ownership information"), h("p", null, "We use information already established and ask only for what remains.")), h("span", { className: "uj-progress-label" }, bundles.length ? `${bundles.length} customer task${bundles.length === 1 ? "" : "s"}` : "No customer tasks")),
      h(QualifyingSummary, { journey, graph }),
      h("div", { className: `uj-layout ${graph ? "with-graph" : "without-graph"}` },
        graph && h("div", { className: "uj-graph", "aria-label": "Ownership context" }, h(graphModule.OwnershipGraph, { projection: graph, detailLevel: graphModule.DETAIL_LEVEL.CUSTOMER, height: 450, onSelectionChange: graphSelection, highlightEntityIds, highlightRelationshipIds })),
        h("div", { className: "uj-tasks" }, bundles.length
          ? bundles.map((bundle) => h(BundleCard, { key: bundle.bundleId, bundle, journey, plan, graph, selected: bundle.bundleId === selectedBundle?.bundleId, onSelect: setSelectedBundleId, onAction }))
          : h(ResolutionState, { journey, plan }))),
      h("p", { className: "uj-snapshot-note" }, "Customer responses are sent to the host for processing. This component does not change UBO case state."));
  }

  return Object.freeze({
    CUSTOMER_ACTION_EVENT_VERSION,
    GRAPH_CONTRACT_VERSION,
    JOURNEY_CONTRACT_VERSION,
    PLAN_CONTRACT_VERSION,
    UboJourney,
    assertJourneyInputs,
    fieldLabel,
    makeEvent,
    matchingWorkItems,
  });
}));
