"use strict";

const { ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA, ANTHROPIC_R4_INSTRUCTION_REFERENCE } = require("./anthropicOutputSchema");
const { canonicalPartyType, inventoryConnector, inventoryParty, ownershipDraft } = require("./ownershipDraft");

class SemanticExtractionProvider {
  capabilities() { return { contentKinds: ["text"], maxRequestBytes: null }; }
  async extract() { throw new Error("SemanticExtractionProvider.extract must be implemented"); }
}

const SEMANTIC_DISCOVERY_OBJECTIVE = Object.freeze([
  "Perform two simultaneous objectives.",
  "REQUESTED EXTRACTION: Extract every source-supported fact responsive to the supplied requested concepts.",
  "OPEN KYC/KYB DISCOVERY: Independently inspect the complete supplied evidence and return every additional source-supported fact you find that could reasonably matter to KYC/KYB, identification, verification, due diligence, or later risk investigation. A relevant fact must not be omitted merely because it was not requested.",
  "For open discovery, consider semantic categories including entity identity and names; historical or former names; registration and incorporation information; legal form and status; addresses; business activities; industry, activity, or classification codes; ownership and control; officers and roles; regulatory or licensing information; material corporate history; and other source-supported facts reasonably useful for identification, verification, due diligence, or risk investigation. These are semantic categories, not a source-field allow-list.",
  "Do not turn every source property into a business fact. Exclude technical or transport metadata such as etags, API navigation links, links.self, and retrieval metadata from semantic facts; those remain preserved in the source Artifact.",
  "Preserve direct versus derived meaning. If the source directly states a classification code, return the code as a direct fact. Do not invent or silently add an industry or activity description. Any later classification requires explicit derived-fact transformation lineage.",
  "Do not infer facts not stated or supported by the evidence. Do not return derived classifications unless explicitly requested.",
  "Keep the JSON compact. For repeated source records, use a meaningful fact whose value is an array of source-supported records instead of emitting a separate fact for every property of every record. Do not omit a record merely to shorten the response.",
  "Never sample, truncate, return only the first N records, or invent a *_sample concept unless sampling was explicitly requested. If complete extraction is impossible, report completeness.state=incomplete and explain the limitation.",
  "Provenance and navigation already supplied by Evidence are not business facts. Do not return source URLs, page URLs or numbers, source-page context, etags, API links, transport metadata, Artifact identity, capture metadata, or retrieval metadata as facts. Mark any non-business output semantic_role=provenance_metadata so it can be excluded.",
  "Absence is not a business value. Do not put placeholder language such as an unavailable or unstated value into a fact. A fact must have value_found=true and contain an actual source-supported proposition. Report a requested concept with no supported value through requested_concept_outcomes status=not_found instead.",
]);

const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
// The model that reads a customer's ownership chart and supporting documents
// unless EVIDENCE_A3_ANTHROPIC_MODEL names another (owner decision 2026-10-04:
// Sonnet 5.5 - newer than Sonnet 4.5, and $2/$10 per million tokens against
// $3/$15).
const DEFAULT_CHART_READING_MODEL = "claude-sonnet-5-5";
function chartReadingModel() { return process.env.EVIDENCE_A3_ANTHROPIC_MODEL || DEFAULT_CHART_READING_MODEL; }
// Models that accept output_config.effort; sending it to an older model is
// refused outright (400).
// Reads a streamed Messages response into the same shape as a whole one,
// calling onText with the answer so far. Thinking is not part of the answer.
async function readMessageStream(body, onText) {
  const decoder = new TextDecoder();
  const message = { content: [], usage: {} };
  let buffer = "", text = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
      const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (!data) continue;
      let event;
      try { event = JSON.parse(data); } catch (_) { continue; }
      if (event.type === "message_start") { message.model = event.message?.model; message.usage = { ...(event.message?.usage || {}) }; }
      else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") { text += event.delta.text || ""; onText(text); }
      else if (event.type === "message_delta") { message.stop_reason = event.delta?.stop_reason; message.usage = { ...message.usage, ...(event.usage || {}) }; }
      else if (event.type === "error") throw Object.assign(new Error(String(event.error?.message || "Semantic provider stream failed").slice(0, 500)), { code: "provider_failed" });
    }
  }
  message.content = [{ type: "text", text }];
  return message;
}

// A relationship's parties take their type from the provider's own party
// inventory when the relationship row does not state one. Sonnet 5.5 names
// the parties of a relationship and states their types only in the inventory;
// all 14 relationships of a chart were rejected as "partyType is required"
// (2026-10-04). A type the row states itself is kept.
const labelKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
function withInventoryPartyTypes(candidate, inventory) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const byId = new Map(), byLabel = new Map();
  (inventory || []).forEach((item) => {
    const type = canonicalPartyType(item?.party_type, item?.partyType, item?.type, item?.entity_type, item?.category, item?.kind);
    if (!type) return;
    const id = item?.inventory_id || item?.party_id || item?.id;
    if (id) byId.set(String(id), type);
    const label = labelKey(item?.visible_label || item?.name);
    if (label) byLabel.set(label, type);
  });
  const metadata = candidate.sourceSpecificMetadata || {};
  const fill = (party, idKey) => {
    if (!party || typeof party !== "object") return party;
    const own = canonicalPartyType(party.partyType, party.party_type, party.type, party.entityType, party.entity_type, party.category, party.kind);
    if (own) return { ...party, partyType: own };
    const found = byId.get(String(metadata[idKey] || party.inventoryId || party.inventory_id || "")) || byLabel.get(labelKey(party.name || party.description));
    return found ? { ...party, partyType: found } : party;
  };
  return { ...candidate, subject: fill(candidate.subject, "subjectInventoryId"), object: fill(candidate.object, "objectInventoryId") };
}

function acceptsEffort(model) { return /^claude-(fable|mythos|opus-5|opus-4-[5-8]|sonnet-5|sonnet-4-6)/.test(String(model || "")); }
const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;

function parsedJson(value, fallback) {
  if (value !== null && typeof value === "object") return structuredClone(value);
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function factValue(item) {
  if (item.value_json === undefined) return item.value;
  // Without Anthropic's oversized compiled grammar the provider may return
  // the already-decoded JSON value instead of the shallow transport string.
  // Both representations carry the same fact; normalize before validation.
  if (item.value_json !== null && typeof item.value_json === "object") return structuredClone(item.value_json);
  try { return JSON.parse(item.value_json); }
  catch (_) {
    const raw = String(item.value_json || "").trim();
    // A scalar string may be returned directly when strict compiled output is
    // unavailable. Preserve that string; never accept malformed object/array
    // syntax as a value.
    if (raw && !/^[{[]/.test(raw)) return raw;
    throw Object.assign(new Error("Semantic provider returned an invalid encoded Fact value"), { code: "provider_malformed_output" });
  }
}

function parsedQualifications(value) {
  const parsed = parsedJson(value, []);
  if (Array.isArray(parsed)) return parsed;
  // Some provider responses encode an absent qualifications list as the empty
  // JSON object. It carries no qualification content, so normalize only that
  // transport representation; populated objects remain invalid at R4.
  if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return [];
  // Nothing at all (null, a blank string) is no qualifications. Plain text that
  // is not JSON is one qualification, kept as written. Either used to reject the
  // whole relationship ("qualifications must be an array"), so a chart reading
  // lost every relationship whenever the provider answered this optional field
  // in prose - found in the end-to-end check (2026-10-04): 7 of 7 lost.
  if (parsed === null || parsed === undefined) return [];
  if (typeof parsed === "string") return parsed.trim() ? [parsed.trim()] : [];
  // A populated object ({ "share class": "Ordinary", "status": "Current" }) is
  // kept as text lines rather than rejecting the relationship: a register of
  // members lost the very holding it was uploaded to prove this way (end-to-end
  // check, 2026-10-04). Nothing it says is dropped - every key and value stays.
  if (typeof parsed === "object") {
    return Object.entries(parsed)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
      .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value).trim()}`);
  }
  if (typeof parsed === "number" || typeof parsed === "boolean") return [String(parsed)];
  return parsed;
}

const PERCENTAGE_POINT_UNIT_ALIASES = new Set([
  "%",
  "percent",
  "percentage",
  "percentage point",
  "percentage points",
  "percentage_point",
  "percentage_points",
]);

function normalizeRelationshipUnit(measurementType, unit) {
  const originalUnit = typeof unit === "string" ? unit.trim() : unit;
  if (measurementType !== "percentage" || !originalUnit) return { unit: originalUnit || undefined, normalization: null };
  const token = String(originalUnit).toLowerCase().replace(/\s+/g, " ");
  if (!PERCENTAGE_POINT_UNIT_ALIASES.has(token)) return { unit: originalUnit, normalization: null };
  return {
    unit: "percentage_points",
    normalization: token === "percentage_points" ? null : {
      kind: "EXPLICIT_PERCENTAGE_UNIT_ALIAS",
      originalUnit,
      canonicalUnit: "percentage_points",
    },
  };
}

function metadataWithUnitNormalization(metadata, normalization) {
  const result = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
  if (normalization) result.valueUnitNormalization = normalization;
  return result;
}

function mapTypedRelationshipCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input || null;
  if (typeof input.subject_json === "string" && typeof input.object_json === "string") {
    const party = (prefix) => {
      const details = parsedJson(input[`${prefix}_json`], {});
      const stated = input[`${prefix}_party_type`];
      const partyType = canonicalPartyType(stated, details.partyType, details.party_type, details.type, details.entityType, details.entity_type, details.category, details.kind) || stated || details.partyType;
      return { ...details, partyType };
    };
    const normalizedUnit = normalizeRelationshipUnit(input.measurement_type, input.unit);
    const value = { kind: input.value_kind, measurementType: input.measurement_type, unit: normalizedUnit.unit };
    if (input.value_kind === "EXACT" && input.measurement_type === "count_of_total") { value.numerator = input.numerator; value.denominator = input.denominator; }
    else if (input.value_kind === "EXACT") value.value = input.exact_value;
    else if (input.value_kind === "RANGE") { value.lower = input.range_lower; value.upper = input.range_upper; value.lowerInclusive = input.lower_inclusive; value.upperInclusive = input.upper_inclusive; }
    else if (input.value_kind === "QUALITATIVE") value.value = input.qualitative_value;
    const temporalDetails = parsedJson(input.temporal_json, {});
    const inventoryMetadata = {
      ...(input.connector_inventory_id ? { connectorInventoryId: input.connector_inventory_id } : {}),
      ...(input.subject_inventory_id ? { subjectInventoryId: input.subject_inventory_id } : {}),
      ...(input.object_inventory_id ? { objectInventoryId: input.object_inventory_id } : {}),
    };
    return {
      directionEstablished: input.direction_established, relationshipType: input.relationship_type,
      subject: party("subject"), object: party("object"), value,
      temporal: { state: input.temporal_state, effectiveFrom: temporalDetails.effective_from, effectiveTo: temporalDetails.effective_to, sourceEffectiveDate: temporalDetails.source_effective_date, precision: temporalDetails.precision || {} },
      sourceSpecificMetadata: { ...metadataWithUnitNormalization(parsedJson(input.source_specific_metadata_json, {}), normalizedUnit.normalization), ...inventoryMetadata }, qualifications: parsedQualifications(input.qualifications_json),
    };
  }
  if (input.present === false) return null;
  if (input.present === true) {
    const party = (prefix) => ({
      partyType: canonicalPartyType(input[`${prefix}_party_type`]) || input[`${prefix}_party_type`], name: input[`${prefix}_name`], description: input[`${prefix}_description`],
      jurisdiction: input[`${prefix}_jurisdiction`], identifiers: parsedJson(input[`${prefix}_identifiers_json`], []),
      qualifiers: parsedJson(input[`${prefix}_qualifiers_json`], {}),
    });
    const normalizedUnit = normalizeRelationshipUnit(input.measurement_type, input.unit);
    const value = { kind: input.value_kind, measurementType: input.measurement_type, unit: normalizedUnit.unit };
    if (input.value_kind === "EXACT" && input.measurement_type === "count_of_total") { value.numerator = input.numerator; value.denominator = input.denominator; }
    else if (input.value_kind === "EXACT") value.value = input.exact_value;
    else if (input.value_kind === "RANGE") { value.lower = input.range_lower; value.upper = input.range_upper; value.lowerInclusive = input.lower_inclusive; value.upperInclusive = input.upper_inclusive; }
    else if (input.value_kind === "QUALITATIVE") value.value = input.qualitative_value;
    return {
      directionEstablished: input.direction_established, relationshipType: input.relationship_type,
      subject: party("subject"), object: party("object"), value,
      temporal: { state: input.temporal_state, effectiveFrom: input.effective_from || undefined, effectiveTo: input.effective_to || undefined, sourceEffectiveDate: input.source_effective_date || undefined, precision: parsedJson(input.temporal_precision_json, {}) },
      sourceSpecificMetadata: metadataWithUnitNormalization(parsedJson(input.source_specific_metadata_json, {}), normalizedUnit.normalization), qualifications: input.qualifications,
    };
  }
  const party = (source) => source && typeof source === "object" ? { partyType: source.party_type, name: source.name, description: source.description, jurisdiction: source.jurisdiction, identifiers: source.identifiers, qualifiers: source.qualifiers ?? parsedJson(source.qualifiers_json, {}) } : source;
  const sourceValue = input.value;
  let value = sourceValue;
  let normalizedUnit = { unit: sourceValue?.unit, normalization: null };
  if (sourceValue && typeof sourceValue === "object") {
    normalizedUnit = normalizeRelationshipUnit(sourceValue.measurement_type, sourceValue.unit);
    value = { kind: sourceValue.kind, measurementType: sourceValue.measurement_type, unit: normalizedUnit.unit };
    if (sourceValue.kind === "EXACT" && sourceValue.measurement_type === "count_of_total") { value.numerator = sourceValue.numerator; value.denominator = sourceValue.denominator; }
    else if (sourceValue.kind === "EXACT") value.value = sourceValue.exact_value ?? sourceValue.value;
    else if (sourceValue.kind === "RANGE") { value.lower = sourceValue.range_lower ?? sourceValue.lower; value.upper = sourceValue.range_upper ?? sourceValue.upper; value.lowerInclusive = sourceValue.lower_inclusive; value.upperInclusive = sourceValue.upper_inclusive; }
    else if (sourceValue.kind === "QUALITATIVE") value.value = sourceValue.qualitative_value ?? sourceValue.value;
  }
  const temporalSource = input.temporal;
  const temporal = temporalSource && typeof temporalSource === "object" ? { state: temporalSource.state, effectiveFrom: temporalSource.effective_from || undefined, effectiveTo: temporalSource.effective_to || undefined, sourceEffectiveDate: temporalSource.source_effective_date || undefined, precision: temporalSource.precision ?? parsedJson(temporalSource.precision_json, {}) } : temporalSource;
  return { directionEstablished: input.direction_established, relationshipType: input.relationship_type, subject: party(input.subject), object: party(input.object), value, temporal, sourceSpecificMetadata: metadataWithUnitNormalization(input.source_specific_metadata ?? parsedJson(input.source_specific_metadata_json, {}), normalizedUnit.normalization), qualifications: input.qualifications };
}

function mapSupportLocator(locator) {
  if (locator && typeof locator.locator_json === "string") {
    const details = parsedJson(locator.locator_json, {});
    return { artifact_id: locator.artifact_id, locator_type: locator.locator_type, ...details };
  }
  if (!locator || typeof locator !== "object" || !("region_present" in locator)) return locator;
  const region = locator.region_present === true && locator.coordinate_space === "original_artifact_pixels" ? {
    coordinate_space: locator.coordinate_space, source_width: locator.source_width, source_height: locator.source_height,
    x: locator.x, y: locator.y, width: locator.width, height: locator.height,
  } : null;
  return {
    artifact_id: locator.artifact_id, locator_type: locator.locator_type, json_path: locator.json_path,
    dom_reference: locator.dom_reference, page_start: locator.page_start, page_end: locator.page_end,
    excerpt: locator.excerpt, description: locator.description, region,
    locator_method: locator.locator_method, qualified: locator.qualified,
  };
}

function reconcilePercentageCandidate(candidate, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return candidate;
  const sourceValue = value.value;
  const sourceSubject = value.subject;
  const sourceObject = value.object;
  const explicitRelationshipValue = value.relationship || value.relationship_type;
  const explicitRelationship = String(explicitRelationshipValue || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const explicitPercentageValue = sourceValue?.kind === "EXACT"
    && ["percentage_points", "percentage", "percent"].includes(String(sourceValue?.unit || value.unit || "").toLowerCase())
    && typeof (sourceValue.exact_value ?? sourceValue.value) === "number";
  const inventoryPercentage = value.inventory_percentage_points;
  const explicitInventoryPercentage = value.inventory_percentage_unit === "percentage_points"
    && typeof inventoryPercentage === "number" && inventoryPercentage >= 0 && inventoryPercentage <= 100;
  const sourceExact = sourceValue?.exact_value ?? sourceValue?.value ?? value.percentage;
  const exact = typeof sourceExact === "number" && sourceExact >= 0 && sourceExact <= 100
    ? sourceExact
    : explicitInventoryPercentage ? inventoryPercentage : sourceExact;
  if (!candidate) {
    if (!explicitRelationshipValue || !sourceSubject?.name || !sourceObject?.name
      || !((sourceValue?.kind === "EXACT" && sourceValue?.measurement_type === "percentage") || explicitPercentageValue || typeof value.percentage === "number" || explicitInventoryPercentage)
      || typeof exact !== "number" || exact < 0 || exact > 100) return null;
    return {
      directionEstablished: true,
      relationshipType: explicitRelationship,
      subject: { partyType: sourceSubject.partyType || sourceSubject.party_type, name: sourceSubject.name },
      object: { partyType: sourceObject.partyType || sourceObject.party_type, name: sourceObject.name },
      value: { kind: "EXACT", measurementType: "percentage", value: exact, unit: "percentage_points" },
      temporal: { state: "unknown" },
      qualifications: [],
      sourceSpecificMetadata: explicitInventoryPercentage && exact === inventoryPercentage
        ? { deterministicTypedRelationshipFromConnectorInventory: true }
        : { deterministicTypedRelationshipFromStructuredFactValue: true },
    };
  }
  const normalized = (text) => String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  const candidateSubjectName = candidate.subject?.name || sourceSubject?.name;
  const candidateObjectName = candidate.object?.name || sourceObject?.name;
  const sameAssertion = (!candidate.relationshipType || explicitRelationship === candidate.relationshipType)
    && normalized(sourceSubject?.name) === normalized(candidateSubjectName)
    && normalized(sourceObject?.name) === normalized(candidateObjectName)
    && ((sourceValue?.kind === "EXACT" && sourceValue?.measurement_type === "percentage") || explicitPercentageValue || typeof value.percentage === "number" || explicitInventoryPercentage)
    && typeof exact === "number" && exact >= 0 && exact <= 100;
  if (!sameAssertion) return candidate;
  const hydrated = {
    ...candidate,
    subject: { ...(candidate.subject || {}), partyType: candidate.subject?.partyType || sourceSubject?.partyType || sourceSubject?.party_type, name: candidateSubjectName },
    object: { ...(candidate.object || {}), partyType: candidate.object?.partyType || sourceObject?.partyType || sourceObject?.party_type, name: candidateObjectName },
  };
  if (candidate.value?.kind === "EXACT" && candidate.value?.measurementType === "percentage"
    && typeof candidate.value.value === "number" && candidate.value.value >= 0 && candidate.value.value <= 100) {
    if (candidate.value.value !== exact) return candidate;
    return {
      ...hydrated,
      value: { ...candidate.value, unit: candidate.value.unit || "percentage_points" },
      sourceSpecificMetadata: { ...(candidate.sourceSpecificMetadata || {}), percentagePointUnitConfirmedByStructuredFact: true },
    };
  }
  return {
    ...hydrated,
    directionEstablished: true,
    relationshipType: candidate.relationshipType || explicitRelationship,
    value: { ...(candidate.value || {}), kind: "EXACT", measurementType: "percentage", value: exact, unit: "percentage_points" },
    temporal: candidate.temporal?.state ? candidate.temporal : { state: "unknown" },
    qualifications: Array.isArray(candidate.qualifications) ? candidate.qualifications : [],
    sourceSpecificMetadata: {
      ...(candidate.sourceSpecificMetadata || {}),
      ...(explicitInventoryPercentage && exact === inventoryPercentage
        ? { providerTransportPercentageReconciledFromConnectorInventory: true }
        : { providerTransportPercentageReconciledFromFactValue: true }),
    },
  };
}

function explicitPercentagePointsFromConnector(connector) {
  if (!connector || typeof connector !== "object") return null;
  const supplied = connector.percentage_points ?? connector.percentage;
  if (typeof supplied === "number" && supplied >= 0 && supplied <= 100) return supplied;
  for (const field of ["percentage_text", "connector_label", "relationship_label", "source_label", "label"]) {
    const text = typeof connector[field] === "string" ? connector[field].trim() : "";
    if (!text) continue;
    const matches = [...text.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*%(?=\s|$)/g)];
    if (matches.length !== 1) continue;
    const parsed = Number(matches[0][1]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }
  return null;
}

function relationshipValueForCandidate(value, concept, partyInventory = [], connectorInventory = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, inventoryIds: {} };
  const canonicalId = (input) => String(input || "").replace(/^(?:party:)+/i, "").trim();
  const normalizedName = (input) => String(input || "").trim().toLowerCase().replace(/\s+/g, " ");
  const byId = new Map(partyInventory.map((item) => [canonicalId(item?.inventory_id || item?.party_id || item?.id), item]));
  const findByName = (name) => partyInventory.find((item) => normalizedName(item?.name || item?.visible_label || item?.description) === normalizedName(name));
  const inventoryReferences = value.inventory_references && typeof value.inventory_references === "object" ? value.inventory_references : {};
  const subjectInventoryId = value.subject_party_inventory_id || value.subject_party_id || value.from_party_inventory_id || value.source_party_inventory_id || inventoryReferences.subject_party_id || inventoryReferences.subject_inventory_id;
  const objectInventoryId = value.object_party_inventory_id || value.object_party_id || value.to_party_inventory_id || value.target_party_inventory_id || inventoryReferences.object_party_id || inventoryReferences.object_inventory_id;
  const connectorInventoryId = value.connector_inventory_id || value.relationship_connector_inventory_id || value.connector_id || value.inventory_id || inventoryReferences.connector_id || inventoryReferences.connector_inventory_id;
  const connector = connectorInventory.find((item) => canonicalId(item?.connector_id || item?.inventory_id || item?.id) === canonicalId(connectorInventoryId));
  const inventoryPercentagePoints = explicitPercentagePointsFromConnector(connector);
  const party = (source, inventoryId) => {
    const supplied = source && typeof source === "object" ? source : typeof source === "string" ? { name: source } : {};
    const inventory = byId.get(canonicalId(inventoryId)) || findByName(supplied.name) || {};
    const name = supplied.name || inventory.name || inventory.visible_label || inventory.description;
    return name ? { ...inventory, ...supplied, name, party_type: supplied.party_type || supplied.partyType || inventory.party_type || inventory.partyType } : source;
  };
  const relationshipByConcept = {
    economic_ownership: "ECONOMIC_OWNERSHIP",
    voting_rights: "VOTING_CONTROL",
    significant_influence_or_control: "SIGNIFICANT_INFLUENCE_OR_CONTROL",
    appointment_rights: "APPOINTMENT_RIGHTS",
  };
  const relationshipToken = String(value.relationship || value.relationship_type || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const controlledRelationships = new Set(Object.values(relationshipByConcept));
  const relationship = controlledRelationships.has(relationshipToken) ? relationshipToken : relationshipByConcept[String(concept || "").toLowerCase()] || relationshipToken;
  const percentage = value.percentage ?? value.percentage_points ?? value.value?.exact_percentage_points ?? value.value?.exact_value;
  return {
    value: {
      ...value,
      relationship,
      subject: party(value.subject, subjectInventoryId),
      object: party(value.object, objectInventoryId),
      percentage,
      unit: value.unit || (typeof percentage === "number" ? "percentage_points" : undefined),
      ...(inventoryPercentagePoints == null ? {} : {
        inventory_percentage_points: inventoryPercentagePoints,
        inventory_percentage_unit: "percentage_points",
      }),
    },
    inventoryIds: { subjectInventoryId: canonicalId(subjectInventoryId), objectInventoryId: canonicalId(objectInventoryId), connectorInventoryId: canonicalId(connectorInventoryId).replace(/^(?:connector:)+/i, "") },
  };
}

class FixtureSemanticProvider extends SemanticExtractionProvider {
  constructor(options = {}) { super(); this.variant = options.variant || "primary"; }
  capabilities() { return { contentKinds: ["text", "image", "document"], maxRequestBytes: 32 * 1024 * 1024 }; }
  async extract({ artifact, artifactInputs = [], contentItems = [], content, decodedText, requestedConcepts = [] }) {
    const text = String(decodedText === undefined ? content || "" : decodedText || "");
    if (/UNREADABLE/i.test(text)) return { facts: [], requestedConceptOutcomes: requestedConcepts.map((request) => ({ concept: request.concept, status: "not_evaluated" })), completeness: { state: "incomplete", limitations: ["Evidence was unreadable"] }, support: { state: "not_supported", signals: { readability: "unreadable", extractionMethod: "fixture_ai" } } };
    const facts = [];
    for (const request of requestedConcepts) {
      if (request.concept === "business_name") {
        const match = text.match(/Registered name\s*:\s*([^\n;]+)/i);
        if (match) facts.push({ concept: request.concept, value: match[1].trim(), raw: match[0], requested: true, schemaFieldId: request.schemaFieldId, informationNeedId: request.informationNeedId });
      }
      if (request.concept === "registered_address") {
        const candidates = [...text.matchAll(/(?:Registered address|Address)\s*:\s*([^\n;]+)/gi)].map((m) => ({ value: m[1].trim(), raw: m[0] }));
        if (candidates.length) {
          const selected = this.variant === "independent" && candidates[1] ? candidates[1] : candidates[0];
          facts.push({ concept: request.concept, ...selected, requested: true, schemaFieldId: request.schemaFieldId, informationNeedId: request.informationNeedId, ambiguous: candidates.length > 1 });
        }
      }
    }
    const former = text.match(/Formerly\s+([^\n;.]+)/i);
    if (former) facts.push({ concept: "previous_legal_name", value: former[1].trim(), raw: former[0], requested: false });
    const inputIds = artifactInputs.map((input) => input?.artifact?.id).filter(Boolean); if (!inputIds.length && artifact?.id) inputIds.push(artifact.id);
    return { facts: facts.map((fact) => ({ ...fact, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: inputIds.slice(0, 1), supportLocators: contentItems.length ? [{ artifact_id: inputIds[0], excerpt: fact.raw, description: `Fixture support for ${fact.concept}`, page_start: contentItems[0].kind === "document" ? 1 : undefined, page_end: contentItems[0].kind === "document" ? 1 : undefined, locator_method: "fixture" }] : [] })), requestedConceptOutcomes: requestedConcepts.map((request) => ({ concept: request.concept, status: facts.some((fact) => fact.requested && fact.concept === request.concept) ? "found" : "not_found" })), completeness: { state: "complete", limitations: [] }, support: { state: facts.length ? "supported" : "not_supported", signals: { readability: "clear", extractionMethod: "fixture_ai", literalFieldMatchRequired: false } } };
  }
}

function parseProviderJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw Object.assign(new Error("Semantic provider returned malformed JSON"), { code: "provider_malformed_output" });
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch (_) { throw Object.assign(new Error("Semantic provider returned malformed JSON"), { code: "provider_malformed_output" }); }
}

class AnthropicSemanticProvider extends SemanticExtractionProvider {
  constructor({ apiKey, model, fetchImpl = global.fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, instructionReference = ANTHROPIC_R4_INSTRUCTION_REFERENCE, maxAttempts = 2, effort = null, onProgress = null } = {}) {
    super(); this.apiKey = apiKey; this.model = model; this.effort = effort;
    // onProgress({ pass, parties, connections }): what an ownership-chart
    // reading has found so far. Set, the answer is streamed. pass 1 is the
    // reading; a second call on this provider is the verification pass.
    this.onProgress = typeof onProgress === "function" ? onProgress : null; this.calls = 0; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.maxOutputTokens = maxOutputTokens; this.instructionReference = instructionReference; this.maxAttempts = Math.max(1, Math.min(2, Number(maxAttempts) || 1));
  }
  configuration() { return { provider: "anthropic", model: this.model || null, instructionReference: this.instructionReference, ready: !!(this.apiKey && this.model) }; }
  capabilities() { return { contentKinds: ["text", "image", "document"], maxRequestBytes: 32 * 1024 * 1024, mediaTypes: ["application/json", "text/html", "application/pdf", "image/png", "image/jpeg"] }; }
  async extract({ artifact, artifactInputs = [], contentItems = [], decodedText, requestedConcepts = [], context = {}, sourceMetadata = {} }) {
    if (!this.apiKey || !this.model) throw Object.assign(new Error("Live semantic interpretation requires ANTHROPIC_API_KEY and EVIDENCE_A3_ANTHROPIC_MODEL"), { code: "provider_not_configured" });
    if (typeof this.fetchImpl !== "function") throw Object.assign(new Error("Semantic provider transport is unavailable"), { code: "provider_unavailable" });
    const requested = requestedConcepts.map((item) => ({ concept: item.concept, description: item.description || item.concept }));
    const inputs = artifactInputs.length ? artifactInputs : [{ artifact, decodedText, sourceMetadata, order: 1 }];
    const items = contentItems.length ? contentItems : inputs.map((input) => ({ artifactId: input.artifact?.id, kind: "text", mediaType: input.artifact?.mediaType || "text/html", text: String(input.decodedText || ""), artifact: input.artifact, order: input.order, sourceMetadata: input.sourceMetadata || {} }));
    const instruction = [
      "Interpret only the verified preserved evidence supplied below.",
      "Return one JSON object with facts, requested_concept_outcomes, completeness, and support.",
      "When Lab extraction context schemaReference is ownership-chart-extraction-v2, also build ownership_party_inventory and ownership_connector_inventory before extracting relationships. Write them as the first two top-level arrays of the JSON object, before facts, so they are complete before any relationship refers to them. Identify every visible person, legal entity, trust/arrangement, and unclear party. Do not omit a party because its relationship is unclear; retain it with disposition UNRESOLVED. Inventory every visible connector and percentage separately. Link each ownership typed_relationship to its connector, subject, and object inventory IDs. If a visible item cannot be reconciled, retain it in the inventory rather than inventing a relationship.",
      "For ownership-chart-extraction-v2, ownership_data_status is OWNERSHIP_RELATIONSHIPS_PRESENT when at least one relationship is visible, NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED only when the complete source was inspected and contains no ownership relationship, and UNRESOLVED when visibility or interpretation is incomplete. Use NOT_APPLICABLE for other profiles.",
      "For ownership-chart-extraction-v2, return only ownership/control parties, connectors, relationships, their currentness, and the specifically requested certification facts. Do not return application navigation, journey names, renderer metadata, page headings, graph counters, zoom percentages, instructions, status-card prose, or other user-interface text as business facts. A percentage is a relationship percentage only when it labels an ownership/control connector; never treat a zoom value such as 100% as ownership. Every returned business fact must include a source locator. For a PDF, use the exact 1-indexed page range plus an excerpt and set qualified=true when those fields locate the source. For an image, include an excerpt or description and original-pixel coordinates when available.",
      "Return shallow indexed transport lists: facts, support_locators, and typed_relationships. value_json and supporting_artifact_ids_json are valid JSON encoded as strings. Each support or relationship row uses fact_index, the zero-based index of its Fact. Omit rows instead of inventing unsupported locators or relationships.",
      "Each facts item must contain concept, value_json, raw, requested, value_found, semantic_role, sampled, supporting_artifact_ids_json, semanticAmbiguity, and ambiguous. value_json preserves the Fact's natural scalar, array, or object shape. semantic_role must be business_fact for a persistable semantic fact.",
      "A typed_relationship is optional and must describe exactly the same single source assertion as its ordinary Fact. Never put several independent relationships in one typed relationship or relationship array; emit one Fact per directed relationship.",
      "Only return typed_relationship when the evidence explicitly supports both parties, the relationship meaning, and subject→relationship→object direction. If meaning or direction is ambiguous, omit typed_relationship while retaining the safe ordinary Fact.",
      "Each typed_relationships row must contain direction_established=true; source-supported subject_json and object_json party snapshots; value_kind and measurement_type; temporal_state and temporal_json; metadata; and qualifications_json. Parties require a source name or description and never become canonical identities.",
      "Allowed relationship_type values are ECONOMIC_OWNERSHIP, VOTING_RIGHTS, APPOINTMENT_RIGHTS, REMOVAL_RIGHTS, FORMAL_DECISION_RIGHTS, SIGNIFICANT_INFLUENCE_OR_CONTROL, DIRECTOR_OF, OFFICER_OF, AUTHORIZED_SIGNATORY_FOR, CONTROL_OVER, SETTLOR_OF, TRUSTEE_OF, PROTECTOR_OF, BENEFICIARY_OF, NOMINEE_FOR, ACTS_ON_BEHALF_OF, and OTHER. OTHER is only for an understood out-of-vocabulary relationship and must retain source_specific_metadata.originalRelationshipLabel. There is no unknown relationship code.",
      "typed_relationship.value uses kind EXACT, RANGE, QUALITATIVE, or UNKNOWN and measurement_type percentage, count_of_total, absolute_quantity, qualitative, or none. EXACT and RANGE percentage relationships must use unit=percentage_points. EXACT percentage uses exact_value in percentage points: 75% is 75, 25% is 25, and 100% is 100; never return 0.75, text, basis points, or 7500. RANGE uses range_lower/range_upper and inclusivity fields. QUALITATIVE uses qualitative_value containing the source-supported meaning, including a role title for DIRECTOR_OF or OFFICER_OF. Preserve exact bounds and inclusivity. Never convert a range to an exact value, qualitative wording to a number, or UNKNOWN to zero.",
      "typed_relationship.temporal.state must be current, ceased, historical, or unknown. Do not infer current solely because no cease date appears.",
      "Do not return UBO/controller status, threshold decisions, indirect ownership calculations, winner selection, KYC satisfaction, or other downstream conclusions as typed relationships.",
      "The verified inputs are separate preserved Artifacts belonging to one Evidence Asset. Interpret them together where appropriate while preserving every Artifact boundary.",
      "supporting_artifact_ids must contain only the input Artifact IDs that directly support that fact. Use more than one ID only when the fact is jointly supported. Do not claim every run input supports every fact.",
      "support_locators must contain one or more rows for every supporting Artifact. locator_json holds the media-specific JSON path, DOM reference, PDF page, excerpt/description and optional original-pixel image region. Never fabricate a region or coordinate transform.",
      "For JSON include json_path when reliably known. For HTML include dom_reference when reliably known. For PDF include 1-indexed page_start and page_end plus excerpt or visual description. For an image include a support description or visible-text excerpt.",
      "Only include an image region when it is expressed in original_artifact_pixels and source_width/source_height exactly match the original dimensions in the input manifest. Never report coordinates from a resized provider view.",
      "Do not fabricate missing pages or source order. Do not represent unsupported cross-Artifact inference as a directly stated source fact.",
      "requested_concept_outcomes must contain one item per requested concept with concept and status of found, not_found, or not_evaluated.",
      "completeness must contain state=complete or incomplete, limitations as an array, and record counts where the evidence represents a collection.",
      "Use requested=true only when responding to one of the requested concepts. Use requested=false for additional facts found through open discovery.",
      ...SEMANTIC_DISCOVERY_OBJECTIVE,
      `Evidence input manifest: ${JSON.stringify(items.map((item) => ({ id: item.artifactId, order: item.order ?? null, mediaType: item.mediaType, representationType: item.artifact?.representationType, pageCount: item.media?.pageCount ?? null, width: item.media?.width ?? null, height: item.media?.height ?? null })))}`,
      `Requested concepts: ${JSON.stringify(requested)}`,
      `Lab extraction context: ${JSON.stringify(context)}`,
      `Source metadata: ${JSON.stringify(inputs.map((input) => input.sourceMetadata || {}))}`,
    ].join("\n\n");
    const content = [];
    for (const item of items) {
      content.push({ type: "text", text: `BEGIN VERIFIED ARTIFACT ${JSON.stringify({ id: item.artifactId, order: item.order ?? null, mediaType: item.mediaType })}` });
      if (item.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: item.mediaType, data: Buffer.from(item.bytes).toString("base64") } });
      else if (item.kind === "document") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(item.bytes).toString("base64") } });
      else content.push({ type: "text", text: String(item.text || "") });
      content.push({ type: "text", text: `END VERIFIED ARTIFACT ${item.artifactId}` });
    }
    content.push({ type: "text", text: instruction });
    const requestContent = items.every((item) => item.kind === "text") ? content.map((item) => item.text).join("\n\n") : content;
    // The ownership-chart schema is intentionally rich enough to exceed
    // Anthropic's compiled-grammar limit. Keep the same prompt plus the
    // deterministic parser/validator, but do not ask Anthropic to compile the
    // oversized strict grammar for this profile.
    const request = { model: this.model, max_tokens: this.maxOutputTokens, messages: [{ role: "user", content: requestContent }] };
    if (context.schemaReference !== "ownership-chart-extraction-v2") {
      request.output_config = { format: { type: "json_schema", schema: ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA } };
    }
    if (this.effort && acceptsEffort(this.model)) request.output_config = { ...(request.output_config || {}), effort: this.effort };
    const requestStartedAt = Date.now();
    this.calls += 1;
    const pass = this.calls;
    const streaming = Boolean(this.onProgress) && context.schemaReference === "ownership-chart-extraction-v2";
    if (streaming) request.stream = true;
    const requestBody = JSON.stringify(request);
    let response;
    let streamTimer = null;
    let attemptsUsed = 0;
    let lastTransportError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let keepTimer = false;
      try {
        response = await this.fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body: requestBody, signal: controller.signal });
        if (!(response.status === 408 || response.status === 429 || response.status >= 500) || attempt === this.maxAttempts) {
          // A streamed body is still arriving: the time limit covers it too.
          if (streaming && response.ok) { keepTimer = true; streamTimer = timer; }
          break;
        }
      } catch (error) {
        lastTransportError = error;
        if (attempt === this.maxAttempts) {
          if (error?.name === "AbortError") throw Object.assign(new Error("Semantic provider timed out"), { code: "provider_timeout", attemptsUsed });
          throw Object.assign(new Error("Semantic provider request failed"), { code: "provider_unavailable", attemptsUsed });
        }
      } finally { if (!keepTimer) clearTimeout(timer); }
    }
    if (!response) {
      if (lastTransportError?.name === "AbortError") throw Object.assign(new Error("Semantic provider timed out"), { code: "provider_timeout", attemptsUsed });
      throw Object.assign(new Error("Semantic provider request failed"), { code: "provider_unavailable", attemptsUsed });
    }
    let payload;
    if (streaming && response.ok) {
      let lastDraftAt = 0;
      const onText = (text) => {
        if (Date.now() - lastDraftAt < 1000) return;
        lastDraftAt = Date.now();
        try { this.onProgress({ pass, ...ownershipDraft(text) }); } catch (_) { /* A draft never stops the reading. */ }
      };
      try { payload = await readMessageStream(response.body, onText); }
      catch (error) {
        if (error?.name === "AbortError") throw Object.assign(new Error("Semantic provider timed out"), { code: "provider_timeout", attemptsUsed });
        if (error?.code) throw Object.assign(error, { attemptsUsed });
        throw Object.assign(new Error("Semantic provider stream failed"), { code: "provider_unavailable", attemptsUsed });
      } finally { clearTimeout(streamTimer); }
      try { this.onProgress({ pass, ...ownershipDraft(payload.content[0].text) }); } catch (_) { /* As above. */ }
    } else {
      try { payload = await response.json(); } catch (_) { throw Object.assign(new Error("Semantic provider returned malformed output"), { code: "provider_malformed_output" }); }
    }
    if (!response.ok) {
      const safeReason = String(payload?.error?.message || payload?.message || "Provider request failed").slice(0, 500);
      const code = response.status === 401 || response.status === 403
        ? "provider_authentication_failed"
        : response.status === 408
          ? "provider_timeout"
          : response.status === 429 || response.status >= 500
            ? "provider_failed"
            : "provider_request_rejected";
      throw Object.assign(new Error(safeReason), { code, upstreamStatus: response.status, attemptsUsed });
    }
    if (payload.stop_reason === "max_tokens") throw Object.assign(new Error(`Semantic provider output exceeded the ${this.maxOutputTokens}-token response allowance; no partial interpretation was persisted`), { code: "provider_output_truncated" });
    const text = (payload.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const parsed = parseProviderJson(text);
    if (!Array.isArray(parsed.facts)) throw Object.assign(new Error("Semantic provider response does not contain a facts array"), { code: "provider_malformed_output" });
    const requestByConcept = new Map(requestedConcepts.map((item) => [item.concept, item]));
    const shallowTransport = Array.isArray(parsed.support_locators) && Array.isArray(parsed.typed_relationships);
    const locatorsByFact = new Map(), relationshipsByFact = new Map();
    if (shallowTransport) {
      parsed.support_locators.forEach((locator) => { if (Number.isInteger(locator?.fact_index)) { const rows = locatorsByFact.get(locator.fact_index) || []; rows.push(mapSupportLocator(locator)); locatorsByFact.set(locator.fact_index, rows); } });
      parsed.typed_relationships.forEach((relationship) => { if (Number.isInteger(relationship?.fact_index) && !relationshipsByFact.has(relationship.fact_index)) relationshipsByFact.set(relationship.fact_index, mapTypedRelationshipCandidate(relationship)); });
    }
    const inventoryFacts = (concept) => parsed.facts.filter((item) => item?.concept === concept).flatMap((item) => {
      const value = factValue(item);
      return Array.isArray(value) ? value : [];
    });
    const mergeInventory = (items, idFields, prefix) => {
      const rows = new Map();
      items.forEach((item, index) => {
        const supplied = idFields.map((field) => item?.[field]).find(Boolean) || `${prefix}_${index + 1}`;
        const id = String(supplied).replace(new RegExp(`^(?:${prefix}:)+`, "i"), "");
        const current = rows.get(id) || {};
        const merged = { ...current, ...item };
        Object.entries(item || {}).forEach(([field, fieldValue]) => { if (fieldValue == null || fieldValue === "") merged[field] = current[field]; });
        rows.set(id, merged);
      });
      return [...rows.entries()].map(([id, item]) => ({ ...item, [idFields[0]]: id }));
    };
    const rawPartyInventory = mergeInventory([
      ...(Array.isArray(parsed.ownership_party_inventory) ? parsed.ownership_party_inventory : []),
      ...inventoryFacts("ownership_party_inventory"),
    ], ["inventory_id", "party_id", "id"], "party");
    const rawConnectorInventory = mergeInventory([
      ...(Array.isArray(parsed.ownership_connector_inventory) ? parsed.ownership_connector_inventory : []),
      ...inventoryFacts("ownership_connector_inventory"),
    ], ["connector_id", "inventory_id", "id"], "connector");
    const facts = parsed.facts.map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) => item && item.concept && (item.value_json !== undefined || item.value !== undefined)).map(({ item, sourceIndex }) => {
      const request = requestByConcept.get(item.concept); const isRequested = item.requested === true && !!request;
      const encodedSupportIds = item.supporting_artifact_ids_json === undefined ? item.supporting_artifact_ids : parsedJson(item.supporting_artifact_ids_json, []);
      const value = factValue(item);
      const candidate = shallowTransport ? relationshipsByFact.get(sourceIndex) || null : mapTypedRelationshipCandidate(item.typed_relationship);
      const enriched = relationshipValueForCandidate(value, item.concept, rawPartyInventory, rawConnectorInventory);
      let typedRelationshipCandidate = reconcilePercentageCandidate(candidate, enriched.value);
      if (typedRelationshipCandidate && Object.values(enriched.inventoryIds).some(Boolean)) typedRelationshipCandidate = {
        ...typedRelationshipCandidate,
        sourceSpecificMetadata: { ...(typedRelationshipCandidate.sourceSpecificMetadata || {}), ...Object.fromEntries(Object.entries(enriched.inventoryIds).filter(([, id]) => id)) },
      };
      typedRelationshipCandidate = withInventoryPartyTypes(typedRelationshipCandidate, rawPartyInventory);
      return { concept: String(item.concept), value, raw: item.raw == null ? null : String(item.raw), requested: isRequested, schemaFieldId: isRequested ? request.schemaFieldId || null : null, informationNeedId: isRequested ? request.informationNeedId || null : null, valueFound: item.value_found === true, semanticRole: String(item.semantic_role || "unspecified"), sampled: item.sampled === true, supportingArtifactIds: Array.isArray(encodedSupportIds) ? encodedSupportIds.map(String) : Array.isArray(item.supporting_artifact_ids) ? item.supporting_artifact_ids.map(String) : [], supportLocators: shallowTransport ? locatorsByFact.get(sourceIndex) || [] : Array.isArray(item.support_locators) ? item.support_locators.map(mapSupportLocator) : [], semanticAmbiguity: !!item.semanticAmbiguity, ambiguous: !!item.ambiguous, typedRelationshipCandidate };
    });
    const reportedOutcomes = new Map((Array.isArray(parsed.requested_concept_outcomes) ? parsed.requested_concept_outcomes : []).filter((item) => item?.concept).map((item) => [String(item.concept), String(item.status)]));
    const completeness = parsed.completeness && ["complete", "incomplete"].includes(parsed.completeness.state) ? { state: parsed.completeness.state, limitations: Array.isArray(parsed.completeness.limitations) ? parsed.completeness.limitations.map(String) : [], sourceRecordCount: Number.isInteger(parsed.completeness.source_record_count) && parsed.completeness.source_record_count >= 0 ? parsed.completeness.source_record_count : null, representedRecordCount: Number.isInteger(parsed.completeness.represented_record_count) && parsed.completeness.represented_record_count >= 0 ? parsed.completeness.represented_record_count : null } : { state: "incomplete", limitations: ["Provider did not report extraction completeness"], sourceRecordCount: null, representedRecordCount: null };
    const requestedConceptOutcomes = requestedConcepts.map((request) => { const reported = reportedOutcomes.get(request.concept); const found = facts.some((fact) => fact.concept === request.concept && fact.valueFound && fact.semanticRole === "business_fact"); return { concept: request.concept, status: found ? "found" : reported === "not_found" ? "not_found" : completeness.state === "complete" ? "not_found" : "not_evaluated" }; });
    const ownershipPartyInventory = rawPartyInventory.map((item) => {
      const { inventoryId, visibleLabel, partyType, disposition } = inventoryParty(item);
      return { inventoryId, visibleLabel, partyType, sourceLocator: parsedJson(item?.source_locator_json, {}), disposition };
    });
    const ownershipConnectorInventory = rawConnectorInventory.map((item) => {
      const { connectorId, subjectInventoryId, objectInventoryId, visibleLabel, percentageText, disposition } = inventoryConnector(item);
      return { connectorId, subjectInventoryId, objectInventoryId, visibleLabel, percentageText, sourceLocator: parsedJson(item?.source_locator_json, {}), disposition };
    });
    const ownershipDataStatusFact = facts.find((fact) => fact.concept === "ownership_data_status" && typeof fact.value === "string")?.value;
    // What the call cost and took, so a model, effort or prompt change can be
    // measured rather than guessed (UBO-59).
    // The party-type words the provider used (never names): a word the
    // contract does not know shows up here instead of as silent rejections.
    const partyTypeWords = [...new Set([
      ...(Array.isArray(parsed.typed_relationships) ? parsed.typed_relationships : []).flatMap((row) => [row?.subject_party_type, row?.object_party_type]),
      ...rawPartyInventory.map((item) => item?.party_type ?? item?.type ?? item?.category),
    ].filter((word) => typeof word === "string" && word.length <= 40))].slice(0, 20);
    const providerUsage = { model: payload.model || this.model, effort: request.output_config?.effort || null, inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null, durationMs: Date.now() - requestStartedAt, partyTypeWords,
      // The live draft read from the finished answer against the parse: the
      // two should agree; a gap here means the customer saw less than was found.
      ...(streaming ? { draftPartyCount: ownershipDraft(text).parties.length, parsedPartyCount: ownershipPartyInventory.filter((item) => item.visibleLabel && item.disposition !== "INTENTIONALLY_NON_OWNERSHIP").length } : {}) };
    return { facts, requestedConceptOutcomes, completeness, support: parsed.support || null, ownershipDataStatus: parsed.ownership_data_status || ownershipDataStatusFact || "NOT_APPLICABLE", ownershipPartyInventory, ownershipConnectorInventory, providerAttemptCount: attemptsUsed, providerUsage };
  }
}

module.exports = { ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA, ANTHROPIC_R4_INSTRUCTION_REFERENCE, AnthropicSemanticProvider, DEFAULT_CHART_READING_MODEL, DEFAULT_MAX_OUTPUT_TOKENS, acceptsEffort, chartReadingModel, DEFAULT_PROVIDER_TIMEOUT_MS, FixtureSemanticProvider, SEMANTIC_DISCOVERY_OBJECTIVE, SemanticExtractionProvider, explicitPercentagePointsFromConnector, mapTypedRelationshipCandidate, normalizeRelationshipUnit, parseProviderJson, reconcilePercentageCandidate, withInventoryPartyTypes, relationshipValueForCandidate };
