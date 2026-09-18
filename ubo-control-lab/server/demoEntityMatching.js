"use strict";

const ALLOWED_CLASSIFICATIONS = new Set(["SAME_ENTITY", "LIKELY_SAME_ENTITY", "UNCERTAIN", "DIFFERENT_ENTITY"]);
const MAX_CANDIDATES = 20;
const MAX_NAME_LENGTH = 240;

function boundedText(value, field, required = false) {
  const output = String(value || "").trim();
  if ((required && !output) || output.length > MAX_NAME_LENGTH) throw Object.assign(new TypeError(`${field} is invalid`), { code: "invalid_entity_match_request", statusCode: 422 });
  return output || null;
}

function party(input, field) {
  if (!input || typeof input !== "object") throw Object.assign(new TypeError(`${field} is required`), { code: "invalid_entity_match_request", statusCode: 422 });
  return {
    name: boundedText(input.name, `${field}.name`, true),
    entityType: boundedText(input.entityType, `${field}.entityType`),
    jurisdiction: boundedText(input.jurisdiction, `${field}.jurisdiction`),
    legalForm: boundedText(input.legalForm, `${field}.legalForm`),
    externalIdentifiers: (input.externalIdentifiers || []).slice(0, 8).map((identifier, index) => ({
      namespace: boundedText(identifier?.namespace, `${field}.externalIdentifiers[${index}].namespace`, true),
      value: boundedText(identifier?.value, `${field}.externalIdentifiers[${index}].value`, true),
    })),
  };
}

function structuralContext(input) {
  if (!input || typeof input !== "object") return null;
  return {
    ownerCount: Number(input.ownerCount) || 0,
    ownedCount: Number(input.ownedCount) || 0,
    chainPosition: Number.isInteger(input.chainPosition) ? input.chainPosition : null,
    outgoingPartyNames: (input.outgoingPartyNames || []).slice(0, 10).map((value) => boundedText(value, "outgoingPartyName", true)),
    incomingPartyNames: (input.incomingPartyNames || []).slice(0, 10).map((value) => boundedText(value, "incomingPartyName", true)),
  };
}

function validateRequest(input) {
  if (!Array.isArray(input?.candidates) || !input.candidates.length || input.candidates.length > MAX_CANDIDATES) {
    throw Object.assign(new TypeError(`Provide between 1 and ${MAX_CANDIDATES} entity-match candidates`), { code: "invalid_entity_match_request", statusCode: 422 });
  }
  const ids = new Set();
  return input.candidates.map((candidate, index) => {
    const candidateId = boundedText(candidate?.candidateId, `candidates[${index}].candidateId`, true);
    if (ids.has(candidateId)) throw Object.assign(new TypeError("Duplicate entity-match candidate"), { code: "invalid_entity_match_request", statusCode: 422 });
    ids.add(candidateId);
    return {
      candidateId,
      sourcePartyA: party(candidate.sourcePartyA, `candidates[${index}].sourcePartyA`),
      sourcePartyB: party(candidate.sourcePartyB, `candidates[${index}].sourcePartyB`),
      structuralContextA: structuralContext(candidate.structuralContextA),
      structuralContextB: structuralContext(candidate.structuralContextB),
      relationshipFamilies: (candidate.relationshipFamilies || []).slice(0, 8).map((value) => boundedText(value, "relationshipFamily", true)),
    };
  });
}

function promptFor(candidates) {
  return `You are a bounded legal-entity identity matcher. Compare each Source A party with Source B using only the supplied identifiers, legal names, jurisdiction/legal form and graph context.

Return JSON only in this exact shape:
{"matches":[{"candidateId":"...","classification":"SAME_ENTITY|LIKELY_SAME_ENTITY|UNCERTAIN|DIFFERENT_ENTITY","confidence":0.0,"reasons":["short factual reason"]}]}

Rules:
- Never decide ownership, UBO status, verification, policy, percentage correctness or source credibility.
- A conflicting trusted registry identifier requires DIFFERENT_ENTITY.
- Similar brand words alone are insufficient.
- Preserve uncertainty. Do not invent identifiers or facts.
- Return exactly one result for every candidateId and no additional keys.

Candidates:
${JSON.stringify(candidates)}`;
}

function parseJsonText(value) {
  const output = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first < 0 || last < first) throw new TypeError("Entity matching provider did not return JSON");
  return JSON.parse(output.slice(first, last + 1));
}

function validateMatches(payload, candidates) {
  const expected = new Set(candidates.map(({ candidateId }) => candidateId));
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  if (matches.length !== expected.size) throw new TypeError("Entity matching provider returned an incomplete result");
  const seen = new Set();
  return matches.map((match) => {
    if (!expected.has(match?.candidateId) || seen.has(match.candidateId) || !ALLOWED_CLASSIFICATIONS.has(match?.classification)) throw new TypeError("Entity matching provider returned an invalid classification");
    seen.add(match.candidateId);
    const confidence = Number(match.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("Entity matching provider returned invalid confidence");
    return {
      candidateId: match.candidateId,
      classification: match.classification,
      confidence,
      reasons: (Array.isArray(match.reasons) ? match.reasons : []).slice(0, 6).map((reason) => String(reason).slice(0, 300)),
    };
  });
}

function anthropicProvider({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.UBO_DEMO_ENTITY_MATCH_MODEL || "claude-sonnet-4-5", fetchImpl = global.fetch } = {}) {
  return {
    async match(candidates) {
      if (!apiKey) throw Object.assign(new Error("Entity matching AI is unavailable"), { code: "entity_match_provider_unavailable", statusCode: 503 });
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1600, temperature: 0, messages: [{ role: "user", content: promptFor(candidates) }] }),
      });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error("Entity matching AI is unavailable"), { code: "entity_match_provider_unavailable", statusCode: 502 });
      const output = (payload.content || []).filter(({ type }) => type === "text").map(({ text }) => text).join("\n");
      return parseJsonText(output);
    },
  };
}

function createDemoEntityMatcher({ provider = anthropicProvider() } = {}) {
  return async function matchDemoEntities(input) {
    const candidates = validateRequest(input);
    const payload = await provider.match(candidates);
    return {
      contractVersion: "ubo-demo-cross-source-party-resolution-v1",
      matches: validateMatches(payload, candidates),
      decisionScope: "PARTY_IDENTITY_ONLY",
    };
  };
}

module.exports = { ALLOWED_CLASSIFICATIONS, MAX_CANDIDATES, anthropicProvider, createDemoEntityMatcher, promptFor, validateMatches, validateRequest };
