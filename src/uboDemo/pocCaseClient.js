import { useCallback, useEffect, useRef } from "react";
import { clerkAuthHeaders } from "../auth/clerkFetch";
import { noteCustomerRefusal } from "../auth/customerSession";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "./demoSession";
import {
  CUSTOMER_OWNERSHIP_CHART_SESSION_KEY,
  CUSTOMER_OWNERSHIP_CHART_SESSION_VERSION,
} from "./customer/customerOwnershipChartSession";
import { compactResearchResultForTransfer } from "./customerHandoff";
import { expandSharedAnalyses, shareRepeatedAnalyses } from "./customer/recalculationStorage";
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

async function readPayload(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    noteCustomerRefusal(response.status, payload);
    throw Object.assign(new Error(payload.message || "The case could not be saved or restored right now."), { code: payload.code || payload.error, status: response.status });
  }
  return payload;
}

async function parse(response) {
  return (await readPayload(response)).case;
}

/** Whether a customer may already be working on a case, from its audit
 *  ledger: a link sent and not withdrawn, or anything the customer has done. */
export async function customerEngagement(caseId, fetchImpl = window.fetch) {
  const response = await fetchImpl(`/api/ubo-poc-case?caseId=${encodeURIComponent(caseId)}&ledger=1`, { headers: { Accept: "application/json", ...(await clerkAuthHeaders()) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(payload.message || "The case history could not be read.");
  const events = Array.isArray(payload.events) ? payload.events : [];
  let linkSent = false;
  events.forEach(({ eventType }) => {
    if (eventType === "CUSTOMER_LINK_ISSUED") linkSent = true;
    if (eventType === "CUSTOMER_LINK_REVOKED") linkSent = false;
  });
  return { linkSent, customerStarted: events.some(({ actorType }) => actorType === "CUSTOMER") };
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

/** Whether the case changed, without reading it: its round, whether it is
 *  finalised, its stage and when it last changed (api/ubo-poc-case.js). */
export async function loadPocCaseState(caseId, fetchImpl = window.fetch) {
  const response = await fetchImpl(`/api/ubo-poc-case?caseId=${encodeURIComponent(caseId)}&state=1`, { headers: { Accept: "application/json", ...(await clerkAuthHeaders()) } });
  return (await readPayload(response)).state;
}

// The round of each case as this tab shows it: from the case as loaded, then
// from each save's answer. A round starts whenever the server drops what was
// computed for the case (a reset, a reopen, a new chart or new research).
const shownRounds = new Map();

/** The round this tab shows for a case, or undefined when it does not know. */
export function shownCaseRound(caseId) {
  return shownRounds.get(caseId);
}

function noteSavedRound(caseId, record) {
  const round = record?.projection?.round;
  // A server that does not say: the round is no longer known, rather than
  // kept at a value a reset may have moved on from.
  if (round === undefined || round === null) shownRounds.delete(caseId);
  else shownRounds.set(caseId, Number(round) || 0);
}

// The case's own changes are the server's answer to "has it changed under
// me", so they are told apart from this tab's: counted as they start.
let writesStarted = 0;

/** Refused because the case moved on: finalised, or a new round started. */
export function caseMovedOn(code) {
  return code === "case_finalized" || code === "case_round_changed";
}

export const CASE_STATE_CHECK_MS = 60 * 1000;
// Coming back to the page (closing the file picker counts) checks at most this
// often: each check counts against the case read limit.
export const FOCUS_CHECK_MIN_MS = 30 * 1000;
// A page saving, or holding input not yet sent, is looked at again after this
// rather than reloaded under the customer.
export const BUSY_RECHECK_MS = 10 * 1000;
const RELOADED_FOR = "ubo-case-reloaded-for:";

/**
 * A customer page shows the case as it was when the page loaded. When the
 * server's case is no longer as the page shows it - the analyst reopened it,
 * another tab finalised it or started the questions again - the page reloads,
 * which restores the case from the server (DurablePocCaseBoundary). Without
 * this a page open before a reopen stayed locked until the customer happened to
 * reload, and a second tab finalised from answers it did not show.
 *
 * It reads only the case's state, once a minute while the page is in view and
 * when it comes back into view (at most every 30 s). It never reloads while
 * this tab is saving or `hasUnsavedWork()` says there is input not yet sent -
 * that lost the input, and the page's own "Leave site?" prompt appeared - it
 * looks again shortly instead. And it reloads at most once for any one state of
 * the case, so a page that cannot show the server's state does not reload
 * forever.
 *
 * The returned function checks now (after the server refuses a step) and
 * answers what it found: "unchanged", "reloading", "deferred", "changed" (but
 * already reloaded once for it), "skipped" or "failed".
 */
export function useReloadWhenFinalizedChanges(caseId, shownFinalized, { loadState = loadPocCaseState, reload = () => window.location.reload(), hasUnsavedWork = () => false } = {}) {
  const check = useRef(async () => "skipped");
  // Passed fresh on each render; held so the timer is not restarted by every render.
  const io = useRef({ loadState, reload, hasUnsavedWork });
  io.current = { loadState, reload, hasUnsavedWork };
  useEffect(() => {
    if (!caseId) return undefined;
    let active = true;
    let busy = false;
    let lastCheck = 0;
    let retry = null;
    const later = () => {
      clearTimeout(retry);
      retry = setTimeout(() => check.current(), BUSY_RECHECK_MS);
    };
    check.current = async ({ fromFocus = false, ignoreUnsaved = false } = {}) => {
      if (busy || (typeof document !== "undefined" && document.hidden)) return "skipped";
      if (fromFocus && Date.now() - lastCheck < FOCUS_CHECK_MIN_MS) return "skipped";
      busy = true;
      lastCheck = Date.now();
      const writesBefore = writesStarted;
      try {
        const state = await io.current.loadState(caseId);
        if (!active || !state) return "skipped";
        const round = Number(state.round) || 0;
        // A page whose case was not loaded through this module: what the
        // server holds now is what it shows.
        if (!shownRounds.has(caseId)) shownRounds.set(caseId, round);
        if (Boolean(state.finalized) === Boolean(shownFinalized) && round === shownRounds.get(caseId)) return "unchanged";
        // This tab's own write may be what moved it; its answer says so.
        if (caseWrites.has(caseId) || writesStarted !== writesBefore || (!ignoreUnsaved && io.current.hasUnsavedWork())) {
          later();
          return "deferred";
        }
        const seen = `${round}:${Boolean(state.finalized)}`;
        if (casePointerStore.getItem(`${RELOADED_FOR}${caseId}`) === seen) return "changed";
        casePointerStore.setItem(`${RELOADED_FOR}${caseId}`, seen);
        io.current.reload();
        return "reloading";
      } catch (_) {
        return "failed"; // The next check tries again; the page keeps what it shows.
      } finally { busy = false; }
    };
    const onVisible = () => { if (!document.hidden) check.current({ fromFocus: true }); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(() => check.current(), CASE_STATE_CHECK_MS);
    return () => {
      active = false;
      check.current = async () => "skipped";
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
      clearTimeout(retry);
    };
  }, [caseId, shownFinalized]);
  return useCallback((options) => check.current(options), []);
}

// One write per case at a time from this tab. An answer and the syncs it
// triggers used to reach the server together, collide on the case version and
// exhaust its retries, so the answer was refused (case_changed).
const caseWrites = new Map();
// The steps the server checks against the round they were made in: one made
// in a round a reset or reopen has since ended is refused (case_round_changed).
const ROUND_CHECKED = new Set(["SUBMIT_ANSWER", "FINALIZE_ASSESSMENT", "SYNC_RESOLUTION", "COMPLETE_IDV"]);
// ponytail: one fixed ceiling, well above a normal case write (a few seconds).
const WRITE_TIMEOUT_MS = 60 * 1000;

export function persistPocCase(operation, command, fetchImpl = window.fetch) {
  writesStarted += 1;
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
  // Writes to a case go one at a time, so one that never answers would hold up
  // every later one in this tab: it is given up on after a while. The same
  // idempotency key makes sending it again safe.
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS) : null;
  // The round this step was made in, as of when it is sent (after the writes
  // queued before it): the server refuses it once that round has ended.
  const round = ROUND_CHECKED.has(operation) ? shownRounds.get(caseId) : undefined;
  try {
    const record = await parse(await fetchImpl("/api/ubo-poc-case", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(await clerkAuthHeaders()) },
      body: JSON.stringify({ operation, caseId, payload: durablePayload, idempotencyKey, actorType, ...(round !== undefined ? { round } : {}) }),
      ...(controller ? { signal: controller.signal } : {}),
    }));
    noteSavedRound(caseId, record);
    rememberActivePocCase(caseId);
    return record;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("The server did not answer in time. Please try again."), { code: "case_write_timeout" });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  return shareRepeatedAnalyses(Object.fromEntries(Object.entries(recalculations || {}).map(([key, record]) => [key, record?.chartAnalysis
    ? { ...record, chartAnalysis: compactChartAnalysis(record.chartAnalysis) }
    : record])));
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
        recalculations: expandSharedAnalyses(compactRecalculations(projection.resolution.recalculations)),
      }));
    }
  }
  casePointerStore.setItem(ACTIVE_POC_CASE_KEY, demoCase.demoCaseId);
  shownRounds.set(demoCase.demoCaseId, Number(projection.round) || 0);
  return true;
}

export function durableCaseShareUrl(caseId, location = window.location) {
  const url = new URL(location.href);
  url.searchParams.set("case", caseId);
  return url.href;
}
