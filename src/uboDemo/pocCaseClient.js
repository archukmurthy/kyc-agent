import { clerkAuthHeaders } from "../auth/clerkFetch";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "./demoSession";
import {
  CUSTOMER_OWNERSHIP_CHART_SESSION_KEY,
  CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
} from "./customer/customerOwnershipChartSession";
import { compactResearchResultForTransfer } from "./customerHandoff";
import { casePointerStore, uboStore } from "./browserStore";

export const ACTIVE_POC_CASE_KEY = "ubo-case-pointer.v1";
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

export function activePocCaseId(storage = casePointerStore, location = window.location) {
  const requested = new URLSearchParams(location.search).get("case");
  if (requested) return requested;
  try { return storage.getItem(ACTIVE_POC_CASE_KEY) || null; } catch (_) { return null; }
}

export function rememberActivePocCase(caseId, { storage = casePointerStore, location = window.location, history = window.history } = {}) {
  if (!caseId) return;
  try { storage.setItem(ACTIVE_POC_CASE_KEY, caseId); } catch (_) { /* The server remains canonical. */ }
  const url = new URL(location.href);
  if (url.searchParams.get("case") === caseId) return;
  url.searchParams.set("case", caseId);
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function clearActivePocCase(storage = casePointerStore) {
  try { storage.removeItem(ACTIVE_POC_CASE_KEY); } catch (_) { /* No durable case is deleted. */ }
}

async function parse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw Object.assign(new Error(payload.message || "The case could not be saved or restored right now."), { code: payload.code, status: response.status });
  return payload.case;
}

/** This workspace's researched cases, newest first (staff only). */
export async function listSavedResearch(fetchImpl = window.fetch) {
  const response = await fetchImpl("/api/ubo-poc-case?savedResearch=1", { headers: { Accept: "application/json", ...(await clerkAuthHeaders()) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw Object.assign(new Error(payload.message || "Saved research could not be listed right now."), { code: payload.code, status: response.status });
  return Array.isArray(payload.research) ? payload.research : [];
}

export async function loadPocCase(caseId, fetchImpl = window.fetch) {
  if (!caseId) return null;
  return parse(await fetchImpl(`/api/ubo-poc-case?caseId=${encodeURIComponent(caseId)}`, { headers: { Accept: "application/json", ...(await clerkAuthHeaders()) } }));
}

// One write per case at a time from this tab. An answer and the syncs it
// triggers used to reach the server together, collide on the case version and
// exhaust its retries, so the answer was refused (case_changed).
const caseWrites = new Map();

export function persistPocCase(operation, command, fetchImpl = window.fetch) {
  const previous = caseWrites.get(command?.caseId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => sendPocCase(operation, command, fetchImpl));
  caseWrites.set(command?.caseId, next);
  const forget = () => { if (caseWrites.get(command?.caseId) === next) caseWrites.delete(command?.caseId); };
  next.then(forget, forget);
  return next;
}

async function sendPocCase(operation, { caseId, payload, idempotencyKey, actorType = "SYSTEM" }, fetchImpl) {
  if (!caseId) throw new TypeError("A durable case ID is required.");
  const durablePayload = compactCasePayload(payload);
  const record = await parse(await fetchImpl("/api/ubo-poc-case", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(await clerkAuthHeaders()) },
    body: JSON.stringify({ operation, caseId, payload: durablePayload, idempotencyKey, actorType }),
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
  return compactResearchResultForTransfer({ ...chartAnalysis, view: withoutImmutableSnapshot(chartAnalysis.view) });
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

function compactCasePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    ...(payload.researchResult ? { researchResult: compactResearchResultForTransfer(payload.researchResult) } : {}),
    ...(payload.chartProjection ? { chartProjection: compactChartResult(payload.chartProjection) } : {}),
    ...(payload.resolution ? {
      resolution: {
        ...payload.resolution,
        recalculations: compactRecalculations(payload.resolution.recalculations),
      },
    } : {}),
  };
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

export function hydrateBrowserFromPocCase(record, storage = uboStore) {
  const projection = record?.projection;
  const demoCase = projection?.demoCase;
  if (!demoCase?.demoCaseId || !projection?.draft) return false;
  // The case's trace is the server's current one. A copy saved inside the
  // research by records from before UBO-13 is not: after a reopen it showed a
  // finalised review that no longer is.
  const trace = projection.assessment?.trace || projection.resolution?.trace || null;
  const { ownershipResolutionTrace: _stale, ...storedResearch } = projection.researchResult || {};
  const researchResult = projection.researchResult
    ? { ...storedResearch, ...(trace ? { ownershipResolutionTrace: trace } : {}) }
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
  casePointerStore.setItem(ACTIVE_POC_CASE_KEY, demoCase.demoCaseId);
  return true;
}

export function durableCaseShareUrl(caseId, location = window.location) {
  const url = new URL(location.href);
  url.searchParams.set("case", caseId);
  return url.href;
}
