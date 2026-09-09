(function publish(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("react"));
  else root.UboControlUI = Object.freeze({ ...root.UboControlUI, ...factory(root.React) });
}(typeof globalThis !== "undefined" ? globalThis : this, function factory(React) {
  "use strict";

  const h = React.createElement;
  const APPLICANT_JOURNEY_UI_VERSION = "ubo-applicant-journey-ui-v2";
  const JOURNEY_PROJECTION_VERSION = "ubo-journey-projection-v2";
  const CUSTOMER_ACTION_VERSION = "ubo-customer-action-v2";
  const ACTION = Object.freeze({
    CONFIRM: "CONFIRM_ESTABLISHED_INFORMATION",
    CORRECT: "CORRECTION_REQUIRED",
    OWNERSHIP: "SUBMIT_STRUCTURED_RELATIONSHIP",
    ATTRIBUTES: "SUBMIT_ENTITY_ATTRIBUTES",
    EVIDENCE: "REQUEST_EXTERNAL_EVIDENCE",
    DELEGATE: "DELEGATE_CUSTOMER_WORK",
  });

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))].sort();
  }

  function human(value) {
    return String(value || "Not recorded").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
  }

  function assertApplicantJourneyV2(journey) {
    if (!journey || journey.contractVersion !== JOURNEY_PROJECTION_VERSION) {
      throw new TypeError(`UboApplicantJourneyV2 supports only ${JOURNEY_PROJECTION_VERSION}`);
    }
    if (!journey.decision || !Array.isArray(journey.customerWorkBundles) || !journey.finishLine) {
      throw new TypeError("journey must contain the complete public JourneyProjection v2 contract");
    }
    return journey;
  }

  function approvedContent(action, bundle, content) {
    if ([ACTION.EVIDENCE, ACTION.DELEGATE].includes(action.actionType)) {
      return { ready: true, title: action.actionType === ACTION.EVIDENCE ? "Provide supporting evidence" : "Ask someone else to help", body: null };
    }
    const references = unique(bundle.approvedContentReferences);
    const templates = content?.templates || {};
    const resolved = references.map((reference) => templates[reference]).filter(Boolean);
    return {
      ready: references.length > 0 && resolved.length === references.length,
      title: resolved[0]?.title || null,
      body: resolved[0]?.body || null,
    };
  }

  function actionExecutable(action, bundle, content) {
    return bundle.state === "OPEN"
      && action.executable === true
      && (action.blockingSignoffs || []).length === 0
      && approvedContent(action, bundle, content).ready;
  }

  function actionLabel(actionType) {
    return ({
      [ACTION.CONFIRM]: "Confirm this information",
      [ACTION.CORRECT]: "Something changed",
      [ACTION.OWNERSHIP]: "Tell us about ownership",
      [ACTION.ATTRIBUTES]: "Provide person details",
      [ACTION.EVIDENCE]: "Continue to evidence",
      [ACTION.DELEGATE]: "Ask someone else to help",
    })[actionType] || human(actionType);
  }

  function entityLabel(entityId, content) {
    return content?.entityLabels?.[entityId] || `Entity reference ${String(entityId || "unknown").slice(-10)}`;
  }

  function buildCustomerActionV2({ journey, bundle, action, actorContext, payload, submittedAt, informationAsAtDate, delegatedFrom, content }) {
    assertApplicantJourneyV2(journey);
    if (!actionExecutable(action, bundle, content)) throw new TypeError("The selected customer action is not executable");
    const decision = journey.decision;
    return {
      contractVersion: CUSTOMER_ACTION_VERSION,
      caseReference: decision.caseReference,
      sourceDecisionSnapshot: { snapshotId: decision.snapshotId, snapshotHash: decision.snapshotHash },
      sourceResolutionPlan: { planId: decision.planId, planHash: decision.planHash },
      bundleId: bundle.bundleId,
      resolutionGroupId: bundle.resolutionGroupId,
      resolutionActionId: action.sourceResolutionActionId,
      informationNeedIds: [...bundle.informationNeedIds],
      requirementIds: [...bundle.requirementIds],
      canonicalSubject: bundle.canonicalSubject,
      frontierEntityIds: [...bundle.frontierEntityIds],
      policyIdentity: decision.policyIdentity,
      actionType: action.actionType,
      submissionContract: action.submissionContract,
      actorReference: actorContext.actorReference,
      actorCapacity: actorContext.actorCapacity,
      submittedAt,
      informationAsAtDate,
      delegatedFrom: delegatedFrom || null,
      payload,
    };
  }

  function draftKey(journey, bundle, action) {
    return [journey.decision.snapshotHash, journey.decision.planHash, bundle.bundleId, action.sourceResolutionActionId].join("|");
  }

  function Field({ label, children, hint }) {
    return h("label", { className: "uaj-field" }, h("span", null, label), children, hint && h("small", null, hint));
  }

  function emptyMeasurement() {
    return { measurementType: "EXACT", exactValue: "", lowerBound: "", upperBound: "", unknownReason: "" };
  }

  function percentageValue(row) {
    if (row.measurementType === "UNKNOWN") {
      return { type: "UNKNOWN", ...(row.unknownReason.trim() ? { reason: row.unknownReason.trim() } : {}) };
    }
    if (row.measurementType === "RANGE") {
      if (row.lowerBound === "" || row.upperBound === "") throw new TypeError("Enter both percentage range endpoints");
      if (Number(row.lowerBound) < 0 || Number(row.upperBound) > 100 || Number(row.lowerBound) > Number(row.upperBound)) {
        throw new TypeError("Ownership range must be between 0 and 100, with the lower endpoint not greater than the upper endpoint");
      }
      return { type: "RANGE", lowerBound: Number(row.lowerBound), upperBound: Number(row.upperBound), lowerInclusive: false, upperInclusive: true };
    }
    if (row.exactValue === "" || Number(row.exactValue) < 0 || Number(row.exactValue) > 100) {
      throw new TypeError("Ownership percentage must be between 0 and 100");
    }
    return { type: "EXACT", value: Number(row.exactValue) };
  }

  function PercentageInput({ value, update }) {
    return h("fieldset", { className: "uaj-measurement" },
      h("legend", null, "Ownership percentage"),
      h(Field, { label: "How precise is the information?" },
        h("select", { value: value.measurementType, onChange: (event) => update({ ...value, measurementType: event.target.value }) },
          h("option", { value: "EXACT" }, "Exact percentage"),
          h("option", { value: "RANGE" }, "Percentage range"),
          h("option", { value: "UNKNOWN" }, "Not yet known"))),
      value.measurementType === "EXACT" && h(Field, { label: "Exact ownership percentage" },
        h("input", { type: "number", min: 0, max: 100, step: "any", required: true, value: value.exactValue, onChange: (event) => update({ ...value, exactValue: event.target.value }) })),
      value.measurementType === "RANGE" && h("div", { className: "uaj-range" },
        h(Field, { label: "More than %" }, h("input", { type: "number", min: 0, max: 100, required: true, value: value.lowerBound, onChange: (event) => update({ ...value, lowerBound: event.target.value }) })),
        h(Field, { label: "Up to and including %" }, h("input", { type: "number", min: 0, max: 100, required: true, value: value.upperBound, onChange: (event) => update({ ...value, upperBound: event.target.value }) }))),
      value.measurementType === "UNKNOWN" && h(Field, { label: "What do you know?" },
        h("textarea", { rows: 2, value: value.unknownReason, onChange: (event) => update({ ...value, unknownReason: event.target.value }) })));
  }

  function emptyOwner() {
    return { name: "", entityType: "NATURAL_PERSON", registrationNumber: "", jurisdiction: "", ...emptyMeasurement() };
  }

  function ownerStatement(row, index, bundle, informationAsAtDate) {
    const key = `${bundle.bundleId}:owner:${index + 1}`;
    return {
      localPartyKey: key,
      owner: {
        localPartyKey: key,
        name: row.name.trim(),
        entityType: row.entityType,
        ...(row.jurisdiction.trim() ? { jurisdiction: row.jurisdiction.trim().toUpperCase() } : {}),
        externalIdentifiers: row.registrationNumber.trim()
          ? [{ namespace: "CUSTOMER_PROVIDED_REGISTRATION", value: row.registrationNumber.trim() }]
          : [],
      },
      targetEntityId: bundle.canonicalSubject.entityId || bundle.canonicalSubject.entityIds[0],
      concept: "SHARE_OWNERSHIP",
      direction: "OWNER_TO_TARGET",
      relationshipType: "ECONOMIC_OWNERSHIP",
      measurement: percentageValue(row),
      assertionState: "CURRENT",
      asAtDate: informationAsAtDate,
    };
  }

  function ActionForm({ journey, bundle, action, actorContext, content, onSubmit, onCancel }) {
    const [values, setValues] = React.useState({});
    const [owners, setOwners] = React.useState([emptyOwner()]);
    const [correctionMeasurement, setCorrectionMeasurement] = React.useState(emptyMeasurement());
    const [selectedRelationshipId, setSelectedRelationshipId] = React.useState(null);
    const [error, setError] = React.useState("");
    const errorRef = React.useRef(null);
    const knownRelationships = bundle.knownInformation?.relationships || [];
    const missingAttributes = unique((bundle.missingInformation || [])
      .map(({ requiredFact }) => requiredFact?.attribute)
      .filter((attribute) => ["date_of_birth", "country_of_nationality", "country_of_residence"].includes(attribute)));
    const informationAsAtDate = values.informationAsAtDate || new Date().toISOString();

    React.useEffect(() => {
      if (error && errorRef.current) errorRef.current.focus();
    }, [error]);

    function updateOwner(index, field, value) {
      setOwners((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    }

    function payload() {
      if (action.actionType === ACTION.CONFIRM) {
        return {
          confirmation: "CONFIRMED",
          establishedRelationshipIds: knownRelationships.map(({ relationshipId }) => relationshipId),
          establishedClaimIds: unique(knownRelationships.flatMap(({ supportingClaimIds = [] }) => supportingClaimIds)),
        };
      }
      if (action.actionType === ACTION.CORRECT) {
        const relationship = knownRelationships.find(({ relationshipId }) => relationshipId === selectedRelationshipId);
        if (!relationship) throw new TypeError("No established relationship is available for correction");
        const sourceClaimIds = unique(relationship.supportingClaimIds);
        if (sourceClaimIds.length === 0) throw new TypeError("The established relationship has no source claim to correct");
        return {
          confirmation: "CORRECTION_REQUIRED",
          affectedEntityIds: unique([relationship.subjectEntityId, relationship.objectEntityId]),
          affectedRelationshipIds: [relationship.relationshipId],
          changedFact: {
            type: "RELATIONSHIP",
            subject: { entityId: relationship.subjectEntityId, externalIdentifiers: [] },
            object: { entityId: relationship.objectEntityId, externalIdentifiers: [] },
            relationship: relationship.relationshipType,
            measurement: percentageValue(correctionMeasurement),
            qualifiers: { currentState: "CURRENT" },
            evidenceReferences: [],
          },
          effectiveDate: values.effectiveDate,
          sourceClaimIds,
          requestEvidence: values.requestEvidence === true,
        };
      }
      if (action.actionType === ACTION.OWNERSHIP) {
        if (owners.some(({ name }) => !name.trim())) throw new TypeError("Enter a name for every owner");
        return { relationships: owners.map((row, index) => ownerStatement(row, index, bundle, informationAsAtDate)) };
      }
      if (action.actionType === ACTION.ATTRIBUTES) {
        const attributes = Object.fromEntries(missingAttributes.map((attribute) => [attribute, values[attribute]]).filter(([, value]) => value));
        if (Object.keys(attributes).length === 0) throw new TypeError("Provide at least one requested person detail");
        return { entityId: bundle.canonicalSubject.entityId || bundle.canonicalSubject.entityIds[0], attributes };
      }
      if (action.actionType === ACTION.EVIDENCE) {
        return {
          requestCorrelationId: `applicant:${bundle.bundleId}`,
          evidenceCategories: [...bundle.evidenceHandoff.semanticEvidenceCategories],
          requestedConcepts: [...bundle.evidenceHandoff.requestedConcepts],
          informationAsAtDate,
        };
      }
      return {
        delegateReference: values.delegateReference,
        delegateCapacity: values.delegateCapacity,
        requestedWorkScope: values.requestedWorkScope,
        informationAsAtExpectation: informationAsAtDate,
        correlationId: `delegate:${bundle.bundleId}`,
      };
    }

    function submit(event) {
      event.preventDefault();
      try {
        const now = new Date().toISOString();
        const customerAction = buildCustomerActionV2({
          journey, bundle, action, actorContext, content, payload: payload(),
          submittedAt: now, informationAsAtDate, delegatedFrom: actorContext.delegatedFrom || null,
        });
        setError("");
        onSubmit(customerAction);
      } catch (cause) {
        setError(cause.message);
      }
    }

    let controls;
    if (action.actionType === ACTION.CONFIRM) {
      controls = h(React.Fragment, null,
        h("p", { className: "uaj-principle" }, "Your confirmation records what you know. It does not replace any independent evidence the review requires."),
        h("p", null, `Confirming as ${human(actorContext.actorCapacity)}.`),
        h("ul", { className: "uaj-known-list" }, knownRelationships.map((relationship) =>
          h("li", { key: relationship.relationshipId }, `${human(relationship.relationshipType)} - ${human(relationship.measurement?.type)}`))));
    } else if (action.actionType === ACTION.CORRECT) {
      controls = h(React.Fragment, null,
        h("p", null, "Choose the established relationship that changed. The prior source assertion remains in the audit history."),
        h(Field, { label: "Relationship that changed" },
          h("select", { required: true, value: selectedRelationshipId || "", onChange: (event) => setSelectedRelationshipId(event.target.value) },
            h("option", { value: "" }, "Select a relationship"),
            knownRelationships.map((relationship) => h("option", { key: relationship.relationshipId, value: relationship.relationshipId },
              `${human(relationship.relationshipType)} - ${human(relationship.measurement?.type)}`)))),
        h(PercentageInput, { value: correctionMeasurement, update: setCorrectionMeasurement }),
        h(Field, { label: "When did this change?" },
          h("input", { type: "date", required: true, value: values.effectiveDate?.slice(0, 10) || "", onChange: (event) => setValues({ ...values, effectiveDate: `${event.target.value}T00:00:00.000Z` }) })),
        h("label", { className: "uaj-check" },
          h("input", { type: "checkbox", checked: values.requestEvidence === true, onChange: (event) => setValues({ ...values, requestEvidence: event.target.checked }) }),
          "I can provide supporting evidence separately"));
    } else if (action.actionType === ACTION.OWNERSHIP) {
      controls = h(React.Fragment, null,
        h("p", null, "Add each current direct owner. Exact values, bounded ranges and genuinely unknown values remain distinct."),
        owners.map((owner, index) => h("fieldset", { className: "uaj-owner", key: `owner-${index}` },
          h("legend", null, `Owner ${index + 1}`),
          h(Field, { label: "Legal name" }, h("input", { required: true, value: owner.name, onChange: (event) => updateOwner(index, "name", event.target.value) })),
          h(Field, { label: "Owner type" }, h("select", { value: owner.entityType, onChange: (event) => updateOwner(index, "entityType", event.target.value) },
            h("option", { value: "NATURAL_PERSON" }, "Person"),
            h("option", { value: "LEGAL_ENTITY" }, "Legal entity"))),
          owner.entityType === "LEGAL_ENTITY" && h("div", { className: "uaj-range" },
            h(Field, { label: "Registration number", hint: "If known" }, h("input", { value: owner.registrationNumber, onChange: (event) => updateOwner(index, "registrationNumber", event.target.value) })),
            h(Field, { label: "Jurisdiction", hint: "Two-letter code, if known" }, h("input", { maxLength: 2, value: owner.jurisdiction, onChange: (event) => updateOwner(index, "jurisdiction", event.target.value) }))),
          h(PercentageInput, { value: owner, update: (next) => setOwners((current) => current.map((item, rowIndex) => rowIndex === index ? next : item)) }),
          owners.length > 1 && h("button", { type: "button", className: "uaj-link", onClick: () => setOwners((current) => current.filter((_item, rowIndex) => rowIndex !== index)) }, "Remove owner"))),
        h("button", { type: "button", className: "uaj-secondary", onClick: () => setOwners((current) => [...current, emptyOwner()]) }, "Add another owner"));
    } else if (action.actionType === ACTION.ATTRIBUTES) {
      controls = missingAttributes.length
        ? h(React.Fragment, null, missingAttributes.map((attribute) =>
          h(Field, { label: human(attribute), key: attribute },
            h("input", { required: true, type: attribute === "date_of_birth" ? "date" : "text", value: values[attribute] || "", onChange: (event) => setValues({ ...values, [attribute]: event.target.value }) }))))
        : h("p", { className: "uaj-alert" }, "No approved requested attributes are present in this bundle.");
    } else if (action.actionType === ACTION.EVIDENCE) {
      controls = h("div", { className: "uaj-handoff" },
        h("strong", null, "Secure evidence handoff"),
        h("p", null, "Continue to the host's separate Evidence service. No file is selected, read or uploaded in this journey."),
        h("p", null, `Requested: ${unique(bundle.evidenceHandoff?.requestedConcepts).map(human).join(", ")}`));
    } else {
      controls = h(React.Fragment, null,
        h("p", null, "This creates a host-owned delegation request. It does not grant authority or complete the work."),
        h(Field, { label: "Who should help?" }, h("input", { required: true, value: values.delegateReference || "", onChange: (event) => setValues({ ...values, delegateReference: event.target.value }) })),
        h(Field, { label: "Their role" }, h("input", { required: true, value: values.delegateCapacity || "", onChange: (event) => setValues({ ...values, delegateCapacity: event.target.value }) })),
        h(Field, { label: "What should they provide?" }, h("textarea", { rows: 3, required: true, value: values.requestedWorkScope || "", onChange: (event) => setValues({ ...values, requestedWorkScope: event.target.value }) })));
    }

    return h("form", { className: "uaj-form", onSubmit: submit, "data-action-type": action.actionType },
      h(Field, { label: "Information correct as at" },
        h("input", { type: "date", required: true, value: values.informationAsAtDate?.slice(0, 10) || informationAsAtDate.slice(0, 10), onChange: (event) => setValues({ ...values, informationAsAtDate: `${event.target.value}T00:00:00.000Z` }) })),
      controls,
      error && h("p", { className: "uaj-alert", role: "alert", ref: errorRef, tabIndex: -1 }, error),
      h("div", { className: "uaj-form-actions" },
        h("button", { type: "button", className: "uaj-secondary", onClick: onCancel }, "Cancel"),
        h("button", { type: "submit", className: "uaj-primary" }, action.actionType === ACTION.EVIDENCE ? "Continue securely" : action.actionType === ACTION.DELEGATE ? "Create request" : "Submit and review")));
  }

  function ResultNotice({ result, onRefresh }) {
    if (!result) return null;
    if (result.externalEvidenceHandoff) {
           return h("div", { className: "uaj-result", role: "status" },
        h("strong", null, "EVIDENCE HANDOFF READY - EXECUTION NOT CONNECTED"),
        h("p", null, "The host can now continue to its secure Evidence service. Nothing was uploaded here."),
        h("code", null, result.externalEvidenceHandoff.handoffId));
    }
    if (result.delegationHandoff) {
      return h("div", { className: "uaj-result", role: "status" },
        h("strong", null, "Help request prepared"),
        h("p", null, "Host execution is not connected: no invitation or email was sent, no authority was granted, and the UBO task is not complete."));
    }
    if ((result.correctionTargets || []).length > 0) {
      return h("div", { className: "uaj-result", role: "status" },
        h("strong", null, "Change submitted - pending verification/review"),
        h("p", null, "The previous established information remains recorded. The proposed change is not operative unless a later projection says so."),
        onRefresh && h("button", { type: "button", className: "uaj-primary", onClick: onRefresh }, "Review pending decisions"));
    }
    return h("div", { className: "uaj-result", role: "status" },
      h("strong", null, result.customerConfirmation?.status === "CONFIRMED" ? "Information confirmed" : "Information received"),
      result.customerConfirmation && h("p", null,
        `Independent evidence: ${human(result.customerConfirmation.independentEvidenceRequirementState)}. Confirmation does not replace independent evidence.`),
      h("p", null, "The submission is recorded. Refresh the decision to see the next deterministic step."),
      onRefresh && h("button", { type: "button", className: "uaj-primary", onClick: onRefresh }, "Refresh decision"));
  }

  function applicantPresentationState(journey) {
    if (journey.customerWorkBundles.length > 0) return journey.customerWorkState;
    if (journey.customerWorkState === "SYSTEM_RESOLUTION") return journey.customerWorkState;
    if (journey.finishLine.specialistReviewPending > 0) return "SPECIALIST_REVIEW_REQUIRED";
    if (journey.finishLine.internalReviewPending > 0) return "INTERNAL_REVIEW_REQUIRED";
    if (journey.customerInputComplete && journey.customerWorkState === "BLOCKED") return "CUSTOMER_INPUT_COMPLETE";
    return journey.customerWorkState;
  }

  function OwnershipSummary({ journey, content }) {
    const summary = journey.establishedOwnershipAndControl;
    const relationships = summary.materialRelationshipReferences || [];
    const economic = relationships.filter(({ dimension }) => dimension === "ECONOMIC");
    const other = relationships.filter(({ dimension }) => dimension !== "ECONOMIC");
    return h("section", { className: "uaj-card uaj-ownership-summary", "aria-labelledby": "uaj-ownership-title" },
      h("div", { className: "uaj-card-heading" },
        h("div", null, h("p", { className: "uaj-kicker" }, "What we currently know"), h("h2", { id: "uaj-ownership-title" }, "Ownership and control summary")),
        h("span", { className: "uaj-count" }, `${summary.materialEconomicRelationshipCount} economic link${summary.materialEconomicRelationshipCount === 1 ? "" : "s"}`)),
      h("p", null, "A concise account of the established current relationships used by this review. This is not an analyst graph."),
      relationships.length === 0
        ? h("p", { className: "uaj-muted" }, "No current material relationships are established yet.")
        : h("div", { className: "uaj-relationship-groups" },
          economic.length > 0 && h("div", null, h("h3", null, "Economic ownership"),
            h("ul", null, economic.slice(0, 8).map((relationship) =>
              h("li", { key: relationship.relationshipId },
                h("span", null, entityLabel(relationship.subjectEntityId, content)),
                h("span", { "aria-hidden": "true" }, " -> "),
                h("span", null, entityLabel(relationship.objectEntityId, content)))))),
          other.length > 0 && h("details", null,
            h("summary", null, `${other.length} separate voting or control relationship${other.length === 1 ? "" : "s"}`),
            h("ul", null, other.map((relationship) =>
              h("li", { key: relationship.relationshipId }, `${human(relationship.relationshipType)}: ${entityLabel(relationship.subjectEntityId, content)} to ${entityLabel(relationship.objectEntityId, content)}`))))));
  }

  function BundleCard({ journey, bundle, actorContext, content, selected, setSelected, result, onSubmitAction, onCancelDraft, onRequestRefresh }) {
    const subjectId = bundle.canonicalSubject.entityId || bundle.canonicalSubject.entityIds[0];
    const configuredActions = bundle.permittedSemanticActions.map((action) => ({
      action,
      copy: approvedContent(action, bundle, content),
      executable: actionExecutable(action, bundle, content),
    }));
    const active = configuredActions.find(({ action }) => action.actionType === selected?.actionType);
    const wordingMissing = configuredActions.some(({ action, copy }) =>
      ![ACTION.EVIDENCE, ACTION.DELEGATE].includes(action.actionType) && !copy.ready);
    return h("article", { className: "uaj-card uaj-task", "data-bundle-id": bundle.bundleId },
      h("div", { className: "uaj-card-heading" },
        h("div", null,
          h("p", { className: "uaj-kicker" }, `Customer task - ${human(bundle.state)}`),
          h("h2", null, entityLabel(subjectId, content))),
        h("span", { className: `uaj-status uaj-status--${bundle.state.toLowerCase().replaceAll("_", "-")}` }, bundle.state === "OPEN" ? "Your input" : human(bundle.state))),
      h("p", null, human(bundle.expectedResult)),
      h("div", { className: "uaj-info-grid" },
        h("div", null, h("strong", null, "Known"), h("span", null, `${bundle.knownInformation?.entities?.length || 0} parties, ${bundle.knownInformation?.relationships?.length || 0} relationships`)),
        h("div", null, h("strong", null, "Needed"), h("span", null, unique(bundle.missingInformation?.map(({ concept }) => human(concept))).join(", ") || "No customer information")),
        h("div", null, h("strong", null, "Then"), h("span", null, human(bundle.reEvaluationTrigger)))),
      wordingMissing && h("div", { className: "uaj-alert", role: "status" },
        h("strong", null, "Customer wording is not configured"),
        h("p", null, "This form stays unavailable until the host resolves every approved content reference.")),
      (bundle.blockingSignoffs || []).length > 0 && h("div", { className: "uaj-alert", role: "status" },
        h("strong", null, "This task is not available yet"),
        h("p", null, "Required governance approval remains open. The diagnostic view retains the detailed dependencies.")),
      !active && h("div", { className: "uaj-action-list" }, configuredActions.map(({ action, copy, executable }) =>
        h("button", {
          type: "button",
          className: "uaj-action",
          key: `${action.sourceResolutionActionId}:${action.actionType}`,
          disabled: !executable,
          onClick: () => setSelected({ bundleId: bundle.bundleId, actionType: action.actionType, pin: draftKey(journey, bundle, action) }),
        },
        h("strong", null, copy.title || actionLabel(action.actionType)),
        h("span", null, executable ? actionLabel(action.actionType) : action.blockedReason === "SIGNOFF_REQUIRED" ? "Awaiting approval" : "Not currently available")))),
      active && h("div", { className: "uaj-action-panel" },
        h("div", null, h("p", { className: "uaj-kicker" }, "Current task"), h("h3", null, active.copy.title || actionLabel(active.action.actionType)), active.copy.body && h("p", null, active.copy.body)),
        h(ActionForm, {
          journey,
          bundle,
          action: active.action,
          actorContext,
          content,
          onSubmit: onSubmitAction,
          onCancel: () => { setSelected(null); if (onCancelDraft) onCancelDraft({ bundleId: bundle.bundleId, actionId: active.action.sourceResolutionActionId }); },
        })),
      h(ResultNotice, { result, onRefresh: onRequestRefresh }));
  }

  function NonCustomerState({ journey }) {
    const presentationState = applicantPresentationState(journey);
    const copy = ({
      SYSTEM_RESOLUTION: ["We're checking available sources", "No action is needed from you right now."],
      INTERNAL_REVIEW_REQUIRED: ["Your information is with our review team", "There is no further customer task in the current plan."],
      SPECIALIST_REVIEW_REQUIRED: ["A specialist review is required", "We will continue the review and contact you if another task becomes available."],
      BLOCKED: ["This review cannot progress yet", "The current deterministic plan does not expose an executable customer action."],
      COMPLETE: ["UBO review complete", "The deterministic UBO review has reached its final state. This does not itself approve onboarding."],
      CUSTOMER_INPUT_COMPLETE: ["Your current tasks are complete", "System or review work may still remain before the UBO review is final."],
    })[presentationState] || ["No customer task is available", "The current decision does not require customer input."];
    return h("section", { className: "uaj-card uaj-empty" },
      h("p", { className: "uaj-kicker" }, human(presentationState)),
      h("h2", null, copy[0]),
      h("p", null, copy[1]));
  }

  function UboApplicantJourneyV2({
    journey,
    actorContext,
    actionResult,
    submissionState,
    onSubmitAction,
    onCancelDraft,
    onRequestRefresh,
    content,
    className = "",
  }) {
    let verified;
    try {
      verified = assertApplicantJourneyV2(journey);
    } catch (error) {
      return h("section", { className: `ubo-applicant-journey-v2 uaj-contract-error ${className}`, role: "alert" },
        h("h2", null, "This journey cannot be shown"),
        h("p", null, error.message));
    }
    const [selected, setSelected] = React.useState(null);
    const [staleDraft, setStaleDraft] = React.useState(false);
    const [submitError, setSubmitError] = React.useState("");
    const currentDecisionPin = `${verified.decision.snapshotHash}|${verified.decision.planHash}`;

    React.useEffect(() => {
      if (selected && !selected.pin.startsWith(currentDecisionPin)) {
        setSelected(null);
        setStaleDraft(true);
      }
    }, [currentDecisionPin]);

    const activeBundles = verified.customerWorkBundles.filter((bundle) => bundle.state === "OPEN"
      || bundle.state === "POLICY_CONTENT_REQUIRED" || bundle.state === "SIGNOFF_REQUIRED");
    const progressTotal = verified.finishLine.currentCustomerBundles
      + verified.finishLine.systemActionsRemaining
      + verified.finishLine.internalReviewPending
      + verified.finishLine.specialistReviewPending;
    const presentationState = applicantPresentationState(verified);
    const statusLabel = presentationState === "CUSTOMER_INPUT_REQUIRED" ? "Your input is needed" : human(presentationState);

    async function submit(customerAction) {
      try {
        setSubmitError("");
        await onSubmitAction(customerAction);
        setSelected(null);
      } catch (error) {
        setSubmitError(error.message || "The action could not be applied.");
      }
    }

    return h("main", {
      className: `ubo-applicant-journey-v2 ${className}`,
      "data-contract-version": APPLICANT_JOURNEY_UI_VERSION,
    },
    h("header", { className: "uaj-hero" },
      h("div", null,
        h("p", { className: "uaj-kicker" }, "Ownership review"),
        h("h1", null, "Help us complete your UBO review"),
        h("p", null, "Review what is established, complete only the current approved task, and we will reassess the case."))),
    h("section", { className: "uaj-progress", "aria-label": "Review status" },
      h("div", null, h("span", { className: "uaj-pulse", "aria-hidden": "true" }), h("strong", null, statusLabel)),
      h("div", { className: "uaj-progress-metrics" },
        h("span", null, `${verified.finishLine.currentCustomerBundles} customer task${verified.finishLine.currentCustomerBundles === 1 ? "" : "s"}`),
        h("span", null, `${verified.finishLine.systemActionsRemaining} system check${verified.finishLine.systemActionsRemaining === 1 ? "" : "s"}`),
        h("span", null, `${verified.finishLine.internalReviewPending + verified.finishLine.specialistReviewPending} review item${verified.finishLine.internalReviewPending + verified.finishLine.specialistReviewPending === 1 ? "" : "s"}`))),
    verified.finishLine.internalReviewPending > 0 && h("section", { className: "uaj-review-notice", role: "status" },
      h("strong", null, "Internal review in progress"),
      h("span", null, "Your information is with our review team. Complete only any separate customer task shown below.")),
    verified.finishLine.specialistReviewPending > 0 && h("section", { className: "uaj-review-notice", role: "status" },
      h("strong", null, "Specialist review in progress"),
      h("span", null, "This ownership structure needs a specialist check. No standard form is created by that review.")),
    h(OwnershipSummary, { journey: verified, content }),
    staleDraft && h("section", { className: "uaj-alert uaj-stale", role: "alert" },
      h("strong", null, "The review changed"),
      h("p", null, "Your previous draft was cleared because its snapshot or plan is no longer current."),
      h("button", { type: "button", className: "uaj-link", onClick: () => setStaleDraft(false) }, "Dismiss")),
    submitError && h("section", { className: "uaj-alert", role: "alert" }, submitError),
    submissionState?.status && h("section", { className: "uaj-result", role: "status" },
      submissionState.status === "SUBMITTING" ? "Submitting your response..." : submissionState.error || human(submissionState.status)),
    activeBundles.length > 0
      ? h("section", { className: "uaj-tasks", "aria-labelledby": "uaj-tasks-title" },
        h("div", { className: "uaj-section-heading" },
          h("div", null, h("p", { className: "uaj-kicker" }, "Next"), h("h2", { id: "uaj-tasks-title" }, "Your current task")),
          progressTotal > 0 && h("span", { className: "uaj-muted" }, "Tasks appear only when the deterministic plan permits them")),
        activeBundles.map((bundle) => h(BundleCard, {
          key: bundle.bundleId,
          journey: verified,
          bundle,
          actorContext,
          content,
          selected: selected?.bundleId === bundle.bundleId ? selected : null,
          setSelected,
          result: actionResult?.sourceWork?.bundleId === bundle.bundleId || actionResult?.externalEvidenceHandoff?.bundleId === bundle.bundleId ? actionResult : null,
          onSubmitAction: submit,
          onCancelDraft,
          onRequestRefresh,
        })))
      : h(NonCustomerState, { journey: verified }),
    h("footer", { className: "uaj-footer" },
      h("span", null, "Customer input is assessed by the deterministic UBO decision service."),
      h("span", null, "This screen does not approve onboarding.")));
  }

  return Object.freeze({
    ACTION,
    APPLICANT_JOURNEY_UI_VERSION,
    CUSTOMER_ACTION_VERSION,
    JOURNEY_PROJECTION_VERSION,
    UboApplicantJourneyV2,
    actionExecutable,
    assertApplicantJourneyV2,
    buildCustomerActionV2,
    draftKey,
  });
}));
