import { relationshipCategory } from "./demoResearch";

function text(value) { return value == null || value === "" ? null : String(value); }

function locatorText(locator) {
  if (!locator) return null;
  if (typeof locator === "string" || typeof locator === "number") return String(locator);
  return locator.humanReadable || [locator.pageNumber != null && `page ${locator.pageNumber}`, locator.regionLabel, locator.textQuote].filter(Boolean).join(" · ") || null;
}

function readableValue(value) {
  if (value == null) return "Structured source detail retained";
  if (typeof value !== "object") return String(value);
  if (value.text) return String(value.text);
  if (value.relationshipType) {
    const qualitative = value.relationshipValue?.qualitative || value.relationshipValue?.value;
    return `${String(value.relationshipType).replaceAll("_", " ")}${qualitative ? `: ${qualitative}` : ""}`;
  }
  return Object.entries(value)
    .filter(([key, item]) => item !== null && item !== undefined && item !== "" && typeof item !== "object" && !["contractVersion", "statementType"].includes(key))
    .map(([key, item]) => `${key.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ")}: ${item}`)
    .join(" · ") || "Structured source detail retained";
}

export function formatAssertionMeasurement(measurement) {
  if (!measurement) return "Non-percentage right or value not supplied";
  if (measurement.type === "EXACT") return measurement.value == null ? "Exact value not supplied" : `${measurement.value}%`;
  if (measurement.type === "RANGE") {
    const lower = measurement.lowerBound == null ? "unbounded" : `${measurement.lowerBound}%`;
    const upper = measurement.upperBound == null ? "unbounded" : `${measurement.upperBound}%`;
    return `${measurement.lowerInclusive ? "[" : "("}${lower}, ${upper}${measurement.upperInclusive ? "]" : ")"}`;
  }
  if (measurement.type === "UNKNOWN") return "Percentage not established";
  return text(measurement.value) || String(measurement.type || "Value retained").replaceAll("_", " ");
}

function evidenceDetails(references = [], source = {}) {
  return references.map((reference) => ({
    system: text(reference.system),
    referenceType: text(reference.referenceType),
    referenceId: text(reference.referenceId),
    artifactId: text(reference.artifactId),
    digest: text(reference.digest || reference.integrityDigest),
    runId: text(reference.runId || reference.interpretationRunId),
    locator: locatorText(reference.locator),
    excerpt: text(reference.excerpt || reference.supportingText),
  })).concat(source.requestId ? [{ system: source.sourceLabel || source.capability || source.sourceState || "Source", referenceId: source.requestId }] : []);
}

export function presentCandidateFact(fact, source = {}) {
  const relationship = fact.relationship || null;
  const isRelationship = fact.type === "RELATIONSHIP";
  const valueText = isRelationship ? formatAssertionMeasurement(fact.measurement) : readableValue(fact.value);
  return {
    factId: fact.factId,
    category: isRelationship ? relationshipCategory(relationship) : fact.attribute?.startsWith("source_certification_") ? "Certification detail" : "Source detail",
    title: isRelationship
      ? `${fact.subject?.name || "Source party"} → ${String(relationship || "relationship").replaceAll("_", " ").toLowerCase()} → ${fact.object?.name || "target party"}`
      : `${fact.subject?.name || "Source entity"} · ${String(fact.attribute || fact.type || "source statement").replaceAll("_", " ").toLowerCase()}`,
    valueText,
    subject: fact.subject || null,
    object: fact.object || null,
    relationship,
    measurementType: isRelationship ? fact.measurement?.type || "NOT_SUPPLIED" : null,
    currentness: fact.qualifiers?.currentState || fact.temporal?.state || "NOT_SUPPLIED",
    effectiveFrom: fact.temporal?.effectiveFrom || null,
    effectiveTo: fact.temporal?.effectiveTo || null,
    sourceState: source.sourceState || source.capability || source.sourceLabel || "Source reference retained",
    supportState: fact.qualifiers?.evidenceSupportState || fact.value?.evidenceSupportState || "SOURCE_SUPPORTED",
    qualifiers: fact.qualifiers || {},
    evidence: evidenceDetails(fact.evidenceReferences || [], source),
    issues: fact.issues || [],
  };
}

export function presentCandidateFacts(entries = []) {
  return entries.map((entry) => presentCandidateFact(entry.fact || entry, entry.source || {}));
}

function registryIdentity(row) {
  const external = row.subject?.externalIdentifiers?.[0];
  return external
    ? `${external.namespace || external.system || external.identifierType}:${external.value}`
    : String(row.subject?.name || row.title || row.factId).trim().toUpperCase();
}

function groupLabel(row, variant) {
  const registryContext = row.relationship == null && row.title.toUpperCase().includes("REGISTRY CONTEXT");
  if (registryContext) return "Registry / entity context";
  if (variant === "customer" && row.category === "Certification detail") return "Certification details";
  if (row.category === "Ownership") return variant === "customer" ? "Ownership assertions" : "Ownership";
  if (row.category === "Voting") return variant === "customer" ? "Voting assertions" : "Voting";
  if (row.category === "Control") return variant === "customer" ? "Control assertions" : "Control";
  return "Other source facts";
}

function consolidateRegistryRows(rows) {
  const consolidated = new Map();
  rows.forEach((row) => {
    const key = registryIdentity(row);
    const existing = consolidated.get(key);
    if (!existing) {
      consolidated.set(key, { ...row, observations: [row], evidence: [...row.evidence] });
      return;
    }
    existing.observations.push(row);
    existing.evidence.push(...row.evidence);
  });
  return [...consolidated.values()];
}

export function groupAssertionRows(entries = [], { variant = "analyst" } = {}) {
  const order = variant === "customer"
    ? ["Ownership assertions", "Voting assertions", "Control assertions", "Certification details", "Other source facts"]
    : ["Registry / entity context", "Ownership", "Voting", "Control", "Other source facts"];
  const grouped = new Map(order.map((label) => [label, []]));
  presentCandidateFacts(entries).forEach((row) => {
    const label = groupLabel(row, variant);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(row);
  });
  if (grouped.has("Registry / entity context")) grouped.set("Registry / entity context", consolidateRegistryRows(grouped.get("Registry / entity context")));
  return [...grouped.entries()].filter(([, rows]) => rows.length).map(([label, rows]) => ({ label, rows }));
}
