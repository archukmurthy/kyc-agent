"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { createCustomerOwnershipJobService } = require("../evidence/customerOwnershipJobs/dependencies.js");
const { applyCors, requireUboCaller, uboCallerTenant } = require("../lib/routeAuth");
const { enforceRateLimit, paidStepRefusal } = require("../lib/rateLimit");
const demoAllowance = require("../lib/demoAllowance");
const trials = require("../lib/uboTrials");
const { ensureTenantRow } = require("../lib/tenantRow");
const auditLedger = require("../ubo-control-lab/server/auditLedger");
const { PostgresPocCaseRepository, serverTraceOf } = require("../ubo-control-lab/server/pocCaseState");

// Which ledger event a job's answer is, if any (UBO-33): a new upload, or a
// reading that has just finished one way or the other.
function documentEventType(started, job) {
  if (started) return job?.reused ? null : "DOCUMENT_UPLOADED";
  if (job?.state === "FAILED") return "DOCUMENT_EXTRACTION_FAILED";
  if (job?.state === "COMPLETE" || job?.state === "PARTIAL") return "DOCUMENT_EXTRACTED";
  return null;
}

// The case an upload is for, as the server holds it - read only: its company,
// and whether its review is finalised. Null where no case is saved yet.
async function savedCase(db, tenantId, caseId) {
  if (!db || !caseId) return null;
  const record = await new PostgresPocCaseRepository(db, tenantId).get(String(caseId));
  if (!record) return null;
  const projection = record.projection || {};
  // Only the server's own assessment counts - the case module's own rule.
  return {
    company: projection.demoCase?.company || record.company || null,
    finalised: serverTraceOf(projection)?.verificationAssessment?.finalized === true,
  };
}

function refuseFinalised(res) {
  return res.status(409).json({ success: false, code: "case_finalized", message: "This review has been finalised, so no more documents can be added. The analyst can reopen it." });
}

// A trial's paid step for a reading: the staff member's own trial, or for a
// customer the trial of the workspace that sent the link (UBO-48). Taken and
// checked in one atomic step (lib/uboTrials.js#admitPaidStep); a storage
// failure throws, so a reading that cannot be counted is not started.
function takePaidStep(gates, actor, tenantId) {
  return (gates.trials || trials).admitPaidStep({ userId: actor.kind === "customer" ? null : actor.userId, tenantId, take: true });
}

async function giveBackStep(step) {
  if (step?.giveBack) await Promise.resolve().then(step.giveBack).catch(() => {});
}

const KNOWN_OPERATIONS = new Set(["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "RETRY_EXTRACTION_JOB", "REEVALUATE_SAVED_EXTRACTION", "LIST_JOBS_NEEDING_ATTENTION", "GET_CHART_FILE", "REUSE_CHART_READING"]);

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
    // An upload names no operation; anything else must be one this route
    // knows. An unknown one used to fall through to a new - paid - upload.
    if (operation !== undefined && !KNOWN_OPERATIONS.has(operation)) {
      return res.status(400).json({ success: false, error: "unknown_operation" });
    }
    const paid = !["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "REEVALUATE_SAVED_EXTRACTION", "LIST_JOBS_NEEDING_ATTENTION", "GET_CHART_FILE", "REUSE_CHART_READING"].includes(operation);
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

      // An earlier reading, copied to a new case started from saved research:
      // staff only - a customer never reaches another case's upload - and
      // free, since nothing is read again.
      if (body.operation === "REUSE_CHART_READING") {
        if (actor.kind === "customer") return res.status(404).json({ success: false, code: "job_not_found", message: "Extraction job was not found." });
        const target = await savedCase(dependencies.db, tenantId, body.demoContext?.demoCaseId);
        if (target?.finalised) return refuseFinalised(res);
        const demoContext = target?.company ? { ...body.demoContext, company: { ...body.demoContext?.company, ...target.company } } : body.demoContext;
        const reused = await dependencies.service.reuseReading({ sourceJobId: body.sourceJobId, demoContext });
        return res.status(200).json({ success: true, job: reused });
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
        // A retry pays again: not once the case's review is finalised.
        if (dependencies.db) {
          const current = await dependencies.service.status(body.jobId);
          if ((await savedCase(dependencies.db, tenantId, current?.demoCaseId))?.finalised) return refuseFinalised(res);
        }
        // A retry reads the document again, and pays again: the trial's step is
        // taken first and checked as it is taken, and given back if nothing
        // was queued again (review, 2026-10-09).
        const step = await takePaidStep(gates, actor, tenantId);
        if (step.refused) return res.status(403).json({ success: false, code: step.refused, ...paidStepRefusal(actor, step.refused, step.budget) });
        try {
          job = await dependencies.service.retry(body.jobId);
        } catch (error) {
          await giveBackStep(step);
          throw error;
        }
        if (job?.retried) await gates.demoAllowance.record("ubo-demo-chart");
        else await giveBackStep(step);
      }
      else {
        // A trial workspace has no tenants row until its first write.
        if (dependencies.db) await ensureTenantRow(dependencies.db, tenantId);
        // The case as the server holds it, before anything is stored, read or
        // counted: a finalised review takes no more uploads (they were accepted
        // and paid for), and the company is the case's - a customer's request
        // used to rename the shared subject record and size its columns.
        const target = await savedCase(dependencies.db, tenantId, body.demoContext?.demoCaseId);
        if (target?.finalised) return refuseFinalised(res);
        if (!target && actor.kind === "customer" && dependencies.db) return res.status(404).json({ success: false, code: "job_not_found", message: "Extraction job was not found." });
        const request = target?.company ? { ...body, demoContext: { ...body.demoContext, company: { ...body.demoContext?.company, ...target.company } } } : body;
        // One of the caller's trial steps, taken before anything is stored or
        // read and checked as it is taken, so uploads in flight together cannot
        // pass the budget; a refused upload stores nothing (review, 2026-10-09).
        const step = await takePaidStep(gates, actor, tenantId);
        if (step.refused) return res.status(403).json({ success: false, code: step.refused, ...paidStepRefusal(actor, step.refused, step.budget) });
        try {
          job = await dependencies.service.start(request);
        } catch (error) {
          await giveBackStep(step);
          throw error;
        }
        started = true;
        // Paid only when something is read: an earlier reading of the same file
        // reused costs nothing, so its step is given back.
        if (job?.reused) await giveBackStep(step);
        // One of a public demo's shared uploads (a no-op anywhere else).
        else await gates.demoAllowance.record("ubo-demo-chart");
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
