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
// When the limits cannot be checked (storage down), a FREE bucket is allowed -
// spend control is not access control - but a PAID one is refused with a 503:
// allowing it let an ended or used-up trial spend our money during a storage
// blip (review, 2026-10-09). The platform's owners, known from configuration
// alone, are let through either way.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const { resolveDossierActor } = require("./dossierAccess");
const spendCap = require("./spendCap");

const WINDOW_SECONDS = 3600;
const DAY_SECONDS = 24 * 3600;

// Buckets where a call costs money at a provider. Only these count against an
// account's daily ceiling; reads and telemetry do not.
// Paid routes that count a trial's step themselves, where the AI call starts
// (lib/uboTrials.js#countPaidStep) - not here, before the request is checked.
const COUNTED_AT_THE_CALL = new Set(["ubo-discovery", "ubo-demo-chart", "ubo-demo-entity"]);

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
  // Polling and processing an upload that has already been counted: free, and
  // one upload polls up to twelve times, so generous.
  "ubo-demo-chart-status": { hour: 600, day: 3000 },
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
  // The rest of the invite route: the owner's screen and the trial check every
  // demo page makes. Signed in and owner-checked or read-only; abuse protection only.
  "ubo-invite-manage": { hour: 300, day: 2000 },
  // Managing people: a handful of calls a day in real use, and the one route
  // where a script would try roles until something sticks.
  "ubo-people": { hour: 30, day: 120 },
  // The demo's own endpoint. Most of what it does is local computation on
  // fixtures and replays, so this is abuse protection; the one operation that
  // reaches a provider passes the ubo-discovery allowance as well.
  "ubo-control-lab": { hour: 120, day: 600 },
  // Saving and restoring a UBO case. The screens write on every answer, upload
  // and step, so this is abuse protection - a script filling the table - not a
  // spend limit. Nothing here reaches a provider.
  "ubo-poc-case": { hour: 600, day: 3000 },
  // Making, withdrawing and opening customer links. Tight enough that nobody
  // can hammer it; a real customer opens their link a few times a day.
  "ubo-customer-link": { hour: 60, day: 300 },
  // Open by design, so the limiter is the only brake. Generous enough for an
  // uptime check every few seconds, tight enough not to be a free ping service.
  health: { hour: 600, day: 5000 },
  // Ending your own session. Generous: a sign-out that is refused leaves
  // somebody stuck on a screen they are trying to leave.
  "sign-out": { hour: 120, day: 600 },
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

let _deps = {
  storage,
  resolveDossierActor,
  clerkAuth: require("./clerkAuth"),
  userAccess: require("./userAccess"),
  trials: require("./uboTrials"),
  spendCap,
  demoAllowance: require("./demoAllowance"),
  customerLink: require("./uboCustomerLink"),
  now: () => Date.now(),
};

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

  // Counted first, in one atomic step, then compared: a burst can never get
  // more than `limit` through, as reading first and writing later allowed
  // (review, 2026-10-09). One round trip instead of two.
  const count = await _deps.storage.incr(storageKey, 1, { ttlSeconds: windowSeconds });
  if (count > limit) return { allowed: false, remaining: 0, retryAfterSeconds };
  return { allowed: true, remaining: limit - count, retryAfterSeconds };
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  // Vercel sets x-vercel-forwarded-for itself and a caller cannot forge it.
  // x-forwarded-for CAN be sent by the caller on any host that does not
  // overwrite it, and a forged one hands an anonymous caller a fresh rate-limit
  // bucket per request. Prefer the header the platform controls.
  const platform = typeof h["x-vercel-forwarded-for"] === "string" ? h["x-vercel-forwarded-for"].split(",")[0].trim() : "";
  if (platform) return platform;
  const forwarded = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].split(",")[0].trim() : "";
  if (forwarded) return forwarded;
  const real = typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "";
  if (real) return real;
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

async function callerKey(req) {
  // A UBO customer holding a session for one case is counted against that
  // case, and spends its workspace's ceiling. Checked before Clerk: customers
  // sign in with Clerk too (it proves their email), but have no workspace
  // there, which would skip the ceiling. An invalid session falls through.
  const customerSession = req.headers && req.headers["x-ubo-customer-session"];
  if (customerSession) {
    try {
      const verified = await _deps.customerLink.verifyCustomerSession(String(customerSession));
      // The workspace is in the key: case ids are made in the browser, so two
      // workspaces could share one and would share its allowance.
      if (verified.valid) return { key: `ubo-case:${verified.payload.tenantId}:${verified.payload.caseId}`, tenantId: verified.payload.tenantId, userId: null, customer: true };
    } catch (_) {
      // fall through to the other credentials
    }
  }

  // A signed-in person is their own bucket. This is the point of v2.
  try {
    if (_deps.clerkAuth.isConfigured()) {
      const session = await _deps.clerkAuth.verifyClerkSession(req);
      if (session.ok && session.userId) {
        // The workspace comes from OUR access list, not from Clerk's org claim.
        // Trial users are not in a Clerk organisation, so orgId is null for
        // exactly the people the spend cap was built for - and a null workspace
        // skips the cap entirely. There is one access list; this is it.
        let tenantId = session.orgId || null;
        try {
          const access = await _deps.userAccess.getAccess(session.userId);
          if (access && access.tenantId) tenantId = access.tenantId;
        } catch (_) {
          // Fall back to the org claim rather than failing the request.
        }
        return { key: `user:${session.userId}`, tenantId, userId: session.userId };
      }
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
  if (actor && actor.kind === "analyst" && actor.tenantId) return { key: `analyst:${actor.tenantId}`, tenantId: actor.tenantId, userId: null };
  if (actor && actor.kind === "customer" && actor.dossierId) return { key: `dossier:${actor.dossierId}`, tenantId: actor.tenantId || null, userId: null };
  return { key: `ip:${clientIp(req)}`, tenantId: null, userId: null };
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

function sendJson(res, status, body) {
  if (typeof res.status === "function" && typeof res.json === "function") return res.status(status).json(body);
  res.statusCode = status;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}

const TRIAL_REFUSALS = {
  trial_budget_spent: (budget) => `This trial has used all ${budget} paid AI steps (research runs and document readings). Your work is still here - get in touch to continue.`,
  trial_ended: () => "This trial has ended. Your work is still here and can be viewed - get in touch to continue.",
};

async function enforceRateLimit(req, res, bucket) {
  const limits = limitsFor(bucket);
  const paid = PAID_BUCKETS.has(bucket);
  let caller = null;
  try {
    caller = await callerKey(req);

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

    // A public demo's shared total (lib/demoAllowance.js). Checked first, so a
    // refused call eats no trial budget and no account ceiling. It is COUNTED
    // where the money is actually spent, not here: a cached research result
    // costs nothing and must not use up one of the demo's runs.
    if (paid) {
      const demo = await _deps.demoAllowance.check(bucket);
      if (demo.blocked) {
        sendJson(res, 429, { error: "demo_allowance_spent", limit: demo.limit, message: demo.message });
        return false;
      }
    }

    // A trial that has ended, or spent its budget, must not keep spending our
    // money. The WORKSPACE decides whose trial it is (lib/uboTrials.js): a
    // colleague added through People works under the trial too, and a
    // customer's paid step is the inviting trial's (UBO-48) - a used-up trial
    // refuses its customers too, before anything is spent.
    //
    // Routes in COUNTED_AT_THE_CALL count the step themselves, where the paid
    // call starts: counting here charged requests that were then refused
    // (UBO-44). A customer is never counted here either: several routes run
    // this before their own checks, so a link holder could use up the inviting
    // trial with requests that spend nothing. Every other paid step is taken
    // here, atomically and checked after taking, so a burst cannot overspend.
    let giveBack = null;
    if (paid) {
      const admitted = await _deps.trials.admitPaidStep({
        userId: caller.customer ? null : caller.userId,
        tenantId: caller.tenantId,
        take: !COUNTED_AT_THE_CALL.has(bucket) && !caller.customer,
      });
      if (admitted.refused) {
        sendJson(res, 403, caller.customer
          // A customer is not in the trial: they are told the review is paused, not about a trial.
          ? { error: "review_limit_reached", message: "This review cannot read more documents right now. Your answers so far are saved - please contact the person who sent you this link." }
          : { error: admitted.refused, message: TRIAL_REFUSALS[admitted.refused](admitted.budget) });
        return false;
      }
      giveBack = admitted.giveBack || null;
    }

    // The account's own ceiling, on top of the per-person limits. Per-person
    // limits multiply with headcount and bound nothing about the bill.
    if (paid && caller.tenantId) {
      const cap = await _deps.spendCap.check(caller.tenantId);
      if (cap.blocked) {
        // Refused after all: the trial's step was not spent.
        if (giveBack) await giveBack();
        if (typeof res.setHeader === "function") res.setHeader("Retry-After", "3600");
        sendJson(res, 429, { error: "spend_cap_reached", scope: "account", limit: cap.limit, message: cap.message });
        return false;
      }
      await _deps.spendCap.record(caller.tenantId);
    }
    return true;
  } catch (err) {
    const owner = Boolean(caller && caller.userId && _deps.userAccess.bootstrapOwners().includes(caller.userId));
    if (!paid || owner) {
      // eslint-disable-next-line no-console
      console.warn(`[rate-limit] ${bucket} check failed, allowing the request:`, err && err.message);
      return true;
    }
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] ${bucket} check failed, refusing a paid request:`, err && err.message);
    if (typeof res.setHeader === "function") res.setHeader("Retry-After", "60");
    sendJson(res, 503, {
      error: "limits_unavailable",
      message: "We could not check usage limits just now, so nothing was started. Please try again in a minute.",
    });
    return false;
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
