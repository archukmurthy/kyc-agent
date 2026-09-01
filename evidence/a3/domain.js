"use strict";

const { validateEvidenceGraph } = require("../a1/domain");

const SUPPORT_STATES = Object.freeze(["supported", "supported_with_qualification", "needs_verification", "not_supported"]);
const REQUEST_STATUSES = Object.freeze(["requested", "discovered"]);
const GROUNDING_TYPES = Object.freeze(["direct", "derived"]);
const VERIFICATION_OUTCOMES = Object.freeze(["agreement", "disagreement", "inconclusive"]);

function byId(items, label) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) throw new Error(`${label} requires an id`);
    if (map.has(item.id)) throw new Error(`${label} contains duplicate id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

function required(map, id, label) {
  const item = map.get(id);
  if (!item) throw new Error(`${label} references missing id ${id}`);
  return item;
}

function validateA3Bundle(bundle) {
  validateEvidenceGraph(bundle?.baseGraph);
  for (const name of ["runArtifacts", "facts", "derivations", "verifications"]) {
    if (!Array.isArray(bundle[name])) throw new Error(`bundle.${name} must be an array`);
  }
  const factArtifactSupports = bundle.factArtifactSupports === undefined ? [] : bundle.factArtifactSupports;
  if (!Array.isArray(factArtifactSupports)) throw new Error("bundle.factArtifactSupports must be an array");
  const factArtifactLocators = bundle.factArtifactLocators === undefined ? [] : bundle.factArtifactLocators;
  if (!Array.isArray(factArtifactLocators)) throw new Error("bundle.factArtifactLocators must be an array");
  const runs = byId(bundle.baseGraph.extractionRuns, "extractionRuns");
  const artifacts = byId(bundle.baseGraph.artifacts, "artifacts");
  const facts = byId(bundle.facts, "facts");
  const needs = byId(bundle.baseGraph.informationNeeds, "informationNeeds");
  for (const run of runs.values()) {
    if (run.executionMode && !["deterministic", "ai"].includes(run.executionMode)) throw new Error(`run ${run.id} has unsupported execution mode`);
    if (run.executionMode === "ai" && !run.provider) throw new Error(`AI run ${run.id} requires provider lineage`);
    if (run.status === "failed" && !run.errorMessage) throw new Error(`failed run ${run.id} requires errorMessage`);
  }
  for (const input of bundle.runArtifacts) {
    required(runs, input.extractionRunId, "runArtifact.extractionRunId");
    required(artifacts, input.artifactId, "runArtifact.artifactId");
    if (!input.inputRole) throw new Error("runArtifact.inputRole is required");
  }
  for (const fact of facts.values()) {
    const run = required(runs, fact.extractionRunId, "fact.extractionRunId");
    const artifact = required(artifacts, fact.artifactId, "fact.artifactId");
    if (run.artifactId !== artifact.id && !bundle.runArtifacts.some((i) => i.extractionRunId === run.id && i.artifactId === artifact.id)) throw new Error(`fact ${fact.id} is not grounded in an input Artifact`);
    if (!REQUEST_STATUSES.includes(fact.requestStatus)) throw new Error(`fact ${fact.id} has invalid request status`);
    if (!GROUNDING_TYPES.includes(fact.groundingType)) throw new Error(`fact ${fact.id} has invalid grounding type`);
    if (!SUPPORT_STATES.includes(fact.supportState)) throw new Error(`fact ${fact.id} has invalid support state`);
    if (!fact.semanticConceptId) throw new Error(`fact ${fact.id} requires semanticConceptId`);
    if (!fact.supportSignals || typeof fact.supportSignals !== "object") throw new Error(`fact ${fact.id} requires explainable support signals`);
    if (fact.requestStatus === "requested") {
      if (!fact.schemaFieldId && !fact.informationNeedId) throw new Error(`requested fact ${fact.id} requires supplied schema lineage`);
      if (fact.informationNeedId) required(needs, fact.informationNeedId, "fact.informationNeedId");
    } else if (fact.schemaFieldId || fact.informationNeedId) throw new Error(`discovered fact ${fact.id} must not fabricate schema lineage`);
  }
  const supportKeys = new Set();
  for (const support of factArtifactSupports) {
    const fact = required(facts, support.factId, "factArtifactSupport.factId");
    required(artifacts, support.artifactId, "factArtifactSupport.artifactId");
    if (!bundle.runArtifacts.some((input) => input.extractionRunId === fact.extractionRunId && input.artifactId === support.artifactId)) throw new Error(`fact support ${fact.id}/${support.artifactId} does not reference an input Artifact`);
    const key = `${support.factId}:${support.artifactId}`;
    if (supportKeys.has(key)) throw new Error(`duplicate fact Artifact support ${key}`);
    supportKeys.add(key);
  }
  const locatorKeys = new Set();
  for (const locator of factArtifactLocators) {
    required(facts, locator.factId, "factArtifactLocator.factId");
    required(artifacts, locator.artifactId, "factArtifactLocator.artifactId");
    if (!supportKeys.has(`${locator.factId}:${locator.artifactId}`)) throw new Error(`locator ${locator.id} requires an existing Fact-to-Artifact support pair`);
    if (!locator.id || !["json", "html", "pdf", "image"].includes(locator.locatorKind)) throw new Error("locator requires id and supported kind");
    if (!Number.isInteger(locator.locatorOrdinal) || locator.locatorOrdinal < 1) throw new Error(`locator ${locator.id} requires a positive ordinal`);
    if (!locator.supportExcerpt && !locator.supportDescription) throw new Error(`locator ${locator.id} requires source support`);
    if (locator.locatorKind === "pdf" && (!Number.isInteger(locator.pageStart) || !Number.isInteger(locator.pageEnd) || locator.pageStart < 1 || locator.pageEnd < locator.pageStart)) throw new Error(`PDF locator ${locator.id} requires a valid page range`);
    const key = `${locator.factId}:${locator.artifactId}:${locator.locatorOrdinal}`;
    if (locatorKeys.has(key)) throw new Error(`duplicate Fact locator ${key}`);
    locatorKeys.add(key);
  }
  const derivedIds = new Set(bundle.derivations.map((item) => item.derivedFactId));
  for (const link of bundle.derivations) {
    const derived = required(facts, link.derivedFactId, "derivation.derivedFactId");
    required(facts, link.inputFactId, "derivation.inputFactId");
    if (derived.groundingType !== "derived") throw new Error(`derivation target ${derived.id} is not derived`);
    if (!link.transformationId || !link.derivedAt) throw new Error("derivation requires transformation and time");
  }
  for (const fact of facts.values()) {
    if (fact.groundingType === "derived" && !derivedIds.has(fact.id)) throw new Error(`derived fact ${fact.id} requires input lineage`);
    if (fact.groundingType === "direct" && derivedIds.has(fact.id)) throw new Error(`direct fact ${fact.id} cannot be a derivation target`);
  }
  for (const attempt of bundle.verifications) {
    required(runs, attempt.targetExtractionRunId, "verification.targetExtractionRunId");
    required(runs, attempt.verificationExtractionRunId, "verification.verificationExtractionRunId");
    if (attempt.targetExtractionRunId === attempt.verificationExtractionRunId) throw new Error("verification must use an independent run");
    if (attempt.targetFactId) required(facts, attempt.targetFactId, "verification.targetFactId");
    if (!VERIFICATION_OUTCOMES.includes(attempt.outcome)) throw new Error(`verification ${attempt.id} has invalid outcome`);
  }
  return bundle;
}

module.exports = { GROUNDING_TYPES, REQUEST_STATUSES, SUPPORT_STATES, VERIFICATION_OUTCOMES, validateA3Bundle };
