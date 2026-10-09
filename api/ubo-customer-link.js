"use strict";

const { randomUUID } = require("node:crypto");

/**
 * /api/ubo-customer-link - the customer's way into one UBO case
 * (docs/ubo/CUSTOMER-LINK-PLAN.md).
 *
 *   POST { action: "create", caseId, email }  ANALYST - a link for a case in
 *                                             their own workspace, bound to
 *                                             the customer's email; it
 *                                             replaces every earlier link
 *   POST { action: "revoke", caseId }         ANALYST - every link and
 *                                             customer session for the case
 *                                             stops working
 *   POST { action: "open", link }             CUSTOMER - signed in with
 *                                             Clerk's emailed code; answers
 *                                             an 8-hour session for that one
 *                                             case if their verified email is
 *                                             the one the link was made for
 *   POST { action: "resume" }                 CUSTOMER - the session again,
 *                                             from its HttpOnly cookie, after
 *                                             a page load
 *   POST { action: "leave" }                  clears that cookie
 *
 * Her customer screens move between pages with full page loads, and a session
 * must never sit in browser storage (CLAUDE.md, invariant 5). So "open" also
 * sets the session as an HttpOnly cookie - scripts cannot read it - sent only
 * to THIS route (Path). Each page asks "resume" and keeps what it gets in
 * memory; every other route accepts the session only as a header, so a
 * customer cookie in a browser never changes what the analyst screens do.
 *
 * The workspace always comes from the analyst, never the request. A customer
 * session can never make or withdraw links. With sign-in switched off, "open"
 * works on the link alone in local development and never on Vercel.
 */

const { applyCors, requireStaff, uboCallerTenant, verifyCustomerCaller, isLocalDevelopment } = require("../lib/routeAuth");
const storage = require("../lib/storage");
const { enforceRateLimit } = require("../lib/rateLimit");
const clerkAuth = require("../lib/clerkAuth");
const customerLink = require("../lib/uboCustomerLink");
const trials = require("../lib/uboTrials");
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

// A link made or withdrawn goes on the case's audit ledger (UBO-57): it is how
// the analyst's screen knows a customer may already be working on this case.
async function recordLinkEvent(tenantId, event) {
  const { createPostgresDb } = require("../evidence/a2/postgresDb");
  const auditLedger = require("../ubo-control-lab/server/auditLedger");
  const db = createPostgresDb();
  try {
    await auditLedger.record(db, tenantId, [auditLedger.linkEvent(event)]);
  } finally {
    await db.close();
  }
}

const DEFAULT_DEPS = { applyCors, requireStaff, enforceRateLimit, caseExists, recordLinkEvent, clerk: clerkAuth, storageBackend: () => storage.backend() };
const COOKIE = "ubo_customer_session";

function sessionCookie(req, value, maxAgeSeconds) {
  const https = process.env.VERCEL || String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || req.socket?.encrypted;
  const secure = https ? "; Secure" : "";
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/ubo-customer-link; Max-Age=${maxAgeSeconds}${secure}`;
}

function cookieValue(req) {
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return "";
}

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
    // A withdrawal written to one server's local disk is invisible to the
    // others, so on a hosted deployment links need shared storage (review).
    if (["create", "revoke", "open"].includes(body.action) && process.env.VERCEL && (deps.storageBackend || DEFAULT_DEPS.storageBackend)() === "filesystem") {
      return send(res, 503, { error: "shared_storage_required" });
    }

    try {
      if (body.action === "open") return await open(req, res, body, deps);
      if (body.action === "resume") {
        // Only the person who opened the link gets it back.
        const token = cookieValue(req);
        const checked = await verifyCustomerCaller(req, token, deps.clerk);
        if (!checked.actor) return send(res, 401, { error: "no_customer_session" });
        const { payload } = await customerLink.verifyCustomerSession(token);
        return send(res, 200, { session: token, caseId: payload.caseId, expiresAt: new Date(payload.exp).toISOString() });
      }
      if (body.action === "leave") {
        res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
        return send(res, 200, { left: true });
      }

      if (body.action === "create" || body.action === "revoke") {
        // Keys to a case are the analyst's to hand out; a customer session
        // must not be able to mint more of them.
        if (req.headers?.["x-ubo-customer-session"] !== undefined) return send(res, 403, { error: "forbidden" });
        const actor = await deps.requireStaff(req, res, { requireTenant: true });
        if (!actor) return undefined;
        const tenantId = uboCallerTenant(actor);
        if (!tenantId) return send(res, 400, { error: "tenant_required" });
        const caseId = String(body.caseId || "").trim();
        if (!caseId || caseId.length > 200) return send(res, 400, { error: "case_id_required" });
        if (!(await deps.caseExists(tenantId, caseId))) return send(res, 404, { error: "case_not_found" });

        const receivedAt = new Date().toISOString();
        const linkActor = { type: "ANALYST", id: actor.userId || null };
        if (body.action === "revoke") {
          await customerLink.revokeLinks({ caseId, tenantId });
          if (deps.recordLinkEvent) await deps.recordLinkEvent(tenantId, { caseId, eventType: "CUSTOMER_LINK_REVOKED", actor: linkActor, receivedAt, operationId: `link-revoked:${randomUUID()}` });
          return send(res, 200, { revoked: caseId });
        }
        const email = String(body.email || "").trim();
        if (!EMAIL.test(email)) return send(res, 400, { error: "email_required", message: "Enter the customer's email address." });
        // An ended trial is read-only: no new links (review, 2026-10-09).
        // Withdrawing stays possible above - taking access away is a safety
        // step, and an ended trial must still be able to take it.
        if (await (deps.trialEnded || trials.trialEndedFor)({ ...actor, tenantId })) {
          return send(res, 403, { error: "trial_ended", message: "This trial has ended. Your work is still here and can be viewed - get in touch to continue." });
        }
        // A new link replaces every earlier one for the case (and ends the
        // session opened from it) - recorded as the withdrawal it is.
        const { token, expiresAt, replaced } = await customerLink.mintLink({ caseId, tenantId, email });
        // Recorded before the link is handed over: a link the ledger does not
        // know about is one the analyst's warnings cannot see.
        // The link is made first and recorded after, so the ledger never names
        // a link that does not exist. If recording fails, the earlier links
        // are already replaced and this one is not handed over: the analyst is
        // told to make it again, which works (review, 2026-10-09).
        if (deps.recordLinkEvent) {
          try {
            if (replaced) await deps.recordLinkEvent(tenantId, { caseId, eventType: "CUSTOMER_LINK_REVOKED", actor: linkActor, receivedAt, operationId: `link-revoked:${randomUUID()}` });
            await deps.recordLinkEvent(tenantId, { caseId, eventType: "CUSTOMER_LINK_ISSUED", actor: linkActor, receivedAt, operationId: `link-issued:${randomUUID()}`, expiresAt });
          } catch (error) {
            const reference = logFailure("ubo-customer-link", error, req);
            attachRequestId(req, res);
            return send(res, 503, { error: "link_not_recorded", reference, message: "The new link could not be recorded, so it was not created. Any earlier link for this case no longer works. Please make the link again." });
          }
        }
        return send(res, 200, { token, caseId, expiresAt, replaced });
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

  if (!(await deps.caseExists(verified.payload.tenantId, verified.payload.caseId))) {
    return send(res, 404, { error: "case_not_found", message: "This case is no longer available." });
  }

  let subject = null;
  if (deps.clerk.isConfigured()) {
    const session = await deps.clerk.verifyClerkSession(req);
    if (!session.ok) return send(res, 401, { error: "unauthorized" });
    // The address Clerk verified with its emailed code - never one the
    // request supplies.
    const email = await deps.clerk.verifiedEmailFor(session.userId);
    if (!customerLink.emailMatches(verified.payload, email)) {
      return send(res, 403, { error: "wrong_recipient", message: "This link was sent to a different email address. Sign in with that address, or ask for a new link." });
    }
    subject = session.userId;
  } else if (!isLocalDevelopment()) {
    // Nobody can prove who they are, so the link alone would be the key.
    return send(res, 503, { error: "sign_in_not_configured" });
  }

  const { session, expiresAt } = customerLink.mintCustomerSession({ ...verified.payload, subject });
  res.setHeader("Set-Cookie", sessionCookie(req, session, customerLink.SESSION_HOURS * 60 * 60));
  return send(res, 200, { session, caseId: verified.payload.caseId, expiresAt });
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
