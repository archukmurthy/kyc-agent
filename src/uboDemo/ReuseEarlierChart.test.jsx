/**
 * Owner decision 2026-10-08 (option b): a case started from saved research is
 * offered the chart already read on the case it came from - copied by the
 * server, not read again.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReuseEarlierChart from "./ReuseEarlierChart";

const demoCase = { demoCaseId: "case-new", company: { legalName: "Vodafone Limited", registrationNumber: "01471587" } };
const savedFrom = { caseId: "case-old" };
const caseRecord = (projection) => ({ ok: true, status: 200, json: async () => ({ success: true, case: { caseId: "x", projection } }) });

afterEach(() => { delete window.fetch; });

test("offers the earlier case's chart and attaches the server's copy to this case", async () => {
  const calls = [];
  window.fetch = jest.fn(async (url, request = {}) => {
    calls.push({ url, body: request.body ? JSON.parse(request.body) : null });
    if (String(url).includes("caseId=case-new")) return caseRecord({});
    if (String(url).includes("caseId=case-old")) return caseRecord({ chartReference: { jobId: "job-old", artifactId: "artifact-1", calculationMethod: "EFFECTIVE_INTEREST" } });
    if (String(url).includes("ubo-demo-customer-ownership-chart")) return { ok: true, status: 200, json: async () => ({ success: true, job: { jobId: "job-copy", artifactId: "artifact-1", state: "PARTIAL" } }) };
    return { ok: true, status: 200, json: async () => ({ success: true, case: { caseId: "case-new" } }) };
  });
  const reload = jest.fn();
  render(<ReuseEarlierChart demoCase={demoCase} savedFrom={savedFrom} reload={reload} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use the earlier chart" }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  const reuse = calls.find((call) => call.body?.operation === "REUSE_CHART_READING");
  expect(reuse.body).toEqual({ operation: "REUSE_CHART_READING", sourceJobId: "job-old", demoContext: { demoCaseId: "case-new", company: demoCase.company } });
  const attach = calls.find((call) => call.body?.operation === "ASSOCIATE_CHART");
  expect(attach.body.caseId).toBe("case-new");
  expect(attach.body.payload.chartReference.jobId).toBe("job-copy");
});

test("nothing is offered when this case already has its chart, or the earlier one has none", async () => {
  window.fetch = jest.fn(async (url) => (String(url).includes("caseId=case-new")
    ? caseRecord({ chartReference: { jobId: "job-own" } })
    : caseRecord({ chartReference: { jobId: "job-old" } })));
  const { container, unmount } = render(<ReuseEarlierChart demoCase={demoCase} savedFrom={savedFrom} />);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
  unmount();
  window.fetch = jest.fn(async () => caseRecord({}));
  const second = render(<ReuseEarlierChart demoCase={demoCase} savedFrom={savedFrom} />);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(2));
  expect(second.container).toBeEmptyDOMElement();
});
