import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";

export const CUSTOMER_OWNERSHIP_CHART_SESSION_KEY = "ubo-demo.customer-ownership-chart.v1";
export const CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION = "ubo-demo-customer-ownership-chart-session-v1";
export const CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY = "ubo-demo.customer-ownership-chart-library.v1";
export const CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION = "ubo-demo-customer-ownership-chart-library-v1";
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
  return normalized(result?.artifact?.digest || result?.artifact?.artifactId);
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

export function readCustomerDemoContext(storage = window.localStorage) {
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

export function readCustomerOwnershipChartSession(storage = window.localStorage) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY));
  return parsed?.contractVersion === CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION ? parsed : null;
}

export function customerOwnershipChartSessionForContext(context, storage = window.localStorage) {
  const session = readCustomerOwnershipChartSession(storage);
  if (!session || session.context?.demoCaseId !== context?.demoCaseId) return null;
  if (!sameCustomerCompany(session.context?.company, context?.company)) return null;
  if (session.result?.company && !sameCustomerCompany(session.result.company, context.company)) return null;
  return session;
}

export function readCustomerOwnershipChartExtractions(storage = window.localStorage) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY));
  if (parsed?.contractVersion !== CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION || !Array.isArray(parsed.records)) return [];
  return parsed.records.filter((record) => record?.recordId && record?.result?.artifact?.artifactId);
}

export function customerOwnershipChartExtractionsForContext(context, storage = window.localStorage) {
  const key = customerCompanyKey(context?.company);
  return readCustomerOwnershipChartExtractions(storage).filter((record) => record.companyKey === key
    && (!record.result?.company || sameCustomerCompany(record.result.company, context.company)));
}

export function saveCustomerOwnershipChartExtraction({ context, result, calculationMethod = "POLICY_ALL_ROUTES" }, storage = window.localStorage) {
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
  const records = [record, ...readCustomerOwnershipChartExtractions(storage).filter((item) => item.recordId !== recordId)]
    .slice(0, MAX_SAVED_EXTRACTIONS);
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_LIBRARY_KEY, JSON.stringify({
    contractVersion: CUSTOMER_OWNERSHIP_CHART_LIBRARY_VERSION,
    savedAt,
    records,
  }));
  return records;
}

export function writeCustomerDemoCase({ draft, demoCase }, storage = window.localStorage) {
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

export function writeCustomerOwnershipChartSession({ context, result, calculationMethod = "POLICY_ALL_ROUTES" }, storage = window.localStorage) {
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY, JSON.stringify({
    contractVersion: CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
    savedAt: new Date().toISOString(),
    context,
    result,
    calculationMethod,
  }));
}

export function clearCustomerOwnershipChartSession(storage = window.localStorage) {
  storage.removeItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY);
}
