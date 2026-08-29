"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  addIntervals,
  capPercentageInterval,
  exactInterval,
  HUNDRED,
  intervalFromPercentageValue,
  intervalToCalculatedValue,
  multiplyPercentageIntervals,
} = require("./exactPercentage");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("./ownershipGraph");

const CALCULATION_ALGORITHM = "ubo-percentage-lookthrough-v1";

const CALCULATION_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  UNRESOLVED: "UNRESOLVED",
  NO_PATH: "NO_PATH",
});

const UNRESOLVED_REASON = Object.freeze({
  UNKNOWN_PERCENTAGE: "UNKNOWN_PERCENTAGE",
  UNKNOWN_TEMPORAL_STATE: "UNKNOWN_TEMPORAL_STATE",
});

function hashCanonical(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function assertCalculationInput(graph, subjectEntityId, targetEntityId, dimension) {
  if (!graph || typeof graph !== "object" || typeof graph.graphVersion !== "string") {
    fail("percentage calculation requires a canonical graph");
  }
  if (!graph.nodes.some((node) => node.entityId === subjectEntityId)) {
    fail(`percentage calculation subject ${subjectEntityId} is not a graph node`);
  }
  if (!graph.nodes.some((node) => node.entityId === targetEntityId)) {
    fail(`percentage calculation target ${targetEntityId} is not a graph node`);
  }
  if (!Object.values(GRAPH_DIMENSION).includes(dimension)) {
    fail(`percentage calculation dimension must be one of: ${Object.values(GRAPH_DIMENSION).join(", ")}`);
  }
}

function reverseReachable(targetEntityId, relationships) {
  const incoming = new Map();
  relationships.forEach((relationship) => {
    if (!incoming.has(relationship.objectEntityId)) incoming.set(relationship.objectEntityId, []);
    incoming.get(relationship.objectEntityId).push(relationship.subjectEntityId);
  });
  const reachable = new Set([targetEntityId]);
  const queue = [targetEntityId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const predecessor of incoming.get(current) || []) {
      if (!reachable.has(predecessor)) {
        reachable.add(predecessor);
        queue.push(predecessor);
      }
    }
  }
  return reachable;
}

function pathIdentity(relationshipIds) {
  return `calc-path-${hashCanonical(relationshipIds).slice(0, 24)}`;
}

function cycleIdentity(relationshipIds) {
  return `calc-cycle-${hashCanonical([...relationshipIds].sort()).slice(0, 24)}`;
}

function enumerateRelevantPaths(graph, subjectEntityId, targetEntityId, dimension) {
  const relationships = graph.relationships
    .filter((relationship) => relationship.dimension === dimension
      && relationship.temporalState !== TEMPORAL_STATE.CEASED)
    .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
  const reachable = reverseReachable(targetEntityId, relationships);
  if (!reachable.has(subjectEntityId)) return { paths: [], cycles: [] };

  const outgoing = new Map();
  relationships.forEach((relationship) => {
    if (!outgoing.has(relationship.subjectEntityId)) outgoing.set(relationship.subjectEntityId, []);
    outgoing.get(relationship.subjectEntityId).push(relationship);
  });
  const paths = [];
  const cycles = new Map();

  function visit(entityId, visitedNodes, pathRelationships) {
    if (entityId === targetEntityId && pathRelationships.length > 0) {
      const relationshipIds = pathRelationships.map(({ relationshipId }) => relationshipId);
      paths.push({ pathId: pathIdentity(relationshipIds), relationships: pathRelationships });
      return;
    }
    for (const relationship of outgoing.get(entityId) || []) {
      if (!reachable.has(relationship.objectEntityId)) continue;
      if (visitedNodes.has(relationship.objectEntityId)) {
        const relationshipIds = [...pathRelationships, relationship].map(({ relationshipId }) => relationshipId);
        const cycleId = cycleIdentity(relationshipIds);
        if (!cycles.has(cycleId)) {
          cycles.set(cycleId, {
            cycleId,
            relationshipIds: [...new Set(relationshipIds)].sort(),
            repeatedEntityId: relationship.objectEntityId,
          });
        }
        continue;
      }
      visit(
        relationship.objectEntityId,
        new Set([...visitedNodes, relationship.objectEntityId]),
        [...pathRelationships, relationship],
      );
    }
  }

  visit(subjectEntityId, new Set([subjectEntityId]), []);
  return {
    paths: paths.sort((left, right) => left.pathId.localeCompare(right.pathId)),
    cycles: [...cycles.values()].sort((left, right) => left.cycleId.localeCompare(right.cycleId)),
  };
}

function calculatePath(path) {
  let contribution = exactInterval(HUNDRED);
  const reasons = new Set();
  path.relationships.forEach((relationship) => {
    if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) {
      reasons.add(UNRESOLVED_REASON.UNKNOWN_TEMPORAL_STATE);
    }
    if (relationship.measurement === undefined
      || relationship.measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
      reasons.add(UNRESOLVED_REASON.UNKNOWN_PERCENTAGE);
      return;
    }
    contribution = multiplyPercentageIntervals(
      contribution,
      intervalFromPercentageValue(relationship.measurement),
    );
  });
  const relationshipIds = path.relationships.map(({ relationshipId }) => relationshipId);
  if (reasons.size > 0) {
    return {
      unresolved: {
        pathId: path.pathId,
        relationshipIds,
        reasons: [...reasons].sort(),
      },
    };
  }
  return {
    known: {
      pathId: path.pathId,
      relationshipIds,
      contribution: intervalToCalculatedValue(contribution),
      interval: contribution,
    },
  };
}

function aggregateKnownPaths(knownPaths) {
  if (knownPaths.length === 0) return undefined;
  let aggregate = knownPaths[0].interval;
  for (let index = 1; index < knownPaths.length; index += 1) {
    aggregate = addIntervals(aggregate, knownPaths[index].interval);
  }
  return intervalToCalculatedValue(capPercentageInterval(aggregate));
}

function calculateEffectivePercentage(graph, {
  subjectEntityId,
  targetEntityId,
  dimension,
}) {
  assertCalculationInput(graph, subjectEntityId, targetEntityId, dimension);
  const { paths, cycles } = enumerateRelevantPaths(graph, subjectEntityId, targetEntityId, dimension);
  const knownPaths = [];
  const unresolvedPaths = [];
  paths.forEach((path) => {
    const result = calculatePath(path);
    if (result.known) knownPaths.push(result.known);
    if (result.unresolved) unresolvedPaths.push(result.unresolved);
  });
  knownPaths.sort((left, right) => left.pathId.localeCompare(right.pathId));
  unresolvedPaths.sort((left, right) => left.pathId.localeCompare(right.pathId));

  let status;
  if (paths.length === 0 && cycles.length === 0) status = CALCULATION_STATUS.NO_PATH;
  else if (unresolvedPaths.length === 0 && cycles.length === 0) status = CALCULATION_STATUS.COMPLETE;
  else if (knownPaths.length > 0) status = CALCULATION_STATUS.PARTIAL;
  else status = CALCULATION_STATUS.UNRESOLVED;

  const result = {
    calculationAlgorithm: CALCULATION_ALGORITHM,
    graphVersion: graph.graphVersion,
    subjectEntityId,
    targetEntityId,
    dimension,
    status,
    knownPaths: knownPaths.map(({ interval, ...path }) => cloneData(path)),
    unresolvedPaths: cloneData(unresolvedPaths),
    cycles: cloneData(cycles),
  };
  const aggregateValue = aggregateKnownPaths(knownPaths);
  if (aggregateValue !== undefined) result.aggregateKnownValue = aggregateValue;
  return deepFreeze(result);
}

module.exports = {
  CALCULATION_ALGORITHM,
  CALCULATION_STATUS,
  UNRESOLVED_REASON,
  calculateEffectivePercentage,
};
