"use strict";

const BASELINE = require("../../policies/uk-corporate/1.5-rc/policy.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approvedSignoff(signoffId, scope = "TEST_RELEASE") {
  return {
    signoffId,
    status: "APPROVED",
    scope,
    productionBlocking: true,
    decisionReference: `test-decision:${signoffId}`,
    evidenceReference: `test-evidence:${signoffId}`,
    approver: { identity: "Test Control Room", capacity: "AUTHORIZED_APPROVER" },
    approvedAt: "2026-08-31T12:00:00.000Z",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
  };
}

function schema13Policy() {
  const policy = clone(BASELINE);
  policy.schemaVersion = "1.3";
  policy.policyPackId = "TEST-UBO-SCHEMA-1.3";
  policy.version = "TEST-1.3";
  policy.status = "PRODUCTION_APPROVED";
  policy.effectivePeriod = { from: "2026-09-01T00:00:00.000Z", to: "2027-09-01T00:00:00.000Z" };
  policy.sourceTraceability.approvedBy = {
    identity: "Test Control Room",
    capacity: "AUTHORIZED_APPROVER",
  };
  policy.legalBaseline = {
    statute: "TEST_STATUTORY_BASELINE",
    supervisorProfile: "TEST_SUPERVISOR_PROFILE",
    pscInterpretationProfile: "TEST_PSC_PROFILE",
    transitionalGuidanceNote: "Test-only schema fixture; not policy content.",
    deltaMemoRef: "test-delta-memo",
  };
  policy.signoffs = [
    approvedSignoff("TEST-SIGNOFF-MANDATORY"),
    approvedSignoff("TEST-SIGNOFF-OPTIONAL", "OPTIONAL_TEST_FEATURE"),
  ];
  policy.productionReadiness = {
    releaseStatus: "PRODUCTION_APPROVED",
    approvingAuthority: { identity: "Test Control Room", capacity: "AUTHORIZED_APPROVER" },
    mandatorySignoffIds: ["TEST-SIGNOFF-MANDATORY"],
    features: [{ featureId: "OPTIONAL_TEST_FEATURE", enabled: false, requiredSignoffIds: ["TEST-SIGNOFF-OPTIONAL"] }],
    requiredAlgorithms: [
      { algorithmId: "canonicalization", version: "ubo-canonical-json-v1" },
      { algorithmId: "percentageCalculation", version: "ubo-percentage-lookthrough-v1" },
    ],
  };
  policy.qualificationDoctrine = {
    personQualifiesWhen: "ANY_APPLICABLE_STATUTORY_ROUTE_SATISFIED",
    recordAllQualifyingBases: true,
    routes: [{ id: "TEST_ROUTE", legalBasis: "TEST_LEGAL_BASIS", method: "ubo-percentage-lookthrough-v1" }],
  };
  policy.statutoryThresholds = {
    economic: { value: 25, comparator: ">", classification: "MANDATORY", legalBasis: "TEST_ECONOMIC_BASIS" },
    voting: { value: 25, comparator: ">", classification: "MANDATORY", legalBasis: "TEST_VOTING_BASIS" },
  };
  policy.firmCollectionThreshold = {
    enabled: false,
    value: null,
    comparator: null,
    classification: "FREE_WITHIN_STRICTER_THAN_STATUTE",
    projectedRole: "firm_policy_qualifying_person",
    neverProjectsStatutoryRole: true,
  };
  policy.firmLayerHolderCollection = {
    status: "DEFERRED_FUTURE_FIRM_POLICY",
    enabled: false,
    requiresFirmSop: true,
    projectedRole: "firm_policy_qualifying_person",
  };
  policy.layerCompletenessDoctrine = {
    scope: "PER_LAYER_PER_DIMENSION",
    closureMethod: "INTERVAL_RESIDUAL_TEST",
    outputs: ["STATUTORY_CLOSURE", "FIRM_POLICY_CLOSURE", "EXACTNESS_NEEDED_FOR_DETERMINATION"],
    qualifiers: ["HOLDERS_IDENTIFIED", "COMPATIBLE_DENOMINATOR"],
    precisionEscalation: "ONLY_WHEN_ACTIVE_DETERMINATION_STRADDLES",
  };
  policy.percentageEvidenceStates = ["DECLARED_EXACT", "INDEPENDENT_BAND_CORROBORATED", "EXACT_VALUE_VERIFIED"];
  policy.declaredExactWithinIndependentBand = {
    result: "INDEPENDENT_BAND_CORROBORATED",
    exactValueVerification: false,
    sufficiencyByRisk: "TEST_SIGNOFF_REQUIRED",
    outsideBand: "CONFLICT_ASSESSMENT",
  };
  policy.controlActionGating = {
    assessAtRegulatedSubject: "ALWAYS",
    intermediaryControlNeedWhen: ["FACT_MATERIAL_TO_UNRESOLVED_STATUTORY_ROUTE"],
    numericCustomerControlQuestions: { mode: "LAST_RESORT_GATED", conditions: ["FACT_MATERIAL"] },
  };
  policy.residualConfirmationBundle = {
    presentation: "SINGLE_INTERACTION",
    availability: {
      maximumRisk: "TEST_ONLY",
      requiresStructureSufficientlyUnderstood: true,
      blockedByPositiveContrarySignal: true,
    },
    statements: [{ id: "TEST_STATEMENT", resolvesRequirement: "UBO-R06", contentStatus: "TEST_ONLY" }],
    independentStatementResults: true,
  };
  policy.listedTreatment = {
    customerListed: { status: "TEST_ONLY", authority: "TEST_AUTHORITY", requires: ["LISTING_EVIDENCE"], route: "listed_entity_policy" },
    customerConsolidatedSubsidiaryOfListed: { status: "TEST_ONLY", authority: "TEST_AUTHORITY", requires: ["CONSOLIDATION"] },
    intermediateListedParentTerminus: { enabled: false, status: "TEST_ONLY", requiresMarketList: true, requiresListingAndDisclosureEvidence: true },
  };
  policy.exhaustionMeasureCategories = ["AVAILABLE_DISCOVERY", "STRUCTURE_EVIDENCE"];
  policy.allowedDispositions = ["EXECUTED", "UNAVAILABLE", "IRRELEVANT", "DISPROPORTIONATE"];
  policy.reasonRequiredForNonExecuted = true;
  policy.authorisedExhaustionDecisionOrigins = ["ANALYST", "COMPLIANCE"];
  policy.structureAcquisition = {
    allowedStrategies: ["DISCOVERY_LED", "CHART_ASSISTED", "SPECIALIST"],
    chartIsCandidateStructureNotProof: true,
    permittedStructureEvidence: ["OWNERSHIP_CHART", "CAP_TABLE", "SHAREHOLDER_REGISTER"],
  };
  policy.phasedEvaluationOrder = [
    "BASE_APPLICABILITY",
    "CANONICAL_GRAPH_AND_DEPTH",
    "CALCULATIONS_AND_ATTRIBUTIONS",
    "QUALIFICATION",
    "DERIVED_REQUIREMENT_APPLICABILITY",
    "EVIDENCE_SUFFICIENCY",
    "INFORMATION_NEEDS",
    "RESOLUTION_PLANNING",
    "DECISION_SNAPSHOT",
  ];
  return policy;
}

module.exports = { approvedSignoff, clone, schema13Policy };
