import {
  CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY,
  clearCustomerOwnershipChartSession,
  customerOwnershipChartExtractionsForContext,
  customerOwnershipChartSessionForContext,
  readCustomerOwnershipChartExtractions,
  saveCustomerOwnershipChartExtraction,
  writeCustomerOwnershipChartSession,
} from "./customerOwnershipChartSession";

const context = {
  demoCaseId: "case-1",
  company: {
    legalName: "Example Limited",
    registrationNumber: "00123456",
    countryCode: "GB",
  },
};

const result = {
  company: { ...context.company },
  artifact: {
    artifactId: "artifact-1",
    originalFilename: "ownership-chart.png",
    digest: "sha256:abc123",
  },
  candidateFacts: [{ factId: "fact-1" }],
};

beforeEach(() => window.localStorage.clear());

test("saves and restores a company-bound structured extraction without source document bytes", () => {
  saveCustomerOwnershipChartExtraction({ context, result });

  expect(customerOwnershipChartExtractionsForContext(context)).toEqual([
    expect.objectContaining({
      companyKey: "GB|00123456|EXAMPLE LIMITED",
      result,
      calculationMethod: "POLICY_ALL_ROUTES",
    }),
  ]);
  const stored = window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY);
  expect(stored).not.toMatch(/contentBase64|blob:|filesystemPath|storagePath|fileBytes/);
});

test("deduplicates a saved Artifact while retaining its latest calculation display choice", () => {
  saveCustomerOwnershipChartExtraction({ context, result });
  saveCustomerOwnershipChartExtraction({ context, result, calculationMethod: "ECONOMIC_EFFECTIVE_INTEREST" });

  expect(readCustomerOwnershipChartExtractions()).toHaveLength(1);
  expect(readCustomerOwnershipChartExtractions()[0].calculationMethod).toBe("ECONOMIC_EFFECTIVE_INTEREST");
});

test("a later poorer result cannot overwrite a richer extraction of the same Artifact", () => {
  const richer = { ...result, sourceGraph: { relationships: [{ relationshipId: "r1" }, { relationshipId: "r2" }, { relationshipId: "r3" }, { relationshipId: "r4" }] } };
  const poorer = { ...result, sourceGraph: { relationships: [{ relationshipId: "r1" }] } };
  saveCustomerOwnershipChartExtraction({ context, result: richer });

  expect(() => saveCustomerOwnershipChartExtraction({ context, result: poorer })).toThrow(/structurally richer/);
  expect(readCustomerOwnershipChartExtractions()[0].result.sourceGraph.relationships).toHaveLength(4);
});

test("does not offer one company's extraction to another company", () => {
  saveCustomerOwnershipChartExtraction({ context, result });
  const otherContext = {
    ...context,
    demoCaseId: "case-2",
    company: { ...context.company, registrationNumber: "00999999", legalName: "Other Limited" },
  };

  expect(customerOwnershipChartExtractionsForContext(otherContext)).toEqual([]);
});

test("fails closed when a result company does not match the company-bound replay record", () => {
  expect(() => saveCustomerOwnershipChartExtraction({
    context,
    result: { ...result, company: { ...result.company, registrationNumber: "00999999" } },
  })).toThrow(/different company/);
});

test("an active result requires both the case ID and company identity to match", () => {
  writeCustomerOwnershipChartSession({ context, result });
  expect(customerOwnershipChartSessionForContext(context)).not.toBeNull();
  expect(customerOwnershipChartSessionForContext({
    ...context,
    company: { ...context.company, legalName: "Other Limited", registrationNumber: "00999999" },
  })).toBeNull();
});

test("rejects any result that attempts to put document content into browser replay storage", () => {
  expect(() => saveCustomerOwnershipChartExtraction({
    context,
    result: { ...result, sourceDocument: { contentBase64: "c2VjcmV0" } },
  })).toThrow(/contentBase64/);
  expect(readCustomerOwnershipChartExtractions()).toEqual([]);
});

test("clearing the active chart leaves the reusable extraction library intact", () => {
  writeCustomerOwnershipChartSession({ context, result });
  saveCustomerOwnershipChartExtraction({ context, result });
  clearCustomerOwnershipChartSession();

  expect(customerOwnershipChartExtractionsForContext(context)).toHaveLength(1);
});
