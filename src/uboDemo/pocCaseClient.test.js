import React from "react";
import { act, render } from "@testing-library/react";
import {
  ACTIVE_POC_CASE_KEY,
  activePocCaseId,
  CASE_STATE_CHECK_MS,
  hydrateBrowserFromPocCase,
  loadPocCase,
  persistPocCase,
  useReloadWhenFinalizedChanges,
} from "./pocCaseClient";
import { DEMO_SESSION_KEY } from "./demoSession";
import { CUSTOMER_OWNERSHIP_CHART_SESSION_KEY } from "./customer/customerOwnershipChartSession";
import { uboStore } from "./browserStore";
import { expandSharedAnalyses } from "./customer/recalculationStorage";

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
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: record }));
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

// A customer page open before the analyst reopened the review stayed locked
// until the customer happened to reload (review, 2026-10-09).
describe("a customer page notices the server's case changing under it", () => {
  const finalised = { projection: { assessment: { trace: { verificationAssessment: { finalized: true } } } } };
  const reopened = { projection: { assessment: null, resolution: { answers: {} } } };
  function Page({ shownFinalized, load, reload }) {
    useReloadWhenFinalizedChanges("case-1", shownFinalized, { load, reload });
    return null;
  }
  afterEach(() => jest.useRealTimers());

  test("a page shown as finalised reloads once the server's case is reopened", async () => {
    jest.useFakeTimers();
    const load = jest.fn(async () => reopened);
    const reload = jest.fn();
    render(React.createElement(Page, { shownFinalized: true, load, reload }));
    expect(load).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(CASE_STATE_CHECK_MS); });
    expect(load).toHaveBeenCalledWith("case-1");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("coming back to the page checks at once; a page that matches the server stays as it is", async () => {
    const load = jest.fn(async () => finalised);
    const reload = jest.fn();
    render(React.createElement(Page, { shownFinalized: true, load, reload }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
