// Fixed-window rate limiter for the endpoints that spend Claude tokens.
//
// Callers are identified only by a VERIFIED credential (lib/dossierAccess.js):
// a pre-boarding analyst shares one bucket per tenant, a customer link shares
// one bucket per dossier, and everyone else is bucketed by client IP. An
// unverifiable credential never earns its own bucket — otherwise a random
// Bearer value per request would dodge the limit.
//
// Spend control, not access control: a storage failure is logged and the
// request is allowed.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const { resolveDossierActor } = require("./dossierAccess");

const WINDOW_SECONDS = 3600;
const DEFAULT_LIMITS = Object.freeze({
  // Claude spend
  research: 40,
  "doc-search": 40,
  "self-source": 40,
  "ubo-discovery": 20,
  "generate-policy": 10,
  // Batch 0: routes the wizard reaches before anyone signs in. No credential to
  // check yet (Batch 1), so the limiter is the only brake on abuse and cost.
  "company-search": 60,
  "kyc-lookup": 30,
  "document-requirements": 120,
  "track-event": 300,
  "upload-document": 60,
  "get-document": 300,
  // A fresh caller can mint unlimited application ids, so the per-id cap alone
  // does not bound how many counters they can create.
  "research-attempt": 20,
  // UBO demo routes, merged in from the UBO work. Both reach Anthropic.
  "ubo-demo-chart": 20,
  "ubo-demo-entity": 40,
});
const DEFAULT_ANALYST_LIMIT = 200;

let _deps = { storage, resolveDossierActor, now: () => Date.now() };

function envLimit(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envNameFor(bucket) {
  return `RATE_LIMIT_${bucket.toUpperCase().replace(/-/g, "_")}`;
}

async function check({ bucket, key, limit, windowSeconds = WINDOW_SECONDS }) {
  const nowMs = _deps.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const storageKey = `ratelimit:${bucket}:${key}:${windowStart}`;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000));

  const current = Number(await _deps.storage.get(storageKey)) || 0;
  if (current >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };

  // ponytail: fixed-window read-modify-write, not atomic — concurrent requests
  // at the limit edge can overshoot by a few. Swap for an atomic INCR if that
  // ever matters.
  await _deps.storage.set(storageKey, current + 1, { ttlSeconds: windowSeconds });
  return { allowed: true, remaining: limit - current - 1, retryAfterSeconds };
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const forwarded = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].split(",")[0].trim() : "";
  if (forwarded) return forwarded;
  const real = typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "";
  if (real) return real;
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

async function callerKey(req) {
  let actor = null;
  try {
    actor = await _deps.resolveDossierActor(req);
  } catch (_) {
    actor = null;
  }
  if (actor && actor.kind === "analyst" && actor.tenantId) return { key: `analyst:${actor.tenantId}`, analyst: true };
  if (actor && actor.kind === "customer" && actor.dossierId) return { key: `dossier:${actor.dossierId}`, analyst: false };
  return { key: `ip:${clientIp(req)}`, analyst: false };
}

function sendRateLimited(res, retryAfterSeconds) {
  const body = { error: "rate_limited", retryAfterSeconds };
  if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfterSeconds));
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(429).json(body);
  }
  res.statusCode = 429;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}

async function enforceRateLimit(req, res, bucket) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_LIMITS, bucket)) {
    throw new Error(`unknown rate-limit bucket: ${bucket}`);
  }
  try {
    const caller = await callerKey(req);
    const limit = caller.analyst
      ? envLimit("RATE_LIMIT_ANALYST", DEFAULT_ANALYST_LIMIT)
      : envLimit(envNameFor(bucket), DEFAULT_LIMITS[bucket]);
    const result = await check({ bucket, key: caller.key, limit });
    if (result.allowed) return true;
    sendRateLimited(res, result.retryAfterSeconds);
    return false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] ${bucket} check failed, allowing the request:`, err && err.message);
    return true;
  }
}

module.exports = {
  check,
  callerKey,
  clientIp,
  enforceRateLimit,
  DEFAULT_LIMITS,
  DEFAULT_ANALYST_LIMIT,
  WINDOW_SECONDS,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
