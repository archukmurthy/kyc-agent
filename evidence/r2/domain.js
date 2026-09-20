"use strict";

const { createHash, randomUUID } = require("node:crypto");

const LIMITS = Object.freeze({ artifacts: 20, concepts: 20, text: 256, description: 1000, references: 20 });
const EXTRACTION_CONTEXT_KEYS = Object.freeze(["jurisdiction", "language", "schemaReference", "schemaVersionReference", "purpose", "tenantConfigVersion"]);

function r2Error(code, message, statusCode = 400, details = {}) { return Object.assign(new Error(message), { code, statusCode, details }); }
function boundedString(value, name, max = LIMITS.text, required = false) {
  if (value == null || value === "") { if (required) throw r2Error("invalid_request", `${name} is required`); return null; }
  if (typeof value !== "string" || !value.trim() || value.length > max) throw r2Error("invalid_request", `${name} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }

function validateConcepts(input) {
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.concepts) throw r2Error("invalid_request", `requestedConcepts must contain 1-${LIMITS.concepts} concepts`);
  const concepts = input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw r2Error("invalid_request", `requestedConcepts[${index}] must be an object`);
    const unknown = Object.keys(item).filter((key) => !["concept", "description", "schemaFieldId", "informationNeedId"].includes(key));
    if (unknown.length) throw r2Error("invalid_request", `requestedConcepts[${index}] contains unsupported fields`);
    const concept = boundedString(item.concept, `requestedConcepts[${index}].concept`, LIMITS.text, true);
    const description = boundedString(item.description, `requestedConcepts[${index}].description`, LIMITS.description, false);
    const schemaFieldId = boundedString(item.schemaFieldId, `requestedConcepts[${index}].schemaFieldId`, LIMITS.text, false);
    const informationNeedId = boundedString(item.informationNeedId, `requestedConcepts[${index}].informationNeedId`, 36, false);
    if (informationNeedId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(informationNeedId)) throw r2Error("invalid_request", "informationNeedId must be a UUID");
    return { concept, description, schemaFieldId, informationNeedId };
  });
  if (new Set(concepts.map((item) => item.concept.toLowerCase())).size !== concepts.length) throw r2Error("invalid_request", "requestedConcepts must be unique");
  return concepts;
}

function validateExtractionContext(input = {}) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw r2Error("invalid_request", "extractionContext must be an object");
  const unknown = Object.keys(input).filter((key) => !EXTRACTION_CONTEXT_KEYS.includes(key));
  if (unknown.length) throw r2Error("invalid_request", `extractionContext contains unsupported fields: ${unknown.join(", ")}`);
  return Object.fromEntries(EXTRACTION_CONTEXT_KEYS.map((key) => [key, boundedString(input[key], `extractionContext.${key}`, LIMITS.description, false)]).filter(([, value]) => value !== null));
}

function validateCorrelation(input = {}) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw r2Error("invalid_request", "correlation must be an object");
  const unknown = Object.keys(input).filter((key) => !["requestId", "externalReferences"].includes(key));
  if (unknown.length) throw r2Error("invalid_request", "correlation contains unsupported fields");
  const requestId = boundedString(input.requestId, "correlation.requestId", LIMITS.text, false);
  const refs = input.externalReferences == null ? [] : input.externalReferences;
  if (!Array.isArray(refs) || refs.length > LIMITS.references) throw r2Error("invalid_request", `correlation.externalReferences must contain at most ${LIMITS.references} entries`);
  return { ...(requestId ? { requestId } : {}), ...(refs.length ? { externalReferences: refs.map((item, index) => ({ system: boundedString(item?.system, `correlation.externalReferences[${index}].system`, LIMITS.text, true), type: boundedString(item?.type, `correlation.externalReferences[${index}].type`, LIMITS.text, true), id: boundedString(item?.id, `correlation.externalReferences[${index}].id`, LIMITS.text, true) })) } : {}) };
}

function validateAuthorization(input) {
  if (!input || typeof input !== "object") throw r2Error("access_denied", "Trusted Evidence authorization is required", 403);
  return {
    tenantId: boundedString(input.tenantId, "authorization.tenantId", LIMITS.text, true),
    contextId: boundedString(input.contextId, "authorization.contextId", 36, true),
    callerScope: boundedString(input.callerScope, "authorization.callerScope", LIMITS.text, true),
    actorType: boundedString(input.actorType, "authorization.actorType", LIMITS.text, true),
    actorId: boundedString(input.actorId, "authorization.actorId", LIMITS.text, false),
  };
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw r2Error("invalid_request", "R2 request body is required");
  const operationKey = boundedString(input.operationKey, "operationKey", LIMITS.text, true);
  if (!Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > LIMITS.artifacts) throw r2Error("invalid_request", `artifactIds must contain 1-${LIMITS.artifacts} IDs`);
  const artifactIds = [...new Set(input.artifactIds.map((value, index) => boundedString(value, `artifactIds[${index}]`, 36, true)))];
  return { operationKey, artifactIds, requestedConcepts: validateConcepts(input.requestedConcepts), extractionContext: validateExtractionContext(input.extractionContext), correlation: validateCorrelation(input.correlation) };
}

module.exports = { EXTRACTION_CONTEXT_KEYS, LIMITS, boundedString, canonical, fingerprint, r2Error, randomUUID, validateAuthorization, validateConcepts, validateCorrelation, validateExtractionContext, validateRequest };
