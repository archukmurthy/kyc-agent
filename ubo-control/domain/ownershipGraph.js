"use strict";

const { createHash } = require("node:crypto");
const {
  CANDIDATE_FACT_TYPE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { UboContractError } = require("../errors");
const { cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  GRAPH_ELIGIBILITY_STATUS,
  graphEligibilityForClaim,
  validateOwnershipCase,
} = require("./ownershipCase");
const {
  add,
  compare,
  decimalNumberToRational,
  HUNDRED,
} = require("./exactPercentage");

const GRAPH_ALGORITHM = "ubo-graph-v1";

const GRAPH_DIMENSION = Object.freeze({
  ECONOMIC: "ECONOMIC",
  VOTING: "VOTING",
});

const TEMPORAL_STATE = Object.freeze({
  CURRENT: "CURRENT",
  CEASED: "CEASED",
  UNKNOWN: "UNKNOWN",
});

const GRAPH_ERROR_CODE = Object.freeze({
  CONFLICTING_OPERATIVE_CLAIMS: "CONFLICTING_OPERATIVE_CLAIMS",
  CONTRADICTORY_TEMPORAL_STATE: "CONTRADICTORY_TEMPORAL_STATE",
  IMPOSSIBLE_MINIMUM_TOTAL: "IMPOSSIBLE_MINIMUM_TOTAL",
});

class OwnershipGraphDomainError extends UboContractError {
  constructor(message, { code, details }) {
    super(message, { code });
    this.details = deepFreeze(cloneData(details));
  }
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function dimensionForRelationship(relationshipType) {
  if (relationshipType === RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP) return GRAPH_DIMENSION.ECONOMIC;
  if (relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS) return GRAPH_DIMENSION.VOTING;
  return null;
}

function temporalStateForClaim(claim) {
  const qualifiers = claim.qualifiers || {};
  const assertions = new Set();
  const currentState = typeof qualifiers.currentState === "string"
    ? qualifiers.currentState.trim().toUpperCase()
    : undefined;

  if (["CURRENT", "ACTIVE"].includes(currentState)) assertions.add(TEMPORAL_STATE.CURRENT);
  if (["CEASED", "HISTORICAL"].includes(currentState)) assertions.add(TEMPORAL_STATE.CEASED);
  if (qualifiers.isCurrent === true) assertions.add(TEMPORAL_STATE.CURRENT);
  if (qualifiers.isCurrent === false) assertions.add(TEMPORAL_STATE.CEASED);
  if (qualifiers.ceased === true || qualifiers.historical === true) assertions.add(TEMPORAL_STATE.CEASED);
  if (typeof qualifiers.ceasedAt === "string" && qualifiers.ceasedAt.trim() !== "") {
    assertions.add(TEMPORAL_STATE.CEASED);
  }

  if (assertions.size > 1) {
    throw new OwnershipGraphDomainError(
      `operative claim ${claim.claimId} has contradictory current and ceased qualifiers`,
      {
        code: GRAPH_ERROR_CODE.CONTRADICTORY_TEMPORAL_STATE,
        details: { claimId: claim.claimId },
      },
    );
  }
  return assertions.size === 1 ? [...assertions][0] : TEMPORAL_STATE.UNKNOWN;
}

function slotIdentity(candidate) {
  return {
    subjectEntityId: candidate.subjectEntityId,
    objectEntityId: candidate.objectEntityId,
    relationshipType: candidate.relationshipType,
    qualifiers: candidate.qualifiers,
  };
}

function relationshipIdentity(candidate) {
  return {
    ...slotIdentity(candidate),
    measurement: candidate.measurement === undefined ? null : candidate.measurement,
    temporalState: candidate.temporalState,
  };
}

function coalesceGraphRelationships(candidates) {
  const groups = new Map();
  candidates.forEach((candidate) => {
    const key = canonicalizeJson(slotIdentity(candidate));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  });

  const relationships = [];
  for (const group of groups.values()) {
    const variants = new Map();
    group.forEach((candidate) => {
      const key = canonicalizeJson({
        measurement: candidate.measurement === undefined ? null : candidate.measurement,
        temporalState: candidate.temporalState,
      });
      if (!variants.has(key)) variants.set(key, []);
      variants.get(key).push(candidate);
    });
    if (variants.size > 1) {
      const claimIds = group.map(({ claimId }) => claimId).sort();
      throw new OwnershipGraphDomainError(
        `operative claims ${claimIds.join(", ")} assert incompatible values for one relationship slot`,
        {
          code: GRAPH_ERROR_CODE.CONFLICTING_OPERATIVE_CLAIMS,
          details: { claimIds, relationshipSlot: slotIdentity(group[0]) },
        },
      );
    }

    const representative = group[0];
    const supportingClaimIds = group.map(({ claimId }) => claimId).sort();
    const identity = relationshipIdentity(representative);
    const relationship = {
      relationshipId: `graph-rel-${hashCanonical(identity).slice(0, 24)}`,
      subjectEntityId: representative.subjectEntityId,
      objectEntityId: representative.objectEntityId,
      relationshipType: representative.relationshipType,
      dimension: representative.dimension,
      temporalState: representative.temporalState,
      supportingClaimIds,
    };
    if (representative.measurement !== undefined) relationship.measurement = cloneData(representative.measurement);
    if (Object.keys(representative.qualifiers).length > 0) relationship.qualifiers = cloneData(representative.qualifiers);
    relationships.push(relationship);
  }
  return relationships.sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
}

function minimumForMeasurement(measurement) {
  if (measurement === undefined || measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    return decimalNumberToRational(0);
  }
  return decimalNumberToRational(
    measurement.type === PERCENTAGE_VALUE_TYPE.EXACT ? measurement.value : measurement.lowerBound,
  );
}

function assertMinimumTotals(relationships) {
  const totals = new Map();
  relationships
    .filter(({ dimension, temporalState }) => dimension !== null && temporalState === TEMPORAL_STATE.CURRENT)
    .forEach((relationship) => {
      const key = `${relationship.dimension}|${relationship.objectEntityId}`;
      const previous = totals.get(key) || decimalNumberToRational(0);
      totals.set(key, add(previous, minimumForMeasurement(relationship.measurement)));
    });
  for (const [key, total] of totals.entries()) {
    if (compare(total, HUNDRED) > 0) {
      const [dimension, objectEntityId] = key.split("|");
      const relationshipIds = relationships
        .filter((relationship) => relationship.dimension === dimension
          && relationship.objectEntityId === objectEntityId
          && relationship.temporalState === TEMPORAL_STATE.CURRENT)
        .map(({ relationshipId }) => relationshipId)
        .sort();
      throw new OwnershipGraphDomainError(
        `minimum ${dimension.toLowerCase()} interests into ${objectEntityId} exceed 100%`,
        {
          code: GRAPH_ERROR_CODE.IMPOSSIBLE_MINIMUM_TOTAL,
          details: { dimension, objectEntityId, relationshipIds },
        },
      );
    }
  }
}

function buildCanonicalOwnershipGraph(caseState) {
  validateOwnershipCase(caseState);
  const candidates = caseState.candidateClaims
    .filter(({ claimType }) => claimType === CANDIDATE_FACT_TYPE.RELATIONSHIP)
    .map((claim) => ({ claim, eligibility: graphEligibilityForClaim(caseState, claim.claimId) }))
    .filter(({ eligibility }) => eligibility.status === GRAPH_ELIGIBILITY_STATUS.GRAPH_ELIGIBLE)
    .map(({ claim, eligibility }) => ({
      claimId: claim.claimId,
      subjectEntityId: eligibility.subjectEntityId,
      objectEntityId: eligibility.objectEntityId,
      relationshipType: claim.relationship,
      dimension: dimensionForRelationship(claim.relationship),
      measurement: claim.measurement === undefined ? undefined : cloneData(claim.measurement),
      qualifiers: cloneData(claim.qualifiers || {}),
      temporalState: temporalStateForClaim(claim),
    }));

  const relationships = coalesceGraphRelationships(candidates);
  assertMinimumTotals(relationships);
  const nodes = caseState.canonicalEntities
    .map(({ entityId, category }) => ({ entityId, category }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const identity = {
    algorithm: GRAPH_ALGORITHM,
    sourceCase: {
      caseId: caseState.caseId,
      revision: caseState.revision,
      revisionId: caseState.revisionId,
    },
    nodes,
    relationships,
  };
  const graph = {
    graphAlgorithm: GRAPH_ALGORITHM,
    graphVersion: `${GRAPH_ALGORITHM}:${hashCanonical(identity)}`,
    sourceCase: identity.sourceCase,
    nodes,
    relationships,
  };
  return deepFreeze(graph);
}

module.exports = {
  GRAPH_ALGORITHM,
  GRAPH_DIMENSION,
  GRAPH_ERROR_CODE,
  OwnershipGraphDomainError,
  TEMPORAL_STATE,
  buildCanonicalOwnershipGraph,
  dimensionForRelationship,
};
