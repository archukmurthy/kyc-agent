"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { createCustomerOwnershipJobService } = require("../evidence/customerOwnershipJobs/dependencies.js");

function createHandler(analyse = null, reevaluate = reevaluateSavedCustomerOwnershipChart, jobFactory = createCustomerOwnershipJobService) {
  return async function customerOwnershipChartHandler(req, res) {
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
