"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { createCustomerOwnershipJobService } = require("../evidence/customerOwnershipJobs/dependencies.js");
const { applyCors, requireStaff } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");

function createHandler(analyse = null, reevaluate = reevaluateSavedCustomerOwnershipChart, jobFactory = createCustomerOwnershipJobService) {
  return async function customerOwnershipChartHandler(req, res) {
    if (applyCors(req, res)) return undefined;
    // Merged from the UBO demo with no credential and no limit. Reaches document extraction and Anthropic, so an anonymous caller can spend our money.
    // Clerk gives these a real caller identity; the limiter is what holds until then.
    if (!(await enforceRateLimit(req, res, "ubo-demo-chart"))) return undefined;
    // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set, so this
    // route behaves exactly as before until the keys land.
    // No requireTenant here, deliberately. This route never reads the caller's
    // workspace - what scopes it is the rate limiter, which resolves the caller
    // and their workspace itself (lib/rateLimit.js#callerKey). Asking for a
    // tenant we then discard is a claim a reader believes and the code does not
    // keep, and with the login switched off it cannot be enforced anyway.
    if (!(await requireStaff(req, res))) return undefined;
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
      dependencies = jobFactory();
      let job;
      if (body.operation === "GET_EXTRACTION_JOB") job = await dependencies.service.status(body.jobId);
      else if (body.operation === "PROCESS_EXTRACTION_JOB") job = await dependencies.service.process(body.jobId);
      else if (body.operation === "RETRY_EXTRACTION_JOB") job = await dependencies.service.retry(body.jobId);
      else job = await dependencies.service.start(body);
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
