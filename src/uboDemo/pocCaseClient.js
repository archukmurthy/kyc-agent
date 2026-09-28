import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "./demoSession";
import {
  CUSTOMER_OWNERSHIP_CHART_SESSION_KEY,
  CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
} from "./customer/customerOwnershipChartSession";

export const ACTIVE_POC_CASE_KEY = "ubo-demo.active-poc-case.v1";
const RESOLUTION_PREFIX = "ubo-demo.ownership-resolution.v1";
const OWNERSHIP_RESOLUTION_SESSION_VERSION = "ubo-ownership-resolution-session-v1";

export function smallStableHash(value) {
  const input = JSON.stringify(value);
  let result = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function activePocCaseId(storage = window.localStorage, location = window.location) {
  const requested = new URLSearchParams(location.search).get("case");
  if (requested) return requested;
  try { return storage.getItem(ACTIVE_POC_CASE_KEY) || null; } catch (_) { return null; }
}

export function rememberActivePocCase(caseId, { storage = window.localStorage, location = window.location, history = window.history } = {}) {
  if (!caseId) return;
  try { storage.setItem(ACTIVE_POC_CASE_KEY, caseId); } catch (_) { /* The server remains canonical. */ }
  const url = new URL(location.href);
  if (url.searchParams.get("case") === caseId) return;
  url.searchParams.set("case", caseId);
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function clearActivePocCase(storage = window.localStorage) {
  try { storage.removeItem(ACTIVE_POC_CASE_KEY); } catch (_) { /* No durable case is deleted. */ }
}

async function parse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw Object.assign(new Error(payload.message || "The case could not be saved or restored right now."), { code: payload.code, status: response.status });
  return payload.case;
}

export async function loadPocCase(caseId, fetchImpl = window.fetch) {
  if (!caseId) return null;
  return parse(await fetchImpl(`/api/ubo-poc-case?caseId=${encodeURIComponent(caseId)}`, { headers: { Accept: "application/json" } }));
}

export async function persistPocCase(operation, { caseId, payload, idempotencyKey, actorType = "SYSTEM" }, fetchImpl = window.fetch) {
  if (!caseId) throw new TypeError("A durable case ID is required.");
  const record = await parse(await fetchImpl("/api/ubo-poc-case", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ operation, caseId, payload, idempotencyKey, actorType }),
  }));
  rememberActivePocCase(caseId);
  return record;
}

function resolutionSessionKey(caseId, artifactId) { return `${RESOLUTION_PREFIX}:${caseId}:${artifactId}`; }

function withoutImmutableSnapshot(view) {
  if (!view || typeof view !== "object") return view;
  const { snapshot: _snapshot, ...browserView } = view;
  return browserView;
}

function compactChartAnalysis(chartAnalysis) {
  if (!chartAnalysis?.view) return chartAnalysis;
  return { ...chartAnalysis, view: withoutImmutableSnapshot(chartAnalysis.view) };
}

function compactChartResult(result) {
  if (!result?.chartAnalysis) return result;
  return { ...result, chartAnalysis: compactChartAnalysis(result.chartAnalysis) };
}

function compactRecalculations(recalculations = {}) {
  return Object.fromEntries(Object.entries(recalculations).map(([key, record]) => [key, record?.chartAnalysis
    ? { ...record, chartAnalysis: compactChartAnalysis(record.chartAnalysis) }
    : record]));
}

function clearRestoredProjection(storage) {
  storage.removeItem(DEMO_SESSION_KEY);
  storage.removeItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY);
  const resolutionKeys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${RESOLUTION_PREFIX}:`)) resolutionKeys.push(key);
  }
  resolutionKeys.forEach((key) => storage.removeItem(key));
}

export function hydrateBrowserFromPocCase(record, storage = window.localStorage) {
  const projection = record?.projection;
  const demoCase = projection?.demoCase;
  if (!demoCase?.demoCaseId || !projection?.draft) return false;
  const trace = projection.assessment?.trace || projection.resolution?.trace || projection.researchResult?.ownershipResolutionTrace || null;
  const researchResult = projection.researchResult
    ? { ...projection.researchResult, ...(trace ? { ownershipResolutionTrace: trace } : {}) }
    : trace ? { ownershipResolutionTrace: trace } : null;
  const browserResearchResult = researchResult?.view
    ? { ...researchResult, view: withoutImmutableSnapshot(researchResult.view) }
    : researchResult;
  clearRestoredProjection(storage);
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    savedAt: record.updatedAt || new Date().toISOString(),
    draft: projection.draft,
    demoCase,
    researchResult: browserResearchResult,
  }));
  const extraction = record.extraction;
  if (projection.chartReference && (projection.chartProjection || extraction?.result)) {
    const result = {
      ...compactChartResult(projection.chartProjection || extraction.result),
      durableExtraction: { jobId: extraction.jobId, artifactId: extraction.artifactId, state: extraction.state },
    };
    const context = {
      company: { ...demoCase.company },
      referenceCaseId: demoCase.referenceCaseId || "",
      demoCaseId: demoCase.demoCaseId,
      opaqueResearchReference: researchResult?.jobId || null,
      researchResult: trace ? { ownershipResolutionTrace: trace } : null,
    };
    storage.setItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY, JSON.stringify({
      contractVersion: CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
      savedAt: record.updatedAt || new Date().toISOString(),
      context,
      result,
      calculationMethod: projection.chartReference.calculationMethod || "EFFECTIVE_INTEREST",
    }));
    if (projection.resolution) {
      storage.setItem(resolutionSessionKey(demoCase.demoCaseId, extraction.artifactId), JSON.stringify({
        contractVersion: OWNERSHIP_RESOLUTION_SESSION_VERSION,
        savedAt: record.updatedAt || new Date().toISOString(),
        createdAt: projection.resolution.createdAt,
        answers: projection.resolution.answers || {},
        evidence: projection.resolution.evidence || {},
        recalculations: compactRecalculations(projection.resolution.recalculations),
      }));
    }
  }
  storage.setItem(ACTIVE_POC_CASE_KEY, demoCase.demoCaseId);
  return true;
}

export function durableCaseShareUrl(caseId, location = window.location) {
  const url = new URL(location.href);
  url.searchParams.set("case", caseId);
  return url.href;
}
