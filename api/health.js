"use strict";

/**
 * /api/health
 *
 * Is this deployment alive, and is it wired up? Two questions a trial needs
 * answered without waking anybody: a prospect saying "the site is down" and a
 * deploy that silently came up without its storage look identical from outside.
 *
 * Deliberately open - no login. A health check behind a login cannot tell you
 * the login is broken, which is the outage you most want to hear about. It is
 * rate-limited like every other open route.
 *
 * It answers with BOOLEANS ONLY. Never a connection string, a key, a hostname,
 * a version of anything, or a count of customers: this is a public URL, and
 * "which storage backend, which region, how many tenants" is reconnaissance.
 * "Storage configured: yes" tells an attacker nothing they could not guess and
 * tells us the one thing we need.
 */

const { applyCors } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const storage = require("../lib/storage");
const { attachRequestId, logFailure } = require("../lib/requestLog");

const DEFAULT_DEPS = { enforceRateLimit, storage };
let _deps = { ...DEFAULT_DEPS };

const PROBE_KEY = "health:probe";

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (!(await _deps.enforceRateLimit(req, res, "health"))) return undefined;

  const reference = attachRequestId(req, res);

  // Does the store actually answer? "Configured" and "working" are different
  // questions, and only the second one matters at 9pm.
  let storageOk = false;
  try {
    await _deps.storage.get(PROBE_KEY);
    storageOk = true;
  } catch (err) {
    logFailure("health", err, req, { status: 503 });
  }

  const body = {
    ok: storageOk,
    // Booleans, not values. Somebody reading this should learn whether we are
    // wired up, never how.
    checks: {
      storage: storageOk,
      clerkConfigured: Boolean(process.env.CLERK_SECRET_KEY),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    reference,
  };

  // 503 when the store is down, so an uptime check can be pointed at this and
  // mean something. A 200 that says "ok: false" is a monitor nobody notices.
  return res.status(storageOk ? 200 : 503).json(body);
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
