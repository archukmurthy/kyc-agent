import { formatAssertionMeasurement, groupAssertionRows, presentCandidateFact } from "./assertionPresentation";

test("assertion presentation preserves zero, ranges, unknown values and non-percentage rights", () => {
  expect(formatAssertionMeasurement({ type: "EXACT", value: 0 })).toBe("0%");
  expect(formatAssertionMeasurement({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true })).toBe("(25%, 50%]");
  expect(formatAssertionMeasurement({ type: "UNKNOWN" })).toBe("Percentage not established");
  expect(formatAssertionMeasurement()).toBe("Non-percentage right or value not supplied");
});

test("assertions are grouped by meaning and repeated registry context is consolidated without losing observations", () => {
  const subject = { name: "Vodafone Limited", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE", value: "01471587" }] };
  const groups = groupAssertionRows([
    { fact: { factId: "context-1", type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", subject, value: { companyStatus: "active" }, evidenceReferences: [{ referenceId: "company-profile" }] } },
    { fact: { factId: "context-2", type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", subject, value: { companyType: "ltd" }, evidenceReferences: [{ referenceId: "company-type" }] } },
    { fact: { factId: "owner", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Alice" }, object: subject, measurement: { type: "EXACT", value: 80 } } },
  ]);
  expect(groups.map((group) => group.label)).toEqual(["Registry / entity context", "Ownership"]);
  expect(groups[0].rows).toHaveLength(1);
  expect(groups[0].rows[0].observations).toHaveLength(2);
  expect(groups[0].rows[0].evidence.map((item) => item.referenceId)).toEqual(["company-profile", "company-type"]);
});

test("customer certification is visible in its own group and remains distinct from ownership", () => {
  const groups = groupAssertionRows([
    { fact: { factId: "owner", type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject: { name: "Alice" }, object: { name: "Target" }, measurement: { type: "EXACT", value: 80 } } },
    { fact: { factId: "cert", type: "ENTITY_ATTRIBUTE", attribute: "source_certification_status", subject: { name: "Chart" }, value: "FOUND" } },
  ], { variant: "customer" });
  expect(groups.map((group) => group.label)).toEqual(["Ownership assertions", "Certification details"]);
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
