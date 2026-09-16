import { buildChartResearchComparison, compareMeasurements, summarizeOwnershipComparison } from "./chartComparison";

const party = (name, id) => ({ name, jurisdiction: "GB", entityType: id?.startsWith("person") ? "NATURAL_PERSON" : "LEGAL_ENTITY", externalIdentifiers: id ? [{ namespace: "COMPANIES_HOUSE", value: id }] : [] });
const fact = (factId, subject, object, measurement, relationship = "ECONOMIC_OWNERSHIP", referenceId = `${factId}-source`) => ({ factId, type: "RELATIONSHIP", relationship, subject, object, measurement, evidenceReferences: [{ referenceId }] });
const entry = (value, sourceRecordId) => ({ fact: value, source: { sourceRecordId } });
const target = party("Vodafone Limited", "01471587");
const alice = party("Alice Morgan", "person-alice");

test("measurement comparison preserves exact, range and endpoint semantics", () => {
  expect(compareMeasurements({ type: "EXACT", value: 80 }, { type: "EXACT", value: 80 }).status).toBe("EXACT_MATCH");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true }, { type: "EXACT", value: 80 }).status).toBe("EXACT_IN_RANGE");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true }, { type: "EXACT", value: 75 }).status).toBe("CONFLICT");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true }, { type: "EXACT", value: 75 }).status).toBe("EXACT_IN_RANGE");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, { type: "RANGE", lowerBound: 40, upperBound: 75, lowerInclusive: true, upperInclusive: false }).status).toBe("RANGE_OVERLAP");
  expect(compareMeasurements({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: false }, { type: "RANGE", lowerBound: 50, upperBound: 75, lowerInclusive: true, upperInclusive: false }).status).toBe("CONFLICT");
  expect(compareMeasurements({ type: "UNKNOWN" }, { type: "EXACT", value: 80 }).status).toBe("NOT_COMPARABLE");
});

test("exact values from independent registry and customer sources are independently verified", () => {
  const rows = buildChartResearchComparison(
    [entry(fact("registry", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "companies-house-psc-1"), "registry-record-1")],
    [entry(fact("chart", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact-1"), "artifact-record-1")],
  );
  expect(rows[0]).toEqual(expect.objectContaining({ status: "INDEPENDENTLY_VERIFIED", verificationBasis: "EXACT_INDEPENDENT_MATCH", descriptor: "Exact independent match" }));
});

test("a customer exact value inside an independent registry range is verified without claiming the exact point came from registry", () => {
  const rows = buildChartResearchComparison(
    [entry(fact("registry", alice, target, { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true }, "ECONOMIC_OWNERSHIP", "companies-house-psc-1"), "registry-record-1")],
    [entry(fact("chart", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact-1"), "artifact-record-1")],
  );
  expect(rows[0]).toEqual(expect.objectContaining({ status: "INDEPENDENTLY_VERIFIED", verificationBasis: "INDEPENDENT_RANGE_SUPPORT", exactPointIndependentlyStated: false }));
});

test("independent overlapping ranges verify while genuinely disjoint values report a discrepancy", () => {
  const overlap = buildChartResearchComparison(
    [entry(fact("r1", alice, target, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, "ECONOMIC_OWNERSHIP", "registry-1"), "registry-record")],
    [entry(fact("c1", alice, target, { type: "RANGE", lowerBound: 40, upperBound: 75, lowerInclusive: true, upperInclusive: false }, "ECONOMIC_OWNERSHIP", "artifact-1"), "artifact-record")],
  );
  const conflict = buildChartResearchComparison(
    [entry(fact("r2", alice, target, { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: false, upperInclusive: true }, "ECONOMIC_OWNERSHIP", "registry-2"), "registry-record")],
    [entry(fact("c2", alice, target, { type: "EXACT", value: 60 }, "ECONOMIC_OWNERSHIP", "artifact-2"), "artifact-record")],
  );
  expect(overlap[0].verificationBasis).toBe("INDEPENDENT_RANGE_OVERLAP");
  expect(conflict[0]).toEqual(expect.objectContaining({ status: "CONFLICT", verificationBasis: "CONFLICT", label: "⚠ Discrepancy" }));
});

test("same-artifact facts, missing ownership and unresolved identity cannot receive a verification tick", () => {
  const sameArtifact = buildChartResearchComparison(
    [entry(fact("r", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact-1"), "shared")],
    [entry(fact("c", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact-1"), "shared")],
  );
  const noIdentity = buildChartResearchComparison(
    [entry(fact("r2", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "registry"), "registry")],
    [entry(fact("c2", party("Different person", "person-other"), target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact"), "artifact")],
  );
  expect(sameArtifact[0].status).toBe("NEEDS_CONFIRMATION");
  expect(noIdentity.map((row) => row.status)).toEqual(["NEEDS_CONFIRMATION", "NEEDS_CONFIRMATION"]);
});

test("comparison excludes voting, control and certification facts and summarizes only economic ownership", () => {
  const rows = buildChartResearchComparison([
    entry(fact("ownership-r", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "registry"), "registry"),
    entry(fact("vote-r", alice, target, { type: "EXACT", value: 80 }, "VOTING_RIGHTS", "registry-vote"), "registry"),
  ], [
    entry(fact("ownership-c", alice, target, { type: "EXACT", value: 80 }, "ECONOMIC_OWNERSHIP", "artifact"), "artifact"),
    entry(fact("control-c", alice, target, null, "FORMAL_CONTROL_RIGHT", "artifact-control"), "artifact"),
    entry({ factId: "cert", type: "ENTITY_ATTRIBUTE", attribute: "source_certification_status", subject: target, value: "FOUND", evidenceReferences: [{ artifactId: "artifact" }] }, "artifact"),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].concept).toBe("ECONOMIC_OWNERSHIP");
  expect(summarizeOwnershipComparison(rows)).toEqual({ independentlyVerified: 1, discrepancies: 0, needsConfirmation: 0, exactMatches: 1, independentRangeSupport: 0, independentRangeOverlap: 0 });
});
