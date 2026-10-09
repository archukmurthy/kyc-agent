/* eslint-env node */
"use strict";

/**
 * A fixed number of paid runs for a public demo, shared by everyone using it.
 *
 * The daily ceilings in lib/spendCap.js reset every day and bound a paying
 * customer's bad week. A demo is different: it is paid for by us, handed to
 * people to try, and has a total budget - N research runs and N chart uploads,
 * ever, whoever makes them. When they are gone the demo says so.
 *
 * Off unless configured. The platform deployment sets neither variable and is
 * never limited by this.
 *
 * CommonJS so api/ handlers and lib/rateLimit.js can require it.
 */

const storage = require("./storage");

// Only the two paid things the demo does. Anything else is not counted here.
const TOTALS = Object.freeze({
  "ubo-discovery": { env: "DEMO_TOTAL_RESEARCH_RUNS", noun: "research runs" },
  "ubo-demo-chart": { env: "DEMO_TOTAL_CHART_UPLOADS", noun: "ownership chart uploads" },
});

let _deps = { storage };

function limitFor(bucket) {
  const total = TOTALS[bucket];
  if (!total) return null;
  const configured = Number(process.env[total.env]);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : null;
}

function keyFor(bucket) {
  return `demo-total:${bucket}`;
}

async function used(bucket) {
  return Number(await _deps.storage.get(keyFor(bucket))) || 0;
}

/** @returns {Promise<{blocked: boolean, used?: number, limit?: number, message?: string}>} */
async function check(bucket) {
  const limit = limitFor(bucket);
  if (!limit) return { blocked: false };
  const count = await used(bucket);
  if (count < limit) return { blocked: false, used: count, limit };
  return {
    blocked: true,
    used: count,
    limit,
    message: `This demo has used all ${limit} ${TOTALS[bucket].noun}. Get in touch to continue.`,
  };
}

/** Counts one paid run, in one atomic step: read-then-write lost runs made at
 *  the same moment (review, 2026-10-09). No TTL: the total is for the life of
 *  the demo. It is counted where the money is spent, after check() - so runs
 *  already in flight when the last one is counted can still finish (a few at
 *  most, each also inside its caller's hourly limit). */
async function record(bucket) {
  if (!limitFor(bucket)) return;
  await _deps.storage.incr(keyFor(bucket), 1);
}

module.exports = { check, record, TOTALS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
