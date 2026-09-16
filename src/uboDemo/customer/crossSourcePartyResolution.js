const TRUSTED_IDENTIFIER_NAMESPACES = /COMPANIES[_ -]?HOUSE|COMPANY[_ -]?(NUMBER|NO)|REGISTRY|LEI|LEGAL[_ -]?ENTITY[_ -]?IDENTIFIER/;

const LEGAL_FORM_ALIASES = new Map([
  ["LIMITED", "LTD"], ["LTD", "LTD"],
  ["PUBLIC LIMITED COMPANY", "PLC"], ["PLC", "PLC"],
  ["LIMITED LIABILITY PARTNERSHIP", "LLP"], ["LLP", "LLP"],
  ["LIMITED PARTNERSHIP", "LP"], ["LP", "LP"],
  ["INCORPORATED", "INC"], ["INC", "INC"],
  ["CORPORATION", "CORP"], ["CORP", "CORP"],
  ["COMPANY", "CO"], ["CO", "CO"],
  ["B V", "BV"], ["BV", "BV"],
]);

function text(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function words(value) {
  return text(value).replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function canonicalJurisdiction(value) {
  const key = words(value);
  if (["GB", "UK", "UNITED KINGDOM", "GREAT BRITAIN"].includes(key)) return "GB";
  return key;
}

function statedLegalForm(party) {
  const explicit = words(party?.legalForm || party?.legalFormCode);
  if (explicit) return LEGAL_FORM_ALIASES.get(explicit) || explicit;
  const normalized = words(party?.name);
  const aliases = [...LEGAL_FORM_ALIASES.entries()].sort((left, right) => right[0].length - left[0].length);
  const found = aliases.find(([suffix]) => normalized === suffix || normalized.endsWith(` ${suffix}`));
  return found?.[1] || "";
}

export function normalizedLegalName(partyOrName) {
  const party = typeof partyOrName === "string" ? { name: partyOrName } : (partyOrName || {});
  const normalized = words(party.name);
  const form = statedLegalForm(party);
  let base = normalized;
  if (form) {
    const aliases = [...LEGAL_FORM_ALIASES.entries()]
      .filter(([, canonical]) => canonical === form)
      .sort((left, right) => right[0].length - left[0].length);
    const suffix = aliases.find(([candidate]) => base === candidate || base.endsWith(` ${candidate}`))?.[0];
    if (suffix) base = base.slice(0, -suffix.length).trim();
  }
  return { normalized, base, compactBase: base.replace(/[^A-Z0-9]/g, ""), legalForm: form };
}

function trustedIdentifiers(party) {
  return (party?.externalIdentifiers || []).map((identifier) => {
    const namespace = words(identifier.namespace || identifier.system || identifier.identifierType);
    const value = words(identifier.value).replace(/\s/g, "");
    return { namespace, value, key: `${namespace}:${value}` };
  }).filter(({ namespace, value }) => namespace && value && TRUSTED_IDENTIFIER_NAMESPACES.test(namespace));
}

function identifierConflict(left, right) {
  const leftIds = trustedIdentifiers(left);
  const rightIds = trustedIdentifiers(right);
  return leftIds.some((a) => rightIds.some((b) => a.namespace === b.namespace && a.value !== b.value));
}

function sharedTrustedIdentifier(left, right) {
  const rightKeys = new Set(trustedIdentifiers(right).map(({ key }) => key));
  return trustedIdentifiers(left).find(({ key }) => rightKeys.has(key))?.key || null;
}

function broadPartyCategory(party) {
  const value = words(party?.entityType || party?.partyType);
  if (!value || ["UNKNOWN", "UNKNOWN OR OTHER", "OTHER"].includes(value)) return "";
  if (["NATURAL PERSON", "PERSON", "INDIVIDUAL"].includes(value)) return "NATURAL_PERSON";
  if (["COMPANY", "LEGAL ENTITY", "PUBLIC COMPANY", "CORPORATE", "REGISTERED ENTITY"].includes(value)) return "LEGAL_ENTITY";
  if (["LLP", "LIMITED LIABILITY PARTNERSHIP", "PARTNERSHIP", "LIMITED PARTNERSHIP", "LP"].includes(value)) return "PARTNERSHIP";
  if (["TRUST", "TRUST OR LEGAL ARRANGEMENT", "FOUNDATION"].includes(value)) return "LEGAL_ARRANGEMENT";
  return value;
}

function compatiblePartyType(left, right) {
  const a = broadPartyCategory(left);
  const b = broadPartyCategory(right);
  return !a || !b || a === b;
}

function compatibleJurisdiction(left, right) {
  const a = canonicalJurisdiction(left?.jurisdiction || left?.countryCode);
  const b = canonicalJurisdiction(right?.jurisdiction || right?.countryCode);
  return !a || !b || a === b;
}

function compatibleLegalForm(left, right) {
  const a = statedLegalForm(left);
  const b = statedLegalForm(right);
  return !a || !b || a === b;
}

function partySnapshot(party) {
  return {
    name: party?.name || null,
    entityType: party?.entityType || party?.partyType || null,
    jurisdiction: party?.jurisdiction || party?.countryCode || null,
    legalForm: party?.legalForm || statedLegalForm(party) || null,
    externalIdentifiers: (party?.externalIdentifiers || []).map((identifier) => ({
      namespace: identifier.namespace || identifier.system || identifier.identifierType || null,
      value: identifier.value == null ? null : String(identifier.value),
    })),
  };
}

export function partyFingerprint(party) {
  const identifier = trustedIdentifiers(party).sort((a, b) => a.key.localeCompare(b.key))[0]?.key;
  if (identifier) return `ID:${identifier}`;
  const name = normalizedLegalName(party);
  return `NAME:${name.compactBase}|${canonicalJurisdiction(party?.jurisdiction || party?.countryCode)}|${name.legalForm}|${words(party?.entityType || party?.partyType)}`;
}

function structuralFingerprint(context) {
  if (!context) return "NO_CONTEXT";
  return [
    context.chainPosition ?? "?",
    context.ownerCount || 0,
    context.ownedCount || 0,
    [...(context.outgoingPartyNames || [])].sort().join(","),
    [...(context.incomingPartyNames || [])].sort().join(","),
  ].join("|");
}

export function partyPairKey(sourcePartyA, sourcePartyB, structuralContextA, structuralContextB) {
  return `${partyFingerprint(sourcePartyA)}::${partyFingerprint(sourcePartyB)}::${structuralFingerprint(structuralContextA)}::${structuralFingerprint(structuralContextB)}`;
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizedLegalName(left).base.split(" ").filter(Boolean));
  const b = new Set(normalizedLegalName(right).base.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function structuralCompatibility(left, right) {
  if (!left || !right) return { compatible: false, score: 0, reasons: [] };
  const samePosition = Number.isInteger(left.chainPosition) && left.chainPosition === right.chainPosition;
  const leftOutgoing = new Set(left.outgoingPartyNames || []);
  const leftIncoming = new Set(left.incomingPartyNames || []);
  const sharedOutgoing = (right.outgoingPartyNames || []).some((name) => leftOutgoing.has(name));
  const sharedIncoming = (right.incomingPartyNames || []).some((name) => leftIncoming.has(name));
  const sameDirection = Boolean((left.ownerCount && right.ownerCount) || (left.ownedCount && right.ownedCount));
  const score = [samePosition, sharedOutgoing, sharedIncoming, sameDirection].filter(Boolean).length / 4;
  return {
    compatible: samePosition && sameDirection && (sharedOutgoing || sharedIncoming),
    score,
    reasons: [samePosition && "same chain position", sharedOutgoing && "same downstream party", sharedIncoming && "same upstream party", sameDirection && "same relationship direction"].filter(Boolean),
  };
}

function resolution(method, confidence, sourcePartyA, sourcePartyB, reasons, classification = "SAME_ENTITY", autoLinked = true) {
  return {
    identityResolutionMethod: method,
    confidence,
    sourcePartyA: partySnapshot(sourcePartyA),
    sourcePartyB: partySnapshot(sourcePartyB),
    reasons,
    classification,
    autoLinked,
    comparisonIdentity: autoLinked
      ? `comparison-party:${sharedTrustedIdentifier(sourcePartyA, sourcePartyB) || normalizedLegalName(sourcePartyA).compactBase || normalizedLegalName(sourcePartyB).compactBase}`
      : null,
  };
}

export function resolveCrossSourceParty({ sourcePartyA, sourcePartyB, structuralContextA, structuralContextB, aiResolutions = [] } = {}) {
  const sharedIdentifier = sharedTrustedIdentifier(sourcePartyA, sourcePartyB);
  if (sharedIdentifier) return resolution("TRUSTED_IDENTIFIER", 1, sourcePartyA, sourcePartyB, [`shared trusted identifier ${sharedIdentifier}`]);
  if (identifierConflict(sourcePartyA, sourcePartyB)) return resolution("TRUSTED_IDENTIFIER_CONFLICT", 1, sourcePartyA, sourcePartyB, ["trusted identifiers conflict"], "DIFFERENT_ENTITY", false);
  if (!compatiblePartyType(sourcePartyA, sourcePartyB) || !compatibleJurisdiction(sourcePartyA, sourcePartyB) || !compatibleLegalForm(sourcePartyA, sourcePartyB)) {
    return resolution("COMPATIBILITY_CHECK", 1, sourcePartyA, sourcePartyB, ["party type, jurisdiction or legal form is incompatible"], "DIFFERENT_ENTITY", false);
  }

  const leftName = normalizedLegalName(sourcePartyA);
  const rightName = normalizedLegalName(sourcePartyB);
  if (leftName.compactBase && leftName.compactBase === rightName.compactBase) {
    return resolution("NORMALIZED_LEGAL_NAME", 0.99, sourcePartyA, sourcePartyB, [
      "legal names match after punctuation, spacing and common legal-form normalization",
      "jurisdiction and legal form are compatible",
    ]);
  }

  const structural = structuralCompatibility(structuralContextA, structuralContextB);
  const similarity = tokenSimilarity(sourcePartyA, sourcePartyB);
  if (structural.compatible && similarity >= 0.5) {
    return resolution("STRUCTURAL_CONTEXT", Math.min(0.97, 0.88 + (structural.score * 0.08)), sourcePartyA, sourcePartyB, [
      `normalized legal-name token similarity ${similarity.toFixed(2)}`,
      ...structural.reasons,
      "jurisdiction and legal form are compatible",
    ]);
  }

  const candidateId = partyPairKey(sourcePartyA, sourcePartyB, structuralContextA, structuralContextB);
  const ai = aiResolutions.find((item) => item.candidateId === candidateId);
  if (ai) {
    const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
    const supported = ["SAME_ENTITY", "LIKELY_SAME_ENTITY"].includes(ai.classification);
    const autoLinked = supported && confidence >= 0.9;
    return resolution("AI_ASSISTED", confidence, sourcePartyA, sourcePartyB, ai.reasons || [], ai.classification, autoLinked);
  }

  return resolution("UNRESOLVED", similarity, sourcePartyA, sourcePartyB, [
    "no shared trusted identifier",
    "normalized legal names do not match",
    ...(structural.reasons.length ? structural.reasons : ["structural context is insufficient"]),
  ], "UNCERTAIN", false);
}

function relationshipFamily(fact) {
  if (fact?.relationship === "ECONOMIC_OWNERSHIP") return "ECONOMIC_OWNERSHIP";
  if (fact?.relationship === "VOTING_RIGHTS") return "VOTING_RIGHTS";
  return fact?.relationship || "OTHER";
}

export function buildPartyStructuralContexts(facts = []) {
  const contexts = new Map();
  const adjacency = new Map();
  const ensure = (party) => {
    const key = partyFingerprint(party);
    if (!contexts.has(key)) contexts.set(key, { ownerCount: 0, ownedCount: 0, outgoingPartyNames: [], incomingPartyNames: [], chainPosition: null });
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return key;
  };
  facts.filter((fact) => fact?.type === "RELATIONSHIP").forEach((fact) => {
    const ownerKey = ensure(fact.subject);
    const ownedKey = ensure(fact.object);
    const owner = contexts.get(ownerKey);
    const owned = contexts.get(ownedKey);
    owner.ownerCount += 1;
    owned.ownedCount += 1;
    owner.outgoingPartyNames.push(normalizedLegalName(fact.object).compactBase);
    owned.incomingPartyNames.push(normalizedLegalName(fact.subject).compactBase);
    adjacency.get(ownerKey).add(ownedKey);
  });
  const distanceToSink = (key, visiting = new Set()) => {
    if (visiting.has(key)) return null;
    const next = [...(adjacency.get(key) || [])];
    if (!next.length) return 0;
    const distances = next.map((item) => distanceToSink(item, new Set([...visiting, key]))).filter(Number.isInteger);
    return distances.length ? 1 + Math.min(...distances) : null;
  };
  contexts.forEach((context, key) => {
    context.outgoingPartyNames = [...new Set(context.outgoingPartyNames)];
    context.incomingPartyNames = [...new Set(context.incomingPartyNames)];
    context.chainPosition = distanceToSink(key);
  });
  return contexts;
}

export function buildAiPartyMatchCandidates(researchFacts = [], chartFacts = []) {
  const researchContexts = buildPartyStructuralContexts(researchFacts);
  const chartContexts = buildPartyStructuralContexts(chartFacts);
  const uniqueParties = (facts) => {
    const found = new Map();
    facts.filter((fact) => fact?.type === "RELATIONSHIP").forEach((fact) => {
      [fact.subject, fact.object].forEach((party) => found.set(partyFingerprint(party), party));
    });
    return [...found.values()];
  };
  const candidates = [];
  uniqueParties(researchFacts).forEach((sourcePartyA) => uniqueParties(chartFacts).forEach((sourcePartyB) => {
    const deterministic = resolveCrossSourceParty({
      sourcePartyA,
      sourcePartyB,
      structuralContextA: researchContexts.get(partyFingerprint(sourcePartyA)),
      structuralContextB: chartContexts.get(partyFingerprint(sourcePartyB)),
    });
    if (deterministic.autoLinked || deterministic.classification === "DIFFERENT_ENTITY") return;
    const similarity = tokenSimilarity(sourcePartyA, sourcePartyB);
    const structural = structuralCompatibility(researchContexts.get(partyFingerprint(sourcePartyA)), chartContexts.get(partyFingerprint(sourcePartyB)));
    if (similarity < 0.35 && !structural.compatible) return;
    candidates.push({
      candidateId: partyPairKey(
        sourcePartyA,
        sourcePartyB,
        researchContexts.get(partyFingerprint(sourcePartyA)),
        chartContexts.get(partyFingerprint(sourcePartyB)),
      ),
      sourcePartyA: partySnapshot(sourcePartyA),
      sourcePartyB: partySnapshot(sourcePartyB),
      structuralContextA: researchContexts.get(partyFingerprint(sourcePartyA)),
      structuralContextB: chartContexts.get(partyFingerprint(sourcePartyB)),
      relationshipFamilies: [...new Set([...researchFacts, ...chartFacts].map(relationshipFamily))],
    });
  }));
  return candidates.slice(0, 20);
}
