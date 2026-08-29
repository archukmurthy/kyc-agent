"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
} = require("../domain/ownershipCase");
const { GRAPH_DIMENSION, buildCanonicalOwnershipGraph } = require("../domain/ownershipGraph");
const { calculateEffectivePercentage } = require("../domain/percentageCalculation");
const {
  INFORMATION_NEED_CONCEPT,
  INFORMATION_NEED_STATE,
  reconcileInformationNeeds,
} = require("../domain/resolutionArtifacts");
const {
  EVIDENCE_CLASSIFICATION_STATUS,
  EVIDENCE_CURRENT_STATE,
  EVIDENCE_SOURCE_ORIGIN,
  EVIDENCE_SUFFICIENCY_STATUS,
  EVIDENCE_SUPPORT_DIRECTION,
  assessEvidenceSufficiency,
  createEvidencePolicyClassification,
  validateEvidencePolicyClassification,
} = require("../policy/evidencePolicy");
const { loadPolicyPack } = require("../policy/policyPack");
const { BASIS_ASSESSMENT_STATE, BASIS_TYPE, determinePolicyAssessment } = require("../policy/policyDetermination");
const { resolvePolicyRequirements } = require("../policy/requirementResolution");

const NOW = "2026-08-29T12:00:00.000Z";
const policyArtifact = require("../policies/uk-corporate/1.3-rc/policy.json");
const loadedPolicyPack = loadPolicyPack(policyArtifact);

function reference(id, type = "document") {
  return { system: "g24a-test", referenceType: type, referenceId: id };
}

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value };
}

function unknown(reason = "not established") {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function categoryFor(entityId, categories) {
  return categories[entityId] || (entityId.startsWith("person-")
    ? CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON
    : CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY);
}

function party(entityId, categories) {
  const category = categoryFor(entityId, categories);
  return {
    name: entityId,
    entityType: category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON ? "NATURAL_PERSON" : "COMPANY",
    entityId,
    externalIdentifiers: [],
  };
}

function relationshipFact(edge, categories) {
  const fact = {
    factId: edge.id,
    type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
    subject: party(edge.subject, categories),
    relationship: edge.relationship,
    object: party(edge.object, categories),
    evidenceReferences: edge.evidenceReferences || [],
  };
  if (edge.measurement !== undefined) fact.measurement = edge.measurement;
  if (edge.qualifiers !== undefined) fact.qualifiers = edge.qualifiers;
  return fact;
}

function attributeFact(attribute, categories) {
  return {
    factId: attribute.id,
    type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
    subject: party(attribute.subject, categories),
    attribute: attribute.attribute,
    value: attribute.value,
    evidenceReferences: attribute.evidenceReferences || [],
  };
}

function buildCase({
  caseId = "g24a-case",
  target = "customer",
  categories = {},
  edges = [],
  attributes = [],
  operationEvidenceReferences = [],
  outcome = { state: CAPABILITY_OUTCOME_STATE.COMPLETE },
  disputedFactIds = [],
} = {}) {
  const entityIds = [...new Set([target,
    ...edges.flatMap(({ subject, object }) => [subject, object]),
    ...attributes.map(({ subject }) => subject),
  ])];
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: party(target, categories),
    externalReferences: [{ system: "g24a-test", referenceId: caseId }],
    createdAt: NOW,
  });
  entityIds.forEach((entityId) => {
    caseState = addCanonicalEntity(caseState, {
      entityId,
      category: categoryFor(entityId, categories),
      primaryName: entityId,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  const candidateFacts = [
    ...edges.map((edge) => relationshipFact(edge, categories)),
    ...attributes.map((attribute) => attributeFact(attribute, categories)),
  ];
  caseState = intakeCapabilityResult(caseState, {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}-request`,
    outcome,
    candidateFacts,
    operationEvidenceReferences,
    issues: [],
  }, { operationId: `${caseId}-operation`, recordedAt: NOW });
  caseState.candidateClaims.forEach((claim) => {
    const endpoints = claim.claimType === CANDIDATE_FACT_TYPE.RELATIONSHIP
      ? [["subject", claim.subject], ["object", claim.object]]
      : [["subject", claim.subject]];
    endpoints.forEach(([name, endpoint]) => {
      caseState = recordIdentityResolutionDecision(caseState, {
        decisionId: `${claim.claimId}:${name}:identity`,
        candidatePartyKey: endpoint.candidatePartyKey,
        status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
        entityId: endpoint.party.entityId,
        basisReasonCodes: ["G2_4A_FIXTURE"],
        evidenceReferences: [],
        decidedAt: NOW,
        decisionOrigin: "G2_4A_TEST",
      });
    });
    caseState = adjudicateClaim(caseState, {
      decisionId: `${claim.claimId}:adjudication`,
      claimId: claim.claimId,
      previousState: CLAIM_STATE.CANDIDATE,
      resultingState: disputedFactIds.includes(claim.originatingCandidateFact.candidateFactId)
        ? CLAIM_STATE.DISPUTED
        : CLAIM_STATE.OPERATIVE,
      reasonBasisCode: "G2_4A_FIXTURE",
      supportingEvidenceReferences: [],
      decisionOrigin: "G2_4A_TEST",
      decidedAt: NOW,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    });
  });
  return caseState;
}

function economic(id, subject, object, measurement, evidenceReferences = [], qualifiers = {}) {
  return {
    id,
    subject,
    object,
    relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    measurement,
    evidenceReferences,
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP", ...qualifiers },
  };
}

function voting(id, subject, object, measurement, evidenceReferences = []) {
  return {
    id,
    subject,
    object,
    relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS,
    measurement,
    evidenceReferences,
    qualifiers: { currentState: "CURRENT", votingConcept: "VOTING_RIGHTS" },
  };
}

function appointment(id, subject, object, evidenceReferences = [], categories = {}) {
  return {
    id,
    subject,
    object,
    relationship: RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
    evidenceReferences,
    qualifiers: {
      currentState: "CURRENT",
      entityProfile: categories.entityProfile || "COMPANY",
      controlConcept: categories.controlConcept || "BOARD_APPOINTMENT_RIGHTS",
      scope: categories.scope || "MAJORITY",
    },
  };
}

function otherControl(id, subject, object, evidenceReferences = [], qualifiers = {}) {
  return {
    id,
    subject,
    object,
    relationship: RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
    evidenceReferences,
    qualifiers: { currentState: "CURRENT", ...qualifiers },
  };
}

function buildEnvironment({
  caseOptions = {},
  entityType = "private_limited_company",
  facts = { ownership_layers: 1, qualifying_persons_count: 0, trust_in_chain: false },
  answers = {},
  calculationRequests = [],
  caseContext = {},
  pack = loadedPolicyPack,
} = {}) {
  const caseState = buildCase(caseOptions);
  const graph = buildCanonicalOwnershipGraph(caseState);
  const target = caseOptions.target || "customer";
  const calculations = calculationRequests.map(({ subjectEntityId, dimension }) => calculateEffectivePercentage(graph, {
    subjectEntityId,
    targetEntityId: target,
    dimension,
  }));
  const resolvedContext = {
    entityType,
    subjectEntityId: target,
    jurisdiction: "GB",
    riskLevel: "LOW",
    ...caseContext,
  };
  const policyAssessment = determinePolicyAssessment({
    loadedPolicyPack: pack,
    caseContext: resolvedContext,
    caseState,
    graph,
    calculations,
    facts,
    answers,
  });
  return { loadedPolicyPack: pack, caseContext: resolvedContext, caseState, graph, calculations, policyAssessment, facts, answers };
}

function classify(environment, {
  evidenceReference,
  evidenceCatalogueKey,
  sourceOrigin = EVIDENCE_SOURCE_ORIGIN.APPLICANT_ORIGINATED,
  supports,
  capturedAt = NOW,
  sourceEffectiveAt,
  currentState = EVIDENCE_CURRENT_STATE.CURRENT,
  basis = "G2_4A_TEST_CLASSIFICATION",
}) {
  return createEvidencePolicyClassification({
    loadedPolicyPack: environment.loadedPolicyPack,
    caseState: environment.caseState,
    input: {
      evidenceReference,
      ...(evidenceCatalogueKey ? { evidenceCatalogueKey } : {}),
      sourceOrigin,
      capturedAt,
      ...(sourceEffectiveAt ? { sourceEffectiveAt } : {}),
      currentState,
      classificationBasis: { origin: basis },
      supports,
    },
  });
}

function resolve(environment, extra = {}) {
  return resolvePolicyRequirements({
    ...environment,
    evidenceClassifications: extra.evidenceClassifications || [],
    evaluationDate: extra.evaluationDate || NOW,
    relevantConflicts: extra.relevantConflicts || [],
    operationContexts: extra.operationContexts || [],
    priorInformationNeedRecords: extra.priorInformationNeedRecords || [],
  });
}

function requirement(result, requirementId) {
  return result.requirementResolutions.find((item) => item.requirementId === requirementId);
}

function basis(environment, requirementId, basisType) {
  return environment.policyAssessment.basisAssessments.find((item) => item.requirementId === requirementId
    && (!basisType || item.basisType === basisType));
}

function positiveSupport(requirementId, evidenceReference, evidenceCatalogueKey, strategy, basisAssessmentIds = [], extra = {}) {
  return {
    evidenceReference,
    evidenceCatalogueKey,
    supports: [{
      requirementId,
      direction: EVIDENCE_SUPPORT_DIRECTION.POSITIVE,
      resolutionStrategy: strategy,
      basisAssessmentIds,
      claimIds: [],
      ...extra,
    }],
  };
}

test("EvidencePolicyClassification is pinned, auditable, immutable, and preserves unclassified references", () => {
  const unknownRef = reference("unknown-evidence");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [unknownRef] } });
  const classification = classify(environment, {
    evidenceReference: unknownRef,
    evidenceCatalogueKey: "not_in_pack",
    sourceOrigin: EVIDENCE_SOURCE_ORIGIN.UNKNOWN,
    supports: [{ requirementId: "UBO-R08", direction: "POSITIVE", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }],
  });
  assert.equal(classification.classificationStatus, EVIDENCE_CLASSIFICATION_STATUS.UNCLASSIFIED);
  assert.equal(classification.evidenceReference.referenceId, "unknown-evidence");
  assert.equal(classification.evidenceCatalogueKey, "not_in_pack");
  assert.equal(classification.policyIdentity.policyHash, environment.loadedPolicyPack.identity.hash);
  assert.ok(classification.classificationId.startsWith("evidence-classification:"));
  assert.ok(Object.isFrozen(classification));
});

test("malformed classifications fail and independence is never inferred from upload identity", () => {
  const evidence = reference("registry-copy");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [evidence] } });
  assert.throws(() => createEvidencePolicyClassification({
    loadedPolicyPack,
    caseState: environment.caseState,
    input: {
      evidenceReference: evidence,
      evidenceCatalogueKey: "companies_house_record",
      sourceOrigin: "CUSTOMER_UPLOADED_BUT_PROBABLY_INDEPENDENT",
      classificationBasis: { origin: "GUESS" },
      supports: [],
    },
  }), /sourceOrigin must be one of/);
  assert.throws(() => classify(environment, {
    evidenceReference: reference("not-in-case"),
    evidenceCatalogueKey: "companies_house_record",
    supports: [],
  }), /not present in the OwnershipCase/);
  const valid = classify(environment, {
    evidenceReference: evidence,
    evidenceCatalogueKey: "companies_house_record",
    sourceOrigin: "INDEPENDENT_OF_APPLICANT",
    supports: [],
  });
  const tampered = JSON.parse(JSON.stringify(valid));
  tampered.policyCharacteristics.defaultStrength = 99;
  assert.throws(() => validateEvidencePolicyClassification(tampered, { loadedPolicyPack, caseState: environment.caseState }), /characteristics do not match/);
});

test("individual minimum strength passes while two low-strength items never add", () => {
  const strong = reference("members-register");
  const weakA = reference("attestation-a");
  const weakB = reference("attestation-b");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [strong, weakA, weakB] } });
  const supports = [{ requirementId: "UBO-R01", direction: "POSITIVE", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }];
  const strongClassification = classify(environment, { evidenceReference: strong, evidenceCatalogueKey: "register_of_members", supports });
  const weakClassifications = [weakA, weakB].map((evidenceReference) => classify(environment, {
    evidenceReference,
    evidenceCatalogueKey: "customer_attestation",
    supports,
  }));
  const common = {
    loadedPolicyPack,
    caseState: environment.caseState,
    requirementId: "UBO-R01",
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: EVIDENCE_SUPPORT_DIRECTION.POSITIVE,
  };
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [strongClassification] }).status, EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT);
  const low = assessEvidenceSufficiency({ ...common, classifications: weakClassifications });
  assert.equal(low.status, EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT);
  assert.equal(low.distinctEligibleSourceIds.length, 0);
});

test("can-resolve-alone, corroboration, and resolution effects remain independent constraints", () => {
  const psc = reference("psc");
  const structure = reference("structure-chart");
  const registry = reference("foreign-registry");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [psc, structure, registry] } });
  const pscClassification = classify(environment, {
    ...positiveSupport("UBO-R01", psc, "companies_house_record", "DISCOVERY", [], { policyFactKey: "ownership_structure" }),
  });
  const structureClassification = classify(environment, {
    ...positiveSupport("UBO-R01", structure, "director_certified_structure_chart", "EXISTING_EVIDENCE"),
  });
  const registryClassification = classify(environment, {
    ...positiveSupport("UBO-R01", registry, "foreign_registry_extract", "EXISTING_EVIDENCE"),
    sourceOrigin: EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT,
    sourceEffectiveAt: NOW,
  });
  const common = {
    loadedPolicyPack,
    caseState: environment.caseState,
    requirementId: "UBO-R01",
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: EVIDENCE_SUPPORT_DIRECTION.POSITIVE,
  };
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [pscClassification] }).status, EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT);
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [structureClassification] }).status, EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT);
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [structureClassification, registryClassification] }).status, EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT);
});

test("POSITIVE_ONLY cannot prove absence and CORROBORATIVE_ONLY cannot establish the underlying fact", () => {
  const psc = reference("psc-effects");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [psc] } });
  const positiveOnly = classify(environment, {
    evidenceReference: psc,
    evidenceCatalogueKey: "companies_house_record",
    sourceOrigin: EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT,
    supports: [{ requirementId: "UBO-R04", direction: "NEGATIVE", policyFactKey: "absence_of_specific_control_code", resolutionStrategy: "DISCOVERY", basisAssessmentIds: [], claimIds: [] }],
  });
  const negative = assessEvidenceSufficiency({
    loadedPolicyPack,
    caseState: environment.caseState,
    requirementId: "UBO-R04",
    classifications: [positiveOnly],
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: EVIDENCE_SUPPORT_DIRECTION.NEGATIVE,
  });
  assert.equal(negative.status, EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT);
  assert.ok(negative.consideredEvidence[0].reasonCodes.includes("EVIDENCE_EFFECT_CANNOT_PROVE_NEGATIVE"));
});

test("R08 counts distinct durable independent sources, not classifications or applicant declarations", () => {
  const applicant = reference("customer-declaration");
  const independent = reference("registry-independent");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [applicant, independent] } });
  const support = [{ requirementId: "UBO-R08", direction: "POSITIVE", policyFactKey: "ownership_structure", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }];
  const customer = classify(environment, { evidenceReference: applicant, evidenceCatalogueKey: "director_certified_structure_chart", supports: support });
  const first = classify(environment, { evidenceReference: independent, evidenceCatalogueKey: "companies_house_record", sourceOrigin: "INDEPENDENT_OF_APPLICANT", supports: support, basis: "FIRST" });
  const duplicate = classify(environment, { evidenceReference: independent, evidenceCatalogueKey: "companies_house_record", sourceOrigin: "INDEPENDENT_OF_APPLICANT", supports: support, basis: "SECOND" });
  const common = {
    loadedPolicyPack,
    caseState: environment.caseState,
    requirementId: "UBO-R08",
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: "POSITIVE",
    independentCorroboration: true,
  };
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [customer] }).status, "INSUFFICIENT");
  const result = assessEvidenceSufficiency({ ...common, classifications: [customer, first, duplicate] });
  assert.equal(result.status, "SUFFICIENT");
  assert.equal(result.distinctIndependentSourceIds.length, 1);
});

test("R08 configured independent-source count requires distinct sources", () => {
  const modifiedArtifact = JSON.parse(JSON.stringify(policyArtifact));
  modifiedArtifact.parameters.required_independent_ownership_corroboration_sources.value = 2;
  const pack = loadPolicyPack(modifiedArtifact);
  const firstRef = reference("independent-one");
  const secondRef = reference("independent-two");
  const environment = buildEnvironment({ pack, caseOptions: { operationEvidenceReferences: [firstRef, secondRef] } });
  const support = [{ requirementId: "UBO-R08", direction: "POSITIVE", policyFactKey: "ownership_structure", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }];
  const classifications = [firstRef, secondRef].map((evidenceReference) => classify(environment, {
    evidenceReference,
    evidenceCatalogueKey: "companies_house_record",
    sourceOrigin: "INDEPENDENT_OF_APPLICANT",
    supports: support,
  }));
  const common = {
    loadedPolicyPack: pack,
    caseState: environment.caseState,
    requirementId: "UBO-R08",
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: "POSITIVE",
    independentCorroboration: true,
  };
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [classifications[0]] }).status, "INSUFFICIENT");
  assert.equal(assessEvidenceSufficiency({ ...common, classifications }).status, "SUFFICIENT");
});

test("policy freshness and current-state metadata prevent stale or historical evidence from satisfying current requirements", () => {
  const freshRef = reference("fresh-registry");
  const staleRef = reference("stale-registry");
  const historicalRef = reference("historical-registry");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [freshRef, staleRef, historicalRef] } });
  const support = [{ requirementId: "UBO-R01", direction: "POSITIVE", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }];
  const fresh = classify(environment, { evidenceReference: freshRef, evidenceCatalogueKey: "foreign_registry_extract", sourceOrigin: "INDEPENDENT_OF_APPLICANT", sourceEffectiveAt: "2026-08-01T00:00:00.000Z", supports: support });
  const stale = classify(environment, { evidenceReference: staleRef, evidenceCatalogueKey: "foreign_registry_extract", sourceOrigin: "INDEPENDENT_OF_APPLICANT", sourceEffectiveAt: "2025-01-01T00:00:00.000Z", supports: support });
  const historical = classify(environment, { evidenceReference: historicalRef, evidenceCatalogueKey: "foreign_registry_extract", sourceOrigin: "INDEPENDENT_OF_APPLICANT", sourceEffectiveAt: "2026-08-01T00:00:00.000Z", currentState: "HISTORICAL", supports: support });
  const common = {
    loadedPolicyPack,
    caseState: environment.caseState,
    requirementId: "UBO-R01",
    conditionContext: { case: { entity_profile: "COMPANY" }, facts: {}, answers: {}, params: {} },
    evaluationDate: NOW,
    riskLevel: "LOW",
    direction: "POSITIVE",
  };
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [fresh] }).status, "SUFFICIENT");
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [stale] }).status, "INSUFFICIENT");
  assert.equal(assessEvidenceSufficiency({ ...common, classifications: [historical] }).status, "INSUFFICIENT");
});

test("UNKNOWN source origin never counts as independent corroboration", () => {
  const evidence = reference("unknown-origin");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [evidence] } });
  const classification = classify(environment, {
    evidenceReference: evidence,
    evidenceCatalogueKey: "companies_house_record",
    sourceOrigin: "UNKNOWN",
    supports: [{ requirementId: "UBO-R08", direction: "POSITIVE", policyFactKey: "ownership_structure", resolutionStrategy: "EXISTING_EVIDENCE", basisAssessmentIds: [], claimIds: [] }],
  });
  const result = resolve(environment, { evidenceClassifications: [classification] });
  assert.equal(requirement(result, "UBO-R08").requirementStatus, REQUIREMENT_STATE.GAP);
});

test("requirement precedence protects N_A and applicability UNKNOWN", () => {
  const out = buildEnvironment({ entityType: "sole_trader" });
  assert.equal(requirement(resolve(out), "UBO-R01").requirementStatus, REQUIREMENT_STATE.N_A);
  const unknownApplicability = buildEnvironment({ entityType: null });
  const record = requirement(resolve(unknownApplicability), "UBO-R01");
  assert.equal(record.requirementStatus, REQUIREMENT_STATE.UNRESOLVED);
  assert.notEqual(record.requirementStatus, REQUIREMENT_STATE.N_A);
});

test("only explicitly relevant unresolved conflicts produce CONFLICT", () => {
  const environment = buildEnvironment({
    caseOptions: {
      edges: [economic("conflicted", "person-a", "customer", exact(40))],
      disputedFactIds: ["conflicted"],
    },
  });
  const claimId = environment.caseState.candidateClaims[0].claimId;
  const result = resolve(environment, { relevantConflicts: [{ conflictId: "conflict-1", requirementIds: ["UBO-R01"], claimIds: [claimId], reasonCode: "COMPETING_OWNERSHIP" }] });
  assert.equal(requirement(result, "UBO-R01").requirementStatus, REQUIREMENT_STATE.CONFLICT);
  assert.notEqual(requirement(result, "UBO-R04").requirementStatus, REQUIREMENT_STATE.CONFLICT);
});

test("G2.3 ambiguity has REVIEW_REQUIRED precedence over ordinary gap creation", () => {
  const environment = buildEnvironment({
    caseOptions: { edges: [otherControl("ambiguous", "person-a", "customer", [], { ambiguity: "veto scope unclear" })] },
  });
  const result = resolve(environment);
  const record = requirement(result, "UBO-R06");
  assert.equal(record.requirementStatus, REQUIREMENT_STATE.REVIEW_REQUIRED);
  assert.equal(record.informationNeedIds.length, 0);
  assert.equal(record.policyGapIds.length, 0);
});

test("R01 direct qualifying natural person resolves only with sufficient classified evidence", () => {
  const evidence = reference("direct-owner-register");
  const environment = buildEnvironment({
    caseOptions: { edges: [economic("direct", "person-a", "customer", exact(40), [evidence])], operationEvidenceReferences: [evidence] },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 1, qualifying_persons_count: 1, trust_in_chain: false },
  });
  const r01Basis = basis(environment, "UBO-R01", BASIS_TYPE.ECONOMIC_INTEREST);
  const classification = classify(environment, {
    ...positiveSupport("UBO-R01", evidence, "register_of_members", "EXISTING_EVIDENCE", [r01Basis.assessmentId]),
  });
  assert.equal(requirement(resolve(environment), "UBO-R01").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.equal(requirement(resolve(environment, { evidenceClassifications: [classification] }), "UBO-R01").requirementStatus, REQUIREMENT_STATE.RESOLVED);
});

test("a legal-entity control holder creates one deduplicated ownership/control need for R01, R04 and R05", () => {
  const environment = buildEnvironment({
    caseOptions: { edges: [
      economic("holdco-economic", "holdco", "customer", exact(40)),
      voting("holdco-voting", "holdco", "customer", exact(40)),
      appointment("holdco-appointment", "holdco", "customer"),
    ] },
    calculationRequests: [
      { subjectEntityId: "holdco", dimension: GRAPH_DIMENSION.ECONOMIC },
      { subjectEntityId: "holdco", dimension: GRAPH_DIMENSION.VOTING },
    ],
  });
  const result = resolve(environment);
  const needs = result.informationNeeds.filter(({ state, subjectEntityId, concept }) => state === "OPEN"
    && subjectEntityId === "holdco" && concept === "CURRENT_OWNERSHIP_AND_CONTROL");
  assert.equal(needs.length, 1);
  assert.deepEqual(needs[0].requiredBy, ["UBO-R01", "UBO-R04", "UBO-R05"]);
});

test("R02 resolves only a COMPLETE pinned calculation and creates targeted needs for partial values", () => {
  const complete = buildEnvironment({
    caseOptions: { edges: [economic("p-h", "person-a", "holdco", exact(60)), economic("h-c", "holdco", "customer", exact(70))] },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2, qualifying_persons_count: 1, trust_in_chain: false },
  });
  assert.equal(requirement(resolve(complete), "UBO-R02").requirementStatus, REQUIREMENT_STATE.RESOLVED);
  const partial = buildEnvironment({
    caseOptions: { edges: [economic("p-h-u", "person-a", "holdco", unknown()), economic("h-c-k", "holdco", "customer", exact(70))] },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2, qualifying_persons_count: 0 },
  });
  const result = resolve(partial);
  assert.equal(requirement(result, "UBO-R02").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.ok(result.informationNeeds.some(({ concept }) => concept === INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE));
});

test("R02 relevant cycles remain GAP and never become a completed negative conclusion", () => {
  const environment = buildEnvironment({
    caseOptions: { edges: [
      economic("p-a", "person-a", "company-a", exact(60)),
      economic("a-b", "company-a", "company-b", exact(70)),
      economic("b-a", "company-b", "company-a", exact(10)),
      economic("b-c", "company-b", "customer", exact(80)),
    ] },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 3, qualifying_persons_count: 0 },
  });
  const record = requirement(resolve(environment), "UBO-R02");
  assert.equal(record.requirementStatus, REQUIREMENT_STATE.GAP);
  assert.notEqual(record.reasonCode, "COMPLETE_EVIDENCED_NEGATIVE");
});

function r03Environment(evidenceReferences = []) {
  return buildEnvironment({
    caseOptions: {
      edges: [economic("p-h", "person-a", "holdco", exact(60)), economic("h-c", "holdco", "customer", exact(70))],
      operationEvidenceReferences: evidenceReferences,
    },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2, qualifying_persons_count: 1, trust_in_chain: false },
  });
}

test("R03 proves entity existence and chain relationships independently", () => {
  const existenceRef = reference("holdco-existence");
  const relationshipRef = reference("chain-relationships");
  const environment = r03Environment([existenceRef, relationshipRef]);
  const relationshipIds = environment.graph.relationships.map(({ relationshipId }) => relationshipId);
  const existence = classify(environment, {
    evidenceReference: existenceRef,
    evidenceCatalogueKey: "foreign_registry_extract",
    sourceOrigin: "INDEPENDENT_OF_APPLICANT",
    sourceEffectiveAt: NOW,
    supports: [{ requirementId: "UBO-R03", direction: "POSITIVE", resolutionStrategy: "DISCOVERY", concept: "ENTITY_EXISTENCE", subjectEntityId: "holdco", basisAssessmentIds: [], claimIds: [] }],
  });
  const relationshipEvidence = classify(environment, {
    evidenceReference: relationshipRef,
    evidenceCatalogueKey: "certified_constitutional_documents",
    supports: relationshipIds.map((relationshipId) => ({ requirementId: "UBO-R03", direction: "POSITIVE", resolutionStrategy: "CUSTOMER_DOCUMENT", concept: "RELATIONSHIP_EVIDENCE", relationshipId, basisAssessmentIds: [], claimIds: [] })),
  });
  const existenceOnly = resolve(environment, { evidenceClassifications: [existence] });
  assert.ok(existenceOnly.informationNeeds.some(({ concept }) => concept === "RELATIONSHIP_EVIDENCE"));
  assert.equal(existenceOnly.informationNeeds.some(({ concept }) => concept === "ENTITY_EXISTENCE"), false);
  const relationshipOnly = resolve(environment, { evidenceClassifications: [relationshipEvidence] });
  assert.ok(relationshipOnly.informationNeeds.some(({ concept }) => concept === "ENTITY_EXISTENCE"));
  assert.equal(requirement(resolve(environment, { evidenceClassifications: [existence, relationshipEvidence] }), "UBO-R03").requirementStatus, REQUIREMENT_STATE.RESOLVED);
});

test("R04, R05 and R06 resolve separate positive natural-person bases with policy evidence", () => {
  const evidence = reference("governance-evidence");
  const environment = buildEnvironment({
    caseOptions: {
      edges: [
        voting("vote", "person-a", "customer", exact(40), [evidence]),
        appointment("appoint", "person-a", "customer", [evidence]),
        otherControl("other", "person-a", "customer", [evidence]),
      ],
      operationEvidenceReferences: [evidence],
    },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.VOTING }],
    facts: { ownership_layers: 1, qualifying_persons_count: 1, trust_in_chain: false },
  });
  const supports = [
    ["UBO-R04", "EXISTING_EVIDENCE", "articles_of_association"],
    ["UBO-R05", "EXISTING_EVIDENCE", "articles_of_association"],
    ["UBO-R06", "EXISTING_EVIDENCE", "articles_of_association"],
  ].map(([requirementId, resolutionStrategy]) => ({
    requirementId,
    direction: "POSITIVE",
    resolutionStrategy,
    basisAssessmentIds: [basis(environment, requirementId).assessmentId],
    claimIds: [],
  }));
  const classification = classify(environment, { evidenceReference: evidence, evidenceCatalogueKey: "articles_of_association", supports });
  const result = resolve(environment, { evidenceClassifications: [classification] });
  ["UBO-R04", "UBO-R05", "UBO-R06"].forEach((id) => assert.equal(requirement(result, id).requirementStatus, REQUIREMENT_STATE.RESOLVED));
});

test("HIGH risk invalidates attestation-only R05 closure and PSC silence cannot negatively resolve R06", () => {
  const attestation = reference("negative-attestation");
  const pscSilence = reference("psc-silence");
  const environment = buildEnvironment({
    caseOptions: { operationEvidenceReferences: [attestation, pscSilence] },
    answers: { DISCLOSE_APPOINTMENT_REMOVAL_CONTROL: "no" },
    caseContext: { riskLevel: "HIGH" },
  });
  const classifications = [
    classify(environment, {
      evidenceReference: attestation,
      evidenceCatalogueKey: "customer_attestation",
      supports: [{ requirementId: "UBO-R05", direction: "NEGATIVE", resolutionStrategy: "CUSTOMER_ATTESTATION", policyFactKey: "negative_control_confirmations", basisAssessmentIds: [], claimIds: [] }],
    }),
    classify(environment, {
      evidenceReference: pscSilence,
      evidenceCatalogueKey: "companies_house_record",
      sourceOrigin: "INDEPENDENT_OF_APPLICANT",
      supports: [{ requirementId: "UBO-R06", direction: "NEGATIVE", resolutionStrategy: "DISCOVERY", policyFactKey: "absence_of_specific_control_code", basisAssessmentIds: [], claimIds: [] }],
    }),
  ];
  const result = resolve(environment, { evidenceClassifications: classifications });
  assert.equal(requirement(result, "UBO-R05").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.equal(requirement(result, "UBO-R06").requirementStatus, REQUIREMENT_STATE.GAP);
});

test("independent PSC evidence may resolve R08 corroboration without becoming a UBO conclusion", () => {
  const psc = reference("psc-corroboration");
  const environment = buildEnvironment({ caseOptions: { operationEvidenceReferences: [psc] } });
  const classification = classify(environment, {
    evidenceReference: psc,
    evidenceCatalogueKey: "companies_house_record",
    sourceOrigin: "INDEPENDENT_OF_APPLICANT",
    supports: [{ requirementId: "UBO-R08", direction: "POSITIVE", resolutionStrategy: "EXISTING_EVIDENCE", policyFactKey: "ownership_structure", basisAssessmentIds: [], claimIds: [] }],
  });
  const result = resolve(environment, { evidenceClassifications: [classification] });
  assert.equal(requirement(result, "UBO-R08").requirementStatus, REQUIREMENT_STATE.RESOLVED);
  assert.equal(environment.policyAssessment.qualifyingPersons.length, 0);
  assert.notEqual(requirement(result, "UBO-R01").requirementStatus, REQUIREMENT_STATE.RESOLVED);
});

test("R07 uses canonical names and operative attribute claims without producing IDV, POI, POA or screening needs", () => {
  const environment = buildEnvironment({
    caseOptions: {
      edges: [economic("direct", "person-a", "customer", exact(40))],
      attributes: [{ id: "dob", subject: "person-a", attribute: "date_of_birth", value: "1990-01-02" }],
      outcome: { state: CAPABILITY_OUTCOME_STATE.PARTIAL },
    },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 1, qualifying_persons_count: 1, trust_in_chain: false },
    caseContext: { requiredIdentityAttributes: ["full_legal_name", "ownership_or_control_basis", "date_of_birth", "nationality"] },
  });
  const result = resolve(environment);
  const r07Needs = result.informationNeeds.filter(({ requiredBy, state }) => requiredBy.includes("UBO-R07") && state !== "SATISFIED");
  assert.deepEqual(r07Needs.map(({ attribute }) => attribute), ["nationality"]);
  assert.equal(JSON.stringify(r07Needs).match(/IDV|POI|POA|SCREEN/i), null);
});

test("R11 preserves trust specialist review and never infers absence from incomplete structure", () => {
  const trustEnvironment = buildEnvironment({
    caseOptions: {
      categories: { trust: CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT },
      edges: [{ id: "trust-edge", subject: "trust", object: "customer", relationship: RELATIONSHIP_TYPE.TRUST_OWNERSHIP, qualifiers: { currentState: "CURRENT" } }],
    },
    facts: { ownership_layers: 1, qualifying_persons_count: 0, trust_in_chain: true },
  });
  assert.equal(requirement(resolve(trustEnvironment), "UBO-R11").requirementStatus, REQUIREMENT_STATE.REVIEW_REQUIRED);
  const incomplete = buildEnvironment({ facts: { ownership_layers: 1, qualifying_persons_count: 0 } });
  const result = resolve(incomplete);
  assert.equal(requirement(result, "UBO-R11").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.ok(result.informationNeeds.some(({ concept }) => concept === INFORMATION_NEED_CONCEPT.TRUST_INVOLVEMENT));
});

test("R12 explicit nominee evidence creates an underlying-principal need and silence never proves absence", () => {
  const nominee = buildEnvironment({
    caseOptions: { edges: [economic("nominee", "nominee-co", "customer", exact(30), [], { nominee: true })] },
    calculationRequests: [{ subjectEntityId: "nominee-co", dimension: GRAPH_DIMENSION.ECONOMIC }],
  });
  const nomineeResult = resolve(nominee);
  assert.equal(requirement(nomineeResult, "UBO-R12").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.ok(nomineeResult.informationNeeds.some(({ concept }) => concept === "UNDERLYING_NOMINEE_PRINCIPAL"));
  const silent = resolve(buildEnvironment());
  assert.equal(requirement(silent, "UBO-R12").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.ok(silent.informationNeeds.some(({ concept }) => concept === "NOMINEE_OR_BEARER_STATUS"));
});

test("NO_DATA, INCONCLUSIVE and UNSUPPORTED preserve substantive needs without becoming negative facts", () => {
  for (const state of [CAPABILITY_OUTCOME_STATE.NO_DATA, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE, CAPABILITY_OUTCOME_STATE.UNSUPPORTED]) {
    const environment = buildEnvironment({ caseOptions: { outcome: { state } }, facts: { ownership_layers: 1, qualifying_persons_count: 0 } });
    const result = resolve(environment);
    assert.equal(requirement(result, "UBO-R01").requirementStatus, REQUIREMENT_STATE.GAP);
    assert.equal(result.operationalBlockers.length, 0);
  }
});

test("UNAVAILABLE and FAILED are operational blockers, never PolicyGaps by themselves", () => {
  for (const state of [CAPABILITY_OUTCOME_STATE.UNAVAILABLE, CAPABILITY_OUTCOME_STATE.FAILED]) {
    const environment = buildEnvironment({ caseOptions: { caseId: `operational-${state}`, outcome: { state, code: `${state}_TEST`, retryable: state === "UNAVAILABLE" } } });
    const result = resolve(environment, { operationContexts: [{ operationId: `${environment.caseState.caseId}-operation`, requirementIds: ["UBO-R01"], informationNeedIds: [], operationalOnly: true }] });
    const r01 = requirement(result, "UBO-R01");
    assert.equal(r01.requirementStatus, REQUIREMENT_STATE.UNRESOLVED);
    assert.equal(r01.policyGapIds.length, 0);
    assert.equal(r01.operationalBlockerIds.length, 1);
  }
});

test("PARTIAL capability results may establish one identity attribute while another remains open", () => {
  const environment = buildEnvironment({
    caseOptions: {
      edges: [economic("direct", "person-a", "customer", exact(40))],
      attributes: [{ id: "nationality", subject: "person-a", attribute: "nationality", value: "British" }],
      outcome: { state: CAPABILITY_OUTCOME_STATE.PARTIAL },
    },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 1, qualifying_persons_count: 1 },
    caseContext: { requiredIdentityAttributes: ["full_legal_name", "ownership_or_control_basis", "nationality", "country_of_residence"] },
  });
  const needs = resolve(environment).informationNeeds.filter(({ requiredBy }) => requiredBy.includes("UBO-R07"));
  assert.equal(needs.some(({ attribute }) => attribute === "nationality"), false);
  assert.equal(needs.some(({ attribute }) => attribute === "country_of_residence"), true);
});

test("InformationNeed lifecycle deduplicates semantics and retains satisfied and reopened history", () => {
  const caseState = buildCase({ caseId: "need-history" });
  const ownershipDraft = {
    subjectEntityId: "customer",
    requiredBy: ["UBO-R01", "UBO-R04"],
    concept: "CURRENT_OWNERSHIP_AND_CONTROL",
    reasonCodes: ["MISSING"],
    claimIds: [],
    calculationReferences: [],
    conflictReferences: [],
    existingEvidenceReferences: [],
    permittedResolutionStrategies: ["DISCOVERY", "EXISTING_EVIDENCE"],
  };
  const first = reconcileInformationNeeds({ caseState, drafts: [ownershipDraft, { ...ownershipDraft, requiredBy: ["UBO-R05"] }] });
  assert.equal(first.current.length, 1);
  assert.deepEqual(first.current[0].requiredBy, ["UBO-R01", "UBO-R04", "UBO-R05"]);
  const satisfied = reconcileInformationNeeds({ caseState, drafts: [], priorRecords: first.history });
  assert.equal(satisfied.current[0].state, INFORMATION_NEED_STATE.SATISFIED);
  assert.ok(satisfied.history.some(({ state }) => state === INFORMATION_NEED_STATE.OPEN));
  const reopened = reconcileInformationNeeds({ caseState, drafts: [ownershipDraft], priorRecords: satisfied.history });
  assert.equal(reopened.current[0].state, INFORMATION_NEED_STATE.OPEN);
  assert.ok(reopened.history.some(({ state }) => state === INFORMATION_NEED_STATE.SATISFIED));
});

test("different semantic needs remain separate", () => {
  const caseState = buildCase({ caseId: "need-separation" });
  const base = { subjectEntityId: "customer", requiredBy: ["UBO-R03"], reasonCodes: ["MISSING"], claimIds: [], calculationReferences: [], conflictReferences: [], existingEvidenceReferences: [], permittedResolutionStrategies: [] };
  const result = reconcileInformationNeeds({ caseState, drafts: [
    { ...base, concept: "ENTITY_EXISTENCE" },
    { ...base, concept: "RELATIONSHIP_EVIDENCE", relationshipId: "relationship-1" },
  ] });
  assert.equal(result.current.length, 2);
});

test("G2.4A results are deterministic, deeply immutable, and do not mutate inputs", () => {
  const evidence = reference("deterministic");
  const environment = buildEnvironment({
    caseOptions: { edges: [economic("direct", "person-a", "customer", exact(40), [evidence])], operationEvidenceReferences: [evidence] },
    calculationRequests: [{ subjectEntityId: "person-a", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 1, qualifying_persons_count: 1, trust_in_chain: false },
  });
  const r01Basis = basis(environment, "UBO-R01");
  const classification = classify(environment, { ...positiveSupport("UBO-R01", evidence, "register_of_members", "EXISTING_EVIDENCE", [r01Basis.assessmentId]) });
  const before = JSON.stringify({ environment, classification });
  const first = resolve(environment, { evidenceClassifications: [classification] });
  const second = resolve(environment, { evidenceClassifications: [classification] });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ environment, classification }), before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.requirementResolutions[0]));
  assert.equal("terminalOutcome" in first, false);
  assert.equal("actions" in first, false);
  assert.equal("snapshot" in first, false);
});
