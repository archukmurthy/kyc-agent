/* eslint-env node */
"use strict";

/**
 * One request, one id, one log line you can actually find.
 *
 * Today a failure during a trial reaches us as "it broke around nine" and the
 * platform logs are a wall of unrelated lines. This gives every request an id,
 * puts that id in the response, and writes one structured line per failure - so
 * a prospect can quote six characters and we can find the exact request.
 *
 * WHAT IS NEVER LOGGED, and this is the part to keep honest:
 *   - no email addresses, names, or anything a person typed
 *   - no company being researched: the subject of an investigation is the
 *     customer's confidential work, not our telemetry
 *   - no tokens, keys, passwords, or Authorization headers
 *   - no request bodies
 *
 * What IS logged: the request id, the route, the HTTP status, an error code and
 * message, and the ids of the workspace and person involved. Ids are ours and
 * meaningless outside our own systems, which is what makes them safe to write
 * down and useful to search.
 *
 * Vercel puts its own id on every request (`x-vercel-id`). Using it where it
 * exists means our line and the platform's line describe the same request.
 *
 * CommonJS so api/ handlers can require it.
 */

const crypto = require("crypto");

let _deps = { now: () => new Date().toISOString() };

/** The id for this request: the platform's where there is one, ours otherwise.
 *  Stable within a request - computed once and remembered on the request. */
function requestId(req) {
  if (!req) return crypto.randomBytes(6).toString("hex");
  if (req.__requestId) return req.__requestId;

  const headers = req.headers || {};
  const platform = headers["x-vercel-id"] || headers["x-request-id"] || "";
  // Vercel's id can be long and contains routing detail; the tail is the part
  // that identifies the invocation.
  const id = platform ? String(platform).split("::").pop().slice(-16) : crypto.randomBytes(6).toString("hex");

  try {
    Object.defineProperty(req, "__requestId", { value: id, enumerable: false });
  } catch (_) {
    // A frozen or proxied request object: the id is still returned, just not
    // cached. Never let bookkeeping break the request.
  }
  return id;
}

function routeOf(req) {
  const url = (req && req.url) || "";
  // The path only. A query string carries whatever the caller put in it.
  return String(url).split("?")[0] || "unknown";
}

/** One line for a failure. Returns the request id so the caller can send it on.
 *
 *  @param {string} scope     the route or module, e.g. "ubo-people"
 *  @param {Error|any} err    what went wrong
 *  @param {object} req       the request, for its id and path
 *  @param {object} [extra]   ids only - { tenantId, userId, status }
 */
function logFailure(scope, err, req, extra = {}) {
  const id = requestId(req);
  const line = {
    at: _deps.now(),
    level: "error",
    scope,
    requestId: id,
    route: routeOf(req),
    method: (req && req.method) || null,
    status: extra.status || (err && err.status) || 500,
    code: (err && err.code) || null,
    // The message, not the stack: a stack in a log line is noise, and on a
    // serverless platform the platform already keeps the stack.
    message: err && err.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300),
    tenantId: extra.tenantId || null,
    userId: extra.userId || null,
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(line));
  return id;
}

/** Puts the id where the person can see it, so they can quote it.
 *
 *  The header is for us; the body field is for them - a support message saying
 *  "reference 8f2c1a" is worth an hour of guessing.
 */
function attachRequestId(req, res) {
  const id = requestId(req);
  try {
    if (res && typeof res.setHeader === "function") res.setHeader("x-request-id", id);
  } catch (_) {
    // Headers already sent. The id is still returned for the body.
  }
  return id;
}

module.exports = { requestId, logFailure, attachRequestId };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
