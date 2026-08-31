"use strict";

const { createHash } = require("node:crypto");
const {
  OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE,
  OwnershipGraphProjectionError,
} = require("../errors");
const { cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  verifyDecisionSnapshot,
} = require("../domain/decisionSnapshot");

const OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION = "ubo-ownership-graph-projection-v1";

const NODE_SEMANTIC = Object.freeze({
  SUBJECT: "SUBJECT",
  QUALIFYING_PERSON: "QUALIFYING_PERSON",
  UNRESOLVED_ENTITY: "UNRESOLVED_ENTITY",
  SPECIAL_STRUCTURE: "SPECIAL_STRUCTURE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  CONFLICT: "CONFLICT",
  STRUCTURAL_TERMINUS: "STRUCTURAL_TERMINUS",
});

function projectionError(code, message, cause) {
  return new OwnershipGraphProjectionError(message, { code, cause });
}

function canonicalSort(values) {
  return [...(values || [])].map(cloneData).sort((left, right) => (
    canonicalizeJson(left).localeCompare(canonicalizeJson(right))
  ));
}

function uniqueCanonical(values) {
  const unique = new Map();
  (values || []).forEach((value) => unique.set(canonicalizeJson(value), cloneData(value)));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function stableId(prefix, value) {
  const digest = createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

function calculationIdentity(calculation) {
  return {
    calculationAlgorithm: calculation.calculationAlgorithm,
    graphVersion: calculation.graphVersion,
    subjectEntityId: calculation.subjectEntityId,
    targetEntityId: calculation.targetEntityId,
    dimension: calculation.dimension,
  };
}

function calculationId(calculation) {
  return stableId("calculation", calculationIdentity(calculation));
}

function evidenceForClaims(claimIds, claimsById) {
  return uniqueCanonical(claimIds.flatMap((claimId) => claimsById.get(claimId)?.evidenceReferences || []));
}

function latestResolvedEntityByParty(content) {
  const latest = new Map();
  canonicalSort(content.reasoning.identityResolutionDecisions || []).forEach((decision) => {
    if (decision.status !== "RESOLVED" || !decision.entityId || !decision.candidatePartyKey) return;
    const previous = latest.get(decision.candidatePartyKey);
    const order = `${decision.decidedAt || ""}|${decision.decisionId || ""}`;
    if (!previous || order > previous.order) latest.set(decision.candidatePartyKey, { order, entityId: decision.entityId });
  });
  return new Map([...latest].map(([key, value]) => [key, value.entityId]));
}

function claimEntityIds(claim, resolvedPartyEntities) {
  return uniqueStrings([
    resolvedPartyEntities.get(claim?.subject?.candidatePartyKey),
    resolvedPartyEntities.get(claim?.object?.candidatePartyKey),
  ]);
}

function projectCalculations(content, relationshipIds) {
  return canonicalSort(content.reasoning.calculations || []).map((calculation) => {
    const paths = canonicalSort(calculation.knownPaths || []).map((path) => {
      path.relationshipIds.forEach((id) => {
        if (!relationshipIds.has(id)) throw projectionError(
          OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
          "DecisionSnapshot calculation path references an unknown relationship",
        );
      });
      return {
        pathId: path.pathId,
        relationshipIds: cloneData(path.relationshipIds),
        contribution: cloneData(path.contribution),
        state: "KNOWN",
      };
    });
    const unresolvedPaths = canonicalSort(calculation.unresolvedPaths || []).map((path) => {
      path.relationshipIds.forEach((id) => {
        if (!relationshipIds.has(id)) throw projectionError(
          OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
          "DecisionSnapshot unresolved calculation path references an unknown relationship",
        );
      });
      return {
        pathId: path.pathId,
        relationshipIds: cloneData(path.relationshipIds),
        reasons: cloneData(path.reasons),
        state: "UNRESOLVED",
      };
    });
    return {
      calculationId: calculationId(calculation),
      calculationAlgorithm: calculation.calculationAlgorithm,
      graphVersion: calculation.graphVersion,
      subjectEntityId: calculation.subjectEntityId,
      targetEntityId: calculation.targetEntityId,
      dimension: calculation.dimension,
      status: calculation.status,
      ...(calculation.aggregateKnownValue === undefined ? {} : { result: cloneData(calculation.aggregateKnownValue) }),
      paths,
      unresolvedPaths,
      cycles: canonicalSort(calculation.cycles || []),
    };
  }).sort((left, right) => left.calculationId.localeCompare(right.calculationId));
}

function matchCalculationId(reference, calculations) {
  if (!reference) return undefined;
  const match = calculations.find((calculation) => canonicalizeJson(calculationIdentity(calculation))
    === canonicalizeJson(calculationIdentity(reference)));
  if (!match) throw projectionError(
    OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
    "DecisionSnapshot qualification references an unknown calculation",
  );
  return match.calculationId;
}

function projectQualifications(content, calculations, relationshipsById, claimsById) {
  const qualifications = (content.decision.qualifyingPersons || []).map((person) => {
    const bases = canonicalSort(person.bases || []).map((basis) => {
      const relationshipIds = uniqueStrings((basis.relationshipReferences || []).map(({ relationshipId }) => relationshipId));
      relationshipIds.forEach((id) => {
        if (!relationshipsById.has(id)) throw projectionError(
          OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
          "DecisionSnapshot qualification references an unknown relationship",
        );
      });
      const supportingClaimIds = uniqueStrings(relationshipIds.flatMap((id) => relationshipsById.get(id).supportingClaimIds));
      return {
        assessmentId: basis.assessmentId,
        requirementId: basis.requirementId,
        basisType: basis.basisType,
        role: basis.role,
        rationaleCode: basis.rationaleCode,
        ...(basis.calculationReference
          ? { calculationId: matchCalculationId(basis.calculationReference, calculations) }
          : {}),
        relationshipIds,
        supportingClaimIds,
        evidenceReferences: evidenceForClaims(supportingClaimIds, claimsById),
      };
    });
    return {
      qualificationId: `qualification:${person.entityId}`,
      entityId: person.entityId,
      roles: uniqueStrings(person.roles),
      policyIdentity: {
        policyPackId: person.policyPackId,
        policyVersion: person.policyVersion,
        policyHash: person.policyHash,
      },
      bases,
    };
  });

  (content.decision.fallbackApplication?.roles || []).forEach((fallback) => {
    const existing = qualifications.find(({ entityId }) => entityId === fallback.personEntityId);
    const basis = {
      assessmentId: `fallback:${fallback.fallbackExhaustionDecisionId}:${fallback.personEntityId}`,
      requirementId: fallback.requirementId,
      basisType: "SENIOR_MANAGING_OFFICIAL_FALLBACK",
      role: fallback.role,
      rationaleCode: fallback.fallbackReason,
      fallbackExhaustionDecisionId: fallback.fallbackExhaustionDecisionId,
      measuresTakenAttemptIds: uniqueStrings(fallback.measuresTakenAttemptIds),
      relationshipIds: [],
      supportingClaimIds: [],
      evidenceReferences: [],
    };
    if (existing) {
      existing.roles = uniqueStrings([...existing.roles, fallback.role]);
      existing.bases = canonicalSort([...existing.bases, basis]);
    } else {
      qualifications.push({
        qualificationId: `qualification:${fallback.personEntityId}`,
        entityId: fallback.personEntityId,
        roles: [fallback.role],
        policyIdentity: cloneData(fallback.policyIdentity || content.policy.identity),
        bases: [basis],
      });
    }
  });

  return qualifications.sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function projectUnresolved(content, calculations, relationshipIds) {
  const needs = (content.decision.informationNeeds || [])
    .filter(({ state }) => state === undefined || state === "OPEN")
    .map((need) => {
      const relatedRelationshipIds = uniqueStrings([
        need.relationshipId,
        ...(need.claimIds || []).flatMap((claimId) => content.reasoning.graph.relationships
          .filter((relationship) => relationship.supportingClaimIds.includes(claimId))
          .map(({ relationshipId }) => relationshipId)),
      ]);
      relatedRelationshipIds.forEach((id) => {
        if (!relationshipIds.has(id)) throw projectionError(
          OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
          "DecisionSnapshot InformationNeed references an unknown relationship",
        );
      });
      return {
        unresolvedId: need.needId,
        kind: "INFORMATION_NEED",
        informationNeedId: need.needId,
        ...(need.subjectEntityId ? { entityId: need.subjectEntityId } : {}),
        concept: need.concept,
        state: need.state || "OPEN",
        requirementIds: uniqueStrings(need.requiredBy),
        reasonCodes: uniqueStrings(need.reasonCodes),
        relatedRelationshipIds,
        claimIds: uniqueStrings(need.claimIds),
        conflictReferences: uniqueStrings(need.conflictReferences),
        calculationReferences: canonicalSort(need.calculationReferences || []),
        existingEvidenceReferences: uniqueCanonical(need.existingEvidenceReferences || []),
      };
    });
  const paths = calculations.flatMap((calculation) => calculation.unresolvedPaths.map((path) => ({
    unresolvedId: `unresolved-path:${calculation.calculationId}:${path.pathId}`,
    kind: "CALCULATION_PATH",
    entityId: calculation.subjectEntityId,
    targetEntityId: calculation.targetEntityId,
    concept: `${calculation.dimension}_EFFECTIVE_INTEREST`,
    state: "OPEN",
    requirementIds: [],
    reasonCodes: uniqueStrings(path.reasons),
    relatedRelationshipIds: cloneData(path.relationshipIds),
    calculationId: calculation.calculationId,
    pathId: path.pathId,
  })));
  return [...needs, ...paths].sort((left, right) => left.unresolvedId.localeCompare(right.unresolvedId));
}

function projectConflicts(content, claimsById, relationships, resolvedPartyEntities) {
  const byId = new Map();
  const add = (conflictId, requirementIds, claimIds) => {
    const ids = uniqueStrings(claimIds);
    const claims = ids.map((id) => claimsById.get(id)).filter(Boolean);
    const relatedRelationshipIds = uniqueStrings(relationships
      .filter((relationship) => relationship.supportingClaimIds.some((id) => ids.includes(id)))
      .map(({ relationshipId }) => relationshipId));
    byId.set(conflictId, {
      conflictId,
      state: "UNRESOLVED",
      requirementIds: uniqueStrings(requirementIds),
      claimIds: ids,
      affectedEntityIds: uniqueStrings(claims.flatMap((claim) => claimEntityIds(claim, resolvedPartyEntities))),
      relatedRelationshipIds,
      evidenceReferences: uniqueCanonical(claims.flatMap(({ evidenceReferences }) => evidenceReferences || [])),
    });
  };
  (content.decision.requirementResolutions || []).forEach((resolution) => {
    (resolution.conflictReferences || []).forEach((reference) => {
      const existing = byId.get(reference);
      add(reference, [...(existing?.requirementIds || []), resolution.requirementId], [
        ...(existing?.claimIds || []),
        ...(claimsById.has(reference) ? [reference] : []),
      ]);
    });
  });
  for (const claim of claimsById.values()) {
    if (claim.status !== "DISPUTED") continue;
    const adjudications = (content.reasoning.claimAdjudications || []).filter(({ claimId }) => claimId === claim.claimId);
    const adversarial = adjudications.flatMap(({ adversarialClaimIds }) => adversarialClaimIds || []);
    if (!byId.has(claim.claimId)) add(claim.claimId, [], [claim.claimId, ...adversarial]);
  }
  return [...byId.values()].sort((left, right) => left.conflictId.localeCompare(right.conflictId));
}

function projectReviews(content, calculations) {
  const reviews = [];
  const resolutionByRecord = new Map((content.decision.requirementResolutions || [])
    .filter(({ requirementResolutionId }) => requirementResolutionId)
    .map((resolution) => [resolution.requirementResolutionId, resolution.requirementId]));
  (content.decision.reviewRequirements || []).forEach((review) => {
    reviews.push({
      reviewId: review.reviewRequirementId,
      reviewType: review.reviewType,
      state: review.state,
      reasonCode: review.reasonCode,
      requirementIds: uniqueStrings((review.relevantRequirementResolutionIds || []).map((id) => resolutionByRecord.get(id))),
      informationNeedIds: uniqueStrings(review.relevantInformationNeedIds),
      relationshipIds: uniqueStrings((review.graphAndCalculationReferences || []).flatMap(({ relationshipIds: ids }) => ids || [])),
      calculationIds: uniqueStrings((review.graphAndCalculationReferences || []).map((reference) => (
        reference.calculationAlgorithm ? matchCalculationId(reference, calculations) : undefined
      ))),
      evidenceReferences: uniqueCanonical(review.evidenceReferences || []),
      reviewDecisionIds: uniqueStrings((content.decision.reviewDecisions || [])
        .filter(({ reviewRequirementId }) => reviewRequirementId === review.reviewRequirementId)
        .map(({ decisionId }) => decisionId)),
    });
  });
  (content.decision.basisAssessments || []).filter(({ state }) => state === "REVIEW_REQUIRED").forEach((basis) => {
    reviews.push({
      reviewId: `basis-review:${basis.assessmentId}`,
      reviewType: "BASIS_ASSESSMENT",
      state: basis.state,
      reasonCode: basis.rationaleCode,
      requirementIds: [basis.requirementId],
      entityIds: uniqueStrings([basis.holderEntityId]),
      relationshipIds: uniqueStrings((basis.relationshipReferences || []).map(({ relationshipId }) => relationshipId)),
      calculationIds: uniqueStrings([basis.calculationReference
        ? matchCalculationId(basis.calculationReference, calculations) : undefined]),
      evidenceReferences: [],
      reviewDecisionIds: [],
    });
  });
  (content.decision.requirementResolutions || []).filter(({ requirementStatus }) => requirementStatus === "REVIEW_REQUIRED")
    .forEach((resolution) => {
      const references = resolution.reviewReferences?.length
        ? resolution.reviewReferences : [`requirement-review:${resolution.requirementId}`];
      references.forEach((reference) => reviews.push({
        reviewId: reference,
        reviewType: "REQUIREMENT",
        state: "REVIEW_REQUIRED",
        reasonCode: resolution.reasonCode,
        requirementIds: [resolution.requirementId],
        informationNeedIds: uniqueStrings(resolution.informationNeedIds),
        relationshipIds: uniqueStrings(resolution.graphReference?.relationshipIds),
        calculationIds: uniqueStrings((resolution.calculationReferences || []).map((item) => matchCalculationId(item, calculations))),
        evidenceReferences: uniqueCanonical(resolution.evidenceReferencesConsidered || []),
        reviewDecisionIds: [],
      }));
    });
  return uniqueCanonical(reviews).sort((left, right) => left.reviewId.localeCompare(right.reviewId));
}

function validateProjectionReferences({ entitiesById, relationships, calculations, qualifications, unresolved, conflicts, reviews }) {
  const relationshipIds = new Set(relationships.map(({ relationshipId }) => relationshipId));
  const calculationIds = new Set(calculations.map(({ calculationId: id }) => id));
  const requireEntity = (id) => {
    if (id && !entitiesById.has(id)) throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
      "DecisionSnapshot projection references an unknown canonical entity",
    );
  };
  relationships.forEach(({ sourceEntityId, targetEntityId }) => { requireEntity(sourceEntityId); requireEntity(targetEntityId); });
  calculations.forEach(({ subjectEntityId, targetEntityId }) => { requireEntity(subjectEntityId); requireEntity(targetEntityId); });
  qualifications.forEach((qualification) => {
    requireEntity(qualification.entityId);
    qualification.bases.forEach((basis) => {
      basis.relationshipIds.forEach((id) => { if (!relationshipIds.has(id)) throw projectionError(OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Qualification relationship reference is inconsistent"); });
      if (basis.calculationId && !calculationIds.has(basis.calculationId)) throw projectionError(OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Qualification calculation reference is inconsistent");
    });
  });
  unresolved.forEach(({ entityId }) => requireEntity(entityId));
  conflicts.flatMap(({ affectedEntityIds }) => affectedEntityIds).forEach(requireEntity);
  reviews.forEach((review) => {
    (review.entityIds || []).forEach(requireEntity);
    (review.relationshipIds || []).forEach((id) => {
      if (!relationshipIds.has(id)) throw projectionError(
        OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
        "Review relationship reference is inconsistent",
      );
    });
    (review.calculationIds || []).forEach((id) => {
      if (!calculationIds.has(id)) throw projectionError(
        OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
        "Review calculation reference is inconsistent",
      );
    });
  });
}

function projectOwnershipGraph(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw projectionError(OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "Projection input must be a data object");
  }
  const contractVersion = input.contractVersion || OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION;
  if (contractVersion !== OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION) {
    throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
      `contractVersion must be ${OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION}`,
    );
  }
  if (!input.decisionSnapshot || typeof input.decisionSnapshot !== "object" || Array.isArray(input.decisionSnapshot)) {
    throw projectionError(OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "A DecisionSnapshot is required");
  }
  if (input.decisionSnapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) {
    throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA,
      "DecisionSnapshot schema is not supported by this projection contract",
    );
  }
  try {
    verifyDecisionSnapshot(input.decisionSnapshot);
  } catch (error) {
    throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED,
      "DecisionSnapshot verification failed",
      error,
    );
  }

  const content = input.decisionSnapshot.decisionContent;
  try {
    const graph = content.reasoning.graph;
    const entities = canonicalSort(content.reasoning.canonicalEntities || []);
    const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
    const claimsById = new Map((content.reasoning.operativeClaims || []).map((claim) => [claim.claimId, claim]));
    const relationshipIds = new Set((graph.relationships || []).map(({ relationshipId }) => relationshipId));
    const calculations = projectCalculations(content, relationshipIds);
    const rawRelationshipsById = new Map((graph.relationships || []).map((relationship) => [relationship.relationshipId, relationship]));
    const qualifications = projectQualifications(content, calculations, rawRelationshipsById, claimsById);
    const unresolved = projectUnresolved(content, calculations, relationshipIds);
    const resolvedPartyEntities = latestResolvedEntityByParty(content);
    const conflicts = projectConflicts(content, claimsById, graph.relationships || [], resolvedPartyEntities);
    const reviews = projectReviews(content, calculations);
    const conflictRelationshipIds = new Set(conflicts.flatMap(({ relatedRelationshipIds }) => relatedRelationshipIds));
    const unresolvedRelationshipIds = new Set(unresolved.flatMap(({ relatedRelationshipIds }) => relatedRelationshipIds || []));
    const reviewRelationshipIds = new Set(reviews.flatMap(({ relationshipIds: ids }) => ids || []));

    const relationships = canonicalSort(graph.relationships || []).map((relationship) => {
      const evidenceReferences = evidenceForClaims(relationship.supportingClaimIds, claimsById);
      const indicators = uniqueStrings([
        conflictRelationshipIds.has(relationship.relationshipId) ? "CONFLICT" : undefined,
        unresolvedRelationshipIds.has(relationship.relationshipId) ? "UNRESOLVED" : undefined,
        reviewRelationshipIds.has(relationship.relationshipId) ? "REVIEW_REQUIRED" : undefined,
      ]);
      return {
        relationshipId: relationship.relationshipId,
        sourceEntityId: relationship.subjectEntityId,
        targetEntityId: relationship.objectEntityId,
        relationshipType: relationship.relationshipType,
        dimension: relationship.dimension,
        temporalState: relationship.temporalState,
        ...(relationship.measurement === undefined ? {} : { measurement: cloneData(relationship.measurement) }),
        ...(relationship.qualifiers === undefined ? {} : { qualifiers: cloneData(relationship.qualifiers) }),
        support: {
          claimCount: relationship.supportingClaimIds.length,
          claimIds: cloneData(relationship.supportingClaimIds),
          evidenceReferenceCount: evidenceReferences.length,
          evidenceReferences,
        },
        indicators,
      };
    }).sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));

    const subjectEntityId = content.reasoning.caseContext?.subjectEntityId;
    const subjectEntity = entitiesById.get(subjectEntityId);
    if (!subjectEntity) throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
      "DecisionSnapshot does not identify a canonical regulated subject",
    );
    const qualificationByEntity = new Map(qualifications.map((item) => [item.entityId, item]));
    const unresolvedEntities = new Set(unresolved.map(({ entityId }) => entityId).filter(Boolean));
    const conflictEntities = new Set(conflicts.flatMap(({ affectedEntityIds }) => affectedEntityIds));
    const reviewEntities = new Set(reviews.flatMap(({ entityIds }) => entityIds || []));
    const incomingEntities = new Set(relationships.map(({ targetEntityId }) => targetEntityId));
    const nodes = entities.map((entity) => {
      const qualification = qualificationByEntity.get(entity.entityId);
      const specialStructure = entity.category === "TRUST_OR_LEGAL_ARRANGEMENT";
      const semantics = uniqueStrings([
        entity.entityId === subjectEntityId ? NODE_SEMANTIC.SUBJECT : undefined,
        qualification ? NODE_SEMANTIC.QUALIFYING_PERSON : undefined,
        unresolvedEntities.has(entity.entityId) ? NODE_SEMANTIC.UNRESOLVED_ENTITY : undefined,
        specialStructure ? NODE_SEMANTIC.SPECIAL_STRUCTURE : undefined,
        reviewEntities.has(entity.entityId) ? NODE_SEMANTIC.REVIEW_REQUIRED : undefined,
        conflictEntities.has(entity.entityId) ? NODE_SEMANTIC.CONFLICT : undefined,
        entity.entityId !== subjectEntityId && !incomingEntities.has(entity.entityId) ? NODE_SEMANTIC.STRUCTURAL_TERMINUS : undefined,
      ]);
      return {
        entityId: entity.entityId,
        displayName: entity.primaryName || entity.entityId,
        category: entity.category,
        ...(entity.jurisdiction ? { jurisdiction: entity.jurisdiction } : {}),
        externalIdentifiers: canonicalSort(entity.externalIdentifiers || []),
        entityTypeMetadata: cloneData(entity.entityTypeMetadata || {}),
        qualifyingRoles: qualification ? cloneData(qualification.roles) : [],
        semantics,
      };
    }).sort((left, right) => left.entityId.localeCompare(right.entityId));

    validateProjectionReferences({ entitiesById, relationships, calculations, qualifications, unresolved, conflicts, reviews });
    const subject = nodes.find(({ entityId }) => entityId === subjectEntityId);
    const projection = {
      contractVersion: OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
      decision: {
        snapshotId: input.decisionSnapshot.snapshotId,
        snapshotHash: input.decisionSnapshot.decisionContentHash,
        checkpoint: cloneData(content.checkpoint),
        evaluationTime: content.checkpoint.evaluationTime,
        graphVersion: graph.graphVersion,
        graphAlgorithm: graph.graphAlgorithm,
        policyIdentity: cloneData(content.policy.identity),
        orchestrationState: content.decision.terminal.orchestrationState,
        terminalOutcome: content.decision.terminal.terminalOutcome || null,
        customerProjection: cloneData(content.decision.customerProjection),
        history: cloneData(content.history),
      },
      subject: {
        entityId: subject.entityId,
        displayName: subject.displayName,
        category: subject.category,
        ...(subject.jurisdiction ? { jurisdiction: subject.jurisdiction } : {}),
        externalIdentifiers: cloneData(subject.externalIdentifiers),
        entityTypeMetadata: cloneData(subject.entityTypeMetadata),
      },
      nodes,
      relationships,
      calculations,
      qualifications,
      unresolved,
      conflicts,
      reviews,
      limitations: [],
      summary: {
        totalEntities: nodes.length,
        totalRelationships: relationships.length,
        qualifyingPeople: qualifications.length,
        unresolvedBranches: unresolved.length,
        conflicts: conflicts.length,
        reviewRequirements: reviews.length,
        economicPaths: calculations.filter(({ dimension }) => dimension === "ECONOMIC")
          .reduce((count, calculation) => count + calculation.paths.length + calculation.unresolvedPaths.length, 0),
        votingPaths: calculations.filter(({ dimension }) => dimension === "VOTING")
          .reduce((count, calculation) => count + calculation.paths.length + calculation.unresolvedPaths.length, 0),
      },
    };
    return deepFreeze(projection);
  } catch (error) {
    if (error instanceof OwnershipGraphProjectionError) throw error;
    throw projectionError(
      OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
      "DecisionSnapshot could not be projected consistently",
      error,
    );
  }
}

module.exports = {
  OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
  projectOwnershipGraph,
};
