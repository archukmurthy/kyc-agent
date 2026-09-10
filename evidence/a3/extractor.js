"use strict";

const { assessFactLocators } = require("./locators");
const { validateTypedRelationshipCandidate } = require("../r4/domain");

function supportState(signals) {
  if (signals.readability === "unreadable" || signals.grounded === false) return "not_supported";
  if (signals.multiplePlausibleValues || signals.readability === "degraded") return "needs_verification";
  if (signals.semanticMappingAmbiguity || signals.grounding === "derived") return "supported_with_qualification";
  return "supported";
}

function postgresSafeString(value) {
  const text = String(value); let normalized = ""; let changed = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) { normalized += "\uFFFD"; changed = true; continue; }
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { normalized += text[index] + text[index + 1]; index += 1; continue; }
      normalized += "\uFFFD"; changed = true; continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) { normalized += "\uFFFD"; changed = true; continue; }
    normalized += text[index];
  }
  return { value: normalized, changed };
}

function postgresSafeJson(value) {
  if (typeof value === "string") return postgresSafeString(value);
  if (Array.isArray(value)) {
    let changed = false; const normalized = value.map((item) => { const result = postgresSafeJson(item); changed ||= result.changed; return result.value; });
    return { value: normalized, changed };
  }
  if (value && typeof value === "object") {
    let changed = false; const normalized = {};
    for (const [key, item] of Object.entries(value)) {
      const safeKey = postgresSafeString(key); const safeItem = postgresSafeJson(item); changed ||= safeKey.changed || safeItem.changed; normalized[safeKey.value] = safeItem.value;
    }
    return { value: normalized, changed };
  }
  return { value, changed: false };
}

function factFromProvider(item, context) {
  const concept = postgresSafeString(item.concept); const factValue = postgresSafeJson(item.value); const raw = item.raw == null ? { value: null, changed: false } : postgresSafeString(item.raw);
  const factId = context.idFor(item);
  const supportingArtifactIds = [...new Set(item.supportingArtifactIds || [context.artifactId])];
  const locatorAssessment = assessFactLocators({ ...item, raw: raw.value, supportingArtifactIds }, context.contentItems || []);
  const typedAssessment = item.typedRelationshipCandidate === null || item.typedRelationshipCandidate === undefined ? { relationship: null, limitations: [], attempted: false } : { ...validateTypedRelationshipCandidate(item.typedRelationshipCandidate, { factId, mappingMethod: "provider_structured", mapperId: "evidence-r4-provider-output-validator", mapperVersion: "1", mapperReference: context.instructionReference || null, createdAt: context.createdAt }), attempted: true };
  const locatorQualified=locatorAssessment.valid.some((locator)=>locator.locatorMetadata?.qualified===true);const signals = { readability: item.ambiguous ? "degraded" : "clear", grounding: "direct", extractionMethod: "ai_semantic", semanticMappingAmbiguity: !!item.semanticAmbiguity, multiplePlausibleValues: !!item.ambiguous, providerOutputUnicodeNormalized: concept.changed || factValue.changed || raw.changed, supportingArtifactCount: supportingArtifactIds.length, locatorCount: locatorAssessment.valid.length, locatorQualified, locatorLimitations: locatorAssessment.limitations, typedRelationship: { attempted: typedAssessment.attempted, state: typedAssessment.relationship ? "validated" : typedAssessment.attempted ? "rejected" : "not_supplied", limitations: typedAssessment.limitations } };
  const assessedSupport=supportState(signals);const finalSupport=locatorAssessment.limitations.length?"needs_verification":locatorQualified&&assessedSupport==="supported"?"supported_with_qualification":assessedSupport;
  return { id: factId, extractionRunId: context.runId, artifactId: supportingArtifactIds[0], supportingArtifactIds, informationNeedId: item.requested ? item.informationNeedId || null : null, schemaFieldId: item.requested ? item.schemaFieldId || null : null, semanticConceptId: concept.value, requestStatus: item.requested ? "requested" : "discovered", groundingType: "direct", factValue: factValue.value, rawRepresentation: raw.value, supportState: finalSupport, supportSignals: signals, supportLocators: locatorAssessment.valid, typedRelationship: typedAssessment.relationship, sourcePolicyContext: context.sourcePolicyContext || {}, createdAt: context.createdAt };
}

function isReservedProvenanceConcept(concept) {
  const normalized = String(concept || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^(?:source_url|page_url|source_page(?:_number|_context)?|page_context|etag|api_(?:link|links)|navigation_(?:link|links|metadata)|transport_metadata|retrieval_metadata|artifact_(?:id|identity|metadata)|capture_(?:time|timestamp|metadata))$/.test(normalized);
}

function isAbsencePlaceholder(value, concept = null) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/[.!]+$/, "").toLowerCase();
  const normalizedConcept = String(concept || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "unknown" && /(?:currentness|relationship_state|temporal_state|effective_state)/.test(normalizedConcept)) return false;
  return /^(?:not\s+(?:directly\s+)?(?:stated|provided|present|found|available)(?:\s+(?:in|on|from)\s+(?:this|the)\s+(?:evidence|source|page|document))?|unavailable(?:\s+(?:in|from)\s+(?:this|the)\s+(?:source|evidence|page|document))?|unknown(?:\s+(?:from|in)\s+(?:this|the)\s+(?:page|source|evidence|document))?)$/.test(normalized);
}

async function runSemanticExtraction(provider, request) {
  if (!provider || typeof provider.extract !== "function") throw new Error("semantic extraction provider is required");
  const artifactInputs = Array.isArray(request.artifactInputs) && request.artifactInputs.length ? request.artifactInputs : [{ artifact: request.artifact || (request.artifactId ? { id: request.artifactId } : null), verifiedContent: request.verifiedContent || null, decodedText: request.decodedText === undefined ? request.content : request.decodedText, sourceMetadata: request.sourceMetadata || {}, order: 1 }];
  const result = await provider.extract({
    artifact: request.artifact || null,
    artifactInputs,
    contentItems: request.contentItems || [],
    verifiedContent: request.verifiedContent || null,
    decodedText: request.decodedText === undefined ? request.content : request.decodedText,
    content: request.content === undefined ? request.decodedText : request.content,
    requestedConcepts: request.requestedConcepts,
    context: request.extractionContext,
    sourceMetadata: request.sourceMetadata || {},
  });
  const providerFacts = Array.isArray(result.facts) ? result.facts : [];
  const noValueFacts = providerFacts.filter((item) => !item || !item.concept || item.valueFound !== true || item.value === null || item.value === undefined || isAbsencePlaceholder(item.value, item.concept));
  const provenanceFacts = providerFacts.filter((item) => item && item.concept && !noValueFacts.includes(item) && (item.semanticRole !== "business_fact" || isReservedProvenanceConcept(item.concept)));
  const sampledFacts = providerFacts.filter((item) => item && item.concept && !noValueFacts.includes(item) && !provenanceFacts.includes(item) && (item.sampled === true || /(?:^|_)sample(?:d)?(?:_|$)/i.test(String(item.concept))));
  const candidateFacts = providerFacts.filter((item) => !noValueFacts.includes(item) && !provenanceFacts.includes(item) && !sampledFacts.includes(item));
  const allowedArtifactIds = new Set(artifactInputs.map((input) => input?.artifact?.id).filter(Boolean));
  const withSupport = candidateFacts.map((item) => {
    const supplied = Array.isArray(item.supportingArtifactIds) ? item.supportingArtifactIds.map(String) : [];
    const supportingArtifactIds = supplied.length ? [...new Set(supplied)] : allowedArtifactIds.size === 1 ? [...allowedArtifactIds] : [];
    return { item: { ...item, supportingArtifactIds }, valid: supportingArtifactIds.length > 0 && supportingArtifactIds.every((id) => allowedArtifactIds.has(id)) };
  });
  const invalidSupportFacts = withSupport.filter((entry) => !entry.valid);
  const persistableFacts = withSupport.filter((entry) => entry.valid).map((entry) => entry.item);
  const inputCompleteness = request.inputCompleteness || { state: "complete", limitations: [] };
  const facts = persistableFacts.map((item) => factFromProvider(item, { ...request, contentItems: request.contentItems || [] }));
  const locatorLimitations = facts.flatMap((fact) => fact.supportSignals?.locatorLimitations || []);
  const typedRelationshipLimitations = facts.flatMap((fact) => (fact.supportSignals?.typedRelationship?.limitations || []).map((limitation) => `Fact ${fact.id}: ${limitation}`));
  const limitations = [...(Array.isArray(result.completeness?.limitations) ? result.completeness.limitations : []), ...(Array.isArray(inputCompleteness.limitations) ? inputCompleteness.limitations : []), ...(sampledFacts.length ? ["Provider returned sampled or truncated semantic facts"] : []), ...(invalidSupportFacts.length ? ["Provider facts contained missing or invalid supporting Artifact references"] : []), ...locatorLimitations, ...typedRelationshipLimitations];
  const completeness = { state: result.completeness?.state === "complete" && inputCompleteness.state === "complete" && !sampledFacts.length && !invalidSupportFacts.length && !locatorLimitations.length ? "complete" : "incomplete", limitations: [...new Set(limitations)], sourceRecordCount: result.completeness?.sourceRecordCount ?? null, representedRecordCount: result.completeness?.representedRecordCount ?? null };
  const reportedOutcomes = new Map((Array.isArray(result.requestedConceptOutcomes) ? result.requestedConceptOutcomes : []).map((item) => [item?.concept, item?.status]));
  const requestedConceptOutcomes = (request.requestedConcepts || []).map((requested) => ({ concept: requested.concept, status: persistableFacts.some((item) => item.requested && item.concept === requested.concept) ? "found" : reportedOutcomes.get(requested.concept) === "not_found" || completeness.state === "complete" ? "not_found" : "not_evaluated" }));
  return { ...result, requestedConceptOutcomes, completeness, providerReturnedFactCount: providerFacts.length, discardedNoValueFactCount: noValueFacts.length, discardedProvenanceFactCount: provenanceFacts.length, discardedSampledFactCount: sampledFacts.length, discardedInvalidSupportFactCount: invalidSupportFacts.length, locatorLimitationCount: locatorLimitations.length, typedRelationshipCandidateCount: facts.filter((fact) => fact.supportSignals?.typedRelationship?.attempted).length, typedRelationshipValidatedCount: facts.filter((fact) => fact.typedRelationship).length, typedRelationshipLimitations, facts };
}

async function runIndependentVerification(provider, request) {
  const { proposedValue: _proposedValue, ...unanchoredRequest } = request;
  return runSemanticExtraction(provider, unanchoredRequest);
}

module.exports = { factFromProvider, isAbsencePlaceholder, isReservedProvenanceConcept, postgresSafeJson, postgresSafeString, runIndependentVerification, runSemanticExtraction, supportState };
