/* eslint-env node */
"use strict";

/**
 * A daily ceiling on what one account can spend, with alerts before it bites.
 *
 * Per-person rate limits (lib/rateLimit.js) stop one person's runaway loop.
 * They do not bound the bill: forty analysts at fifteen calls an hour is six
 * hundred calls an hour, all of it allowed. This is the number that answers
 * "what is the worst case on our bill".
 *
 * TWO ceilings, because they answer different questions:
 *   account   what one customer can spend in a day. Protects them from their
 *             own runaway, and us from one account's bad week.
 *   platform  what EVERY account together can spend in a day. Per-account
 *             ceilings do not bound our bill - ten accounts at the account
 *             limit is ten times the spend. This is the number that answers
 *             "what is the worst case", and the one to put in front of an
 *             investor.
 *
 * Both are circuit breakers, not queues:
 *   - set far above real use, so a working day never meets it
 *   - alerts at 60% and 85%, so an unusual day reaches a human long before
 *     anything stops. A ceiling with no warning is a trap, not a monitor.
 *   - raisable by environment variable, so a real customer hitting it on a busy
 *     day is a one-minute change rather than a release
 *
 * Trials are metered separately by their own budget (lib/uboTrials.js), which
 * does not reset - this one does, daily, because a paying account's spend is
 * expected and only its rate is surprising.
 *
 * CommonJS so api/ handlers can require it.
 */

const storage = require("./storage");

// Set for the product as it is today - no paying customers, prospects metered
// separately by their trial budget - rather than for an imagined enterprise.
// At current pricing a research call runs roughly 0.12-0.25 USD, so this is
// about 12-25 USD per account per day. Raised per customer when one signs,
// which is an environment variable rather than a release.
//
// These figures are arithmetic, not measurement: token usage per call is not
// recorded server-side yet. Recording it would turn every number here from a
// guess into a fact (tracked as COST-1).
const DEFAULT_DAILY_LIMIT = 100;

// Across every account. Deliberately not a multiple of the account limit: it is
// the ceiling on OUR bill, not a sum of customer allowances.
const DEFAULT_PLATFORM_DAILY_LIMIT = 500;
const ALERT_THRESHOLDS = [60, 85];

let _deps = {
  storage,
  now: () => Date.now(),
  alert: (event) => {
    // Until there is somewhere to send alerts (the observability row), a
    // warning in the platform log is the honest minimum.
    // eslint-disable-next-line no-console
    const who = event.scope === "platform" ? "the platform" : event.tenantId;
    console.warn(`[spend-cap] ${who} has used ${event.used}/${event.limit} of today's provider calls (${event.threshold}%)`);
  },
};

function today() {
  return new Date(_deps.now()).toISOString().slice(0, 10);
}

function dayKey(tenantId) {
  return `spend:${tenantId}:${today()}`;
}

function platformKey() {
  return `spend:__platform__:${today()}`;
}

function envLimit(name, fallback) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

function limitFor() {
  return envLimit("SPEND_CAP_DAILY", DEFAULT_DAILY_LIMIT);
}

function platformLimit() {
  return envLimit("SPEND_CAP_PLATFORM_DAILY", DEFAULT_PLATFORM_DAILY_LIMIT);
}

async function usedToday(tenantId) {
  return Number(await _deps.storage.get(dayKey(tenantId))) || 0;
}

async function usedTodayPlatform() {
  return Number(await _deps.storage.get(platformKey())) || 0;
}

/** Alerts once per threshold per day per scope, so it never becomes noise. */
function alertCrossings({ scope, tenantId, before, after, limit }) {
  for (const threshold of ALERT_THRESHOLDS) {
    const mark = Math.ceil((limit * threshold) / 100);
    if (before < mark && after >= mark) {
      _deps.alert({ scope, tenantId, used: after, limit, threshold });
    }
  }
}

/** Counts one provider call against the account, and alerts on the way past
 *  each threshold - once per threshold per day, so it never becomes noise. */
async function record(tenantId, units = 1) {
  if (!tenantId) return null;
  try {
    const accountBefore = await usedToday(tenantId);
    const accountAfter = accountBefore + units;
    await _deps.storage.set(dayKey(tenantId), accountAfter, { ttlSeconds: 36 * 3600 });
    alertCrossings({ scope: "account", tenantId, before: accountBefore, after: accountAfter, limit: limitFor() });

    // The same call also counts against everything-together.
    const platformBefore = await usedTodayPlatform();
    const platformAfter = platformBefore + units;
    await _deps.storage.set(platformKey(), platformAfter, { ttlSeconds: 36 * 3600 });
    alertCrossings({ scope: "platform", tenantId, before: platformBefore, after: platformAfter, limit: platformLimit() });

    return accountAfter;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[spend-cap] could not record spend:", err && err.message);
    return null;
  }
}

/** Takes one provider call from today's account and platform ceilings, in
 *  one atomic step each, and checks AFTER taking - so calls arriving together
 *  cannot each see room and together pass the ceiling (review, 2026-10-09:
 *  check-then-record was read-then-write). A refused call is given back at
 *  once. Errors are NOT swallowed: the limiter refuses a paid call it could
 *  not count, rather than letting it through uncounted.
 *  @returns {Promise<{blocked: boolean, scope?: string, used?: number, limit?: number, message?: string, giveBack?: () => Promise<void>}>} */
async function admit(tenantId, units = 1) {
  if (!tenantId) return { blocked: false };
  const ttl = { ttlSeconds: 36 * 3600 };
  const platformCeiling = platformLimit();
  const platformAfter = Number(await _deps.storage.incr(platformKey(), units, ttl));
  if (platformAfter > platformCeiling) {
    await _deps.storage.incr(platformKey(), -units, ttl);
    return {
      blocked: true,
      scope: "platform",
      used: platformAfter - units,
      limit: platformCeiling,
      message: "Research is paused for today while we review usage. It resets at midnight UTC.",
    };
  }
  const limit = limitFor();
  let accountAfter;
  try {
    accountAfter = Number(await _deps.storage.incr(dayKey(tenantId), units, ttl));
  } catch (err) {
    await _deps.storage.incr(platformKey(), -units, ttl).catch(() => {});
    throw err;
  }
  if (accountAfter > limit) {
    await Promise.all([_deps.storage.incr(dayKey(tenantId), -units, ttl), _deps.storage.incr(platformKey(), -units, ttl)]);
    return {
      blocked: true,
      scope: "account",
      used: accountAfter - units,
      limit,
      message: `This account has used all ${limit} provider calls allowed today. It resets at midnight UTC.`,
    };
  }
  alertCrossings({ scope: "platform", tenantId, before: platformAfter - units, after: platformAfter, limit: platformCeiling });
  alertCrossings({ scope: "account", tenantId, before: accountAfter - units, after: accountAfter, limit });
  const giveBack = async () => {
    await Promise.all([_deps.storage.incr(dayKey(tenantId), -units, ttl), _deps.storage.incr(platformKey(), -units, ttl)]);
  };
  return { blocked: false, scope: "account", used: accountAfter, limit, giveBack };
}

/** @returns {Promise<{blocked: boolean, used?: number, limit?: number, tenantId?: string, message?: string}>} */
async function check(tenantId) {
  if (!tenantId) return { blocked: false };
  try {
    // Platform first: once the day's total is gone, a fresh account must not
    // get a clean allowance out of it.
    const platformUsed = await usedTodayPlatform();
    const platformCeiling = platformLimit();
    if (platformUsed >= platformCeiling) {
      return {
        blocked: true,
        scope: "platform",
        used: platformUsed,
        limit: platformCeiling,
        tenantId,
        message: "Research is paused for today while we review usage. It resets at midnight UTC.",
      };
    }

    const limit = limitFor();
    const used = await usedToday(tenantId);
    if (used < limit) return { blocked: false, scope: "account", used, limit, tenantId };
    return {
      blocked: true,
      scope: "account",
      used,
      limit,
      tenantId,
      message: `This account has used all ${limit} provider calls allowed today. It resets at midnight UTC.`,
    };
  } catch (err) {
    // A safety net that fails closed takes the product down when the store
    // hiccups. Same trade as the rate limiter, logged either way.
    // eslint-disable-next-line no-console
    console.warn("[spend-cap] check failed, allowing the call:", err && err.message);
    return { blocked: false };
  }
}

module.exports = {
  admit,
  check,
  record,
  usedToday,
  usedTodayPlatform,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_PLATFORM_DAILY_LIMIT,
  ALERT_THRESHOLDS,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
