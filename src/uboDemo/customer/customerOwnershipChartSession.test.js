import {
  CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY,
  chartSourceCoverage,
  clearCustomerOwnershipChartSession,
  customerOwnershipChartExtractionsForContext,
  customerOwnershipChartSessionForContext,
  readCustomerOwnershipChartExtractions,
  reusableCustomerOwnershipChartExtraction,
  saveCustomerOwnershipChartExtraction,
  writeCustomerOwnershipChartSession,
  sameCustomerCompany,
  clearCustomerOwnershipJob,
  readCustomerOwnershipJob,
  writeCustomerOwnershipJob,
} from "./customerOwnershipChartSession";
import { uboStore } from "../browserStore";

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

beforeEach(() => uboStore.clear());

test("saves and restores a company-bound structured extraction without source document bytes", () => {
  saveCustomerOwnershipChartExtraction({ context, result });

  expect(customerOwnershipChartExtractionsForContext(context)).toEqual([
    expect.objectContaining({
      companyKey: "GB|00123456|",
      result,
      calculationMethod: "EFFECTIVE_INTEREST",
    }),
  ]);
  const stored = uboStore.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY);
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

test("legacy saved results reconstruct disconnected-subject coverage without another extraction", () => {
  const legacy = {
    sourceGraph: {
      subject: { entityId: "vodafone-limited" },
      relationships: [{ relationshipId: "r1", sourceEntityId: "vodafone-group", targetEntityId: "vodafone-european-investments" }],
    },
  };
  expect(chartSourceCoverage(legacy)).toEqual({
    state: "REVIEW_REQUIRED",
    sourceRelationshipCount: 1,
    subjectConnectedRelationshipCount: 0,
    disconnectedRelationshipIds: ["r1"],
  });
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

test("reuses only a complete same-digest extraction produced by the current profile versions", () => {
  const diagram = {
    profileVersion: "ownership-chart-extraction-v2",
    schemaVersion: "ownership-chart-schema-v2",
    instructionVersion: "ownership-chart-instructions-v3",
    verificationStrategyVersion: "ownership-chart-targeted-verification-v6",
  };
  const complete = { ...result, extractionQuality: { state: "EXTRACTION_SUCCESS_COMPLETE" }, evidence: { ownershipDiagramCompleteness: diagram } };
  const records = [{ result: complete }];
  expect(reusableCustomerOwnershipChartExtraction(records, "sha256:abc123")?.result).toBe(complete);
  expect(reusableCustomerOwnershipChartExtraction(records, "sha256:different")).toBeNull();
  expect(reusableCustomerOwnershipChartExtraction(records, "sha256:abc123", { ...diagram, instructionVersion: "ownership-chart-instructions-v4" })).toBeNull();
  expect(reusableCustomerOwnershipChartExtraction([{ result: { ...complete, extractionQuality: { state: "EXTRACTION_SUCCESS_PARTIAL" } } }], "sha256:abc123")).toBeNull();
});

test("a corrected company name with the same registration number is the same company", () => {
  // Found in a demo: fixing "Vodaphone LTD" to "Vodafone Limited" started a new
  // case with no research, and the chart was compared with nothing.
  expect(sameCustomerCompany({ countryCode: "GB", registrationNumber: "01471587", legalName: "Vodaphone LTD" }, { countryCode: "gb", registrationNumber: " 01471587 ", legalName: "Vodafone Limited" })).toBe(true);
  expect(sameCustomerCompany({ countryCode: "GB", registrationNumber: "01471587", legalName: "Vodafone Limited" }, { countryCode: "GB", registrationNumber: "00000001", legalName: "Vodafone Limited" })).toBe(false);
  expect(sameCustomerCompany({ countryCode: "GB", registrationNumber: "01471587" }, { countryCode: "IE", registrationNumber: "01471587" })).toBe(false);
  // Without a number, the name is all there is.
  expect(sameCustomerCompany({ countryCode: "GB", legalName: "Example Limited" }, { countryCode: "GB", legalName: "Other Limited" })).toBe(false);
});

test("a chart reading in progress is still found after a reload, by ids alone", () => {
  writeCustomerOwnershipJob({ jobId: "job-1", demoCaseId: "case-1", artifactId: "artifact-1", correlationId: "corr-1" });
  uboStore.clear(); // a reload empties the page's memory
  expect(readCustomerOwnershipJob()).toEqual(expect.objectContaining({ jobId: "job-1", demoCaseId: "case-1" }));
  expect(Object.keys(JSON.parse(window.sessionStorage.getItem("ubo-chart-job-pointer.v1"))).sort()).toEqual(["artifactId", "correlationId", "demoCaseId", "jobId", "savedAt"]);
  clearCustomerOwnershipJob();
  expect(readCustomerOwnershipJob()).toBeNull();
});
