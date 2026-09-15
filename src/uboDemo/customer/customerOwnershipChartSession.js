import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";

export const CUSTOMER_OWNERSHIP_CHART_SESSION_KEY = "ubo-demo.customer-ownership-chart.v1";
export const CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION = "ubo-demo-customer-ownership-chart-session-v1";

const RESEARCH_REFERENCE_KEYS = Object.freeze([
  "researchResultReference",
  "researchSessionReference",
  "researchReference",
]);

function safeParse(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
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
  };
}

export function readCustomerOwnershipChartSession(storage = window.localStorage) {
  const parsed = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY));
  return parsed?.contractVersion === CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION ? parsed : null;
}

export function writeCustomerDemoCase({ draft, demoCase }, storage = window.localStorage) {
  const current = safeParse(storage.getItem(DEMO_SESSION_KEY));
  const opaqueReferences = Object.fromEntries(RESEARCH_REFERENCE_KEYS
    .filter((key) => current?.[key] !== undefined)
    .map((key) => [key, current[key]]));
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    savedAt: new Date().toISOString(),
    draft,
    demoCase,
    researchResult: null,
    ...opaqueReferences,
  }));
}

export function writeCustomerOwnershipChartSession({ context, result }, storage = window.localStorage) {
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY, JSON.stringify({
    contractVersion: CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
    savedAt: new Date().toISOString(),
    context,
    result,
  }));
}

export function clearCustomerOwnershipChartSession(storage = window.localStorage) {
  storage.removeItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY);
}
