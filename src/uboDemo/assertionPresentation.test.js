import { formatAssertionMeasurement, presentCandidateFact } from "./assertionPresentation";

test("assertion presentation preserves zero, ranges, unknown values and non-percentage rights", () => {
  expect(formatAssertionMeasurement({ type: "EXACT", value: 0 })).toBe("0%");
  expect(formatAssertionMeasurement({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true })).toBe("(25%, 50%]");
  expect(formatAssertionMeasurement({ type: "UNKNOWN" })).toBe("Percentage not established");
  expect(formatAssertionMeasurement()).toBe("Non-percentage right or value not supplied");
});

test("full candidate presentation retains provenance and provisional status", () => {
  const row = presentCandidateFact({
    factId: "fact-1", type: "RELATIONSHIP", relationship: "VOTING_RIGHTS",
    subject: { name: "Alice", externalIdentifiers: [{ namespace: "PERSON", value: "1" }] },
    object: { name: "Example Ltd" }, measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
    qualifiers: { currentState: "CURRENT", evidenceSupportState: "SOURCE_SUPPORTED" },
    evidenceReferences: [{ system: "evidence-platform-v1", referenceId: "artifact-1", digest: "sha256:abc", runId: "run-1", locator: { humanReadable: "page 2" } }],
  }, { requestId: "request-1", sourceState: "LIVE" });
  expect(row.valueText).toBe("(25%, 50%]");
  expect(row.currentness).toBe("CURRENT");
  expect(row.evidence[0]).toEqual(expect.objectContaining({ referenceId: "artifact-1", digest: "sha256:abc", runId: "run-1", locator: "page 2" }));
});
