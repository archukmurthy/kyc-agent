import {
  buildAiPartyMatchCandidates,
  buildPartyStructuralContexts,
  partyFingerprint,
  resolveCrossSourceParty,
} from "./crossSourcePartyResolution";

function normalized(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }

function unwrap(entry) { return { fact: entry?.fact || entry, source: entry?.source || {} }; }
function isEconomicOwnership(fact) { return fact?.type === "RELATIONSHIP" && fact.relationship === "ECONOMIC_OWNERSHIP"; }

function customerParty(company) {
  if (!company?.legalName) return null;
  return {
    name: company.legalName,
    entityType: "LEGAL_ENTITY",
    jurisdiction: company.countryCode || company.jurisdiction || null,
    externalIdentifiers: company.registrationNumber
      ? [{ namespace: "COMPANIES_HOUSE", value: company.registrationNumber }]
      : [],
  };
}

function sameSourceParty(left, right) {
  return resolveCrossSourceParty({ sourcePartyA: left, sourcePartyB: right }).autoLinked;
}

export function filterComparisonEntriesRelevantToCustomer(entries = [], company = null) {
  const subject = customerParty(company);
  if (!subject) return entries;
  const ownership = entries.map(unwrap).filter(({ fact }) => isEconomicOwnership(fact));
  const relevantParties = [subject];
  const relevantFactIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const { fact } of ownership) {
      if (relevantFactIds.has(fact.factId) || !relevantParties.some((party) => sameSourceParty(fact.object, party))) continue;
      relevantFactIds.add(fact.factId);
      relevantParties.push(fact.subject);
      changed = true;
    }
  }
  return entries.filter((entry) => {
    const { fact } = unwrap(entry);
    return !isEconomicOwnership(fact) || relevantFactIds.has(fact.factId);
  });
}

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
  const unspecified = new Set(["", "UNKNOWN", "UNSPECIFIED", "NOT_ESTABLISHED"]);
  const researchCurrentness = normalized(research.qualifiers?.currentState || research.temporal?.state);
  const chartCurrentness = normalized(chart.qualifiers?.currentState || chart.temporal?.state);
  if (!unspecified.has(researchCurrentness) && !unspecified.has(chartCurrentness) && researchCurrentness !== chartCurrentness) return "Effective date or currentness differs";
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

function temporalScope(fact) {
  const temporal = fact?.temporal || {};
  const qualifiers = fact?.qualifiers || {};
  const state = normalized(qualifiers.currentState || temporal.state || "UNSPECIFIED");
  const from = normalized(temporal.effectiveFrom || qualifiers.effectiveFrom || "");
  const to = normalized(temporal.effectiveTo || qualifiers.effectiveTo || "");
  return { state, from, to, key: `${state}|${from}|${to}` };
}

function compatibleTemporalScope(left, right) {
  const a = temporalScope(left);
  const b = temporalScope(right);
  const unspecified = new Set(["", "UNKNOWN", "UNSPECIFIED", "NOT_ESTABLISHED"]);
  const stateCompatible = a.state === b.state || unspecified.has(a.state) || unspecified.has(b.state);
  return stateCompatible && (!a.from || !b.from || a.from === b.from) && (!a.to || !b.to || a.to === b.to);
}

function comparisonTemporalScope(left, right) {
  const a = temporalScope(left);
  const b = temporalScope(right);
  const state = !["", "UNKNOWN", "UNSPECIFIED", "NOT_ESTABLISHED"].includes(a.state) ? a.state : b.state;
  return `${state || "UNSPECIFIED"}|${a.from || b.from}|${a.to || b.to}`;
}

function relationshipResolution(research, chart, researchContexts, chartContexts, aiResolutions) {
  if (!isEconomicOwnership(research) || !isEconomicOwnership(chart) || !compatibleTemporalScope(research, chart)) return null;
  const owner = resolveCrossSourceParty({
    sourcePartyA: research.subject,
    sourcePartyB: chart.subject,
    structuralContextA: researchContexts.get(partyFingerprint(research.subject)),
    structuralContextB: chartContexts.get(partyFingerprint(chart.subject)),
    aiResolutions,
  });
  const ownedEntity = resolveCrossSourceParty({
    sourcePartyA: research.object,
    sourcePartyB: chart.object,
    structuralContextA: researchContexts.get(partyFingerprint(research.object)),
    structuralContextB: chartContexts.get(partyFingerprint(chart.object)),
    aiResolutions,
  });
  const identityResolutions = [
    { role: "OWNER", ...owner },
    { role: "OWNED_ENTITY", ...ownedEntity },
  ];
  const autoLinked = owner.autoLinked && ownedEntity.autoLinked;
  const reviewRequired = !autoLinked
    && identityResolutions.every(({ classification, autoLinked: linked }) => linked || !["DIFFERENT_ENTITY"].includes(classification))
    && identityResolutions.some(({ identityResolutionMethod }) => identityResolutionMethod === "AI_ASSISTED");
  return {
    autoLinked,
    reviewRequired,
    confidence: Math.min(owner.confidence, ownedEntity.confidence),
    identityResolutions,
    comparisonIdentity: autoLinked
      ? `${owner.comparisonIdentity}|${ownedEntity.comparisonIdentity}|ECONOMIC_OWNERSHIP|${comparisonTemporalScope(research, chart)}`
      : null,
  };
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

function assessedRow(key, researchEntry, chartEntry, identity = {}) {
  const researchFact = researchEntry.fact;
  const chartFact = chartEntry.fact;
  const scopeIssue = temporalOrScopeIssue(researchFact, chartFact);
  if (scopeIssue) return { ...needsConfirmation(key, researchEntry, chartEntry, scopeIssue), ...identity };
  const comparison = compareMeasurements(researchFact.measurement, chartFact.measurement);
  const independent = independentlySourced(researchEntry, chartEntry);
  if (comparison.status === "NOT_COMPARABLE") return { ...needsConfirmation(key, researchEntry, chartEntry, "One side has no usable exact percentage or range."), ...identity };
  if (comparison.status === "CONFLICT") return {
    ...needsConfirmation(key, researchEntry, chartEntry, independent
      ? "The customer ownership value falls outside the independently sourced registry range or differs from the registry value."
      : "The customer and registry ownership values differ; independent source identity is not established."),
    status: "CONFLICT",
    label: "⚠ Discrepancy",
    verificationBasis: "CONFLICT",
    ...identity,
  };
  if (!independent) return { ...needsConfirmation(key, researchEntry, chartEntry, "Comparable values are present, but genuinely independent source identities were not established."), ...identity };
  if (comparison.status === "EXACT_MATCH") return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Exact independent match",
    detail: "The independently sourced registry assertion matches the customer ownership value exactly.",
    verificationBasis: comparison.verificationBasis,
    ...identity,
  };
  if (comparison.status === "EXACT_IN_RANGE") return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Verified against independent registry range",
    detail: "The independent registry supports this ownership claim. The customer exact value falls within the independently sourced registry range.",
    verificationBasis: comparison.verificationBasis,
    exactPointIndependentlyStated: false,
    ...identity,
  };
  return {
    ...needsConfirmation(key, researchEntry, chartEntry),
    status: "INDEPENDENTLY_VERIFIED",
    label: "✓ Independently verified",
    descriptor: "Verified against overlapping independent ranges",
    detail: "The independently sourced ownership ranges are consistent.",
    verificationBasis: comparison.verificationBasis,
    ...identity,
  };
}

export function buildChartResearchComparison(researchEntries = [], chartEntries = [], { aiResolutions = [] } = {}) {
  const research = researchEntries.map(unwrap).filter((entry) => isEconomicOwnership(entry.fact));
  const chart = chartEntries.map(unwrap).filter((entry) => isEconomicOwnership(entry.fact));
  const researchContexts = buildPartyStructuralContexts(research.map(({ fact }) => fact));
  const chartContexts = buildPartyStructuralContexts(chart.map(({ fact }) => fact));
  const used = new Set();
  const rows = chart.map((chartEntry) => {
    const candidates = research.map((researchEntry, index) => ({
      index,
      researchEntry,
      resolution: used.has(index) ? null : relationshipResolution(researchEntry.fact, chartEntry.fact, researchContexts, chartContexts, aiResolutions),
    })).filter(({ resolution }) => resolution);
    const automatic = candidates.filter(({ resolution }) => resolution.autoLinked).sort((left, right) => right.resolution.confidence - left.resolution.confidence);
    const uniqueAutomatic = automatic.length === 1 || (automatic[0]?.resolution.confidence - automatic[1]?.resolution.confidence > 0.01) ? automatic[0] : null;
    if (!uniqueAutomatic) {
      const review = candidates.filter(({ resolution }) => resolution.reviewRequired);
      if (review.length === 1) {
        used.add(review[0].index);
        return {
          ...needsConfirmation(`${review[0].researchEntry.fact.factId}:${chartEntry.fact.factId}`, review[0].researchEntry, chartEntry, "The relationship is comparable, but one or more party identities still need confirmation."),
          identityResolutions: review[0].resolution.identityResolutions,
        };
      }
      return needsConfirmation(`chart:${chartEntry.fact.factId}`, null, chartEntry, "Chart only — not independently corroborated by current research.");
    }
    const foundIndex = uniqueAutomatic.index;
    used.add(foundIndex);
    const researchEntry = research[foundIndex];
    return assessedRow(uniqueAutomatic.resolution.comparisonIdentity, researchEntry, chartEntry, {
      canonicalComparisonIdentity: uniqueAutomatic.resolution.comparisonIdentity,
      identityResolutions: uniqueAutomatic.resolution.identityResolutions,
    });
  });
  research.forEach((researchEntry, index) => {
    if (!used.has(index)) rows.push(needsConfirmation(`research:${researchEntry.fact.factId}`, researchEntry, null, "Research only — need confirmation from customer."));
  });
  return rows;
}

export function buildChartResearchIdentityCandidates(researchEntries = [], chartEntries = []) {
  const researchFacts = researchEntries.map(unwrap).map(({ fact }) => fact).filter(isEconomicOwnership);
  const chartFacts = chartEntries.map(unwrap).map(({ fact }) => fact).filter(isEconomicOwnership);
  return buildAiPartyMatchCandidates(researchFacts, chartFacts);
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
