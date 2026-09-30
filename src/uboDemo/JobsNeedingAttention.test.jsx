import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import JobsNeedingAttention from "./JobsNeedingAttention";

function server(handlers) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.operation);
    const data = handlers[body.operation](body);
    return { ok: data.success !== false, json: async () => data };
  });
  return { fetchImpl, calls };
}

const failed = { jobId: "job-9", state: "FAILED", stuck: false, kind: "OWNERSHIP_CHART", caseId: "case-1", company: "Target Limited", attempts: 3, maxAttempts: 3, reasonCode: "provider_unavailable", reason: "The provider was unavailable.", upstreamStatus: 502, correlationId: "c-9", updatedAt: "2026-09-30T10:00:00.000Z" };

test("lists what failed, with why, and says a retry costs an upload", async () => {
  const { fetchImpl } = server({ LIST_JOBS_NEEDING_ATTENTION: () => ({ success: true, jobs: [failed] }) });
  render(<JobsNeedingAttention fetchImpl={fetchImpl} />);
  expect(await screen.findByText(/Target Limited/)).toBeInTheDocument();
  expect(screen.getByText(/The provider was unavailable\./)).toBeInTheDocument();
  expect(screen.getByText(/counts as one of the demo's chart uploads/)).toBeInTheDocument();
});

test("trying again queues a failed reading, reads it, and shows the outcome", async () => {
  let listed = [failed];
  const { fetchImpl, calls } = server({
    LIST_JOBS_NEEDING_ATTENTION: () => ({ success: true, jobs: listed }),
    RETRY_EXTRACTION_JOB: () => ({ success: true, job: { jobId: "job-9", state: "QUEUED", retried: true } }),
    PROCESS_EXTRACTION_JOB: () => { listed = []; return { success: true, job: { jobId: "job-9", state: "COMPLETE" } }; },
  });
  render(<JobsNeedingAttention fetchImpl={fetchImpl} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText(/None\. Every chart and evidence reading/)).toBeInTheDocument());
  expect(calls).toEqual(["LIST_JOBS_NEEDING_ATTENTION", "RETRY_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "LIST_JOBS_NEEDING_ATTENTION"]);
});

test("a stuck reading is picked up again without being re-queued", async () => {
  const stuck = { ...failed, state: "RUNNING", stuck: true };
  const { fetchImpl, calls } = server({
    LIST_JOBS_NEEDING_ATTENTION: () => ({ success: true, jobs: [stuck] }),
    PROCESS_EXTRACTION_JOB: () => ({ success: true, job: { jobId: "job-9", state: "FAILED" } }),
  });
  render(<JobsNeedingAttention fetchImpl={fetchImpl} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Failed again");
  expect(calls).not.toContain("RETRY_EXTRACTION_JOB");
});

test("a refusal is shown", async () => {
  const { fetchImpl } = server({ LIST_JOBS_NEEDING_ATTENTION: () => ({ success: false, message: "Sign in again." }) });
  render(<JobsNeedingAttention fetchImpl={fetchImpl} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again.");
});
