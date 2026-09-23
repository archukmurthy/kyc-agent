"use strict";

/**
 * POST /api/sign-out
 *
 * Ends the caller's own session, and only theirs.
 *
 * This could not exist before AUTH-2: when the token was the password, the only
 * way to "sign somebody out" was to change the password, which signed out
 * everybody who shared it. A session carries its own id, so ending one leaves
 * every colleague still working.
 *
 * Open by design - no gate in front of it. The only thing a caller can do here
 * is destroy a session they already hold, which is not an attack; and a
 * sign-out that can fail because your session already expired is a sign-out
 * that leaves people stuck on a broken screen. It answers the same way
 * whatever it was given, so it cannot be used to test whether a token is
 * valid.
 */

const { applyCors } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const session = require("../lib/session");

const DEFAULT_DEPS = { enforceRateLimit, session };
let _deps = { ...DEFAULT_DEPS };

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (!(await _deps.enforceRateLimit(req, res, "sign-out"))) return undefined;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const token = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";

  try {
    if (token) await _deps.session.revoke(token);
  } catch (err) {
    // A session that cannot be recorded as ended is worth knowing about, but
    // the caller is signing out either way - their browser drops the token
    // regardless, and telling them it failed only leaves them unsure.
    // eslint-disable-next-line no-console
    console.warn("[sign-out] could not record the revocation:", err && err.message);
  }

  // The same answer for a good token, an expired one, and no token at all.
  return res.status(200).json({ success: true });
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
