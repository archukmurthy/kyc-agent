"use strict";

const { createHash } = require("node:crypto");
const { assertDataOnly, cloneData, deepFreeze } = require("./validation");
const { canonicalizeJson } = require("../policy/canonicalJson");

const PHASE_STATUS = "COMPLETE";

function hashArtifact(value) {
  assertDataOnly(value, "artifact");
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}

function createPhaseArtifact({ sequence, phaseId, algorithmVersion, inputArtifacts, output, evaluationTime, requiredSignoffIds = [], marker }) {
  const normalizedOutput = cloneData(output);
  const artifact = {
    sequence,
    phaseId,
    algorithmVersion,
    inputArtifacts: cloneData(inputArtifacts),
    outputArtifactId: `${phaseId.toLowerCase()}:${hashArtifact(normalizedOutput).slice(7, 39)}`,
    outputHash: hashArtifact(normalizedOutput),
    status: PHASE_STATUS,
    requiredSignoffIds: [...new Set(requiredSignoffIds)].sort(),
    marker,
    evaluationTime,
    output: normalizedOutput,
  };
  assertDataOnly(artifact, "phaseArtifact");
  return deepFreeze(artifact);
}

module.exports = { PHASE_STATUS, createPhaseArtifact, hashArtifact };
