"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { createCustomerOwnershipJobService } = require("../evidence/customerOwnershipJobs/dependencies.js");
const { applyCors, requireStaff, uboCallerTenant } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const demoAllowance = require("../lib/demoAllowance");

const DEFAULT_GATES = { applyCors, requireStaff, enforceRateLimit, demoAllowance };

function createHandler(analyse = null, reevaluate = reevaluateSavedCustomerOwnershipChart, jobFactory = createCustomerOwnershipJobService, gates = DEFAULT_GATES) {
  return async function customerOwnershipChartHandler(req, res) {
    if (gates.applyCors(req, res)) return undefined;
    // Merged from the UBO demo with no credential and no limit. Reaches document extraction and Anthropic, so an anonymous caller can spend our money.
    // Clerk gives these a real caller identity; the limiter is what holds until then.
    // Starting an upload is the paid call. Polling a job, processing it and
    // re-evaluating a saved result are not, and one upload polls up to twelve
    // times - they used to spend the paid hourly limit and the trial's budget.
    const operation = req.body?.operation;
    const paid = !["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "REEVALUATE_SAVED_EXTRACTION"].includes(operation);
    if (!(await gates.enforceRateLimit(req, res, paid ? "ubo-demo-chart" : "ubo-demo-chart-status"))) return undefined;
    // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set, so this
    // route behaves exactly as before until the keys land.
    // The job operations read the caller's workspace (uboCallerTenant below), so
    // this asks for one. Re-evaluating a saved result reads no stored data.
    const actor = await gates.requireStaff(req, res, { requireTenant: true });
    if (!actor) return undefined;
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    let dependencies;
    try {
      const body = req.body || {};
      res.setHeader("Cache-Control", "no-store");
      if (body.operation === "REEVALUATE_SAVED_EXTRACTION") {
        return res.status(200).json({ success: true, result: await reevaluate(body) });
      }
      // The injected legacy function keeps focused handler tests backwards-compatible.
      if (analyse) return res.status(200).json({ success: true, result: await analyse(body) });
      // Jobs hold an uploaded document and what was read from it: always the
      // caller's own workspace, never one named in the request (UBO-17).
      const tenantId = uboCallerTenant(actor);
      if (!tenantId) return res.status(400).json({ success: false, error: "tenant_required" });
      dependencies = jobFactory({ tenantId });
      let job;
      if (body.operation === "GET_EXTRACTION_JOB") job = await dependencies.service.status(body.jobId);
      else if (body.operation === "PROCESS_EXTRACTION_JOB") job = await dependencies.service.process(body.jobId);
      else if (body.operation === "RETRY_EXTRACTION_JOB") job = await dependencies.service.retry(body.jobId);
      else {
        job = await dependencies.service.start(body);
        // One of a public demo's shared uploads (a no-op anywhere else).
        await gates.demoAllowance.record("ubo-demo-chart");
      }
      if (job?.correlationId) res.setHeader("X-Correlation-Id", job.correlationId);
      const terminal = ["COMPLETE", "PARTIAL", "FAILED"].includes(job?.state);
      return res.status(terminal ? 200 : 202).json({ success: true, job });
    } catch (error) {
      console.error("[ubo-customer-extraction] request-failed", { code: error.code || "customer_ownership_chart_failed", statusCode: error.statusCode || 500 });
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Ownership chart analysis failed",
        code: error.statusCode && error.statusCode < 500 ? error.code || "customer_ownership_chart_failed" : "analysis_temporarily_unavailable",
        message: error.statusCode && error.statusCode < 500
          ? error.message
          : "We couldn't save or analyse this document right now. Please try again.",
      });
    } finally {
      if (dependencies?.close) await dependencies.close();
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.analyseCustomerOwnershipChart = analyseCustomerOwnershipChart;
module.exports = handler;
