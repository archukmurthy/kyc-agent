import { chartSourceCoverage } from "./caseResolution";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { uboStore } from "../browserStore";

export const CUSTOMER_OWNERSHIP_CHART_SESSION_KEY = "ubo-demo.customer-ownership-chart.v1";
export const CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION = "ubo-demo-customer-ownership-chart-session-v1";
export const CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY = "ubo-demo.customer-ownership-chart-library.v1";
export const CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION = "ubo-demo-customer-ownership-chart-library-v1";
export const CUSTOMER_OWNERSHIP_JOB_KEY = "ubo-demo.customer-ownership-job.v1";
export const CURRENT_OWNERSHIP_EXTRACTION_PROFILE = Object.freeze({
  profileVersion: "ownership-chart-extraction-v2",
  schemaVersion: "ownership-chart-schema-v2",
  instructionVersion: "ownership-chart-instructions-v3",
  verificationStrategyVersion: "ownership-chart-targeted-verification-v6",
});
const MAX_SAVED_EXTRACTIONS = 12;

const RESEARCH_REFERENCE_KEYS = Object.freeze([
  "researchResultReference",
  "researchSessionReference",
  "researchReference",
]);

function safeParse(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function normalized(value) { return String(value || "").trim().toUpperCase(); }

export function customerCompanyKey(company) {
  return [normalized(company?.countryCode), normalized(company?.registrationNumber), normalized(company?.legalName)].join("|");
}

export function sameCustomerCompany(left, right) {
  const leftKey = customerCompanyKey(left);
  return leftKey !== "||" && leftKey === customerCompanyKey(right);
}

function resultKey(result) {
  return normalized(result?.artifact?.artifactId || result?.artifact?.digest);
}

function relationshipCount(result) {
  return (result?.sourceGraph?.relationships || []).length;
}

function assertReplaySafe(value, path = "result") {
  if (value == null || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (["contentBase64", "fileBytes", "blobUrl", "filesystemPath", "storagePath"].includes(key)) {
      throw new TypeError(`Saved extraction cannot contain ${path}.${key}.`);
    }
    assertReplaySafe(item, `${path}.${key}`);
  });
}

export function readCustomerDemoContext(storage = uboStore) {
  const session = safeParse(storage.getItem(DEMO_SESSION_KEY));
  const demoCase = session?.demoCase;
  if (!demoCase?.demoCaseId || !demoCase?.company?.legalName) return null;
  const opaqueResearchReference = RESEARCH_REFERENCE_KEYS
    .map((key) => session[key])
    .find((value) => value !== undefined) ?? null;
  return {
    company: { ...demoCase.company },
    referenceCaseId: demoCase.referenceCaseId || "",
    demoCaseId: demoCase.demoCaseId,
    opaqueResearchReference,
    researchResult: session.researchResult || null,
  };
}

export function readCustomerOwnershipChartSession(storage = uboStore) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY));
  return parsed?.contractVersion === CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION ? parsed : null;
}

export function customerOwnershipChartSessionForContext(context, storage = uboStore) {
  const session = readCustomerOwnershipChartSession(storage);
  if (!session || session.context?.demoCaseId !== context?.demoCaseId) return null;
  if (!sameCustomerCompany(session.context?.company, context?.company)) return null;
  if (session.result?.company && !sameCustomerCompany(session.result.company, context.company)) return null;
  return session;
}

export function readCustomerOwnershipChartExtractions(storage = uboStore) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY));
  if (parsed?.contractVersion !== CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION || !Array.isArray(parsed.records)) return [];
  return parsed.records.filter((record) => record?.recordId && record?.result?.artifact?.artifactId);
}

export function customerOwnershipChartExtractionsForContext(context, storage = uboStore) {
  const key = customerCompanyKey(context?.company);
  return readCustomerOwnershipChartExtractions(storage).filter((record) => record.companyKey === key
    && (!record.result?.company || sameCustomerCompany(record.result.company, context.company)));
}

export function reusableCustomerOwnershipChartExtraction(records, digest, profile = CURRENT_OWNERSHIP_EXTRACTION_PROFILE) {
  const normalizedDigest = normalized(digest);
  if (!normalizedDigest) return null;
  return (records || []).find((record) => {
    const result = record?.result;
    const diagram = result?.evidence?.ownershipDiagramCompleteness;
    return normalized(result?.artifact?.digest) === normalizedDigest
      && result?.extractionQuality?.state === "EXTRACTION_SUCCESS_COMPLETE"
      && diagram?.profileVersion === profile.profileVersion
      && diagram?.schemaVersion === profile.schemaVersion
      && diagram?.instructionVersion === profile.instructionVersion
      && diagram?.verificationStrategyVersion === profile.verificationStrategyVersion;
  }) || null;
}

export function saveCustomerOwnershipChartExtraction({ context, result, calculationMethod = "EFFECTIVE_INTEREST" }, storage = uboStore) {
  if (!context?.company || !result?.artifact?.artifactId || !resultKey(result)) throw new TypeError("A company-bound Artifact extraction is required for local replay.");
  if (result.company && !sameCustomerCompany(context.company, result.company)) throw new TypeError("The extraction belongs to a different company and cannot be saved to this case.");
  assertReplaySafe(result);
  const savedAt = new Date().toISOString();
  const recordId = `chart-extraction:${customerCompanyKey(context.company)}:${resultKey(result)}`;
  const record = {
    contractVersion: "ubo-demo-customer-ownership-chart-extraction-v1",
    recordId,
    savedAt,
    companyKey: customerCompanyKey(context.company),
    company: { ...context.company },
    result,
    calculationMethod,
  };
  const existingRecords = readCustomerOwnershipChartExtractions(storage);
  const existing = existingRecords.find((item) => item.recordId === recordId);
  if (existing && relationshipCount(existing.result) > relationshipCount(result)) {
    throw new TypeError("A structurally richer saved extraction already exists for this Artifact and was preserved.");
  }
  const records = [record, ...existingRecords.filter((item) => item.recordId !== recordId)]
    .slice(0, MAX_SAVED_EXTRACTIONS);
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY, JSON.stringify({
    contractVersion: CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION,
    savedAt,
    records,
  }));
  return records;
}

export function writeCustomerDemoCase({ draft, demoCase }, storage = uboStore) {
  const current = safeParse(storage.getItem(DEMO_SESSION_KEY));
  const sameCompany = sameCustomerCompany(current?.demoCase?.company, demoCase?.company);
  const opaqueReferences = Object.fromEntries(RESEARCH_REFERENCE_KEYS
    .filter((key) => sameCompany && current?.[key] !== undefined)
    .map((key) => [key, current[key]]));
  if (!sameCompany) clearCustomerOwnershipChartSession(storage);
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    savedAt: new Date().toISOString(),
    draft,
    demoCase,
    researchResult: sameCompany ? current?.researchResult || null : null,
    ...opaqueReferences,
  }));
}

export function writeCustomerOwnershipChartSession({ context, result, calculationMethod = "EFFECTIVE_INTEREST" }, storage = uboStore) {
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY, JSON.stringify({
    contractVersion: CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
    savedAt: new Date().toISOString(),
    context,
    result,
    calculationMethod,
  }));
}

export function clearCustomerOwnershipChartSession(storage = uboStore) {
  storage.removeItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY);
}

export function readCustomerOwnershipJob(storage = uboStore) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_JOB_KEY));
  return parsed?.jobId && parsed?.demoCaseId ? parsed : null;
}

export function writeCustomerOwnershipJob({ jobId, demoCaseId, artifactId, correlationId }, storage = uboStore) {
  storage.setItem(CUSTOMER_OWNERSHIP_JOB_KEY, JSON.stringify({ jobId, demoCaseId, artifactId, correlationId, savedAt: new Date().toISOString() }));
}

export function clearCustomerOwnershipJob(storage = uboStore) {
  storage.removeItem(CUSTOMER_OWNERSHIP_JOB_KEY);
}

// Shared with the server; see caseResolution.js.
export { chartSourceCoverage };
