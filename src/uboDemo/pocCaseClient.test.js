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
