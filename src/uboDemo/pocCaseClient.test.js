import React from "react";
import { act, render } from "@testing-library/react";
import {
  ACTIVE_POC_CASE_KEY,
  activePocCaseId,
  BUSY_RECHECK_MS,
  CASE_STATE_CHECK_MS,
  caseMovedOn,
  hydrateBrowserFromPocCase,
  loadPocCase,
  loadPocCaseState,
  persistPocCase,
  shownCaseRound,
  useReloadWhenFinalizedChanges,
} from "./pocCaseClient";
import { DEMO_SESSION_KEY } from "./demoSession";
import { CUSTOMER_OWNERSHIP_CHART_SESSION_KEY } from "./customer/customerOwnershipChartSession";
import { uboStore } from "./browserStore";
import { expandSharedAnalyses } from "./customer/recalculationStorage";
import { clearCustomerSession, onCustomerSessionEnded, setCustomerSession } from "../auth/customerSession";

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}

const record = {
  caseId: "case-cross-session",
  updatedAt: "2026-09-27T10:00:00.000Z",
  extraction: { jobId: "job-1", artifactId: "artifact-1", state: "COMPLETE", result: { candidateFacts: [] } },
  projection: {
    draft: { name: "Example Limited" },
    demoCase: { demoCaseId: "case-cross-session", company: { name: "Example Limited", companyNumber: "01234567" } },
    researchResult: { status: "COMPLETE", candidateSources: [] },
    chartReference: { artifactId: "artifact-1", jobId: "job-1", calculationMethod: "EFFECTIVE_INTEREST" },
    chartProjection: { chartAnalysis: { entities: [], relationships: [] } },
    resolution: { createdAt: "2026-09-27T10:01:00.000Z", answers: { q1: { value: "NO" } }, evidence: {}, recalculations: {} },
  },
};

beforeEach(() => uboStore.clear());

test("loads a case by durable identifier rather than browser state", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: record }));
  await expect(loadPocCase("case-cross-session", fetchImpl)).resolves.toEqual(record);
  expect(fetchImpl).toHaveBeenCalledWith("/api/ubo-poc-case?caseId=case-cross-session", { headers: { Accept: "application/json" } });
});

test("rehydrates a fresh browser from the server projection", () => {
  expect(hydrateBrowserFromPocCase(record)).toBe(true);
  expect(JSON.parse(uboStore.getItem(DEMO_SESSION_KEY)).demoCase.demoCaseId).toBe("case-cross-session");
  expect(JSON.parse(uboStore.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).result.durableExtraction).toEqual({ jobId: "job-1", artifactId: "artifact-1", state: "COMPLETE" });
  expect(activePocCaseId()).toBe("case-cross-session");
});

test("rehydrates the durable assessment trace when the case has no research projection", () => {
  const trace = { discoveryState: "READY_FOR_IDV", verificationAssessment: { subjects: [{ personId: "alice" }] } };
  const assessmentOnly = {
    ...record,
    projection: { ...record.projection, researchResult: undefined, assessment: { trace } },
  };

  expect(hydrateBrowserFromPocCase(assessmentOnly)).toBe(true);
  expect(JSON.parse(uboStore.getItem(DEMO_SESSION_KEY)).researchResult.ownershipResolutionTrace).toEqual(trace);
  expect(JSON.parse(uboStore.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).context.researchResult.ownershipResolutionTrace).toEqual(trace);
});

test("rehydration compacts duplicated immutable snapshots and replaces stale case caches", () => {
  const values = new Map([
    ["ubo-demo.ownership-resolution.v1:stale-case:stale-artifact", "stale"],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) {
      const next = new Map(values); next.set(key, String(value));
      const characters = [...next.values()].reduce((total, item) => total + item.length, 0);
      if (characters > 5000) throw new DOMException("quota reached", "QuotaExceededError");
      values.set(key, String(value));
    },
  };
  const largeSnapshot = { decisionContent: "x".repeat(4000) };
  const chartAnalysis = { view: { snapshot: largeSnapshot, graph: { nodes: [], relationships: [] }, qualifications: [] } };
  const quotaRecord = {
    ...record,
    projection: {
      ...record.projection,
      researchResult: { ...record.projection.researchResult, view: { snapshot: largeSnapshot, graph: { nodes: [], relationships: [] } } },
      chartProjection: { ...record.projection.chartProjection, chartAnalysis },
      resolution: { ...record.projection.resolution, recalculations: { q1: { chartAnalysis, determination: "UBO" } } },
    },
  };

  expect(hydrateBrowserFromPocCase(quotaRecord, storage)).toBe(true);
  expect(values.has("ubo-demo.ownership-resolution.v1:stale-case:stale-artifact")).toBe(false);
  expect(JSON.parse(values.get(DEMO_SESSION_KEY)).researchResult.view.snapshot).toBeUndefined();
  expect(JSON.parse(values.get(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).result.chartAnalysis.view.snapshot).toBeUndefined();
  expect(JSON.parse(values.get("ubo-demo.ownership-resolution.v1:case-cross-session:artifact-1")).recalculations.q1.chartAnalysis.view.snapshot).toBeUndefined();
});

test("a duplicate browser submission carries the same idempotency key", async () => {
  // A save answers with the case's round (api/ubo-poc-case.js savedRecord).
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: { ...record, projection: { ...record.projection, round: 0 } } }));
  const command = { caseId: "case-cross-session", idempotencyKey: "answer:q1:no", actorType: "CUSTOMER", payload: { resolution: { answers: { q1: { value: "NO" } } } } };
  await persistPocCase("SUBMIT_ANSWER", command, fetchImpl);
  await persistPocCase("SUBMIT_ANSWER", command, fetchImpl);
  const bodies = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(bodies[0].idempotencyKey).toBe("answer:q1:no");
  expect(bodies[1]).toEqual(bodies[0]);
  // The only thing kept in the browser is which case this tab is on (UBO-22).
  expect(window.sessionStorage.getItem(ACTIVE_POC_CASE_KEY)).toBe("case-cross-session");
  expect(window.localStorage.length).toBe(0);
  expect(Object.keys(window.sessionStorage)).toEqual([ACTIVE_POC_CASE_KEY]);
});

test("writes to one case go one at a time, and a refused write does not block the next", async () => {
  // An answer and the syncs it triggers used to race each other on the server
  // until its retries ran out and the answer was refused (case_changed).
  const pending = [];
  const fetchImpl = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
  const command = (key) => ({ caseId: "case-serial", idempotencyKey: key, payload: {} });
  const answer = persistPocCase("SUBMIT_ANSWER", command("answer:1"), fetchImpl);
  const sync = persistPocCase("SYNC_RESOLUTION", command("resolution:1"), fetchImpl);
  const otherCase = persistPocCase("SYNC_RESOLUTION", { ...command("resolution:2"), caseId: "case-other" }, fetchImpl);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body).idempotencyKey)).toEqual(["answer:1", "resolution:2"]);
  pending[0](response({ success: false, code: "case_changed" }, false));
  await expect(answer).rejects.toMatchObject({ code: "case_changed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).idempotencyKey).toBe("resolution:1");
  pending[1](response({ success: true, case: record }));
  pending[2](response({ success: true, case: record }));
  await expect(sync).resolves.toEqual(record);
  await expect(otherCase).resolves.toEqual(record);
});

test("research persistence sends the bounded transfer projection instead of duplicated immutable internals", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: record }));
  const researchResult = {
    status: "PARTIAL",
    candidateSources: [{ candidateFacts: [{ factId: "fact-1" }] }],
    view: {
      snapshot: { decisionContent: "x".repeat(20000) },
      graph: {
        nodes: [{ entityId: "person", qualificationAssessment: { repeated: "x".repeat(20000) } }],
        relationships: [{ relationshipId: "edge-1", subjectEntityId: "person", objectEntityId: "company" }],
        qualificationBasisRecords: [],
        personQualificationAssessments: [],
        llpAttributionAssessments: [{ repeated: "x".repeat(20000) }],
      },
    },
  };
  await persistPocCase("SAVE_RESEARCH", { caseId: "case-cross-session", idempotencyKey: "research:bounded", payload: { draft: {}, demoCase: record.projection.demoCase, researchResult } }, fetchImpl);
  const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(sent.payload.researchResult.candidateSources).toEqual(researchResult.candidateSources);
  expect(sent.payload.researchResult.view.snapshot).toBeUndefined();
  expect(sent.payload.researchResult.view.graph.relationships).toEqual(researchResult.view.graph.relationships);
  expect(sent.payload.researchResult.view.graph.llpAttributionAssessments).toBeUndefined();
  expect(fetchImpl.mock.calls[0][1].body.length).toBeLessThan(10000);
});

test("final assessment persistence bounds repeated research and recalculation analyses", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: record }));
  const repeated = "x".repeat(20000);
  const chartAnalysis = {
    entityLabels: { person: "Alice Morgan" },
    view: {
      snapshot: { repeated },
      graph: {
        nodes: [{ entityId: "person", qualificationAssessment: { repeated } }],
        relationships: [{ relationshipId: "edge-1", subjectEntityId: "person", objectEntityId: "company" }],
        qualificationBasisRecords: [],
        personQualificationAssessments: [],
        percentageEvidenceAssessments: [{ repeated }],
      },
      qualificationBases: [],
      qualifications: [],
    },
  };
  await persistPocCase("FINALIZE_ASSESSMENT", {
    caseId: "case-cross-session",
    idempotencyKey: "assessment:bounded",
    payload: {
      researchResult: { status: "COMPLETE", candidateSources: [{ candidateFacts: [{ factId: "fact-1" }] }], ...chartAnalysis },
      chartProjection: { candidateFacts: [{ factId: "chart-fact" }], chartAnalysis },
      resolution: {
        answers: { q1: { value: 40 } },
        recalculations: {
          q1: { determination: "UBO", chartAnalysis },
          q2: { determination: "NOT_UBO", chartAnalysis },
        },
      },
    },
  }, fetchImpl);

  const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(request.payload.researchResult.view.snapshot).toBeUndefined();
  expect(request.payload.chartProjection.chartAnalysis.view.snapshot).toBeUndefined();
  expect(request.payload.resolution.recalculations.q1.chartAnalysis.view.graph.percentageEvidenceAssessments).toBeUndefined();
  // The same analysis for both rows travels once; reading it back restores it.
  expect(request.payload.resolution.recalculations.q2.chartAnalysisSameAs).toBe("q1");
  expect(expandSharedAnalyses(request.payload.resolution.recalculations).q2.chartAnalysis.view.graph.relationships).toHaveLength(1);
  expect(request.payload.researchResult.candidateSources[0].candidateFacts).toHaveLength(1);
  expect(fetchImpl.mock.calls[0][1].body.length).toBeLessThan(15000);
});

test("a write that never answers is given up on, and the next write to the case goes ahead", async () => {
  jest.useFakeTimers();
  try {
    const fetchImpl = jest.fn((url, options) => new Promise((resolve, reject) => {
      if (fetchImpl.mock.calls.length === 1) options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      else resolve(response({ success: true, case: record }));
    }));
    const hung = persistPocCase("SUBMIT_ANSWER", { caseId: "case-hung", idempotencyKey: "answer:1", payload: {} }, fetchImpl);
    const next = persistPocCase("SYNC_RESOLUTION", { caseId: "case-hung", idempotencyKey: "resolution:1", payload: {} }, fetchImpl);
    for (let tick = 0; tick < 50 && fetchImpl.mock.calls.length < 1; tick += 1) await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60 * 1000);
    await expect(hung).rejects.toMatchObject({ code: "case_write_timeout" });
    await expect(next).resolves.toEqual(record);
  } finally {
    jest.useRealTimers();
  }
});

// Review (2026-10-09): a save refused because the customer's link was replaced
// failed with a generic message; the customer gate is told instead.
test("a case read or write refused for an ended customer session is reported", async () => {
  setCustomerSession({ session: "s-1", caseId: "case-1" });
  const ended = jest.fn();
  const stop = onCustomerSessionEnded(ended);
  try {
    const refused = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "customer_session_invalid", message: "This link has expired or been withdrawn." }) }));
    await expect(persistPocCase("SUBMIT_ANSWER", { caseId: "case-1", idempotencyKey: "answer:ended", payload: {} }, refused)).rejects.toMatchObject({ status: 401 });
    await expect(loadPocCase("case-1", refused)).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    clearCustomerSession();
  }
});

// A customer page open before the analyst reopened the review stayed locked
// until the customer happened to reload (review, 2026-10-09).
describe("a customer page notices the server's case changing under it", () => {
  let checkNow;
  function Page({ caseId = "case-1", shownFinalized, loadState, reload, hasUnsavedWork }) {
    checkNow = useReloadWhenFinalizedChanges(caseId, shownFinalized, { loadState, reload, hasUnsavedWork });
    return null;
  }
  const page = (props) => render(React.createElement(Page, props));
  const shownAt = (caseId, round) => hydrateBrowserFromPocCase({ ...record, caseId, projection: { ...record.projection, round, demoCase: { ...record.projection.demoCase, demoCaseId: caseId } } });
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => jest.useRealTimers());

  test("a page shown as finalised reloads once the server's case is reopened", async () => {
    jest.useFakeTimers();
    const loadState = jest.fn(async () => ({ round: 0, finalized: false }));
    const reload = jest.fn();
    page({ shownFinalized: true, loadState, reload });
    expect(loadState).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(CASE_STATE_CHECK_MS); });
    expect(loadState).toHaveBeenCalledWith("case-1");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("coming back to the page checks at once; a page that matches the server stays as it is", async () => {
    const loadState = jest.fn(async () => ({ round: 0, finalized: true }));
    const reload = jest.fn();
    page({ shownFinalized: true, loadState, reload });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(loadState).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  // Review (2026-10-09): only finalisation was compared, so a second tab was
  // never refreshed after "Start questions again" in another and finalised
  // from server answers it did not show.
  test("a page reloads when another tab started a new round (a reset), though nothing was finalised", async () => {
    shownAt("case-round", 2);
    const loadState = jest.fn(async () => ({ round: 3, finalized: false }));
    const reload = jest.fn();
    page({ caseId: "case-round", shownFinalized: false, loadState, reload });
    await act(async () => { await checkNow(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("this tab's own reset moves the round it shows: no reload for it", async () => {
    shownAt("case-own", 4);
    const fetchImpl = jest.fn(async () => response({ success: true, case: { caseId: "case-own", projection: { round: 5 } } }));
    await persistPocCase("RESET_ANSWERS", { caseId: "case-own", idempotencyKey: "reset:1", payload: {} }, fetchImpl);
    const reload = jest.fn();
    page({ caseId: "case-own", shownFinalized: false, loadState: async () => ({ round: 5, finalized: false }), reload });
    await act(async () => { expect(await checkNow()).toBe("unchanged"); });
    expect(reload).not.toHaveBeenCalled();
  });

  // Review (2026-10-09): a timer or focus reload while an answer was saving
  // raised the page's own "Leave site?" prompt and lost typed input.
  test("never reloads with input not yet sent; looks again shortly and reloads once it is sent", async () => {
    jest.useFakeTimers();
    shownAt("case-busy", 0);
    let unsaved = true;
    const reload = jest.fn();
    page({ caseId: "case-busy", shownFinalized: false, loadState: async () => ({ round: 1, finalized: false }), reload, hasUnsavedWork: () => unsaved });
    await act(async () => { expect(await checkNow()).toBe("deferred"); });
    expect(reload).not.toHaveBeenCalled();
    unsaved = false;
    await act(async () => { jest.advanceTimersByTime(BUSY_RECHECK_MS); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("never reloads while this tab is writing to the case", async () => {
    shownAt("case-writing", 0);
    let answer;
    const fetchImpl = jest.fn(() => new Promise((resolve) => { answer = resolve; }));
    const write = persistPocCase("SUBMIT_ANSWER", { caseId: "case-writing", idempotencyKey: "answer:w", payload: {} }, fetchImpl);
    const reload = jest.fn();
    page({ caseId: "case-writing", shownFinalized: false, loadState: async () => ({ round: 1, finalized: false }), reload });
    await act(async () => { expect(await checkNow()).toBe("deferred"); });
    expect(reload).not.toHaveBeenCalled();
    for (let tick = 0; tick < 50 && !answer; tick += 1) await Promise.resolve();
    answer(response({ success: true, case: { caseId: "case-writing", projection: { round: 0 } } }));
    await write;
  });

  // Review (2026-10-09): every focus - closing the file picker included - read
  // the whole case, against the case read limit.
  test("focus checks are spaced out", async () => {
    const loadState = jest.fn(async () => ({ round: 0, finalized: false }));
    page({ caseId: "case-focus", shownFinalized: false, loadState, reload: jest.fn() });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(loadState).toHaveBeenCalledTimes(1);
  });

  // Review (2026-10-09): a page that cannot show the server's state (its
  // restore failed) reloaded every minute and on every focus.
  test("reloads at most once for any one state of the case", async () => {
    const reload = jest.fn();
    const loadState = jest.fn(async () => ({ round: 7, finalized: false }));
    shownAt("case-loop", 6);
    const first = page({ caseId: "case-loop", shownFinalized: false, loadState, reload });
    await act(async () => { await checkNow(); });
    first.unmount();
    shownAt("case-loop", 6); // the reloaded page still shows the old round
    page({ caseId: "case-loop", shownFinalized: false, loadState, reload });
    await act(async () => { expect(await checkNow()).toBe("changed"); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("the check reads the case's state, not the whole case", async () => {
    const fetchImpl = jest.fn(async () => response({ success: true, state: { round: 2, finalized: false } }));
    await expect(loadPocCaseState("case 1", fetchImpl)).resolves.toEqual({ round: 2, finalized: false });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/ubo-poc-case?caseId=case%201&state=1");
  });
});

// The server refuses a step made in a round that has since ended
// (case_round_changed): each step says which round it was made in.
test("answers, syncs, finalising and identity checks carry the round they were made in", async () => {
  hydrateBrowserFromPocCase({ ...record, caseId: "case-rounds", projection: { ...record.projection, round: 3, demoCase: { ...record.projection.demoCase, demoCaseId: "case-rounds" } } });
  const fetchImpl = jest.fn(async () => response({ success: true, case: { caseId: "case-rounds", projection: { round: 3 } } }));
  for (const operation of ["SUBMIT_ANSWER", "SYNC_RESOLUTION", "FINALIZE_ASSESSMENT", "COMPLETE_IDV", "RESET_ANSWERS"]) {
    await persistPocCase(operation, { caseId: "case-rounds", idempotencyKey: `k:${operation}`, payload: {} }, fetchImpl);
  }
  const rounds = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body).round);
  expect(rounds).toEqual([3, 3, 3, 3, undefined]);
  expect(shownCaseRound("case-rounds")).toBe(3);
});

test("a step refused because the round changed says so in plain words, with its code", async () => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status: 409, json: async () => ({ success: false, code: "case_round_changed", message: "This review changed while you were working on it. Please reload the page to see where it stands." }) }));
  const refused = persistPocCase("SUBMIT_ANSWER", { caseId: "case-moved", idempotencyKey: "answer:m", payload: {} }, fetchImpl);
  await expect(refused).rejects.toMatchObject({ code: "case_round_changed", message: expect.stringMatching(/changed while you were working on it/) });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(caseMovedOn("case_round_changed")).toBe(true);
  expect(caseMovedOn("case_finalized")).toBe(true);
  expect(caseMovedOn("case_write_timeout")).toBe(false);
});
