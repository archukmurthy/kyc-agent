// Rate limiter for the endpoints that cost money or write.
//
// Counted PER PERSON. A signed-in Clerk user is their own bucket; a customer
// link is its own bucket; everyone else is counted by client IP. An
// unverifiable credential never earns its own bucket - otherwise a random
// Bearer value per request would dodge the limit.
//
// It used to give every pre-boarding analyst at one company a single shared
// allowance. That was wrong: one analyst was refused because a colleague had
// been busy, and neither could tell why. It was the finest grain available
// before Clerk, because one shared password cannot distinguish two people.
//
// TWO windows, both enforced:
//   hour  fairness and runaway loops. Trips occasionally, harmlessly.
//   day   the bill. Should almost never trip; an hourly limit resets 24 times
//         a day, so it bounds a loop and bounds nothing about cost.
//
// Spend control, not access control: a storage failure is logged and the
// request is allowed.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const { resolveDossierActor } = require("./dossierAccess");
const spendCap = require("./spendCap");

const WINDOW_SECONDS = 3600;
const DAY_SECONDS = 24 * 3600;

// Buckets where a call costs money at a provider. Only these count against an
// account's daily ceiling; reads and telemetry do not.
const PAID_BUCKETS = new Set([
  "research", "doc-search", "self-source", "ubo-discovery",
  "ubo-demo-chart", "ubo-demo-entity", "generate-policy", "kyc-lookup", "idv-match",
]);
// hour: what one person may do in an hour. day: what one person may do in a
// day. Paid routes are deliberately tight; reads are not throttled like spends.
const LIMITS = Object.freeze({
  // Claude spend
  research: { hour: 15, day: 60 },
  "doc-search": { hour: 15, day: 60 },
  "self-source": { hour: 15, day: 60 },
  "ubo-discovery": { hour: 15, day: 60 },
  "ubo-demo-chart": { hour: 15, day: 60 },
  "ubo-demo-entity": { hour: 60, day: 300 },
  "generate-policy": { hour: 10, day: 40 },
  // Paid third party
  "kyc-lookup": { hour: 20, day: 100 },
  "idv-match": { hour: 20, day: 80 },
  // Free lookups - abuse protection only
  "company-search": { hour: 100, day: 400 },
  "document-requirements": { hour: 300, day: 2000 },
  "research-attempt": { hour: 20, day: 60 },
  // Redemption is the only way to discover a working invite code.
  "ubo-invite": { hour: 10, day: 40 },
  // Writes and reads
  "upload-document": { hour: 60, day: 300 },
  "get-document": { hour: 300, day: 2000 },
  "dossier-write": { hour: 120, day: 800 },
  "track-event": { hour: 600, day: 5000 },
});

// Hourly values by bucket name, kept for callers that only need the number.
const DEFAULT_LIMITS = Object.freeze(
  Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.hour]))
);

let _deps = { storage, resolveDossierActor, clerkAuth: require("./clerkAuth"), spendCap, now: () => Date.now() };

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
  // A signed-in person is their own bucket. This is the point of v2.
  try {
    if (_deps.clerkAuth.isConfigured()) {
      const session = await _deps.clerkAuth.verifyClerkSession(req);
      if (session.ok && session.userId) return { key: `user:${session.userId}`, tenantId: session.orgId || null };
    }
  } catch (_) {
    // fall through to the older credentials
  }

  let actor = null;
  try {
    actor = await _deps.resolveDossierActor(req);
  } catch (_) {
    actor = null;
  }
  // A pre-boarding analyst still has no individual identity (one shared
  // password), so they are counted per tenant until that login moves to Clerk.
  if (actor && actor.kind === "analyst" && actor.tenantId) return { key: `analyst:${actor.tenantId}`, tenantId: actor.tenantId };
  if (actor && actor.kind === "customer" && actor.dossierId) return { key: `dossier:${actor.dossierId}`, tenantId: actor.tenantId || null };
  return { key: `ip:${clientIp(req)}`, tenantId: null };
}

function sendRateLimited(res, { scope, limit, retryAfterSeconds }) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const plural = minutes === 1 ? "" : "s";
  const body = {
    error: "rate_limited",
    scope,
    limit,
    retryAfterSeconds,
    // Readable by a person. A 429 used to surface in the UBO lab as "no result
    // returned", which reads as broken software rather than as a limit.
    message:
      scope === "hour"
        ? `You have used all ${limit} requests for this hour. Try again in ${minutes} minute${plural}.`
        : `You have used all ${limit} requests for today. This resets at midnight UTC.`,
  };
  if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfterSeconds));
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(429).json(body);
  }
  res.statusCode = 429;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}

function limitsFor(bucket) {
  const configured = LIMITS[bucket];
  if (!configured) throw new Error(`unknown rate-limit bucket: ${bucket}`);
  return {
    hour: envLimit(envNameFor(bucket), configured.hour),
    day: envLimit(`${envNameFor(bucket)}_DAILY`, configured.day),
  };
}

async function enforceRateLimit(req, res, bucket) {
  const limits = limitsFor(bucket);
  try {
    const caller = await callerKey(req);

    // Hour first: it is the window a busy person legitimately meets, and its
    // message tells them to wait minutes rather than until tomorrow.
    const hourly = await check({ bucket, key: caller.key, limit: limits.hour, windowSeconds: WINDOW_SECONDS });
    if (!hourly.allowed) {
      sendRateLimited(res, { scope: "hour", limit: limits.hour, retryAfterSeconds: hourly.retryAfterSeconds });
      return false;
    }

    const daily = await check({ bucket: `${bucket}:day`, key: caller.key, limit: limits.day, windowSeconds: DAY_SECONDS });
    if (!daily.allowed) {
      sendRateLimited(res, { scope: "day", limit: limits.day, retryAfterSeconds: daily.retryAfterSeconds });
      return false;
    }

    // The account's own ceiling, on top of the per-person limits. Per-person
    // limits multiply with headcount and bound nothing about the bill.
    if (PAID_BUCKETS.has(bucket) && caller.tenantId) {
      const cap = await _deps.spendCap.check(caller.tenantId);
      if (cap.blocked) {
        if (typeof res.setHeader === "function") res.setHeader("Retry-After", "3600");
        const body = { error: "spend_cap_reached", scope: "account", limit: cap.limit, message: cap.message };
        if (typeof res.status === "function" && typeof res.json === "function") res.status(429).json(body);
        else { res.statusCode = 429; res.end(JSON.stringify(body)); }
        return false;
      }
      await _deps.spendCap.record(caller.tenantId);
    }
    return true;
  } catch (err) {
    // Spend control, not access control: a storage failure is logged and the
    // request is allowed rather than breaking the product.
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] ${bucket} check failed, allowing the request:`, err && err.message);
    return true;
  }
}

module.exports = {
  check,
  callerKey,
  LIMITS,
  PAID_BUCKETS,
  DAY_SECONDS,
  clientIp,
  enforceRateLimit,
  DEFAULT_LIMITS,
  WINDOW_SECONDS,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
