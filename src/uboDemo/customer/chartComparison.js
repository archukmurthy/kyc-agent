function normalized(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }
function identifiers(party) { return new Set((party?.externalIdentifiers || []).map((item) => `${normalized(item.namespace || item.system || item.identifierType)}:${normalized(item.value)}`).filter((item) => !item.endsWith(":"))); }
function sharesIdentifier(left, right) { const rightIds = identifiers(right); return [...identifiers(left)].some((id) => rightIds.has(id)); }
function sameName(left, right) { return normalized(left?.name) && normalized(left?.name) === normalized(right?.name); }
function compatibleJurisdiction(left, right) { return !left?.jurisdiction || !right?.jurisdiction || normalized(left.jurisdiction) === normalized(right.jurisdiction); }

function identityState(left, right) {
  if (sharesIdentifier(left, right)) return "IDENTIFIER_MATCH";
  if (sameName(left, right) && compatibleJurisdiction(left, right)) return "NAME_MATCH_REVIEW_REQUIRED";
  return "NO_MATCH";
}

function concept(fact) { return fact.type === "RELATIONSHIP" ? fact.relationship : fact.attribute || fact.type; }
function measurement(fact) { return fact.measurement || null; }
function interval(value) {
  if (!value || value.type === "UNKNOWN") return null;
  if (value.type === "EXACT" && value.value != null) return { lower: Number(value.value), upper: Number(value.value), lowerInclusive: true, upperInclusive: true, exact: true };
  if (value.type === "RANGE") return { lower: value.lowerBound == null ? -Infinity : Number(value.lowerBound), upper: value.upperBound == null ? Infinity : Number(value.upperBound), lowerInclusive: Boolean(value.lowerInclusive), upperInclusive: Boolean(value.upperInclusive), exact: false };
  return null;
}
function contains(range, point) { return (point > range.lower && point < range.upper) || (point === range.lower && range.lowerInclusive) || (point === range.upper && range.upperInclusive); }
function overlaps(left, right) { return (left.lower < right.upper && right.lower < left.upper) || (left.upper === right.lower && left.upperInclusive && right.lowerInclusive) || (right.upper === left.lower && right.upperInclusive && left.lowerInclusive); }

export function compareMeasurements(research, chart) {
  const left = interval(research); const right = interval(chart);
  if (!left || !right) return { status: "CANNOT_COMPARE", label: "Cannot compare — measurement missing or non-percentage" };
  if (left.exact && right.exact) return left.lower === right.lower
    ? { status: "VALUES_MATCH_UNVERIFIED", label: "Values match — independent verification not established" }
    : { status: "DISCREPANCY", label: "Discrepancy — exact values differ" };
  if (left.exact || right.exact) {
    const exact = left.exact ? left : right; const range = left.exact ? right : left;
    return contains(range, exact.lower)
      ? { status: "RANGE_CONSISTENT", label: "Consistent with registry range — exact value not verified" }
      : { status: "DISCREPANCY", label: "Discrepancy — exact value falls outside the recorded range" };
  }
  return overlaps(left, right)
    ? { status: "RANGES_OVERLAP", label: "Partially consistent — precision remains open" }
    : { status: "DISCREPANCY", label: "Discrepancy — review required" };
}

function temporalOrScopeIssue(research, chart) {
  const researchCurrentness = research.qualifiers?.currentState || research.temporal?.state;
  const chartCurrentness = chart.qualifiers?.currentState || chart.temporal?.state;
  if (researchCurrentness && chartCurrentness && normalized(researchCurrentness) !== normalized(chartCurrentness)) return "effective date/currentness differs";
  for (const field of ["interestClassRef", "denominatorRef", "shareClass", "controlScope"]) {
    const left = research.qualifiers?.[field]; const right = chart.qualifiers?.[field];
    if (left && right && normalized(left) !== normalized(right)) return `${field.replaceAll(/([A-Z])/g, " $1").toLowerCase()} differs`;
  }
  return null;
}

function referenceIds(fact) { return new Set((fact.evidenceReferences || []).flatMap((reference) => [reference.referenceId, reference.artifactId]).filter(Boolean)); }

function relationshipMatch(research, chart) {
  if (research.type !== "RELATIONSHIP" || chart.type !== "RELATIONSHIP" || concept(research) !== concept(chart)) return null;
  const subject = identityState(research.subject, chart.subject);
  const object = identityState(research.object, chart.object);
  if (subject === "NO_MATCH" || object === "NO_MATCH") return null;
  return { subject, object, needsIdentityReview: subject === "NAME_MATCH_REVIEW_REQUIRED" || object === "NAME_MATCH_REVIEW_REQUIRED" };
}

export function buildChartResearchComparison(researchEntries = [], chartFacts = [], { verifiedResearchReferenceIds = new Set() } = {}) {
  const research = researchEntries.map((entry) => entry.fact || entry);
  const used = new Set();
  const rows = chartFacts.map((chartFact) => {
    let found = null;
    for (let index = 0; index < research.length; index += 1) {
      if (used.has(index)) continue;
      const identity = relationshipMatch(research[index], chartFact);
      if (identity) { found = { fact: research[index], index, identity }; break; }
    }
    if (!found) return { key: `chart:${chartFact.factId}`, concept: concept(chartFact), chartFact, researchFact: null, status: "CHART_ONLY", label: "Not corroborated here — confirmation/evidence needed" };
    used.add(found.index);
    if (found.identity.needsIdentityReview) return { key: `${found.fact.factId}:${chartFact.factId}`, concept: concept(chartFact), chartFact, researchFact: found.fact, status: "IDENTITY_REVIEW", label: "Needs clarification — identity match needs confirmation" };
    const scopeIssue = temporalOrScopeIssue(found.fact, chartFact);
    if (scopeIssue) return { key: `${found.fact.factId}:${chartFact.factId}`, concept: concept(chartFact), chartFact, researchFact: found.fact, status: "SCOPE_REVIEW", label: `Needs clarification — ${scopeIssue}` };
    const comparison = compareMeasurements(measurement(found.fact), measurement(chartFact));
    const independentlyVerified = comparison.status === "VALUES_MATCH_UNVERIFIED" && [...referenceIds(found.fact)].some((id) => verifiedResearchReferenceIds.has(id));
    return { key: `${found.fact.factId}:${chartFact.factId}`, concept: concept(chartFact), chartFact, researchFact: found.fact, ...(independentlyVerified ? { status: "INDEPENDENTLY_VERIFIED", label: "✓ Independently verified — this assertion/value" } : comparison) };
  });
  research.forEach((fact, index) => { if (!used.has(index) && fact.type === "RELATIONSHIP") rows.push({ key: `research:${fact.factId}`, concept: concept(fact), researchFact: fact, chartFact: null, status: "RESEARCH_ONLY", label: "Not corroborated here — confirmation/evidence needed" }); });
  return rows;
}
