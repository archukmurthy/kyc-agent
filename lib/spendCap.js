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
 * It is a circuit breaker, not a queue:
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

// Roughly ten busy analysts. Chosen to be unreachable on a normal day and
// obvious on a broken one.
const DEFAULT_DAILY_LIMIT = 300;
const ALERT_THRESHOLDS = [60, 85];

let _deps = {
  storage,
  now: () => Date.now(),
  alert: (event) => {
    // Until there is somewhere to send alerts (the observability row), a
    // warning in the platform log is the honest minimum.
    // eslint-disable-next-line no-console
    console.warn(`[spend-cap] ${event.tenantId} has used ${event.used}/${event.limit} of today's provider calls (${event.threshold}%)`);
  },
};

function dayKey(tenantId) {
  const day = new Date(_deps.now()).toISOString().slice(0, 10);
  return `spend:${tenantId}:${day}`;
}

function limitFor() {
  const configured = Number(process.env.SPEND_CAP_DAILY);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_DAILY_LIMIT;
}

async function usedToday(tenantId) {
  return Number(await _deps.storage.get(dayKey(tenantId))) || 0;
}

/** Counts one provider call against the account, and alerts on the way past
 *  each threshold - once per threshold per day, so it never becomes noise. */
async function record(tenantId, units = 1) {
  if (!tenantId) return null;
  try {
    const limit = limitFor();
    const before = await usedToday(tenantId);
    const after = before + units;
    await _deps.storage.set(dayKey(tenantId), after, { ttlSeconds: 36 * 3600 });

    for (const threshold of ALERT_THRESHOLDS) {
      const mark = Math.ceil((limit * threshold) / 100);
      if (before < mark && after >= mark) {
        _deps.alert({ tenantId, used: after, limit, threshold });
      }
    }
    return after;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[spend-cap] could not record spend:", err && err.message);
    return null;
  }
}

/** @returns {Promise<{blocked: boolean, used?: number, limit?: number, tenantId?: string, message?: string}>} */
async function check(tenantId) {
  if (!tenantId) return { blocked: false };
  try {
    const limit = limitFor();
    const used = await usedToday(tenantId);
    if (used < limit) return { blocked: false, used, limit, tenantId };
    return {
      blocked: true,
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

module.exports = { check, record, usedToday, DEFAULT_DAILY_LIMIT, ALERT_THRESHOLDS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
