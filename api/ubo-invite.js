"use strict";

/**
 * /api/ubo-invite
 *
 * Trial invites for the UBO module. Two audiences, two access levels, one file.
 *
 *   POST { action: "redeem", code }   any signed-in user - turns a code into
 *                                     their own workspace
 *   GET  ?action=status               any signed-in user - what their trial has
 *                                     left
 *   POST { action: "create", ... }    OWNER ONLY - makes a link
 *   POST { action: "revoke", code }   OWNER ONLY - kills a link
 *   POST { action: "mark_customer", code, customer }
 *                                     OWNER ONLY - marks a company as a buyer,
 *                                     so its work is never auto-deleted
 *   GET  ?action=list                 OWNER ONLY - every invite and its seats
 *
 * The owner actions are checked HERE, on the server. The screen that calls them
 * is only visible to owners, but hiding a screen stops nobody: anyone can post
 * to this route directly, and creating invites is how someone would help
 * themselves to our Anthropic budget.
 */

const { applyCors, requireStaff } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const trials = require("../lib/uboTrials");
const userAccess = require("../lib/userAccess");
const clerkAuth = require("../lib/clerkAuth");
const { logFailure, attachRequestId } = require("../lib/requestLog");

const DEFAULT_DEPS = { requireStaff, enforceRateLimit, trials, userAccess, clerkAuth };
let _deps = { ...DEFAULT_DEPS };

function send(res, status, body) {
  return res.status(status).json(body);
}

/** Owner actions need the person, their role, and nothing else. */
async function ownerOf(req, res) {
  const actor = await _deps.requireStaff(req, res, { roles: ["owner"] });
  return actor;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;

  const action = req.method === "GET"
    ? (req.query && req.query.action) || "status"
    : ((req.body && req.body.action) || "").toString();

  // Redemption is the one action an attacker can spray: it is the only way to
  // discover a working code, so it alone has the tight limit. Everything else
  // - the owner's screen, and every demo page asking "am I in a trial?" - is
  // signed in and owner-checked or read-only, and sharing that limit locked
  // the owner out of their own screen within minutes (found in the browser
  // test). Rate-limited before anything else happens, either way.
  if (!(await _deps.enforceRateLimit(req, res, action === "redeem" ? "ubo-invite" : "ubo-invite-manage"))) return undefined;

  try {
    // ── owner actions ────────────────────────────────────────────────────
    if (action === "create" || action === "revoke" || action === "list" || action === "mark_customer" || action === "set_budget") {
      const owner = await ownerOf(req, res);
      if (!owner) return undefined;

      if (action === "create") {
        const { company, seats, days, budget } = req.body || {};
        if (!company) return send(res, 400, { error: "company_required" });
        const invite = await _deps.trials.createInvite({
          company,
          seats,
          days,
          budget,
          createdBy: owner.userId,
        });
        return send(res, 200, { invite });
      }

      if (action === "set_budget") {
        // More (or fewer) paid AI steps for a link already sent.
        const code = String((req.body || {}).code || "");
        if (!code) return send(res, 400, { error: "code_required" });
        try {
          const updated = await _deps.trials.setBudget(code, Number((req.body || {}).budget));
          return send(res, updated ? 200 : 404, updated ? { invite: updated } : { error: "invite_invalid" });
        } catch (err) {
          if (err.code === "budget_invalid") return send(res, 400, { error: "budget_invalid", message: err.message });
          throw err;
        }
      }

      if (action === "mark_customer") {
        // Decides whose work survives the 90-day deletion of non-buyers' data.
        const code = String((req.body || {}).code || "");
        if (!code) return send(res, 400, { error: "code_required" });
        const customer = (req.body || {}).customer !== false;
        const done = await _deps.trials.markCustomer(code, { customer, by: owner.userId });
        return send(res, done ? 200 : 404, done ? { code, customer } : { error: "invite_invalid" });
      }

      if (action === "revoke") {
        const code = (req.body || {}).code;
        if (!code) return send(res, 400, { error: "code_required" });
        const done = await _deps.trials.revokeInvite(code);
        return send(res, done ? 200 : 404, done ? { revoked: code } : { error: "invite_invalid" });
      }

      return send(res, 200, { invites: await _deps.trials.listInvites() });
    }

    // ── anyone signed in ─────────────────────────────────────────────────
    const session = await _deps.clerkAuth.verifyClerkSession(req);
    if (!session.ok) return send(res, 401, { error: "unauthorized" });

    if (action === "redeem") {
      const code = (req.body || {}).code;
      if (!code) return send(res, 400, { error: "code_required" });

      const result = await _deps.trials.redeem({
        code,
        userId: session.userId,
        // Stored because Clerk ids change between instances; the verified email
        // is what lets their work be re-linked after a move to a real domain.
        email: session.email || (req.body || {}).email || null,
      });
      if (!result.ok) return send(res, 403, { error: result.reason });
      return send(res, 200, { access: result.access, alreadyRedeemed: Boolean(result.alreadyRedeemed) });
    }

    if (action === "status") {
      return send(res, 200, await _deps.trials.statusFor(session.userId));
    }

    return send(res, 400, { error: "unknown_action" });
  } catch (err) {
    const reference = logFailure("ubo-invite", err, req);
    attachRequestId(req, res);
    return send(res, 500, { error: "invite_failed", reference });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
