import {
  ACTIVE_POC_CASE_KEY,
  activePocCaseId,
  hydrateBrowserFromPocCase,
  loadPocCase,
  persistPocCase,
} from "./pocCaseClient";
import { DEMO_SESSION_KEY } from "./demoSession";
import { CUSTOMER_OWNERSHIP_CHART_SESSION_KEY } from "./customer/customerOwnershipChartSession";

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

beforeEach(() => window.localStorage.clear());

test("loads a case by durable identifier rather than browser state", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, case: record }));
  await expect(loadPocCase("case-cross-session", fetchImpl)).resolves.toEqual(record);
  expect(fetchImpl).toHaveBeenCalledWith("/api/ubo-poc-case?caseId=case-cross-session", { headers: { Accept: "application/json" } });
});

test("rehydrates a fresh browser from the server projection", () => {
  expect(hydrateBrowserFromPocCase(record)).toBe(true);
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).demoCase.demoCaseId).toBe("case-cross-session");
  expect(JSON.parse(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).result.durableExtraction).toEqual({ jobId: "job-1", artifactId: "artifact-1", state: "COMPLETE" });
  expect(activePocCaseId()).toBe("case-cross-session");
});

test("rehydrates the durable assessment trace when the case has no research projection", () => {
  const trace = { discoveryState: "READY_FOR_IDV", verificationAssessment: { subjects: [{ personId: "alice" }] } };
  const assessmentOnly = {
    ...record,
    projection: { ...record.projection, researchResult: undefined, assessment: { trace } },
  };

  expect(hydrateBrowserFromPocCase(assessmentOnly)).toBe(true);
  expect(JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY)).researchResult.ownershipResolutionTrace).toEqual(trace);
  expect(JSON.parse(window.localStorage.getItem(CUSTOMER_OWNERSHIP_CHART_SESSION_KEY)).context.researchResult.ownershipResolutionTrace).toEqual(trace);
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
  expect(window.localStorage.getItem(ACTIVE_POC_CASE_KEY)).toBe("case-cross-session");
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
  expect(request.payload.resolution.recalculations.q2.chartAnalysis.view.graph.relationships).toHaveLength(1);
  expect(request.payload.researchResult.candidateSources[0].candidateFacts).toHaveLength(1);
  expect(fetchImpl.mock.calls[0][1].body.length).toBeLessThan(15000);
});
