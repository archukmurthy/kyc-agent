"use strict";

const fs = require("node:fs");
const path = require("node:path");
const graphFixtures = require("./projections.json");

function graph(id, state = "current") {
  const fixture = graphFixtures.fixtures.find((item) => item.id === id);
  return structuredClone((fixture.states.find((item) => item.id === state) || fixture.states[0]).projection);
}

function resolvedGraph(id, state = "current") {
  const projection = graph(id, state);
  projection.decision.orchestrationState = "TERMINAL";
  projection.decision.terminalOutcome = "RESOLVED";
  projection.nodes.forEach((node) => { node.semantics = node.semantics.filter((semantic) => semantic !== "UNRESOLVED_ENTITY"); });
  projection.relationships.forEach((relationship) => { relationship.indicators = (relationship.indicators || []).filter((indicator) => indicator !== "UNRESOLVED"); });
  projection.unresolved = [];
  projection.summary.unresolvedBranches = 0;
  return projection;
}

function template(id, status = "SUPPLIED") {
  return { actionTemplateId: id, contentStatus: status, sourceReference: "CONTROL_ROOM_APPROVED_PRODUCT_SEMANTICS" };
}

function action(id, type, strategy, entityId, concept, attribute, evidenceTypes = [], templateStatus = "SUPPLIED", relationshipId = null) {
  return {
    actionId: `resolution-action:${id}`,
    actor: "CUSTOMER",
    actionType: type,
    strategy,
    resolutionOptionIds: [`option:${id}`],
    informationNeedIds: [`need:${id}`],
    requirementIds: [`requirement:${id}`],
    subject: { entityId, relationshipId, concept, attribute: attribute || null },
    evidenceTypes,
    actionTemplate: template(`template:${id}`, templateStatus),
    rationaleCodes: ["CUSTOMER_INPUT_REQUIRED_BY_POLICY"],
    graphLinks: { entityIds: entityId ? [entityId] : [], relationshipIds: relationshipId ? [relationshipId] : [], informationNeedIds: [`need:${id}`] },
  };
}

function journeyWork(actionValue, profile, known = [], missing = []) {
  const intentType = actionValue.actionType === "CONFIRM_ESTABLISHED_INFORMATION" ? "REQUEST_ATTESTATION"
    : actionValue.actionType === "PROVIDE_TARGETED_EVIDENCE" ? "REQUEST_CUSTOMER_EVIDENCE" : "REQUEST_CUSTOMER_INFORMATION";
  return {
    workItemId: actionValue.actionId.replace("resolution-action", "customer-work-item"),
    workItemType: actionValue.actionType === "CONFIRM_ESTABLISHED_INFORMATION" ? "CONFIRM_ESTABLISHED_INFORMATION" : "PROVIDE_MISSING_INFORMATION",
    actionType: intentType,
    state: "OPEN",
    subject: { entityId: actionValue.subject.entityId, relationshipId: actionValue.subject.relationshipId, concept: actionValue.subject.concept, attribute: actionValue.subject.attribute, entityProfile: profile },
    actionIntentIds: [actionValue.actionId.replace("resolution-action", "action-intent")],
    informationNeedIds: actionValue.informationNeedIds,
    requirementIds: actionValue.requirementIds,
    sought: { factConcepts: [actionValue.subject.concept], evidenceTypes: actionValue.evidenceTypes },
    fields: { known, missing },
    resolutionOptions: { ordering: "UNRANKED", items: [{ optionId: actionValue.resolutionOptionIds[0], strategy: actionValue.strategy, applicabilityState: "APPLICABLE", acceptableEvidenceTypes: actionValue.evidenceTypes, constraints: [], reasonCode: "POLICY_PERMITS_STRATEGY" }] },
    reason: { reasonCodes: actionValue.rationaleCodes, requirementIds: actionValue.requirementIds, informationNeedIds: actionValue.informationNeedIds, actionTemplate: { ...actionValue.actionTemplate, wordingAvailable: actionValue.actionTemplate.contentStatus === "SUPPLIED" }, wordingStatus: actionValue.actionTemplate.contentStatus === "SUPPLIED" ? "POLICY_TEMPLATE_AVAILABLE" : "POLICY_WORDING_UNRESOLVED" },
    graphLinks: actionValue.graphLinks,
  };
}

function baseJourney(id, state, customerWorkItems = [], options = {}) {
  const handoff = options.handoff || [];
  return {
    contractVersion: "ubo-journey-projection-v1",
    decision: { snapshotId: `snapshot:${id}`, snapshotHash: `sha256:${id}`, checkpoint: { type: "CASE_OPEN" }, policyIdentity: { policyId: "uk-corporate", policyVersion: "1.4-rc" }, orchestrationState: state === "CASE_COMPLETE" ? "TERMINAL" : "IN_PROGRESS", terminalOutcome: state === "CASE_COMPLETE" ? "RESOLVED" : state === "SPECIALIST_REVIEW_REQUIRED" ? "SPECIALIST_REVIEW_REQUIRED" : null, history: { revision: 1 } },
    journeyState: state,
    customerInputComplete: customerWorkItems.length === 0,
    customerWorkItems,
    systemWorkItems: options.systemWorkItems || [],
    internalReview: options.internalReview || { actionItems: [], reviewRequirements: [], policyContentGaps: [], fallback: { candidate: null, assessment: null, application: null } },
    operationalBlockers: options.operationalBlockers || [],
    qualifyingPersonHandoff: handoff,
    summary: { customerWorkItems: customerWorkItems.length, systemWorkItems: (options.systemWorkItems || []).length, internalActionItems: options.internalReview?.actionItems?.length || 0, reviewRequirements: options.internalReview?.reviewRequirements?.length || 0, policyContentGaps: options.internalReview?.policyContentGaps?.length || 0, operationalBlockers: (options.operationalBlockers || []).length, qualifyingPeople: handoff.length, unresolvedIdentityFields: handoff.reduce((sum, item) => sum + (item.missingIdentityFields || []).length, 0) },
  };
}

function plan(id, state, actions = [], bundles = [], rationale = []) {
  return {
    contractVersion: "ubo-resolution-plan-v1",
    plannerVersion: "ubo-low-friction-planner-v1",
    snapshotHash: `sha256:${id}`,
    snapshotId: `snapshot:${id}`,
    state,
    recommendedWave: { actor: state === "CUSTOMER_RESOLUTION" ? "CUSTOMER" : state === "SYSTEM_RESOLUTION" ? "SYSTEM" : state === "INTERNAL_REVIEW" ? "INTERNAL_REVIEW" : state, actions, customerBundles: bundles },
    deferredAlternatives: [],
    rationale: { codes: rationale, terminalOutcome: state === "COMPLETE" ? "RESOLVED" : null, replanAfterWave: ["CUSTOMER_RESOLUTION", "SYSTEM_RESOLUTION"].includes(state) },
    summary: { openInformationNeeds: bundles.reduce((sum, bundle) => sum + bundle.informationNeedIds.length, 0), recommendedActions: actions.length, customerBundles: bundles.length, deferredAlternatives: 0, priorResolutionAttempts: 0 },
  };
}

function bundle(id, entityId, family, actions, knownFacts = [], missingFacts = [], evidenceRequirements = [], relationshipIds = []) {
  const needs = [...new Set(actions.flatMap((item) => item.informationNeedIds))];
  return {
    bundleId: `customer-resolution-bundle:${id}`,
    subject: { entityId, family },
    informationNeedIds: needs,
    requirementIds: [...new Set(actions.flatMap((item) => item.requirementIds))],
    recommendedCustomerActions: actions,
    knownFacts,
    missingFacts,
    evidenceRequirements,
    expectedNeedsCovered: needs,
    policyPermittedAlternatives: [],
    rationaleCodes: ["CUSTOMER_INPUT_REQUIRED_BY_POLICY", ...(needs.length > 1 ? ["COALESCES_MULTIPLE_NEEDS"] : [])],
    graphLinks: { entityIds: entityId ? [entityId] : [], relationshipIds, informationNeedIds: needs },
  };
}

function customerState(id, profile, actions, bundleValue, options = {}) {
  const work = actions.map((item) => journeyWork(item, profile, bundleValue.knownFacts, bundleValue.missingFacts));
  return {
    journey: baseJourney(id, "CUSTOMER_INPUT_REQUIRED", work, { handoff: options.handoff || [] }),
    plan: plan(id, "CUSTOMER_RESOLUTION", actions, [bundleValue], ["MINIMAL_CUSTOMER_RESOLUTION_SET"]),
    ...(options.graph ? { graph: options.graph } : {}),
  };
}

function fixture(id, label, description, stateValue) {
  return { id, label, description, states: [{ id: "current", label: "Current", ...stateValue }] };
}

function buildJourneyFixtures() {
  const aliceKnown = [{ field: "full_legal_name", value: "Alice Morgan" }, { field: "ownership_or_control_basis", value: ["beneficial_owner"] }];
  const aliceHandoff = [{ personEntityId: "alice", roles: ["beneficial_owner"], bases: [], knownIdentityFields: aliceKnown, missingIdentityFields: [], requirementId: "UBO-R07" }];

  const confirm = action("cui02-confirm", "CONFIRM_ESTABLISHED_INFORMATION", "CUSTOMER_ATTESTATION", "customer", "CURRENT_OWNERSHIP_AND_CONTROL", null);
  const foreign = action("cui03-foreign", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "foreign-holdco", "CURRENT_OWNERSHIP_AND_CONTROL", null);
  const dob = action("cui04-dob", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "alice", "IDENTITY_ATTRIBUTE", "date_of_birth");
  const residence = action("cui04-residence", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "alice", "IDENTITY_ATTRIBUTE", "country_of_residence");
  const voting = action("cui05-voting", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "customer", "VOTING_RIGHTS", null);
  const appointment = action("cui06-appointment", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "customer", "APPOINTMENT_CONTROL", null);
  const info = action("cui08-info", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "foreign-holdco", "CURRENT_OWNERSHIP_AND_CONTROL", null);
  const infoEvidence = action("cui08-evidence", "PROVIDE_TARGETED_EVIDENCE", "CUSTOMER_DOCUMENT", "foreign-holdco", "RELATIONSHIP_EVIDENCE", null, ["register_of_members"]);
  const evidenceOnly = action("cui09-evidence", "PROVIDE_TARGETED_EVIDENCE", "CUSTOMER_DOCUMENT", "customer", "RELATIONSHIP_EVIDENCE", null, ["shareholders_agreement"]);
  const senior = action("cui14-senior", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "candidate-senior", "SENIOR_MANAGEMENT_CANDIDATE", null);
  const llp = action("cui15-llp", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "customer", "CURRENT_OWNERSHIP_AND_CONTROL", null);
  const unavailable = action("cui16-wording", "PROVIDE_MISSING_INFORMATION", "CUSTOMER_QUESTION", "customer", "SIGNIFICANT_INFLUENCE_OR_CONTROL", null, [], "REQUIRES_POLICY_CONTENT");

  const resolvedJourney = baseJourney("cui01", "CASE_COMPLETE", [], { handoff: aliceHandoff });
  const resolvedPlan = plan("cui01", "COMPLETE", [], [], ["ALREADY_RESOLVED"]);
  const systemItem = { workItemId: "system-work-item:cui10", actionType: "DISCOVER_INFORMATION", state: "OPEN", actionIntentId: "action-intent:cui10", subject: { subjectEntityId: "customer", concept: "CURRENT_OWNERSHIP_AND_CONTROL" }, informationNeedIds: ["need:cui10"], requirementIds: ["UBO-R01"], reasonCode: "DISCOVERY_PERMITTED", graphLinks: { entityIds: ["customer"], relationshipIds: [], informationNeedIds: ["need:cui10"] } };
  const systemAction = { actionId: "resolution-action:cui10", actor: "SYSTEM", actionType: "DISCOVER_INFORMATION", strategy: "DISCOVERY", resolutionOptionIds: ["option:cui10"], informationNeedIds: ["need:cui10"], requirementIds: ["UBO-R01"], subject: { entityId: "customer", relationshipId: null, concept: "CURRENT_OWNERSHIP_AND_CONTROL", attribute: null }, evidenceTypes: [], actionTemplate: null, rationaleCodes: ["NO_CUSTOMER_FRICTION"], graphLinks: systemItem.graphLinks };
  const internalReview = { actionItems: [{ workItemId: "internal-work-item:cui12", actionType: "ANALYST_REVIEW", state: "OPEN", actionIntentId: "action-intent:cui12", subject: { subjectEntityId: "customer" }, informationNeedIds: [], requirementIds: ["UBO-R10"], reasonCode: "REVIEW_REQUIRED", graphLinks: { entityIds: ["customer"], relationshipIds: [], informationNeedIds: [] } }], reviewRequirements: [], policyContentGaps: [], fallback: { candidate: { isCandidate: true }, assessment: null, application: null } };
  const specialistReview = { ...internalReview, actionItems: [{ ...internalReview.actionItems[0], actionType: "SPECIALIST_REVIEW", reasonCode: "TRUST_STRUCTURE_REQUIRES_SPECIALIST_REVIEW" }] };

  const before17 = customerState("cui17-before", "COMPANY", [foreign], bundle("cui17-foreign", "foreign-holdco", "OWNERSHIP_AND_CONTROL", [foreign], [{ field: "registered_name", value: "Cayman Strategic Holdings" }], ["CURRENT_OWNERSHIP_AND_CONTROL"]), { graph: graph("UI12", "before") });
  const after17 = { journey: { ...baseJourney("cui17-after", "CASE_COMPLETE", [], { handoff: aliceHandoff }) }, plan: plan("cui17-after", "COMPLETE", [], [], ["ALREADY_RESOLVED"]), graph: resolvedGraph("UI12", "after") };

  return {
    fixtureSetVersion: "ubo-adaptive-customer-journey-fixtures-v1",
    generatedBy: "Public JourneyProjection + ResolutionPlan + optional OwnershipGraphProjection contracts",
    fixtures: [
      fixture("CUI01", "Resolved company", "Established ownership is shown without an unnecessary form.", { journey: resolvedJourney, plan: resolvedPlan, graph: resolvedGraph("UI01") }),
      fixture("CUI02", "Confirm established structure", "A lightweight confirmation replaces ownership re-entry.", customerState("cui02", "COMPANY", [confirm], bundle("cui02", "customer", "OWNERSHIP_AND_CONTROL", [confirm], [{ field: "ownership_structure", value: "Alice Morgan — 40% ownership" }], []), { graph: resolvedGraph("UI02") })),
      fixture("CUI03", "Unresolved foreign HoldCo", "Only the unresolved branch's current owners are requested.", customerState("cui03", "COMPANY", [foreign], bundle("cui03", "foreign-holdco", "OWNERSHIP_AND_CONTROL", [foreign], [{ field: "registered_name", value: "Cayman Strategic Holdings" }], ["CURRENT_OWNERSHIP_AND_CONTROL"]), { graph: graph("UI07") })),
      fixture("CUI04", "Missing identity attributes", "Alice's known name and role are retained; only DOB and residence are requested.", customerState("cui04", "COMPANY", [dob, residence], bundle("cui04", "alice", "QUALIFYING_PERSON_IDENTITY", [dob, residence], aliceKnown, ["date_of_birth", "country_of_residence"]), { graph: graph("UI01"), handoff: [{ ...aliceHandoff[0], missingIdentityFields: ["date_of_birth", "country_of_residence"] }] })),
      fixture("CUI05", "Unresolved voting rights", "Voting detail appears only because the current plan requests it.", customerState("cui05", "COMPANY", [voting], bundle("cui05", "customer", "OWNERSHIP_AND_CONTROL", [voting], [{ field: "registered_name", value: "Northstar Payments Ltd" }], ["VOTING_RIGHTS"]))),
      fixture("CUI06", "Appointment and control", "A company-specific board appointment interaction is presented.", customerState("cui06", "COMPANY", [appointment], bundle("cui06", "customer", "OWNERSHIP_AND_CONTROL", [appointment], [], ["APPOINTMENT_CONTROL"]))),
      fixture("CUI07", "Coalesced person details", "Two identity needs remain one customer task.", customerState("cui07", "COMPANY", [dob, residence], bundle("cui07", "alice", "QUALIFYING_PERSON_IDENTITY", [dob, residence], aliceKnown, ["date_of_birth", "country_of_residence"]))),
      fixture("CUI08", "Information and evidence", "Known structured information and targeted evidence remain one logical task.", customerState("cui08", "COMPANY", [info, infoEvidence], bundle("cui08", "foreign-holdco", "OWNERSHIP_AND_CONTROL", [info, infoEvidence], [{ field: "registered_name", value: "Cayman Strategic Holdings" }], ["CURRENT_OWNERSHIP_AND_CONTROL"], ["register_of_members"]))),
      fixture("CUI09", "Targeted evidence request", "A specific evidence handoff intent is emitted; no uploader is embedded.", customerState("cui09", "COMPANY", [evidenceOnly], bundle("cui09", "customer", "OWNERSHIP_AND_CONTROL", [evidenceOnly], [{ field: "registered_name", value: "Northstar Payments Ltd" }], [], ["shareholders_agreement"]))),
      fixture("CUI10", "System resolution wave", "Available information is checked without creating customer work.", { journey: baseJourney("cui10", "CUSTOMER_INPUT_COMPLETE", [], { systemWorkItems: [systemItem] }), plan: plan("cui10", "SYSTEM_RESOLUTION", [systemAction], [], ["NO_CUSTOMER_FRICTION"]) }),
      fixture("CUI11", "Operational blocker", "A provider outage remains a neutral system state, not a customer RFI.", { journey: baseJourney("cui11", "CUSTOMER_INPUT_COMPLETE", [], { operationalBlockers: [{ blockerId: "blocker:cui11", type: "CAPABILITY_UNAVAILABLE", affectedInformationNeedIds: ["need:cui11"] }] }), plan: plan("cui11", "BLOCKED", [], [], ["NO_CURRENTLY_EXECUTABLE_ACTION"]) }),
      fixture("CUI12", "Internal review", "Customer inputs close while the application continues through review.", { journey: baseJourney("cui12", "INTERNAL_REVIEW_REQUIRED", [], { internalReview }), plan: plan("cui12", "INTERNAL_REVIEW", [], [], ["CUSTOMER_WORK_COMPLETE"]) }),
      fixture("CUI13", "Specialist trust review", "Ordinary ownership forms stop for specialist review.", { journey: baseJourney("cui13", "SPECIALIST_REVIEW_REQUIRED", [], { internalReview: specialistReview }), plan: plan("cui13", "INTERNAL_REVIEW", [], [], ["SPECIALIST_REVIEW_REQUIRED"]) }),
      fixture("CUI14", "Senior management preparation", "Candidate details are requested without assigning fallback status.", customerState("cui14", "COMPANY", [senior], bundle("cui14", "candidate-senior", "SENIOR_MANAGEMENT_PREPARATION", [senior], [], ["SENIOR_MANAGEMENT_CANDIDATE"]))),
      fixture("CUI15", "LLP ownership journey", "LLP member and surplus-asset semantics replace company-share terminology.", customerState("cui15", "LLP", [llp], bundle("cui15", "customer", "OWNERSHIP_AND_CONTROL", [llp], [{ field: "entity_profile", value: "LLP" }], ["CURRENT_OWNERSHIP_AND_CONTROL"]))),
      fixture("CUI16", "Wording unavailable", "Unapproved customer wording is surfaced as configuration unavailable.", customerState("cui16", "COMPANY", [unavailable], bundle("cui16", "customer", "OWNERSHIP_AND_CONTROL", [unavailable], [], ["SIGNIFICANT_INFLUENCE_OR_CONTROL"]))),
      { id: "CUI17", label: "Before / after branch resolution", description: "The harness swaps complete public projections after a simulated host response.", states: [{ id: "before", label: "Before submission", ...before17 }, { id: "after", label: "After host re-resolution", ...after17 }] },
    ],
  };
}

if (require.main === module) {
  const output = path.join(__dirname, "journeys.json");
  fs.writeFileSync(output, `${JSON.stringify(buildJourneyFixtures(), null, 2)}\n`, "utf8");
  process.stdout.write(`Generated ${output}\n`);
}

module.exports = { buildJourneyFixtures };
