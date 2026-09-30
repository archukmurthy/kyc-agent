"use strict";

/**
 * /api/ubo-customer-link - the customer's way into one UBO case
 * (docs/ubo/CUSTOMER-LINK-PLAN.md).
 *
 *   POST { action: "create", caseId, email }  ANALYST - a link for a case in
 *                                             their own workspace, bound to
 *                                             the customer's email
 *   POST { action: "revoke", caseId }         ANALYST - every link and
 *                                             customer session for the case
 *                                             stops working
 *   POST { action: "open", link }             CUSTOMER - signed in with
 *                                             Clerk's emailed code; answers
 *                                             an 8-hour session for that one
 *                                             case if their verified email is
 *                                             the one the link was made for
 *
 * The workspace always comes from the analyst, never the request. A customer
 * session can never make or withdraw links. With sign-in switched off, "open"
 * works on the link alone in local development and never on Vercel.
 */

const { applyCors, requireStaff } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const clerkAuth = require("../lib/clerkAuth");
const customerLink = require("../lib/uboCustomerLink");
const { logFailure, attachRequestId } = require("../lib/requestLog");

// Whether a case exists in a workspace, through the case store's own
// tenant-scoped read.
async function caseExists(tenantId, caseId) {
  const { createPostgresDb } = require("../evidence/a2/postgresDb");
  const { PostgresPocCaseRepository } = require("../ubo-control-lab/server/pocCaseState");
  const db = createPostgresDb();
  try {
    return Boolean(await new PostgresPocCaseRepository(db, tenantId).get(caseId));
  } finally {
    await db.close();
  }
}

const DEFAULT_DEPS = { applyCors, requireStaff, enforceRateLimit, caseExists, clerk: clerkAuth };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function send(res, status, body) {
  return res.status(status).json(body);
}

function createHandler(deps = DEFAULT_DEPS) {
  return async function uboCustomerLink(req, res) {
    if (deps.applyCors(req, res)) return undefined;
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    if (!(await deps.enforceRateLimit(req, res, "ubo-customer-link"))) return undefined;
    res.setHeader("Cache-Control", "no-store");
    const body = req.body || {};

    try {
      if (body.action === "open") return await open(req, res, body, deps);

      if (body.action === "create" || body.action === "revoke") {
        // Keys to a case are the analyst's to hand out; a customer session
        // must not be able to mint more of them.
        if (req.headers?.["x-ubo-customer-session"] !== undefined) return send(res, 403, { error: "forbidden" });
        const actor = await deps.requireStaff(req, res, { requireTenant: true });
        if (!actor) return undefined;
        const tenantId = actor.tenantId;
        if (!tenantId) return send(res, 400, { error: "tenant_required" });
        const caseId = String(body.caseId || "").trim();
        if (!caseId || caseId.length > 200) return send(res, 400, { error: "case_id_required" });
        if (!(await deps.caseExists(tenantId, caseId))) return send(res, 404, { error: "case_not_found" });

        if (body.action === "revoke") {
          await customerLink.revokeLinks({ caseId, tenantId });
          return send(res, 200, { revoked: caseId });
        }
        const email = String(body.email || "").trim();
        if (!EMAIL.test(email)) return send(res, 400, { error: "email_required", message: "Enter the customer's email address." });
        const { token, expiresAt } = customerLink.mintLink({ caseId, tenantId, email });
        return send(res, 200, { token, caseId, expiresAt });
      }

      return send(res, 400, { error: "unknown_action" });
    } catch (error) {
      const reference = logFailure("ubo-customer-link", error, req);
      attachRequestId(req, res);
      return send(res, 500, { error: "customer_link_failed", reference });
    }
  };
}

async function open(req, res, body, deps) {
  const verified = await customerLink.verifyLink(String(body.link || ""));
  if (!verified.valid) return send(res, 401, { error: "link_invalid", message: "This link has expired or been withdrawn. Ask for a new one." });

  if (deps.clerk.isConfigured()) {
    const session = await deps.clerk.verifyClerkSession(req);
    if (!session.ok) return send(res, 401, { error: "unauthorized" });
    // The address Clerk verified with its emailed code - never one the
    // request supplies.
    const email = await deps.clerk.verifiedEmailFor(session.userId);
    if (!customerLink.emailMatches(verified.payload, email)) {
      return send(res, 403, { error: "wrong_recipient", message: "This link was sent to a different email address. Sign in with that address, or ask for a new link." });
    }
  } else if (process.env.VERCEL) {
    // Nobody can prove who they are, so the link alone would be the key.
    return send(res, 503, { error: "sign_in_not_configured" });
  }

  const { session, expiresAt } = customerLink.mintCustomerSession(verified.payload);
  return send(res, 200, { session, caseId: verified.payload.caseId, expiresAt });
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
