"use strict";

/**
 * /api/ubo-people
 *
 * Who works here, and as what. The screen behind it is src/people/PeopleAdmin.
 *
 *   GET  ?action=list             everyone they may see, plus invitations not
 *                                 yet claimed
 *   POST { action: "invite" }     email + role - held until that person signs in
 *   POST { action: "role" }       change somebody's role
 *   POST { action: "remove" }     take access away
 *   POST { action: "cancel" }     withdraw an invitation nobody claimed
 *
 * Two levels of caller, and the difference is the whole point of this file:
 *
 *   owner  platform-wide. Sees every company, names the company on an
 *          invitation, and is the only role that can make another owner.
 *   admin  one company. Sees and changes only their own people, and cannot
 *          hand out a role above their own.
 *
 * Every one of those limits is enforced HERE. The screen hides what an admin
 * may not do, which is courtesy; anyone can post to this route directly, and
 * "make me an owner" is the single most valuable request in the product.
 */

const { applyCors, requireStaff } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const userAccess = require("../lib/userAccess");

const DEFAULT_DEPS = { requireStaff, enforceRateLimit, userAccess };
let _deps = { ...DEFAULT_DEPS };

// An admin may hand out their own role and below, never above it. Written as a
// list rather than a comparison so adding a role later cannot silently widen
// what an admin can grant.
const GRANTABLE = Object.freeze({
  owner: ["owner", "admin", "analyst"],
  admin: ["admin", "analyst"],
});

function send(res, status, body) {
  return res.status(status).json(body);
}

/** The company this action is about, or an error explaining why not.
 *
 *  An owner may name one. An admin may not: theirs is the only company they
 *  have, and accepting a tenant id from an admin is how one company's admin
 *  would add themselves to another.
 */
function tenantFor(actor, requested) {
  if (actor.role === "owner") {
    const named = (requested || "").toString().trim();
    return { tenantId: named || null };
  }
  if (!actor.tenantId) return { error: "no_organisation" };
  if (requested && requested !== actor.tenantId) return { error: "forbidden" };
  return { tenantId: actor.tenantId };
}

/** Whether this caller may act on this person at all. */
function mayTouch(actor, target) {
  if (!target) return false;
  if (actor.role === "owner") return true;
  // An admin's reach stops at their own company, and stops short of an owner:
  // an owner belongs to no company, so nothing an admin runs should reach one.
  return target.role !== "owner" && Boolean(actor.tenantId) && target.tenantId === actor.tenantId;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (!(await _deps.enforceRateLimit(req, res, "ubo-people"))) return undefined;

  const actor = await _deps.requireStaff(req, res, { roles: ["owner", "admin"] });
  if (!actor) return undefined;

  const action = req.method === "GET"
    ? (req.query && req.query.action) || "list"
    : ((req.body && req.body.action) || "").toString();

  // An owner sees everyone; an admin sees their own company. Passing null to
  // the list functions means "everything", so an admin with no company must
  // never reach them.
  const scope = actor.role === "owner" ? null : actor.tenantId;
  if (actor.role !== "owner" && !scope) return send(res, 403, { error: "no_organisation" });

  try {
    if (action === "list") {
      const [people, pending] = await Promise.all([
        _deps.userAccess.listAccess(scope),
        _deps.userAccess.listPending(scope),
      ]);
      return send(res, 200, {
        people,
        pending,
        you: { userId: actor.userId, role: actor.role, tenantId: actor.tenantId },
        grantableRoles: GRANTABLE[actor.role] || [],
      });
    }

    if (action === "invite") {
      const { email, role } = req.body || {};
      if (!email) return send(res, 400, { error: "email_required" });
      if (!(GRANTABLE[actor.role] || []).includes(role)) return send(res, 403, { error: "role_not_allowed" });

      const tenant = tenantFor(actor, (req.body || {}).tenantId);
      if (tenant.error) return send(res, 403, { error: tenant.error });
      if (role !== "owner" && !tenant.tenantId) return send(res, 400, { error: "tenant_required" });

      try {
        const invited = await _deps.userAccess.inviteByEmail({
          email,
          tenantId: tenant.tenantId,
          role,
          addedBy: actor.userId,
        });
        return send(res, 200, { invited });
      } catch (err) {
        // The only throws are the argument checks above - a bad address.
        return send(res, 400, { error: "invalid_invitation", message: err.message });
      }
    }

    if (action === "role") {
      const { userId, role } = req.body || {};
      if (!userId) return send(res, 400, { error: "user_required" });
      if (!(GRANTABLE[actor.role] || []).includes(role)) return send(res, 403, { error: "role_not_allowed" });
      if (userId === actor.userId) {
        // Changing your own role is how somebody locks themselves out of this
        // screen by accident, and an admin has no way back in.
        return send(res, 400, { error: "cannot_change_own_role" });
      }

      const target = await _deps.userAccess.getAccess(userId);
      if (!mayTouch(actor, target)) return send(res, 403, { error: "forbidden" });

      const updated = await _deps.userAccess.grantAccess({
        userId,
        tenantId: role === "owner" ? null : target.tenantId,
        role,
        email: target.email || null,
        addedBy: actor.userId,
      });
      return send(res, 200, { person: updated });
    }

    if (action === "remove") {
      const { userId } = req.body || {};
      if (!userId) return send(res, 400, { error: "user_required" });
      if (userId === actor.userId) return send(res, 400, { error: "cannot_remove_yourself" });

      const target = await _deps.userAccess.getAccess(userId);
      if (!mayTouch(actor, target)) return send(res, 403, { error: "forbidden" });
      if (target.source === "bootstrap") {
        // PLATFORM_OWNER_CLERK_IDS wins over anything stored, so deleting the
        // row would change nothing. Saying "removed" would be a lie the screen
        // then shows as fact.
        return send(res, 409, { error: "owner_is_configured", message: "This owner is set in the deployment configuration and can only be removed there." });
      }

      await _deps.userAccess.revokeAccess(userId);
      return send(res, 200, { removed: userId });
    }

    if (action === "cancel") {
      const email = ((req.body || {}).email || "").toString();
      if (!email) return send(res, 400, { error: "email_required" });

      // Same reach as a person: an admin may only withdraw an invitation to
      // their own company.
      const visible = await _deps.userAccess.listPending(scope);
      const match = visible.find((p) => p.email === email.trim().toLowerCase());
      if (!match) return send(res, 404, { error: "invitation_not_found" });

      await _deps.userAccess.cancelInvite(match.email);
      return send(res, 200, { cancelled: match.email });
    }

    return send(res, 400, { error: "unknown_action" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ubo-people]", err && err.message);
    return send(res, 500, { error: "people_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
