import { buildChartResearchComparison, compareMeasurements } from "./chartComparison";

const party = (name, id) => ({ name, jurisdiction: "GB", externalIdentifiers: id ? [{ namespace: "COMPANIES_HOUSE", value: id }] : [] });
const fact = (factId, subject, object, measurement) => ({ factId, type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject, object, measurement });

test("comparison distinguishes exact agreement, range consistency and discrepancies without claiming verification", () => {
  expect(compareMeasurements({ type: "EXACT", value: 25 }, { type: "EXACT", value: 25 }).status).toBe("VALUES_MATCH_UNVERIFIED");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, { type: "EXACT", value: 30 }).status).toBe("RANGE_CONSISTENT");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, { type: "EXACT", value: 25 }).status).toBe("DISCREPANCY");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, { type: "RANGE", lowerBound: 40, upperBound: 75, lowerInclusive: true, upperInclusive: false }).status).toBe("RANGES_OVERLAP");
});

test("comparison requires identity confidence and reports missing source facts", () => {
  const target = party("Example Ltd", "0001");
  const research = [
    { fact: fact("research-1", party("Alice", "person-1"), target, { type: "EXACT", value: 30 }) },
    { fact: fact("research-2", party("Bob", "person-2"), target, { type: "EXACT", value: 20 }) },
  ];
  const rows = buildChartResearchComparison(research, [
    fact("chart-1", party("Alice", "person-1"), target, { type: "EXACT", value: 30 }),
    fact("chart-2", party("Charlie", "person-3"), target, { type: "EXACT", value: 10 }),
  ]);
  expect(rows.map(({ status }) => status).sort()).toEqual(["CHART_ONLY", "RESEARCH_ONLY", "VALUES_MATCH_UNVERIFIED"]);
  expect(research[0].fact.measurement.value).toBe(30);
});

test("name-only cross-source identity is surfaced for review rather than silently merged", () => {
  const target = party("Example Ltd", "0001");
  const rows = buildChartResearchComparison([{ fact: fact("r", party("Alice"), target, { type: "EXACT", value: 30 }) }], [fact("c", party("Alice"), target, { type: "EXACT", value: 30 })]);
  expect(rows[0].status).toBe("IDENTITY_REVIEW");
});

test("an existing exact independent Evidence assessment can support only the matched assertion", () => {
  const target = party("Example Ltd", "0001");
  const researchFact = { ...fact("r", party("Alice", "person-1"), target, { type: "EXACT", value: 30 }), evidenceReferences: [{ referenceId: "registry-record-1" }] };
  const rows = buildChartResearchComparison([{ fact: researchFact }], [fact("c", party("Alice", "person-1"), target, { type: "EXACT", value: 30 })], { verifiedResearchReferenceIds: new Set(["registry-record-1"]) });
  expect(rows[0].status).toBe("INDEPENDENTLY_VERIFIED");
  expect(rows[0].label).toMatch(/this assertion\/value/);
});

test("time or scope mismatch blocks a value comparison", () => {
  const target = party("Example Ltd", "0001");
  const researchFact = { ...fact("r", party("Alice", "person-1"), target, { type: "EXACT", value: 30 }), qualifiers: { currentState: "CURRENT", shareClass: "A" } };
  const chartFact = { ...fact("c", party("Alice", "person-1"), target, { type: "EXACT", value: 30 }), qualifiers: { currentState: "HISTORICAL", shareClass: "B" } };
  expect(buildChartResearchComparison([{ fact: researchFact }], [chartFact])[0].status).toBe("SCOPE_REVIEW");
});
