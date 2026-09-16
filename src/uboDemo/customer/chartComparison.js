function normalized(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }

function identifiers(party) {
  return new Set((party?.externalIdentifiers || [])
    .map((item) => `${normalized(item.namespace || item.system || item.identifierType)}:${normalized(item.value)}`)
    .filter((item) => !item.endsWith(":")));
}

function sharesIdentifier(left, right) {
  const rightIds = identifiers(right);
  return [...identifiers(left)].some((id) => rightIds.has(id));
}

function compatiblePartyType(left, right) {
  return !left?.entityType || !right?.entityType || normalized(left.entityType) === normalized(right.entityType);
}

function compatibleJurisdiction(left, right) {
  return !left?.jurisdiction || !right?.jurisdiction || normalized(left.jurisdiction) === normalized(right.jurisdiction);
}

function identityState(left, right) {
  if (sharesIdentifier(left, right)) return "IDENTIFIER_MATCH";
  if (normalized(left?.name) && normalized(left?.name) === normalized(right?.name)
    && compatiblePartyType(left, right) && compatibleJurisdiction(left, right)) return "CONFIDENT_NAME_MATCH";
  return "NO_MATCH";
}

function unwrap(entry) { return { fact: entry?.fact || entry, source: entry?.source || {} }; }
function isEconomicOwnership(fact) { return fact?.type === "RELATIONSHIP" && fact.relationship === "ECONOMIC_OWNERSHIP"; }

function interval(value) {
  if (!value || value.type === "UNKNOWN") return null;
  if (value.type === "EXACT" && value.value != null) return { lower: Number(value.value), upper: Number(value.value), lowerInclusive: true, upperInclusive: true, exact: true };
  if (value.type === "RANGE") return {
    lower: value.lowerBound == null ? -Infinity : Number(value.lowerBound),
    upper: value.upperBound == null ? Infinity : Number(value.upperBound),
    lowerInclusive: Boolean(value.lowerInclusive),
    upperInclusive: Boolean(value.upperInclusive),
    exact: false,
  };
  return null;
}

function contains(range, point) {
  return (point > range.lower && point < range.upper)
    || (point === range.lower && range.lowerInclusive)
    || (point === range.upper && range.upperInclusive);
}

function overlaps(left, right) {
  return (left.lower < right.upper && right.lower < left.upper)
    || (left.upper === right.lower && left.upperInclusive && right.lowerInclusive)
    || (right.upper === left.lower && right.upperInclusive && left.lowerInclusive);
}

export function compareMeasurements(research, chart) {
  const registry = interval(research);
  const customer = interval(chart);
  if (!registry || !customer) return { status: "NOT_COMPARABLE" };
  if (registry.exact && customer.exact) return registry.lower === customer.lower
    ? { status: "EXACT_MATCH", verificationBasis: "EXACT_INDEPENDENT_MATCH" }
    : { status: "CONFLICT", verificationBasis: "CONFLICT" };
  if (!registry.exact && customer.exact) return contains(registry, customer.lower)
    ? { status: "EXACT_IN_RANGE", verificationBasis: "INDEPENDENT_RANGE_SUPPORT" }
    : { status: "CONFLICT", verificationBasis: "CONFLICT" };
  if (registry.exact && !customer.exact) return contains(customer, registry.lower)
    ? { status: "RANGE_OVERLAP", verificationBasis: "INDEPENDENT_RANGE_OVERLAP" }
    : { status: "CONFLICT", verificationBasis: "CONFLICT" };
  return overlaps(registry, customer)
    ? { status: "RANGE_OVERLAP", verificationBasis: "INDEPENDENT_RANGE_OVERLAP" }
    : { status: "CONFLICT", verificationBasis: "CONFLICT" };
}

function temporalOrScopeIssue(research, chart) {
  const researchCurrentness = research.qualifiers?.currentState || research.temporal?.state;
  const chartCurrentness = chart.qualifiers?.currentState || chart.temporal?.state;
  if (researchCurrentness && chartCurrentness && normalized(researchCurrentness) !== normalized(chartCurrentness)) return "Effective date or currentness differs";
  for (const field of ["interestClassRef", "denominatorRef", "shareClass", "controlScope"]) {
    const left = research.qualifiers?.[field];
    const right = chart.qualifiers?.[field];
    if (left && right && normalized(left) !== normalized(right)) return `${field.replaceAll(/([A-Z])/g, " $1").toLowerCase()} differs`;
  }
  return null;
}

function sourceIdentityTokens(entry) {
  const { fact, source } = unwrap(entry);
  const tokens = new Set();
  (fact?.evidenceReferences || []).forEach((reference) => {
    if (reference.artifactId) tokens.add(`artifact:${normalized(reference.artifactId)}`);
    if (reference.referenceId) tokens.add(`reference:${normalized(reference.referenceId)}`);
  });
  if (source?.artifactId) tokens.add(`artifact:${normalized(source.artifactId)}`);
  if (source?.sourceRecordId) tokens.add(`record:${normalized(source.sourceRecordId)}`);
  if (source?.requestId) tokens.add(`request:${normalized(source.requestId)}`);
  if (source?.replayId) tokens.add(`replay:${normalized(source.replayId)}`);
  return tokens;
}

function independentlySourced(researchEntry, chartEntry) {
  const researchTokens = sourceIdentityTokens(researchEntry);
  const chartTokens = sourceIdentityTokens(chartEntry);
  return researchTokens.size > 0 && chartTokens.size > 0
    && ![...researchTokens].some((token) => chartTokens.has(token));
}

function relationshipMatch(research, chart) {
  if (!isEconomicOwnership(research) || !isEconomicOwnership(chart)) return false;
  return identityState(research.subject, chart.subject) !== "NO_MATCH"
    && identityState(research.object, chart.object) !== "NO_MATCH";
}

function needsConfirmation(key, researchEntry, chartEntry, reason) {
  return {
    key,
    concept: "ECONOMIC_OWNERSHIP",
    researchFact: researchEntry?.fact || null,
    chartFact: chartEntry?.fact || null,
    researchSource: researchEntry?.source || null,
    chartSource: chartEntry?.source || null,
    status: "NEEDS_CONFIRMATION",
    label: "Needs confirmation",
    detail: reason,
  };
}

function assessedRow(key, researchEntry, chartEntry) {
  const researchFact = researchEntry.fact;
  const chartFact = chartEntry.fact;
  const scopeIssue = temporalOrScopeIssue(researchFact, chartFact);
  if (scopeIssue) return needsConfirmation(key, researchEntry, chartEntry, scopeIssue);
  const comparison = compareMeasurements(researchFact.measurement, chartFact.measurement);
  const independent = independentlySourced(researchEntry, chartEntry);
  if (comparison.status === "NOT_COMPARABLE") return needsConfirmation(key, researchEntry, chartEntry, "One side has no usable exact percentage or range.");
  if (comparison.status === "CONFLICT") return {
    ...needsConfirmation(key, researchEntry, chartEntry, independent
      ? "The customer ownership value falls outside the independently sourced registry range or differs from the registry value."
      : "The customer and registry ownership values differ; independent source identity is not established."),
    status: "CONFLICT",
    label: "⚠ Discrepancy",
    verificationBasis: "CONFLICT",
  };
  if (!independent) return needsConfirmation(key, researchEntry, chartEntry, "Comparable values are present, but genuinely independent source identities were not established.");
  if (comparison.status === "EXACT_MATCH") return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Exact independent match",
    detail: "The independently sourced registry assertion matches the customer ownership value exactly.",
    verificationBasis: comparison.verificationBasis,
  };
  if (comparison.status === "EXACT_IN_RANGE") return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Verified against independent registry range",
    detail: "The independent registry supports this ownership claim. The customer exact value falls within the independently sourced registry range.",
    verificationBasis: comparison.verificationBasis,
    exactPointIndependentlyStated: false,
  };
  return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Verified against overlapping independent ranges",
    detail: "The independently sourced ownership ranges are consistent.",
    verificationBasis: comparison.verificationBasis,
  };
}

export function buildChartResearchComparison(researchEntries = [], chartEntries = []) {
  const research = researchEntries.map(unwrap).filter((entry) => isEconomicOwnership(entry.fact));
  const chart = chartEntries.map(unwrap).filter((entry) => isEconomicOwnership(entry.fact));
  const used = new Set();
  const rows = chart.map((chartEntry) => {
    const foundIndex = research.findIndex((researchEntry, index) => !used.has(index) && relationshipMatch(researchEntry.fact, chartEntry.fact));
    if (foundIndex < 0) return needsConfirmation(`chart:${chartEntry.fact.factId}`, null, chartEntry, "Customer chart ownership has no comparable independent registry assertion.");
    used.add(foundIndex);
    const researchEntry = research[foundIndex];
    return assessedRow(`${researchEntry.fact.factId}:${chartEntry.fact.factId}`, researchEntry, chartEntry);
  });
  research.forEach((researchEntry, index) => {
    if (!used.has(index)) rows.push(needsConfirmation(`research:${researchEntry.fact.factId}`, researchEntry, null, "Registry ownership has no comparable assertion in the customer chart."));
  });
  return rows;
}

export function summarizeOwnershipComparison(rows = []) {
  const summary = { independentlyVerified: 0, discrepancies: 0, needsConfirmation: 0, exactMatches: 0, independentRangeSupport: 0, independentRangeOverlap: 0 };
  rows.forEach((row) => {
    if (row.status === "INDEPENDENTLY_VERIFIED") summary.independentlyVerified += 1;
    else if (row.status === "CONFLICT") summary.discrepancies += 1;
    else summary.needsConfirmation += 1;
    if (row.verificationBasis === "EXACT_INDEPENDENT_MATCH") summary.exactMatches += 1;
    if (row.verificationBasis === "INDEPENDENT_RANGE_SUPPORT") summary.independentRangeSupport += 1;
    if (row.verificationBasis === "INDEPENDENT_RANGE_OVERLAP") summary.independentRangeOverlap += 1;
  });
  return summary;
}
