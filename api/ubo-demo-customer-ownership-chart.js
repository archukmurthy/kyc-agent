"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { createCustomerOwnershipJobService } = require("../evidence/customerOwnershipJobs/dependencies.js");
const { applyCors, requireUboCaller, uboCallerTenant } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const demoAllowance = require("../lib/demoAllowance");
const trials = require("../lib/uboTrials");
const { ensureTenantRow } = require("../lib/tenantRow");
const auditLedger = require("../ubo-control-lab/server/auditLedger");

// Which ledger event a job's answer is, if any (UBO-33): a new upload, or a
// reading that has just finished one way or the other.
function documentEventType(started, job) {
  if (started) return job?.reused ? null : "DOCUMENT_UPLOADED";
  if (job?.state === "FAILED") return "DOCUMENT_EXTRACTION_FAILED";
  if (job?.state === "COMPLETE" || job?.state === "PARTIAL") return "DOCUMENT_EXTRACTED";
  return null;
}

const DEFAULT_GATES = { applyCors, requireUboCaller, enforceRateLimit, demoAllowance, trials };

function createHandler(analyse = null, reevaluate = reevaluateSavedCustomerOwnershipChart, jobFactory = createCustomerOwnershipJobService, gates = DEFAULT_GATES) {
  return async function customerOwnershipChartHandler(req, res) {
    if (gates.applyCors(req, res)) return undefined;
    // Merged from the UBO demo with no credential and no limit. Reaches document extraction and Anthropic, so an anonymous caller can spend our money.
    // Clerk gives these a real caller identity; the limiter is what holds until then.
    // Starting an upload is the paid call. Polling a job, processing it and
    // re-evaluating a saved result are not, and one upload polls up to twelve
    // times - they used to spend the paid hourly limit and the trial's budget.
    const operation = req.body?.operation;
    const paid = !["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "REEVALUATE_SAVED_EXTRACTION", "LIST_JOBS_NEEDING_ATTENTION", "GET_CHART_FILE"].includes(operation);
    if (!(await gates.enforceRateLimit(req, res, paid ? "ubo-demo-chart" : "ubo-demo-chart-status"))) return undefined;
    // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set, so this
    // route behaves exactly as before until the keys land.
    // The job operations read the caller's workspace (uboCallerTenant below), so
    // this asks for one. Re-evaluating a saved result reads no stored data.
    const actor = await gates.requireUboCaller(req, res, { requireTenant: true });
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

      // Support's view of the workspace's failed and stuck jobs (UBO-35): staff
      // only - a customer sees their own case's jobs and nothing else.
      if (body.operation === "LIST_JOBS_NEEDING_ATTENTION") {
        if (actor.kind === "customer") return res.status(404).json({ success: false, code: "not_found" });
        return res.status(200).json({ success: true, jobs: await dependencies.service.needingAttention() });
      }

      // A customer's session names one case: uploads only for it, and only its
      // jobs - checked before a job is processed or retried, not after.
      if (actor.kind === "customer") {
        const jobOperation = ["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "RETRY_EXTRACTION_JOB", "GET_CHART_FILE"].includes(body.operation);
        const ours = jobOperation
          ? await dependencies.service.ownedByCase(body.jobId, actor.caseId)
          : String(body.demoContext?.demoCaseId || "") === actor.caseId;
        if (!ours) return res.status(404).json({ success: false, code: "job_not_found", message: "Extraction job was not found." });
      }
      // The uploaded file, to view it again after a reload: read from where the
      // upload was stored, never read by the AI again, so it costs nothing.
      if (body.operation === "GET_CHART_FILE") {
        const file = await dependencies.service.chartFile(body.jobId);
        res.setHeader("Content-Type", file.mediaType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.statusCode = 200;
        return res.end(file.bytes);
      }
      let job;
      let started = false;
      if (body.operation === "GET_EXTRACTION_JOB") job = await dependencies.service.status(body.jobId);
      else if (body.operation === "PROCESS_EXTRACTION_JOB") job = await dependencies.service.process(body.jobId);
      else if (body.operation === "RETRY_EXTRACTION_JOB") {
        job = await dependencies.service.retry(body.jobId);
        // A retry reads the document again, and pays again: one of the demo's
        // uploads, as the first reading was. Checked with the paid limit above.
        if (job?.retried) {
          await gates.demoAllowance.record("ubo-demo-chart");
          await (gates.trials || trials).countPaidStep(actor);
        }
      }
      else {
        // A trial workspace has no tenants row until its first write.
        if (dependencies.db) await ensureTenantRow(dependencies.db, tenantId);
        job = await dependencies.service.start(body);
        started = true;
        // One of a public demo's shared uploads (a no-op anywhere else).
        await gates.demoAllowance.record("ubo-demo-chart");
        // ...and one of the caller's trial steps, here where it is spent (UBO-44).
        await (gates.trials || trials).countPaidStep(actor);
      }
      if (job?.correlationId) res.setHeader("X-Correlation-Id", job.correlationId);
      const eventType = documentEventType(started, job);
      if (eventType && dependencies.db && job?.demoCaseId) {
        const actorType = actor.kind === "customer" ? "CUSTOMER" : "ANALYST";
        await auditLedger.record(dependencies.db, tenantId, [auditLedger.documentEvent({ tenantJob: job, eventType, actor: { type: actorType, id: actor.userId }, receivedAt: new Date().toISOString() })]);
      }
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
